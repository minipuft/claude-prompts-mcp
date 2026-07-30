// @lifecycle canonical - Barrel exports for methodology registry and guides.
/**
 * Methodology System Index
 *
 * Centralized exports for the reorganized methodology system.
 * Uses YAML-based loading exclusively via RuntimeMethodologyLoader.
 */

// Export methodology registry
export { FrameworkRegistry, createMethodologyRegistry } from './registry.js';
export type { FrameworkRegistryConfig, FrameworkGuideEntry, FrameworkSource } from './registry.js';

// Export methodology interfaces
export * from './interfaces.js';

// Export methodology definition types (canonical source)
export type {
  FrameworkResourceDefinition,
  FrameworkGateDefinition,
  TemplateSuggestionDefinition,
  FrameworkElementsDefinition,
  ArgumentSuggestionDefinition,
} from './methodology-definition-types.js';

// Export data-driven methodology guide system
export { GenericMethodologyGuide, createGenericGuide } from './generic-methodology-guide.js';

// Export runtime YAML loader (canonical source for methodology loading)
export {
  RuntimeMethodologyLoader,
  createRuntimeMethodologyLoader,
  getDefaultRuntimeLoader,
  resetDefaultRuntimeLoader,
} from './runtime-methodology-loader.js';
export type {
  RuntimeMethodologyLoaderConfig,
  LoaderStats,
  FrameworkSchemaValidationResult as FrameworkDraftValidationResult,
} from './runtime-methodology-loader.js';

// Export hot reload coordinator
export {
  FrameworkHotReloadCoordinator,
  createMethodologyHotReloadCoordinator,
  createMethodologyHotReloadRegistration,
} from './methodology-hot-reload.js';
export type {
  FrameworkHotReloadConfig,
  FrameworkHotReloadStats,
  FrameworkHotReloadRegistration,
} from './methodology-hot-reload.js';

// Export shared Zod schema (SSOT for methodology validation)
export {
  FrameworkSchema,
  FrameworkGateSchema,
  TemplateSuggestionSchema,
  validateMethodologySchema,
} from './methodology-schema.js';
export type {
  FrameworkYaml,
  FrameworkGate,
  TemplateSuggestion,
  FrameworkSchemaValidationResult,
} from './methodology-schema.js';
