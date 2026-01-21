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
 * resource-changes.jsonl    resource-hashes.json
 * (append-only log)         (hash cache)
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Logger } from '../logging/index.js';

/**
 * Source of the resource change
 */
export type ChangeSource = 'filesystem' | 'mcp-tool' | 'external';

/**
 * Type of change operation
 */
export type ChangeOperation = 'added' | 'modified' | 'removed';

/**
 * Type of resource being tracked
 */
export type TrackedResourceType = 'prompt' | 'gate';

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
  /** Directory for runtime state files */
  runtimeStateDir: string;
  /** Whether to track prompts */
  trackPrompts: boolean;
  /** Whether to track gates */
  trackGates: boolean;
}

const DEFAULT_CONFIG: ResourceChangeTrackerConfig = {
  maxEntries: 1000,
  runtimeStateDir: '',
  trackPrompts: true,
  trackGates: true,
};

/**
 * ResourceChangeTracker class
 * Provides audit logging and hash tracking for resource changes
 */
export class ResourceChangeTracker {
  private logger: Logger;
  private config: ResourceChangeTrackerConfig;
  private hashCache: Map<string, string> = new Map();
  private changesFilePath: string;
  private hashCacheFilePath: string;
  private initialized: boolean = false;

  constructor(logger: Logger, config: Partial<ResourceChangeTrackerConfig> = {}) {
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.runtimeStateDir === '') {
      throw new Error('ResourceChangeTracker requires runtimeStateDir configuration');
    }

    this.changesFilePath = path.join(this.config.runtimeStateDir, 'resource-changes.jsonl');
    this.hashCacheFilePath = path.join(this.config.runtimeStateDir, 'resource-hashes.json');
  }

  /**
   * Initialize the tracker by loading existing state
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.debug('ResourceChangeTracker: Initializing...');

    // Ensure runtime state directory exists
    await fs.mkdir(this.config.runtimeStateDir, { recursive: true });

    // Load hash cache
    await this.loadHashCache();

    this.initialized = true;
    this.logger.info('✅ ResourceChangeTracker initialized');
  }

  /**
   * Load hash cache from disk
   */
  private async loadHashCache(): Promise<void> {
    try {
      const data = await fs.readFile(this.hashCacheFilePath, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, string>;
      this.hashCache = new Map(Object.entries(parsed));
      this.logger.debug(`ResourceChangeTracker: Loaded ${this.hashCache.size} cached hashes`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('ResourceChangeTracker: Failed to load hash cache', error);
      }
      // File doesn't exist or is invalid - start fresh
      this.hashCache = new Map();
    }
  }

  /**
   * Save hash cache to disk
   */
  private async saveHashCache(): Promise<void> {
    const data = Object.fromEntries(this.hashCache);
    await fs.writeFile(this.hashCacheFilePath, JSON.stringify(data, null, 2), 'utf-8');
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

    const entry: ResourceChangeEntry = {
      timestamp: new Date().toISOString(),
      source: params.source,
      operation: params.operation,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      filePath: params.filePath,
      contentHash,
      ...(previousHash !== undefined && previousHash !== contentHash ? { previousHash } : {}),
    };

    // Update cache
    if (params.operation === 'removed') {
      this.hashCache.delete(cacheKey);
    } else {
      this.hashCache.set(cacheKey, contentHash);
    }

    // Append to log file (JSONL format)
    const logLine = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.changesFilePath, logLine, 'utf-8');

    // Persist hash cache
    await this.saveHashCache();

    // Rotate log if needed
    await this.rotateLogIfNeeded();

    this.logger.info(
      `📝 ResourceChangeTracker: ${params.operation} ${params.resourceType}/${params.resourceId} (source: ${params.source})`
    );
  }

  /**
   * Rotate log file if it exceeds maxEntries
   */
  private async rotateLogIfNeeded(): Promise<void> {
    try {
      const content = await fs.readFile(this.changesFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      if (lines.length > this.config.maxEntries) {
        // Keep only the most recent entries
        const trimmedLines = lines.slice(-this.config.maxEntries);
        await fs.writeFile(this.changesFilePath, trimmedLines.join('\n') + '\n', 'utf-8');
        this.logger.debug(
          `ResourceChangeTracker: Rotated log from ${lines.length} to ${trimmedLines.length} entries`
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('ResourceChangeTracker: Failed to rotate log', error);
      }
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

    try {
      const content = await fs.readFile(this.changesFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      let entries: ResourceChangeEntry[] = lines
        .map((line) => {
          try {
            return JSON.parse(line) as ResourceChangeEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is ResourceChangeEntry => entry !== null);

      // Apply filters
      if (source !== undefined) {
        entries = entries.filter((e) => e.source === source);
      }
      if (resourceType !== undefined) {
        entries = entries.filter((e) => e.resourceType === resourceType);
      }
      if (resourceId !== undefined && resourceId !== '') {
        entries = entries.filter((e) => e.resourceId === resourceId);
      }
      if (since !== undefined && since !== '') {
        const sinceDate = new Date(since);
        entries = entries.filter((e) => new Date(e.timestamp) >= sinceDate);
      }

      // Return most recent entries first, limited
      return entries.reverse().slice(0, limit);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
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
    changesFilePath: string;
    hashCacheFilePath: string;
  }> {
    let totalChanges = 0;
    try {
      const content = await fs.readFile(this.changesFilePath, 'utf-8');
      totalChanges = content.trim().split('\n').filter(Boolean).length;
    } catch {
      // File doesn't exist
    }

    return {
      cachedHashes: this.hashCache.size,
      totalChanges,
      changesFilePath: this.changesFilePath,
      hashCacheFilePath: this.hashCacheFilePath,
    };
  }

  /**
   * Clear all tracking data (for testing or reset)
   */
  async clear(): Promise<void> {
    this.hashCache.clear();
    try {
      await fs.unlink(this.changesFilePath);
    } catch {
      // File may not exist
    }
    try {
      await fs.unlink(this.hashCacheFilePath);
    } catch {
      // File may not exist
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
