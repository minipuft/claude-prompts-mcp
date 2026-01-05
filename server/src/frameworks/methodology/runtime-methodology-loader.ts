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
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

import {
  validateMethodologySchema,
  type MethodologySchemaValidationResult,
} from './methodology-schema.js';
import {
  loadYamlFileSync,
  discoverYamlDirectories,
  type YamlFileLoadOptions,
} from '../../utils/yaml/index.js';

import type { MethodologyDefinition } from './methodology-definition-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for RuntimeMethodologyLoader
 */
export interface RuntimeMethodologyLoaderConfig {
  /** Override default methodologies directory */
  methodologiesDir?: string;
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
  private enableCache: boolean;
  private validateOnLoad: boolean;
  private debug: boolean;

  constructor(config: RuntimeMethodologyLoaderConfig = {}) {
    this.methodologiesDir = config.methodologiesDir ?? this.resolveMethodologiesDir();
    this.enableCache = config.enableCache ?? true;
    this.validateOnLoad = config.validateOnLoad ?? true;
    this.debug = config.debug ?? false;

    if (this.debug) {
      // Use stderr to avoid corrupting STDIO protocol
      console.error(`[RuntimeMethodologyLoader] Using directory: ${this.methodologiesDir}`);
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

    try {
      const methodologyDir = join(this.methodologiesDir, normalizedId);
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
        const validation = this.validateDefinition(definition, normalizedId);
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

      // Cache result
      if (this.enableCache) {
        this.cache.set(normalizedId, definition);
      }

      if (this.debug) {
        console.error(`[RuntimeMethodologyLoader] Loaded: ${definition.name} (${normalizedId})`);
      }

      return definition;
    } catch (error) {
      this.stats.loadErrors++;
      console.error(`[RuntimeMethodologyLoader] Failed to load '${id}':`, error);
      return undefined;
    }
  }

  /**
   * Discover all available methodology IDs
   *
   * @returns Array of methodology IDs that have valid entry points
   */
  discoverMethodologies(): string[] {
    return discoverYamlDirectories(this.methodologiesDir, 'methodology.yaml');
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
    const entryPath = join(this.methodologiesDir, normalizedId, 'methodology.yaml');
    return existsSync(entryPath);
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
    };
  }

  /**
   * Get the methodologies directory being used
   */
  getMethodologiesDir(): string {
    return this.methodologiesDir;
  }

  // ============================================================================
  // Private Implementation
  // ============================================================================

  /**
   * Resolve the methodologies directory from multiple possible locations
   *
   * Priority:
   *   1. MCP_METHODOLOGIES_PATH environment variable
   *   2. Package.json resolution (npm/npx installs)
   *   3. Walk up from module location (development)
   *   4. Common relative paths (resources/methodologies first, then legacy)
   *   5. Fallback
   */
  private resolveMethodologiesDir(): string {
    // Priority 1: Direct path environment variable
    const envMethodologies = process.env['MCP_METHODOLOGIES_PATH'];
    if (envMethodologies) {
      const resolvedPath = join(envMethodologies); // Normalize
      if (existsSync(resolvedPath) && this.hasYamlFiles(resolvedPath)) {
        if (this.debug) {
          console.error(`[RuntimeMethodologyLoader] Using MCP_METHODOLOGIES_PATH: ${resolvedPath}`);
        }
        return resolvedPath;
      }
    }

    // Priority 2: Find package.json with our package name (works for npx deep cache paths)
    const pkgResolved = this.resolveFromPackageJson();
    if (pkgResolved) {
      return pkgResolved;
    }

    // Priority 3: Walk up from current module location (fallback for development)
    let current = __dirname;
    for (let i = 0; i < 10; i++) {
      // Check resources/methodologies first (new structure)
      const resourcesCandidate = join(current, 'resources', 'methodologies');
      if (existsSync(resourcesCandidate) && this.hasYamlFiles(resourcesCandidate)) {
        return resourcesCandidate;
      }
      // Then check legacy location
      const candidate = join(current, 'methodologies');
      if (existsSync(candidate) && this.hasYamlFiles(candidate)) {
        return candidate;
      }
      current = dirname(current);
    }

    // Priority 4: Common relative paths from dist (resources/methodologies first)
    const relativePaths = [
      join(__dirname, '..', '..', '..', 'resources', 'methodologies'),
      join(__dirname, '..', '..', 'resources', 'methodologies'),
      join(process.cwd(), 'resources', 'methodologies'),
      join(process.cwd(), 'server', 'resources', 'methodologies'),
      // Legacy paths
      join(__dirname, '..', '..', '..', 'methodologies'),
      join(__dirname, '..', '..', 'methodologies'),
      join(process.cwd(), 'methodologies'),
      join(process.cwd(), 'server', 'methodologies'),
    ];

    for (const path of relativePaths) {
      if (existsSync(path) && this.hasYamlFiles(path)) {
        return path;
      }
    }

    // Fallback to new structure (may not exist)
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
    // Use shared schema validation (SSOT with validate-methodologies.js)
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
export function getDefaultRuntimeLoader(): RuntimeMethodologyLoader {
  if (!defaultLoader) {
    defaultLoader = new RuntimeMethodologyLoader();
  }
  return defaultLoader;
}

/**
 * Reset the default loader (for testing)
 */
export function resetDefaultRuntimeLoader(): void {
  defaultLoader = null;
}
