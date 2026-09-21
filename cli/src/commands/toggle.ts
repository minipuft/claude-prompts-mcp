import { readFileSync } from 'node:fs';
import {
  runValidatedMutation,
  toggleEnabled,
  readConfig,
  getConfigValue,
  resolveConfiguredMaxVersions,
  loadYamlFileSync,
  type ToggleResult,
  type ValidatedMutationResult,
} from '@cli-shared/index.js';
// Directly, not through the `cli-shared` barrel — see `create.ts` for why.
import {
  projectResourceSnapshot,
  sharesServerSnapshotProjection,
} from '@cli-shared/resource-snapshot.js';
import { recordResourceWrite } from '@cli-shared/version-history.js';
import type { ResourceLocation } from '@cli-shared/resource-operations.js';
import { updateRowDescription } from '@modules/versioning/snapshot-contract.js';
import { resourceFileSet } from '@shared/utils/resource-file-set.js';
import { resolveWorkspace, findResource, resolveResourceDir, discoverResourcePaths } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { TYPE_MAP, TYPE_CONFIG, singularName } from '../lib/types.js';
import { printValidationFailure } from '../lib/resource-validation.js';

interface ToggleOptions {
  workspace?: string;
  json: boolean;
  type?: string;
  id?: string;
  noValidate?: boolean;
}

