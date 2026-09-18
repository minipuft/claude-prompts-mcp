// @lifecycle canonical - Runtime YAML loading for gates (mirrors RuntimeFrameworkLoader)
/**
 * Gate Definition Loader
 *
 * Loads gate definitions from YAML source files at runtime,
 * following the same pattern as RuntimeFrameworkLoader.
 *
 * Features:
 * - Runtime YAML parsing via shared utilities
 * - Automatic inlining of guidance.md files
 * - Schema parsing on load: every definition goes through `GateDefinitionSchema`, so what a
 *   caller receives is the parsed object with the schema's defaults applied, not the raw YAML
 * - Configurable caching for performance
 * - Multi-location directory resolution
 *
 * @see RuntimeFrameworkLoader for the pattern this follows
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  validateGateSchema,
  type GateSchemaValidationResult,
  type LoadedGateDefinition,
} from './gate-schema.js';

import { ResourceQuarantine, type QuarantineView } from '#shared/utils/resource-quarantine.js';
import { resourceEntryRoots, resourceLookupOrder } from '#shared/utils/resource-root-lookup.js';
import { loadYamlFileSync, discoverNestedYamlDirectories } from '#shared/utils/yaml/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for GateDefinitionLoader
 */
export interface GateDefinitionLoaderConfig {
  /** Override default gates directory */
  gatesDir?: string;
  /**
   * The WHOLE lookup order for gates, HIGHEST precedence first — `gatesDir` included.
   *
   * The name says "additional" and the contents are not: since P4.27 the composition root places
   * `gatesDir` itself inside this list, at its own rank, because the primary is neither the top of
   * the order nor the bottom (overlays outrank it, the bundled tree trails it) and a list that
   * omitted it could not say where it sits. The accurate name lives at the producing end,
   * `ResourceRoots.lookupDirs`; this key kept its own so the rename would not reach the pipeline's
   * style loader and ~30 test call sites for no behaviour change.
   *
   * A caller configuring the loader by hand may omit `gatesDir`, in which case it is consulted
   * last — see `resourceLookupOrder`.
   */
  additionalGatesDirs?: string[];
  /** Enable caching of loaded definitions (default: true) */
  enableCache?: boolean;
  /** Log debug information */
  debug?: boolean;
}

/**
 * Statistics from the loader
 */
export interface GateLoaderStats {
  /** Number of cached definitions */
  cacheSize: number;
  /** Cache hit count */
  cacheHits: number;
  /** Cache miss count */
  cacheMisses: number;
  /** Number of load errors encountered */
  loadErrors: number;
  /** Primary gates directory */
  gatesDir: string;
  /** Additional overlay directories */
  additionalGatesDirs: string[];
}

// Re-export validation types
export type { GateSchemaValidationResult } from './gate-schema.js';

/**
 * Gate Definition Loader
 *
 * Provides runtime loading of gate definitions from YAML source files.
 *
 * @example
 * ```typescript
 * const loader = new GateDefinitionLoader();
 *
 * // Discover available gates
 * const ids = loader.discoverGates();
 * // ['code-quality', 'framework-compliance', ...]
 *
 * // Load a specific gate — parsed through GateDefinitionSchema, defaults applied
 * const definition = loader.loadGate('code-quality');
 * ```
 */
