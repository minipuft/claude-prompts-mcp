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
  private enableCache: boolean;
  private debug: boolean;

  constructor(config: GateDefinitionLoaderConfig = {}) {
    this.gatesDir = config.gatesDir ?? this.resolveGatesDir();
    this.additionalGatesDirs = (config.additionalGatesDirs ?? []).filter(
      (dir) => existsSync(dir) && dir !== this.gatesDir
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
  private loadFromYamlDir(id: string, baseDir?: string): LoadedGateDefinition | undefined {
    try {
      const gateDir = join(baseDir ?? this.gatesDir, id);
      const entryPath = join(gateDir, 'gate.yaml');

      if (!existsSync(entryPath)) {
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
        return undefined;
      }

      // Inline referenced files (guidance.md) before the parse, so `guidance` is validated
      // whether it was written inline or pulled from the sidecar file.
      this.inlineReferencedFiles(raw, gateDir);

      const validation = this.validateDefinition(raw, id);
      if (!validation.valid || !validation.data) {
        this.stats.loadErrors++;
        console.error(
          `[GateDefinitionLoader] Validation failed for '${id}':`,
          validation.errors.join('; ')
        );
        return undefined;
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

      return definition;
    } catch (error) {
      this.stats.loadErrors++;
      if (this.debug) {
        console.error(`[GateDefinitionLoader] Failed to load YAML '${id}':`, error);
      }
      return undefined;
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

  /**
   * Attempt to load a gate from additional directories.
   * Tries flat path first, then scans for grouped nesting.
   */
  private loadFromAdditionalDirs(id: string): LoadedGateDefinition | undefined {
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
