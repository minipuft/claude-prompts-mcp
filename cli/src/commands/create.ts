import {
  createResourceDir,
  resourceExists,
  readConfig,
  getConfigValue,
} from '@cli-shared/index.js';
import { resolveWorkspace, resolveResourceDir } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { TYPE_MAP, singularName } from '../lib/types.js';
import { printValidationFailure } from '../lib/resource-validation.js';

interface CreateOptions {
  workspace?: string;
  json: boolean;
  type?: string;
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  noValidate?: boolean;
}

export async function create(options: CreateOptions): Promise<number> {
  const type = options.type ? TYPE_MAP[options.type] : undefined;

  if (!type) {
    console.error(
      `Usage: cpm create <prompt|gate|framework|style> <id> [options]\n` +
        (options.type ? `Unknown type: ${options.type}` : 'Resource type is required.'),
    );
    return 1;
  }

  if (!options.id) {
    console.error('Usage: cpm create <prompt|gate|framework|style> <id> [options]\nResource ID is required.');
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);

  let baseDir: string;
  try {
    baseDir = resolveResourceDir(workspace, type);
  } catch {
    // Directory doesn't exist yet — create it for new workspaces
    const { resolve } = await import('node:path');
    const { mkdirSync } = await import('node:fs');
    baseDir = resolve(workspace, 'resources', type);
    mkdirSync(baseDir, { recursive: true });
  }

  if (resourceExists(baseDir, type, options.id, options.category)) {
    const msg = `${singularName(type)} '${options.id}' already exists.`;
    if (options.json) {
      output({ error: msg }, { json: true });
    } else {
      console.error(msg);
    }
    return 1;
  }

  const result = createResourceDir(baseDir, type, options.id, {
    name: options.name,
    description: options.description,
    category: options.category,
    validate: !options.noValidate,
  });

  if (!result.success) {
    if (result.validation) {
      printValidationFailure(result.validation, {
        json: options.json,
        action: `create ${singularName(type)} '${options.id}'`,
        rolledBack: result.rolledBack,
      });
      return 1;
    }

    const msg = result.error ?? 'Unknown error';
    if (options.json) {
      output({ error: msg }, { json: true });
    } else {
      console.error(`Failed to create ${singularName(type)}: ${msg}`);
    }
    return 1;
  }

  if (options.json) {
    output({ id: options.id, type: singularName(type), path: result.path }, { json: true });
  } else {
    console.log(`Created ${singularName(type)} '${options.id}' at ${result.path}`);
    // Advisory: warn if subsystem is disabled in config
    printSubsystemAdvisory(workspace, type);
  }
  return 0;
}

function printSubsystemAdvisory(workspace: string, type: string): void {
  const configKeyMap: Record<string, string> = {
    gates: 'gates.enabled',
    frameworks: 'frameworks.enabled',
  };
  const configKey = configKeyMap[type];
  if (!configKey) return;

  const configResult = readConfig(workspace);
  if (!configResult.success || !configResult.config) return;

  // Advisory only, so it reads the raw file rather than a loaded ConfigManager. A config written
  // by the retired CLI still carries `mode: "off"` until something loads and folds it, so both
  // spellings are recognised here; the advice printed always names the canonical key.
  const value = getConfigValue(configResult.config, configKey);
  const legacy = getConfigValue(configResult.config, configKey.replace(/\.enabled$/, '.mode'));
  if (value === false || (value === undefined && legacy === 'off')) {
    console.log(`\nNote: ${configKey} is false in config.json. Resource won't be active until enabled:`);
    console.log(`  cpm enable ${type}`);
  }
}