export class GateDefinitionLoader {
  private cache = new Map<string, LoadedGateDefinition>();
  private stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };
  private gatesDir: string;
  private additionalGatesDirs: string[];
  /** Every root this loader consults for an id, highest precedence first. */
  private readonly lookupDirs: string[];
  private enableCache: boolean;
  private debug: boolean;
  /**
   * Gate files this loader walked, read, and refused. ONE instance for the loader's lifetime.
   *
   * Published by reference through {@link getQuarantine}, the way `PromptLoader` publishes its own:
   * `GateRegistry` rebuilds guides on every reload, and a snapshot handed to the tool layer would
   * describe whichever load happened to be last re-passed.
   */
  private readonly quarantine = new ResourceQuarantine();

  constructor(config: GateDefinitionLoaderConfig = {}) {
    this.gatesDir = config.gatesDir ?? this.resolveGatesDir();
    // Built from the RAW list, before the filter below: the primary's rank is a position in that
    // list, and filtering it out first would drop it to the end — behind the bundled tree.
    this.lookupDirs = resourceLookupOrder(this.gatesDir, config.additionalGatesDirs ?? []);
    // Reported and watched, not looked up: the directories BESIDE the primary, so
    // `getWatchDirectories()` does not repeat it. Absent ones stay in — a workspace overlay created
    // while the server runs must be watched, and the observer arms on it once it appears. Filtering
    // by existence here, once, left such an overlay unwatched until a restart.
    this.additionalGatesDirs = (config.additionalGatesDirs ?? []).filter(
      (dir) => dir !== this.gatesDir
    );
    this.enableCache = config.enableCache ?? true;
    this.debug = config.debug ?? false;

    if (this.debug) {
      console.error(`[GateDefinitionLoader] Using directory: ${this.gatesDir}`);
      if (this.additionalGatesDirs.length > 0) {
        console.error(
          `[GateDefinitionLoader] Additional directories: ${this.additionalGatesDirs.join(', ')}`
        );
      }
    }
  }

  /**
   * Load a gate definition by ID
   *
   * @param id - Gate ID (e.g., 'code-quality', 'framework-compliance')
   * @returns The definition parsed through `GateDefinitionSchema` — schema defaults applied —
   *          or undefined if the gate is not found or fails validation
   */
  loadGate(id: string): LoadedGateDefinition | undefined {
    const normalizedId = id.toLowerCase();

    // Check cache first
    if (this.enableCache && this.cache.has(normalizedId)) {
      this.stats.cacheHits++;
      return this.cache.get(normalizedId);
    }

    this.stats.cacheMisses++;

    const definition = this.loadFromLookupOrder(normalizedId);

    if (!definition) {
      return undefined;
    }

    // Cache result
    if (this.enableCache) {
      this.cache.set(normalizedId, definition);
    }

    return definition;
  }

  /**
   * Discover all available gate IDs
   *
   * @returns Array of gate IDs from YAML directories
   */
  discoverGates(): string[] {
    // Every root gets the SAME nested (flat + grouped) scan. The primary used to get a flat-only
    // one, which made a grouped id under the primary undiscoverable while the identical tree under
    // an overlay was found — a difference no contract asked for. Precedence does not enter here:
    // this answers WHICH ids exist, and `loadGate` answers which root serves each.
    const idSet = new Set<string>();
    for (const dir of this.lookupDirs) {
      for (const id of discoverNestedYamlDirectories(dir, 'gate.yaml')) {
        idSet.add(id.toLowerCase());
      }
    }

    return Array.from(idSet).sort();
  }

  /**
   * Load all available gates
   *
   * @returns Map of ID to parsed definition for all successfully loaded gates
   */
  loadAllGates(): Map<string, LoadedGateDefinition> {
    const results = new Map<string, LoadedGateDefinition>();
    const ids = this.discoverGates();

    for (const id of ids) {
      const definition = this.loadGate(id);
      if (definition) {
        results.set(id, definition);
      }
    }

    return results;
  }

  /**
   * Check if a gate exists
   *
   * @param id - Gate ID to check
   * @returns True if the gate has a valid entry point
   */
  gateExists(id: string): boolean {
    return this.entryRootsFor(id.toLowerCase()).length > 0;
  }

  /**
   * Clear the cache (all or specific ID)
   *
   * @param id - Optional specific ID to clear; if omitted, clears all
   */
  clearCache(id?: string): void {
    if (id) {
      this.cache.delete(id.toLowerCase());
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get loader statistics
   */
  getStats(): GateLoaderStats {
    return {
      cacheSize: this.cache.size,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      loadErrors: this.stats.loadErrors,
      gatesDir: this.gatesDir,
      additionalGatesDirs: this.additionalGatesDirs,
    };
  }

  /**
   * Live view of the gate files that failed to load, across every root this loader has read from.
   *
   * Never consulted when resolving an id — `loadGate` reads the catalog side only, so a broken
   * workspace gate still leaves the bundled gate of that id serving.
   */
  getQuarantine(): QuarantineView {
    return this.quarantine;
  }

  /**
   * Get the gates directory being used
   */
  getGatesDir(): string {
    return this.gatesDir;
  }

  /**
   * Get all directories that should be watched for changes (primary + additional)
   */
  getWatchDirectories(): string[] {
    return [this.gatesDir, ...this.additionalGatesDirs];
  }

  // ============================================================================
  // Private Implementation - YAML Loading
  // ============================================================================

  /**
   * Load a gate from YAML directory format ({root}/{id}/gate.yaml)
   *
   * @param id - Gate ID
   * @param root - The directory to load from; for a grouped tree this is `{dir}/{group}`
   */
  private loadFromYamlDir(id: string, root: string): LoadedGateDefinition | undefined {
    const gateDir = join(root, id);
    const entryPath = join(gateDir, 'gate.yaml');
    const sink = this.quarantine.sinkFor('gate', root);

    /**
     * Refuse this file, and RECORD the refusal.
     *
     * One helper rather than four inline `sink.record(...)` calls, exactly as the prompt loader
     * has: every return below is a gate that vanishes from the registry, and a site that forgets
     * to record is indistinguishable from the `console.error`-and-drop this replaces. There is one
     * way to leave.
     *
     * Diagnostic text only. Never `definition.guidance`, `description` or `name` — a gate's
     * guidance is instruction delivered to the client LLM, and a file that failed validation is
     * precisely the one whose content has not been checked.
     */
    const refuse = (error: string): undefined => {
      this.stats.loadErrors++;
      sink.record({ id, path: entryPath, error });
      return undefined;
    };

    try {
      if (!existsSync(entryPath)) {
        // NOT a refusal: nothing was walked or read. Recording here would quarantine every id this
        // root simply does not hold, which is every id the fall-through is asking about.
        if (this.debug) {
          console.error(`[GateDefinitionLoader] YAML entry not found: ${entryPath}`);
        }
        return undefined;
      }

      // Load main gate.yaml. Typed as an untrusted record: nothing has checked it yet, so
      // naming it with the gate type here would be the claim the parse below actually earns.
      const raw = loadYamlFileSync<Record<string, unknown>>(entryPath, {
        required: true,
      });

      if (!raw) {
        return refuse('gate.yaml is empty or does not parse to a YAML mapping');
      }

      // Inline referenced files (guidance.md) before the parse, so `guidance` is validated
      // whether it was written inline or pulled from the sidecar file.
      this.inlineReferencedFiles(raw, gateDir);

      const validation = this.validateDefinition(raw, id);
      if (!validation.valid || !validation.data) {
        console.error(
          `[GateDefinitionLoader] Validation failed for '${id}':`,
          validation.errors.join('; ')
        );
        return refuse(validation.errors.join('; '));
      }
      if (validation.warnings.length > 0 && this.debug) {
        console.warn(
          `[GateDefinitionLoader] Warnings for '${id}':`,
          validation.warnings.join('; ')
        );
      }

      const definition = validation.data;

      if (this.debug) {
        console.error(`[GateDefinitionLoader] Loaded from YAML: ${definition.name} (${id})`);
      }

      // Stamp provenance HERE, where the root is in hand (P4.18, ruling R7). One call loads from
      // exactly one root, and every root reaches this method — primary directly, each additional
      // one through `loadFromAdditionalDirs`. The renderer must never re-derive which root served
      // an id: a second derivation of a question the loader already answered is the shape this
      // plan has been bitten by twice. Mirrors `PromptLoader`'s stamp in `modules/prompts`.
      //
      // After validation, so an authored `sourceRoot:` is overwritten rather than believed.
      //
      // For a GROUPED additional directory this is `{dir}/{group}`, not the configured root —
      // the same string `sinkFor` stamps on a refusal from that walk, which is what keeps the two
      // sides of a shadow finding comparable.
      definition.sourceRoot = root;

      // The repair side of the record. This loader is called one id at a time — from the registry's
      // discovery loop at startup and from `reloadGuide` after a write — so a repaired file is only
      // ever re-read on its own, and its record has to be dropped here or it outlives the repair.
      sink.forget(entryPath);
      return definition;
    } catch (error) {
      if (this.debug) {
        console.error(`[GateDefinitionLoader] Failed to load YAML '${id}':`, error);
      }
      return refuse(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Inline referenced files into the raw record, before it is parsed.
   */
  private inlineReferencedFiles(definition: Record<string, unknown>, gateDir: string): void {
    // Inline guidance.md if referenced
    const guidanceFile = definition['guidanceFile'];
    if (typeof guidanceFile === 'string' && guidanceFile.length > 0) {
      const guidancePath = join(gateDir, guidanceFile);
      if (existsSync(guidancePath)) {
        try {
          // Verbatim, not trimmed (matches `yaml-prompt-loader.ts`'s file inlining): an update
          // that omits `guidance` writes this exact string straight back to guidance.md, so
          // trimming here silently dropped the file's trailing newline on every write-back.
          const content = readFileSync(guidancePath, 'utf-8');
          definition['guidance'] = content;
          if (this.debug) {
            console.error(`[GateDefinitionLoader] Inlined guidance from ${guidancePath}`);
          }
        } catch (error) {
          console.warn(
            `[GateDefinitionLoader] Failed to inline guidance from ${guidancePath}:`,
            error
          );
        }
      } else {
        console.warn(`[GateDefinitionLoader] Referenced guidance file not found: ${guidancePath}`);
      }
      // Remove the file reference after inlining
      delete definition['guidanceFile'];
    }
  }

  /** The roots holding this id, highest precedence first. */
  private entryRootsFor(id: string): string[] {
    return resourceEntryRoots(this.lookupDirs, id, 'gate.yaml');
  }

  /**
   * Load a gate from the highest-precedence root that both holds it AND yields a valid definition.
   *
   * The fall-through on a refusal is the property `getQuarantine`'s docstring states: a broken
   * workspace gate leaves the bundled gate of that id serving, rather than removing the id from the
   * registry. Stopping at the first root that merely HAS the file would turn a malformed overlay
   * into a missing gate.
   *
   * SERVING STOPS AT THE FIRST HIT; READING DOES NOT (P4.35, ruling R17). Every root that holds the
   * id is read, including the ones below the winner, so their refusals reach the quarantine. Under
   * a first-hit-wins walk the silent root was whichever one served LAST — which since P4.27 is the
   * writable one an operator actually edits: a malformed `<ws>/resources/gates/foo` behind a legacy
   * `<ws>/gates/foo` produced no warning, no `list` entry and no repair target, which is the exact
   * defect the quarantine exists to remove, relocated rather than fixed. The cost is re-reading a
   * root for an id that already served, paid once per id behind `loadGate`'s cache.
   */
  private loadFromLookupOrder(id: string): LoadedGateDefinition | undefined {
    let served: LoadedGateDefinition | undefined;
    for (const base of this.entryRootsFor(id)) {
      const definition = this.loadFromYamlDir(id, base);
      if (definition !== undefined && served === undefined) served = definition;
    }
    return served;
  }

  /**
   * Validate a gate definition using shared Zod schema
   */
  private validateDefinition(
    definition: Record<string, unknown>,
    expectedId: string
  ): GateSchemaValidationResult {
    return validateGateSchema(definition, expectedId);
  }

  // ============================================================================
  // Private Implementation - Directory Resolution
  // ============================================================================

  /**
   * Resolve the gates directory from package location.
   * Standalone fallback — used when PathResolver is not available (tests, standalone).
   * In production, GateRegistry passes the resolved dir via config.
   */
  private resolveGatesDir(): string {
    // 1. Find package.json with our package name
    const pkgResolved = this.resolveFromPackageJson();
    if (pkgResolved) {
      return pkgResolved;
    }

    // 2. Walk up from current module location
    let current = __dirname;
    for (let i = 0; i < 10; i++) {
      const resourcesCandidate = join(current, 'resources', 'gates');
      if (existsSync(resourcesCandidate) && this.hasYamlFiles(resourcesCandidate)) {
        return resourcesCandidate;
      }
      current = dirname(current);
    }

    // Fallback
    return join(__dirname, '..', '..', '..', 'resources', 'gates');
  }

  /**
   * Resolve gates directory by finding our package.json
   */
  private resolveFromPackageJson(): string | null {
    let dir = __dirname;
    for (let i = 0; i < 15; i++) {
      const pkgPath = join(dir, 'package.json');
      try {
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
          if (pkg.name === 'claude-prompts') {
            // Check resources/gates first (new structure)
            const resourcesGatesPath = join(dir, 'resources', 'gates');
            if (existsSync(resourcesGatesPath) && this.hasYamlFiles(resourcesGatesPath)) {
              return resourcesGatesPath;
            }
            // Then check legacy location
            const gatesPath = join(dir, 'gates');
            if (existsSync(gatesPath) && this.hasYamlFiles(gatesPath)) {
              return gatesPath;
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  /**
   * Check if a directory contains YAML gate files
   */
  private hasYamlFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      // Check for at least one subdirectory with gate.yaml
      return entries.some((entry) => {
        if (!entry.isDirectory()) return false;
        const entryPath = join(dirPath, entry.name, 'gate.yaml');
        return existsSync(entryPath);
      });
    } catch {
      return false;
    }
  }
}

/**
 * Factory function with default configuration
 */
export function createGateDefinitionLoader(
  config?: GateDefinitionLoaderConfig
): GateDefinitionLoader {
  return new GateDefinitionLoader(config);
}

// ============================================================================
// Default Instance Management (singleton pattern)
// ============================================================================

let defaultLoader: GateDefinitionLoader | null = null;

/**
 * Get the default GateDefinitionLoader instance
 * Creates one if it doesn't exist
 */
export function getDefaultGateDefinitionLoader(): GateDefinitionLoader {
  if (!defaultLoader) {
    defaultLoader = new GateDefinitionLoader();
  }
  return defaultLoader;
}

/**
 * Reset the default loader (useful for testing)
 */
export function resetDefaultGateDefinitionLoader(): void {
  defaultLoader = null;
}
