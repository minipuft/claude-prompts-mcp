import { join } from 'node:path';
import { loadYamlFileSync, serializeYaml, rollbackVersion } from '@cli-shared/index.js';
import { resolveWorkspace, findResource } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { TYPE_MAP, TYPE_CONFIG, singularName } from '../lib/types.js';

interface RollbackOptions {
  workspace?: string;
  json: boolean;
  type?: string;
  id?: string;
  version?: string;
}

export async function rollback(options: RollbackOptions): Promise<number> {
  const type = options.type ? TYPE_MAP[options.type] : undefined;

  if (!type) {
    console.error(
      `Usage: cpm rollback <prompt|gate|framework|style> <id> <version>\n` +
        (options.type ? `Unknown type: ${options.type}` : 'Resource type is required.'),
    );
    return 1;
  }

  if (!options.id || !options.version) {
    console.error(
      'Usage: cpm rollback <prompt|gate|framework|style> <id> <version>\nResource ID and target version are required.',
    );
    return 1;
  }

  const targetVersion = parseInt(options.version, 10);

  if (isNaN(targetVersion) || targetVersion < 1) {
    console.error('Version must be a positive integer.');
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type, options.id);

  if (!match) {
    console.error(`${singularName(type)} '${options.id}' not found.`);
    return 1;
  }

  // Load current state as snapshot
  const config = TYPE_CONFIG[type];
  const yamlPath = join(match.dir, config.entryFile);
  const currentData = loadYamlFileSync<Record<string, unknown>>(yamlPath);

  if (!currentData) {
    console.error(`Failed to read current ${singularName(type)} YAML.`);
    return 1;
  }

  // Map plural type to singular for versioning API
  const resourceType = singularName(type) as 'prompt' | 'gate' | 'framework';

  const result = rollbackVersion(match.dir, resourceType, options.id, targetVersion, currentData);

  if (!result.success) {
    console.error(result.error ?? 'Rollback failed.');
    return 1;
  }

  // Write restored snapshot back to YAML
  if (result.snapshot) {
    const { writeFileSync } = await import('node:fs');
    const yaml = serializeYaml(result.snapshot);
    writeFileSync(yamlPath, yaml, 'utf8');
  }

  if (options.json) {
    output(
      {
        id: options.id,
        saved_version: result.saved_version,
        restored_version: result.restored_version,
      },
      { json: true },
    );
  } else {
    console.log(
      `Rolled back ${singularName(type)} '${options.id}': saved v${result.saved_version}, restored v${result.restored_version}`,
    );
  }
  return 0;
}
