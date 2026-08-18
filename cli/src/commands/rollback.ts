import { join } from 'node:path';
import { loadYamlFileSync, serializeYaml, rollbackVersion } from '@cli-shared/index.js';
import { resolveWorkspace, findResource } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { TYPE_MAP, TYPE_CONFIG, singularName, isVersionedType } from '../lib/types.js';

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

  // Map plural type to singular for versioning API. Guarded rather than cast: `styles` is a valid
  // ResourceType with no version rows, and casting it into a union that does not contain it turned
  // an unsupported operation into a confusing "version not found".
  if (!isVersionedType(type)) {
    console.error(
      `${singularName(type)} resources are not versioned — nothing records version history for them.`,
    );
    return 1;
  }
  const resourceType = singularName(type) as 'prompt' | 'gate' | 'framework';

  const result = rollbackVersion(match.dir, resourceType, options.id, targetVersion, currentData);

  if (!result.success) {
    console.error(result.error ?? 'Rollback failed.');
    return 1;
  }

  // Write the restored snapshot back, MERGED over what is on disk rather than replacing it.
  //
  // A snapshot is a projection of the authored surface, not the whole file. The server's writers
  // know that and carry the rest forward (`resolvePreservedGateYamlFields`, the framework deep
  // merge); this command used to write `serializeYaml(result.snapshot)` straight over the entry
  // file, so a server-recorded gate snapshot — five keys — deleted `pass_criteria`, `retry_config`,
  // `activation` and `guidanceFile` from a `gate.yaml` that declares eight, and injected a
  // `guidance` key holding the whole markdown body. Server and CLI produced different files from
  // the same version.
  //
  // Keys the snapshot omits therefore keep their current values, and the caller is told which ones
  // so a partial restore is not reported as a full one.
  const notRestored: string[] = [];
  if (result.snapshot) {
    const { writeFileSync } = await import('node:fs');
    const excluded = new Set(config.snapshotKeysNotInEntryFile ?? []);
    const restorable = Object.fromEntries(
      Object.entries(result.snapshot).filter(([key]) => !excluded.has(key)),
    );

    for (const key of Object.keys(currentData)) {
      if (!(key in restorable)) {
        notRestored.push(key);
      }
    }

    writeFileSync(yamlPath, serializeYaml({ ...currentData, ...restorable }), 'utf8');
  }

  if (options.json) {
    output(
      {
        id: options.id,
        saved_version: result.saved_version,
        restored_version: result.restored_version,
        not_restored: notRestored,
      },
      { json: true },
    );
  } else {
    console.log(
      `Rolled back ${singularName(type)} '${options.id}': saved v${result.saved_version}, restored v${result.restored_version}`,
    );
    if (notRestored.length > 0) {
      console.log(
        `Version ${targetVersion} recorded no ${notRestored.join(', ')} — left at the current value.`,
      );
    }
  }
  return 0;
}
