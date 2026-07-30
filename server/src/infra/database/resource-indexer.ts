// @lifecycle canonical - Syncs file-based resources to SQLite index.
/**
 * Resource Indexer
 *
 * Synchronizes file-based resources (prompts, gates, frameworks, styles, tools)
 * to the SQLite resource_index table for queryable lookups.
 *
 * Architecture:
 * ```
 * YAML/MD Files                SQLite resource_index
 * ┌──────────────┐    sync    ┌───────────────────────┐
 * │ prompts/     │ ────────▶  │ id, type, name,       │
 * │ gates/       │            │ category, description,│
 * │ frameworks│            │ content_hash,         │
 * │ styles/      │            │ file_path,            │
 * │ tools (nested)│           │ metadata_json,        │
 * └──────────────┘            │ keywords, indexed_at  │
 *                             └───────────────────────┘
 * ```
 *
 * Key Features:
 * - Incremental sync via content hash comparison
 * - Detects additions, modifications, and removals
 * - Supports full and partial reindex
 * - Tenant-aware for multi-tenant deployments
 * - Tool indexing: discovers script tools nested in prompt directories
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import yaml from 'js-yaml';

/** Injected tool loader — avoids direct import from modules layer. */
export type ToolLoaderFn = (promptDir: string, promptId: string) => LoadedScriptTool[];
import { computeContentHash } from '../../shared/utils/hash.js';

import type { JSONSchemaDefinition, LoadedScriptTool } from '../../shared/types/automation.js';
import type { DatabasePort, ToolIndexEntry } from '../../shared/types/persistence.js';
import type { Logger } from '../logging/index.js';

/**
 * Resource types supported by the indexer
 */
export type IndexedResourceType = 'prompt' | 'gate' | 'framework' | 'style' | 'tool';

/**
 * Indexed resource entry from SQLite
 */
export interface IndexedResource {
  id: string;
  type: IndexedResourceType;
  name: string | null;
  category: string | null;
  description: string | null;
  content_hash: string | null;
  file_path: string | null;
  metadata_json: string | null;
  keywords: string | null;
  indexed_at: string;
}

// ToolIndexEntry SSOT is in shared/types/persistence.ts (cross-layer contract).

export type { ToolIndexEntry } from '../../shared/types/persistence.js';

/**
 * Sync result statistics
 */
export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  unchanged: number;
  errors: number;
}

// Stop words for keyword extraction
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'can',
  'need',
  'dare',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'and',
  'but',
  'if',
  'or',
  'because',
  'until',
  'while',
  'this',
  'that',
  'these',
  'those',
  'what',
  'which',
  'who',
  'whom',
]);

/**
 * Extract meaningful keywords from text, filtering stop words.
 */
function extractKeywords(text: string, maxWords = 15): string[] {
  if (!text) return [];
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (!STOP_WORDS.has(word) && !seen.has(word)) {
      seen.add(word);
      unique.push(word);
    }
  }
  return unique.slice(0, maxWords);
}

/**
 * Extract a space-separated keywords string from metadata for the keywords column.
 * Prompts use metadata.keywords, gates use metadata.triggers.
 */
function extractKeywordsString(metadata: Record<string, unknown> | null): string | null {
  if (metadata == null) return null;
  const keywords = metadata['keywords'] as string[] | undefined;
  if (keywords != null && keywords.length > 0) return keywords.join(' ');
  const triggers = metadata['triggers'] as string[] | undefined;
  if (triggers != null && triggers.length > 0) return triggers.join(' ');
  return null;
}

/**
 * Escape special regex characters in a string for safe use in RegExp constructor.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute relevance score for a resource against a search query.
 *
 * Field weights:
 *   id exact=10, name word=8, name prefix=5,
 *   keywords=4, description word=2, id substring=1
 */
