// @lifecycle canonical - Barrel exports for methodology registry and guides.
/**
 * Methodology System Index
 *
 * Centralized exports for the reorganized methodology system.
 * Uses YAML-based loading exclusively via RuntimeMethodologyLoader.
 */

// Export methodology registry
export { MethodologyRegistry, createMethodologyRegistry } from './registry.js';
export type {
  MethodologyRegistryConfig,
  MethodologyGuideEntry,
  MethodologySource,
} from './registry.js';

// Export methodology interfaces
export * from './interfaces.js';

// Export methodology definition types (canonical source)
export type {
  MethodologyDefinition,
  MethodologyGateDefinition,
  TemplateSuggestionDefinition,
  MethodologyElementsDefinition,
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
  MethodologySchemaValidationResult as MethodologyValidationResult,
} from './runtime-methodology-loader.js';

// Export hot reload coordinator
export {
  MethodologyHotReloadCoordinator,
  createMethodologyHotReloadCoordinator,
  createMethodologyHotReloadRegistration,
} from './methodology-hot-reload.js';
export type {
  MethodologyHotReloadConfig,
  MethodologyHotReloadStats,
  MethodologyHotReloadRegistration,
} from './methodology-hot-reload.js';

// Export shared Zod schema (SSOT for methodology validation)
export {
  MethodologySchema,
  MethodologyGateSchema,
  TemplateSuggestionSchema,
  validateMethodologySchema,
} from './methodology-schema.js';
export type {
  MethodologyYaml,
  MethodologyGate,
  TemplateSuggestion,
  MethodologySchemaValidationResult,
} from './methodology-schema.js';
