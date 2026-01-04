// @lifecycle canonical - Barrel exports for YAML utilities
/**
 * YAML Utilities
 *
 * Provides runtime YAML parsing and file loading utilities.
 * Designed to serve both methodology loading and future prompt YAML support.
 *
 * @example
 * ```typescript
 * import { parseYaml, loadYamlFileSync, discoverYamlDirectories } from '../utils/yaml/index.js';
 *
 * // Parse YAML content
 * const result = parseYaml<Config>(yamlString);
 *
 * // Load YAML file
 * const config = loadYamlFileSync<Config>('config.yaml');
 *
 * // Discover methodology directories
 * const methodologies = discoverYamlDirectories('./methodologies');
 * ```
 */
// Core parsing
export { parseYaml, parseYamlOrThrow, serializeYaml, formatYamlError, } from './yaml-parser.js';
// File operations
export { loadYamlFile, loadYamlFileSync, loadYamlFileWithResult, discoverYamlFiles, discoverYamlDirectories, isYamlFile, getYamlBaseName, } from './yaml-file-loader.js';
//# sourceMappingURL=index.js.map