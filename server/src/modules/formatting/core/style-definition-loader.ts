// @lifecycle canonical - Runtime YAML loading for styles (mirrors GateDefinitionLoader)
/**
 * Style Definition Loader
 *
 * Loads style definitions from YAML source files at runtime,
 * following the same pattern as GateDefinitionLoader.
 *
 * Features:
 * - Runtime YAML parsing via shared utilities
 * - Automatic inlining of guidance.md files
 * - Validation of definitions on load
 * - Configurable caching for performance
 * - Multi-location directory resolution
 *
 * @see GateDefinitionLoader for the pattern this follows
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  validateStyleSchema,
  type StyleSchemaValidationResult,
  type StyleDefinitionYaml,
  type LoadedStyleDefinition,
} from './style-schema.js';

import { ResourceQuarantine, type QuarantineView } from '#shared/utils/resource-quarantine.js';
import { resourceEntryRoots, resourceLookupOrder } from '#shared/utils/resource-root-lookup.js';
import { loadYamlFileSync, discoverNestedYamlDirectories } from '#shared/utils/yaml/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for StyleDefinitionLoader
 */
export interface StyleDefinitionLoaderConfig {
  /** Override default styles directory */
  stylesDir?: string;
  /**
   * The WHOLE lookup order for styles, HIGHEST precedence first — `stylesDir` included.
   *
   * The name says "additional" and the contents are not: since P4.27 the composition root places
   * `stylesDir` itself inside this list, at its own rank, because the primary is neither the top of
   * the order nor the bottom (overlays outrank it, the bundled tree trails it) and a list that
   * omitted it could not say where it sits. The accurate name lives at the producing end,
   * `ResourceRoots.lookupDirs`; this key kept its own so the rename would not reach ~30 test call
   * sites for no behaviour change.
   *
   * A caller configuring the loader by hand may omit `stylesDir`, in which case it is consulted
   * last — see `resourceLookupOrder`.
   */
  additionalStylesDirs?: string[];
  /** Enable caching of loaded definitions (default: true) */
  enableCache?: boolean;
  /** Validate definitions on load (default: true) */
  validateOnLoad?: boolean;
  /** Log debug information */
  debug?: boolean;
}

/**
 * Statistics from the loader
 */
export interface StyleLoaderStats {
  /** Number of cached definitions */
  cacheSize: number;
  /** Cache hit count */
  cacheHits: number;
  /** Cache miss count */
  cacheMisses: number;
  /** Number of load errors encountered */
  loadErrors: number;
  /** Styles directory being used */
  stylesDir: string;
  /** Additional overlay directories */
  additionalStylesDirs: string[];
}

// Re-export validation types
export type { StyleSchemaValidationResult } from './style-schema.js';

/**
 * Style Definition Loader
 *
 * Provides runtime loading of style definitions from YAML source files.
 *
 * @example
 * ```typescript
 * const loader = new StyleDefinitionLoader();
 *
 * // Discover available styles
 * const ids = loader.discoverStyles();
 * // ['analytical', 'procedural', 'creative', 'reasoning']
 *
 * // Load a specific style
 * const definition = loader.loadStyle('analytical');
 * ```
 */
