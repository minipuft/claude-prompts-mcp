// @lifecycle canonical - Runtime YAML/JSON loading for gate definitions (replaces hardcoded paths)
/**
 * Runtime Gate Loader
 *
 * Loads gate definitions directly from YAML/JSON source files at runtime,
 * using multi-strategy path resolution that works in npx/npm installations.
 *
 * Features:
 * - Package.json-based path resolution (works for npx deep cache paths)
 * - Environment variable override (MCP_SERVER_ROOT)
 * - Walk-up directory resolution (development fallback)
 * - Validation of definitions on load
 * - Configurable caching for performance
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  loadYamlFileSync,
  discoverYamlDirectories,
} from '../../utils/yaml/index.js';
import { validateLightweightGateDefinition } from '../utils/gate-definition-schema.js';
import type { LightweightGateDefinition } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for RuntimeGateLoader
 */
export interface RuntimeGateLoaderConfig {
  /** Override default gates directory */
  gatesDir?: string;
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
  /** Gates directory being used */
  gatesDir: string;
}

/**
 * Runtime Gate Loader
 *
 * Provides runtime loading of gate definitions from YAML/JSON source files,
 * with multi-strategy path resolution for npm package compatibility.
 *
 * @example
 * ```typescript
 * const loader = new RuntimeGateLoader();
 *
 * // Discover available gates
 * const ids = loader.discoverGates();
 * // ['code-quality', 'security-awareness', ...]
 *
 * // Load a specific gate
 * const definition = loader.loadGate('code-quality');
 * ```
 */
