// @lifecycle canonical - Prompt create/update/delete operations.

import { ComparisonEngine } from '../analysis/comparison-engine.js';
import { ObjectDiffGenerator } from '../analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../analysis/prompt-analyzer.js';
import { PromptResourceContext } from '../core/context.js';
import { FileOperations, PRESERVED_PROMPT_YAML_KEYS } from '../operations/file-operations.js';
import {
  PATCH_TARGET_FIELDS,
  applyTemplatePatches,
  findPatchParameterConflict,
  type PatchTargetField,
  type TemplatePatchOperation,
} from '../operations/template-patch.js';
import {
  UPDATE_FIELDS,
  type PromptWriteDefect,
  applyChainStepOperation,
  canonicalPromptSnapshot,
  diagnosePromptWrite,
  normalizePromptId,
  validateChainStepReferences,
  validatePromptId,
  validateRequiredFields,
  validateToolDefinitions,
} from '../utils/validation.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { PromptData } from '#modules/prompts/types.js';
import type { CategoryShipStatus } from '../core/types.js';

import { PromptReferenceValidator } from '#engine/execution/reference/index.js';
import { ToolResponse } from '#shared/types/index.js';
import { PromptError } from '#shared/utils/index.js';

export class PromptLifecycleProcessor {
  private readonly context: PromptResourceContext;
  private readonly promptAnalyzer: PromptAnalyzer;
  private readonly comparisonEngine: ComparisonEngine;
  private readonly textDiffService: ObjectDiffGenerator;
  private readonly fileOperations: FileOperations;

  constructor(context: PromptResourceContext) {
    this.context = context;
    this.promptAnalyzer = context.promptAnalyzer;
    this.comparisonEngine = context.comparisonEngine;
    this.textDiffService = context.textDiffService;
    this.fileOperations = context.fileOperations;
  }

