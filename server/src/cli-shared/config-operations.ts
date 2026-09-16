/**
 * Config Operations — Pure file operations for config.json management.
 *
 * Uses only node:fs and node:path. No runtime dependencies.
 *
 * THE ONE FILE-SHAPE WRITER
 * `SafeConfigWriter` (mcp/tools/config-utils.ts) used to carry a second implementation of
 * read → set one dotted key → write, and its "read" was `configManager.getConfig()` — the
 * RESOLVED runtime object, not the file. Persisting that wrote back defaults nobody typed and
 * dropped whatever the loader does not map (`hooks`), so a one-key toggle rewrote the operator's
 * whole config.json. `SafeConfigWriter` now composes the functions below instead; this file is
 * where the document shape is read, mutated and written, and the only thing above it is the
 * schema check and the reload.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  CONFIG_KEY_TABLE,
  CONFIG_RESTART_REQUIRED_KEYS,
  CONFIG_VALID_KEYS,
  validateConfigInput,
  type ConfigKey,
  type ConfigLeafRule,
} from './config-input-validator.js';

// ── Result types ─────────────────────────────────────────────────────────────

export interface ConfigReadResult {
  success: boolean;
  config?: Record<string, unknown>;
  configPath?: string;
  error?: string;
}

export interface ConfigSetResult {
  success: boolean;
  key: string;
  previousValue?: unknown;
  newValue?: unknown;
  message: string;
  backupPath?: string;
  restartRequired?: boolean;
  error?: string;
}

export interface ConfigInitResult {
  success: boolean;
  created: boolean;
  configPath: string;
  message: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigKeyInfo {
  key: string;
  /** `integer` leaves report `'number'` — same flattening `ConfigInputValidationResult` uses. */
  type: 'string' | 'number' | 'boolean' | 'array';
  description: string;
  restartRequired: boolean;
}

// ── Path resolution ──────────────────────────────────────────────────────────

