import {
  readConfig,
  getConfigValue,
  validateConfig,
  resolveConfigPath,
  getConfigKeyInfo,
  CONFIG_VALID_KEYS,
} from '@cli-shared/index.js';
// Directly, not through the barrel: the barrel is what every other command imports, and the
// checkpointed writers are the config command's own surface.
import {
  resetConfigRecorded,
  setConfigValueRecorded,
} from '@cli-shared/config-checkpoint.js';
import {
  loadConfigHistory,
  rollbackConfigVersion,
} from '@cli-shared/config-restore.js';
import { formatHistoryTable } from '@cli-shared/index.js';
import { describeRestorePlan } from '@modules/versioning/restore-plan.js';
import { basename } from 'node:path';

import { output } from '../lib/output.js';
import { resolveWorkspace } from '../lib/workspace.js';

type ConfigSubcommand =
  | 'list'
  | 'get'
  | 'set'
  | 'validate'
  | 'reset'
  | 'keys'
  | 'history'
  | 'rollback';

const SUBCOMMANDS: ConfigSubcommand[] = [
  'list',
  'get',
  'set',
  'validate',
  'reset',
  'keys',
  'history',
  'rollback',
];

interface ConfigOptions {
  workspace?: string;
  json: boolean;
  subcommand?: string;
  positionals: string[];
  force?: boolean;
  value?: string;
  /** `config history` — how many rows to print. */
  limit?: string;
  /** `config rollback` — resolve the plan and print it, writing no file and recording nothing. */
  preview?: boolean;
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
    console.error('  history    List recorded config versions');
    console.error('  rollback <version> [--preview]  Restore a recorded config version');
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
    case 'history':
      return configHistory(options);
    case 'rollback':
      return configRollback(options);
  }
}

/**
 * `cpm config history` — every recorded version of this workspace's config.
 *
 * An empty history is reported as one, not as an error: a workspace the server has never run in
 * has no `state.db` to record into, and a workspace whose config nobody has changed has nothing to
 * show. Both are ordinary, and both are exactly what an operator reaching for a rollback needs
 * told.
 */
function configHistory(options: ConfigOptions): number {
  const workspace = resolveWorkspace(options.workspace);
  const history = loadConfigHistory(workspace);

  if (history === null || history.versions.length === 0) {
    const message =
      'No config versions recorded for this workspace yet. ' +
      "A version is recorded the first time 'cpm config set' or 'cpm config reset' changes the file.";
    if (options.json) {
      output({ versions: [], message }, { json: true });
    } else {
      console.log(message);
    }
    return 0;
  }

  if (options.json) {
    output(history, { json: true });
  } else {
    const limit = options.limit === undefined ? 10 : Number.parseInt(options.limit, 10);
    console.log(formatHistoryTable(history, Number.isNaN(limit) ? 10 : limit));
  }
  return 0;
}

/**
 * `cpm config rollback <version> [--preview]` — put a recorded version's bytes back.
 *
 * `--preview` returns the SAME plan value the apply executes, resolved by the same call, so the two
 * cannot describe different actions. Every refusal — an unknown version, a version that recorded
 * no bytes, bytes this build no longer accepts as config — exits 1 with its reason on stderr and
 * leaves the file untouched.
 */
async function configRollback(options: ConfigOptions): Promise<number> {
  const raw = options.positionals[0];
  const targetVersion = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(targetVersion) || targetVersion < 1) {
    console.error('Usage: cpm config rollback <version> [--preview]');
    console.error("Run 'cpm config history' to see the recorded versions.");
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const result = await rollbackConfigVersion(workspace, targetVersion, {
    preview: options.preview === true,
  });

  if (!result.ok) {
    if (options.json) {
      output({ success: false, version: targetVersion, error: result.refusal }, { json: true });
    } else {
      console.error(result.refusal);
    }
    return 1;
  }

  if (options.json) {
    output(
      {
        success: true,
        restored_version: targetVersion,
        preview: result.preview,
        saved_version: result.savedVersion,
        recorded: result.recorded,
        record_note: result.recordNote,
        files_written: result.plan.write.map((file) => file.path),
        files_unchanged: result.plan.unchanged,
        files_left_in_place: result.plan.leftInPlace,
      },
      { json: true },
    );
    return 0;
  }

  console.log(
    result.preview
      ? `Preview — rollback of config to v${targetVersion}.\nNothing was written: no file changed and no version was recorded.`
      : result.recorded
        ? `Restored config from v${targetVersion}, recorded as v${result.savedVersion}.`
        : `config already matches v${targetVersion} — ${result.recordNote ?? 'nothing recorded'}.`,
  );
  console.log(describeRestorePlan(result.plan));
  return 0;
}

/**
 * What the checkpoint did, in one line, for a command that just wrote the config.
 *
 * Printed on BOTH outcomes rather than only on success. A config write that recorded nothing —
 * because the workspace has no `state.db`, or because not one character changed — must say so:
 * silence there is what the timestamped `.backup.<ms>` files used to hide behind, and the operator
 * is about to believe `cpm config rollback` can undo this.
 */
function describeConfigRecord(result: { recorded: boolean; version?: number; recordNote?: string }): string {
  return result.recorded
    ? `Recorded as config version ${result.version}. Run 'cpm config history' to see what to roll back to.`
    : `Not recorded: ${result.recordNote ?? 'no reason given'}.`;
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

async function configSet(options: ConfigOptions): Promise<number> {
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
  const result = await setConfigValueRecorded(workspace, key, value);

  if (options.json) {
    output(result, { json: true });
  } else {
    if (result.success) {
      console.log(result.message);
      if (result.backupPath) {
        console.log(`Backup: ${result.backupPath}`);
      }
      console.log(describeConfigRecord(result));
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

async function configReset(options: ConfigOptions): Promise<number> {
  const workspace = resolveWorkspace(options.workspace);
  const configPath = resolveConfigPath(workspace);

  if (!options.force) {
    console.error('config reset requires --force to confirm');
    console.error(`This will overwrite your ${basename(configPath)} with default values`);
    return 1;
  }

  const result = await resetConfigRecorded(workspace);

  if (options.json) {
    output(result, { json: true });
  } else {
    if (result.success) {
      console.log(result.message);
      if (result.backupPath) {
        console.log(`Backup: ${result.backupPath}`);
      }
      console.log(describeConfigRecord(result));
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