export class RuntimeGateLoader {
  private cache = new Map<string, LightweightGateDefinition>();
  private stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };
  private gatesDir: string;
  private enableCache: boolean;
  private validateOnLoad: boolean;
  private debug: boolean;

  constructor(config: RuntimeGateLoaderConfig = {}) {
    this.gatesDir = config.gatesDir ?? this.resolveGatesDir();
    this.enableCache = config.enableCache ?? true;
    this.validateOnLoad = config.validateOnLoad ?? true;
    this.debug = config.debug ?? false;

    if (this.debug) {
      // Use stderr to avoid corrupting STDIO protocol
      console.error(`[RuntimeGateLoader] Using directory: ${this.gatesDir}`);
    }
  }

  /**
   * Load a gate definition by ID
   *
   * @param id - Gate ID (e.g., 'code-quality', 'security-awareness')
   * @returns Loaded definition or undefined if not found
   */
  loadGate(id: string): LightweightGateDefinition | undefined {
    const normalizedId = id.toLowerCase();

    // Check cache first
    if (this.enableCache && this.cache.has(normalizedId)) {
      this.stats.cacheHits++;
      return this.cache.get(normalizedId);
    }

    this.stats.cacheMisses++;

    try {
      // Try YAML first (new format), then JSON (legacy)
      const yamlPath = join(this.gatesDir, normalizedId, 'gate.yaml');
      const jsonFlatPath = join(this.gatesDir, `${normalizedId}.json`);
      const jsonNestedPath = join(this.gatesDir, normalizedId, 'gate.json');

      let definition: LightweightGateDefinition | undefined;

      if (existsSync(yamlPath)) {
        definition = loadYamlFileSync<LightweightGateDefinition>(yamlPath, { required: true });
      } else if (existsSync(jsonNestedPath)) {
        definition = JSON.parse(readFileSync(jsonNestedPath, 'utf8'));
      } else if (existsSync(jsonFlatPath)) {
        definition = JSON.parse(readFileSync(jsonFlatPath, 'utf8'));
      }

      if (!definition) {
        if (this.debug) {
          console.error(`[RuntimeGateLoader] Gate not found: ${id}`);
        }
        return undefined;
      }

      // Validate if enabled
      if (this.validateOnLoad) {
        const validation = validateLightweightGateDefinition(definition);
        if (!validation.success) {
          this.stats.loadErrors++;
          console.error(
            `[RuntimeGateLoader] Validation failed for '${id}':`,
            validation.errors?.join('; ')
          );
          return undefined;
        }
      }

      // Cache result
      if (this.enableCache) {
        this.cache.set(normalizedId, definition);
      }

      if (this.debug) {
        console.error(`[RuntimeGateLoader] Loaded: ${definition.name} (${normalizedId})`);
      }

      return definition;
    } catch (error) {
      this.stats.loadErrors++;
      console.error(`[RuntimeGateLoader] Failed to load '${id}':`, error);
      return undefined;
    }
  }

  /**
   * Discover all available gate IDs
   *
   * @returns Array of gate IDs that have valid definitions
   */
  discoverGates(): string[] {
    const gates: string[] = [];

    try {
      const entries = readdirSync(this.gatesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Check for gate.yaml or gate.json in subdirectory
          const yamlPath = join(this.gatesDir, entry.name, 'gate.yaml');
          const jsonPath = join(this.gatesDir, entry.name, 'gate.json');
          if (existsSync(yamlPath) || existsSync(jsonPath)) {
            gates.push(entry.name);
          }
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          // Legacy flat JSON files
          gates.push(entry.name.replace('.json', ''));
        }
      }
    } catch (error) {
      if (this.debug) {
        console.error(`[RuntimeGateLoader] Failed to discover gates:`, error);
      }
    }

    return gates;
  }

  /**
   * Load all available gates
   *
   * @returns Map of ID to definition for all successfully loaded gates
   */
  loadAllGates(): Map<string, LightweightGateDefinition> {
    const results = new Map<string, LightweightGateDefinition>();
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
   * @returns True if the gate has a valid definition file
   */
  gateExists(id: string): boolean {
    const normalizedId = id.toLowerCase();
    const yamlPath = join(this.gatesDir, normalizedId, 'gate.yaml');
    const jsonFlatPath = join(this.gatesDir, `${normalizedId}.json`);
    const jsonNestedPath = join(this.gatesDir, normalizedId, 'gate.json');
    return existsSync(yamlPath) || existsSync(jsonNestedPath) || existsSync(jsonFlatPath);
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
    };
  }

  /**
   * Get the gates directory being used
   */
  getGatesDir(): string {
    return this.gatesDir;
  }

  // ============================================================================
  // Private Implementation
  // ============================================================================

  /**
   * Resolve the gates directory from multiple possible locations
   */
  private resolveGatesDir(): string {
    // Priority 1: Environment variable
    const envRoot = process.env.MCP_SERVER_ROOT;
    if (envRoot) {
      const envPath = join(envRoot, 'gates');
      if (existsSync(envPath) && this.hasGateFiles(envPath)) {
        return envPath;
      }
      // Also check legacy src/gates/definitions path
      const legacyPath = join(envRoot, 'src', 'gates', 'definitions');
      if (existsSync(legacyPath)) {
        return legacyPath;
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
      // Check root-level gates/ folder
      const candidate = join(current, 'gates');
      if (existsSync(candidate) && this.hasGateFiles(candidate)) {
        return candidate;
      }
      // Check legacy src/gates/definitions path
      const legacyCandidate = join(current, 'src', 'gates', 'definitions');
      if (existsSync(legacyCandidate)) {
        return legacyCandidate;
      }
      current = dirname(current);
    }

    // Priority 4: Common relative paths from dist
    const relativePaths = [
      join(__dirname, '..', '..', '..', 'gates'),
      join(__dirname, '..', '..', 'gates'),
      join(__dirname, '..', 'definitions'),
      join(process.cwd(), 'gates'),
      join(process.cwd(), 'server', 'gates'),
      join(process.cwd(), 'src', 'gates', 'definitions'),
    ];

    for (const path of relativePaths) {
      if (existsSync(path)) {
        return path;
      }
    }

    // Fallback (may not exist)
    return join(__dirname, '..', '..', '..', 'gates');
  }

  /**
   * Resolve gates directory by finding our package.json
   * This handles npx installations where the package is deep in the cache
   */
  private resolveFromPackageJson(): string | null {
    let dir = __dirname;
    for (let i = 0; i < 15; i++) {
      const pkgPath = join(dir, 'package.json');
      try {
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
          if (pkg.name === 'claude-prompts-server') {
            // Check root-level gates/ folder first
            const gatesPath = join(dir, 'gates');
            if (existsSync(gatesPath) && this.hasGateFiles(gatesPath)) {
              return gatesPath;
            }
            // Fall back to src/gates/definitions for legacy structure
            const legacyPath = join(dir, 'src', 'gates', 'definitions');
            if (existsSync(legacyPath)) {
              return legacyPath;
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
   * Check if a directory contains gate definition files
   */
  private hasGateFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      return entries.some((entry) => {
        if (entry.isDirectory()) {
          // Check for gate.yaml or gate.json in subdirectory
          const yamlPath = join(dirPath, entry.name, 'gate.yaml');
          const jsonPath = join(dirPath, entry.name, 'gate.json');
          return existsSync(yamlPath) || existsSync(jsonPath);
        }
        // Check for flat JSON files
        return entry.isFile() && entry.name.endsWith('.json');
      });
    } catch {
      return false;
    }
  }
}

/**
 * Factory function with default configuration
 */
export function createRuntimeGateLoader(
  config?: RuntimeGateLoaderConfig
): RuntimeGateLoader {
  return new RuntimeGateLoader(config);
}

// ============================================================================
// Singleton Instance for Convenience
// ============================================================================

let defaultLoader: RuntimeGateLoader | null = null;

/**
 * Get the default runtime gate loader instance
 *
 * Creates a singleton instance on first call.
 */
export function getDefaultRuntimeGateLoader(): RuntimeGateLoader {
  if (!defaultLoader) {
    defaultLoader = new RuntimeGateLoader();
  }
  return defaultLoader;
}

/**
 * Reset the default loader (for testing)
 */
export function resetDefaultRuntimeGateLoader(): void {
  defaultLoader = null;
}
