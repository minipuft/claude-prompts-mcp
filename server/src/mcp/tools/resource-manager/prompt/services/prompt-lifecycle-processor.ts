// @lifecycle canonical - Prompt create/update/delete operations.

import { ComparisonEngine } from '../analysis/comparison-engine.js';
import { ObjectDiffGenerator } from '../analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../analysis/prompt-analyzer.js';
import { PromptResourceContext } from '../core/context.js';
import { FileOperations } from '../operations/file-operations.js';
import {
  UPDATE_FIELDS,
  applyChainStepOperation,
  normalizePromptId,
  validateChainStepReferences,
  validatePromptId,
  validateRequiredFields,
  validateToolDefinitions,
} from '../utils/validation.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { PromptData } from '#modules/prompts/types.js';

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

    // Chain step reference validation (non-blocking warnings)
    let chainIntegrityWarnings: string[] = [];
    if (promptData.chainSteps.length > 0) {
      const allPromptIds = this.getConvertedPrompts().map((p) => p.id);
      chainIntegrityWarnings = validateChainStepReferences(
        promptData.chainSteps,
        allPromptIds
      ).warnings;
    }

    await this.fileOperations.updatePromptImplementation(promptData);
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
    } else if (this.context.dependencies.semanticAnalyzer.isLLMEnabled()) {
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
    const beforeContent = currentPrompt !== undefined ? { ...currentPrompt } : null;

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

    // Build base from existing prompt, then override only explicitly provided fields
    const promptData: any = {
      id: args.id,
      name: currentPrompt?.name ?? args.id,
      category: currentPrompt?.category ?? 'general',
      description: currentPrompt?.description ?? '',
      systemMessage: currentPrompt?.systemMessage,
      userMessageTemplate: currentPrompt?.userMessageTemplate ?? '',
      arguments: currentPrompt?.arguments ?? [],
      chainSteps: currentPrompt?.chainSteps ?? [],
      tools: args.tools,
      gateConfiguration: currentPrompt?.gateConfiguration,
    };

    for (const [argKey, dataKey] of Object.entries(UPDATE_FIELDS)) {
      if (args[argKey] !== undefined) {
        promptData[dataKey] = args[argKey];
      }
    }
    // gate_configuration has alias handling (special case)
    if (args.gate_configuration !== undefined || args.gates !== undefined) {
      promptData.gateConfiguration = args.gate_configuration ?? args.gates;
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

    // Reference validation for template changes
    const hasTemplateChange =
      typeof args.user_message_template === 'string' || typeof args.system_message === 'string';
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

    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    if (
      beforeContent !== null &&
      this.context.versionHistoryService.isAutoVersionEnabled() &&
      !skipVersion
    ) {
      const diffForVersion = this.textDiffService.generatePromptDiff(beforeContent, promptData);
      const diffSummary = `+${diffForVersion.stats.additions}/-${diffForVersion.stats.deletions}`;

      const versionResult = await this.context.versionHistoryService.saveVersion(
        'prompt',
        promptData.id,
        beforeContent,
        {
          description: args.version_description ?? 'Update via resource_manager',
          diff_summary: diffSummary,
        }
      );

      if (versionResult.success) {
        versionSaved = versionResult.version;
        this.context.dependencies.logger.debug(
          `Saved version ${versionSaved} for prompt ${promptData.id}`
        );
      } else {
        this.context.dependencies.logger.warn(
          `Failed to save version for prompt ${promptData.id}: ${versionResult.error}`
        );
      }
    }

    const result = await this.fileOperations.updatePromptImplementation(promptData);
    const afterAnalysis = await this.promptAnalyzer.analyzePromptIntelligence(promptData);
    const diffResult = this.textDiffService.generatePromptDiff(beforeContent, promptData);

    let response = `✅ **Prompt Updated**: ${promptData.name} (${args.id})\n\n`;
    response += `${result.message}\n\n`;

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

    await this.handleSystemRefresh(args.full_restart, `Prompt updated: ${args.id}`);

    return {
      content: [{ type: 'text' as const, text: response }],
      isError: false,
    };
  }

  async deletePrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    const promptToDelete = this.getPromptsData().find((prompt) => prompt.id === args.id);
    if (!promptToDelete) {
      throw new PromptError(`Prompt not found: ${args.id}`);
    }

    const dependencies = this.findPromptDependencies(args.id);

    let response = `🗑️ **Deleting Prompt**: ${promptToDelete.name} (${args.id})\n\n`;

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
