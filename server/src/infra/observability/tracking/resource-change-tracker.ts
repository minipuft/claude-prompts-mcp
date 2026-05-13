// @lifecycle canonical - Tracks resource changes with source attribution and audit logging
/**
 * Resource Change Tracker Module
 * Provides content hashing, change logging, and startup baseline comparison
 * for prompts and gates resources.
 *
 * Architecture:
 * ┌─────────────────┐    ┌─────────────────┐
 * │  HotReloadMgr   │    │ resource_manager│
 * │  (filesystem)   │    │   (mcp-tool)    │
 * └────────┬────────┘    └────────┬────────┘
 *          │                      │
 *          └──────────┬───────────┘
 *                     ↓
 *          ┌─────────────────────┐
 *          │ ResourceChangeTracker│
 *          │  - logChange()      │
 *          │  - getChanges()     │
 *          │  - compareBaseline()│
 *          └─────────┬───────────┘
 *                    ↓
 *     ┌──────────────┴──────────────┐
 *     │                             │
 *     ↓                             ↓
 * resource_changes (SQLite)  kv_state[key='resource_hashes']
 * (structured log)           (hash cache blob)
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';

import { SqliteEngine } from '../../database/sqlite-engine.js';
import { SqliteStateStore } from '../../database/stores/sqlite-store.js';
import { Logger } from '../../logging/index.js';

import type { ChangeSource, TrackedResourceType } from '../../../shared/types/index.js';

export type { ChangeSource, TrackedResourceType } from '../../../shared/types/index.js';

/**
 * Type of change operation
 */
export type ChangeOperation = 'added' | 'modified' | 'removed';

/**
 * Individual change entry in the log
 */
export interface ResourceChangeEntry {
  timestamp: string;
  source: ChangeSource;
  operation: ChangeOperation;
  resourceType: TrackedResourceType;
  resourceId: string;
  filePath: string;
  contentHash: string;
  previousHash?: string;
}

/**
 * Parameters for logging a change
 */
export interface LogChangeParams {
  source: ChangeSource;
  operation: ChangeOperation;
  resourceType: TrackedResourceType;
  resourceId: string;
  filePath: string;
  content?: string;
}

/**
 * Query parameters for retrieving changes
 */
export interface GetChangesParams {
  limit?: number;
  source?: ChangeSource;
  resourceType?: TrackedResourceType;
  since?: string;
  resourceId?: string;
}

/**
 * Configuration for the tracker
 */
export interface ResourceChangeTrackerConfig {
  /** Maximum entries to retain (default: 1000) */
  maxEntries: number;
  /** Server root directory (for SqliteEngine singleton) */
  serverRoot: string;
  /** Whether to track prompts */
  trackPrompts: boolean;
  /** Whether to track gates */
  trackGates: boolean;
}

const DEFAULT_CONFIG: ResourceChangeTrackerConfig = {
  maxEntries: 1000,
  serverRoot: '',
  trackPrompts: true,
  trackGates: true,
};

/**
 * ResourceChangeTracker class
 * Provides audit logging and hash tracking for resource changes via SQLite
 */
export class ResourceChangeTracker {
  private logger: Logger;
  private config: ResourceChangeTrackerConfig;
  private hashCache: Map<string, string> = new Map();
  private dbManager?: SqliteEngine;
  private hashStore?: SqliteStateStore<Record<string, string>>;
  private initialized: boolean = false;

