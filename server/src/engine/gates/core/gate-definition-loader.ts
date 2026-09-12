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
 * - Validation of definitions on load
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
  type GateDefinitionYaml,
} from './gate-schema.js';

import { ResourceQuarantine, type QuarantineView } from '#shared/utils/resource-quarantine.js';
import {
  loadYamlFileSync,
  discoverYamlDirectories,
  discoverNestedYamlDirectories,
} from '#shared/utils/yaml/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for GateDefinitionLoader
 */
export interface GateDefinitionLoaderConfig {
  /** Override default gates directory */
  gatesDir?: string;
  /** Additional gate directories (e.g., workspace overlays). Primary always wins on ID conflict. */
  additionalGatesDirs?: string[];
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
 * // Load a specific gate
 * const definition = loader.loadGate('code-quality');
 * ```
 */
export class GateDefinitionLoader {
  private cache = new Map<string, GateDefinitionYaml>();
  private stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };
  private gatesDir: string;
  private additionalGatesDirs: string[];
  private enableCache: boolean;
  private validateOnLoad: boolean;
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
    this.additionalGatesDirs = (config.additionalGatesDirs ?? []).filter(
      (dir) => existsSync(dir) && dir !== this.gatesDir
    );
    this.enableCache = config.enableCache ?? true;
    this.validateOnLoad = config.validateOnLoad ?? true;
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
   * @returns Loaded definition or undefined if not found
   */
  loadGate(id: string): GateDefinitionYaml | undefined {
    const normalizedId = id.toLowerCase();

    // Check cache first
    if (this.enableCache && this.cache.has(normalizedId)) {
      this.stats.cacheHits++;
      return this.cache.get(normalizedId);
    }

    this.stats.cacheMisses++;

    // Load from primary YAML directory, then fall through to additional dirs
    const definition =
      this.loadFromYamlDir(normalizedId) ?? this.loadFromAdditionalDirs(normalizedId);

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
    // Primary: flat scan
    const primaryIds = discoverYamlDirectories(this.gatesDir, 'gate.yaml');
    const idSet = new Set(primaryIds.map((id) => id.toLowerCase()));

    // Additional: nested scan (flat + grouped). Primary wins on conflict via Set.
    for (const dir of this.additionalGatesDirs) {
      const additionalIds = discoverNestedYamlDirectories(dir, 'gate.yaml');
      for (const id of additionalIds) {
        idSet.add(id.toLowerCase());
      }
    }

    return Array.from(idSet).sort();
  }

  /**
   * Load all available gates
   *
   * @returns Map of ID to definition for all successfully loaded gates
   */
  loadAllGates(): Map<string, GateDefinitionYaml> {
    const results = new Map<string, GateDefinitionYaml>();
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
    const normalizedId = id.toLowerCase();

    // Check primary
    if (existsSync(join(this.gatesDir, normalizedId, 'gate.yaml'))) {
      return true;
    }

    // Check additional dirs (flat + grouped)
    return this.findInAdditionalDirs(normalizedId) !== undefined;
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
   * Load a gate from YAML directory format ({baseDir}/{id}/gate.yaml)
   *
   * @param id - Gate ID
   * @param baseDir - Directory to load from (defaults to primary gatesDir)
   */
  private loadFromYamlDir(id: string, baseDir?: string): GateDefinitionYaml | undefined {
    const root = baseDir ?? this.gatesDir;
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

      // Load main gate.yaml
      const definition = loadYamlFileSync<GateDefinitionYaml>(entryPath, {
        required: true,
      });

      if (!definition) {
        return refuse('gate.yaml is empty or does not parse to a YAML mapping');
      }

      // Inline referenced files (guidance.md)
      this.inlineReferencedFiles(definition, gateDir);

      const refusal = this.validationRefusal(definition, id);
      if (refusal !== undefined) {
        return refuse(refusal);
      }

      if (this.debug) {
        console.error(`[GateDefinitionLoader] Loaded from YAML: ${definition.name} (${id})`);
      }

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
   * The refusal reason for a definition that fails validation, or undefined when it passes.
   *
   * Extracted from `loadFromYamlDir` rather than left inline: the validate-or-refuse block is a
   * decision, and folding it into the walk put that method one point over the cognitive-complexity
   * limit. Returning the reason rather than calling `refuse` itself keeps the single exit rule
   * intact — this method records nothing, so there is still exactly one place a refusal is written.
   */
  private validationRefusal(definition: GateDefinitionYaml, id: string): string | undefined {
    if (!this.validateOnLoad) return undefined;

    const validation = this.validateDefinition(definition, id);
    if (!validation.valid) {
      console.error(
        `[GateDefinitionLoader] Validation failed for '${id}':`,
        validation.errors.join('; ')
      );
      return validation.errors.join('; ');
    }

    if (validation.warnings.length > 0 && this.debug) {
      console.warn(`[GateDefinitionLoader] Warnings for '${id}':`, validation.warnings.join('; '));
    }
    return undefined;
  }

  /**
   * Inline referenced files into the definition
   */
  private inlineReferencedFiles(definition: GateDefinitionYaml, gateDir: string): void {
    // Inline guidance.md if referenced
    if (definition.guidanceFile) {
      const guidancePath = join(gateDir, definition.guidanceFile);
      if (existsSync(guidancePath)) {
        try {
          const content = readFileSync(guidancePath, 'utf-8');
          definition.guidance = content.trim();
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
      delete (definition as any).guidanceFile;
    }
  }

  /**
   * Attempt to load a gate from additional directories.
   * Tries flat path first, then scans for grouped nesting.
   */
  private loadFromAdditionalDirs(id: string): GateDefinitionYaml | undefined {
    const resolvedDir = this.findInAdditionalDirs(id);
    if (resolvedDir === undefined) return undefined;
    return this.loadFromYamlDir(id, resolvedDir);
  }

  /**
   * Find which additional directory contains a gate ID.
   * Checks flat ({dir}/{id}/gate.yaml) and grouped ({dir}/{group}/{id}/gate.yaml).
   *
   * @returns The base directory to pass to loadFromYamlDir, or undefined
   */
  private findInAdditionalDirs(id: string): string | undefined {
    for (const dir of this.additionalGatesDirs) {
      // Flat: {dir}/{id}/gate.yaml
      if (existsSync(join(dir, id, 'gate.yaml'))) {
        return dir;
      }

      // Grouped: {dir}/{group}/{id}/gate.yaml
      try {
        const groups = readdirSync(dir, { withFileTypes: true });
        for (const group of groups) {
          if (!group.isDirectory()) continue;
          if (existsSync(join(dir, group.name, id, 'gate.yaml'))) {
            return join(dir, group.name);
          }
        }
      } catch {
        // Unreadable directory — skip
      }
    }
    return undefined;
  }

  /**
   * Validate a gate definition using shared Zod schema
   */
  private validateDefinition(
    definition: GateDefinitionYaml,
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
