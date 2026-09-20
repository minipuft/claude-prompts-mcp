/**
 * Config Operations — Pure file operations for the workspace config file.
 *
 * Uses node:fs, node:path and `jsonc-parser`. No runtime dependencies.
 *
 * THE ONE FILE-SHAPE WRITER
 * `SafeConfigWriter` (mcp/tools/config-utils.ts) used to carry a second implementation of
 * read → set one dotted key → write, and its "read" was `configManager.getConfig()` — the
 * RESOLVED runtime object, not the file. Persisting that wrote back defaults nobody typed and
 * dropped whatever the loader does not map (`hooks`), so a one-key toggle rewrote the operator's
 * whole config file. `SafeConfigWriter` now composes the functions below instead; this file is
 * where the document shape is read, mutated and written, and the only thing above it is the
 * schema check and the reload.
 *
 * TWO NAMES, TWO DIALECTS, ONE EDITOR
 * A workspace's config is `config.jsonc` or `config.json` — the first wins where both are
 * readable, and holding both is refused rather than guessed at. Every write to a file the user
 * already owns edits that file's TEXT in place (`jsonc-parser`), never re-serializes a parsed
 * document: a re-serialized `.jsonc` loses every comment the operator wrote, and a re-serialized
 * `.json` loses their blank lines and indentation. JSON is a subset of JSONC, so one editor
 * covers both. Whole-document writes survive only where there is no document yet to preserve —
 * create and reset.
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
import { basename, dirname, join, resolve } from 'node:path';

import { applyEdits, modify, type FormattingOptions } from 'jsonc-parser';

import { CONFIG_JSONC_TEMPLATE, CONFIG_SCHEMA_URL } from './_generated/config-template.js';
import {
  CONFIG_KEY_TABLE,
  CONFIG_RESTART_REQUIRED_KEYS,
  CONFIG_VALID_KEYS,
  validateConfigInput,
  type ConfigKey,
  type ConfigLeafRule,
} from './config-input-validator.js';

import {
  USER_CONFIG_FILENAMES,
  configFileFormat,
  findWorkspaceConfigFiles,
  parseConfigText,
} from '#shared/utils/config-file-format.js';

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

export interface ConfigResetResult {
  success: boolean;
  configPath: string;
  backupPath?: string;
  message: string;
  error?: string;
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

/**
 * The config file a workspace operation acts on.
 *
 * Precedence is `config.jsonc` then `config.json`, first existing wins. With NEITHER present the
 * `config.jsonc` path comes back — the name a create would write — so a caller that reports
 * "not found" names the file it would have made rather than the older spelling.
 */
export function resolveConfigPath(workspace: string): string {
  const workspaceDir = resolve(workspace);
  return findWorkspaceConfigFiles(workspaceDir)[0] ?? join(workspaceDir, USER_CONFIG_FILENAMES[0]);
}

/**
 * THE ONE PLACE that decides a directory holds two configs.
 *
 * Both names present means two documents claim to be the config and nothing on disk says which
 * the server read — so a precedence pick would silently edit one file while the operator watched
 * the other. Every read and write below asks this first, which is why the refusal reads the same
 * from `cpm config set`, from a `system_control` toggle, and from `cpm init`.
 *
 * @param dir - Directory that may hold config files
 * @returns The refusal message naming both paths, or `undefined` when at most one name exists
 */
function ambiguousConfigError(dir: string): string | undefined {
  const present = findWorkspaceConfigFiles(dir);
  if (present.length < 2) {
    return undefined;
  }
  return (
    `Two config files in one directory: ${present.join(' and ')}. ` +
    `Keep one — ${USER_CONFIG_FILENAMES[0]} is the 5.0 name, ${USER_CONFIG_FILENAMES[1]} is still read.`
  );
}

/**
 * The same refusal, asked of a FILE the caller already holds.
 *
 * Only a path that names a workspace config can be ambiguous. A file the operator named
 * themselves (`MCP_CONFIG_PATH=/etc/server-a.json`) is the one they meant, whatever else happens
 * to sit in that directory — refusing it would be answering a question nobody asked.
 */
