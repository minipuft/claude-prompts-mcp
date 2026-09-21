// @lifecycle canonical - Prompt version history operations.

import { isPreviewRequest } from '../../../shared/preview-action.js';
import { ObjectDiffGenerator } from '../analysis/object-diff-generator.js';
import { PromptResourceContext } from '../core/context.js';
import { ALL_PROMPT_DATA_KEYS, FileOperations } from '../operations/file-operations.js';
import { canonicalPromptSnapshot, validateRequiredFields } from '../utils/validation.js';

import type { PromptResourceInput } from '../../core/types.js';

import {
  applyByteRestore,
  describeRestorePlan,
  describeRollbackPreview,
  describeRollbackRecord,
  restoreWritesNothing,
  type RestorePlan,
  type SnapshotContract,
} from '#modules/versioning/index.js';
import { ToolResponse } from '#shared/types/index.js';

/**
 * Fields a version snapshot must carry before a rollback can reconstruct the prompt from it.
 *
 * A snapshot missing one of these is not a restorable record, and the previous behaviour —
 * `snapshot[k] ?? currentPrompt.k` across every key — silently substituted the LIVE value, so the
 * rollback landed on a state matching neither the target version nor the current one (P7-D2
 * mechanism 2). Absence is now an error naming the field, not a merge.
 */
export const REQUIRED_SNAPSHOT_FIELDS = [
  'name',
  'category',
  'description',
  'userMessageTemplate',
] as const;

/**
 * Fields restored exactly when the snapshot records them and left absent when it does not.
 *
 * `subagentModel` and `agentType` belong here because the converter copies them verbatim from the
 * prompt's own YAML (`promptData.subagentModel != null` guard), so a snapshot's value is the
 * AUTHORED value — restoring it is faithful. `injection` joined them at OQ-P7-8: it is now both
 * settable through the tool and projected by `canonicalPromptSnapshot`, and both of those paths
 * carry a declared value (the caller's own object, or a load-normalised copy of one the file
 * declared), never an inherited default.
 */
export const RESTORED_OPTIONAL_SNAPSHOT_FIELDS = [
  'systemMessage',
  'arguments',
  'chainSteps',
  'gateConfiguration',
  'subagentModel',
  'agentType',
  'injection',
  // P4.83. Both are now projected (`SNAPSHOT_PRESERVED_FIELDS`), both are authored values the
  // converter copies verbatim, and both are `PRESERVED_PROMPT_YAML_KEYS` members — so a supplied
  // value wins in `resolvePreservedPromptYamlFields` and the restored declaration reaches the
  // YAML through the source-preserving writer, comments intact. Without these two entries the
  // snapshot would RECORD them and the rollback would still leave today's value on disk, which
  // is a partial restore announced as a full one.
  'budget',
  'artifacts',
] as const;

/**
 * Snapshot fields deliberately NOT carried into the write, left to the writer's on-disk
 * preservation instead (`resolvePreservedPromptYamlFields`).
 *
 * Both are RESOLVED through prompt → category → global → hard-coded default, so a snapshot value
 * cannot be shown to be the authored one. `canonicalPromptSnapshot` refuses to project them for
 * exactly that reason (see `SNAPSHOT_PRESERVED_FIELDS`), which leaves two ways one can appear in a
 * snapshot: an explicit `register_with_mcp`/`mcp_prompt_mode` on some past update — authored, safe
 * to restore — or a pre-P7 row recorded from a raw `ConvertedPrompt`, whose value is the RESOLVED
 * one. `version_history` is durable and nothing rewrites those rows, so both shapes are live in the
 * same table with nothing per-field to tell them apart; restoring would write an inherited default
 * into a file that never declared it, silently, on a confirm-gated action the operator reads as
 * "restore what version N had".
 *
 * The cost of not restoring is bounded and visible: the field keeps its current on-disk value
 * across a rollback. Setting it is one explicit call away.
 */
export const SNAPSHOT_FIELDS_LEFT_TO_THE_WRITER = ['registerWithMcp', 'mcpPromptMode'] as const;

export type SnapshotRestore =
  { ok: true; promptData: Record<string, unknown> } | { ok: false; missingFields: string[] };