  constructor(logger: Logger, config: Partial<ResourceChangeTrackerConfig> = {}) {
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.serverRoot === '') {
      throw new Error('ResourceChangeTracker requires serverRoot configuration');
    }
  }

  /**
   * Initialize the tracker by loading existing state from SQLite
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.debug('ResourceChangeTracker: Initializing...');

    // Initialize SqliteEngine and hash store (idempotent — no-op if already initialized)
    this.dbManager = await SqliteEngine.getInstance(this.config.serverRoot, this.logger);
    await this.dbManager.initialize();

    this.hashStore = new SqliteStateStore<Record<string, string>>(
      this.dbManager,
      {
        tableName: 'kv_state',
        key: 'resource_hashes',
        stateColumn: 'state',
        defaultState: () => ({}),
      },
      this.logger
    );

    // Load hash cache from SQLite
    await this.loadHashCache();

    this.initialized = true;
    this.logger.info('✅ ResourceChangeTracker initialized');
  }

  /**
   * Load hash cache from SQLite
   */
  private async loadHashCache(): Promise<void> {
    try {
      const cached = await this.hashStore!.load();
      this.hashCache = new Map(Object.entries(cached));
      this.logger.debug(`ResourceChangeTracker: Loaded ${this.hashCache.size} cached hashes`);
    } catch (error) {
      this.logger.warn('ResourceChangeTracker: Failed to load hash cache', error);
      this.hashCache = new Map();
    }
  }

  /**
   * Save hash cache to SQLite
   */
  private async saveHashCache(): Promise<void> {
    const data = Object.fromEntries(this.hashCache);
    await this.hashStore!.save(data);
  }

  /**
   * Compute SHA-256 hash of content
   */
  private computeHash(content: string): string {
    return `sha256:${crypto.createHash('sha256').update(content, 'utf-8').digest('hex')}`;
  }

  /**
   * Get cache key for a resource
   */
  private getCacheKey(resourceType: TrackedResourceType, resourceId: string): string {
    return `${resourceType}/${resourceId}`;
  }

  /**
   * Log a resource change
   */
  async logChange(params: LogChangeParams): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check if we should track this resource type
    if (params.resourceType === 'prompt' && !this.config.trackPrompts) {
      return;
    }
    if (params.resourceType === 'gate' && !this.config.trackGates) {
      return;
    }

    const cacheKey = this.getCacheKey(params.resourceType, params.resourceId);
    const previousHash = this.hashCache.get(cacheKey);

    // Compute hash from content or file
    let contentHash: string;
    if (params.content !== undefined && params.content !== '') {
      contentHash = this.computeHash(params.content);
    } else if (params.operation !== 'removed') {
      try {
        const fileContent = await fs.readFile(params.filePath, 'utf-8');
        contentHash = this.computeHash(fileContent);
      } catch {
        this.logger.warn(`ResourceChangeTracker: Cannot read file for hashing: ${params.filePath}`);
        contentHash = 'sha256:unknown';
      }
    } else {
      contentHash = 'sha256:removed';
    }

    // Skip if hash unchanged (no actual change)
    if (params.operation === 'modified' && previousHash === contentHash) {
      this.logger.debug(`ResourceChangeTracker: Skipping unchanged resource ${params.resourceId}`);
      return;
    }

    // Update in-memory cache
    if (params.operation === 'removed') {
      this.hashCache.delete(cacheKey);
    } else {
      this.hashCache.set(cacheKey, contentHash);
    }

    // INSERT change into resource_changes table
    const timestamp = new Date().toISOString();
    this.dbManager!.run(
      `INSERT INTO resource_changes (tenant_id, timestamp, source, operation, resource_type, resource_id, file_path, content_hash, previous_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'default',
        timestamp,
        params.source,
        params.operation,
        params.resourceType,
        params.resourceId,
        params.filePath,
        contentHash,
        previousHash !== undefined && previousHash !== contentHash ? previousHash : null,
      ]
    );

    // Persist hash cache
    await this.saveHashCache();

    // Rotate log if needed
    this.rotateLogIfNeeded();

    this.logger.info(
      `📝 ResourceChangeTracker: ${params.operation} ${params.resourceType}/${params.resourceId} (source: ${params.source})`
    );
  }

  /**
   * Rotate log if it exceeds maxEntries (SQL DELETE)
   */
  private rotateLogIfNeeded(): void {
    try {
      const countResult = this.dbManager!.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM resource_changes'
      );
      const count = countResult?.cnt ?? 0;

      if (count > this.config.maxEntries) {
        this.dbManager!.run(
          `DELETE FROM resource_changes WHERE id NOT IN (
            SELECT id FROM resource_changes ORDER BY id DESC LIMIT ?
          )`,
          [this.config.maxEntries]
        );
        this.logger.debug(
          `ResourceChangeTracker: Rotated log from ${count} to ${this.config.maxEntries} entries`
        );
      }
    } catch (error) {
      this.logger.warn('ResourceChangeTracker: Failed to rotate log', error);
    }
  }

  /**
   * Get changes from the log with optional filtering
   */
  async getChanges(params: GetChangesParams = {}): Promise<ResourceChangeEntry[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const { limit = 50, source, resourceType, since, resourceId } = params;

    // Build query dynamically based on filters
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (source !== undefined) {
      conditions.push('source = ?');
      values.push(source);
    }
    if (resourceType !== undefined) {
      conditions.push('resource_type = ?');
      values.push(resourceType);
    }
    if (resourceId !== undefined && resourceId !== '') {
      conditions.push('resource_id = ?');
      values.push(resourceId);
    }
    if (since !== undefined && since !== '') {
      conditions.push('timestamp >= ?');
      values.push(since);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit);

    const rows = this.dbManager!.query<{
      timestamp: string;
      source: string;
      operation: string;
      resource_type: string;
      resource_id: string;
      file_path: string;
      content_hash: string;
      previous_hash: string | null;
    }>(
      `SELECT timestamp, source, operation, resource_type, resource_id, file_path, content_hash, previous_hash
       FROM resource_changes ${whereClause}
       ORDER BY id DESC LIMIT ?`,
      values
    );

    return rows.map((row) => ({
      timestamp: row.timestamp,
      source: row.source as ChangeSource,
      operation: row.operation as ChangeOperation,
      resourceType: row.resource_type as TrackedResourceType,
      resourceId: row.resource_id,
      filePath: row.file_path,
      contentHash: row.content_hash,
      ...(row.previous_hash ? { previousHash: row.previous_hash } : {}),
    }));
  }

  /**
   * Compare current resources against cached baseline and log external changes
   * Called at startup to detect changes made while server was down
   */
  async compareBaseline(
    resources: Array<{
      resourceType: TrackedResourceType;
      resourceId: string;
      filePath: string;
    }>
  ): Promise<{ added: number; modified: number; removed: number }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const result = { added: 0, modified: 0, removed: 0 };
    const currentKeys = new Set<string>();

    for (const resource of resources) {
      const cacheKey = this.getCacheKey(resource.resourceType, resource.resourceId);
      currentKeys.add(cacheKey);

      try {
        const content = await fs.readFile(resource.filePath, 'utf-8');
        const currentHash = this.computeHash(content);
        const cachedHash = this.hashCache.get(cacheKey);

        if (cachedHash === undefined) {
          // New resource added externally
          await this.logChange({
            source: 'external',
            operation: 'added',
            resourceType: resource.resourceType,
            resourceId: resource.resourceId,
            filePath: resource.filePath,
            content,
          });
          result.added++;
        } else if (cachedHash !== currentHash) {
          // Resource modified externally
          await this.logChange({
            source: 'external',
            operation: 'modified',
            resourceType: resource.resourceType,
            resourceId: resource.resourceId,
            filePath: resource.filePath,
            content,
          });
          result.modified++;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(
            `ResourceChangeTracker: Error reading resource ${resource.resourceId}`,
            error
          );
        }
      }
    }

    // Check for removed resources
    for (const [cacheKey, _hash] of this.hashCache) {
      if (!currentKeys.has(cacheKey)) {
        const [resourceType, resourceId] = cacheKey.split('/') as [TrackedResourceType, string];
        await this.logChange({
          source: 'external',
          operation: 'removed',
          resourceType,
          resourceId,
          filePath: `(removed: ${cacheKey})`,
        });
        result.removed++;
      }
    }

    if (result.added > 0 || result.modified > 0 || result.removed > 0) {
      this.logger.info(
        `📊 ResourceChangeTracker: Baseline comparison - ` +
          `${result.added} added, ${result.modified} modified, ${result.removed} removed (external)`
      );
    }

    return result;
  }

  /**
   * Get the current hash for a resource
   */
  getResourceHash(resourceType: TrackedResourceType, resourceId: string): string | undefined {
    const cacheKey = this.getCacheKey(resourceType, resourceId);
    return this.hashCache.get(cacheKey);
  }

  /**
   * Get all cached hashes
   */
  getAllHashes(): Map<string, string> {
    return new Map(this.hashCache);
  }

  /**
   * Get tracker statistics
   */
  async getStats(): Promise<{
    cachedHashes: number;
    totalChanges: number;
  }> {
    let totalChanges = 0;
    try {
      const result = this.dbManager?.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM resource_changes'
      );
      totalChanges = result?.cnt ?? 0;
    } catch {
      // Table may not exist yet
    }

    return {
      cachedHashes: this.hashCache.size,
      totalChanges,
    };
  }

  /**
   * Clear all tracking data (for testing or reset)
   */
  async clear(): Promise<void> {
    this.hashCache.clear();

    if (this.dbManager) {
      this.dbManager.run('DELETE FROM resource_changes');
      await this.hashStore!.save({});
    }

    this.logger.info('ResourceChangeTracker: All tracking data cleared');
  }
}

/**
 * Factory function to create a ResourceChangeTracker instance
 */
export function createResourceChangeTracker(
  logger: Logger,
  config: Partial<ResourceChangeTrackerConfig> = {}
): ResourceChangeTracker {
  return new ResourceChangeTracker(logger, config);
}
