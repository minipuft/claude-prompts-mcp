// @lifecycle canonical - Style system barrel exports
/**
 * Style System
 *
 * Provides response style guidance through the # operator.
 *
 * Usage:
 * ```
 * #analytical >>report topic:'Q4 metrics'
 * #procedural >>tutorial subject:'React hooks'
 * ```
 *
 * Architecture:
 * - StyleManager: Orchestration and style selection
 * - StyleDefinitionLoader: YAML loading and caching
 * - StyleDefinitionSchema: Zod validation for style.yaml files
 *
 * Directory structure:
 * ```
 * server/styles/
 * ├── analytical/
 * │   ├── style.yaml
 * │   └── guidance.md
 * ├── procedural/
 * │   ├── style.yaml
 * │   └── guidance.md
 * └── ...
 * ```
 */
// Main manager
export { StyleManager, createStyleManager, } from './style-manager.js';
// Core components (re-export for convenience)
export { 
// Schema
StyleDefinitionSchema, StyleActivationSchema, validateStyleSchema, isValidStyleDefinition, 
// Loader
StyleDefinitionLoader, createStyleDefinitionLoader, getDefaultStyleDefinitionLoader, resetDefaultStyleDefinitionLoader, } from './core/index.js';
// Hot-reload support
export { StyleHotReloadCoordinator, createStyleHotReloadRegistration, createStyleHotReloadCoordinator, } from './hot-reload/index.js';
//# sourceMappingURL=index.js.map