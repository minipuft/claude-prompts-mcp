import { basename, join } from 'node:path';
import {
  createResourceDir,
  resourceExists,
  readConfig,
  getConfigValue,
  resolveConfigPath,
  resolveConfiguredMaxVersions,
  loadYamlFileSync,
  type CreateResourceResult,
} from '@cli-shared/index.js';
// Directly, not through the `cli-shared` barrel: the barrel is what every other command imports,
// and adding a never-server-consumed re-export to it is knip debt with no reader.
import {
  projectResourceSnapshot,
  sharesServerSnapshotProjection,
} from '@cli-shared/resource-snapshot.js';
import { resolveResourceDir as resolveCreatedResourceDir } from '@cli-shared/resource-scaffold.js';
import { recordResourceWrite } from '@cli-shared/version-history.js';
import { createRowDescription } from '@modules/versioning/snapshot-contract.js';
import { resourceFileSet } from '@shared/utils/resource-file-set.js';
import { resolveWorkspace, resolveResourceDir } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { TYPE_MAP, TYPE_CONFIG, singularName, isVersionedType } from '../lib/types.js';
import type { ResourceType } from '../lib/types.js';
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

  const existingPath = resourceExists(baseDir, type, options.id, options.category);
  if (existingPath) {
    const msg = `${singularName(type)} '${options.id}' already exists at ${existingPath}.`;
    if (options.json) {
      output({ error: msg }, { json: true });
    } else {
      console.error(msg);
    }
    return 1;
  }

  const runCreate = (): CreateResourceResult =>
    createResourceDir(baseDir, type, options.id!, {
      name: options.name,
      description: options.description,
      category: options.category,
      validate: !options.noValidate,
    });

  const { result, record } = await createAndRecord(
    { workspace, baseDir, type, id: options.id, category: options.category },
    runCreate,
  );

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
    output(
      {
        id: options.id,
        type: singularName(type),
        path: result.path,
        // Additive, and it carries the NEGATIVE case too. A create that records nothing used to
        // be indistinguishable from one that did: both printed the same line, so an operator
        // discovered the difference from an empty `cpm history` later. `version` is present only
        // when a row exists; `not_recorded_reason` only when one does not.
        recorded: record.recorded,
        ...(record.version === undefined ? {} : { version: record.version }),
        ...(record.reason === undefined ? {} : { not_recorded_reason: record.reason }),
        ...(record.degraded === undefined ? {} : { snapshot_degraded_reason: record.degraded }),
      },
      { json: true },
    );
  } else {
    console.log(`Created ${singularName(type)} '${options.id}' at ${result.path}`);
    console.log(
      record.recorded
        ? `Recorded as version ${record.version}.`
        : `No version was recorded: ${record.reason}`,
    );
    if (record.degraded !== undefined) {
      console.log(`Warning: the recorded snapshot is incomplete — ${record.degraded}`);
    }
    // Advisory: warn if subsystem is disabled in config
    printSubsystemAdvisory(workspace, type);
  }
  return 0;
}

/** What the create recorded, or the reason — always a reason — that it recorded nothing. */
interface CreateRecordOutcome {
  recorded: boolean;
  version?: number;
  reason?: string;
  /**
   * Why the recorded snapshot is NOT the one the server would have projected.
   *
   * Present only for a prompt the loader refused: the row is written in the right SHAPE (same
   * keys, same order) from the raw entry file, so it compares field-for-field against a server
   * row, but the resolved message bodies are missing. Reported rather than swallowed — a
   * quietly-degraded row is the defect shape this whole seam exists to remove.
   */
  degraded?: string;
}

interface CreateTarget {
  workspace: string;
  baseDir: string;
  type: ResourceType;
  id: string;
  category?: string;
}

