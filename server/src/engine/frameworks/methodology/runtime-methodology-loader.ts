// @lifecycle canonical - Runtime YAML loading for methodologies (replaces build-time compilation)
/**
 * Runtime Methodology Loader
 *
 * Loads methodology definitions directly from YAML source files at runtime,
 * eliminating the need for build-time YAML→JSON compilation.
 *
 * Features:
 * - Runtime YAML parsing via shared utilities
 * - Automatic inlining of referenced files (phases.yaml, judge-prompt.md)
 * - Validation of definitions on load
 * - Configurable caching for performance
 * - Multi-location directory resolution
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  validateMethodologySchema,
  type MethodologySchemaValidationResult,
} from './methodology-schema.js';
import {
  loadYamlFileSync,
  discoverYamlDirectories,
  discoverNestedYamlDirectories,
} from '../../../shared/utils/yaml/index.js';

import type { MethodologyDefinition } from './methodology-definition-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for RuntimeMethodologyLoader
 */
export interface RuntimeMethodologyLoaderConfig {
  /** Override default methodologies directory */
  methodologiesDir?: string;
  /** Additional directories to scan for methodology overlays (workspace resources) */
  additionalMethodologiesDirs?: string[];
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
export interface LoaderStats {
  /** Number of cached definitions */
  cacheSize: number;
  /** Cache hit count */
  cacheHits: number;
  /** Cache miss count */
  cacheMisses: number;
  /** Number of load errors encountered */
  loadErrors: number;
  /** Methodologies directory being used */
  methodologiesDir: string;
  /** Additional overlay directories */
  additionalMethodologiesDirs: string[];
}

// MethodologySchemaValidationResult is imported from methodology-schema.ts
export type { MethodologySchemaValidationResult } from './methodology-schema.js';

/**
 * Runtime Methodology Loader
 *
 * Provides runtime loading of methodology definitions from YAML source files,
 * replacing the build-time compilation step.
 *
 * @example
 * ```typescript
 * const loader = new RuntimeMethodologyLoader();
 *
 * // Discover available methodologies
 * const ids = loader.discoverMethodologies();
 * // ['cageerf', 'react', '5w1h', 'scamper']
 *
 * // Load a specific methodology
 * const definition = loader.loadMethodology('cageerf');
 * ```
 */
export class RuntimeMethodologyLoader {
  private cache = new Map<string, MethodologyDefinition>();
  private stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };
  private methodologiesDir: string;
  private additionalMethodologiesDirs: string[];
  private enableCache: boolean;
  private validateOnLoad: boolean;
  private debug: boolean;

  constructor(config: RuntimeMethodologyLoaderConfig = {}) {
    this.methodologiesDir = config.methodologiesDir ?? this.resolveMethodologiesDir();
    this.additionalMethodologiesDirs = (config.additionalMethodologiesDirs ?? []).filter(
      (dir) => existsSync(dir) && dir !== this.methodologiesDir
    );
    this.enableCache = config.enableCache ?? true;
    this.validateOnLoad = config.validateOnLoad ?? true;
    this.debug = config.debug ?? false;

    if (this.debug) {
      // Use stderr to avoid corrupting STDIO protocol
      console.error(`[RuntimeMethodologyLoader] Using directory: ${this.methodologiesDir}`);
      if (this.additionalMethodologiesDirs.length > 0) {
        console.error(
          `[RuntimeMethodologyLoader] Additional directories: ${this.additionalMethodologiesDirs.join(', ')}`
        );
      }
    }
  }

