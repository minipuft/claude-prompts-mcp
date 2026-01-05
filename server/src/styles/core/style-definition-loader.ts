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
import { loadYamlFileSync, discoverYamlDirectories } from '../../utils/yaml/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for StyleDefinitionLoader
 */
export interface StyleDefinitionLoaderConfig {
  /** Override default styles directory */
  stylesDir?: string;
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
  private enableCache: boolean;
  private validateOnLoad: boolean;
  private debug: boolean;

  constructor(config: StyleDefinitionLoaderConfig = {}) {
    this.stylesDir = config.stylesDir ?? this.resolveStylesDir();
    this.enableCache = config.enableCache ?? true;
    this.validateOnLoad = config.validateOnLoad ?? true;
    this.debug = config.debug ?? false;

    if (this.debug) {
      // Use stderr to avoid corrupting STDIO protocol
      console.error(`[StyleDefinitionLoader] Using directory: ${this.stylesDir}`);
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

    // Load from YAML directory
    const definition = this.loadFromYamlDir(normalizedId);

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
    const yamlIds = discoverYamlDirectories(this.stylesDir, 'style.yaml');
    return yamlIds.map((id) => id.toLowerCase()).sort();
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
    const yamlPath = join(this.stylesDir, normalizedId, 'style.yaml');
    return existsSync(yamlPath);
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
    };
  }

  /**
   * Get the styles directory being used
   */
  getStylesDir(): string {
    return this.stylesDir;
  }

  // ============================================================================
  // Private Implementation - YAML Loading
  // ============================================================================

  /**
   * Load a style from YAML directory format (styles/{id}/style.yaml)
   */
  private loadFromYamlDir(id: string): StyleDefinitionYaml | undefined {
    try {
      const styleDir = join(this.stylesDir, id);
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
      | string
      | undefined;
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
   *   1. MCP_STYLES_PATH environment variable
   *   2. Package.json resolution (npm/npx installs)
   *   3. Walk up from module location (development)
   *   4. Common relative paths (resources/styles first, then legacy styles)
   *   5. Fallback
   */
  private resolveStylesDir(): string {
    // Priority 1: Direct path environment variable
    const envStyles = process.env['MCP_STYLES_PATH'];
    if (envStyles) {
      const resolvedPath = join(envStyles);
      if (existsSync(resolvedPath) && this.hasYamlFiles(resolvedPath)) {
        if (this.debug) {
          console.error(`[StyleDefinitionLoader] Using MCP_STYLES_PATH: ${resolvedPath}`);
        }
        return resolvedPath;
      }
    }

    // Priority 2: Find package.json with our package name
    const pkgResolved = this.resolveFromPackageJson();
    if (pkgResolved) {
      return pkgResolved;
    }

    // Priority 3: Walk up from current module location
    let current = __dirname;
    for (let i = 0; i < 10; i++) {
      // Check resources/styles first (new structure)
      const resourcesCandidate = join(current, 'resources', 'styles');
      if (existsSync(resourcesCandidate) && this.hasYamlFiles(resourcesCandidate)) {
        return resourcesCandidate;
      }
      // Then check legacy styles location
      const candidate = join(current, 'styles');
      if (existsSync(candidate) && this.hasYamlFiles(candidate)) {
        return candidate;
      }
      current = dirname(current);
    }

    // Priority 4: Common relative paths from dist (resources/styles first)
    const relativePaths = [
      join(__dirname, '..', '..', '..', 'resources', 'styles'),
      join(__dirname, '..', '..', 'resources', 'styles'),
      join(process.cwd(), 'resources', 'styles'),
      join(process.cwd(), 'server', 'resources', 'styles'),
      // Legacy paths
      join(__dirname, '..', '..', '..', 'styles'),
      join(__dirname, '..', '..', 'styles'),
      join(process.cwd(), 'styles'),
      join(process.cwd(), 'server', 'styles'),
    ];

    for (const path of relativePaths) {
      if (existsSync(path) && this.hasYamlFiles(path)) {
        return path;
      }
    }

    // Fallback to new structure (may not exist yet)
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
export function getDefaultStyleDefinitionLoader(): StyleDefinitionLoader {
  if (!defaultLoader) {
    defaultLoader = new StyleDefinitionLoader();
  }
  return defaultLoader;
}

/**
 * Reset the default loader (useful for testing)
 */
export function resetDefaultStyleDefinitionLoader(): void {
  defaultLoader = null;
}