/** Score a single token against resource fields. */
function scoreToken(token: string, name: string, keywords: string, desc: string): number {
  let score = 0;
  const escaped = escapeRegex(token);

  // Name: exact word boundary
  if (new RegExp(`\\b${escaped}\\b`).test(name)) {
    score += 8;
  } else if (new RegExp(`\\b${escaped}`).test(name)) {
    score += 5;
  }

  // Keywords match
  if (keywords.includes(token)) {
    score += 4;
  }

  // Description word match
  if (new RegExp(`\\b${escaped}\\b`).test(desc)) {
    score += 2;
  }

  return score;
}

function computeRelevanceScore(query: string, resource: IndexedResource): number {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);

  const id = (resource.id ?? '').toLowerCase();
  const name = (resource.name ?? '').toLowerCase();
  const desc = (resource.description ?? '').toLowerCase();
  const keywords = (resource.keywords ?? '').toLowerCase();

  // Exact ID match — highest priority
  let score = id === q ? 10 : id.includes(q) ? 1 : 0;

  for (const token of tokens) {
    score += scoreToken(token, name, keywords, desc);
  }

  return score;
}

/**
 * Build type-specific metadata from parsed YAML data.
 */
function buildMetadata(
  type: IndexedResourceType,
  data: Record<string, unknown>
): Record<string, unknown> | null {
  switch (type) {
    case 'prompt': {
      const chainSteps =
        (data['chainSteps'] as Array<{ promptId?: string; stepName?: string }>) ?? [];
      const isChain = chainSteps.length > 0;

      const rawArgs = (data['arguments'] as Array<Record<string, unknown>>) ?? [];
      const args = rawArgs
        .filter((arg) => arg['name'])
        .map((arg) => ({
          name: arg['name'] as string,
          type: (arg['type'] as string) || 'string',
          required: (arg['required'] as boolean) || false,
          description: ((arg['description'] as string) || '').slice(0, 100),
          default: (arg['defaultValue'] as string | null | undefined) ?? null,
          ...(arg['options'] ? { options: arg['options'] as string[] } : {}),
        }));

      const gateConfig = data['gateConfiguration'] as Record<string, unknown> | undefined;
      const gates = (gateConfig?.['include'] as string[]) ?? [];

      const name = (data['name'] as string) || '';
      const description = (data['description'] as string) || '';
      const keywords = extractKeywords(`${name} ${description}`);

      return {
        is_chain: isChain,
        chain_steps: chainSteps.length,
        ...(isChain && {
          chain_step_ids: chainSteps.map((s) => s.promptId ?? 'unknown'),
          chain_step_names: chainSteps.map((s) => s.stepName || s.promptId || 'Unknown'),
        }),
        arguments: args,
        gates,
        keywords,
      };
    }
    case 'gate': {
      const name = (data['name'] as string) || '';
      const description = (data['description'] as string) || '';
      return {
        type: (data['type'] as string) || 'validation',
        triggers: extractKeywords(`${name} ${description}`, 10),
      };
    }
    case 'framework':
    case 'style': {
      return {
        enabled: (data['enabled'] as boolean) ?? true,
      };
    }
    case 'tool': {
      // Tool metadata is pre-built by syncTools() and passed via data directly
      return data;
    }
    default:
      return null;
  }
}

/**
 * Configuration for the resource indexer
 */
export interface ResourceIndexerConfig {
  /** Path to the resources directory */
  resourcesDir: string;
  /** Whether to track prompts */
  trackPrompts?: boolean;
  /** Whether to track gates */
  trackGates?: boolean;
  /** Whether to track frameworks */
  trackMethodologies?: boolean;
  /** Whether to track styles */
  trackStyles?: boolean;
  /** Whether to track script tools (nested in prompts) */
  trackTools?: boolean;
  /** Injected tool loader for discovering script tools in prompt directories */
  toolLoader?: ToolLoaderFn;
}

/**
 * ResourceIndexer class
 *
 * Synchronizes file-based resources to SQLite for queryable lookups.
 */
