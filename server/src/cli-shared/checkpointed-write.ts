// @lifecycle canonical - The one ordering every `cpm` write that mutates a resource records under.
/**
 * Record what a `cpm` write PRODUCED, in the server's order and with the server's guarantee.
 *
 * THE GAP THIS CLOSES. Every server processor passes its version record as the `commit` step of
 * `ResourceMutationTransaction.run()` — `captureSnapshots → mutate (the file write) → validate →
 * commit` — so the record runs with the produced files already on disk, and a throw from the
 * record restores every snapshot. `cpm` did not follow that. `rollbackVersion` recorded BEFORE the
 * command restored the files, so the merged file the command wrote afterwards was described by no
 * row: measured 2026-09-21, a `cpm rollback gate alpha 1` left `version_history` holding
 * `Rollback to v1` with `tree_hash` NULL while the bytes it had just written hashed to something
 * nothing recorded. A second rollback to that state could not be byte-exact, and the operator's
 * `cpm history` showed a row for a state it could not restore.
 *
 * THE ORDER, AND WHY THE BRIDGE ROW IS OUTSIDE THE TRANSACTION. The prior-state row is written
 * first, before anything is mutated, because at that instant the bytes on disk ARE the prior state
 * and a row gets a tree exactly when the disk describes that row's state. It stays outside the
 * transaction deliberately: it is a true statement about a state that genuinely existed, so it is
 * correct whether or not the write that follows succeeds — and after a rolled-back write the files
 * on disk are once again exactly what that row describes. Only the PRODUCED row can lie about a
 * write that did not happen, and that row is inside the transaction.
 *
 * WHY IT REUSES `ResourceMutationTransaction` RATHER THAN RESTATING IT. The guarantee `cpm` needs
 * after a failed record — the files go back byte-identical — is the one the server already has,
 * and a second implementation of it is a second thing to keep honest. The class reaches
 * `modules/`, `engine/` and `shared/` only, which `cli-shared-no-runtime` permits, and measured
 * +4.9 KB on the `cpm` bundle (849.2 KB → 854.1 KB against the 900,000-byte budget). Its own
 * `validate` step is left unused here: `cpm`'s writers validate their own input before writing,
 * and a verification pass this module invented would be a check the server does not run at this
 * seam.
 *
 * WHAT IT DOES NOT DO. It does not project. The snapshot for either row arrives from the caller,
 * because the projection of a resource is owned by that resource's `SnapshotContract` and a second
 * projection is the defect this slice exists to remove.
 */

import { readResourceTree } from './object-store.js';
import { appendVersion, BRIDGE_DESCRIPTION } from './version-history-rows.js';

import type { ResourceMutationTarget } from '#modules/resources/services/resource-mutation-transaction.js';
import type { ResourceFileSet } from '#shared/utils/resource-file-set.js';
import type { LoadedTree } from './object-store.js';
import type { AppendOutcome } from './version-history-rows.js';
import type { HistoryRowRequest } from './version-history-types.js';
import type { DatabaseSync } from 'node:sqlite';

import { ResourceMutationTransaction } from '#modules/resources/services/resource-mutation-transaction.js';

/** What one checkpointed write needs to know beyond the rows it writes. */
export interface CheckpointedWriteInput {
  /**
   * The resource's files, re-enumerated on each call.
   *
   * Called once before the write and once after it, rather than once and reused: a write may add a
   * file (a gate gaining a `guidance.md`) or drop one, and a set captured beforehand would record
   * the produced row against the pre-write membership.
   *
   * Never fatal. A resource whose bytes cannot be enumerated or read is recorded projection-only,
   * which is what every `cpm` write recorded before this module existed.
   */
  enumerate: () => Promise<ResourceFileSet>;
  /** Every path the write may touch — what gets restored if the record fails. */
  targets: ResourceMutationTarget[];
  /** The projection of the state on disk right now, from the resource's own contract. */
  priorSnapshot: Record<string, unknown>;
  /** Performs the write and returns the projection of the state it produced. */
  write: () => Promise<Record<string, unknown>>;
  description: string;
  diffSummary?: string;
}

interface CheckpointedWriteOutcome extends AppendOutcome {
  /** True when the prior live state was not already the newest recorded row. */
  bridged: boolean;
}

export type CheckpointedWriteResult =
  | { success: true; outcome: CheckpointedWriteOutcome }
  | { success: false; error: string; rolledBack: boolean };

/**
 * Read the resource's bytes, or `null` when they cannot be recorded.
 *
 * Soft by contract, matching `object-store.ts`: an over-limit or unreadable resource degrades the
 * row to projection-only. A write must never fail because a checkpoint could not be taken.
 */
async function loadTreeQuietly(
  enumerate: () => Promise<ResourceFileSet>
): Promise<LoadedTree | null> {
  try {
    const loaded = await readResourceTree(await enumerate());
    return 'tree' in loaded ? loaded.tree : null;
  } catch {
    return null;
  }
}

/**
 * Bridge the prior state, write the files, then record what the write produced.
 *
 * Takes the open connection and the already-resolved tenant rather than resolving either: which
 * tenant a `cpm` operation writes under is decided by `version-history-scope.ts` and differs by
 * action (a rollback corrects its guess, a first-ever save must not), so a helper that resolved
 * one would be a third answer to a question that already has two deliberate ones.
 */
export async function recordCheckpointedWrite(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRowRequest,
  input: CheckpointedWriteInput
): Promise<CheckpointedWriteResult> {
  const priorTree = await loadTreeQuietly(input.enumerate);
  const bridge = appendVersion(db, tenantId, request, input.priorSnapshot, {
    description: BRIDGE_DESCRIPTION,
    diffSummary: '',
    tree: priorTree,
  });

  let produced: Record<string, unknown> = {};
  const transaction = new ResourceMutationTransaction();
  const result = await transaction.run<void, AppendOutcome>({
    targets: input.targets,
    mutate: async () => {
      produced = await input.write();
    },
    // Last, inside the transaction, exactly as every server processor has it: the produced files
    // are on disk when this runs, so the row it writes may carry their tree — and a throw here
    // lands in the transaction's catch, which puts every target back byte-identical.
    commit: async () =>
      appendVersion(db, tenantId, request, produced, {
        description: input.description,
        diffSummary: input.diffSummary ?? '',
        tree: await loadTreeQuietly(input.enumerate),
      }),
  });

  if (!result.success || result.commitResult === undefined) {
    return {
      success: false,
      error: result.error ?? 'The write failed and no version was recorded.',
      rolledBack: result.rolledBack,
    };
  }
  return { success: true, outcome: { ...result.commitResult, bridged: bridge.recorded } };
}