/**
 * Run the create, and record the state it produced as version 1 — the server's own create rule.
 *
 * **The branch is `sharesServerSnapshotProjection`, never a list of types here.** A `cpm`-written
 * row and a `resource_manager`-written row for the same resource must hash-compare equal or every
 * subsequent server edit bridges, so a type whose projection the CLI cannot build records NOTHING
 * rather than a second, differently-shaped snapshot. Every versioned type has one as of
 * 2026-09-21 — the prompt's arrived when `cli-shared/` gained the loader and the converter — so
 * this branch is currently unreachable and stays because the TABLE is what decides, not a list
 * restated here.
 *
 * Silence is not an option on either path: a create that records nothing says so, in `--json` and
 * in the text, with the reason. A silent non-record is the defect shape this slice removes.
 */
async function createAndRecord(
  target: CreateTarget,
  runCreate: () => CreateResourceResult,
): Promise<{ result: CreateResourceResult; record: CreateRecordOutcome }> {
  const { workspace, baseDir, type, id, category } = target;

  if (!isVersionedType(type)) {
    return {
      result: runCreate(),
      record: {
        recorded: false,
        reason: `${singularName(type)} resources carry no version history`,
      },
    };
  }

  const resourceType = singularName(type) as 'prompt' | 'gate' | 'framework';
  const resourceDir = resolveCreatedResourceDir(baseDir, type, id, category);
  const entryPath = join(resourceDir, TYPE_CONFIG[type].entryFile);

  if (!sharesServerSnapshotProjection(resourceType)) {
    const blocked = await projectResourceSnapshot(resourceType, id, entryPath, {});
    return {
      result: runCreate(),
      record: {
        recorded: false,
        reason: blocked.shared ? 'unknown' : blocked.reason,
      },
    };
  }

  // The create is handed IN as the transaction's write, exactly as the server runs its
  // `saveVersion` as the writer's `commit` step: the row is appended with the produced files
  // already on disk, and a throw from the append restores every target. The target is the
  // resource directory, which does not exist yet — the transaction captures it as absent and
  // restores it by removing it, so a failed record leaves no half-created resource behind.
  let result: CreateResourceResult = { success: false, error: 'create did not run' };
  let degraded: string | undefined;
  const record = await recordResourceWrite(
    resourceDir,
    { resourceType, resourceId: id },
    {
      enumerate: () =>
        resourceFileSet({
          resourceType,
          entryPath,
          roots: { primary: baseDir },
        }),
      targets: [{ path: resourceDir, kind: 'directory' }],
      // No `priorSnapshot`: nothing existed, so there is no prior state to bridge and the row
      // this write produces is version 1.
      write: async () => {
        result = runCreate();
        if (!result.success) {
          // Aborts the record rather than claiming a state that is not on disk. The create has
          // already restored its own files; `result` carries the reason, which the caller reports.
          throw new Error(result.error ?? 'create failed');
        }
        const declared = loadYamlFileSync<Record<string, unknown>>(entryPath) ?? {};
        const projected = await projectResourceSnapshot(resourceType, id, entryPath, declared);
        if (!projected.shared) degraded = projected.reason;
        return projected.snapshot;
      },
      description: createRowDescription('cpm'),
      maxVersions: resolveConfiguredMaxVersions(workspace),
    },
  );

  // The create's own failure is reported first and verbatim — it is the one the operator can act
  // on, and it reaches here as `written: false` because the throw above aborted the transaction.
  if (!result.success) {
    return { result, record: { recorded: false, reason: 'the create itself failed' } };
  }
  if (!record.written) {
    // The files went back with the failed record, so the create did NOT happen. Reporting it as a
    // success with `recorded: false` would name a path that is no longer there.
    return {
      result: {
        success: false,
        rolledBack: record.rolledBack,
        error:
          `the ${singularName(type)} was written but its version row could not be recorded ` +
          `(${record.error}); the files were restored`,
      },
      record: { recorded: false, reason: record.error },
    };
  }
  const degradation = degraded === undefined ? {} : { degraded };
  return record.recorded
    ? { result, record: { recorded: true, version: record.version, ...degradation } }
    : { result, record: { recorded: false, reason: record.reason, ...degradation } };
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
    const name = basename(configResult.configPath ?? resolveConfigPath(workspace));
    console.log(`\nNote: ${configKey} is false in ${name}. Resource won't be active until enabled:`);
    console.log(`  cpm enable ${type}`);
  }
}
