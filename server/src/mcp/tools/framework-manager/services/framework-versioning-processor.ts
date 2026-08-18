// @lifecycle canonical - Framework versioning operations: history, rollback, compare.

import { reregisterFramework } from './framework-reregistration.js';
import { frameworkSnapshotContract } from './framework-snapshot-contract.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { FrameworkResourceContext } from '../core/context.js';
import type { FrameworkManagerInput } from '../core/types.js';

import { describeIncompleteSnapshot, describeRollbackPreview } from '#modules/versioning/index.js';

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
    if (!restore.ok) {
      return this.error(
        describeIncompleteSnapshot('framework', id, version, restore.missingFields)
      );
    }

    const currentState = frameworkSnapshotContract.project(id, existingData);

    // `dry_run` returns here — after validation, so a preview refuses an unrestorable version the
    // same way the real call does, and BEFORE the version row is recorded.
    if (args.dry_run === true) {
      return this.success(
        describeRollbackPreview(
          'framework',
          id,
          version,
          this.ctx.textDiffService.generateObjectDiff(
            currentState,
            snapshot,
            `${id}/framework.yaml`
          ),
          restore.unrecordedFields
        )
      );
    }

    // PHASE 2 — record, before any write, so a persistence failure aborts with nothing on disk.
    let saveResult;
    try {
      saveResult = await this.ctx.versionHistoryService.commitEdit(
        'framework',
        id,
        currentState,
        snapshot,
        { description: `Rollback to v${version}`, diff_summary: '' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(
        `Rollback failed: could not record the version snapshot — ${message}\n\n` +
          `The framework was left unchanged.`
      );
    }

    // PHASE 3 — write. Fields outside the projection are carried forward by the writer's deep
    // merge over the existing YAML, which is why they are not in the projection to begin with.
    const writeResult = await this.ctx.fileService.writeFrameworkFiles(
      restore.writeModel,
      existingData
    );
    if (!writeResult.success) {
      return this.error(`Rollback write failed: ${writeResult.error}`);
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
      `📜 Restored state recorded as version ${saveResult.version}\n`;

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
