// @lifecycle canonical - Barrel exports for framework registry and guides.
/**
 * Framework System Index
 *
 * Centralized exports for the reorganized framework system.
 * Uses YAML-based loading exclusively via RuntimeFrameworkLoader.
 */

// Export framework registry
export { FrameworkRegistry, createFrameworkRegistry } from './registry.js';
export type { FrameworkRegistryConfig, FrameworkGuideEntry, FrameworkSource } from './registry.js';

// Export framework interfaces
export * from './interfaces.js';

// Export framework definition types (canonical source)
export type {
  FrameworkResourceDefinition,
  FrameworkGateDefinition,
  TemplateSuggestionDefinition,
  FrameworkElementsDefinition,
  ArgumentSuggestionDefinition,
} from './framework-definition-types.js';

// Export data-driven framework guide system
export { GenericFrameworkGuide, createGenericGuide } from './generic-framework-guide.js';

// Export runtime YAML loader (canonical source for framework loading)
export {
  RuntimeFrameworkLoader,
  createRuntimeFrameworkLoader,
  getDefaultRuntimeLoader,
  resetDefaultRuntimeLoader,
} from './runtime-framework-loader.js';
export type {
  RuntimeFrameworkLoaderConfig,
  LoaderStats,
  FrameworkSchemaValidationResult as FrameworkDraftValidationResult,
} from './runtime-framework-loader.js';

// Export hot reload coordinator
export {
  FrameworkHotReloadCoordinator,
  createFrameworkHotReloadCoordinator,
  createFrameworkHotReloadRegistration,
} from './framework-hot-reload.js';
export type {
  FrameworkHotReloadConfig,
  FrameworkHotReloadStats,
  FrameworkHotReloadRegistration,
} from './framework-hot-reload.js';

// Export shared Zod schema (SSOT for framework validation)
export {
  FrameworkSchema,
  FrameworkGateSchema,
  TemplateSuggestionSchema,
  validateFrameworkSchema,
} from './framework-schema.js';
export type {
  FrameworkYaml,
  FrameworkGate,
  TemplateSuggestion,
  FrameworkSchemaValidationResult,
} from './framework-schema.js';