export function resolveConfigPath(workspace: string): string {
  return join(resolve(workspace), 'config.json');
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function readConfig(workspace: string): ConfigReadResult {
  return readConfigFile(resolveConfigPath(workspace));
}

/**
 * The config DOCUMENT at `configPath`, exactly as written — no defaults applied, no legacy
 * spellings folded, no wire keys renamed. Callers that mean to write the file back must read it
 * through here rather than through a resolved runtime config, or the write persists values the
 * operator never typed.
 */
export function readConfigFile(configPath: string): ConfigReadResult {
  if (!existsSync(configPath)) {
    return {
      success: false,
      configPath,
      error: `config.json not found at ${configPath}`,
    };
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    const config = JSON.parse(content) as Record<string, unknown>;
    return { success: true, config, configPath };
  } catch (error) {
    return {
      success: false,
      configPath,
      error: `Failed to parse config.json: ${error}`,
    };
  }
}

// ── Get value by dot-notation key ────────────────────────────────────────────

export function getConfigValue(config: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = config;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// ── Set value with validation + atomic write + backup ────────────────────────

export function setConfigValue(workspace: string, key: string, value: string): ConfigSetResult {
  return setConfigValueAtPath(resolveConfigPath(workspace), key, value);
}

/**
 * Same as {@link setConfigValue}, addressed by config FILE rather than by workspace. The MCP
 * writer holds a path (the loader resolved it, possibly from `MCP_CONFIG_PATH`), not a workspace,
 * so this is the seam the two surfaces share instead of each walking the document itself.
 */
export function setConfigValueAtPath(
  configPath: string,
  key: string,
  value: string
): ConfigSetResult {
  // Validate key and value
  const validation = validateConfigInput(key, value);
  if (!validation.valid) {
    return {
      success: false,
      key,
      message: `Validation failed: ${validation.error}`,
      error: validation.error,
    };
  }

  // Read current config
  const readResult = readConfigFile(configPath);
  if (!readResult.success || !readResult.config) {
    return {
      success: false,
      key,
      message: readResult.error ?? 'Failed to read config.json',
      error: readResult.error,
    };
  }

  const config = readResult.config;

  // Get previous value
  const previousValue = getConfigValue(config, key);

  // Apply change via deep-set
  const updatedConfig = applyConfigChange(config, key, validation.convertedValue);

  // Create backup
  const backupPath = backupConfig(configPath);

  // Write atomically
  try {
    writeConfigAtomic(configPath, updatedConfig);
  } catch (error) {
    return {
      success: false,
      key,
      message: `Failed to write config.json: ${error}`,
      backupPath,
      error: String(error),
    };
  }

  const restartRequired = CONFIG_RESTART_REQUIRED_KEYS.includes(key as ConfigKey);

  return {
    success: true,
    key,
    previousValue,
    newValue: validation.convertedValue,
    message: `Configuration updated: ${key} = ${JSON.stringify(validation.convertedValue)}`,
    backupPath,
    restartRequired,
  };
}

// ── Atomic write ─────────────────────────────────────────────────────────────

export function writeConfigAtomic(configPath: string, config: Record<string, unknown>): void {
  const tempPath = `${configPath}.tmp`;

  try {
    const configJson = JSON.stringify(config, null, 2) + '\n';
    writeFileSync(tempPath, configJson, 'utf8');

    // Verify the written file is valid JSON
    JSON.parse(readFileSync(tempPath, 'utf8'));

    // Atomic rename
    renameSync(tempPath, configPath);
  } catch (error) {
    // Clean up temp file
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// ── Backup ───────────────────────────────────────────────────────────────────

export function backupConfig(configPath: string): string {
  const backupPath = `${configPath}.backup.${Date.now()}`;
  copyFileSync(configPath, backupPath);
  return backupPath;
}

// ── Default config generation ────────────────────────────────────────────────

/**
 * Row 4.5 (ruling R46): the generator used to hand-restate fifteen leaves, five of them under
 * spellings `CONFIG_VALID_KEYS` had already retired — `server.transport` (transport is chosen per
 * launch, not a config key), `frameworks.systemPromptFrequency` /
 * `frameworks.styleGuidance` (the flat pre-nesting spelling; the current shape is
 * `frameworks.injection.systemPrompt.frequency` / `.styleGuidance.enabled`), and
 * `versioning.auto_version` / `versioning.max_versions` (the 4.x snake_case runtime names, not the
 * 5.0 file spellings `autoVersion` / `maxVersions`). A `cpm init` workspace shipped keys nothing
 * could set, silently.
 *
 * Code owns every default now (`DEFAULT_CONFIG` in `src/infra/config/index.ts`); a config.json —
 * generated or hand-edited — holds only OVERRIDES. So this generator produces exactly what the
 * shipped `server/config.json` holds: the two document-level keys that decide how the file is
 * READ (`$schema` for editor validation, `version` for the loader's shape routing), and nothing a
 * setting could drift from. `initConfig` below still writes this to disk — a fresh workspace still
 * needs a `config.json` a reader can find (`runtime/startup.ts` refuses a package root with none)
 * — it is just no longer a restatement of defaults an operator never typed.
 */
export function generateDefaultConfig(): Record<string, unknown> {
  return {
    $schema: './config.schema.json',
    version: 5,
  };
}

// ── Workspace config init ────────────────────────────────────────────────────

export function initConfig(targetPath: string): ConfigInitResult {
  const resolvedPath = resolve(targetPath);
  const configPath = join(resolvedPath, 'config.json');

  if (existsSync(configPath)) {
    return {
      success: true,
      created: false,
      configPath,
      message: 'config.json already exists, skipped',
    };
  }

  // Ensure parent directory exists
  const parentDir = dirname(configPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  try {
    const config = generateDefaultConfig();
    const configJson = JSON.stringify(config, null, 2) + '\n';
    writeFileSync(configPath, configJson, 'utf8');

    return {
      success: true,
      created: true,
      configPath,
      message: `Created config.json at ${configPath}`,
    };
  } catch (error) {
    return {
      success: false,
      created: false,
      configPath,
      message: `Failed to create config.json: ${error}`,
    };
  }
}

// ── Config validation ────────────────────────────────────────────────────────

export function validateConfig(workspace: string): ConfigValidationResult {
  const readResult = readConfig(workspace);
  if (!readResult.success || !readResult.config) {
    return {
      valid: false,
      errors: [readResult.error ?? 'Failed to read config.json'],
      warnings: [],
    };
  }

  return validateConfigDocument(readResult.config);
}

/**
 * Checks a whole config DOCUMENT against the generated key table: every leaf that names a known
 * key must hold a value the table accepts, and a leaf that names nothing is reported as a
 * warning. The `cpm config validate` command and the MCP config writer both read this, so a
 * document one surface accepts is a document the other accepts.
 */
export function validateConfigDocument(config: Record<string, unknown>): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateConfigObject(config, '', errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Document-level members that are legal in the file but are not settings — `$schema` is the
 * editor hint and `version` is the file-format discriminator the loader migrates. Both are
 * deliberately absent from `CONFIG_VALID_KEYS` (see `_generated/config-keys.ts`), so without this
 * skip a perfectly valid config.json would warn about two of its own keys.
 */
const DOCUMENT_META_KEYS: ReadonlySet<string> = new Set(['$schema', 'version']);

function validateConfigObject(
  obj: Record<string, unknown>,
  prefix: string,
  errors: string[],
  warnings: string[]
): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      validateConfigObject(value as Record<string, unknown>, fullKey, errors, warnings);
      continue;
    }

    if (DOCUMENT_META_KEYS.has(fullKey)) continue;

    // Check if this is a known leaf key
    if (CONFIG_VALID_KEYS.includes(fullKey as ConfigKey)) {
      const validation = validateConfigInput(fullKey, String(value));
      if (!validation.valid) {
        errors.push(`${fullKey}: ${validation.error}`);
      }
    } else {
      // Not a recognized key — could be a valid parent key or unknown
      const isParentOfKnown = CONFIG_VALID_KEYS.some((k) => k.startsWith(fullKey + '.'));
      if (!isParentOfKnown) {
        warnings.push(`${fullKey}: unknown configuration key`);
      }
    }
  }
}

// ── Key info ─────────────────────────────────────────────────────────────────

export function getConfigKeyInfo(): ConfigKeyInfo[] {
  return CONFIG_VALID_KEYS.map((key) => {
    const described = describeLeaf(CONFIG_KEY_TABLE[key]);
    return {
      key,
      type: described.type,
      description: described.description,
      restartRequired: CONFIG_RESTART_REQUIRED_KEYS.includes(key),
    };
  });
}

/**
 * The type and human description a key carries, derived from the generated table rather than from
 * a hand-kept list of `if (key === …)` branches. That list had gone stale in both directions —
 * it described `telemetry.mode` as "'on', 'off', or 'auto'" (the real values are off/traces/full)
 * and `identity.mode` as including 'strict' (retired), while suffix rules like `.maxTokens`
 * described keys that no longer existed at all.
 */
function describeLeaf(rule: ConfigLeafRule): { type: ConfigKeyInfo['type']; description: string } {
  if (rule.type === 'boolean') return { type: 'boolean', description: 'true or false' };

  if (rule.type === 'array') {
    const pattern = rule.items?.pattern;
    return {
      type: 'array',
      description:
        pattern === undefined
          ? 'comma-separated list'
          : `comma-separated list, each entry matching ${pattern}`,
    };
  }

  if (rule.type === 'string') {
    return {
      type: 'string',
      description:
        rule.enum === undefined ? 'text value' : rule.enum.map((value) => `'${value}'`).join(', '),
    };
  }

  const noun = rule.type === 'integer' ? 'whole number' : 'number';
  const { minimum, maximum } = rule;
  if (minimum !== undefined && maximum !== undefined) {
    return { type: 'number', description: `${noun}, ${minimum}-${maximum}` };
  }
  if (minimum !== undefined) return { type: 'number', description: `${noun} >= ${minimum}` };
  if (maximum !== undefined) return { type: 'number', description: `${noun} <= ${maximum}` };
  return { type: 'number', description: noun };
}

// ── Document mutation ────────────────────────────────────────────────────────

/**
 * A copy of `config` with exactly one dotted key set, creating intermediate objects as needed.
 *
 * Every other key survives, and so does key ORDER: `JSON.parse` preserves insertion order for
 * non-numeric keys, assigning an existing key leaves it where it was, and a genuinely new section
 * lands at the end. A reader diffing their config.json after a toggle sees one line change.
 */
export function applyConfigChange(
  config: Record<string, unknown>,
  key: string,
  value: unknown
): Record<string, unknown> {
  const newConfig = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const parts = key.split('.');
  let current: Record<string, unknown> = newConfig;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const finalKey = parts[parts.length - 1]!;
  current[finalKey] = value;

  return newConfig;
}
