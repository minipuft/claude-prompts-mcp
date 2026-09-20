import {
  readConfig,
  getConfigValue,
  setConfigValue,
  validateConfig,
  resolveConfigPath,
  getConfigKeyInfo,
  resetConfig,
  CONFIG_VALID_KEYS,
} from '@cli-shared/index.js';
import { basename } from 'node:path';

import { output } from '../lib/output.js';
import { resolveWorkspace } from '../lib/workspace.js';

type ConfigSubcommand = 'list' | 'get' | 'set' | 'validate' | 'reset' | 'keys';

const SUBCOMMANDS: ConfigSubcommand[] = ['list', 'get', 'set', 'validate', 'reset', 'keys'];

interface ConfigOptions {
  workspace?: string;
  json: boolean;
  subcommand?: string;
  positionals: string[];
  force?: boolean;
  value?: string;
}

export async function config(options: ConfigOptions): Promise<number> {
  const sub = options.subcommand;
  if (!sub || !SUBCOMMANDS.includes(sub as ConfigSubcommand)) {
    if (sub) {
      console.error(`Unknown config subcommand: ${sub}\n`);
    }
    console.error('Usage: cpm config <list|get|set|validate|reset|keys> [options]');
    console.error('\nSubcommands:');
    console.error('  list       Display full configuration');
    console.error('  get <key>  Get a specific config value');
    console.error('  set <key> <value>  Set a config value');
    console.error('  validate   Validate config.jsonc');
    console.error('  reset      Reset config to defaults (requires --force)');
    console.error('  keys       List all valid config keys');
    return 1;
  }

  switch (sub as ConfigSubcommand) {
    case 'list':
      return configList(options);
    case 'get':
      return configGet(options);
    case 'set':
      return configSet(options);
    case 'validate':
      return configValidate(options);
    case 'reset':
      return configReset(options);
    case 'keys':
      return configKeys(options);
  }
}

function configList(options: ConfigOptions): number {
  const workspace = resolveWorkspace(options.workspace);
  const result = readConfig(workspace);

  if (!result.success) {
    if (options.json) {
      output({ success: false, error: result.error }, { json: true });
    } else {
      console.error(result.error);
    }
    return 1;
  }

  if (options.json) {
    output(result.config, { json: true });
  } else {
    console.log(JSON.stringify(result.config, null, 2));
  }
  return 0;
}

function configGet(options: ConfigOptions): number {
  const key = options.positionals[0];
  if (!key) {
    console.error('Usage: cpm config get <key>');
    console.error('Example: cpm config get gates.enabled');
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const result = readConfig(workspace);

  if (!result.success || !result.config) {
    if (options.json) {
      output({ success: false, key, error: result.error }, { json: true });
    } else {
      console.error(result.error);
    }
    return 1;
  }

  const value = getConfigValue(result.config, key);

  if (value === undefined) {
    const name = basename(result.configPath ?? resolveConfigPath(workspace));
    if (options.json) {
      output({ success: false, key, error: `Key '${key}' not found in ${name}` }, { json: true });
    } else {
      console.error(`Key '${key}' not found in ${name}`);
    }
    return 1;
  }

  if (options.json) {
    output({ success: true, key, value }, { json: true });
  } else {
    if (typeof value === 'object' && value !== null) {
      console.log(`${key} =`);
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(`${key} = ${JSON.stringify(value)}`);
    }
  }
  return 0;
}

function configSet(options: ConfigOptions): number {
  const key = options.positionals[0];
  const value = options.value ?? options.positionals[1];

  if (!key || value === undefined) {
    console.error('Usage: cpm config set <key> <value>');
    console.error('   or: cpm config set <key> --value <value>');
    console.error('Example: cpm config set gates.enabled true');
    return 1;
  }

  // Warn if key is not in known list
  if (!CONFIG_VALID_KEYS.includes(key as any)) {
    console.error(`Unknown configuration key: ${key}`);
    console.error('Run "cpm config keys" to see valid keys');
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const result = setConfigValue(workspace, key, value);

  if (options.json) {
    output(result, { json: true });
  } else {
    if (result.success) {
      console.log(result.message);
      if (result.backupPath) {
        console.log(`Backup: ${result.backupPath}`);
      }
      if (result.restartRequired) {
        console.log('Note: This change requires a server restart to take effect');
      }
    } else {
      console.error(result.message);
    }
  }

  return result.success ? 0 : 1;
}

function configValidate(options: ConfigOptions): number {
  const workspace = resolveWorkspace(options.workspace);
  const result = validateConfig(workspace);
  const name = basename(resolveConfigPath(workspace));

  if (options.json) {
    output(result, { json: true });
  } else {
    if (result.valid) {
      console.log(`${name} is valid`);
      if (result.warnings.length > 0) {
        console.log(`\nWarnings (${result.warnings.length}):`);
        for (const w of result.warnings) {
          console.log(`  - ${w}`);
        }
      }
    } else {
      console.error(`${name} validation failed:`);
      for (const e of result.errors) {
        console.error(`  - ${e}`);
      }
      if (result.warnings.length > 0) {
        console.log(`\nWarnings (${result.warnings.length}):`);
        for (const w of result.warnings) {
          console.log(`  - ${w}`);
        }
      }
    }
  }

  return result.valid ? 0 : 1;
}

function configReset(options: ConfigOptions): number {
  const workspace = resolveWorkspace(options.workspace);
  const configPath = resolveConfigPath(workspace);

  if (!options.force) {
    console.error('config reset requires --force to confirm');
    console.error(`This will overwrite your ${basename(configPath)} with default values`);
    return 1;
  }

  const result = resetConfig(workspace);

  if (options.json) {
    output(result, { json: true });
  } else {
    if (result.success) {
      console.log(result.message);
      if (result.backupPath) {
        console.log(`Backup: ${result.backupPath}`);
      }
    } else {
      console.error(result.message);
    }
  }
  return result.success ? 0 : 1;
}

function configKeys(options: ConfigOptions): number {
  const keys = getConfigKeyInfo();

  if (options.json) {
    output(keys, { json: true });
    return 0;
  }

  const maxKeyLen = Math.max(...keys.map(k => k.key.length));
  const maxTypeLen = Math.max(...keys.map(k => k.type.length));

  console.log(`${'KEY'.padEnd(maxKeyLen)}  ${'TYPE'.padEnd(maxTypeLen)}  DESCRIPTION`);
  console.log(`${'─'.repeat(maxKeyLen)}  ${'─'.repeat(maxTypeLen)}  ${'─'.repeat(30)}`);

  for (const k of keys) {
    const restart = k.restartRequired ? ' [restart required]' : '';
    console.log(`${k.key.padEnd(maxKeyLen)}  ${k.type.padEnd(maxTypeLen)}  ${k.description}${restart}`);
  }

  return 0;
}