export class StyleDefinitionLoader {
  private cache = new Map<string, LoadedStyleDefinition>();
  private stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };
  /**
   * Style files this loader refused, by root. ONE instance for the loader's lifetime.
   *
   * Styles were the fourth kind `ResourceIndexer` walks and the only one with no refusal record,
   * so the "absent from the index when the loader dropped it" property held for three kinds and
   * silently did not for this one: a malformed `style.yaml` left the catalog and the indexer, which
   * parses the same YAML itself and only ever checked that it parses, indexed it anyway.
   *
   * Published by reference (`getQuarantine`) rather than returned per load, the way `PromptLoader`
   * publishes its own: the composition root binds it once and every later reload is visible through
   * the same object.
   */
  private readonly quarantine = new ResourceQuarantine();
  private stylesDir: string;
  private additionalStylesDirs: string[];
  /** Every root this loader consults for an id, highest precedence first. */
  private readonly lookupDirs: string[];
  private enableCache: boolean;
  private validateOnLoad: boolean;
  private debug: boolean;

  constructor(config: StyleDefinitionLoaderConfig = {}) {
    this.stylesDir = config.stylesDir ?? this.resolveStylesDir();
    // From the RAW list — see the gate loader's twin: the primary's rank IS its position here, and
    // filtering it out first would drop it behind the bundled tree.
    this.lookupDirs = resourceLookupOrder(this.stylesDir, config.additionalStylesDirs ?? []);
    // Reported and watched, not looked up — absent ones included, as in the gate loader's twin.
    this.additionalStylesDirs = (config.additionalStylesDirs ?? []).filter(
      (dir) => dir !== this.stylesDir
    );
    this.enableCache = config.enableCache ?? true;
    this.validateOnLoad = config.validateOnLoad ?? true;
    this.debug = config.debug ?? false;

    if (this.debug) {
      // Use stderr to avoid corrupting STDIO protocol
      console.error(`[StyleDefinitionLoader] Using directory: ${this.stylesDir}`);
      if (this.additionalStylesDirs.length > 0) {
        console.error(
          `[StyleDefinitionLoader] Additional directories: ${this.additionalStylesDirs.join(', ')}`
        );
      }
    }
  }

  /**
   * Load a style definition by ID
   *
   * @param id - Style ID (e.g., 'analytical', 'procedural')
   * @returns Loaded definition or undefined if not found
   */
  loadStyle(id: string): LoadedStyleDefinition | undefined {
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
   * Discover all available style IDs
   *
   * @returns Array of style IDs from YAML directories
   */
  discoverStyles(): string[] {
    // One scan shape for every root — see the gate loader's twin. This answers WHICH ids exist;
    // `loadStyle` answers which root serves each.
    const idSet = new Set<string>();
    for (const dir of this.lookupDirs) {
      for (const id of discoverNestedYamlDirectories(dir, 'style.yaml')) {
        idSet.add(id.toLowerCase());
      }
    }

    return Array.from(idSet).sort();
  }

  /**
   * Load all available styles
   *
   * @returns Map of ID to definition for all successfully loaded styles
   */
  loadAllStyles(): Map<string, LoadedStyleDefinition> {
    const results = new Map<string, LoadedStyleDefinition>();
    const ids = this.discoverStyles();

    for (const id of ids) {
      const definition = this.loadStyle(id);
      if (definition) {
        results.set(id, definition);
      }
    }

    return results;
  }

  /**
   * Check if a style exists
   *
   * @param id - Style ID to check
   * @returns True if the style has a valid entry point
   */
  styleExists(id: string): boolean {
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
  getStats(): StyleLoaderStats {
    return {
      cacheSize: this.cache.size,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      loadErrors: this.stats.loadErrors,
      stylesDir: this.stylesDir,
      additionalStylesDirs: this.additionalStylesDirs,
    };
  }

  /**
   * Live view of the style files that failed to load, across every root consulted so far.
   *
   * Populated by demand, not by discovery: `discoverStyles()` only lists directories holding a
   * `style.yaml`, and a file is refused when it is READ. A consumer that needs the collection to
   * describe the whole tree must drive {@link loadAllStyles} first — which is why the composition
   * root reports the LOADED style count rather than the discovered one.
   */
  getQuarantine(): QuarantineView {
    return this.quarantine;
  }

  /**
   * Get the styles directory being used
   */
  getStylesDir(): string {
    return this.stylesDir;
  }

  /**
   * Get all directories that should be watched for changes (primary + additional)
   */
  getWatchDirectories(): string[] {
    return [this.stylesDir, ...this.additionalStylesDirs];
  }

  // ============================================================================
  // Private Implementation - Overlay Loading
  // ============================================================================

  /** The roots holding this id, highest precedence first. */
  private entryRootsFor(id: string): string[] {
    return resourceEntryRoots(this.lookupDirs, id, 'style.yaml');
  }

  /**
   * Load from the highest-precedence root that both holds this id AND yields a valid definition.
   *
   * The fall-through on a refusal is the property `getQuarantine`'s docstring states for the other
   * two kinds: a broken workspace style leaves the bundled style of that id serving, rather than
   * removing the id from the catalog.
   *
   * SERVING STOPS AT THE FIRST HIT; READING DOES NOT (P4.35, ruling R17). Every root that holds the
   * id is read, including the ones below the winner, so their refusals reach the quarantine. Under
   * a first-hit-wins walk the silent root was whichever one served LAST — which since P4.27 is the
   * writable one an operator actually edits: a malformed `<ws>/resources/styles/foo` behind a
   * legacy `<ws>/styles/foo` produced no warning, no `list` entry and no repair target, which is
   * the exact defect the quarantine exists to remove, relocated rather than fixed. The cost is
   * re-reading a root for an id that already served, paid once per id behind `loadStyle`'s cache.
   */
  private loadFromLookupOrder(id: string): LoadedStyleDefinition | undefined {
    let served: LoadedStyleDefinition | undefined;
    for (const base of this.entryRootsFor(id)) {
      const definition = this.loadFromYamlDir(id, base);
      if (definition !== undefined && served === undefined) served = definition;
    }
    return served;
  }

  // ============================================================================
  // Private Implementation - YAML Loading
  // ============================================================================

  /**
   * Load a style from YAML directory format ({root}/{id}/style.yaml)
   *
   * @param id - Style ID
   * @param root - The directory to load from; for a grouped tree this is `{dir}/{group}`
   */
  private loadFromYamlDir(id: string, root: string): LoadedStyleDefinition | undefined {
    const styleDir = join(root, id);
    const entryPath = join(styleDir, 'style.yaml');

    // `sinkFor`, never `beginRoot`: this loader resolves ONE id at a time behind a cache, so there
    // is no walk boundary at which a whole root could be dropped and rebuilt. Clearing the root
    // here would erase the record of every OTHER broken style in it. Refusals are recorded per
    // file and forgotten per file on success, which converges on the same set.
    const sink = this.quarantine.sinkFor('style', root);

    // An absent entry point is not a refusal — nothing was read, and this is the ordinary answer
    // for an id that lives in a different root. Recording it would put a file that does not exist
    // in front of a repair surface.
    if (!existsSync(entryPath)) {
      if (this.debug) {
        console.error(`[StyleDefinitionLoader] YAML entry not found: ${entryPath}`);
      }
      return undefined;
    }

    try {
      // Load main style.yaml — untyped until validated, like the gate loader's untrusted raw
      // record: nothing has checked it yet, so naming it with the definition type here would be
      // a claim the parse below actually earns.
      const raw = loadYamlFileSync<Record<string, unknown>>(entryPath, {
        required: true,
      });

      if (!raw) {
        this.stats.loadErrors++;
        sink.record({ id, path: entryPath, error: 'style.yaml parsed to no definition' });
        return undefined;
      }

      // Inline referenced files (guidance.md) before validation, so `guidance` is checked
      // whether it was written inline or pulled from the sidecar file.
      this.inlineReferencedFiles(raw as StyleDefinitionYaml, styleDir);

      let definition: LoadedStyleDefinition;
      if (this.validateOnLoad) {
        const validation = this.validateDefinition(raw as StyleDefinitionYaml, id);
        if (!validation.valid || !validation.data) {
          this.stats.loadErrors++;
          const error = validation.errors.join('; ');
          sink.record({ id, path: entryPath, error });
          console.error(`[StyleDefinitionLoader] Validation failed for '${id}':`, error);
          return undefined;
        }
        if (validation.warnings.length > 0 && this.debug) {
          console.warn(
            `[StyleDefinitionLoader] Warnings for '${id}':`,
            validation.warnings.join('; ')
          );
        }
        // The validator's OUTPUT, defaults included — not the raw parse (P4.49, ruling R26).
        // Before this fix, a style that omitted `priority`/`enabled`/`enhancementMode` carried
        // `undefined` for each: validation passed, the schema's default was computed and thrown
        // away, and `StyleManager.isStyleActive`'s `if (!style.enabled) return false` read that
        // `undefined` as disabled even though the schema's own default is `enabled: true`.
        definition = validation.data;
      } else {
        // `validateOnLoad: false` skips the schema parse entirely, and a default is a PRODUCT of
        // that parse — there is no defaulted form to hand back without running it. The raw YAML
        // is the only available answer on this path, unchanged from before this fix.
        definition = raw as LoadedStyleDefinition;
      }

      if (this.debug) {
        console.error(`[StyleDefinitionLoader] Loaded from YAML: ${definition.name} (${id})`);
      }

      // Stamp provenance HERE, where the root is in hand — the rule P4.18 (ruling R7) set for
      // gates and frameworks, extended to the fourth kind at P4.31. One call loads from exactly
      // one root and every root reaches this method, so no consumer ever has to RE-DERIVE which
      // root served an id; a second derivation of a question the loader already answered is the
      // shape this plan has been bitten by repeatedly.
      //
      // After validation, so an authored `sourceRoot:` is overwritten rather than believed.
      //
      // For a GROUPED root this is `{dir}/{group}`, not the configured root — the same string
      // `sinkFor` above stamps on a refusal from this walk, which is what keeps the two sides of
      // a shadow finding comparable.
      definition.sourceRoot = root;

      // This exact file loaded, so any record of it is now a lie — the stale-`✓` failure in
      // reverse, and the reason a repaired style stops reporting as refused without a restart.
      sink.forget(entryPath);
      return definition;
    } catch (error) {
      this.stats.loadErrors++;
      sink.record({
        id,
        path: entryPath,
        error: error instanceof Error ? error.message : String(error),
      });
      if (this.debug) {
        console.error(`[StyleDefinitionLoader] Failed to load YAML '${id}':`, error);
      }
      return undefined;
    }
  }

  /**
   * Inline referenced files into the definition
   */
  private inlineReferencedFiles(definition: StyleDefinitionYaml, styleDir: string): void {
    // Inline guidance.md if referenced
    const guidanceFile = (definition as Record<string, unknown>)['guidanceFile'] as
      string | undefined;
    if (guidanceFile) {
      const guidancePath = join(styleDir, guidanceFile);
      if (existsSync(guidancePath)) {
        try {
          const content = readFileSync(guidancePath, 'utf-8');
          definition.guidance = content.trim();
          if (this.debug) {
            console.error(`[StyleDefinitionLoader] Inlined guidance from ${guidancePath}`);
          }
        } catch (error) {
          console.warn(
            `[StyleDefinitionLoader] Failed to inline guidance from ${guidancePath}:`,
            error
          );
        }
      } else {
        console.warn(`[StyleDefinitionLoader] Referenced guidance file not found: ${guidancePath}`);
      }
      // Remove the file reference after inlining
      delete (definition as Record<string, unknown>)['guidanceFile'];
    }
  }

  /**
   * Validate a style definition using shared Zod schema
   */
  private validateDefinition(
    definition: StyleDefinitionYaml,
    expectedId: string
  ): StyleSchemaValidationResult {
    return validateStyleSchema(definition, expectedId);
  }

  // ============================================================================
  // Private Implementation - Directory Resolution
  // ============================================================================

  /**
   * Resolve the styles directory from multiple possible locations
   *
   * Priority:
   *   1. Package.json resolution (npm/npx installs)
   *   3. Walk up from module location (development)
   *   4. Common relative paths (resources/styles first, then legacy styles)
   *   5. Fallback
   */
  private resolveStylesDir(): string {
    // Standalone fallback — used when PathResolver is not available (tests, standalone).
    // In production, module-initializer passes the resolved dir via config.

    // 1. Find package.json with our package name
    const pkgResolved = this.resolveFromPackageJson();
    if (pkgResolved) {
      return pkgResolved;
    }

    // 2. Walk up from current module location
    let current = __dirname;
    for (let i = 0; i < 10; i++) {
      const resourcesCandidate = join(current, 'resources', 'styles');
      if (existsSync(resourcesCandidate) && this.hasYamlFiles(resourcesCandidate)) {
        return resourcesCandidate;
      }
      current = dirname(current);
    }

    // Fallback
    return join(__dirname, '..', '..', '..', 'resources', 'styles');
  }

  /**
   * Resolve styles directory by finding our package.json
   */
  private resolveFromPackageJson(): string | null {
    let dir = __dirname;
    for (let i = 0; i < 15; i++) {
      const pkgPath = join(dir, 'package.json');
      try {
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
          if (pkg.name === 'claude-prompts') {
            // Check resources/styles first (new structure)
            const resourcesStylesPath = join(dir, 'resources', 'styles');
            if (existsSync(resourcesStylesPath) && this.hasYamlFiles(resourcesStylesPath)) {
              return resourcesStylesPath;
            }
            // Then check legacy styles location
            const stylesPath = join(dir, 'styles');
            if (existsSync(stylesPath) && this.hasYamlFiles(stylesPath)) {
              return stylesPath;
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
   * Check if a directory contains YAML style files
   */
  private hasYamlFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      // Check for at least one subdirectory with style.yaml
      return entries.some((entry) => {
        if (!entry.isDirectory()) return false;
        const entryPath = join(dirPath, entry.name, 'style.yaml');
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
export function createStyleDefinitionLoader(
  config?: StyleDefinitionLoaderConfig
): StyleDefinitionLoader {
  return new StyleDefinitionLoader(config);
}

// ============================================================================
// Default Instance Management (singleton pattern)
// ============================================================================

let defaultLoader: StyleDefinitionLoader | null = null;

/**
 * Get the default StyleDefinitionLoader instance
 * Creates one if it doesn't exist
 */
export function getDefaultStyleDefinitionLoader(
  config?: StyleDefinitionLoaderConfig
): StyleDefinitionLoader {
  if (!defaultLoader) {
    defaultLoader = new StyleDefinitionLoader(config);
  }
  return defaultLoader;
}

/**
 * Reset the default loader (useful for testing)
 */
export function resetDefaultStyleDefinitionLoader(): void {
  defaultLoader = null;
}