/**
 * Project a version snapshot onto the payload the prompt write model takes — exactly, with no
 * fallback to live content.
 *
 * `null` counts as absent throughout: snapshots round-trip through JSON, which has no `undefined`,
 * and a `null` reaching the writer would either be written into the YAML (failing the loader's
 * schema on the next read) or silently dropped by a truthiness check.
 */
export function buildRestoreFromSnapshot(
  id: string,
  snapshot: Record<string, unknown>
): SnapshotRestore {
  const missingFields = REQUIRED_SNAPSHOT_FIELDS.filter((field) => snapshot[field] == null);
  if (missingFields.length > 0) {
    return { ok: false, missingFields: [...missingFields] };
  }

  const promptData: Record<string, unknown> = { id };
  for (const field of REQUIRED_SNAPSHOT_FIELDS) {
    promptData[field] = snapshot[field];
  }
  for (const field of RESTORED_OPTIONAL_SNAPSHOT_FIELDS) {
    if (snapshot[field] != null) {
      promptData[field] = snapshot[field];
    }
  }

  return { ok: true, promptData };
}

/**
 * The prompt path expressed as a `SnapshotContract`.
 *
 * This is the reference implementation the gate and framework contracts were generalized from, so
 * it is stated in terms of the constants and functions that already existed rather than rewritten
 * against the interface — the exports above keep their current importers, and adopting the shared
 * shape must not change prompt behaviour by a single field.
 */
export const promptSnapshotContract: SnapshotContract<object, Record<string, unknown>> = {
  resourceType: 'prompt',
  requiredFields: REQUIRED_SNAPSHOT_FIELDS,
  projectedFields: [...REQUIRED_SNAPSHOT_FIELDS, ...RESTORED_OPTIONAL_SNAPSHOT_FIELDS],
  // Deliberately NOT wrapped in `canonicalizeSnapshot`, unlike the gate and framework contracts.
  // Prompts never had F18's key-order problem: both the record side and the compare side call
  // `canonicalPromptSnapshot`, so the orders agree by construction. Canonicalizing anyway would
  // change what a prompt snapshot CONTAINS — `id` and every `SNAPSHOT_PRESERVED_FIELDS` member sit
  // outside `projectedFields`, so they would be dropped, and `version_history` is durable, so every
  // existing prompt row would stop matching and bridge once. Uniformity is not worth rewriting the
  // meaning of rows already on disk.
  project: (id, live) => canonicalPromptSnapshot(id, live),
  restore: (id, snapshot) => {
    const result = buildRestoreFromSnapshot(id, snapshot);
    return result.ok
      ? { ok: true, writeModel: result.promptData }
      : { ok: false, missingFields: result.missingFields };
  },
};

/**
 * F7 — say so when a PROJECTION-ONLY rollback leaves script tools untouched.
 *
 * NARROWED AT ROW O.7, AND THE NARROWING IS THE POINT. The sentence below used to be true of every
 * rollback; it is now true of exactly one path. A version row recorded since schema v29 carries the
 * resource's FILES — `resourceFileSet` claims `tools/{id}/tool.yaml`, its script and its schema —
 * so restoring that row restores the tools byte for byte, and this warning would be a false
 * statement about a rollback that did restore them. It is therefore emitted only where it remains
 * exactly true: a bridge row, a row written before v29, or a row degraded to projection-only,
 * restored through `SnapshotContract.restore` and the merging writer.
 *
 * Why the projection genuinely cannot carry them: `canonicalPromptSnapshot` excludes `tools`
 * deliberately (the writer holds definition OBJECTS while `PromptYamlSchema` declares an id list),
 * and `ConvertedPrompt` carries only the loaded definitions, not their bytes.
 *
 * Versioning them in the SNAPSHOT was considered and rejected on measurement (OQ-E1, 2026-08-17).
 * The object store answered the same question a different way — by recording bytes rather than
 * teaching a projection to carry them — which is why that rejection stands and this warning still
 * shrank.
 */
function describeUnversionedScriptTools(livePrompt: { scriptTools?: unknown[] }): string {
  const count = livePrompt.scriptTools?.length ?? 0;
  if (count === 0) return '';
  return (
    `⚠️ ${count} script tool(s) under \`tools/\` are not versioned — ` +
    `their files were left unchanged\n`
  );
}

