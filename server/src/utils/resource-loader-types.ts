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
// Shared Configuration Types
// ============================================

/**
 * Base configuration shared by all resource loaders
 */
export interface BaseLoaderConfig {
  /** Enable caching of loaded definitions (default: true) */
  enableCache?: boolean;
  /** Validate definitions on load (default: true) */
  validateOnLoad?: boolean;
  /** Log debug information (default: false) */
  debug?: boolean;
}

/**
 * Configuration for loaders that use YAML directory format
 */
export interface YamlLoaderConfig extends BaseLoaderConfig {
  /** Override default resource directory */
  resourceDir?: string;
  /** Entry file name (e.g., 'gate.yaml', 'methodology.yaml') */
  entryFileName?: string;
}

// ============================================
// Shared Statistics Types
// ============================================

/**
 * Base statistics shared by all resource loaders
 */
export interface BaseLoaderStats {
  /** Number of cached definitions */
  cacheSize: number;
  /** Cache hit count */
  cacheHits: number;
  /** Cache miss count */
  cacheMisses: number;
  /** Number of load errors encountered */
  loadErrors: number;
}

/**
 * Statistics for directory-based loaders
 */
export interface DirectoryLoaderStats extends BaseLoaderStats {
  /** Resource directory being used */
  resourceDir: string;
}

// ============================================
// Validation Types
// ============================================

/**
 * Standard validation result structure for resource loaders
 *
 * Note: Named ResourceValidationResult to avoid conflict with
 * ValidationResult from errorHandling.ts
 */
export interface ResourceValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors (blocking issues) */
  errors: string[];
  /** Validation warnings (non-blocking issues) */
  warnings: string[];
}

/**
 * Validation result with parsed data
 */
export interface ResourceValidationResultWithData<T> extends ResourceValidationResult {
  /** Parsed and validated data (undefined if validation failed) */
  data?: T;
}

// ============================================
// Loader Interface
// ============================================

/**
 * Common interface for resource loaders
 *
 * Each loader (gates, methodologies, prompts) should implement
 * this interface for consistency.
 *
 * @template T - The type of definition being loaded
 * @template TStats - The statistics type (extends BaseLoaderStats)
 */
export interface ResourceLoaderInterface<T, TStats extends BaseLoaderStats = BaseLoaderStats> {
  /**
   * Load a resource definition by ID
   *
   * @param id - Resource identifier
   * @returns Loaded definition or undefined if not found
   */
  load(id: string): T | undefined;

  /**
   * Load a resource definition by ID (async variant)
   *
   * @param id - Resource identifier
   * @returns Promise resolving to loaded definition or undefined
   */
  loadAsync?(id: string): Promise<T | undefined>;

  /**
   * Discover all available resource IDs
   *
   * @returns Array of resource IDs
   */
  discover(): string[];

  /**
   * Discover all available resource IDs (async variant)
   *
   * @returns Promise resolving to array of resource IDs
   */
  discoverAsync?(): Promise<string[]>;

  /**
   * Load all available resources
   *
   * @returns Map of ID to definition
   */
  loadAll(): Map<string, T>;

  /**
   * Load all available resources (async variant)
   *
   * @returns Promise resolving to map of ID to definition
   */
  loadAllAsync?(): Promise<Map<string, T>>;

  /**
   * Check if a resource exists
   *
   * @param id - Resource ID to check
   * @returns True if resource exists
   */
  exists(id: string): boolean;

  /**
   * Clear the cache
   *
   * @param id - Optional specific ID to clear; if omitted, clears all
   */
  clearCache(id?: string): void;

  /**
   * Get loader statistics
   */
  getStats(): TStats;
}

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
export class ResourceCache<T> {
  private cache = new Map<string, T>();
  private stats = { hits: 0, misses: 0 };

  /**
   * Check if an item is cached
   */
  has(id: string): boolean {
    return this.cache.has(id.toLowerCase());
  }

  /**
   * Get a cached item (records hit/miss)
   */
  get(id: string): T | undefined {
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
  peek(id: string): T | undefined {
    return this.cache.get(id.toLowerCase());
  }

  /**
   * Set a cached item
   */
  set(id: string, value: T): void {
    this.cache.set(id.toLowerCase(), value);
  }

  /**
   * Delete a cached item
   */
  delete(id: string): boolean {
    return this.cache.delete(id.toLowerCase());
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0 };
  }
}

// ============================================
// Registry Interface
// ============================================

/**
 * Base registry statistics
 */
export interface BaseRegistryStats {
  /** Total items in registry */
  totalItems: number;
  /** Number of enabled items */
  enabledItems: number;
  /** Number of disabled items */
  disabledItems: number;
}

