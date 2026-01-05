// @lifecycle canonical - Unified resource manager pattern exports
/**
 * Resource Manager Module
 *
 * Provides a unified base class for resource managers:
 * - BaseResourceManager: Abstract base class with common patterns
 * - Types: Shared type definitions for managers
 *
 * Architecture:
 * ```
 *                 BaseResourceManager<T>
 *                        │
 *        ┌───────────────┼───────────────┐
 *        │               │               │
 *   GateManager   FrameworkManager  StyleManager
 * ```
 *
 * @example
 * ```typescript
 * import { BaseResourceManager, ResourceManagerStats } from './core/resource-manager';
 *
 * class MyManager extends BaseResourceManager<MyResource, MyEntry> {
 *   // Implement abstract methods...
 * }
 * ```
 */

export { BaseResourceManager } from './base-resource-manager.js';

export type {
  ResourceManagerStats,
  ResourceManagerStatus,
  BaseResourceManagerConfig,
  RegistryEntry,
  BaseRegistryStats,
} from './types.js';
