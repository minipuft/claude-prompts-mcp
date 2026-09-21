// @lifecycle canonical - Category versioning operations: history, rollback, compare.
import { existsSync } from 'node:fs';

import { CATEGORY_YAML_FILENAME, readCategoryYamlDocument } from './category-file-writer.js';
import { categorySnapshotContract } from './category-snapshot-contract.js';
import { isPreviewRequest } from '../../shared/preview-action.js';

import type { RestorePlan } from '#modules/versioning/index.js';
import type { ToolResponse } from '#shared/types/index.js';
import type { CategoryResourceContext } from '../core/context.js';
import type { CategoryManagerInput } from '../core/types.js';

import {
  applyByteRestore,
  describeIncompleteSnapshot,
  describeRestorePlan,
  describeRollbackPreview,
  describeRollbackRecord,
} from '#modules/versioning/index.js';

export class CategoryVersioningProcessor {
  constructor(private readonly ctx: CategoryResourceContext) {}

  async handleHistory(args: CategoryManagerInput): Promise<ToolResponse> {
    const { id, limit, source_workspace } = args;

    if (id === undefined || id.length === 0) {
      return this.error('Category ID is required for history action');
    }

    const history = await this.ctx.versionHistoryService.loadHistory(
      'category',
      id,
      source_workspace
    );

    if (history === null || history.versions.length === 0) {
      return this.success(
        `No version history for category '${id}'\n\n` +
          `Version history is created automatically when updates are made.`
      );
    }

    const formatted = this.ctx.versionHistoryService.formatHistoryForDisplay(history, limit ?? 10);
    return this.success(formatted);
  }

