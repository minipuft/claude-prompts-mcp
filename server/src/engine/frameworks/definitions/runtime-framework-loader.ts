// @lifecycle canonical - Runtime YAML loading for frameworks (replaces build-time compilation)
/**
 * Runtime Framework Loader
 *
 * Loads framework definitions directly from YAML source files at runtime,
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
  validateFrameworkSchema,
  validatePhasesSchema,
  type FrameworkSchemaValidationResult,
} from './framework-schema.js';

import type { FrameworkResourceDefinition } from './framework-definition-types.js';

import {
  loadYamlFileSync,
  discoverYamlDirectories,
  discoverNestedYamlDirectories,
} from '#shared/utils/yaml/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for RuntimeFrameworkLoader
 */
export interface RuntimeFrameworkLoaderConfig {
  /** Override default frameworks directory */
  frameworksDir?: string;
  /** Additional directories to scan for framework overlays (workspace resources) */
  additionalFrameworksDirs?: string[];
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
  /** Frameworks directory being used */
  frameworksDir: string;
  /** Additional overlay directories */
  additionalFrameworksDirs: string[];
}

// FrameworkSchemaValidationResult is imported from framework-schema.ts
export type { FrameworkSchemaValidationResult } from './framework-schema.js';

/**
 * Runtime Framework Loader
 *
 * Provides runtime loading of framework definitions from YAML source files,
 * replacing the build-time compilation step.
 *
 * @example
 * ```typescript
 * const loader = new RuntimeFrameworkLoader();
 *
 * // Discover available frameworks
 * const ids = loader.discoverFrameworks();
 * // ['cageerf', 'react', '5w1h', 'scamper']
 *
 * // Load a specific framework
 * const definition = loader.loadFramework('cageerf');
 * ```
 */