  /**
   * Load a methodology definition by ID
   *
   * @param id - Methodology ID (e.g., 'cageerf', 'react')
   * @returns Loaded definition or undefined if not found
   */
  loadMethodology(id: string): MethodologyDefinition | undefined {
    const normalizedId = id.toLowerCase();

    // Check cache first
    if (this.enableCache && this.cache.has(normalizedId)) {
      this.stats.cacheHits++;
      return this.cache.get(normalizedId);
    }

    this.stats.cacheMisses++;

    // Load from primary directory, then fall through to additional dirs
    const definition =
      this.loadFromDir(normalizedId, this.methodologiesDir) ??
      this.loadFromAdditionalDirs(normalizedId);

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
   * Discover all available methodology IDs
   *
   * @returns Array of methodology IDs that have valid entry points
   */
  discoverMethodologies(): string[] {
    // Primary: flat scan
    const primaryIds = discoverYamlDirectories(this.methodologiesDir, 'methodology.yaml');
    const idSet = new Set(primaryIds.map((id) => id.toLowerCase()));

    // Additional: nested scan (flat + grouped). Primary wins on conflict via Set.
    for (const dir of this.additionalMethodologiesDirs) {
      const additionalIds = discoverNestedYamlDirectories(dir, 'methodology.yaml');
      for (const id of additionalIds) {
        idSet.add(id.toLowerCase());
      }
    }

    return Array.from(idSet).sort();
  }

  /**
   * Load all available methodologies
   *
   * @returns Map of ID to definition for all successfully loaded methodologies
   */
  loadAllMethodologies(): Map<string, MethodologyDefinition> {
    const results = new Map<string, MethodologyDefinition>();
    const ids = this.discoverMethodologies();

    for (const id of ids) {
      const definition = this.loadMethodology(id);
      if (definition) {
        results.set(id, definition);
      }
    }

    return results;
  }

  /**
   * Check if a methodology exists
   *
   * @param id - Methodology ID to check
   * @returns True if the methodology has a valid entry point
   */
  methodologyExists(id: string): boolean {
    const normalizedId = id.toLowerCase();

    // Check primary
    if (existsSync(join(this.methodologiesDir, normalizedId, 'methodology.yaml'))) {
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
  getStats(): LoaderStats {
    return {
      cacheSize: this.cache.size,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      loadErrors: this.stats.loadErrors,
      methodologiesDir: this.methodologiesDir,
      additionalMethodologiesDirs: this.additionalMethodologiesDirs,
    };
  }

  /**
   * Get the methodologies directory being used
   */
  getMethodologiesDir(): string {
    return this.methodologiesDir;
  }

  /**
   * Get all directories that should be watched for changes (primary + additional)
   */
  getWatchDirectories(): string[] {
    return [this.methodologiesDir, ...this.additionalMethodologiesDirs];
  }

  // ============================================================================
  // Private Implementation - Overlay Loading
  // ============================================================================

  /**
   * Load a methodology from a specific base directory
   */
  private loadFromDir(id: string, baseDir: string): MethodologyDefinition | undefined {
    try {
      const methodologyDir = join(baseDir, id);
      const entryPath = join(methodologyDir, 'methodology.yaml');

      if (!existsSync(entryPath)) {
        if (this.debug) {
          console.error(`[RuntimeMethodologyLoader] Entry point not found: ${entryPath}`);
        }
        return undefined;
      }

      // Load main methodology.yaml
      const definition = loadYamlFileSync<MethodologyDefinition>(entryPath, {
        required: true,
      });

      if (!definition) {
        return undefined;
      }

      // Inline referenced files
      this.inlineReferencedFiles(definition, methodologyDir);

      // Validate if enabled
      if (this.validateOnLoad) {
        const validation = this.validateDefinition(definition, id);
        if (!validation.valid) {
          this.stats.loadErrors++;
          console.error(
            `[RuntimeMethodologyLoader] Validation failed for '${id}':`,
            validation.errors.join('; ')
          );
          return undefined;
        }
        if (validation.warnings.length > 0) {
          console.warn(
            `[RuntimeMethodologyLoader] Warnings for '${id}':`,
            validation.warnings.join('; ')
          );
        }
      }

      if (this.debug) {
        console.error(`[RuntimeMethodologyLoader] Loaded: ${definition.name} (${id})`);
      }

      return definition;
    } catch (error) {
      this.stats.loadErrors++;
      console.error(`[RuntimeMethodologyLoader] Failed to load '${id}':`, error);
      return undefined;
    }
  }

  /**
   * Attempt to load a methodology from additional directories.
   * Tries flat path first, then scans for grouped nesting.
   */
  private loadFromAdditionalDirs(id: string): MethodologyDefinition | undefined {
    const resolvedDir = this.findInAdditionalDirs(id);
    if (resolvedDir === undefined) return undefined;
    return this.loadFromDir(id, resolvedDir);
  }

  /**
   * Find which additional directory contains a methodology ID.
   * Checks flat ({dir}/{id}/methodology.yaml) and grouped ({dir}/{group}/{id}/methodology.yaml).
   *
   * @returns The base directory to pass to loadFromDir, or undefined
   */
  private findInAdditionalDirs(id: string): string | undefined {
    for (const dir of this.additionalMethodologiesDirs) {
      // Flat: {dir}/{id}/methodology.yaml
      if (existsSync(join(dir, id, 'methodology.yaml'))) {
        return dir;
      }

      // Grouped: {dir}/{group}/{id}/methodology.yaml
      try {
        const groups = readdirSync(dir, { withFileTypes: true });
        for (const group of groups) {
          if (!group.isDirectory()) continue;
          if (existsSync(join(dir, group.name, id, 'methodology.yaml'))) {
            return join(dir, group.name);
          }
        }
      } catch {
        // Directory read failure — skip
      }
    }
    return undefined;
  }

  // ============================================================================
  // Private Implementation - Directory Resolution
  // ============================================================================

  /**
   * Resolve the methodologies directory from multiple possible locations
   *
   * Priority:
   *   1. Package.json resolution (npm/npx installs)
   *   3. Walk up from module location (development)
   *   4. Common relative paths (resources/methodologies first, then legacy)
   *   5. Fallback
   */
  private resolveMethodologiesDir(): string {
    // Standalone fallback — used when PathResolver is not available (tests, standalone).
    // In production, module-initializer passes the resolved dir via config.

    // 1. Find package.json with our package name (works for npx deep cache paths)
    const pkgResolved = this.resolveFromPackageJson();
    if (pkgResolved) {
      return pkgResolved;
    }

    // 2. Walk up from current module location (fallback for development)
    let current = __dirname;
    for (let i = 0; i < 10; i++) {
      const resourcesCandidate = join(current, 'resources', 'methodologies');
      if (existsSync(resourcesCandidate) && this.hasYamlFiles(resourcesCandidate)) {
        return resourcesCandidate;
      }
      current = dirname(current);
    }

    // Fallback
    return join(__dirname, '..', '..', '..', 'resources', 'methodologies');
  }

  /**
   * Resolve methodologies directory by finding our package.json
   * This handles npx installations where the package is deep in the cache
   */
  private resolveFromPackageJson(): string | null {
    let dir = __dirname;
    for (let i = 0; i < 15; i++) {
      const pkgPath = join(dir, 'package.json');
      try {
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
          if (pkg.name === 'claude-prompts') {
            // Check resources/methodologies first (new structure)
            const resourcesMethodologiesPath = join(dir, 'resources', 'methodologies');
            if (
              existsSync(resourcesMethodologiesPath) &&
              this.hasYamlFiles(resourcesMethodologiesPath)
            ) {
              return resourcesMethodologiesPath;
            }
            // Then check legacy location
            const methodologiesPath = join(dir, 'methodologies');
            if (existsSync(methodologiesPath) && this.hasYamlFiles(methodologiesPath)) {
              return methodologiesPath;
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
   * Check if a directory contains YAML methodology files
   */
  private hasYamlFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      // Check for at least one subdirectory with methodology.yaml
      return entries.some((entry) => {
        if (!entry.isDirectory()) return false;
        const entryPath = join(dirPath, entry.name, 'methodology.yaml');
        return existsSync(entryPath);
      });
    } catch {
      return false;
    }
  }

  /**
   * Inline referenced files into the definition
   */
  private inlineReferencedFiles(definition: any, methodologyDir: string): void {
    // Inline phases.yaml if referenced
    if (definition.phasesFile) {
      const phasesPath = join(methodologyDir, definition.phasesFile);
      if (existsSync(phasesPath)) {
        try {
          const phases = loadYamlFileSync(phasesPath);
          if (phases) {
            definition.phases = phases;
          }
        } catch (error) {
          console.warn(
            `[RuntimeMethodologyLoader] Failed to inline phases from ${phasesPath}:`,
            error
          );
        }
      }
      delete definition.phasesFile;
    }

    // Inline judge-prompt.md if referenced
    if (definition.judgePromptFile) {
      const judgePath = join(methodologyDir, definition.judgePromptFile);
      if (existsSync(judgePath)) {
        try {
          const content = readFileSync(judgePath, 'utf-8');
          definition.judgePrompt = this.parseJudgePrompt(content);
        } catch (error) {
          console.warn(
            `[RuntimeMethodologyLoader] Failed to inline judge prompt from ${judgePath}:`,
            error
          );
        }
      }
      delete definition.judgePromptFile;
    }
  }

  /**
   * Parse judge prompt markdown into structured format
   */
  private parseJudgePrompt(content: string): {
    systemMessage: string;
    userMessageTemplate: string;
    outputFormat: 'json' | 'structured';
  } {
    // Extract ## System Message section
    const systemMatch = content.match(/## System Message\s*\n([\s\S]*?)(?=\n## |$)/);
    // Extract ## User Message Template section
    const userMatch = content.match(/## User Message Template\s*\n([\s\S]*?)(?=\n## |$)/);

    return {
      systemMessage: systemMatch?.[1]?.trim() ?? '',
      userMessageTemplate: userMatch?.[1]?.trim() ?? '',
      outputFormat: 'json',
    };
  }

  /**
   * Validate a methodology definition using shared Zod schema
   */
  private validateDefinition(
    definition: MethodologyDefinition,
    expectedId: string
  ): MethodologySchemaValidationResult {
    // Use shared schema validation (SSOT with validate-methodologies.ts)
    return validateMethodologySchema(definition, expectedId);
  }
}

/**
 * Factory function with default configuration
 */
export function createRuntimeMethodologyLoader(
  config?: RuntimeMethodologyLoaderConfig
): RuntimeMethodologyLoader {
  return new RuntimeMethodologyLoader(config);
}

// ============================================================================
// Singleton Instance for Convenience
// ============================================================================

let defaultLoader: RuntimeMethodologyLoader | null = null;

/**
 * Get the default runtime methodology loader instance
 *
 * Creates a singleton instance on first call.
 */
export function getDefaultRuntimeLoader(
  config?: RuntimeMethodologyLoaderConfig
): RuntimeMethodologyLoader {
  if (!defaultLoader) {
    defaultLoader = new RuntimeMethodologyLoader(config);
  }
  return defaultLoader;
}

/**
 * Reset the default loader (for testing)
 */
export function resetDefaultRuntimeLoader(): void {
  defaultLoader = null;
}