export class ResourceIndexer {
  private readonly db: DatabasePort;
  private readonly logger: Logger;
  private readonly config: Required<Omit<ResourceIndexerConfig, 'toolLoader'>>;
  private readonly toolLoader?: ToolLoaderFn;

  constructor(db: DatabasePort, logger: Logger, config: ResourceIndexerConfig) {
    this.db = db;
    this.logger = logger;
    this.toolLoader = config.toolLoader;
    this.config = {
      resourcesDir: config.resourcesDir,
      trackPrompts: config.trackPrompts ?? true,
      trackGates: config.trackGates ?? true,
      trackMethodologies: config.trackMethodologies ?? true,
      trackStyles: config.trackStyles ?? true,
      trackTools: config.trackTools ?? true,
    };
  }

  /**
   * Perform a full sync of all resource types
   */
  async syncAll(): Promise<SyncResult> {
    const result: SyncResult = {
      added: 0,
      modified: 0,
      removed: 0,
      unchanged: 0,
      errors: 0,
    };

    const types: Array<{ type: IndexedResourceType; enabled: boolean; subdir: string }> = [
      { type: 'prompt', enabled: this.config.trackPrompts, subdir: 'prompts' },
      { type: 'gate', enabled: this.config.trackGates, subdir: 'gates' },
      { type: 'framework', enabled: this.config.trackMethodologies, subdir: 'frameworks' },
      { type: 'style', enabled: this.config.trackStyles, subdir: 'styles' },
    ];

    for (const { type, enabled, subdir } of types) {
      if (!enabled) continue;

      try {
        const typeResult = await this.syncResourceType(type, subdir);
        result.added += typeResult.added;
        result.modified += typeResult.modified;
        result.removed += typeResult.removed;
        result.unchanged += typeResult.unchanged;
        result.errors += typeResult.errors;
      } catch (error) {
        this.logger.error(`ResourceIndexer: Failed to sync ${type}s:`, error);
        result.errors++;
      }
    }

    // Sync tools after all resource types (tools depend on prompt entries)
    if (this.config.trackTools) {
      try {
        const toolResult = await this.syncTools();
        result.added += toolResult.added;
        result.modified += toolResult.modified;
        result.removed += toolResult.removed;
        result.unchanged += toolResult.unchanged;
        result.errors += toolResult.errors;
      } catch (error) {
        this.logger.error('ResourceIndexer: Failed to sync tools:', error);
        result.errors++;
      }
    }

    this.logger.info(
      `ResourceIndexer: Sync complete - ${result.added} added, ` +
        `${result.modified} modified, ${result.removed} removed, ` +
        `${result.unchanged} unchanged, ${result.errors} errors`
    );

    return result;
  }