  async createPrompt(args: any): Promise<ToolResponse> {
    // OQ-P7-9: `patch` and `dry_run` are update-only verbs — `patch` targets an existing
    // prompt's stored template, and `dry_run` previews a diff against one. Neither has a
    // referent on `create`. The schema accepts both on every action (P7 row 3.4/3.5 kept them
    // action-agnostic there), so silent acceptance here would be the exact accepted-here/
    // ignored-there asymmetry P7-D4 exists to kill. Checked first, before any side effect —
    // ahead of even required-field validation.
    if (args?.patch !== undefined) {
      throw new PromptError(
        '\'patch\' is not valid on action:"create" — there is no existing prompt to patch. ' +
          'Supply the full template via `user_message_template`, or create the prompt first and ' +
          'patch it with action:"update".'
      );
    }
    if (args?.dry_run !== undefined) {
      throw new PromptError(
        '\'dry_run\' is not valid on action:"create" — there is no existing prompt to diff ' +
          'against. Create the prompt, then use action:"update" with `dry_run` to preview edits.'
      );
    }

    validateRequiredFields(args, ['id', 'name', 'description', 'user_message_template']);
    const rawId = String(args.id);
    validatePromptId(rawId);

    // Normalize ID: hyphens/spaces → underscores (canonical form)
    const canonicalId = normalizePromptId(rawId);

    // Check for duplicate (normalized ID already exists)
    const existing = this.getConvertedPrompts().find(
      (p) => normalizePromptId(p.id) === canonicalId
    );
    if (existing) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `❌ **Prompt creation blocked**: A prompt with ID \`${existing.id}\` already exists.\nThe requested ID \`${rawId}\` normalizes to \`${canonicalId}\` which conflicts with the existing prompt.\n\n💡 Hyphens and underscores are treated as equivalent in prompt IDs.`,
          },
        ],
        isError: true,
      };
    }

    // Use normalized ID from here forward
    (args as Record<string, unknown>)['id'] = canonicalId;

    const typedArgs = args as {
      id: string;
      user_message_template: string;
      system_message?: string;
    };
    const refValidator = new PromptReferenceValidator(this.getConvertedPrompts());
    const refValidation = refValidator.validate(
      typedArgs.id,
      typedArgs.user_message_template,
      typedArgs.system_message
    );

    if (!refValidation.valid) {
      const errorDetails = refValidation.errors
        .map((e) => `• **${e.type}**: ${e.details}`)
        .join('\n');
      return {
        content: [
          {
            type: 'text' as const,
            text: `❌ **Prompt creation blocked** due to reference errors:\n\n${errorDetails}\n\n💡 Ensure all referenced prompts exist before creating this prompt.`,
          },
        ],
        isError: true,
      };
    }

    if (args.tools && args.tools.length > 0) {
      const toolErrors = validateToolDefinitions(args.tools);
      if (toolErrors.length > 0) {
        const errorDetails = toolErrors.map((e) => `• ${e}`).join('\n');
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ **Prompt creation blocked** due to tool validation errors:\n\n${errorDetails}\n\n💡 Check tool definitions for required fields (id, name, script) and valid values.`,
            },
          ],
          isError: true,
        };
      }
    }

    const promptData: any = {
      id: args.id,
      name: args.name,
      category: args.category || 'general',
      description: args.description,
      systemMessage: args.system_message,
      userMessageTemplate: args.user_message_template,
      arguments: args.arguments || [],
      isChain: args.is_chain || false,
      chainSteps: args.chain_steps || [],
      tools: args.tools || [],
      gateConfiguration: args['gate_configuration'],
    };

    // OQ-P7-8: the same five fields `update` can set, on `create` too — a field settable only
    // after the prompt exists forces a create-then-update dance for something authorable in one
    // call, and leaves `create` and `update` accepting different vocabularies (the
    // accepted-here/ignored-there asymmetry P7-D4 exists to kill). Written through the same
    // `UPDATE_FIELDS` map so the two paths cannot drift, and only for parameters actually
    // supplied: an undefined value here would be a key the writer's preservation resolver has to
    // ignore, and on `create` there is no on-disk file to fall back to anyway.
    // Narrowed once rather than reaching into `any` per access, matching `updatePrompt`'s
    // `suppliedArgs`/`promptFields` pair below.
    const suppliedArgs = args as Record<string, unknown>;
    const promptFields = promptData as Record<string, unknown>;
    const preservedKeys = PRESERVED_PROMPT_YAML_KEYS as readonly string[];
    for (const [argKey, dataKey] of Object.entries(UPDATE_FIELDS)) {
      if (preservedKeys.includes(dataKey) && suppliedArgs[argKey] !== undefined) {
        promptFields[dataKey] = suppliedArgs[argKey];
      }
    }

    // Chain step reference validation (non-blocking warnings)
    let chainIntegrityWarnings: string[] = [];
    if (promptData.chainSteps.length > 0) {
      const allPromptIds = this.getConvertedPrompts().map((p) => p.id);
      chainIntegrityWarnings = validateChainStepReferences(
        promptData.chainSteps,
        allPromptIds
      ).warnings;
    }

    const writeResult = await this.fileOperations.updatePromptImplementation(promptData);
    const analysis = await this.promptAnalyzer.analyzePromptIntelligence(promptData);

    let response = `✅ **Prompt Created**: ${args.name} (${args.id})\n`;
    response += `📝 ${args.description}\n`;
    response += `${analysis.feedback}`;

    if (analysis.suggestions.length > 0) {
      response += `💡 ${analysis.suggestions.join(' • ')}\n`;
    }

    if (promptData.gateConfiguration) {
      response += `\n🔒 **Gate Configuration Applied**:\n`;
      if (promptData.gateConfiguration.include) {
        response += `- Include Gates: ${promptData.gateConfiguration.include.join(', ')}\n`;
      }
      if (promptData.gateConfiguration.inline_gate_definitions) {
        response += `- Inline Gate Definitions: ${promptData.gateConfiguration.inline_gate_definitions.length} defined\n`;
      }
      // No explicit gate configuration: offer rule-based recommendations. This was previously
      // gated on an LLM-integration flag that defaulted off, which hid `GateAnalyzer` output
      // that never depended on a model.
    } else {
      try {
        const gateAnalysis = await this.context.gateAnalyzer.analyzePromptForGates({
          id: promptData.id,
          name: promptData.name,
          category: promptData.category,
          description: promptData.description,
          userMessageTemplate: promptData.userMessageTemplate,
          systemMessage: promptData.systemMessage,
          arguments: promptData.arguments || [],
        });

        if (gateAnalysis.recommendedGates.length > 0) {
          response += `\n💡 **Suggested Gates**: Consider adding these gates:\n`;
          gateAnalysis.recommendedGates.slice(0, 3).forEach((gate) => {
            response += `- ${gate}\n`;
          });
          response += `Use \`update\` action with \`gate_configuration\` parameter to add gates.\n`;
        }
      } catch (error) {
        this.context.dependencies.logger.warn('Failed to analyze gates for new prompt:', error);
      }
    }

    if (promptData.tools && promptData.tools.length > 0) {
      response += `\n🔧 **Script Tools Created**: ${promptData.tools.length} tool(s)\n`;
      for (const tool of promptData.tools) {
        response += `- \`${tool.id}\`: ${tool.name}`;
        if (tool.trigger && tool.trigger !== 'schema_match') {
          response += ` (trigger: ${tool.trigger})`;
        }
        response += '\n';
      }
    }

    if (chainIntegrityWarnings.length > 0) {
      response += `\n⚠️ **Chain Integrity Warnings**:\n`;
      for (const warning of chainIntegrityWarnings) {
        response += `- ${warning}\n`;
      }
    }

    response += this.buildCategoryShipWarning(writeResult.categoryShipStatus);

    await this.handleSystemRefresh(args.full_restart, `Prompt created: ${args.id}`);

    return {
      content: [{ type: 'text' as const, text: response }],
      isError: false,
    };
  }

  async updatePrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    const currentPrompt = this.getConvertedPrompts().find((prompt) => prompt.id === args.id);
    let beforeAnalysis = null;
    // Projected, not spread: a raw ConvertedPrompt carries loader-resolved runtime keys the
    // recorded snapshot shape never has, which would make recordEditResult's bridge check see
    // every post-reload edit as out-of-band (see canonicalPromptSnapshot).
    const beforeContent =
      currentPrompt !== undefined
        ? (canonicalPromptSnapshot(args.id, currentPrompt) as unknown as ConvertedPrompt)
        : null;

    if (currentPrompt) {
      beforeAnalysis = await this.promptAnalyzer.analyzePrompt(currentPrompt);
    }

    if (args.tools && args.tools.length > 0) {
      const toolErrors = validateToolDefinitions(args.tools);
      if (toolErrors.length > 0) {
        const errorDetails = toolErrors.map((e) => `• ${e}`).join('\n');
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ **Prompt update blocked** due to tool validation errors:\n\n${errorDetails}\n\n💡 Check tool definitions for required fields (id, name, script) and valid values.`,
            },
          ],
          isError: true,
        };
      }
    }

    // Build base from existing prompt, then override only explicitly provided fields. The base
    // is the same projection `beforeContent` uses, so the bridge check and every diff compare
    // like against like; `tools` rides on top because it only ever arrives via `args.tools`.
    const promptData: any = {
      ...canonicalPromptSnapshot(args.id, currentPrompt),
      tools: args.tools,
    };

    for (const [argKey, dataKey] of Object.entries(UPDATE_FIELDS)) {
      if (args[argKey] !== undefined) {
        promptData[dataKey] = args[argKey];
      }
    }
    // `gate_configuration` flows through UPDATE_FIELDS like every other field. It carried a
    // hand-written special case here until 2026-08-06 (row 1.6) whose only purpose was accepting
    // the [Framework] `gates` parameter as an alias — accepted on update, silently ignored on
    // create. That asymmetry is what settled it as unintended rather than designed.

    // Anchored patches (P7 row 3.4) apply AFTER the UPDATE_FIELDS merge and BEFORE reference
    // validation, the version record and the write. That placement is what makes acceptance (c)
    // hold: `promptData` reaches `recordEditResult` already patched, so a patch and the equivalent
    // full update record the identical snapshot and diff. Any hook after the version record would
    // version the unpatched state.
    // Narrowed once rather than reaching into `any` at each use, matching `deletePrompt` below.
    // `promptData` is read through an indexed `Record` for the same reason.
    const { patch: patchArgument } = args as { patch?: TemplatePatchOperation[] };
    const suppliedArgs = args as Record<string, unknown>;
    const promptFields = promptData as Record<string, unknown>;
    const patchOperations = patchArgument ?? [];
    const patchedFields: PatchTargetField[] = [];
    if (patchOperations.length > 0) {
      const suppliedBodyParameters = PATCH_TARGET_FIELDS.filter(
        (parameter) => suppliedArgs[parameter] !== undefined
      );
      const conflict = findPatchParameterConflict(suppliedBodyParameters, patchOperations);
      if (conflict !== undefined) {
        return this.blockedUpdate(`❌ **Prompt update blocked**: ${conflict}`);
      }

      const patchResult = applyTemplatePatches(
        {
          user_message_template: promptFields['userMessageTemplate'] as string | undefined,
          system_message: promptFields['systemMessage'] as string | undefined,
          description: promptFields['description'] as string | undefined,
        },
        patchOperations
      );

      if (!patchResult.ok) {
        return this.blockedUpdate(
          `❌ **Prompt update blocked** — patch not applied (${patchResult.rejection.reason}):\n\n${patchResult.rejection.message}\n\n💡 Nothing was written and no version was consumed. Use \`action:"inspect"\` to read the current text, or \`dry_run: true\` to test an anchor.`
        );
      }

      for (const [field, value] of Object.entries(patchResult.values)) {
        // `UPDATE_FIELDS` already owns the parameter-name → promptData-key mapping for all three
        // patch targets; a second map here would be the drift this file has fixed twice.
        const dataKey = UPDATE_FIELDS[field] as string;
        promptFields[dataKey] = value;
        patchedFields.push(field as PatchTargetField);
      }
    }

    // Chain step-level operations (add/remove/reorder)
    if (args.chain_step_operation && args.chain_step_operation !== 'replace') {
      const existingSteps = (currentPrompt?.chainSteps ?? []) as unknown[];
      promptData.chainSteps = applyChainStepOperation(existingSteps, {
        operation: args.chain_step_operation,
        index: args.chain_step_index,
        stepData: args.chain_step_data,
        order: args.chain_step_order,
      });
    }

    // Chain step reference validation (non-blocking warnings)
    let chainIntegrityWarnings: string[] = [];
    if (promptData.chainSteps && promptData.chainSteps.length > 0) {
      const allPromptIds = this.getConvertedPrompts().map((p) => p.id);
      chainIntegrityWarnings = validateChainStepReferences(
        promptData.chainSteps,
        allPromptIds
      ).warnings;
    }

    // Reference validation for template changes. A patch changes a template without any full-body
    // parameter arriving, so the patched fields have to arm this the same way — otherwise a patch
    // could introduce a `{{ref:missing}}` that a full update would have been refused for.
    const hasTemplateChange =
      typeof args.user_message_template === 'string' ||
      typeof args.system_message === 'string' ||
      patchedFields.some((field) => field !== 'description');
    if (hasTemplateChange) {
      const refValidator = new PromptReferenceValidator(this.getConvertedPrompts());
      const refValidation = refValidator.validate(
        args.id,
        promptData.userMessageTemplate as string,
        promptData.systemMessage as string | undefined
      );

      if (!refValidation.valid) {
        const errorDetails = refValidation.errors
          .map((e) => `• **${e.type}**: ${e.details}`)
          .join('\n');
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ **Prompt update blocked** due to reference errors:\n\n${errorDetails}\n\n💡 Ensure all referenced prompts exist before updating this prompt.`,
            },
          ],
          isError: true,
        };
      }
    }

    // Produced-state validation (P7 row 3.5). Runs BEFORE the version record, so a rejected update
    // consumes nothing — the write path's own `ResourceVerificationService` check
    // (file-operations.ts:183) only fires after a version has already been spent, and it cannot see
    // a template-syntax error at all because YAML schema validation does not compile Nunjucks.
    const diagnosis = diagnosePromptWrite(beforeContent, promptData);
    if (diagnosis.blocking.length > 0) {
      const details = diagnosis.blocking.map((defect) => `• ${defect.message}`).join('\n');
      return this.blockedUpdate(
        `❌ **Prompt update blocked** — the resulting prompt is invalid:\n\n${details}\n\n💡 Nothing was written and no version was consumed.`
      );
    }
    if (diagnosis.preExisting.length > 0) {
      this.context.dependencies.logger.warn(
        `Prompt ${promptData.id} has pre-existing template defects (not introduced by this edit): ${diagnosis.preExisting
          .map((defect) => defect.message)
          .join('; ')}`
      );
    }

    // `dry_run` returns the produced bodies and the diff and stops here — ahead of the version
    // record and the write, so neither happens. It is the operator's pre-check that an anchor
    // matched before a version is spent.
    if (suppliedArgs['dry_run'] === true) {
      return this.renderDryRun(beforeContent, promptData, patchedFields, diagnosis.preExisting);
    }

    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    if (
      beforeContent !== null &&
      this.context.versionHistoryService.isAutoVersionEnabled() &&
      !skipVersion
    ) {
      const diffForVersion = this.textDiffService.generatePromptDiff(beforeContent, promptData);
      const diffSummary = `+${diffForVersion.stats.additions}/-${diffForVersion.stats.deletions}`;

      // `recordEditResult` throws on persistence failure (P7-D2, OQ-P7-6). The update ABORTS here
      // rather than proceeding: `version_history` is durable and nothing regenerates its rows, so
      // writing the new content past a failed snapshot leaves an unrecoverable gap while reporting
      // success. Caught here rather than at the router boundary only to state the one fact the
      // operator needs — that nothing was written, because the write is still ahead of this point.
      // Go-forward numbering (OQ-P7-3): the recorded snapshot is the state this edit PRODUCES, so
      // the newest version equals what `inspect` shows; any unrecorded prior state gets a bridge
      // row first (era transition, out-of-band edit).
      try {
        const versionResult = await this.context.versionHistoryService.recordEditResult(
          'prompt',
          promptData.id,
          beforeContent as unknown as Record<string, unknown>,
          { ...promptData },
          {
            description: args.version_description ?? 'Update via resource_manager',
            diff_summary: diffSummary,
          }
        );

        versionSaved = versionResult.version;
        this.context.dependencies.logger.debug(
          `Saved version ${versionSaved} for prompt ${promptData.id}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.context.dependencies.logger.error(
          `Aborting update of prompt ${promptData.id}: ${message}`
        );
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `❌ **Prompt update aborted**: the version snapshot could not be saved.\n\n` +
                `${message}\n\n` +
                `💡 No changes were written to '${promptData.id}'. Retry, or pass ` +
                `\`skip_version: true\` to update without recording a version.`,
            },
          ],
          isError: true,
        };
      }
    }

    const result = await this.fileOperations.updatePromptImplementation(promptData);
    const afterAnalysis = await this.promptAnalyzer.analyzePromptIntelligence(promptData);
    const diffResult = this.textDiffService.generatePromptDiff(beforeContent, promptData);

    let response = `✅ **Prompt Updated**: ${promptData.name} (${args.id})\n\n`;
    response += `${result.message}\n\n`;

    if (patchedFields.length > 0) {
      response += `🩹 **Patched**: ${patchedFields.map((field) => `\`${field}\``).join(', ')} (${patchOperations.length} operation(s))\n\n`;
    }

    if (versionSaved !== undefined) {
      response += `📜 **Version ${versionSaved}** saved (use \`action:"history"\` to view)\n\n`;
    }

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n\n`;
    }

    response += `${afterAnalysis.feedback}\n`;

    if (beforeAnalysis) {
      const comparison = this.comparisonEngine.compareAnalyses(
        beforeAnalysis,
        afterAnalysis.classification,
        args.id
      );
      const displaySummary = this.comparisonEngine.generateDisplaySummary(comparison);
      if (displaySummary) {
        response += `\n${displaySummary}\n`;
      }
    }

    if (afterAnalysis.suggestions.length > 0) {
      response += `\n💡 **Improvement Suggestions**:\n`;
      afterAnalysis.suggestions.forEach((suggestion, i) => {
        response += `${i + 1}. ${suggestion}\n`;
      });
    }

    if (chainIntegrityWarnings.length > 0) {
      response += `\n⚠️ **Chain Integrity Warnings**:\n`;
      for (const warning of chainIntegrityWarnings) {
        response += `- ${warning}\n`;
      }
    }

    response += this.buildCategoryShipWarning(result.categoryShipStatus);

    await this.handleSystemRefresh(args.full_restart, `Prompt updated: ${args.id}`);

    return {
      content: [{ type: 'text' as const, text: response }],
      isError: false,
    };
  }

  async deletePrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    // Narrowed once, immediately after the required-field check, rather than reaching into `any`
    // at each use. The parameter type is pre-existing; this at least keeps the destructive path
    // reading typed values, and stops every new reference adding another unsafe access.
    const { id, confirm } = args as { id: string; confirm?: boolean };

    const promptToDelete = this.getPromptsData().find((prompt) => prompt.id === id);
    if (!promptToDelete) {
      throw new PromptError(`Prompt not found: ${id}`);
    }

    const dependencies = this.findPromptDependencies(id);

    // BREAKING (major): `confirm` is now enforced on delete, as its schema text has always claimed.
    //
    // It was read on `rollback` and ignored here — the gate was on the RECOVERABLE verb and absent
    // from the unrecoverable one. Delete has no undo through the tool surface: the prompt's
    // `version_history` rows survive (nothing calls `deleteHistory` on this path), but
    // `handleRollback` returns "Prompt not found" when the prompt is gone, so those snapshots are
    // unreachable by any action.
    //
    // The dependency list is computed BEFORE the gate so the refusal can name what would break.
    // Reporting the blast radius and then proceeding anyway — the previous behaviour — told the
    // caller exactly why to stop, after stopping was no longer possible.
    if (confirm !== true) {
      const blastRadius =
        dependencies.length > 0
          ? `\n\n⚠️ ${dependencies.length} prompt(s) reference it and would break:\n` +
            dependencies.map((dep) => `- ${dep.name} (${dep.id})`).join('\n')
          : '';
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `⚠️ Deletion requires confirmation.\n\n` +
              `To delete prompt '${id}', set confirm: true.\n` +
              `This cannot be undone — rollback cannot restore a deleted prompt.${blastRadius}`,
          },
        ],
        isError: true,
      };
    }

    let response = `🗑️ **Deleting Prompt**: ${promptToDelete.name} (${id})\n\n`;

    if (dependencies.length > 0) {
      response += `⚠️ **Warning**: This prompt is referenced by ${dependencies.length} other prompts:\n`;
      dependencies.forEach((dep) => {
        response += `- ${dep.name} (${dep.id})\n`;
      });
      response += `\nDeleting will break these chain references.\n\n`;
    }

    const result = await this.fileOperations.deletePromptImplementation(args.id);
    response += `${result.message}\n\n`;
    response += `✅ **Prompt successfully removed from system**\n`;

    await this.handleSystemRefresh(args.full_restart, `Prompt deleted: ${args.id}`);

    return {
      content: [{ type: 'text' as const, text: response }],
      isError: false,
    };
  }

  /**
   * P7-D4: `create`/`update` write successfully regardless of whether the target category ships
   * in the published repo — `server/resources/prompts/.gitignore` allowlists categories, and the
   * write path never consulted it, so success read identically either way. OQ-P7-4 ruled warn,
   * not refuse — 103/131 prompts live in untracked categories, so refusing would break the
   * operator-local workflow. This never fires for a workspace overlay with no `.gitignore` of its
   * own: `FileOperations` reports `ships: true` when no allowlist file exists to restrict it.
   */
  private buildCategoryShipWarning(status: CategoryShipStatus | undefined): string {
    if (status === undefined || status.ships) {
      return '';
    }
    return (
      `\n⚠️ **Category not tracked in repo**: '${status.category}' is excluded by ` +
      '`server/resources/prompts/.gitignore` and will not ship with the repo — it stays local ' +
      'to this workspace.\n' +
      'To ship it, add these lines to `server/resources/prompts/.gitignore`:\n' +
      `    !${status.category}/\n` +
      `    !${status.category}/**\n`
    );
  }

  /** One shape for every pre-write refusal on the update path: error response, nothing written. */
  private blockedUpdate(text: string): ToolResponse {
    return {
      content: [{ type: 'text' as const, text }],
      isError: true,
    };
  }

  /**
   * Render what an update WOULD produce. Reached only from the `dry_run` branch, which sits ahead
   * of both the version record and the file write, so this method is the whole effect of the call.
   */
  private renderDryRun(
    beforeContent: ConvertedPrompt | null,
    promptData: Record<string, unknown>,
    patchedFields: readonly PatchTargetField[],
    preExisting: readonly PromptWriteDefect[]
  ): ToolResponse {
    const diff = this.textDiffService.generatePromptDiff(beforeContent, promptData);

    let text = `🔍 **Dry run** — nothing written, no version recorded for \`${String(promptData['id'])}\`\n\n`;
    if (patchedFields.length > 0) {
      text += `🩹 Patched field(s): ${patchedFields.map((field) => `\`${field}\``).join(', ')}\n\n`;
    }
    text += diff.hasChanges
      ? `${diff.formatted}\n\n`
      : `No changes: the result is identical to the current prompt.\n\n`;

    for (const field of PATCH_TARGET_FIELDS) {
      const dataKey = UPDATE_FIELDS[field] as string;
      const value = promptData[dataKey];
      if (typeof value !== 'string' || value.length === 0) continue;
      text += `**Resulting \`${field}\`**:\n\n\`\`\`\n${value}\n\`\`\`\n\n`;
    }

    if (preExisting.length > 0) {
      text += `⚠️ **Pre-existing issues** (present before this edit, not blocking):\n`;
      text += preExisting.map((defect) => `- ${defect.message}`).join('\n');
      text += `\n\n`;
    }

    text += `💡 Re-send the same call without \`dry_run\` to apply it.`;

    return {
      content: [{ type: 'text' as const, text }],
      isError: false,
    };
  }

  private async handleSystemRefresh(fullRestart: boolean = false, reason: string): Promise<void> {
    if (fullRestart) {
      setTimeout(() => this.context.dependencies.onRestart(reason), 1000);
    } else {
      await this.context.dependencies.onRefresh();
    }
  }

  private findPromptDependencies(promptId: string): ConvertedPrompt[] {
    return this.getConvertedPrompts().filter((prompt) => {
      if (!prompt.chainSteps || prompt.chainSteps.length === 0) return false;
      return prompt.chainSteps.some((step: any) => step.promptId === promptId);
    });
  }

  private getConvertedPrompts(): ConvertedPrompt[] {
    return this.context.getData().convertedPrompts;
  }

  private getPromptsData(): PromptData[] {
    return this.context.getData().promptsData;
  }
}
