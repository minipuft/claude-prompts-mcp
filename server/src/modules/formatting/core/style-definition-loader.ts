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
} from './style-schema.js';
import {
  loadYamlFileSync,
  discoverYamlDirectories,
  discoverNestedYamlDirectories,
} from '../../../shared/utils/yaml/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for StyleDefinitionLoader
 */
export interface StyleDefinitionLoaderConfig {
  /** Override default styles directory */
  stylesDir?: string;
  /** Additional directories to scan for style overlays (workspace resources) */
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
  private cache = new Map<string, StyleDefinitionYaml>();
  private stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };
  private stylesDir: string;
  private additionalStylesDirs: string[];
  private enableCache: boolean;
  private validateOnLoad: boolean;
  private debug: boolean;

  constructor(config: StyleDefinitionLoaderConfig = {}) {
    this.stylesDir = config.stylesDir ?? this.resolveStylesDir();
    this.additionalStylesDirs = (config.additionalStylesDirs ?? []).filter(
      (dir) => existsSync(dir) && dir !== this.stylesDir
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
  loadStyle(id: string): StyleDefinitionYaml | undefined {
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
   * Discover all available style IDs
   *
   * @returns Array of style IDs from YAML directories
   */
  discoverStyles(): string[] {
    // Primary: flat scan
    const primaryIds = discoverYamlDirectories(this.stylesDir, 'style.yaml');
    const idSet = new Set(primaryIds.map((id) => id.toLowerCase()));

    // Additional: nested scan (flat + grouped). Primary wins on conflict via Set.
    for (const dir of this.additionalStylesDirs) {
      const additionalIds = discoverNestedYamlDirectories(dir, 'style.yaml');
      for (const id of additionalIds) {
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
  loadAllStyles(): Map<string, StyleDefinitionYaml> {
    const results = new Map<string, StyleDefinitionYaml>();
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
    const normalizedId = id.toLowerCase();

    // Check primary
    if (existsSync(join(this.stylesDir, normalizedId, 'style.yaml'))) {
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

  /**
   * Attempt to load a style from additional directories.
   * Tries flat path first, then scans for grouped nesting.
   */
  private loadFromAdditionalDirs(id: string): StyleDefinitionYaml | undefined {
    const resolvedDir = this.findInAdditionalDirs(id);
    if (resolvedDir === undefined) return undefined;
    return this.loadFromYamlDir(id, resolvedDir);
  }

  /**
   * Find which additional directory contains a style ID.
   * Checks flat ({dir}/{id}/style.yaml) and grouped ({dir}/{group}/{id}/style.yaml).
   *
   * @returns The base directory to pass to loadFromYamlDir, or undefined
   */
  private findInAdditionalDirs(id: string): string | undefined {
    for (const dir of this.additionalStylesDirs) {
      // Flat: {dir}/{id}/style.yaml
      if (existsSync(join(dir, id, 'style.yaml'))) {
        return dir;
      }

      // Grouped: {dir}/{group}/{id}/style.yaml
      try {
        const groups = readdirSync(dir, { withFileTypes: true });
        for (const group of groups) {
          if (!group.isDirectory()) continue;
          if (existsSync(join(dir, group.name, id, 'style.yaml'))) {
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
  // Private Implementation - YAML Loading
  // ============================================================================

  /**
   * Load a style from YAML directory format ({baseDir}/{id}/style.yaml)
   *
   * @param id - Style ID
   * @param baseDir - Directory to load from (defaults to primary stylesDir)
   */
  private loadFromYamlDir(id: string, baseDir?: string): StyleDefinitionYaml | undefined {
    try {
      const styleDir = join(baseDir ?? this.stylesDir, id);
      const entryPath = join(styleDir, 'style.yaml');

      if (!existsSync(entryPath)) {
        if (this.debug) {
          console.error(`[StyleDefinitionLoader] YAML entry not found: ${entryPath}`);
        }
        return undefined;
      }

      // Load main style.yaml
      const definition = loadYamlFileSync<StyleDefinitionYaml>(entryPath, {
        required: true,
      });

      if (!definition) {
        return undefined;
      }

      // Inline referenced files (guidance.md)
      this.inlineReferencedFiles(definition, styleDir);

      // Validate if enabled
      if (this.validateOnLoad) {
        const validation = this.validateDefinition(definition, id);
        if (!validation.valid) {
          this.stats.loadErrors++;
          console.error(
            `[StyleDefinitionLoader] Validation failed for '${id}':`,
            validation.errors.join('; ')
          );
          return undefined;
        }
        if (validation.warnings.length > 0 && this.debug) {
          console.warn(
            `[StyleDefinitionLoader] Warnings for '${id}':`,
            validation.warnings.join('; ')
          );
        }
      }

      if (this.debug) {
        console.error(`[StyleDefinitionLoader] Loaded from YAML: ${definition.name} (${id})`);
      }

      return definition;
    } catch (error) {
      this.stats.loadErrors++;
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
