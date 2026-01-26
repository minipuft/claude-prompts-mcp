// @lifecycle canonical - Prompt create/update/delete operations.

import * as path from 'node:path';

import { PromptReferenceValidator } from '../../../../execution/reference/index.js';
import { ToolResponse, ConvertedPrompt, PromptData } from '../../../../types/index.js';
import { PromptError } from '../../../../utils/index.js';
import { ComparisonEngine } from '../analysis/comparison-engine.js';
import { PromptAnalyzer } from '../analysis/prompt-analyzer.js';
import { TextDiffService } from '../analysis/text-diff-service.js';
import { PromptResourceContext } from '../core/context.js';
import { FileOperations } from '../operations/file-operations.js';
import { validateRequiredFields, validateToolDefinitions } from '../utils/validation.js';

export class PromptLifecycleService {
  private readonly context: PromptResourceContext;
  private readonly promptAnalyzer: PromptAnalyzer;
  private readonly comparisonEngine: ComparisonEngine;
  private readonly textDiffService: TextDiffService;
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
      gateConfiguration: args['gate_configuration'] || args.gates,
    };

    const result = await this.fileOperations.updatePromptImplementation(promptData);
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

    const promptData: any = {
      id: args.id,
      name: args.name || currentPrompt?.name || args.id,
      category: args.category || currentPrompt?.category || 'general',
      description: args.description || currentPrompt?.description || '',
      systemMessage: args.system_message || currentPrompt?.systemMessage,
      userMessageTemplate: args.user_message_template || currentPrompt?.userMessageTemplate || '',
      arguments: args.arguments || currentPrompt?.arguments || [],
      chainSteps: args.chain_steps || currentPrompt?.chainSteps || [],
      tools: args.tools,
      gateConfiguration:
        args['gate_configuration'] || args.gates || currentPrompt?.gateConfiguration,
    };

    const typedArgsForRef = args as {
      id: string;
      user_message_template?: string;
      system_message?: string;
    };
    const hasTemplateChange =
      typeof typedArgsForRef.user_message_template === 'string' ||
      typeof typedArgsForRef.system_message === 'string';
    if (hasTemplateChange) {
      const typedPromptData = promptData as {
        userMessageTemplate: string;
        systemMessage?: string;
      };
      const refValidator = new PromptReferenceValidator(this.getConvertedPrompts());
      const refValidation = refValidator.validate(
        typedArgsForRef.id,
        typedPromptData.userMessageTemplate,
        typedPromptData.systemMessage
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
      const promptsDir = this.context.dependencies.configManager.getPromptsDirectory();
      const effectiveCategory = (promptData.category ?? 'general')
        .toLowerCase()
        .replace(/\s+/g, '-');
      const promptDir = path.join(promptsDir, effectiveCategory, promptData.id);

      const diffForVersion = this.textDiffService.generatePromptDiff(beforeContent, promptData);
      const diffSummary = `+${diffForVersion.stats.additions}/-${diffForVersion.stats.deletions}`;

      const versionResult = await this.context.versionHistoryService.saveVersion(
        promptDir,
        'prompt',
        promptData.id,
        beforeContent as Record<string, unknown>,
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