export async function toggle(options: ToggleOptions): Promise<number> {
  const type = options.type ? TYPE_MAP[options.type] : undefined;

  if (!type || (type !== 'frameworks' && type !== 'styles')) {
    console.error(
      `Usage: cpm toggle <framework|style> <id>\n` +
        (options.type
          ? `Only frameworks and styles have an 'enabled' field.`
          : 'Resource type is required.'),
    );
    return 1;
  }

  if (!options.id) {
    console.error('Usage: cpm toggle <framework|style> <id>\nResource ID is required.');
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const match = findResource(workspace, type, options.id);

  if (!match) {
    console.error(`${singularName(type)} '${options.id}' not found.`);
    return 1;
  }

  const { mutation, record } = await toggleAndRecord(
    { workspace, type, id: options.id, match, validate: !options.noValidate },
  );

  if (!mutation.success) {
    if (mutation.validation) {
      printValidationFailure(mutation.validation, {
        json: options.json,
        action: `toggle ${singularName(type)} '${options.id}'`,
        rolledBack: mutation.rolledBack,
      });
      return 1;
    }
    console.error(mutation.error ?? mutation.operation.error ?? 'Toggle failed.');
    return 1;
  }
  const result = mutation.operation;

  if (options.json) {
    output(
      {
        id: options.id,
        type: singularName(type),
        previousValue: result.previousValue,
        newValue: result.newValue,
        // Additive, and it carries the negative case: a toggle that records nothing says so with
        // the reason rather than looking identical to one that recorded a row.
        recorded: record.recorded,
        ...(record.version === undefined ? {} : { version: record.version }),
        ...(record.reason === undefined ? {} : { not_recorded_reason: record.reason }),
      },
      { json: true },
    );
  } else {
    console.log(`Toggled ${singularName(type)} '${options.id}': enabled ${result.previousValue} -> ${result.newValue}`);
    console.log(
      record.recorded
        ? `Recorded as version ${record.version}.`
        : `No version was recorded: ${record.reason}`,
    );
    // Advisory: if all resources of this type are now disabled, hint at config
    if (result.newValue === false && type === 'frameworks') {
      printAllDisabledAdvisory(workspace, type);
    }
  }
  return 0;
}

/** What the toggle recorded, or the reason — always a reason — that it recorded nothing. */
interface ToggleRecordOutcome {
  recorded: boolean;
  version?: number;
  reason?: string;
}

interface ToggleTarget {
  workspace: string;
  type: 'frameworks' | 'styles';
  id: string;
  match: ResourceLocation;
  validate: boolean;
}

/**
 * Flip `enabled:`, and record the state that flip produced.
 *
 * A toggle is an EDIT, so unlike a create it carries a prior-state row: the state on disk before
 * the flip may never have been recorded (the framework was authored by hand, or the server wrote
 * it and something edited the file since), and bridging it is what keeps that state
 * rollback-reachable. `recordCheckpointedWrite` writes it before the flip, while the disk still
 * holds those bytes.
 *
 * **Styles record nothing, and it is not a blocker.** `VERSIONED_TYPES` excludes styles because
 * nothing on either surface writes style version rows — a rollback of one could only ever report
 * "version not found". That is a property of the resource, not a gap waiting on a projection, so
 * it is stated as its own reason rather than filed beside the prompt's.
 *
 * The validation rollback stays where it was: `runValidatedMutation` restores the tree when the
 * flip produces an invalid framework, and the version record never runs, because the write throws
 * before returning a snapshot.
 */
async function toggleAndRecord(
  target: ToggleTarget,
): Promise<{ mutation: ValidatedMutationResult<ToggleResult>; record: ToggleRecordOutcome }> {
  const { workspace, type, id, match, validate } = target;

  const runToggle = (): ValidatedMutationResult<ToggleResult> =>
    runValidatedMutation({
      resourceType: type,
      location: match,
      validate,
      mutate: () => toggleEnabled(match.file),
    });

  if (type !== 'frameworks' || !sharesServerSnapshotProjection('framework')) {
    return {
      mutation: runToggle(),
      record: {
        recorded: false,
        reason:
          type === 'styles'
            ? 'style resources carry no version history'
            : 'no shared snapshot projection is reachable for this type',
      },
    };
  }

  const declared = loadYamlFileSync<Record<string, unknown>>(match.file);
  if (declared === undefined) {
    return {
      mutation: runToggle(),
      record: { recorded: false, reason: `${match.file} could not be parsed` },
    };
  }

  const prior = await projectResourceSnapshot('framework', id, match.file, declared);
  let mutation: ValidatedMutationResult<ToggleResult> = {
    success: false,
    operation: { success: false, error: 'toggle did not run' },
  };

  const record = await recordResourceWrite(
    match.file,
    { resourceType: 'framework', resourceId: id },
    {
      enumerate: () =>
        resourceFileSet({
          resourceType: 'framework',
          entryPath: match.file,
          roots: { primary: resolveResourceDir(workspace, type) },
        }),
      // `toggleEnabled` rewrites the entry file and nothing else, so that file alone is what a
      // failed record has to put back. The resource DIRECTORY would also restore `system-prompt.md`
      // — a file this write never touched.
      targets: [{ path: match.file, kind: 'file' }],
      priorSnapshot: prior.snapshot,
      write: async () => {
        mutation = runToggle();
        if (!mutation.success) {
          throw new Error(mutation.error ?? mutation.operation.error ?? 'Toggle failed.');
        }
        const produced = loadYamlFileSync<Record<string, unknown>>(match.file) ?? declared;
        return (await projectResourceSnapshot('framework', id, match.file, produced)).snapshot;
      },
      description: updateRowDescription('cpm'),
      diffSummary: 'enabled toggled',
      maxVersions: resolveConfiguredMaxVersions(workspace),
    },
  );

  if (!mutation.success) {
    return { mutation, record: { recorded: false, reason: 'the toggle itself failed' } };
  }
  if (!record.written) {
    return {
      mutation: {
        success: false,
        operation: mutation.operation,
        rolledBack: record.rolledBack,
        error:
          `the framework was toggled but its version row could not be recorded ` +
          `(${record.error}); the file was restored`,
      },
      record: { recorded: false, reason: record.error },
    };
  }
  return record.recorded
    ? { mutation, record: { recorded: true, version: record.version } }
    : { mutation, record: { recorded: false, reason: record.reason } };
}

function printAllDisabledAdvisory(workspace: string, type: 'frameworks' | 'styles'): void {
  try {
    const baseDir = resolveResourceDir(workspace, type);
    const typeConfig = TYPE_CONFIG[type];
    const resources = discoverResourcePaths(baseDir, typeConfig.entryFile, typeConfig.nested);

    let anyEnabled = false;

    for (const { file } of resources) {
      const content = readFileSync(file, 'utf8');
      if (/enabled:\s*true/i.test(content)) {
        anyEnabled = true;
        break;
      }
    }

    if (!anyEnabled && resources.length > 0) {
      const configKeyMap: Record<string, string> = { frameworks: 'frameworks.enabled' };
      const configKey = configKeyMap[type];
      if (!configKey) return;

      const configResult = readConfig(workspace);
      if (configResult.success && configResult.config) {
        // Raw-file read, so a config still carrying the retired `mode` spelling is recognised
        // too; the advice printed always names the canonical command.
        const value = getConfigValue(configResult.config, configKey);
        const legacy = getConfigValue(configResult.config, configKey.replace(/\.enabled$/, '.mode'));
        if (value === true || (value === undefined && legacy === 'on')) {
          console.log(`\nTip: All ${type} are now disabled. To turn off the subsystem:`);
          console.log(`  cpm disable ${type}`);
        }
      }
    }
  } catch {
    // Silently ignore advisory errors
  }
}
