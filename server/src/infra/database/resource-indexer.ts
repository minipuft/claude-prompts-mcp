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

import * as yaml from 'js-yaml';

/** Injected tool loader — avoids direct import from modules layer. */
export type ToolLoaderFn = (promptDir: string, promptId: string) => ScriptToolLoadReport;

import type {
  JSONSchemaDefinition,
  LoadedScriptTool,
  ScriptToolLoadReport,
} from '#shared/types/automation.js';
import type { DatabasePort, ToolIndexEntry } from '#shared/types/persistence.js';
import type { Logger } from '../logging/index.js';

import { computeContentHash } from '#shared/utils/hash.js';

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

export type { ToolIndexEntry } from '#shared/types/persistence.js';

/**
 * How many directory levels below a resource root the scan descends.
 *
 * Three covers every shipped layout: `{category}/{chain}/{step}/` is the deepest, and a flat
 * layout uses one. It is a guard against a pathological tree, not a layout rule — a layout that
 * needs a fourth level should raise this deliberately rather than discover the limit by having
 * its resources go missing.
 */
const MAX_SCAN_DEPTH = 3;

/** One resource found on disk, with the category that completes its identity. */
interface ScannedResource {
  filePath: string;
  content: string;
  /**
   * Declared category, or the containing directory for a nested layout. `undefined` for a flat
   * layout (gates, frameworks, styles), where a repeated id is always a collision.
   */
  category: string | undefined;
}

/**
 * One resource that could not be synced, with the reason.
 *
 * The counters alone cannot distinguish a resource that failed from one that
 * legitimately went away — both used to read as `removed`.
 */
export interface SyncFailure {
  /** Resource type, or 'tool' for script tools nested under prompts */
  type: IndexedResourceType | 'tool';
  /** Resource id (composite `{promptId}/{toolId}` for tools) */
  id: string;
  /** Why this resource failed */
  reason: string;
}

/**
 * One id defined twice, and which definition the index kept.
 *
 * The index is keyed `(id, type)` with no category, so a second definition of an id overwrites
 * the first and the loser becomes unreachable through every id lookup — including the Python
 * hooks', which key their own dict by id. Silently, until now: 84 prompt files on disk indexed as
 * 78 rows with nothing logged (measured 2026-08-29).
 *
 * `sameCategory` separates the two causes, which need opposite responses. The loaders identify a
 * prompt by `category/id`, so two definitions sharing both are ONE resource and the higher-precedence
 * root is supposed to win — that is the documented overlay contract. Two definitions sharing only
 * the id are two different resources, and indexing one silently deletes the other from every
 * id lookup. Root is the wrong discriminator: measured 2026-08-29, 18 ids collided across the
 * workspace and bundled trees, and treating "different root" as benign would have filed all 18
 * as expected overlay behaviour.
 */
export interface ShadowedResource {
  type: IndexedResourceType;
  id: string;
  /** Path to the definition that is indexed and served. */
  winner: string;
  /** Path to the definition it hides. */
  shadowed: string;
  /** True when both definitions declare the same category — one resource, overridden by precedence. */
  sameCategory: boolean;
}

/**
 * Sync result statistics.
 *
 * `errors` is the count of `failures` — the two are maintained together by
 * `recordSyncFailure` so a caller cannot see a non-zero count with no detail.
 */
export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  unchanged: number;
  errors: number;
  failures: SyncFailure[];
  /** Ids that were defined more than once; see {@link ShadowedResource}. */
  shadowed: ShadowedResource[];
}

/** Empty result — the single place the shape is constructed. */
function emptySyncResult(): SyncResult {
  return {
    added: 0,
    modified: 0,
    removed: 0,
    unchanged: 0,
    errors: 0,
    failures: [],
    shadowed: [],
  };
}

/**
 * Log every duplicated id by path, at a severity matching its cause.
 *
 * Deliberately reports identity, not a count: "5 shadowed" tells a reader something is wrong and
 * nothing about which prompt they can no longer reach. The counts belong on the startup inventory
 * line; the paths belong here.
 */
export function reportShadowedResources(result: SyncResult, logger: Logger): void {
  const collisions = result.shadowed.filter((s) => !s.sameCategory);
  const overrides = result.shadowed.filter((s) => s.sameCategory);

  for (const { type, id, winner, shadowed } of collisions) {
    logger.warn(
      `ResourceIndexer: duplicate ${type} id '${id}' in two categories — indexed ${winner}, ` +
        `which leaves ${shadowed} unreachable by id. Rename one or merge them.`
    );
  }

  for (const { type, id, winner, shadowed } of overrides) {
    logger.debug(`ResourceIndexer: ${type} '${id}' from ${winner} overrides ${shadowed}`);
  }
}

