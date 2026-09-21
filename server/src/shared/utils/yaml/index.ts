// @lifecycle canonical - Barrel exports for YAML utilities
/**
 * YAML Utilities
 *
 * Provides runtime YAML parsing and file loading utilities.
 * Designed to serve both framework loading and future prompt YAML support.
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
 * // Discover framework directories
 * const frameworks = discoverYamlDirectories('./frameworks');
 * ```
 */

// Core parsing
export {
  parseYaml,
  parseYamlOrThrow,
  formatYamlError,
  type YamlParseOptions,
  type YamlParseError,
  type YamlParseResult,
} from './yaml-parser.js';

// `yaml-document-writer.js` is deliberately NOT re-exported here. It pulls in the `yaml` package,
// which costs 263,576 B unminified, and this barrel is on the `cpm` bundle's import graph through
// `cli-shared/resource-operations.ts`. Re-exporting it took that bundle from 683,130 B to
// 958,782 B against a 690,000 B budget — for a symbol no CLI command calls. Import the module
// directly; the four resource writers already do.

// File operations
export {
  loadYamlFile,
  loadYamlFileSync,
  loadYamlFileWithResult,
  discoverYamlFiles,
  discoverYamlDirectories,
  discoverNestedYamlDirectories,
  isYamlFile,
  getYamlBaseName,
  type YamlFileLoadOptions,
  type YamlFileLoadResult,
} from './yaml-file-loader.js';
