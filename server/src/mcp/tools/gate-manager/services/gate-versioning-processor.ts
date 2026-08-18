// @lifecycle canonical - Gate versioning operations: history, rollback, compare.

import { gateSnapshotContract } from './gate-snapshot-contract.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { GateResourceContext } from '../core/context.js';
import type { GateManagerInput } from '../core/types.js';

import { describeIncompleteSnapshot, describeRollbackPreview } from '#modules/versioning/index.js';

export class GateVersioningProcessor {
  constructor(private readonly ctx: GateResourceContext) {}

  async handleHistory(args: GateManagerInput): Promise<ToolResponse> {
    const { id, limit, source_workspace } = args;

    if (!id) return this.error('Gate ID is required for history action');

    if (!this.ctx.gateManager.has(id)) {
      return this.error(`Gate '${id}' not found`);
    }

    const history = await this.ctx.versionHistoryService.loadHistory('gate', id, source_workspace);

    if (!history || history.versions.length === 0) {
      return this.success(
        `No version history for gate '${id}'\n\n` +
          `Version history is created automatically when updates are made.`
      );
    }

    const formatted = this.ctx.versionHistoryService.formatHistoryForDisplay(history, limit ?? 10);
    return this.success(formatted);
  }

  async handleRollback(args: GateManagerInput): Promise<ToolResponse> {
    const { id, version } = args;

    if (!id) return this.error('Gate ID is required for rollback action');
    if (version === undefined) {
      return this.error('Version number is required for rollback action');
    }
    const existingGate = this.ctx.gateManager.get(id);
    if (!existingGate) {
      return this.error(`Gate '${id}' not found`);
    }

    // PHASE 1 — validate. Pure reads only; nothing below writes until phase 2.
    const resolved = await this.ctx.versionHistoryService.resolveRollbackTarget(
      'gate',
      id,
      version
    );
    if (!resolved.ok) {
      return this.error(`Rollback failed: ${resolved.error}`);
    }

    const snapshot = resolved.entry.snapshot;
    const restore = gateSnapshotContract.restore(id, snapshot);
    if (!restore.ok) {
      return this.error(describeIncompleteSnapshot('gate', id, version, restore.missingFields));
    }

    const currentState = gateSnapshotContract.project(id, existingGate);

    // `dry_run` returns here — after validation, so a preview refuses an unrestorable version the
    // same way the real call does, and BEFORE the version row is recorded, so neither of the two
    // side-effect surfaces moves.
    if (args.dry_run === true) {
      return this.success(
        describeRollbackPreview(
          'gate',
          id,
          version,
          this.ctx.textDiffService.generateObjectDiff(currentState, snapshot, `${id}/gate.yaml`)
        )
      );
    }

    // PHASE 2 — record. Throws on persistence failure, which aborts with nothing on disk. The
    // ordering is the safety property: recording after the write would leave a written file with
    // no version row. Projected through the same contract `handleUpdate` records, or the bridge
    // check would compare a projection against a differently-shaped live state and bridge on
    // every rollback.
    let saveResult;
    try {
      saveResult = await this.ctx.versionHistoryService.commitEdit(
        'gate',
        id,
        currentState,
        snapshot,
        { description: `Rollback to v${version}`, diff_summary: '' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(
        `Rollback failed: could not record the version snapshot — ${message}\n\n` +
          `The gate was left unchanged.`
      );
    }

    // PHASE 3 — write. Fields outside the projection are carried forward from disk by
    // `resolvePreservedGateYamlFields` inside the writer, which is where that live read belongs.
    const writeResult = await this.ctx.gateFileService.writeGateFiles(restore.writeModel);
    if (!writeResult.success) {
      return this.error(`Rollback write failed: ${writeResult.error}`);
    }

    const reloaded = await this.ctx.gateManager.reload(id);

    return this.success(
      `✅ Gate '${id}' rolled back to version ${version}\n\n` +
        `📜 Restored state recorded as version ${saveResult.version}\n` +
        (reloaded
          ? `🔄 Gate reloaded with restored content`
          : `⚠️ Files restored, but the gate could not be reloaded into this process — it still ` +
            `holds its pre-rollback content. See the server log.`)
    );
  }

  async handleCompare(args: GateManagerInput): Promise<ToolResponse> {
    const { id, from_version, to_version, source_workspace } = args;

    if (!id) return this.error('Gate ID is required for compare action');
    if (from_version === undefined || to_version === undefined) {
      return this.error('Both from_version and to_version are required for compare action');
    }

    if (!this.ctx.gateManager.has(id)) {
      return this.error(`Gate '${id}' not found`);
    }

    const result = await this.ctx.versionHistoryService.compareVersions(
      'gate',
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
      `${id}/gate.yaml`
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
    return { content: [{ type: 'text', text: `❌ ${text}` }], isError: true };
  }
}
