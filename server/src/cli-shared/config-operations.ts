/**
 * Config Operations — Pure file operations for config.json management.
 *
 * Uses only node:fs and node:path. No runtime dependencies.
 * Follows the same atomic-write pattern as SafeConfigWriter but synchronous
 * and without Logger/ConfigManager dependencies.
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
  CONFIG_RESTART_REQUIRED_KEYS,
  CONFIG_VALID_KEYS,
  validateConfigInput,
  type ConfigKey,
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
  type: 'string' | 'number' | 'boolean';
  description: string;
  restartRequired: boolean;
}

// ── Path resolution ──────────────────────────────────────────────────────────

export function resolveConfigPath(workspace: string): string {
  return join(resolve(workspace), 'config.json');
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function readConfig(workspace: string): ConfigReadResult {
  const configPath = resolveConfigPath(workspace);

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
  const readResult = readConfig(workspace);
  if (!readResult.success || !readResult.config) {
    return {
      success: false,
      key,
      message: readResult.error ?? 'Failed to read config.json',
      error: readResult.error,
    };
  }

  const configPath = readResult.configPath!;
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

export function generateDefaultConfig(): Record<string, unknown> {
  // Only include keys that are in CONFIG_VALID_KEYS to avoid validation warnings.
  // Keys like prompts.directory, gates.directory exist in the server's AJV schema
  // but aren't in the CLI-shared validation set — omit from defaults.
  return {
    server: {
      name: 'claude-prompts',
      transport: 'stdio',
      port: 9090,
    },
    frameworks: {
      mode: 'on',
      dynamicToolDescriptions: true,
      systemPromptFrequency: 3,
      styleGuidance: true,
    },
    gates: {
      mode: 'on',
      frameworkGates: true,
    },
    logging: {
      level: 'info',
      directory: './logs',
    },
    versioning: {
      mode: 'auto',
      maxVersions: 50,
    },
    execution: {
      judge: true,
    },
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

  const errors: string[] = [];
  const warnings: string[] = [];
  const config = readResult.config;

  // Validate all present keys are known and values are valid
  validateConfigObject(config, '', errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

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

    // Skip $schema key
    if (fullKey === '$schema') continue;

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
    const validation = getKeyTypeInfo(key);
    return {
      key,
      type: validation.type,
      description: validation.description,
      restartRequired: CONFIG_RESTART_REQUIRED_KEYS.includes(key),
    };
  });
}

function getKeyTypeInfo(key: string): {
  type: 'string' | 'number' | 'boolean';
  description: string;
} {
  // Mode keys (on/off)
  if (
    key.endsWith('.mode') &&
    !key.includes('identity') &&
    !key.includes('versioning') &&
    !key.includes('phaseGuards')
  ) {
    return { type: 'string', description: "'on' or 'off'" };
  }
  if (key === 'identity.mode')
    return { type: 'string', description: "'permissive', 'strict', or 'locked'" };
  if (key === 'versioning.mode')
    return { type: 'string', description: "'off', 'manual', or 'auto'" };

  // Transport
  if (key === 'server.transport')
    return { type: 'string', description: "'stdio', 'streamable-http', or 'both'" };

  // Ports and numbers
  if (key === 'server.port') return { type: 'number', description: '1024-65535' };
  if (key === 'frameworks.systemPromptFrequency') return { type: 'number', description: '1-100' };
  if (key === 'verification.inContextAttempts') return { type: 'number', description: '1-10' };
  if (key === 'verification.isolation.timeout')
    return { type: 'number', description: '30-3600 seconds' };
  if (key === 'verification.isolation.maxBudget')
    return { type: 'number', description: '>= 0.01 USD' };
  if (key === 'verification.isolation.permissionMode')
    return { type: 'string', description: "'delegate', 'ask', or 'deny'" };
  if (key === 'versioning.maxVersions') return { type: 'number', description: '1-500' };
  if (key === 'resources.logs.maxEntries') return { type: 'number', description: '50-5000' };
  if (key.endsWith('.maxTokens')) return { type: 'number', description: '1-4000' };
  if (key.endsWith('.temperature')) return { type: 'number', description: '0-2' };

  // Log levels
  if (key === 'logging.level' || key === 'resources.logs.defaultLevel') {
    return { type: 'string', description: "'debug', 'info', 'warn', or 'error'" };
  }

  // Phase Guards
  if (key === 'phaseGuards.mode')
    return { type: 'string', description: "'enforce', 'warn', or 'off'" };
  if (key === 'phaseGuards.maxRetries') return { type: 'number', description: '0-5' };

  // Session timeouts
  if (key.startsWith('advanced.sessions.'))
    return { type: 'number', description: '1-10080 minutes' };

  // Directories
  if (key === 'prompts.directory' || key === 'gates.directory')
    return { type: 'string', description: 'relative directory path' };

  // String values (exact matches not caught by patterns above)
  if (key === 'server.name') return { type: 'string', description: 'server display name' };
  if (key === 'logging.directory')
    return { type: 'string', description: 'relative directory path' };
  if (key === 'identity.launchDefaults.organizationId')
    return { type: 'string', description: 'organization identifier' };
  if (key === 'identity.launchDefaults.workspaceId')
    return { type: 'string', description: 'workspace identifier' };
  if (key === 'analysis.semanticAnalysis.llmIntegration.endpoint')
    return { type: 'string', description: 'API endpoint URL (or empty)' };
  if (key === 'analysis.semanticAnalysis.llmIntegration.model')
    return { type: 'string', description: 'model name' };

  // Booleans
  const boolKeys = [
    'gates.enabled',
    'gates.frameworkGates',
    'gates.methodologyGates',
    'gates.enforcePendingVerdict',
    'execution.judge',
    'frameworks.enabled',
    'frameworks.dynamicToolDescriptions',
    'frameworks.styleGuidance',
    'prompts.registerWithMcp',
    'resources.registerWithMcp',
    'resources.prompts.defaultRegistration',
    'resources.prompts.enabled',
    'resources.gates.enabled',
    'resources.frameworks.enabled',
    'resources.observability.enabled',
    'resources.observability.sessions',
    'resources.observability.metrics',
    'resources.logs.enabled',
    'identity.allowPerRequestOverride',
    'hooks.expandedOutput',
    'verification.isolation.enabled',
    'versioning.enabled',
    'versioning.autoVersion',
  ];
  if (boolKeys.includes(key)) return { type: 'boolean', description: 'true or false' };

  // Default: string
  return { type: 'string', description: 'text value' };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function applyConfigChange(
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