export class RuntimeFrameworkLoader {
  private cache = new Map<string, FrameworkResourceDefinition>();
  private stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };
  private frameworksDir: string;
  private additionalFrameworksDirs: string[];
  private enableCache: boolean;
  private validateOnLoad: boolean;
  private debug: boolean;

  constructor(config: RuntimeFrameworkLoaderConfig = {}) {
    this.frameworksDir = config.frameworksDir ?? this.resolveFrameworksDir();
    this.additionalFrameworksDirs = (config.additionalFrameworksDirs ?? []).filter(
      (dir) => existsSync(dir) && dir !== this.frameworksDir
    );
    this.enableCache = config.enableCache ?? true;
    this.validateOnLoad = config.validateOnLoad ?? true;
    this.debug = config.debug ?? false;

    if (this.debug) {
      // Use stderr to avoid corrupting STDIO protocol
      console.error(`[RuntimeFrameworkLoader] Using directory: ${this.frameworksDir}`);
      if (this.additionalFrameworksDirs.length > 0) {
        console.error(
          `[RuntimeFrameworkLoader] Additional directories: ${this.additionalFrameworksDirs.join(', ')}`
        );
      }
    }
  }

  /**
   * Load a framework definition by ID
   *
   * @param id - Framework ID (e.g., 'cageerf', 'react')
   * @returns Loaded definition or undefined if not found
   */
  loadFramework(id: string): FrameworkResourceDefinition | undefined {
    const normalizedId = id.toLowerCase();

    // Check cache first
    if (this.enableCache && this.cache.has(normalizedId)) {
      this.stats.cacheHits++;
      return this.cache.get(normalizedId);
    }

    this.stats.cacheMisses++;

    // Load from primary directory, then fall through to additional dirs
    const definition =
      this.loadFromDir(normalizedId, this.frameworksDir) ??
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
   * Discover all available framework IDs
   *
   * @returns Array of framework IDs that have valid entry points
   */
  discoverFrameworks(): string[] {
    // Primary: flat scan
    const primaryIds = discoverYamlDirectories(this.frameworksDir, 'framework.yaml');
    const idSet = new Set(primaryIds.map((id) => id.toLowerCase()));

    // Additional: nested scan (flat + grouped). Primary wins on conflict via Set.
    for (const dir of this.additionalFrameworksDirs) {
      const additionalIds = discoverNestedYamlDirectories(dir, 'framework.yaml');
      for (const id of additionalIds) {
        idSet.add(id.toLowerCase());
      }
    }

    return Array.from(idSet).sort();
  }

  /**
   * Load all available frameworks
   *
   * @returns Map of ID to definition for all successfully loaded frameworks
   */
  loadAllFrameworks(): Map<string, FrameworkResourceDefinition> {
    const results = new Map<string, FrameworkResourceDefinition>();
    const ids = this.discoverFrameworks();

    for (const id of ids) {
      const definition = this.loadFramework(id);
      if (definition) {
        results.set(id, definition);
      }
    }

    return results;
  }

  /**
   * Check if a framework exists
   *
   * @param id - Framework ID to check
   * @returns True if the framework has a valid entry point
   */
  frameworkExists(id: string): boolean {
    const normalizedId = id.toLowerCase();

    // Check primary
    if (existsSync(join(this.frameworksDir, normalizedId, 'framework.yaml'))) {
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
      frameworksDir: this.frameworksDir,
      additionalFrameworksDirs: this.additionalFrameworksDirs,
    };
  }

  /**
   * Get the frameworks directory being used
   */
  getFrameworksDir(): string {
    return this.frameworksDir;
  }

  /**
   * Get all directories that should be watched for changes (primary + additional)
   */
  getWatchDirectories(): string[] {
    return [this.frameworksDir, ...this.additionalFrameworksDirs];
  }

  // ============================================================================
  // Private Implementation - Overlay Loading
  // ============================================================================

  /**
   * Load a framework from a specific base directory
   */
  private loadFromDir(id: string, baseDir: string): FrameworkResourceDefinition | undefined {
    try {
      const frameworkDir = join(baseDir, id);
      const entryPath = join(frameworkDir, 'framework.yaml');

      if (!existsSync(entryPath)) {
        if (this.debug) {
          console.error(`[RuntimeFrameworkLoader] Entry point not found: ${entryPath}`);
        }
        return undefined;
      }

      // Load main framework.yaml
      const definition = loadYamlFileSync<FrameworkResourceDefinition>(entryPath, {
        required: true,
      });

      if (!definition) {
        return undefined;
      }

      // Inline referenced files
      this.inlineReferencedFiles(definition, frameworkDir);

      // Validate if enabled
      if (this.validateOnLoad) {
        const validation = this.validateDefinition(definition, id);
        if (!validation.valid) {
          this.stats.loadErrors++;
          console.error(
            `[RuntimeFrameworkLoader] Validation failed for '${id}':`,
            validation.errors.join('; ')
          );
          return undefined;
        }
        if (validation.warnings.length > 0) {
          console.warn(
            `[RuntimeFrameworkLoader] Warnings for '${id}':`,
            validation.warnings.join('; ')
          );
        }

        // Validate the inlined phases.yaml content (F1: previously dead code —
        // validatePhasesSchema had zero callers, so a guards block with no
        // section_header never reached this check despite existing as an ERROR).
        if (definition.phases) {
          const phasesValidation = this.validatePhases(definition.phases);
          if (!phasesValidation.valid) {
            this.stats.loadErrors++;
            // eslint-disable-next-line no-console -- matches this file's stderr-logging convention
            console.error(
              `[RuntimeFrameworkLoader] Phases validation failed for '${id}':`,
              phasesValidation.errors.join('; ')
            );
            return undefined;
          }
          if (phasesValidation.warnings.length > 0) {
            // eslint-disable-next-line no-console -- matches this file's stderr-logging convention
            console.warn(
              `[RuntimeFrameworkLoader] Phases warnings for '${id}':`,
              phasesValidation.warnings.join('; ')
            );
          }
        }
      }

      if (this.debug) {
        console.error(`[RuntimeFrameworkLoader] Loaded: ${definition.name} (${id})`);
      }

      return definition;
    } catch (error) {
      this.stats.loadErrors++;
      console.error(`[RuntimeFrameworkLoader] Failed to load '${id}':`, error);
      return undefined;
    }
  }

  /**
   * Attempt to load a framework from additional directories.
   * Tries flat path first, then scans for grouped nesting.
   */
  private loadFromAdditionalDirs(id: string): FrameworkResourceDefinition | undefined {
    const resolvedDir = this.findInAdditionalDirs(id);
    if (resolvedDir === undefined) return undefined;
    return this.loadFromDir(id, resolvedDir);
  }

  /**
   * Find which additional directory contains a framework ID.
   * Checks flat ({dir}/{id}/framework.yaml) and grouped ({dir}/{group}/{id}/framework.yaml).
   *
   * @returns The base directory to pass to loadFromDir, or undefined
   */
  private findInAdditionalDirs(id: string): string | undefined {
    for (const dir of this.additionalFrameworksDirs) {
      // Flat: {dir}/{id}/framework.yaml
      if (existsSync(join(dir, id, 'framework.yaml'))) {
        return dir;
      }

      // Grouped: {dir}/{group}/{id}/framework.yaml
      try {
        const groups = readdirSync(dir, { withFileTypes: true });
        for (const group of groups) {
          if (!group.isDirectory()) continue;
          if (existsSync(join(dir, group.name, id, 'framework.yaml'))) {
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
   * Resolve the frameworks directory from multiple possible locations
   *
   * Priority:
   *   1. Package.json resolution (npm/npx installs)
   *   3. Walk up from module location (development)
   *   4. Common relative paths (resources/frameworks first, then legacy)
   *   5. Fallback
   */
  private resolveFrameworksDir(): string {
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
      const resourcesCandidate = join(current, 'resources', 'frameworks');
      if (existsSync(resourcesCandidate) && this.hasYamlFiles(resourcesCandidate)) {
        return resourcesCandidate;
      }
      current = dirname(current);
    }

    // Fallback
    return join(__dirname, '..', '..', '..', 'resources', 'frameworks');
  }

  /**
   * Resolve frameworks directory by finding our package.json
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
            // Check resources/frameworks first (new structure)
            const resourcesFrameworksPath = join(dir, 'resources', 'frameworks');
            if (existsSync(resourcesFrameworksPath) && this.hasYamlFiles(resourcesFrameworksPath)) {
              return resourcesFrameworksPath;
            }
            // Then check legacy location
            const frameworksPath = join(dir, 'frameworks');
            if (existsSync(frameworksPath) && this.hasYamlFiles(frameworksPath)) {
              return frameworksPath;
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
   * Check if a directory contains YAML framework files
   */
  private hasYamlFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      // Check for at least one subdirectory with framework.yaml
      return entries.some((entry) => {
        if (!entry.isDirectory()) return false;
        const entryPath = join(dirPath, entry.name, 'framework.yaml');
        return existsSync(entryPath);
      });
    } catch {
      return false;
    }
  }

  /**
   * Inline referenced files into the definition
   */
  private inlineReferencedFiles(definition: any, frameworkDir: string): void {
    // Inline phases.yaml if referenced
    if (definition.phasesFile) {
      const phasesPath = join(frameworkDir, definition.phasesFile);
      if (existsSync(phasesPath)) {
        try {
          const phases = loadYamlFileSync(phasesPath);
          if (phases) {
            definition.phases = phases;
          }
        } catch (error) {
          console.warn(
            `[RuntimeFrameworkLoader] Failed to inline phases from ${phasesPath}:`,
            error
          );
        }
      }
      delete definition.phasesFile;
    }

    // Inline judge-prompt.md if referenced
    if (definition.judgePromptFile) {
      const judgePath = join(frameworkDir, definition.judgePromptFile);
      if (existsSync(judgePath)) {
        try {
          const content = readFileSync(judgePath, 'utf-8');
          definition.judgePrompt = this.parseJudgePrompt(content);
        } catch (error) {
          console.warn(
            `[RuntimeFrameworkLoader] Failed to inline judge prompt from ${judgePath}:`,
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
   * Validate a framework definition using shared Zod schema
   */
  private validateDefinition(
    definition: FrameworkResourceDefinition,
    expectedId: string
  ): FrameworkSchemaValidationResult {
    // Use shared schema validation (SSOT with validate-frameworks.ts)
    return validateFrameworkSchema(definition, expectedId);
  }

  /**
   * Validate the inlined phases.yaml content using the shared Zod schema.
   *
   * Runs the phase-guard coherence checks (guards without section_header,
   * duplicate order, min_length > max_length) that ship in
   * `validatePhasesSchema` but were never wired to a caller (F1).
   */
  private validatePhases(phases: unknown): FrameworkSchemaValidationResult {
    return validatePhasesSchema(phases);
  }
}

/**
 * Factory function with default configuration
 */
export function createRuntimeFrameworkLoader(
  config?: RuntimeFrameworkLoaderConfig
): RuntimeFrameworkLoader {
  return new RuntimeFrameworkLoader(config);
}

// ============================================================================
// Singleton Instance for Convenience
// ============================================================================

let defaultLoader: RuntimeFrameworkLoader | null = null;

/**
 * Get the default runtime framework loader instance
 *
 * Creates a singleton instance on first call.
 */
export function getDefaultRuntimeLoader(
  config?: RuntimeFrameworkLoaderConfig
): RuntimeFrameworkLoader {
  // A caller that SUPPLIES config is the composition root asserting the resolved directories;
  // a caller that omits it is a consumer asking for whatever was established. The old form
  // (`if (!defaultLoader)`) discarded config whenever anything had already touched the singleton,
  // so framework directory resolution silently depended on call order — and the losing branch
  // falls back to `resolveFrameworksDir()`, which finds the package tree.
  //
  // That made reads ignore `MCP_RESOURCES_PATH` exactly as writes did. The two agreed only
  // because both were wrong, which is why it stayed invisible until the write path was fixed
  // (T1.10): correcting one side alone turned a silent mismatch into a failed registration.
  //
  // `module-initializer.ts:219` is the only caller that passes config.
  if (!defaultLoader || config !== undefined) {
    defaultLoader = new RuntimeFrameworkLoader(config);
  }
  return defaultLoader;
}

/**
 * Reset the default loader (for testing)
 */
export function resetDefaultRuntimeLoader(): void {
  defaultLoader = null;
}