  /**
   * Sync a specific resource type
   */
  async syncResourceType(type: IndexedResourceType, subdir: string): Promise<SyncResult> {
    const result: SyncResult = {
      added: 0,
      modified: 0,
      removed: 0,
      unchanged: 0,
      errors: 0,
    };

    const resourceDir = path.join(this.config.resourcesDir, subdir);

    // Get current indexed resources of this type
    const indexed = new Map<string, IndexedResource>();
    const rows = this.db.query<IndexedResource>('SELECT * FROM resource_index WHERE type = ?', [
      type,
    ]);
    for (const row of rows) {
      indexed.set(row.id, row);
    }

    // Scan filesystem for current resources
    const current = new Map<string, { filePath: string; content: string }>();
    try {
      await this.scanResources(resourceDir, type, current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // Directory doesn't exist - all indexed resources should be removed
    }

    // Process additions and modifications
    for (const [id, { filePath, content }] of current) {
      try {
        const contentHash = computeContentHash([content]);
        const existing = indexed.get(id);

        if (!existing) {
          // New resource
          await this.indexResource(type, id, filePath, content, contentHash);
          result.added++;
        } else if (existing.content_hash !== contentHash || !existing.metadata_json) {
          // Modified resource, or backfill metadata_json for existing rows
          await this.updateResource(type, id, filePath, content, contentHash);
          result.modified++;
        } else {
          // Unchanged
          result.unchanged++;
        }

        indexed.delete(id); // Mark as processed
      } catch (error) {
        this.logger.warn(`ResourceIndexer: Error processing ${type}/${id}:`, error);
        result.errors++;
      }
    }

    // Process removals (remaining indexed resources not in filesystem)
    for (const [id] of indexed) {
      try {
        await this.removeResource(type, id);
        result.removed++;
      } catch (error) {
        this.logger.warn(`ResourceIndexer: Error removing ${type}/${id}:`, error);
        result.errors++;
      }
    }

    return result;
  }

  /**
   * Scan a directory for resources.
   * Handles both flat layouts (gates/{id}/gate.yaml) and nested
   * category layouts (prompts/{category}/{id}/prompt.yaml).
   */
  private async scanResources(
    dir: string,
    type: IndexedResourceType,
    results: Map<string, { filePath: string; content: string }>
  ): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const yamlFile = this.getYamlFileName(type);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const subDir = path.join(dir, entry.name);
      const yamlPath = path.join(subDir, yamlFile);

      try {
        // Try flat layout: {type}/{id}/{type}.yaml
        const content = await fs.readFile(yamlPath, 'utf-8');
        const data = yaml.load(content) as Record<string, unknown>;
        const id = (data?.['id'] as string) ?? entry.name;
        results.set(id, { filePath: yamlPath, content });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // YAML not found at this level — try nested category layout
          await this.scanCategoryDir(subDir, yamlFile, results);
        } else {
          this.logger.debug(`ResourceIndexer: Skipping ${subDir}: ${error}`);
        }
      }
    }
  }

  /**
   * Scan a category subdirectory for resources one level deeper.
   * Called when the flat scan doesn't find a YAML file (e.g., prompts/{category}/).
   */
  private async scanCategoryDir(
    categoryDir: string,
    yamlFile: string,
    results: Map<string, { filePath: string; content: string }>
  ): Promise<void> {
    let subEntries;
    try {
      subEntries = await fs.readdir(categoryDir, { withFileTypes: true });
    } catch {
      return; // Category dir doesn't exist or isn't readable
    }

    for (const sub of subEntries) {
      if (!sub.isDirectory()) continue;

      const yamlPath = path.join(categoryDir, sub.name, yamlFile);
      try {
        const content = await fs.readFile(yamlPath, 'utf-8');
        const data = yaml.load(content) as Record<string, unknown>;
        const id = (data?.['id'] as string) ?? sub.name;
        results.set(id, { filePath: yamlPath, content });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.debug(`ResourceIndexer: Skipping ${categoryDir}/${sub.name}: ${error}`);
        }
      }
    }
  }

  /**
   * Get the YAML file name for a resource type
   */
  private getYamlFileName(type: IndexedResourceType): string {
    switch (type) {
      case 'prompt':
        return 'prompt.yaml';
      case 'gate':
        return 'gate.yaml';
      case 'framework':
        return 'framework.yaml';
      case 'style':
        return 'style.yaml';
      default:
        return `${type}.yaml`;
    }
  }

  /**
   * Index a new resource
   */
  private async indexResource(
    type: IndexedResourceType,
    id: string,
    filePath: string,
    content: string,
    contentHash: string
  ): Promise<void> {
    const data = yaml.load(content) as Record<string, unknown>;

    const name = (data?.['name'] as string) ?? null;
    const category = (data?.['category'] as string) ?? null;
    const description = ((data?.['description'] as string) ?? '').slice(0, 500);
    const metadata = buildMetadata(type, data ?? {});
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    const keywordsStr = extractKeywordsString(metadata);

    this.db.run(
      `INSERT INTO resource_index (id, type, name, category, description, content_hash, file_path, metadata_json, keywords)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, type, name, category, description, contentHash, filePath, metadataJson, keywordsStr]
    );

    this.logger.debug(`ResourceIndexer: Indexed ${type}/${id}`);
  }

  /**
   * Update an existing resource
   */
  private async updateResource(
    type: IndexedResourceType,
    id: string,
    filePath: string,
    content: string,
    contentHash: string
  ): Promise<void> {
    const data = yaml.load(content) as Record<string, unknown>;

    const name = (data?.['name'] as string) ?? null;
    const category = (data?.['category'] as string) ?? null;
    const description = ((data?.['description'] as string) ?? '').slice(0, 500);
    const metadata = buildMetadata(type, data ?? {});
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    const keywordsStr = extractKeywordsString(metadata);

    this.db.run(
      `UPDATE resource_index
       SET name = ?, category = ?, description = ?, content_hash = ?,
           file_path = ?, metadata_json = ?, keywords = ?, indexed_at = datetime('now')
       WHERE id = ? AND type = ?`,
      [name, category, description, contentHash, filePath, metadataJson, keywordsStr, id, type]
    );

    this.logger.debug(`ResourceIndexer: Updated ${type}/${id}`);
  }

  /**
   * Remove a resource from the index
   */
  private async removeResource(type: IndexedResourceType, id: string): Promise<void> {
    this.db.run('DELETE FROM resource_index WHERE id = ? AND type = ?', [id, type]);
    this.logger.debug(`ResourceIndexer: Removed ${type}/${id}`);
  }

  /**
   * Query resources by type
   */
  queryByType(type: IndexedResourceType): IndexedResource[] {
    return this.db.query<IndexedResource>(
      'SELECT * FROM resource_index WHERE type = ? ORDER BY id',
      [type]
    );
  }

  /**
   * Query resources by category
   */
  queryByCategory(type: IndexedResourceType, category: string): IndexedResource[] {
    return this.db.query<IndexedResource>(
      'SELECT * FROM resource_index WHERE type = ? AND category = ? ORDER BY id',
      [type, category]
    );
  }

  /**
   * Search resources with relevance-ranked results.
   *
   * Uses SQL LIKE for candidate retrieval then application-level scoring
   * with weighted field matching (name > keywords > description > id).
   */
  search(query: string, type?: IndexedResourceType): IndexedResource[] {
    const candidates = this.fetchCandidates(query, type);

    const scored = candidates.map((r) => ({
      resource: r,
      score: computeRelevanceScore(query, r),
    }));

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.resource);
  }

  /**
   * Fetch broad candidate set via SQL LIKE matching.
   * Splits multi-token queries into per-token OR conditions
   * so each word is matched independently (scoring handles ranking).
   */
  private fetchCandidates(query: string, type?: IndexedResourceType): IndexedResource[] {
    const tokens = query
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .map((t) => `%${t}%`);

    // Fallback: use full query as single pattern when no valid tokens
    if (tokens.length === 0) {
      tokens.push(`%${query}%`);
    }

    // Build OR clause: each token matched against any field
    const tokenClauses = tokens.map(
      () => '(name LIKE ? OR description LIKE ? OR id LIKE ? OR keywords LIKE ?)'
    );
    const whereTokens = tokenClauses.join(' OR ');
    const params = tokens.flatMap((t) => [t, t, t, t]);

    if (type != null) {
      return this.db.query<IndexedResource>(
        `SELECT DISTINCT * FROM resource_index WHERE type = ? AND (${whereTokens})`,
        [type, ...params]
      );
    }

    return this.db.query<IndexedResource>(
      `SELECT DISTINCT * FROM resource_index WHERE ${whereTokens}`,
      params
    );
  }

  /**
   * Get a specific resource by ID and type
   */
  getResource(type: IndexedResourceType, id: string): IndexedResource | null {
    return this.db.queryOne<IndexedResource>(
      'SELECT * FROM resource_index WHERE type = ? AND id = ?',
      [type, id]
    );
  }

  /**
   * Get index statistics
   */
  getStats(): Record<IndexedResourceType, number> {
    const stats: Record<IndexedResourceType, number> = {
      prompt: 0,
      gate: 0,
      framework: 0,
      style: 0,
      tool: 0,
    };

    const rows = this.db.query<{ type: string; count: number }>(
      'SELECT type, COUNT(*) as count FROM resource_index GROUP BY type'
    );

    for (const row of rows) {
      if (row.type in stats) {
        stats[row.type as IndexedResourceType] = row.count;
      }
    }

    return stats;
  }

  /**
   * Get valid style IDs from the index.
   * Replaces directory-scanning _meta.valid_styles from cache files.
   */
  getValidStyles(): string[] {
    const rows = this.db.query<{ id: string }>(
      "SELECT id FROM resource_index WHERE type = 'style' ORDER BY id"
    );
    return rows.map((r) => r.id.toLowerCase());
  }

  /**
   * Get valid framework/methodology IDs from the index.
   * Replaces directory-scanning _meta.valid_frameworks from cache files.
   */
  getValidFrameworks(): string[] {
    const rows = this.db.query<{ id: string }>(
      "SELECT id FROM resource_index WHERE type = 'framework' ORDER BY id"
    );
    return rows.map((r) => r.id.toLowerCase());
  }

  /**
   * Sync script tools from prompt directories.
   *
   * Tools are nested inside prompts: prompts/{category}/{id}/tools/{toolId}/
   * Uses injected tool loader to discover and parse tool definitions.
   * Indexes each tool as type='tool' with composite id: `{promptId}/{toolId}`.
   */
  async syncTools(): Promise<SyncResult> {
    const result: SyncResult = { added: 0, modified: 0, removed: 0, unchanged: 0, errors: 0 };

    if (!this.toolLoader) {
      this.logger.debug('ResourceIndexer: Tool loader not provided, skipping tool sync');
      return result;
    }

    const indexed = new Map<string, IndexedResource>();
    const rows = this.db.query<IndexedResource>("SELECT * FROM resource_index WHERE type = 'tool'");
    for (const row of rows) indexed.set(row.id, row);

    const prompts = this.db.query<IndexedResource>(
      "SELECT * FROM resource_index WHERE type = 'prompt'"
    );
    const seen = new Set<string>();

    for (const prompt of prompts) {
      if (prompt.file_path == null) continue;
      const promptDir = path.dirname(prompt.file_path);
      const category = prompt.category ?? '';

      try {
        const tools = this.toolLoader(promptDir, prompt.id);
        for (const tool of tools) {
          const compositeId = `${prompt.id}/${tool.id}`;
          seen.add(compositeId);
          this.upsertToolEntry({
            compositeId,
            tool,
            category,
            promptId: prompt.id,
            indexed,
            result,
          });
        }
      } catch (error) {
        this.logger.debug(`ResourceIndexer: Error syncing tools for prompt ${prompt.id}:`, error);
        result.errors++;
      }
    }

    // Remove tools no longer on disk
    for (const [id] of indexed) {
      if (!seen.has(id)) {
        this.db.run("DELETE FROM resource_index WHERE id = ? AND type = 'tool'", [id]);
        result.removed++;
      }
    }

    this.logger.info(
      `ResourceIndexer: Tools sync - ${result.added} added, ${result.modified} modified, ` +
        `${result.removed} removed, ${result.unchanged} unchanged`
    );

    return result;
  }

  private upsertToolEntry(params: {
    compositeId: string;
    tool: LoadedScriptTool;
    category: string;
    promptId: string;
    indexed: Map<string, IndexedResource>;
    result: SyncResult;
  }): void {
    const { compositeId, tool, category, promptId, indexed, result } = params;
    const execution = tool.execution ?? { trigger: 'schema_match', confirm: true, strict: false };
    const toolMetadata: Record<string, unknown> = {
      prompt_id: promptId,
      runtime: tool.runtime ?? 'auto',
      input_schema: tool.inputSchema,
      execution: {
        trigger: execution.trigger,
        confirm: execution.confirm ?? true,
        strict: execution.strict ?? false,
        ...(tool.timeout !== undefined && { timeout: tool.timeout }),
      },
      ...(tool.env !== undefined && { env: tool.env }),
      script_path: tool.scriptPath,
      tool_dir: path.relative(this.config.resourcesDir, tool.toolDir),
    };

    const contentHash = computeContentHash([
      JSON.stringify(tool.inputSchema),
      JSON.stringify(tool.execution),
      tool.descriptionContent !== '' ? tool.descriptionContent : '',
      tool.scriptPath,
    ]);

    const existing = indexed.get(compositeId);
    const metadataJson = JSON.stringify(toolMetadata);
    const description = (tool.description !== '' ? tool.description : '').slice(0, 500);

    if (existing == null) {
      this.db.run(
        `INSERT INTO resource_index (id, type, name, category, description, content_hash, file_path, metadata_json, keywords)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          compositeId,
          'tool',
          tool.name,
          category,
          description,
          contentHash,
          tool.toolDir,
          metadataJson,
          null,
        ]
      );
      result.added++;
    } else if (existing.content_hash !== contentHash || existing.metadata_json == null) {
      this.db.run(
        `UPDATE resource_index
         SET name = ?, category = ?, description = ?, content_hash = ?,
             file_path = ?, metadata_json = ?, indexed_at = datetime('now')
         WHERE id = ? AND type = 'tool'`,
        [tool.name, category, description, contentHash, tool.toolDir, metadataJson, compositeId]
      );
      result.modified++;
    } else {
      result.unchanged++;
    }
  }

  /**
   * Query tools in the keyed Record format expected by skills-sync.
   * Returns Record<string, ToolIndexEntry> keyed by `{promptId}/{toolId}`.
   */
  queryTools(): Record<string, ToolIndexEntry> {
    const rows = this.queryByType('tool');
    const result: Record<string, ToolIndexEntry> = {};

    for (const row of rows) {
      if (!row.metadata_json) continue;

      try {
        const meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
        const execution = meta['execution'] as ToolIndexEntry['execution'] | undefined;

        result[row.id] = {
          id: row.id.includes('/') ? (row.id.split('/').pop() ?? row.id) : row.id,
          name: row.name ?? row.id,
          runtime: (meta['runtime'] as string) ?? 'auto',
          inputSchema: (meta['input_schema'] as JSONSchemaDefinition) ?? {},
          execution: execution ?? { trigger: 'schema_match', confirm: true, strict: false },
          ...(meta['env'] != null ? { env: meta['env'] as Record<string, string> } : {}),
          promptId: (meta['prompt_id'] as string) ?? '',
          category: row.category ?? '',
          description: row.description ?? '',
          toolDir: (meta['tool_dir'] as string) ?? '',
          scriptPath: (meta['script_path'] as string) ?? 'script.py',
          contentHash: row.content_hash ?? '',
        };
      } catch {
        this.logger.debug(`ResourceIndexer: Failed to parse tool metadata for ${row.id}`);
      }
    }

    return result;
  }

  /**
   * Clear all indexed resources (for testing or reset)
   */
  clear(): void {
    this.db.run('DELETE FROM resource_index');
    this.logger.info('ResourceIndexer: Cleared all indexed resources');
  }
}

/**
 * Factory function to create a ResourceIndexer instance
 */
export function createResourceIndexer(
  db: DatabasePort,
  logger: Logger,
  config: ResourceIndexerConfig
): ResourceIndexer {
  return new ResourceIndexer(db, logger, config);
}
