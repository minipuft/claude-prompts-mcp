// @lifecycle canonical - Shared types for BaseResourceManager and subclasses
/**
 * Resource Manager Types
 *
 * Provides type definitions for the unified resource manager pattern.
 * Builds on existing types from utils/resource-loader-types.ts.
 */

import type { RegistryEntry, BaseRegistryStats } from '../../utils/resource-loader-types.js';

// Re-export for convenience
export type { RegistryEntry, BaseRegistryStats };

/**
 * Extended statistics for resource managers
 */
export interface ResourceManagerStats extends BaseRegistryStats {
  /** Cache hit count */
  cacheHits: number;
  /** Cache miss count */
  cacheMisses: number;
  /** Number of load errors */
  loadErrors: number;
  /** Average load time in milliseconds */
  averageLoadTime: number;
}

/**
 * Status object returned by manager.getStatus()
 */
export interface ResourceManagerStatus {
  /** Whether the manager has been initialized */
  initialized: boolean;
  /** Whether the system is enabled (may be controlled by state manager) */
  enabled: boolean;
  /** Statistics (null if not initialized) */
  stats: ResourceManagerStats | null;
}

/**
 * Base configuration shared by all resource managers
 */
export interface BaseResourceManagerConfig {
  /** Enable debug logging */
  debug?: boolean;
}
