// @lifecycle canonical - Shared types and patterns for resource loaders (gates, methodologies, prompts)
/**
 * Resource Loader Types
 *
 * Defines common interfaces and patterns shared across resource loaders:
 * - GateDefinitionLoader
 * - RuntimeMethodologyLoader
 * - PromptLoader
 *
 * This module provides type-level unification without forcing inheritance,
 * following the "simplest solution" principle. Each loader can implement
 * these interfaces while maintaining domain-specific flexibility.
 *
 * @example
 * ```typescript
 * class MyLoader implements ResourceLoaderInterface<MyDefinition> {
 *   // Implement the interface methods
 * }
 * ```
 */
// ============================================
// Cache Management Utilities
// ============================================
/**
 * Simple in-memory cache with stats tracking
 *
 * @example
 * ```typescript
 * const cache = new ResourceCache<MyDefinition>();
 *
 * // Check cache
 * if (cache.has(id)) {
 *   return cache.get(id);
 * }
 *
 * // Load and cache
 * const def = await loadFromDisk(id);
 * cache.set(id, def);
 * ```
 */
export class ResourceCache {
    constructor() {
        this.cache = new Map();
        this.stats = { hits: 0, misses: 0 };
    }
    /**
     * Check if an item is cached
     */
    has(id) {
        return this.cache.has(id.toLowerCase());
    }
    /**
     * Get a cached item (records hit/miss)
     */
    get(id) {
        const key = id.toLowerCase();
        if (this.cache.has(key)) {
            this.stats.hits++;
            return this.cache.get(key);
        }
        this.stats.misses++;
        return undefined;
    }
    /**
     * Get a cached item without recording stats
     */
    peek(id) {
        return this.cache.get(id.toLowerCase());
    }
    /**
     * Set a cached item
     */
    set(id, value) {
        this.cache.set(id.toLowerCase(), value);
    }
    /**
     * Delete a cached item
     */
    delete(id) {
        return this.cache.delete(id.toLowerCase());
    }
    /**
     * Clear the entire cache
     */
    clear() {
        this.cache.clear();
    }
    /**
     * Get cache size
     */
    get size() {
        return this.cache.size;
    }
    /**
     * Get cache statistics
     */
    getStats() {
        return {
            size: this.cache.size,
            hits: this.stats.hits,
            misses: this.stats.misses,
        };
    }
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = { hits: 0, misses: 0 };
    }
}
/**
 * Simple in-memory implementation of IBaseRegistry
 *
 * Can be used as a base for specific registry implementations
 * or directly for simple use cases.
 *
 * @example
 * ```typescript
 * const registry = new SimpleRegistry<MyItem>();
 * registry.register('item-1', myItem, { source: 'user' });
 * const item = registry.get('item-1');
 * ```
 */
export class SimpleRegistry {
    constructor() {
        this.entries = new Map();
        this.initialized = false;
    }
    async initialize() {
        this.initialized = true;
    }
    register(id, item, options = {}) {
        const entry = {
            id: id.toLowerCase(),
            item,
            enabled: options.enabled ?? true,
            source: options.source ?? 'custom',
            registeredAt: new Date(),
        };
        if (options.metadata) {
            entry.metadata = options.metadata;
        }
        this.entries.set(entry.id, entry);
    }
    unregister(id) {
        return this.entries.delete(id.toLowerCase());
    }
    get(id) {
        const entry = this.entries.get(id.toLowerCase());
        return entry?.enabled ? entry.item : undefined;
    }
    getAll() {
        return Array.from(this.entries.values())
            .filter((e) => e.enabled)
            .map((e) => e.item);
    }
    getAllIds() {
        return Array.from(this.entries.keys());
    }
    has(id) {
        return this.entries.has(id.toLowerCase());
    }
    setEnabled(id, enabled) {
        const entry = this.entries.get(id.toLowerCase());
        if (entry) {
            entry.enabled = enabled;
            return true;
        }
        return false;
    }
    isEnabled(id) {
        const entry = this.entries.get(id.toLowerCase());
        return entry?.enabled ?? false;
    }
    getStats() {
        const entries = Array.from(this.entries.values());
        return {
            totalItems: entries.length,
            enabledItems: entries.filter((e) => e.enabled).length,
            disabledItems: entries.filter((e) => !e.enabled).length,
        };
    }
    clear() {
        this.entries.clear();
    }
    /**
     * Get a registry entry with metadata
     */
    getEntry(id) {
        return this.entries.get(id.toLowerCase());
    }
    /**
     * Get all entries (including disabled)
     */
    getAllEntries() {
        return Array.from(this.entries.values());
    }
}
// ============================================
// Type Guards
// ============================================
/**
 * Check if a validation result indicates success
 */
export function isResourceValidationSuccess(result) {
    return result.valid && result.errors.length === 0;
}
/**
 * Check if a validation result has warnings
 */
export function hasResourceValidationWarnings(result) {
    return result.warnings.length > 0;
}
//# sourceMappingURL=resource-loader-types.js.map