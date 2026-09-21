// @lifecycle canonical - Shared types and patterns for resource loaders (gates, frameworks, prompts)
/**
 * Resource Loader Types
 *
 * Defines common interfaces and patterns shared across resource loaders:
 * - GateDefinitionLoader
 * - RuntimeFrameworkLoader
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
  /** Entry file name (e.g., 'gate.yaml', 'framework.yaml') */
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
 * Each loader (gates, frameworks, prompts) should implement
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
