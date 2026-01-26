// @lifecycle canonical - Prompt version history operations.

import * as path from 'node:path';

import { ToolResponse } from '../../../../types/index.js';
import { TextDiffService } from '../analysis/text-diff-service.js';
import { PromptResourceContext } from '../core/context.js';
import { FileOperations } from '../operations/file-operations.js';
import { validateRequiredFields } from '../utils/validation.js';

export class PromptVersioningService {
  private readonly context: PromptResourceContext;
  private readonly fileOperations: FileOperations;
  private readonly textDiffService: TextDiffService;

  constructor(context: PromptResourceContext) {
    this.context = context;
    this.fileOperations = context.fileOperations;
    this.textDiffService = context.textDiffService;
  }

  async handleHistory(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);
    const { id, limit } = args;

    const prompt = this.getConvertedPrompts().find((p) => p.id === id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${id}` }],
        isError: true,
      };
    }

    const promptsDir = this.context.dependencies.configManager.getPromptsDirectory();
    const effectiveCategory = (prompt.category ?? 'general').toLowerCase().replace(/\s+/g, '-');
    const promptDir = path.join(promptsDir, effectiveCategory, id);

    const history = await this.context.versionHistoryService.loadHistory(promptDir);

    if (!history || history.versions.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `📜 No version history for prompt '${id}'\n\n` +
              `💡 Version history is created automatically when updates are made.`,
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

  async handleRollback(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id', 'version']);
    const { id, version, confirm } = args;

    if (!confirm) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `⚠️ Rollback requires confirmation.\n\n` +
              `To rollback prompt '${id}' to version ${version}, set confirm: true`,
          },
        ],
        isError: true,
      };
    }

    const currentPrompt = this.getConvertedPrompts().find((p) => p.id === id);
    if (!currentPrompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${id}` }],
        isError: true,
      };
    }

    const promptsDir = this.context.dependencies.configManager.getPromptsDirectory();
    const effectiveCategory = (currentPrompt.category ?? 'general')
      .toLowerCase()
      .replace(/\s+/g, '-');
    const promptDir = path.join(promptsDir, effectiveCategory, id);

    const result = await this.context.versionHistoryService.rollback(
      promptDir,
      'prompt',
      id,
      version,
      currentPrompt as unknown as Record<string, unknown>
    );

    if (!result.success) {
      return {
        content: [{ type: 'text' as const, text: `❌ Rollback failed: ${result.error}` }],
        isError: true,
      };
    }

    const snapshot = result.snapshot;
    if (!snapshot) {
      return {
        content: [
          {
            type: 'text' as const,
            text: '❌ Rollback failed: No snapshot found in target version',
          },
        ],
        isError: true,
      };
    }

    const promptData = {
      id,
      name: snapshot['name'] ?? currentPrompt.name,
      category: snapshot['category'] ?? currentPrompt.category,
      description: snapshot['description'] ?? currentPrompt.description,
      systemMessage: snapshot['systemMessage'] ?? currentPrompt.systemMessage,
      userMessageTemplate: snapshot['userMessageTemplate'] ?? currentPrompt.userMessageTemplate,
      arguments: snapshot['arguments'] ?? currentPrompt.arguments,
      chainSteps: snapshot['chainSteps'] ?? currentPrompt.chainSteps,
      gateConfiguration: snapshot['gateConfiguration'] ?? currentPrompt.gateConfiguration,
    };

    await this.fileOperations.updatePromptImplementation(promptData);
    await this.context.dependencies.onRefresh();

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `✅ Prompt '${id}' rolled back to version ${version}\n\n` +
            `📜 Current state saved as version ${result.saved_version}\n` +
            `🔄 Prompts reloaded`,
        },
      ],
      isError: false,
    };
  }

  async handleCompare(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id', 'from_version', 'to_version']);
    const { id, from_version, to_version } = args;

    const prompt = this.getConvertedPrompts().find((p) => p.id === id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${id}` }],
        isError: true,
      };
    }

    const promptsDir = this.context.dependencies.configManager.getPromptsDirectory();
    const effectiveCategory = (prompt.category ?? 'general').toLowerCase().replace(/\s+/g, '-');
    const promptDir = path.join(promptsDir, effectiveCategory, id);

    const result = await this.context.versionHistoryService.compareVersions(
      promptDir,
      from_version,
      to_version
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
