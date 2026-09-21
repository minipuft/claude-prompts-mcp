import {
  linkGate,
  loadYamlFileSync,
  resolveConfiguredMaxVersions,
  runValidatedMutation,
  type LinkGateResult,
  type ValidatedMutationResult,
} from '@cli-shared/index.js';
// Directly, not through the `cli-shared` barrel — see `create.ts` for why.
import { projectResourceSnapshot } from '@cli-shared/resource-snapshot.js';
import { recordResourceWrite } from '@cli-shared/version-history.js';
import type { ResourceEntry } from '../lib/workspace.js';
import { updateRowDescription } from '@modules/versioning/snapshot-contract.js';
import { resourceFileSet } from '@shared/utils/resource-file-set.js';
import { resolveWorkspace, findResource, resolveResourceDir } from '../lib/workspace.js';
import { output } from '../lib/output.js';
import { printValidationFailure } from '../lib/resource-validation.js';

interface LinkGateOptions {
  workspace?: string;
  json: boolean;
  promptId?: string;
  gateId?: string;
  remove?: boolean;
  noValidate?: boolean;
}

export async function linkGateCmd(options: LinkGateOptions): Promise<number> {
  if (!options.promptId || !options.gateId) {
    console.error(
      'Usage: cpm link-gate <prompt-id> <gate-id> [--remove]\nBoth prompt ID and gate ID are required.',
    );
    return 1;
  }

  const workspace = resolveWorkspace(options.workspace);
  const promptMatch = findResource(workspace, 'prompts', options.promptId);

  if (!promptMatch) {
    console.error(`Prompt '${options.promptId}' not found.`);
    return 1;
  }

  // Validate gate exists on add (skip on remove — gate may already be deleted)
  if (!options.remove) {
    const gateMatch = findResource(workspace, 'gates', options.gateId);
    if (!gateMatch) {
      console.error(`Gate '${options.gateId}' not found.`);
      return 1;
    }
  }

  const { mutation, record } = await linkAndRecord({
    workspace,
    gateId: options.gateId,
    match: promptMatch,
    remove: options.remove === true,
    validate: !options.noValidate,
  });

  if (!mutation.success) {
    if (mutation.validation) {
      printValidationFailure(mutation.validation, {
        json: options.json,
        action: `${options.remove ? 'unlink' : 'link'} gate '${options.gateId}'`,
        rolledBack: mutation.rolledBack,
      });
      return 1;
    }
    console.error(mutation.error ?? mutation.operation.error ?? 'Link-gate failed.');
    return 1;
  }
  const result = mutation.operation;

  const verb = result.action === 'removed' ? 'Unlinked' : 'Linked';

  if (options.json) {
    output(
      {
        promptId: options.promptId,
        gateId: options.gateId,
        action: result.action,
        include: result.include,
        // Additive, and it carries the negative case: an edit that records nothing says so with
        // the reason rather than looking identical to one that wrote a row.
        recorded: record.recorded,
        ...(record.version === undefined ? {} : { version: record.version }),
        ...(record.reason === undefined ? {} : { not_recorded_reason: record.reason }),
        ...(record.degraded === undefined ? {} : { snapshot_degraded_reason: record.degraded }),
      },
      { json: true },
    );
  } else {
    console.log(`${verb} gate '${options.gateId}' ${result.action === 'removed' ? 'from' : 'to'} prompt '${options.promptId}'`);
    console.log(
      record.recorded
        ? `Recorded as version ${record.version}.`
        : `No version was recorded: ${record.reason}`,
    );
    if (record.degraded !== undefined) {
      console.log(`Warning: the recorded snapshot is incomplete — ${record.degraded}`);
    }
  }
  return 0;
}

/** What the link recorded, or the reason — always a reason — that it recorded nothing. */
interface LinkRecordOutcome {
  recorded: boolean;
  version?: number;
  reason?: string;
  /** See `create.ts`: the row is the right shape but the loader could not resolve the prompt. */
  degraded?: string;
}

