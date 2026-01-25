// @lifecycle canonical - Gate system configuration exports.
/**
 * Gate Configuration Module
 *
 * Exports configuration loaders for the gate system.
 */

export {
  loadVerdictPatterns,
  getVerdictValidationSettings,
  clearVerdictPatternCache,
  getPatternsByPriority,
  isPatternRestrictedToSource,
  type VerdictPattern,
  type VerdictPatternPriority,
} from './verdict-pattern-loader.js';

export {
  loadShellPresets,
  getShellDefaults,
  getShellPreset,
  isValidPresetName,
  clearShellPresetCache,
  getPresetNames,
  type ShellPresetConfig,
  type ShellPresets,
  type ShellDefaults,
} from './shell-preset-loader.js';