export class PromptVersioningProcessor {
  private readonly context: PromptResourceContext;
  private readonly fileOperations: FileOperations;
  private readonly textDiffService: ObjectDiffGenerator;

  constructor(context: PromptResourceContext) {
    this.context = context;
    this.fileOperations = context.fileOperations;
    this.textDiffService = context.textDiffService;
  }

  async handleHistory(args: PromptResourceInput): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);
    const { id, limit, source_workspace } = args;

    const prompt = this.getConvertedPrompts().find((p) => p.id === id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${id}` }],
        isError: true,
      };
    }

    const history = await this.context.versionHistoryService.loadHistory(
      'prompt',
      id,
      source_workspace
    );

    if (!history || history.versions.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `No version history for prompt '${id}'\n\n` +
              `Version history is created automatically when updates are made.`,
          },
        ],
        structuredContent: {
          action: 'history',
          id,
          current_version: history?.current_version ?? 0,
          versions: [],
        },
        isError: false,
      };
    }

    const formatted = this.context.versionHistoryService.formatHistoryForDisplay(
      history,
      limit ?? 10
    );
    return {
      content: [{ type: 'text' as const, text: formatted }],
      structuredContent: {
        action: 'history',
        id,
        current_version: history.current_version,
        versions: history.versions.slice(0, limit ?? 10).map((entry) => ({
          version: entry.version,
          date: entry.date,
          diff_summary: entry.diff_summary,
          description: entry.description,
        })),
      },
      isError: false,
    };
  }

  async handleRollback(args: PromptResourceInput): Promise<ToolResponse> {
    validateRequiredFields(args, ['id', 'version']);
    const { id, version } = args;

    // Confirmation is enforced once, ahead of dispatch, by DESTRUCTIVE_ACTIONS in the
    // resource-manager router. `prompt delete` keeps its own guard because that refusal names the
    // dependent prompts; a rollback refusal carries no such information, so it does not.

    const currentPrompt = this.getConvertedPrompts().find((p) => p.id === id);
    if (!currentPrompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${id}` }],
        isError: true,
      };
    }

    // PHASE 1 — validate. Pure read; nothing is written by anything below until phase 2.
    const resolved = await this.context.versionHistoryService.resolveRollbackTarget(
      'prompt',
      id,
      version
    );

    if (!resolved.ok) {
      return {
        content: [{ type: 'text' as const, text: `❌ Rollback failed: ${resolved.error}` }],
        isError: true,
      };
    }

    const snapshot = resolved.entry.snapshot;
    const restore = buildRestoreFromSnapshot(id, snapshot);
    if (!restore.ok) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `❌ Rollback failed: version ${version} of '${id}' is not a complete snapshot — ` +
              `missing ${restore.missingFields.join(', ')}.\n\n` +
              `The prompt was left unchanged and no version was recorded. Substituting the live ` +
              `value for a missing field is what produced rollbacks landing on a state matching ` +
              `neither version.`,
          },
        ],
        isError: true,
      };
    }

    const currentState = canonicalPromptSnapshot(id, currentPrompt);

    // Does version N carry the FILES, or only their projection? See the same block in
    // `gate-versioning-processor.ts`; a `refused` is never downgraded to a fallback.
    //
    // This is what closes P4.83 for a prompt. A chain's `edges` and a prompt's `tools/` are not
    // restored because the snapshot learned to carry them — they are restored because the FILES
    // come back, and the enumerator claimed them at record time.
    const byteRestore = await this.context.versionHistoryService.planByteRestore(
      'prompt',
      id,
      version
    );
    if (byteRestore.status === 'refused') {
      return this.errorResponse(`❌ Rollback failed: ${byteRestore.reason}`);
    }

    if (byteRestore.status === 'ready') {
      if (isPreviewRequest(args)) {
        return this.previewResponse(id, version, byteRestore.plan);
      }
      return this.restorePromptBytes(id, version, byteRestore.plan, byteRestore.bytes, {
        currentState,
        snapshot,
      });
    }

    // A preview returns here — after validation, so it refuses an unrestorable version the same
    // way the real call does, and BEFORE the version row is recorded, so neither the file nor the
    // table moves. The diff is projected from the same write the rollback below performs — same
    // payload, same scope — so it names the files that write lands in rather than the snapshot's
    // fields rendered as one YAML document.
    if (isPreviewRequest(args)) {
      const diff = this.textDiffService.generateFileChangeDiff(
        await this.fileOperations.projectPromptWrite(restore.promptData, ALL_PROMPT_DATA_KEYS)
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: describeRollbackPreview('prompt', id, version, diff),
          },
        ],
        structuredContent: {
          action: 'preview',
          preview_action: 'rollback',
          id,
          target_version: version,
          valid: true,
          mutated: false,
          has_changes: diff.hasChanges,
          diff: diff.diff,
          stats: diff.stats,
        },
        isError: false,
      };
    }

    // PHASE 2 + 3 — write and record as ONE transaction (P4.2 / SF-3). The safety property used to
    // ride on their ORDER, which could only choose a failure mode: recording first left a row for
    // a write that could still fail, recording second left a written file with no version row. The
    // record now runs inside the write's transaction after verification, so a failed write records
    // nothing and a failed record restores the files. Projected through the same shape
    // `updatePrompt` records, because the raw ConvertedPrompt carries loader-resolved runtime keys
    // and passing it here would make the bridge check always see the live state as unrecorded (see
    // canonicalPromptSnapshot).
    let restoreOutcome: { version?: number; recorded: boolean } | undefined;
    let recordFailure: string | undefined;

    // Same write model as `update`: one writer (`createOrUpdateYamlPrompt`) means
    // rollback inherits the on-disk field preservation Tier 1.4 established, so the
    // prompt-level fields the writer builds no value for survive a rollback exactly as they
    // survive an update. `ALL_PROMPT_DATA_KEYS`: rollback owns the WHOLE restored state (Fix B,
    // tier-b-settability-proposal §2/§5) — there is no "what did THIS call touch" to narrow
    // against, a restored snapshot IS the state being written. This is also what lets a rollback
    // to a version recorded under a DIFFERENT category perform a category move (Part 2): the
    // writer resolves that purely from `restore.promptData.category` vs the on-disk directory,
    // with no rollback-specific code needed here.
    try {
      await this.fileOperations.updatePromptImplementation(
        restore.promptData,
        ALL_PROMPT_DATA_KEYS,
        undefined,
        undefined,
        {
          commit: async (): Promise<void> => {
            try {
              const saveResult = await this.context.versionHistoryService.commitEdit(
                'prompt',
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
    } catch (error) {
      const message = recordFailure ?? (error instanceof Error ? error.message : String(error));
      return {
        content: [
          {
            type: 'text' as const,
            text:
              (recordFailure !== undefined
                ? `❌ Rollback failed: could not record the version snapshot — ${message}\n\n`
                : `❌ Rollback failed: the write did not complete — ${message}\n\n`) +
              `The prompt was left unchanged.`,
          },
        ],
        isError: true,
      };
    }

    if (restoreOutcome === undefined) {
      // Unreachable: `commit` either assigns or throws, and a throw is caught above.
      throw new Error(
        `Rollback of prompt '${id}' reported a successful write without recording a version`
      );
    }

    await this.context.dependencies.onRefresh();

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `✅ Prompt '${id}' rolled back to version ${version}\n\n` +
            `${describeRollbackRecord(restoreOutcome)}\n` +
            describeUnversionedScriptTools(currentPrompt) +
            `🔄 Prompts reloaded`,
        },
      ],
      structuredContent: {
        action: 'rollback',
        id,
        restored_version: version,
        current_version: restoreOutcome.version,
        mutated: true,
        refreshed: true,
      },
      isError: false,
    };
  }

  /** One error reply shape, so a new refusal cannot arrive in a different one. */
  private errorResponse(text: string): ToolResponse {
    return { content: [{ type: 'text' as const, text }], isError: true };
  }

  /** The byte-exact preview: the SAME plan value {@link restorePromptBytes} applies. */
  private previewResponse(id: string, version: number, plan: RestorePlan): ToolResponse {
    return {
      content: [
        {
          type: 'text' as const,
          text: describeRollbackPreview('prompt', id, version, undefined, undefined, plan),
        },
      ],
      structuredContent: {
        action: 'preview',
        preview_action: 'rollback',
        id,
        target_version: version,
        valid: true,
        mutated: false,
        has_changes: !restoreWritesNothing(plan),
        files_written: plan.write.map((file) => file.path),
        files_unchanged: plan.unchanged,
        files_left_in_place: plan.leftInPlace,
      },
      isError: false,
    };
  }

  /**
   * Put version N's recorded bytes back, then record the state that produced.
   *
   * No `describeUnversionedScriptTools` warning here, and that absence IS the fix for P4.83: the
   * warning says `tools/` was left unchanged, which stops being true the moment the version row
   * carries the tool files themselves. It stays on the projection path, where it is still exactly
   * true.
   */
  private async restorePromptBytes(
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
        restoreOutcome = await this.context.versionHistoryService.commitEdit(
          'prompt',
          id,
          states.currentState,
          states.snapshot,
          { description: `Rollback to v${version}`, diff_summary: '' }
        );
      },
    });

    if (!outcome.applied) {
      return this.errorResponse(
        `❌ Rollback failed: ${outcome.error}\n\nThe prompt was left unchanged.`
      );
    }
    if (restoreOutcome === undefined) {
      throw new Error(
        `Rollback of prompt '${id}' reported a successful restore without recording a version`
      );
    }

    await this.context.dependencies.onRefresh();

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `✅ Prompt '${id}' rolled back to version ${version}, byte for byte\n\n` +
            `${describeRestorePlan(plan)}\n\n` +
            `${describeRollbackRecord(restoreOutcome)}\n` +
            `🔄 Prompts reloaded`,
        },
      ],
      structuredContent: {
        action: 'rollback',
        id,
        restored_version: version,
        current_version: restoreOutcome.version,
        mutated: true,
        refreshed: true,
        files_written: plan.write.map((file) => file.path),
        files_left_in_place: plan.leftInPlace,
      },
      isError: false,
    };
  }

  async handleCompare(args: PromptResourceInput): Promise<ToolResponse> {
    validateRequiredFields(args, ['id', 'from_version', 'to_version']);
    const { id, from_version, to_version, source_workspace } = args;

    const prompt = this.getConvertedPrompts().find((p) => p.id === id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${id}` }],
        isError: true,
      };
    }

    const result = await this.context.versionHistoryService.compareVersions(
      'prompt',
      id,
      from_version,
      to_version,
      source_workspace
    );

    if (!result.success) {
      return {
        content: [{ type: 'text' as const, text: `❌ Compare failed: ${result.error}` }],
        isError: true,
      };
    }

    const from = result.from;
    const to = result.to;
    if (from === undefined || to === undefined) {
      return {
        content: [{ type: 'text' as const, text: '❌ Compare failed: version data unavailable' }],
        isError: true,
      };
    }

    const diffResult = this.textDiffService.generateObjectDiff(
      from.snapshot,
      to.snapshot,
      `${id}/prompt.yaml`
    );

    let response =
      `📊 **Version Comparison**: ${id}\n\n` +
      `| Property | Version ${from_version} | Version ${to_version} |\n` +
      `|----------|-----------|------------|\n` +
      `| Date | ${new Date(from.date).toLocaleString()} | ${new Date(to.date).toLocaleString()} |\n` +
      `| Description | ${from.description} | ${to.description} |\n\n`;

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n`;
    } else {
      response += `No differences found between versions.\n`;
    }

    return {
      content: [{ type: 'text' as const, text: response }],
      structuredContent: {
        action: 'compare',
        id,
        from: {
          version: from_version,
          date: from.date,
          description: from.description,
        },
        to: {
          version: to_version,
          date: to.date,
          description: to.description,
        },
        has_changes: diffResult.hasChanges,
        diff: diffResult.diff,
        stats: diffResult.stats,
      },
      isError: false,
    };
  }

  private getConvertedPrompts() {
    return this.context.getData().convertedPrompts;
  }
}
