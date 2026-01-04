// @lifecycle canonical - Runtime YAML loading for gate definitions
/**
 * Runtime Gate Loader
 *
 * Loads gate definitions from YAML source files at runtime (gate.yaml + guidance.md),
 * using multi-strategy path resolution that works in npx/npm installations.
 *
 * Features:
 * - Package.json-based path resolution (works for npx deep cache paths)
 * - Environment variable override (MCP_SERVER_ROOT)
 * - Walk-up directory resolution (development fallback)
 * - Validation of definitions on load
 * - Configurable caching for performance
 * - Guidance.md file inlining support
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadYamlFileSync } from '../../utils/yaml/index.js';
import { validateLightweightGateDefinition } from '../utils/gate-definition-schema.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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
    constructor(config = {}) {
        this.cache = new Map();
        this.stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };
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
    loadGate(id) {
        const normalizedId = id.toLowerCase();
        // Check cache first
        if (this.enableCache && this.cache.has(normalizedId)) {
            this.stats.cacheHits++;
            return this.cache.get(normalizedId);
        }
        this.stats.cacheMisses++;
        try {
            // Load from YAML (primary format) or nested JSON (legacy support)
            const gateDir = join(this.gatesDir, normalizedId);
            const yamlPath = join(gateDir, 'gate.yaml');
            const jsonNestedPath = join(gateDir, 'gate.json');
            let definition;
            if (existsSync(yamlPath)) {
                definition = loadYamlFileSync(yamlPath, { required: true });
                // Inline guidance.md if guidanceFile is specified
                if (definition && definition.guidanceFile) {
                    const guidancePath = join(gateDir, definition.guidanceFile);
                    if (existsSync(guidancePath)) {
                        definition.guidance = readFileSync(guidancePath, 'utf8').trim();
                    }
                }
            }
            else if (existsSync(jsonNestedPath)) {
                definition = JSON.parse(readFileSync(jsonNestedPath, 'utf8'));
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
                    console.error(`[RuntimeGateLoader] Validation failed for '${id}':`, validation.errors?.join('; '));
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
        }
        catch (error) {
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
    discoverGates() {
        const gates = [];
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
                }
                // Note: Flat JSON files are no longer supported - use directory structure
            }
        }
        catch (error) {
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
    loadAllGates() {
        const results = new Map();
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
    gateExists(id) {
        const normalizedId = id.toLowerCase();
        const yamlPath = join(this.gatesDir, normalizedId, 'gate.yaml');
        const jsonNestedPath = join(this.gatesDir, normalizedId, 'gate.json');
        return existsSync(yamlPath) || existsSync(jsonNestedPath);
    }
    /**
     * Clear the cache (all or specific ID)
     *
     * @param id - Optional specific ID to clear; if omitted, clears all
     */
    clearCache(id) {
        if (id) {
            this.cache.delete(id.toLowerCase());
        }
        else {
            this.cache.clear();
        }
    }
    /**
     * Get loader statistics
     */
    getStats() {
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
    getGatesDir() {
        return this.gatesDir;
    }
    // ============================================================================
    // Private Implementation
    // ============================================================================
    /**
     * Resolve the gates directory from multiple possible locations
     *
     * Priority:
     *   1. MCP_GATES_PATH environment variable (new)
     *   2. MCP_SERVER_ROOT + '/gates' (legacy)
     *   3. Package.json resolution (npm/npx installs)
     *   4. Walk up from module location (development)
     *   5. Common relative paths
     *   6. Fallback
     */
    resolveGatesDir() {
        // Priority 1: Direct path environment variable (new)
        const envGates = process.env.MCP_GATES_PATH;
        if (envGates) {
            const resolvedPath = join(envGates); // Normalize
            if (existsSync(resolvedPath) && this.hasGateFiles(resolvedPath)) {
                if (this.debug) {
                    console.error(`[RuntimeGateLoader] Using MCP_GATES_PATH: ${resolvedPath}`);
                }
                return resolvedPath;
            }
        }
        // Priority 2: MCP_SERVER_ROOT environment variable
        const envRoot = process.env.MCP_SERVER_ROOT;
        if (envRoot) {
            const envPath = join(envRoot, 'gates');
            if (existsSync(envPath) && this.hasGateFiles(envPath)) {
                return envPath;
            }
        }
        // Priority 3: Find package.json with our package name (works for npx deep cache paths)
        const pkgResolved = this.resolveFromPackageJson();
        if (pkgResolved) {
            return pkgResolved;
        }
        // Priority 4: Walk up from current module location (fallback for development)
        let current = __dirname;
        for (let i = 0; i < 10; i++) {
            // Check root-level gates/ folder
            const candidate = join(current, 'gates');
            if (existsSync(candidate) && this.hasGateFiles(candidate)) {
                return candidate;
            }
            current = dirname(current);
        }
        // Priority 5: Common relative paths from dist
        const relativePaths = [
            join(__dirname, '..', '..', '..', 'gates'),
            join(__dirname, '..', '..', 'gates'),
            join(process.cwd(), 'gates'),
            join(process.cwd(), 'server', 'gates'),
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
    resolveFromPackageJson() {
        let dir = __dirname;
        for (let i = 0; i < 15; i++) {
            const pkgPath = join(dir, 'package.json');
            try {
                if (existsSync(pkgPath)) {
                    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
                    if (pkg.name === 'claude-prompts') {
                        // Check root-level gates/ folder
                        const gatesPath = join(dir, 'gates');
                        if (existsSync(gatesPath) && this.hasGateFiles(gatesPath)) {
                            return gatesPath;
                        }
                    }
                }
            }
            catch {
                // Ignore parse errors
            }
            const parent = dirname(dir);
            if (parent === dir)
                break;
            dir = parent;
        }
        return null;
    }
    /**
     * Check if a directory contains gate definition files
     */
    hasGateFiles(dirPath) {
        try {
            const entries = readdirSync(dirPath, { withFileTypes: true });
            return entries.some((entry) => {
                if (entry.isDirectory()) {
                    // Check for gate.yaml or gate.json in subdirectory
                    const yamlPath = join(dirPath, entry.name, 'gate.yaml');
                    const jsonPath = join(dirPath, entry.name, 'gate.json');
                    return existsSync(yamlPath) || existsSync(jsonPath);
                }
                return false;
            });
        }
        catch {
            return false;
        }
    }
}
/**
 * Factory function with default configuration
 */
export function createRuntimeGateLoader(config) {
    return new RuntimeGateLoader(config);
}
// ============================================================================
// Singleton Instance for Convenience
// ============================================================================
let defaultLoader = null;
/**
 * Get the default runtime gate loader instance
 *
 * Creates a singleton instance on first call.
 */
export function getDefaultRuntimeGateLoader() {
    if (!defaultLoader) {
        defaultLoader = new RuntimeGateLoader();
    }
    return defaultLoader;
}
/**
 * Reset the default loader (for testing)
 */
export function resetDefaultRuntimeGateLoader() {
    defaultLoader = null;
}
//# sourceMappingURL=runtime-gate-loader.js.map