/**
 * Log every per-item sync failure by id and reason.
 *
 * Deliberately non-throwing: a resource that fails to parse is a data defect,
 * and refusing to start the server over one bad file trades a named warning for
 * an outage. The caller keeps its own throw for a wholly-failed indexer.
 */
export function reportResourceSyncFailures(result: SyncResult, logger: Logger): void {
  if (result.failures.length === 0) {
    return;
  }

  logger.warn(
    `ResourceIndexer: ${result.failures.length} resource(s) failed to sync and are missing or stale in the index:`
  );
  for (const failure of result.failures) {
    logger.warn(`  ${failure.type} ${failure.id}: ${failure.reason}`);
  }
}

/** Record a failure and its count together, so the two cannot drift apart. */
function recordSyncFailure(
  result: SyncResult,
  type: SyncFailure['type'],
  id: string,
  error: unknown
): void {
  result.errors++;
  result.failures.push({
    type,
    id,
    reason: error instanceof Error ? error.message : String(error),
  });
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
        // Explicit rather than `||`: `data` is Record<string, unknown>, and the empty-string
        // fallback is intentional (an absent OR blank `type` indexes as 'validation'), which
        // `??` would not preserve.
        type: typeof data['type'] === 'string' && data['type'] ? data['type'] : 'validation',
        triggers: extractKeywords(`${name} ${description}`, 10),
      };
    }
    case 'framework':
    case 'style': {
      return {
        enabled: data['enabled'] ?? true,
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
/** Ordered roots per resource type, LOWEST precedence first. */
export type ResourceRootMap = Partial<Record<IndexedResourceType, string[]>>;

export interface ResourceIndexerConfig {
  /**
   * Path to the resources directory.
   *
   * The default source of roots (`{resourcesDir}/{subdir}` per type) and the anchor `tool_dir` is
   * reported relative to. On a deployment where resources come from more than one directory,
   * `resourceRoots` overrides the derivation and this stays the anchor.
   */
  resourcesDir: string;
  /**
   * Every directory contributing definitions, per type, LOWEST precedence first — a later root's
   * same-id resource overwrites an earlier one, matching the loaders.
   *
   * Without this the index is whatever a single directory holds, which stopped being the served
   * catalog the moment the loaders learned to overlay a workspace onto the bundled tree. The
   * index is what the Python hooks read, so the gap was not cosmetic: 39 bundled prompts were
   * loaded, executable, and absent from every hook's view of the world.
   */
  resourceRoots?: ResourceRootMap;
  /** Whether to track prompts */
  trackPrompts?: boolean;
  /** Whether to track gates */
  trackGates?: boolean;
  /** Whether to track frameworks */
  trackFrameworks?: boolean;
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
      resourceRoots: config.resourceRoots ?? {},
      trackPrompts: config.trackPrompts ?? true,
      trackGates: config.trackGates ?? true,
      trackFrameworks: config.trackFrameworks ?? true,
      trackStyles: config.trackStyles ?? true,
      trackTools: config.trackTools ?? true,
    };
  }

  /**
   * Perform a full sync of all resource types
   */
  async syncAll(): Promise<SyncResult> {
    const result = emptySyncResult();

    const types: Array<{ type: IndexedResourceType; enabled: boolean; subdir: string }> = [
      { type: 'prompt', enabled: this.config.trackPrompts, subdir: 'prompts' },
      { type: 'gate', enabled: this.config.trackGates, subdir: 'gates' },
      { type: 'framework', enabled: this.config.trackFrameworks, subdir: 'frameworks' },
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
        result.failures.push(...typeResult.failures);
        result.shadowed.push(...typeResult.shadowed);
      } catch (error) {
        this.logger.error(`ResourceIndexer: Failed to sync ${type}s:`, error);
        recordSyncFailure(result, type, `<all ${type}s>`, error);
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
        result.failures.push(...toolResult.failures);
        result.shadowed.push(...toolResult.shadowed);
      } catch (error) {
        this.logger.error('ResourceIndexer: Failed to sync tools:', error);
        recordSyncFailure(result, 'tool', '<all tools>', error);
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
    const result = emptySyncResult();

    // Get current indexed resources of this type
    const indexed = new Map<string, IndexedResource>();
    const rows = this.db.query<IndexedResource>('SELECT * FROM resource_index WHERE type = ?', [
      type,
    ]);
    for (const row of rows) {
      indexed.set(row.id, row);
    }

    const current = await this.scanAllRoots(type, subdir, result);

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
        recordSyncFailure(result, type, id, error);
      }
    }

    // Process removals (remaining indexed resources not in filesystem)
    for (const [id] of indexed) {
      try {
        await this.removeResource(type, id);
        result.removed++;
      } catch (error) {
        this.logger.warn(`ResourceIndexer: Error removing ${type}/${id}:`, error);
        recordSyncFailure(result, type, id, error);
      }
    }

    return result;
  }

  /**
   * Every resource of one type found across all its roots, lowest precedence first.
   *
   * A later root's same-id resource overwrites an earlier one and the loser is recorded as
   * shadowed — an overwrite is the overlay contract when the category matches and a defect when
   * it does not.
   */
  private async scanAllRoots(
    type: IndexedResourceType,
    subdir: string,
    result: SyncResult
  ): Promise<Map<string, ScannedResource>> {
    const current = new Map<string, ScannedResource>();
    for (const resourceDir of this.rootsFor(type, subdir)) {
      try {
        await this.scanResources(resourceDir, type, current, result);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
        // An absent root contributes nothing, which is not a failure — an ordinary install has no
        // workspace root at all. Only when NO root resolves does the map stay empty and the
        // removal sweep clear the type.
      }
    }
    return current;
  }

  /**
   * The directories contributing one resource type, LOWEST precedence first.
   *
   * Single resolution point: an explicit `resourceRoots` entry wins, otherwise the type's subdir
   * under `resourcesDir`. Two ways to configure, one way to answer.
   */
  private rootsFor(type: IndexedResourceType, subdir: string): string[] {
    const explicit = this.config.resourceRoots[type];
    if (explicit !== undefined && explicit.length > 0) return explicit;
    return [path.join(this.config.resourcesDir, subdir)];
  }

  /**
   * A tool directory expressed relative to whichever root contains it.
   *
   * Anchoring every tool to `resourcesDir` was correct while that was the only root. A tool under
   * the bundled tree would now render as a `../../..` walk out of the personal store — a path
   * that resolves nowhere useful and reads as corruption. An absolute path is the honest fallback
   * when no root contains it.
   */
  private relativeToolDir(toolDir: string): string {
    const roots = [this.config.resourcesDir, ...Object.values(this.config.resourceRoots).flat()];
    const containing = roots.filter((root) => !path.relative(root, toolDir).startsWith('..'));
    if (containing.length === 0) return toolDir;
    // Longest match: nested roots would otherwise yield a path relative to the outer one.
    const nearest = containing.reduce((a, b) => (b.length > a.length ? b : a));
    return path.relative(nearest, toolDir);
  }

  /**
   * Record one scanned resource, noting the definition it displaces.
   *
   * The map is id-keyed because the index is; this is where an overwrite stops being silent.
   */
  private recordScanned(
    type: IndexedResourceType,
    id: string,
    scanned: ScannedResource,
    results: Map<string, ScannedResource>,
    result: SyncResult
  ): void {
    const previous = results.get(id);
    if (previous !== undefined) {
      result.shadowed.push({
        type,
        id,
        winner: scanned.filePath,
        shadowed: previous.filePath,
        // Both `undefined` means a flat layout, where two definitions of an id are never one
        // resource — so an absent category must NOT read as a match.
        sameCategory: previous.category !== undefined && previous.category === scanned.category,
      });
    }
    results.set(id, scanned);
  }

  /**
   * Read one directory's resource definition, or `undefined` when it holds none.
   *
   * A missing YAML is the ordinary case for an intermediate directory and is not reported; a
   * malformed one is, because that resource silently leaves the catalog.
   */
  private async readResourceDir(
    dir: string,
    root: string,
    yamlFile: string
  ): Promise<{ id: string; scanned: ScannedResource } | undefined> {
    const yamlPath = path.join(dir, yamlFile);
    let content: string;
    try {
      content = await fs.readFile(yamlPath, 'utf-8');
    } catch {
      return undefined;
    }

    try {
      const data = yaml.load(content) as Record<string, unknown>;
      // The first segment below the root is the category in every nested layout; a resource
      // sitting directly under the root (flat layouts) has none.
      const segments = path.relative(root, dir).split(path.sep);
      const category =
        (data?.['category'] as string | undefined) ??
        (segments.length > 1 ? segments[0] : undefined);
      return {
        id: this.identityOf(segments, data),
        scanned: { filePath: yamlPath, content, category },
      };
    } catch (error) {
      this.logger.debug(`ResourceIndexer: Skipping ${yamlPath}: ${error}`);
      return undefined;
    }
  }

  /**
   * The id a resource is served under, derived the way its loader derives it.
   *
   * For prompts that is the path BELOW the category directory, slash-joined — a chain step at
   * `{category}/{chain}/{step}/` is served as `chain/step`, and `yaml-prompt-loader` overwrites
   * the file's own `id:` field to say so. Reading `id:` instead produced a different key for every
   * nested prompt: the index called the step `initial_scan` while `prompt_engine` answered only to
   * `deep_analysis/initial_scan`, so hooks reading the index handed out ids the tool rejects, and
   * two unrelated steps sharing a leaf name looked like a duplicate.
   *
   * Flat layouts (gates, frameworks, styles) have no category level and keep their declared `id`.
   */
  private identityOf(segments: string[], data: Record<string, unknown> | undefined): string {
    if (segments.length > 1) return segments.slice(1).join('/');
    return (data?.['id'] as string) ?? segments[0] ?? '';
  }

  /**
   * Scan one root for resources, descending until the layout runs out.
   *
   * Layouts vary in depth and nest inside each other: gates are `{root}/{id}/gate.yaml`, prompts
   * are `{root}/{category}/{id}/prompt.yaml`, and a chain's steps are another level down at
   * `{root}/{category}/{chain}/{step}/prompt.yaml` — while the chain directory holds its OWN
   * `prompt.yaml`. So finding a definition is not a reason to stop descending.
   *
   * The previous scan stopped at two levels, which is why 20 chain-step prompts were served by
   * the loaders and absent from the index (measured 2026-08-29). {@link MAX_SCAN_DEPTH} bounds
   * the walk rather than the layout doing it implicitly.
   */
  private async scanResources(
    dir: string,
    type: IndexedResourceType,
    results: Map<string, ScannedResource>,
    result: SyncResult,
    root: string = dir,
    depth: number = 0
  ): Promise<void> {
    // `readdir` on the root throws ENOENT, which the caller reads as "root contributes nothing".
    // Below the root a failure is a single unreadable directory, not an absent root.
    const entries =
      depth === 0
        ? await fs.readdir(dir, { withFileTypes: true })
        : await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const yamlFile = this.getYamlFileName(type);

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'tools') continue;

      const subDir = path.join(dir, entry.name);
      const found = await this.readResourceDir(subDir, root, yamlFile);
      if (found !== undefined) {
        this.recordScanned(type, found.id, found.scanned, results, result);
      }
      if (depth + 1 < MAX_SCAN_DEPTH) {
        await this.scanResources(subDir, type, results, result, root, depth + 1);
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
   * Get valid framework IDs from the index.
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
    const result = emptySyncResult();

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
        const report = this.toolLoader(promptDir, prompt.id);
        for (const tool of report.tools) {
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
        for (const failure of report.failures) {
          const compositeId = `${prompt.id}/${failure.toolId}`;
          // Marked seen deliberately: the tool IS on disk, it just did not load.
          // Letting it fall through to the removal sweep below would delete its
          // index row and report `removed`, which is the claim that a validation
          // failure and a deleted directory are the same event.
          seen.add(compositeId);
          this.logger.warn(
            `ResourceIndexer: Tool ${compositeId} failed to load: ${failure.reason}`
          );
          recordSyncFailure(result, 'tool', compositeId, failure.reason);
        }
      } catch (error) {
        this.logger.debug(`ResourceIndexer: Error syncing tools for prompt ${prompt.id}:`, error);
        recordSyncFailure(result, 'tool', `${prompt.id}/<all tools>`, error);
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
        `${result.removed} removed, ${result.unchanged} unchanged, ${result.errors} errors`
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
      tool_dir: this.relativeToolDir(tool.toolDir),
    };

    const contentHash = computeContentHash([
      JSON.stringify(tool.inputSchema),
      // The defaulted `execution` above, not `tool.execution` — the raw field is
      // optional, and JSON.stringify(undefined) returns undefined, which throws
      // inside the hash and takes down tool sync for the whole prompt.
      JSON.stringify(execution),
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