  async handleRollback(args: CategoryManagerInput): Promise<ToolResponse> {
    const { id, version } = args;

    if (id === undefined || id.length === 0) {
      return this.error('Category ID is required for rollback action');
    }
    if (version === undefined) {
      return this.error('Version number is required for rollback action');
    }

    const yamlPath = this.declarationPath(id);
    if (yamlPath === undefined || !existsSync(yamlPath)) {
      return this.error(
        `Category '${id}' declares no ${CATEGORY_YAML_FILENAME} in the writable root, so there ` +
          `is nothing to roll back. Use action:"create" to author the declaration first.`
      );
    }

    // PHASE 1 — validate. Pure reads only; nothing below writes until phase 2.
    const resolved = await this.ctx.versionHistoryService.resolveRollbackTarget(
      'category',
      id,
      version
    );
    if (!resolved.ok) {
      return this.error(`Rollback failed: ${resolved.error}`);
    }

    const snapshot = resolved.entry.snapshot;
    const restore = categorySnapshotContract.restore(id, snapshot);
    if (!restore.ok) {
      return this.error(describeIncompleteSnapshot('category', id, version, restore.missingFields));
    }

    const declared = await readCategoryYamlDocument(yamlPath, this.ctx.logger);
    if (declared === undefined) {
      return this.error(
        `Rollback failed: ${yamlPath} could not be read, so the state being replaced cannot be ` +
          `recorded. The category was left unchanged.`
      );
    }
    const currentState = categorySnapshotContract.project(id, declared);

    // Does version N carry the FILES, or only their projection? See the same block in
    // `gate-versioning-processor.ts`; a `refused` is never downgraded to a fallback.
    const byteRestore = await this.ctx.versionHistoryService.planByteRestore(
      'category',
      id,
      version
    );
    if (byteRestore.status === 'refused') {
      return this.error(`Rollback failed: ${byteRestore.reason}`);
    }

    if (byteRestore.status === 'ready') {
      if (isPreviewRequest(args)) {
        return this.success(
          describeRollbackPreview('category', id, version, undefined, undefined, byteRestore.plan)
        );
      }
      return this.restoreCategoryBytes(id, version, byteRestore.plan, byteRestore.bytes, {
        currentState,
        snapshot,
      });
    }

    // A preview returns here — after validation, so it refuses an unrestorable version the same
    // way the real call does, and BEFORE the version row is recorded, so neither side-effect
    // surface moves. The diff is projected from the write the rollback below performs — same
    // write model — so it names `category.yaml` as that write leaves it rather than the
    // snapshot's fields rendered as a YAML document no write produces.
    if (isPreviewRequest(args)) {
      return this.success(
        describeRollbackPreview(
          'category',
          id,
          version,
          this.ctx.textDiffService.generateFileChangeDiff(
            await this.ctx.categoryFileService.projectCategoryWrite(restore.writeModel)
          )
        )
      );
    }

    // PHASE 2 + 3 — write and record as ONE transaction (P4.2 / SF-3). The record runs inside the
    // write's transaction after verification, so a failed write records nothing and a failed
    // record restores the file.
    let restoreOutcome: { version?: number; recorded: boolean } | undefined;
    let recordFailure: string | undefined;

    const writeResult = await this.ctx.categoryFileService.writeCategoryFiles(restore.writeModel, {
      commit: async (): Promise<void> => {
        try {
          const saveResult = await this.ctx.versionHistoryService.commitEdit(
            'category',
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
    });

    if (!writeResult.success) {
      return recordFailure !== undefined
        ? this.error(
            `Rollback failed: could not record the version snapshot — ${recordFailure}\n\n` +
              `The category was left unchanged.`
          )
        : this.error(`Rollback write failed: ${writeResult.error}`);
    }

    if (restoreOutcome === undefined) {
      // Unreachable: `commit` either assigns or throws, and a throw fails the write above.
      throw new Error(
        `Rollback of category '${id}' reported a successful write without recording a version`
      );
    }

    await this.ctx.onRefresh?.();

    return this.success(
      `✅ Category '${id}' rolled back to version ${version}\n\n` +
        `${describeRollbackRecord(restoreOutcome)}\n` +
        `🔄 Prompt data reloaded with the restored declaration`
    );
  }

  /**
   * Put version N's recorded bytes back, then record the state that produced.
   *
   * A category's resource is `category.yaml` and never the prompts around it (CLAUDE.md), so the
   * enumerator recorded exactly that one file and this restore writes exactly that one file. The
   * directory of prompts beside it is untouched — the same bound its `delete` already honours.
   */
  private async restoreCategoryBytes(
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
          'category',
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
        `Rollback of category '${id}' reported a successful restore without recording a version`
      );
    }

    await this.ctx.onRefresh?.();

    return this.success(
      `✅ Category '${id}' rolled back to version ${version}, byte for byte\n\n` +
        `${describeRestorePlan(plan)}\n\n` +
        `${describeRollbackRecord(restoreOutcome)}\n` +
        `🔄 Prompt data reloaded with the restored declaration`
    );
  }

  async handleCompare(args: CategoryManagerInput): Promise<ToolResponse> {
    const { id, from_version, to_version, source_workspace } = args;

    if (id === undefined || id.length === 0) {
      return this.error('Category ID is required for compare action');
    }
    if (from_version === undefined || to_version === undefined) {
      return this.error('Both from_version and to_version are required for compare action');
    }

    const result = await this.ctx.versionHistoryService.compareVersions(
      'category',
      id,
      from_version,
      to_version,
      source_workspace
    );

    // Narrowed with an explicit check rather than the `!` the gate and framework copies of this
    // method use: `compareVersions` types both entries optional, so a `success: true` carrying a
    // missing entry would crash on property access instead of being reported.
    const { from, to } = result;
    if (!result.success || from === undefined || to === undefined) {
      return this.error(`Compare failed: ${result.error ?? 'no versions returned'}`);
    }

    const diffResult = this.ctx.textDiffService.generateObjectDiff(
      from.snapshot,
      to.snapshot,
      `${id}/${CATEGORY_YAML_FILENAME}`
    );

    let response =
      `📊 **Version Comparison**: ${id}\n\n` +
      `| Property | Version ${from_version} | Version ${to_version} |\n` +
      `|----------|-----------|------------|\n` +
      `| Date | ${new Date(from.date).toLocaleString()} | ${new Date(to.date).toLocaleString()} |\n` +
      `| Description | ${from.description} | ${to.description} |\n\n`;

    response += diffResult.hasChanges
      ? `${diffResult.formatted}\n`
      : `No differences found between versions.\n`;

    return this.success(response);
  }

  /** The writable root's declaration path for `id`, or `undefined` when the id is unusable. */
  private declarationPath(id: string): string | undefined {
    try {
      return this.ctx.categoryFileService.categoryYamlPath(
        this.ctx.categoryFileService.categoriesRoot(),
        id
      );
    } catch {
      return undefined;
    }
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `❌ ${text}` }], isError: true };
  }
}
