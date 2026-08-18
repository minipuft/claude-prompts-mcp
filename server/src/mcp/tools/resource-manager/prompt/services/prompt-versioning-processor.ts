// @lifecycle canonical - Prompt version history operations.

import { ObjectDiffGenerator } from '../analysis/object-diff-generator.js';
import { PromptResourceContext } from '../core/context.js';
import { ALL_PROMPT_DATA_KEYS, FileOperations } from '../operations/file-operations.js';
import { canonicalPromptSnapshot, validateRequiredFields } from '../utils/validation.js';

import type { PromptResourceInput } from '../../core/types.js';

import { describeRollbackPreview, type SnapshotContract } from '#modules/versioning/index.js';
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
 * F7 — say so when a rollback leaves script tools untouched.
 *
 * `tools/{id}/` holds `tool.yaml`, `schema.json` and a script file, none of which a version
 * snapshot records: `canonicalPromptSnapshot` excludes `tools` deliberately (the writer holds
 * definition OBJECTS while `PromptYamlSchema` declares an id list), and `ConvertedPrompt` carries
 * only the loaded definitions, not their bytes. So a rollback restores the template and leaves the
 * scripts at whatever they currently are.
 *
 * Versioning them was considered and rejected on measurement (OQ-E1, 2026-08-17): 7 of 121 prompt
 * directories declare tools, and no gate or framework directory has a single file its writer does
 * not already own. What is NOT acceptable is the silence — a partial restore reported as a full
 * one is the defect class this whole change removes, and it does not stop being one because the
 * missing part is a file rather than a field.
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
        isError: false,
      };
    }

    const formatted = this.context.versionHistoryService.formatHistoryForDisplay(
      history,
      limit ?? 10
    );
    return {
      content: [{ type: 'text' as const, text: formatted }],
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

    // `dry_run` returns here — after validation, so a preview refuses an unrestorable version the
    // same way the real call does, and BEFORE the version row is recorded, so neither the file nor
    // the table moves.
    if (args.dry_run === true) {
      return {
        content: [
          {
            type: 'text' as const,
            text: describeRollbackPreview(
              'prompt',
              id,
              version,
              this.textDiffService.generateObjectDiff(currentState, snapshot, `${id}/prompt.yaml`)
            ),
          },
        ],
        isError: false,
      };
    }

    // PHASE 2 — record. Throws on persistence failure, which aborts with nothing on disk. This
    // ordering is the safety property: recording after the write would leave a written file with
    // no version row. Projected through the same shape `updatePrompt` records, because the raw
    // ConvertedPrompt carries loader-resolved runtime keys and passing it here would make the
    // bridge check always see the live state as unrecorded (see canonicalPromptSnapshot).
    let saveResult;
    try {
      saveResult = await this.context.versionHistoryService.commitEdit(
        'prompt',
        id,
        currentState,
        snapshot,
        { description: `Rollback to v${version}`, diff_summary: '' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `❌ Rollback failed: could not record the version snapshot — ${message}\n\n` +
              `The prompt was left unchanged.`,
          },
        ],
        isError: true,
      };
    }

    // PHASE 3 — write. Same write model as `update`: one writer (`createOrUpdateYamlPrompt`) means
    // rollback inherits the on-disk field preservation Tier 1.4 established, so the five
    // prompt-level fields the writer builds no value for survive a rollback exactly as they
    // survive an update. `ALL_PROMPT_DATA_KEYS`: rollback owns the WHOLE restored state (Fix B,
    // tier-b-settability-proposal §2/§5) — there is no "what did THIS call touch" to narrow
    // against, a restored snapshot IS the state being written. This is also what lets a rollback
    // to a version recorded under a DIFFERENT category perform a category move (Part 2): the
    // writer resolves that purely from `restore.promptData.category` vs the on-disk directory,
    // with no rollback-specific code needed here.
    await this.fileOperations.updatePromptImplementation(restore.promptData, ALL_PROMPT_DATA_KEYS);
    await this.context.dependencies.onRefresh();

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `✅ Prompt '${id}' rolled back to version ${version}\n\n` +
            `📜 Restored state recorded as version ${saveResult.version}\n` +
            describeUnversionedScriptTools(currentPrompt) +
            `🔄 Prompts reloaded`,
        },
      ],
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

    const diffResult = this.textDiffService.generateObjectDiff(
      result.from!.snapshot,
      result.to!.snapshot,
      `${id}/prompt.yaml`
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

    return {
      content: [{ type: 'text' as const, text: response }],
      isError: false,
    };
  }

  private getConvertedPrompts() {
    return this.context.getData().convertedPrompts;
  }
}