function ambiguousConfigErrorForFile(configPath: string): string | undefined {
  const name = basename(configPath);
  const isWorkspaceConfigName = USER_CONFIG_FILENAMES.some((candidate) => candidate === name);
  return isWorkspaceConfigName ? ambiguousConfigError(dirname(configPath)) : undefined;
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
  const ambiguity = ambiguousConfigErrorForFile(configPath);
  if (ambiguity !== undefined) {
    return { success: false, configPath, error: ambiguity };
  }

  if (!existsSync(configPath)) {
    return {
      success: false,
      configPath,
      error: `${basename(configPath)} not found at ${configPath}`,
    };
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    const config = parseConfigText(content, configFileFormat(configPath)) as Record<
      string,
      unknown
    >;
    return { success: true, config, configPath };
  } catch (error) {
    return {
      success: false,
      configPath,
      error: `Failed to parse ${basename(configPath)}: ${error}`,
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
      message: readResult.error ?? `Failed to read ${basename(configPath)}`,
      error: readResult.error,
    };
  }

  const config = readResult.config;

  // Get previous value
  const previousValue = getConfigValue(config, key);

  // Create backup
  const backupPath = backupConfig(configPath);

  // Write atomically, editing only this key's own characters
  try {
    writeConfigKeyAtomic(configPath, key, validation.convertedValue);
  } catch (error) {
    return {
      success: false,
      key,
      message: `Failed to write ${basename(configPath)}: ${error}`,
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

/**
 * Indentation for text the editor INSERTS. Existing lines keep whatever the operator gave them —
 * `jsonc-parser` formats only the region it rewrites — so a file indented with four spaces stays
 * that way everywhere the edit does not reach.
 */
const CONFIG_EDIT_FORMATTING: FormattingOptions = {
  tabSize: 2,
  insertSpaces: true,
  eol: '\n',
};

/**
 * Write `configPath` with exactly one dotted key changed and nothing else re-rendered.
 *
 * The edit is computed against the file's TEXT, so comments, key order, blank lines and every
 * untouched line's formatting survive a `set` — the whole reason a `.jsonc` config is worth
 * offering. Setting a key that exists only as a commented-out example inserts the live key and
 * leaves the comment where it is; nothing here tries to uncomment anything.
 *
 * Both dialects go through the same editor: JSON is a subset of JSONC, and re-serializing a
 * `.json` document would still reflow a file the operator formatted by hand.
 *
 * @param configPath - Config file that already exists on disk
 * @param key - Dotted key path, e.g. `gates.enabled`
 * @param value - Value to write at that path
 * @throws {Error} When the file cannot be read, or the edited text does not parse
 */
export function writeConfigKeyAtomic(configPath: string, key: string, value: unknown): void {
  const original = readFileSync(configPath, 'utf8');
  const edits = modify(original, key.split('.'), value, {
    formattingOptions: CONFIG_EDIT_FORMATTING,
  });
  writeConfigTextAtomic(configPath, applyEdits(original, edits));
}

/**
 * Write config TEXT through a temp file and a rename, refusing to publish text that does not
 * parse in the destination's dialect. The check reads the temp file back rather than the string
 * in hand, so it measures the bytes that are about to become the config.
 *
 * @param configPath - Destination path; its extension decides the dialect checked
 * @param text - Complete file contents to write
 * @throws {Error} When the write fails or the written text does not parse
 */
function writeConfigTextAtomic(configPath: string, text: string): void {
  const tempPath = `${configPath}.tmp`;

  try {
    writeFileSync(tempPath, text, 'utf8');

    // Verify the written file parses as the format the destination name declares
    parseConfigText(readFileSync(tempPath, 'utf8'), configFileFormat(configPath));

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

/**
 * Write a whole config DOCUMENT, replacing whatever text was there.
 *
 * Only for a file with nothing to preserve — a create, or a reset the operator asked for. A
 * change to a config the operator already owns goes through {@link writeConfigKeyAtomic}, which
 * keeps their comments and formatting.
 */
export function writeConfigAtomic(configPath: string, config: Record<string, unknown>): void {
  writeConfigTextAtomic(configPath, JSON.stringify(config, null, 2) + '\n');
}

// ── Backup ───────────────────────────────────────────────────────────────────

/**
 * Copy the config beside itself, timestamped.
 *
 * The backup name keeps the whole source name including its extension
 * (`config.jsonc.backup.1758…`), so restoring it is a copy back onto a path whose dialect still
 * matches its bytes — a `.jsonc` backup can never land as a `.json` file a strict reader rejects.
 */
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
 * setting could drift from. A fresh workspace still needs a config file a reader can find
 * (`runtime/startup.ts` refuses a package root with none) — it is just no longer a restatement of
 * defaults an operator never typed. `initConfig` writes the commented template instead, whose
 * live members are these same two keys; this document is what a reset of a plain `config.json`
 * writes, and what the schema validator pins the template against.
 */
export function generateDefaultConfig(): Record<string, unknown> {
  return {
    $schema: CONFIG_SCHEMA_URL,
    version: 5,
  };
}

// ── Workspace config init ────────────────────────────────────────────────────

/**
 * Create a workspace config a user can edit.
 *
 * What lands is the generated template verbatim: `$schema` and `version` live, every setting
 * beneath them commented out with its description and default. An existing config of EITHER name
 * is left alone — a file the operator wrote outranks a file we would like them to have — and the
 * message says which name was found, so "skipped" is never ambiguous about what it skipped.
 */
export function initConfig(targetPath: string): ConfigInitResult {
  const resolvedPath = resolve(targetPath);
  const configPath = join(resolvedPath, USER_CONFIG_FILENAMES[0]);

  const ambiguity = ambiguousConfigError(resolvedPath);
  if (ambiguity !== undefined) {
    return { success: false, created: false, configPath, message: ambiguity };
  }

  const existing = findWorkspaceConfigFiles(resolvedPath)[0];
  if (existing !== undefined) {
    return {
      success: true,
      created: false,
      configPath: existing,
      message: `${basename(existing)} already exists, skipped`,
    };
  }

  // Ensure parent directory exists
  const parentDir = dirname(configPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  try {
    writeConfigTextAtomic(configPath, CONFIG_JSONC_TEMPLATE);

    return {
      success: true,
      created: true,
      configPath,
      message: `Created ${basename(configPath)} at ${configPath}`,
    };
  } catch (error) {
    return {
      success: false,
      created: false,
      configPath,
      message: `Failed to create ${basename(configPath)}: ${error}`,
    };
  }
}

// ── Workspace config reset ───────────────────────────────────────────────────

/**
 * Replace a workspace's config with a fresh default, backing up whatever was there.
 *
 * The existing file's NAME is kept — a reset is not a migration, and renaming someone's
 * `config.json` out from under a tool that points at it would break more than it tidies. So a
 * `config.jsonc` (or a workspace with no config at all) gets the commented template, and a
 * `config.json` gets the minimal default document. Exactly one config file exists afterwards,
 * under the same name as before.
 *
 * @param workspace - Workspace directory
 * @returns Which file was written, where its backup went, and what to tell the user
 */
export function resetConfig(workspace: string): ConfigResetResult {
  const workspaceDir = resolve(workspace);
  const configPath = resolveConfigPath(workspaceDir);

  const ambiguity = ambiguousConfigError(workspaceDir);
  if (ambiguity !== undefined) {
    return { success: false, configPath, message: ambiguity, error: ambiguity };
  }

  // Nothing to back up when the workspace has no config yet
  const backupPath = existsSync(configPath) ? backupConfig(configPath) : undefined;

  try {
    if (configFileFormat(configPath) === 'jsonc') {
      writeConfigTextAtomic(configPath, CONFIG_JSONC_TEMPLATE);
    } else {
      writeConfigAtomic(configPath, generateDefaultConfig());
    }
  } catch (error) {
    return {
      success: false,
      configPath,
      ...(backupPath !== undefined ? { backupPath } : {}),
      message: `Failed to reset ${basename(configPath)}: ${error}`,
      error: String(error),
    };
  }

  return {
    success: true,
    configPath,
    ...(backupPath !== undefined ? { backupPath } : {}),
    message: `${basename(configPath)} reset to defaults`,
  };
}

// ── Config validation ────────────────────────────────────────────────────────

export function validateConfig(workspace: string): ConfigValidationResult {
  const readResult = readConfig(workspace);
  if (!readResult.success || !readResult.config) {
    return {
      valid: false,
      errors: [readResult.error ?? `Failed to read ${basename(resolveConfigPath(workspace))}`],
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
 * This produces the CANDIDATE document a caller validates before committing to a write; it is not
 * what reaches disk. The file itself is edited as text ({@link writeConfigKeyAtomic}), because a
 * document re-serialized from here would carry none of the operator's comments or spacing.
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