interface LinkTarget {
  workspace: string;
  gateId: string;
  match: ResourceEntry;
  remove: boolean;
  validate: boolean;
}

/**
 * Add or remove a gate link, and record the state that edit produced.
 *
 * An EDIT, so it carries a prior-state row like `cpm toggle` does: the bytes before the link may
 * never have been recorded (the prompt was authored by hand, or the server wrote it and something
 * edited the file since), and bridging them is what keeps that state rollback-reachable.
 *
 * **`linkGate` refuses a no-op before this ever reaches the table** — adding a gate already in
 * `include`, or removing one that is not there, returns `success: false` and nothing is written.
 * The table's own skip-if-equal is the second guard behind it, for the case where the produced
 * state genuinely equals the newest recorded row (a link that restores a prompt to exactly the
 * state version N holds): `recordResourceWrite` reports `recorded: false` with that reason, and
 * the reply prints it.
 *
 * `targets` is the prompt's ENTRY FILE, not its directory: `linkGate` rewrites `prompt.yaml`
 * alone, and a directory target would also restore a `user-message.md` this write never touched.
 */
async function linkAndRecord(
  target: LinkTarget,
): Promise<{ mutation: ValidatedMutationResult<LinkGateResult>; record: LinkRecordOutcome }> {
  const { workspace, gateId, match, remove, validate } = target;

  const runLink = (): ValidatedMutationResult<LinkGateResult> =>
    runValidatedMutation({
      resourceType: 'prompts',
      location: match,
      validate,
      mutate: () => linkGate(match.file, gateId, remove),
    });

  const declared = loadYamlFileSync<Record<string, unknown>>(match.file);
  if (declared === undefined) {
    return {
      mutation: runLink(),
      record: { recorded: false, reason: `${match.file} could not be parsed` },
    };
  }

  const prior = await projectResourceSnapshot('prompt', match.id, match.file, declared);
  let degraded = prior.shared ? undefined : prior.reason;
  let mutation: ValidatedMutationResult<LinkGateResult> = {
    success: false,
    operation: { success: false, error: 'link-gate did not run' },
  };

  const record = await recordResourceWrite(
    match.file,
    { resourceType: 'prompt', resourceId: match.id },
    {
      enumerate: () =>
        resourceFileSet({
          resourceType: 'prompt',
          entryPath: match.file,
          roots: { primary: resolveResourceDir(workspace, 'prompts') },
        }),
      targets: [{ path: match.file, kind: 'file' }],
      priorSnapshot: prior.snapshot,
      write: async () => {
        mutation = runLink();
        if (!mutation.success) {
          throw new Error(mutation.error ?? mutation.operation.error ?? 'Link-gate failed.');
        }
        const produced = loadYamlFileSync<Record<string, unknown>>(match.file) ?? declared;
        const projected = await projectResourceSnapshot('prompt', match.id, match.file, produced);
        if (!projected.shared) degraded = projected.reason;
        return projected.snapshot;
      },
      description: updateRowDescription('cpm'),
      diffSummary: remove ? `gate '${gateId}' unlinked` : `gate '${gateId}' linked`,
      maxVersions: resolveConfiguredMaxVersions(workspace),
    },
  );

  const degradation = degraded === undefined ? {} : { degraded };
  if (!mutation.success) {
    return { mutation, record: { recorded: false, reason: 'the link itself failed' } };
  }
  if (!record.written) {
    // The file went back with the failed record, so the link did NOT happen. Reporting it as a
    // success with `recorded: false` would name an edit that is no longer on disk.
    return {
      mutation: {
        success: false,
        operation: mutation.operation,
        rolledBack: record.rolledBack,
        error:
          `the gate link was written but its version row could not be recorded ` +
          `(${record.error}); the file was restored`,
      },
      record: { recorded: false, reason: record.error, ...degradation },
    };
  }
  return record.recorded
    ? { mutation, record: { recorded: true, version: record.version, ...degradation } }
    : { mutation, record: { recorded: false, reason: record.reason, ...degradation } };
}
