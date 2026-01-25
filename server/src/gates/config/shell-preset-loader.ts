// @lifecycle canonical - Loads shell verification presets from YAML configuration.
/**
 * Shell Preset Loader
 *
 * Loads shell verification presets from YAML configuration,
 * enabling runtime customization without code changes.
 *
 * @example
 * ```typescript
 * const presets = loadShellPresets();
 * const fastConfig = presets.fast;
 * // { maxIterations: 1, timeout: 30000 }
 * ```
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { loadYamlFileSync } from '../../utils/yaml/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Shell verification preset configuration.
 */
export interface ShellPresetConfig {
  readonly maxIterations: number;
  readonly timeout: number;
  readonly description?: string;
}

/**
 * All available shell presets.
 */
export interface ShellPresets {
  readonly fast: ShellPresetConfig;
  readonly full: ShellPresetConfig;
  readonly extended: ShellPresetConfig;
  [key: string]: ShellPresetConfig | undefined;
}

/**
 * Shell verification defaults.
 */
export interface ShellDefaults {
  readonly maxAttempts: number;
  readonly defaultTimeout: number;
  readonly maxTimeout: number;
}

/**
 * Full YAML configuration structure.
 */
interface ShellPresetsYaml {
  presets: Record<string, ShellPresetConfig>;
  defaults?: Partial<ShellDefaults>;
}

// Default presets as fallback if YAML loading fails
const DEFAULT_PRESETS: ShellPresets = {
  fast: {
    maxIterations: 1,
    timeout: 30000, // 30 seconds
  },
  full: {
    maxIterations: 5,
    timeout: 300000, // 5 minutes
  },
  extended: {
    maxIterations: 10,
    timeout: 600000, // 10 minutes
  },
};

const DEFAULT_SHELL_DEFAULTS: ShellDefaults = {
  maxAttempts: 5,
  defaultTimeout: 300000,
  maxTimeout: 600000,
};

// Cached values (loaded once)
let cachedPresets: ShellPresets | null = null;
let cachedDefaults: ShellDefaults | null = null;

/**
 * Resolve the path to the shell presets config file.
 */
function resolveConfigPath(): string | null {
  const candidates = [
    // From src/gates/config/ -> resources/gates/config/
    join(__dirname, '..', '..', '..', 'resources', 'gates', 'config', 'shell-presets.yaml'),
    // From dist/gates/config/ -> resources/gates/config/
    join(__dirname, '..', '..', '..', '..', 'resources', 'gates', 'config', 'shell-presets.yaml'),
    // Environment variable override
    process.env['MCP_SHELL_PRESETS_PATH'],
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Load shell presets from YAML configuration.
 * Falls back to default presets if loading fails.
 *
 * @param forceReload - If true, bypass cache and reload from file
 * @returns Shell presets object
 */
export function loadShellPresets(forceReload = false): ShellPresets {
  if (cachedPresets && !forceReload) {
    return cachedPresets;
  }

  const configPath = resolveConfigPath();

  if (!configPath) {
    console.warn('[ShellPresetLoader] Config not found, using defaults');
    cachedPresets = DEFAULT_PRESETS;
    cachedDefaults = DEFAULT_SHELL_DEFAULTS;
    return cachedPresets;
  }

  try {
    const config = loadYamlFileSync<ShellPresetsYaml>(configPath);

    if (!config?.presets) {
      console.warn('[ShellPresetLoader] Invalid config structure, using defaults');
      cachedPresets = DEFAULT_PRESETS;
      cachedDefaults = DEFAULT_SHELL_DEFAULTS;
      return cachedPresets;
    }

    // Merge loaded presets with defaults to ensure required presets exist
    cachedPresets = {
      fast: config.presets['fast'] ?? DEFAULT_PRESETS.fast,
      full: config.presets['full'] ?? DEFAULT_PRESETS.full,
      extended: config.presets['extended'] ?? DEFAULT_PRESETS.extended,
      ...config.presets,
    };

    // Load defaults
    if (config.defaults) {
      cachedDefaults = {
        maxAttempts: config.defaults.maxAttempts ?? DEFAULT_SHELL_DEFAULTS.maxAttempts,
        defaultTimeout: config.defaults.defaultTimeout ?? DEFAULT_SHELL_DEFAULTS.defaultTimeout,
        maxTimeout: config.defaults.maxTimeout ?? DEFAULT_SHELL_DEFAULTS.maxTimeout,
      };
    } else {
      cachedDefaults = DEFAULT_SHELL_DEFAULTS;
    }

    return cachedPresets;
  } catch (error) {
    console.error('[ShellPresetLoader] Failed to load config:', error);
    cachedPresets = DEFAULT_PRESETS;
    cachedDefaults = DEFAULT_SHELL_DEFAULTS;
    return cachedPresets;
  }
}

/**
 * Get shell verification defaults.
 */
export function getShellDefaults(): ShellDefaults {
  // Ensure presets are loaded (which also loads defaults)
  loadShellPresets();
  return cachedDefaults ?? DEFAULT_SHELL_DEFAULTS;
}

/**
 * Get a specific preset by name.
 * Returns undefined if preset doesn't exist.
 */
export function getShellPreset(name: string): ShellPresetConfig | undefined {
  const presets = loadShellPresets();
  return presets[name];
}

/**
 * Check if a preset name is valid.
 */
export function isValidPresetName(name: string): name is 'fast' | 'full' | 'extended' {
  const presets = loadShellPresets();
  return name in presets;
}

/**
 * Clear cached presets (useful for testing or hot reload).
 */
export function clearShellPresetCache(): void {
  cachedPresets = null;
  cachedDefaults = null;
}

/**
 * Get all preset names.
 */
export function getPresetNames(): string[] {
  return Object.keys(loadShellPresets());
}
