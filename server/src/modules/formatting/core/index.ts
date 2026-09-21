// @lifecycle canonical - Core style system barrel exports
/**
 * Core Style System Exports
 *
 * Provides low-level components for style definition loading and validation.
 *
 * @see ../index.ts for the main style system exports
 */

// Schema and validation
export {
  StyleDefinitionSchema,
  StyleActivationSchema,
  StyleToolDescriptionSchema,
  validateStyleSchema,
  isValidStyleDefinition,
  type StyleDefinitionYaml,
  type LoadedStyleDefinition,
  type StyleActivationYaml,
  type StyleToolDescriptionYaml,
  type StyleSchemaValidationResult,
} from './style-schema.js';

// Loader
export {
  StyleDefinitionLoader,
  createStyleDefinitionLoader,
  getDefaultStyleDefinitionLoader,
  resetDefaultStyleDefinitionLoader,
} from './style-definition-loader.js';
