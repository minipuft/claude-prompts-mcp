// @lifecycle canonical - Builds and validates prompt creation drafts without writing them.

import { PRESERVED_PROMPT_YAML_KEYS } from '../operations/file-operations.js';
import {
  UPDATE_FIELDS,
  diagnosePromptWrite,
  normalizePromptId,
  validateChainStepReferences,
  validatePromptId,
  validateToolDefinitions,
} from '../utils/validation.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { PromptResourceInput } from '../../core/types.js';

import { PromptReferenceValidator } from '#engine/execution/reference/index.js';

interface PreparedPromptDraft {
  canonicalId: string;
  promptData: Record<string, unknown>;
  warnings: string[];
}

export type PromptDraftInput = Omit<PromptResourceInput, 'action'> & {
  action?: PromptResourceInput['action'];
};

export type PromptDraftResult =
  | { valid: true; draft: PreparedPromptDraft; errors: [] }
  | { valid: false; errors: string[]; warnings: string[] };

/** Pure draft preparation shared by `validate` and `create`. */
export class PromptDraftService {
  constructor(private readonly promptsProvider: () => ConvertedPrompt[]) {}

  prepare(args: PromptDraftInput): PromptDraftResult {
    const errors = this.validateActionShape(args);
    const rawId = typeof args.id === 'string' ? args.id : '';
    let canonicalId = rawId;

    if (rawId !== '') {
      try {
        validatePromptId(rawId);
        canonicalId = normalizePromptId(rawId);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const existing = this.promptsProvider().find(
      (prompt) => normalizePromptId(prompt.id) === canonicalId
    );
    if (canonicalId !== '' && existing !== undefined) {
      errors.push(
        `A prompt with ID '${existing.id}' already exists; '${rawId}' normalizes to '${canonicalId}'.`
      );
    }

    const referenceValidator = new PromptReferenceValidator(this.promptsProvider());
    const referenceResult = referenceValidator.validate(
      canonicalId,
      args.user_message_template ?? '',
      args.system_message
    );
    for (const referenceError of referenceResult.errors) {
      errors.push(`${referenceError.type}: ${referenceError.details}`);
    }

    const toolErrors = validateToolDefinitions(args.tools ?? []);
    errors.push(...toolErrors);

    if (errors.length > 0) {
      return { valid: false, errors, warnings: [] };
    }

    const promptData = this.buildPromptData(args, canonicalId);
    const diagnosis = diagnosePromptWrite(null, promptData);
    errors.push(...diagnosis.blocking.map((defect) => defect.message));

    const chainSteps = Array.isArray(promptData['chainSteps']) ? promptData['chainSteps'] : [];
    const warnings = validateChainStepReferences(
      chainSteps,
      this.promptsProvider().map((prompt) => prompt.id)
    ).warnings;

    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    return {
      valid: true,
      errors: [],
      draft: { canonicalId, promptData, warnings },
    };
  }

  private validateActionShape(args: PromptDraftInput): string[] {
    const errors: string[] = [];
    if (args.patch !== undefined) errors.push('patch is update-only');
    if (args.dry_run !== undefined) errors.push('dry_run is update-only; use action:"validate"');
    if (args.argument_updates !== undefined) errors.push('argument_updates is update-only');

    for (const field of ['id', 'name', 'description'] as const) {
      const value = args[field];
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`${field} is required`);
      }
    }

    const hasTemplate =
      typeof args.user_message_template === 'string' && args.user_message_template !== '';
    const hasSystem = typeof args.system_message === 'string' && args.system_message !== '';
    const hasChain = Array.isArray(args.chain_steps) && args.chain_steps.length > 0;
    if (!hasTemplate && !hasSystem && !hasChain) {
      errors.push('Prompt content requires user_message_template, chain_steps, or system_message');
    }
    return errors;
  }

  private buildPromptData(args: PromptDraftInput, canonicalId: string): Record<string, unknown> {
    const promptData: Record<string, unknown> = {
      id: canonicalId,
      name: args.name,
      category: args.category ?? 'general',
      description: args.description,
      systemMessage: args.system_message,
      userMessageTemplate: args.user_message_template,
      arguments: args.arguments ?? [],
      isChain: args.is_chain ?? (args.chain_steps?.length ?? 0) > 0,
      chainSteps: args.chain_steps ?? [],
      tools: args.tools ?? [],
      gateConfiguration: args.gate_configuration,
    };

    const preservedKeys = PRESERVED_PROMPT_YAML_KEYS as readonly string[];
    const supplied = args as Record<string, unknown>;
    for (const [parameter, dataKey] of Object.entries(UPDATE_FIELDS)) {
      if (preservedKeys.includes(dataKey) && supplied[parameter] !== undefined) {
        promptData[dataKey] = supplied[parameter];
      }
    }
    return promptData;
  }
}
