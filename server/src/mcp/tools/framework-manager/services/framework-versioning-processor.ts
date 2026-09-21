// @lifecycle canonical - Framework versioning operations: history, rollback, compare.

import { reregisterFramework } from './framework-reregistration.js';
import { frameworkSnapshotContract } from './framework-snapshot-contract.js';
import { isPreviewRequest } from '../../shared/preview-action.js';

import type { RestorePlan } from '#modules/versioning/index.js';
import type { ToolResponse } from '#shared/types/index.js';
import type { FrameworkResourceContext } from '../core/context.js';
import type { FrameworkManagerInput } from '../core/types.js';

import {
  applyByteRestore,
  describeIncompleteSnapshot,
  describeRestorePlan,
  describeRollbackPreview,
  describeRollbackRecord,
} from '#modules/versioning/index.js';

export class FrameworkVersioningProcessor {
  constructor(private readonly ctx: FrameworkResourceContext) {}

  async handleHistory(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, limit, source_workspace } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for history action');
    }

    const framework = this.ctx.frameworkManager.getFramework(id);
    if (framework === undefined) {
      return this.error(`Framework '${id}' not found`);
    }

    const history = await this.ctx.versionHistoryService.loadHistory(
      'framework',
      id,
      source_workspace
    );

    if (!history || history.versions.length === 0) {
      return this.success(
        `No version history for framework '${id}'\n\n` +
          `Version history is created automatically when updates are made.`
      );
    }

    const formatted = this.ctx.versionHistoryService.formatHistoryForDisplay(history, limit ?? 10);
    return this.success(formatted);
  }

  async handleRollback(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, version } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for rollback action');
    }
    if (version === undefined) {
      return this.error('Version number is required for rollback action');
    }
    const existingFramework = this.ctx.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.error(`Framework '${id}' not found`);
    }

    // Load existing data to capture current state
    const existingData = await this.ctx.fileService.loadExistingFramework(id);
    if (existingData === null) {
      return this.error(`Failed to load current framework state`);
    }

    // PHASE 1 — validate. Pure reads only; nothing below writes until phase 2.
    const resolved = await this.ctx.versionHistoryService.resolveRollbackTarget(
      'framework',
      id,
      version
    );
    if (!resolved.ok) {
      return this.error(`Rollback failed: ${resolved.error}`);
    }

    const snapshot = resolved.entry.snapshot;
    const restore = frameworkSnapshotContract.restore(id, snapshot);
    const currentState = frameworkSnapshotContract.project(id, existingData);

    // Does version N carry the FILES, or only their projection? See the same block in
    // `gate-versioning-processor.ts` for what each of the three answers means; a `refused` is
    // never downgraded to a fallback.
    //
    // Extracted into its own method here and inline in the other three processors, for one
    // measured reason: this method was already the most branched of the four and the inline form
    // took it to cognitive complexity 17, over the 15 the project blocks at.
    const byteResponse = await this.tryByteRollback(args, id, version, { currentState, snapshot });
    if (byteResponse !== undefined) {
      return byteResponse;
    }

    // The byte path does not need a restorable PROJECTION, so its check runs after the branch.
    // A version whose snapshot is missing a required field may still carry the resource's files,
    // and refusing that rollback would refuse a restore the record can perform — the projection's
    // completeness is a property of the fallback, not of the version.
    if (!restore.ok) {
      return this.error(
        describeIncompleteSnapshot('framework', id, version, restore.missingFields)
      );
    }

    // A preview returns here — after validation, so it refuses an unrestorable version the same
    // way the real call does, and BEFORE the version row is recorded. The diff is projected from
    // the write the rollback below performs — same write model, same merge base — so it names the
    // framework files that write lands in rather than the snapshot's fields rendered as one YAML
    // document.
    if (isPreviewRequest(args)) {
      return this.success(
        describeRollbackPreview(
          'framework',
          id,
          version,
          this.ctx.textDiffService.generateFileChangeDiff(
            await this.ctx.fileService.projectFrameworkWrite(restore.writeModel, existingData)
          ),
          restore.unrecordedFields
        )
      );
    }

    // PHASE 2 + 3 — write and record, as ONE transaction rather than as two ordered steps
    // (P4.2 / SF-3). The record runs inside the write's transaction after the files are verified,
    // so a failed write records nothing and a failed record restores the files. `recordFailure`
    // keeps the two causes tellable apart in the response now that both surface as one rejection.
    //
    // Fields outside the projection are carried forward by the writer's deep merge over the
    // existing YAML, which is why they are not in the projection to begin with.
    let restoreOutcome: { version?: number; recorded: boolean } | undefined;
    let recordFailure: string | undefined;

    const writeResult = await this.ctx.fileService.writeFrameworkFiles(
      restore.writeModel,
      existingData,
      {
        commit: async (): Promise<void> => {
          try {
            const saveResult = await this.ctx.versionHistoryService.commitEdit(
              'framework',
              id,
              currentState,
              snapshot,
              { description: `Rollback to v${version}`, diff_summary: '' }
            );
            restoreOutcome = saveResult;
          } catch (error) {
            recordFailure = error instanceof Error ? error.message : String(error);
            throw error;
          }
        },
      }
    );

    if (!writeResult.success) {
      return recordFailure !== undefined
        ? this.error(
            `Rollback failed: could not record the version snapshot — ${recordFailure}\n\n` +
              `The framework was left unchanged.`
          )
        : this.error(`Rollback write failed: ${writeResult.error}`);
    }

    if (restoreOutcome === undefined) {
      // Unreachable: `commit` either assigns or throws, and a throw fails the write above. Loud
      // rather than defaulted, because a rollback that silently reported no version would be the
      // unrecorded-write defect this row exists to close, wearing a nicer number.
      throw new Error(
        `Rollback of framework '${id}' reported a successful write without recording a version`
      );
    }

    // Re-register the framework this rollback just rewrote. `onRefresh` does not do it — see
    // `reregisterFramework`. Until 2026-08-18 this path awaited `onRefresh` alone and then
    // asserted `🔄 Framework registry reloaded`, the exact string `d5eaa6a1` deleted from
    // `handleUpdate` and `handleReload` one file over. A rollback writes through the same file
    // service, so it owed the same call and made the same false claim.
    const registered = await reregisterFramework(this.ctx, id);

    await this.ctx.onRefresh?.();

    let response =
      `✅ Framework '${id}' rolled back to version ${version}\n\n` +
      `${describeRollbackRecord(restoreOutcome)}\n`;

    // A merge writer cannot remove a key, so a field the snapshot never recorded keeps its
    // current value. Saying so is the difference between a partial restore and a partial restore
    // reported as a full one.
    if (restore.unrecordedFields !== undefined) {
      response +=
        `⚠️ Version ${version} recorded no ${restore.unrecordedFields.join(', ')} — ` +
        `left at the current value\n`;
    }

    if (!registered) {
      return this.success(
        `${response}⚠️ The files were written, but the in-memory framework still holds its ` +
          `pre-rollback content and will until the server restarts. See the server log for why ` +
          `registration failed.`
      );
    }

    return this.success(
      `${response}🔄 Re-registered — the restored content is live in this process`
    );
  }

  /**
   * The byte path's answer, or `undefined` to mean "this version has no tree — carry on".
   *
   * `undefined` is the only value that continues the caller; every other outcome is a complete
   * reply. A `refused` therefore cannot be mistaken for "fall through", which is the one way this
   * shape could reintroduce the silent fallback the refusal exists to prevent.
   */
  private async tryByteRollback(
    args: FrameworkManagerInput,
    id: string,
    version: number,
    states: { currentState: Record<string, unknown>; snapshot: Record<string, unknown> }
  ): Promise<ToolResponse | undefined> {
    const byteRestore = await this.ctx.versionHistoryService.planByteRestore(
      'framework',
      id,
      version
    );
    if (byteRestore.status === 'refused') {
      return this.error(`Rollback failed: ${byteRestore.reason}`);
    }
    if (byteRestore.status !== 'ready') {
      return undefined;
    }
    if (isPreviewRequest(args)) {
      return this.success(
        describeRollbackPreview('framework', id, version, undefined, undefined, byteRestore.plan)
      );
    }
    return this.restoreFrameworkBytes(id, version, byteRestore.plan, byteRestore.bytes, states);
  }

  /**
   * Put version N's recorded bytes back, then record the state that produced.
   *
   * No `unrecordedFields` warning on this path, and its absence is the observable improvement. That
   * warning exists because the framework writer DEEP-MERGES over the existing YAML and therefore
   * cannot remove a key the snapshot never carried. A file-set restore replaces whole files, so
   * every recorded field is restored and nothing is left at a current value — there is nothing to
   * warn about. What CAN still differ from version N is a file the version never recorded, and
   * `describeRestorePlan` names those by path (owner ruling R57).
   */
  private async restoreFrameworkBytes(
    id: string,
    version: number,
    plan: RestorePlan,
    bytes: ReadonlyMap<string, Uint8Array>,
    states: { currentState: Record<string, unknown>; snapshot: Record<string, unknown> }
  ): Promise<ToolResponse> {
    let restoreOutcome: { version?: number; recorded: boolean } | undefined;

    const outcome = await applyByteRestore({
      plan,
      bytes,
      commit: async (): Promise<void> => {
        restoreOutcome = await this.ctx.versionHistoryService.commitEdit(
          'framework',
          id,
          states.currentState,
          states.snapshot,
          { description: `Rollback to v${version}`, diff_summary: '' }
        );
      },
    });

    if (!outcome.applied) {
      return this.error(`Rollback failed: ${outcome.error}`);
    }
    if (restoreOutcome === undefined) {
      throw new Error(
        `Rollback of framework '${id}' reported a successful restore without recording a version`
      );
    }

    const registered = await reregisterFramework(this.ctx, id);
    await this.ctx.onRefresh?.();

    const response =
      `✅ Framework '${id}' rolled back to version ${version}, byte for byte\n\n` +
      `${describeRestorePlan(plan)}\n\n` +
      `${describeRollbackRecord(restoreOutcome)}\n`;

    return this.success(
      registered
        ? `${response}🔄 Re-registered — the restored content is live in this process`
        : `${response}⚠️ The files were written, but the in-memory framework still holds its ` +
            `pre-rollback content and will until the server restarts. See the server log for why ` +
            `registration failed.`
    );
  }

  async handleCompare(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, from_version, to_version, source_workspace } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for compare action');
    }
    if (from_version === undefined || to_version === undefined) {
      return this.error('Both from_version and to_version are required for compare action');
    }

    const framework = this.ctx.frameworkManager.getFramework(id);
    if (framework === undefined) {
      return this.error(`Framework '${id}' not found`);
    }

    const result = await this.ctx.versionHistoryService.compareVersions(
      'framework',
      id,
      from_version,
      to_version,
      source_workspace
    );

    if (!result.success) {
      return this.error(`Compare failed: ${result.error}`);
    }

    const diffResult = this.ctx.textDiffService.generateObjectDiff(
      result.from!.snapshot,
      result.to!.snapshot,
      `${id}/framework.yaml`
    );

    let response =
      `📊 **Version Comparison**: ${id}\n\n` +
      `| Property | Version ${from_version} | Version ${to_version} |\n` +
      `|----------|-----------|------------|\n` +
      `| Date | ${new Date(result.from!.date).toLocaleString()} | ${new Date(result.to!.date).toLocaleString()} |\n` +
      `| Description | ${result.from!.description} | ${result.to!.description} |\n\n`;

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n`;
    } else {
      response += `No differences found between versions.\n`;
    }

    return this.success(response);
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true };
  }
}