/**
 * Registry entry wrapper with metadata
 */
export interface RegistryEntry<T> {
  /** The item itself */
  item: T;
  /** Item identifier */
  id: string;
  /** Whether the item is enabled */
  enabled: boolean;
  /** Source of the item (built-in, custom, user, etc.) */
  source: string;
  /** When the item was registered */
  registeredAt: Date;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Base registry interface for managing collections of resources
 *
 * Provides a common pattern for:
 * - PromptRegistry (prompts)
 * - GateRegistry (gates)
 * - MethodologyRegistry (frameworks)
 *
 * @template T - The type of item being managed
 * @template TStats - The statistics type
 */
export interface IBaseRegistry<T, TStats extends BaseRegistryStats = BaseRegistryStats> {
  /**
   * Initialize the registry
   */
  initialize(): Promise<void>;

  /**
   * Register an item
   *
   * @param id - Unique identifier for the item
   * @param item - The item to register
   * @param options - Registration options
   */
  register(
    id: string,
    item: T,
    options?: { source?: string; enabled?: boolean; metadata?: Record<string, unknown> }
  ): void;

  /**
   * Unregister an item
   *
   * @param id - Item identifier
   * @returns True if item was unregistered
   */
  unregister(id: string): boolean;

  /**
   * Get an item by ID
   *
   * @param id - Item identifier
   * @returns The item or undefined
   */
  get(id: string): T | undefined;

  /**
   * Get all registered items
   *
   * @returns Array of all items
   */
  getAll(): T[];

  /**
   * Get all registered item IDs
   *
   * @returns Array of IDs
   */
  getAllIds(): string[];

  /**
   * Check if an item is registered
   *
   * @param id - Item identifier
   * @returns True if registered
   */
  has(id: string): boolean;

  /**
   * Enable or disable an item
   *
   * @param id - Item identifier
   * @param enabled - Whether to enable
   * @returns True if state was changed
   */
  setEnabled(id: string, enabled: boolean): boolean;

  /**
   * Check if an item is enabled
   *
   * @param id - Item identifier
   * @returns True if enabled
   */
  isEnabled(id: string): boolean;

  /**
   * Get registry statistics
   */
  getStats(): TStats;

  /**
   * Clear all items from the registry
   */
  clear(): void;

  /**
   * Reload a specific item
   *
   * @param id - Item identifier
   * @returns True if reload successful
   */
  reload?(id: string): Promise<boolean>;

  /**
   * Reload all items
   */
  reloadAll?(): Promise<void>;
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
export class SimpleRegistry<T> implements IBaseRegistry<T> {
  protected entries = new Map<string, RegistryEntry<T>>();
  protected initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  register(
    id: string,
    item: T,
    options: { source?: string; enabled?: boolean; metadata?: Record<string, unknown> } = {}
  ): void {
    const entry: RegistryEntry<T> = {
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

  unregister(id: string): boolean {
    return this.entries.delete(id.toLowerCase());
  }

  get(id: string): T | undefined {
    const entry = this.entries.get(id.toLowerCase());
    return entry?.enabled ? entry.item : undefined;
  }

  getAll(): T[] {
    return Array.from(this.entries.values())
      .filter((e) => e.enabled)
      .map((e) => e.item);
  }

  getAllIds(): string[] {
    return Array.from(this.entries.keys());
  }

  has(id: string): boolean {
    return this.entries.has(id.toLowerCase());
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const entry = this.entries.get(id.toLowerCase());
    if (entry) {
      entry.enabled = enabled;
      return true;
    }
    return false;
  }

  isEnabled(id: string): boolean {
    const entry = this.entries.get(id.toLowerCase());
    return entry?.enabled ?? false;
  }

  getStats(): BaseRegistryStats {
    const entries = Array.from(this.entries.values());
    return {
      totalItems: entries.length,
      enabledItems: entries.filter((e) => e.enabled).length,
      disabledItems: entries.filter((e) => !e.enabled).length,
    };
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * Get a registry entry with metadata
   */
  getEntry(id: string): RegistryEntry<T> | undefined {
    return this.entries.get(id.toLowerCase());
  }

  /**
   * Get all entries (including disabled)
   */
  getAllEntries(): RegistryEntry<T>[] {
    return Array.from(this.entries.values());
  }
}

// ============================================
// Type Guards
// ============================================

/**
 * Check if a validation result indicates success
 */
export function isResourceValidationSuccess(result: ResourceValidationResult): boolean {
  return result.valid && result.errors.length === 0;
}

/**
 * Check if a validation result has warnings
 */
export function hasResourceValidationWarnings(result: ResourceValidationResult): boolean {
  return result.warnings.length > 0;
}
