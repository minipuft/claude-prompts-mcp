import {
  loadYamlFileSync,
  resolveConfiguredMaxVersions,
  rollbackVersion,
} from '@cli-shared/index.js';
// Directly, not through the `cli-shared` barrel: the barrel is what every other command imports,
// and adding one more never-server-consumed re-export to it is knip debt with no reader.
import { projectResourceSnapshot } from '@cli-shared/resource-snapshot.js';
import { resourceFileSet } from '@shared/utils/resource-file-set.js';
import { serializeYamlPreservingSource } from '@shared/utils/yaml/yaml-document-writer.js';
import { resolveWorkspace, resolveResourceDir, findResource } from '../lib/workspace.js';
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
  const yamlPath = match.file;
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

  // The state this rollback is about to REPLACE, projected exactly as `resource_manager` would
  // project it.
  //
  // Not the raw YAML map, which is what this command passed until 2026-09-21. The bridge decision
  // is `hashCanonical` equality against the newest recorded row, so a differently-shaped prior
  // state can never equal a server-written one — measured on a gate, `cpm` wrote
  // `{id,name,description,type,severity,guidanceFile}` where the server wrote
  // `{id,name,type,description,guidance}` with the markdown body inline, and EVERY `cpm rollback`
  // of a server-written gate therefore recorded a bridge row describing a change nobody made.
  const priorState = projectResourceSnapshot(resourceType, match.id, yamlPath, currentData);

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
  //
  // A snapshot key may also be SPELLED differently from the entry file's own key, because the
  // server restores by handing the snapshot to a writer that translates on the way out and this
  // command has no writer in between. Renamed rather than excluded: the value is genuinely
  // restorable, and merging it under the payload spelling wrote a second key beside the real one
  // — a duplicate the loader ignores, on an operation the operator reads as "this file is now
  // version N".
  //
  // **This runs BETWEEN the two version rows, not after both of them.** `rollbackVersion` takes it
  // as a callback so the prior-state row is written while the disk still holds the prior bytes and
  // the produced row is written once these bytes are on disk — before, the restored file was
  // described by no row at all and `cpm history` listed a state it could not restore.
  const notRestored: string[] = [];
  const applyRestore = async (
    snapshot: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const excluded = new Set(config.snapshotKeysNotInEntryFile ?? []);
    const renames = config.snapshotKeyToEntryKey ?? {};
    const restorable = Object.fromEntries(
      Object.entries(snapshot)
        .filter(([key]) => !excluded.has(key))
        .map(([key, value]) => [renames[key] ?? key, value]),
    );

    notRestored.length = 0;
    for (const key of Object.keys(currentData)) {
      if (!(key in restorable)) {
        notRestored.push(key);
      }
    }

    // Source-preserving, like every other resource write: a rollback that restored the right
    // values while stripping the file's comments would be a different kind of data loss.
    const merged = { ...currentData, ...restorable };
    writeFileSync(
      yamlPath,
      serializeYamlPreservingSource(merged, readFileSync(yamlPath, 'utf8')).content,
      'utf8',
    );

    // Re-projected from what is now on disk, not handed back as the target row's snapshot. The
    // merge above leaves every key the snapshot does not carry at its current value, and it never
    // touches a companion file — a gate's `guidance.md` still holds whatever it held — so the
    // target snapshot is not what this write produced.
    return projectResourceSnapshot(resourceType, match.id, yamlPath, merged).snapshot;
  };

  // The workspace's own `versioning.maxVersions`, not the built-in 50: a rollback writes rows and
  // trims the history it wrote them into, and until now `cpm` trimmed to a hardcoded bound while
  // the server trimmed to the configured one — the same resource kept a different number of
  // versions depending on which process last touched it.
  //
  // `targets` is the entry file alone, not its directory: a single-file prompt's directory is the
  // CATEGORY, and snapshotting that would restore every sibling prompt on a failed record.
  const result = await rollbackVersion(
    match.file,
    { resourceType, resourceId: match.id },
    targetVersion,
    priorState.snapshot,
    {
      enumerate: () =>
        resourceFileSet({
          resourceType,
          entryPath: match.file,
          roots: { primary: resolveResourceDir(workspace, type) },
        }),
      targets: [{ path: yamlPath, kind: 'file' }],
      apply: applyRestore,
      maxVersions: resolveConfiguredMaxVersions(workspace),
    },
  );

  if (!result.success) {
    console.error(result.error ?? 'Rollback failed.');
    return 1;
  }

  if (options.json) {
    output(
      {
        id: options.id,
        saved_version: result.saved_version,
        // Whether a row was written. `saved_version` alone cannot say: rolling back to the state
        // already current records nothing and reports the version that was already newest.
        recorded: result.recorded ?? false,
        restored_version: result.restored_version,
        not_restored: notRestored,
      },
      { json: true },
    );
  } else {
    console.log(
      result.recorded === true
        ? `Rolled back ${singularName(type)} '${options.id}': saved v${result.saved_version}, restored v${result.restored_version}`
        : `${singularName(type)} '${options.id}' already matches v${result.restored_version} — nothing recorded.`,
    );
    if (notRestored.length > 0) {
      console.log(
        `Version ${targetVersion} recorded no ${notRestored.join(', ')} — left at the current value.`,
      );
    }
  }
  return 0;
}
