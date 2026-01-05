// @lifecycle canonical - Main prompt manager implementation for MCP.
/**
 * Consolidated Prompt Manager - Modular Architecture Orchestration Layer
 *
 * This class maintains 100% backwards compatibility with the original API
 * while delegating operations to specialized modules for improved maintainability.
 */

import * as path from 'node:path';

import { PromptManagerDependencies, PromptManagerData, PromptClassification } from './types.js';
import { ConfigManager } from '../../../config/index.js';
import { PromptReferenceValidator } from '../../../execution/reference/index.js';
import { FrameworkManager } from '../../../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import { Logger } from '../../../logging/index.js';
import { ContentAnalyzer } from '../../../semantic/configurable-semantic-analyzer.js';
import { promptManagerMetadata } from '../../../tooling/action-metadata/definitions/prompt-manager.js';
import { recordActionInvocation } from '../../../tooling/action-metadata/usage-tracker.js';
import { ToolResponse, ConvertedPrompt, PromptData, Category } from '../../../types/index.js';
import {
  ValidationError,
  PromptError,
  handleError as utilsHandleError,
} from '../../../utils/index.js';
import { VersionHistoryService } from '../../../versioning/index.js';

// Modular components
import { ComparisonEngine } from '../analysis/comparison-engine.js';
import { GateAnalyzer } from '../analysis/gate-analyzer.js';
import { PromptAnalyzer } from '../analysis/prompt-analyzer.js';
import { TextDiffService } from '../analysis/text-diff-service.js';
import { FileOperations } from '../operations/file-operations.js';
import { FilterParser } from '../search/filter-parser.js';
import { PromptMatcher } from '../search/prompt-matcher.js';
import { validateRequiredFields, validateToolDefinitions } from '../utils/validation.js';

// Reference validation

import type { PromptManagerActionId } from '../../../tooling/action-metadata/definitions/prompt-manager.js';
import type { ActionDescriptor } from '../../../tooling/action-metadata/definitions/types.js';

const PROMPT_MANAGER_ACTIONS = promptManagerMetadata.data.actions;
const PROMPT_MANAGER_ACTION_MAP = new Map<PromptManagerActionId, ActionDescriptor>(
  PROMPT_MANAGER_ACTIONS.map((action) => [action.id as PromptManagerActionId, action])
);

const GOAL_KEYWORDS: Array<{ keywords: RegExp; actions: PromptManagerActionId[] }> = [
  {
    keywords: /gate|quality|review/i,
    actions: ['analyze_gates', 'update'],
  },
  { keywords: /create|add|new/i, actions: ['create'] },
  { keywords: /list|discover|catalog|show/i, actions: ['list'] },
  { keywords: /modify|edit|section/i, actions: ['update'] },
  { keywords: /delete|remove/i, actions: ['delete'] },
  { keywords: /reload|refresh/i, actions: ['reload'] },
];

// Legacy aliases fully retired; kept empty to avoid undefined references in summaries/warnings.
const LEGACY_ACTION_ALIASES: Record<string, string> = {};

/**
 * Consolidated Prompt Manager - Modular Architecture
 */
export class ConsolidatedPromptManager {
  private logger: Logger;
  private mcpServer: any;
  private configManager: ConfigManager;
  private semanticAnalyzer: ContentAnalyzer;
  private frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  private onRefresh: () => Promise<void>;
  private onRestart: (reason: string) => Promise<void>;

  // Modular components
  private promptAnalyzer: PromptAnalyzer;
  private comparisonEngine: ComparisonEngine;
  private gateAnalyzer: GateAnalyzer;
  private textDiffService: TextDiffService;
  private filterParser: FilterParser;
  private promptMatcher: PromptMatcher;
  private fileOperations: FileOperations;
  private versionHistoryService: VersionHistoryService;

  // Data references
  private promptsData: PromptData[] = [];
  private convertedPrompts: ConvertedPrompt[] = [];
  private categories: Category[] = [];

  constructor(
    logger: Logger,
    mcpServer: any,
    configManager: ConfigManager,
    semanticAnalyzer: ContentAnalyzer,
    frameworkStateManager: FrameworkStateManager | undefined,
    frameworkManager: FrameworkManager | undefined,
    onRefresh: () => Promise<void>,
    onRestart: (reason: string) => Promise<void>
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.configManager = configManager;
    this.semanticAnalyzer = semanticAnalyzer;
    if (frameworkStateManager) {
      this.frameworkStateManager = frameworkStateManager;
    }
    if (frameworkManager) {
      this.frameworkManager = frameworkManager;
    }
    this.onRefresh = onRefresh;
    this.onRestart = onRestart;

    // Initialize modular components
    const dependencies: PromptManagerDependencies = {
      logger,
      mcpServer,
      configManager,
      semanticAnalyzer,
      onRefresh,
      onRestart,
      ...(frameworkStateManager ? { frameworkStateManager } : {}),
      ...(frameworkManager ? { frameworkManager } : {}),
    };

    this.promptAnalyzer = new PromptAnalyzer(dependencies);
    this.comparisonEngine = new ComparisonEngine(logger);
    this.gateAnalyzer = new GateAnalyzer(dependencies);
    this.textDiffService = new TextDiffService();
    this.filterParser = new FilterParser(logger);
    this.promptMatcher = new PromptMatcher(logger);
    this.fileOperations = new FileOperations(dependencies);
    this.versionHistoryService = new VersionHistoryService({
      logger,
      configManager,
    });

    this.logger.debug('ConsolidatedPromptManager initialized with modular architecture');
  }

  /**
   * Update data references
   */
  updateData(
    promptsData: PromptData[],
    convertedPrompts: ConvertedPrompt[],
    categories: Category[]
  ): void {
    this.promptsData = promptsData;
    this.convertedPrompts = convertedPrompts;
    this.categories = categories;

    // Update modular components that need data references
    const data: PromptManagerData = {
      promptsData,
      convertedPrompts,
      categories,
    };

    // Components handle their own data updates if needed
    this.logger.debug(
      `Updated data references: ${promptsData.length} prompts, ${categories.length} categories`
    );
  }

  /**
   * Set framework state manager (called during initialization)
   */
  setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void {
    this.frameworkStateManager = frameworkStateManager;
    this.logger.debug('Framework state manager set in PromptManager');
  }

  /**
   * Set framework manager (called during initialization)
   */
  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
    this.logger.debug('Framework manager set in PromptManager');
  }

  /**
   * Main action handler - Routes to appropriate modules
   */
  public async handleAction(
    args: {
      action: PromptManagerActionId;
      [key: string]: any;
    },
    extra: any
  ): Promise<ToolResponse> {
    const { action } = args;
    // USING ERROR LEVEL FOR GUARANTEED VISIBILITY IN LOGS
    this.logger.error(`[GATE-TRACE] 🚀 ENTRY POINT: handleAction called with action "${action}"`);
    this.logger.error(
      `[GATE-TRACE] Gate config present: ${!!args['gate_configuration']}, Type: ${typeof args['gate_configuration']}`
    );
    this.logger.info(`📝 Prompt Manager: Executing action "${action}"`);

    recordActionInvocation('prompt_manager', action, 'received');

    try {
      let response: ToolResponse;

      switch (action) {
        case 'create':
          response = await this.createPrompt(args);
          break;

        case 'analyze_type':
          response = await this.analyzePromptType(args);
          break;

        case 'update':
          response = await this.updatePrompt(args);
          break;

        case 'delete':
          response = await this.deletePrompt(args);
          break;

        case 'reload':
          response = await this.reloadPrompts(args);
          break;

        case 'list':
          response = await this.listPrompts(args);
          break;

        case 'inspect':
          response = await this.inspectPrompt(args);
          break;

        case 'analyze_gates':
          response = await this.analyzePromptGates(args);
          break;

        case 'guide':
          response = await this.guidePromptActions(args);
          break;

        case 'history':
          response = await this.handleHistory(args);
          break;

        case 'rollback':
          response = await this.handleRollback(args);
          break;

        case 'compare':
          response = await this.handleCompare(args);
          break;

        default:
          recordActionInvocation('prompt_manager', action, 'unknown');
          throw new ValidationError(`Unknown action: ${action}`);
      }

      response = this.appendActionWarnings(response, action);
      recordActionInvocation('prompt_manager', action, 'success');
      return response;
    } catch (error) {
      recordActionInvocation('prompt_manager', action, 'failure', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.handleError(error, action);
    }
  }

  /**
   * Create new prompt (delegates to file operations and analysis)
   */
  private async createPrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id', 'name', 'description', 'user_message_template']);

    // Validate {{ref:...}} references before file creation (strict mode)
    const typedArgs = args as {
      id: string;
      user_message_template: string;
      system_message?: string;
    };
    const refValidator = new PromptReferenceValidator(this.convertedPrompts);
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

    // Validate tool definitions if provided
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

    // Create prompt data with enhanced gate configuration support
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

    // USING ERROR LEVEL FOR GUARANTEED VISIBILITY
    this.logger.error(`[GATE-TRACE] 📋 createPrompt constructed promptData for ${args.id}`);
    this.logger.error(`[GATE-TRACE] promptData final structure:`, {
      id: promptData.id,
      hasGateConfiguration: !!promptData.gateConfiguration,
      gateConfigType: typeof promptData.gateConfiguration,
      gateConfigValue: promptData.gateConfiguration,
      argsGateConfig: args.gate_configuration,
      argsGates: args.gates,
    });

    this.logger.error(
      `[GATE-TRACE] 📁 Calling fileOperations.updatePromptImplementation for ${args.id}`
    );
    const result = await this.fileOperations.updatePromptImplementation(promptData);

    // Perform intelligent analysis
    const analysis = await this.promptAnalyzer.analyzePromptIntelligence(promptData);

    let response = `✅ **Prompt Created**: ${args.name} (${args.id})\n`;
    response += `📝 ${args.description}\n`;
    response += `${analysis.feedback}`;

    if (analysis.suggestions.length > 0) {
      response += `💡 ${analysis.suggestions.join(' • ')}\n`;
    }

    // Enhanced: Gate configuration analysis and suggestions
    if (promptData.gateConfiguration) {
      response += `\n🔒 **Gate Configuration Applied**:\n`;
      if (promptData.gateConfiguration.include) {
        response += `- Include Gates: ${promptData.gateConfiguration.include.join(', ')}\n`;
      }
      if (promptData.gateConfiguration.inline_gate_definitions) {
        response += `- Inline Gate Definitions: ${promptData.gateConfiguration.inline_gate_definitions.length} defined\n`;
      }
    } else if (this.semanticAnalyzer.isLLMEnabled()) {
      // Suggest gate configuration for prompts without gates (only when API analysis is enabled)
      try {
        const gateAnalysis = await this.gateAnalyzer.analyzePromptForGates({
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
        this.logger.warn('Failed to analyze gates for new prompt:', error);
      }
    }

    // Report tools created
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

  /**
   * Update existing prompt (delegates to file operations and comparison)
   */
  private async updatePrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    // Get current prompt for comparison
    const currentPrompt = this.convertedPrompts.find((p) => p.id === args.id);
    let beforeAnalysis: PromptClassification | null = null;

    // Capture full content before update for diff generation
    const beforeContent = currentPrompt !== undefined ? { ...currentPrompt } : null;

    if (currentPrompt) {
      beforeAnalysis = await this.promptAnalyzer.analyzePrompt(currentPrompt);
    }

    // Validate tool definitions if provided
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

    // Update prompt data with enhanced gate configuration support
    const promptData: any = {
      id: args.id,
      name: args.name || currentPrompt?.name || args.id,
      category: args.category || currentPrompt?.category || 'general',
      description: args.description || currentPrompt?.description || '',
      systemMessage: args.system_message || currentPrompt?.systemMessage,
      userMessageTemplate: args.user_message_template || currentPrompt?.userMessageTemplate || '',
      arguments: args.arguments || currentPrompt?.arguments || [],
      chainSteps: args.chain_steps || currentPrompt?.chainSteps || [],
      tools: args.tools, // Only include if explicitly provided (undefined = no change)
      gateConfiguration:
        args['gate_configuration'] || args.gates || currentPrompt?.gateConfiguration,
    };

    // Validate {{ref:...}} references before file update (strict mode)
    // Only validate if template content is being changed
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
      const refValidator = new PromptReferenceValidator(this.convertedPrompts);
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

    // Save version before update (auto-versioning)
    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    if (
      beforeContent !== null &&
      this.versionHistoryService.isAutoVersionEnabled() &&
      !skipVersion
    ) {
      const promptsDir = this.configManager.getPromptsDirectory();
      const effectiveCategory = (promptData.category ?? 'general')
        .toLowerCase()
        .replace(/\s+/g, '-');
      const promptDir = path.join(promptsDir, effectiveCategory, promptData.id);

      const diffForVersion = this.textDiffService.generatePromptDiff(beforeContent, promptData);
      const diffSummary = `+${diffForVersion.stats.additions}/-${diffForVersion.stats.deletions}`;

      const versionResult = await this.versionHistoryService.saveVersion(
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
        this.logger.debug(`Saved version ${versionSaved} for prompt ${promptData.id}`);
      } else {
        this.logger.warn(
          `Failed to save version for prompt ${promptData.id}: ${versionResult.error}`
        );
      }
    }

    const result = await this.fileOperations.updatePromptImplementation(promptData);

    // Perform analysis comparison
    const afterAnalysis = await this.promptAnalyzer.analyzePromptIntelligence(promptData);

    // Generate unified diff between before and after states
    const diffResult = this.textDiffService.generatePromptDiff(beforeContent, promptData);

    let response = `✅ **Prompt Updated**: ${promptData.name} (${args.id})\n\n`;
    response += `${result.message}\n\n`;

    // Include version info if saved
    if (versionSaved !== undefined) {
      response += `📜 **Version ${versionSaved}** saved (use \`action:"history"\` to view)\n\n`;
    }

    // Include diff view if there are changes
    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n\n`;
    }

    response += `${afterAnalysis.feedback}\n`;

    // Add comparison if we have before analysis
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

  /**
   * Delete prompt with safety checks (delegates to file operations)
   */
  private async deletePrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    const promptToDelete = this.promptsData.find((p) => p.id === args.id);
    if (!promptToDelete) {
      throw new PromptError(`Prompt not found: ${args.id}`);
    }

    // Safety check - analyze dependencies
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

  /**
   * List prompts with intelligent filtering (delegates to search modules)
   */
  private async listPrompts(args: any): Promise<ToolResponse> {
    this.logger.debug(
      `[PromptManager] List prompts called with search_query: "${args.search_query || ''}"`
    );
    const filters = this.filterParser.parseIntelligentFilters(args.search_query || '');
    this.logger.debug('[PromptManager] Parsed filters', filters);
    const matchingPrompts: Array<{
      prompt: any;
      classification: any;
    }> = [];

    // Process all prompts using matcher
    this.logger.debug(`[PromptManager] Processing ${this.convertedPrompts.length} prompts`);
    for (const prompt of this.convertedPrompts) {
      try {
        const classification = await this.promptAnalyzer.analyzePrompt(prompt);
        this.logger.debug(
          `[PromptManager] Analyzing prompt ${prompt.id}, type: ${classification.executionType}`
        );

        // Apply filters using matcher
        const matches = await this.promptMatcher.matchesFilters(prompt, filters, classification);
        this.logger.debug(`[PromptManager] Prompt ${prompt.id} matches filters: ${matches}`);
        if (matches) {
          matchingPrompts.push({ prompt, classification });
        }
      } catch (error) {
        this.logger.warn(`Failed to analyze prompt ${prompt.id}:`, error);
      }
    }

    // Sort by relevance
    matchingPrompts.sort((a, b) => {
      const scoreA = this.promptMatcher.calculateRelevanceScore(
        a.prompt,
        a.classification,
        filters
      );
      const scoreB = this.promptMatcher.calculateRelevanceScore(
        b.prompt,
        b.classification,
        filters
      );
      return scoreB - scoreA; // Higher scores first
    });

    if (matchingPrompts.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `📭 No prompts found matching filter: "${args.search_query || 'all'}"\n\n💡 Try broader search terms or use filters like 'type:template', 'category:analysis'`,
          },
        ],
        isError: false,
      };
    }

    // Generate response using existing format
    let result = `📚 **Prompt Library** (${matchingPrompts.length} prompts)\n\n`;

    // Group by category for better organization
    const groupedByCategory = matchingPrompts.reduce(
      (acc, item) => {
        const category = item.prompt.category || 'uncategorized';
        if (!acc[category]) acc[category] = [];
        acc[category].push(item);
        return acc;
      },
      {} as Record<string, typeof matchingPrompts>
    );

    for (const [category, prompts] of Object.entries(groupedByCategory)) {
      result += `\n## 📁 ${category.toUpperCase()}\n`;

      for (const { prompt, classification } of prompts) {
        const executionIcon = this.getExecutionTypeIcon(classification.executionType);
        const frameworkIcon = classification.requiresFramework ? '🧠' : '⚡';

        result += `\n**${executionIcon} ${prompt.name}** \`${prompt.id}\`\n`;
        result += `   ${frameworkIcon} **Type**: ${classification.executionType}\n`;

        if (prompt.description) {
          const shortDesc =
            prompt.description.length > 80
              ? prompt.description.substring(0, 80) + '...'
              : prompt.description;
          result += `   📝 ${shortDesc}\n`;
        }

        if (prompt.arguments?.length > 0) {
          result += `   🔧 **Args**: ${prompt.arguments.map((arg: any) => arg.name).join(', ')}\n`;
        }
      }
    }

    // Add filter summary if filters were applied
    if (args.filter) {
      const filterDescriptions = this.filterParser.buildFilterDescription(filters);
      if (filterDescriptions.length > 0) {
        result += `\n\n🔍 **Applied Filters**:\n`;
        filterDescriptions.forEach((desc) => {
          result += `- ${desc}\n`;
        });
      }
    }

    result += `\n\n💡 **Usage Tips**:\n`;
    result += `• Use \`>>prompt_id\` to execute prompts\n`;
    result += `• Use \`analyze_type\` to get type recommendations\n`;

    return {
      content: [{ type: 'text' as const, text: result }],
      isError: false,
    };
  }

  /**
   * Analyze prompt type (delegates to analysis module)
   */
  private async analyzePromptType(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    const prompt = this.convertedPrompts.find((p) => p.id === args.id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${args.id}` }],
        isError: true,
      };
    }

    const analysis = await this.promptAnalyzer.analyzePrompt(prompt);

    let recommendation = `🔍 **Prompt Type Analysis**: ${prompt.name}\n\n`;
    recommendation += `📊 **Normalized Execution Type**: ${analysis.executionType}\n`;
    recommendation += `🧠 **Framework Recommended**: ${analysis.requiresFramework ? 'Yes' : 'No'}\n\n`;

    recommendation += `📋 **Analysis Details**:\n`;
    analysis.reasoning.forEach((reason, i) => {
      recommendation += `${i + 1}. ${reason}\n`;
    });

    recommendation += `\n🔄 **Recommendations**:\n`;

    recommendation += `✅ **Well-aligned**: Current execution type matches content appropriately\n`;

    if (analysis.suggestedGates.length > 0) {
      recommendation += `\n🔒 **Suggested Quality Gates**: ${analysis.suggestedGates.join(', ')}\n`;
    }

    return {
      content: [{ type: 'text' as const, text: recommendation }],
      isError: false,
    };
  }

  /**
   * Inspect a single prompt by id.
   */
  private async inspectPrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    const prompt = this.convertedPrompts.find((p) => p.id === args.id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${args.id}` }],
        isError: true,
      };
    }

    const classification = await this.promptAnalyzer.analyzePrompt(prompt);
    const gateConfig = prompt.gateConfiguration;

    let response = `🔍 **Prompt Inspect**: ${prompt.name} (\`${prompt.id}\`)\n\n`;
    response += `⚡ **Type**: ${classification.executionType}\n`;
    response += `🧠 **Requires Framework**: ${classification.requiresFramework ? 'Yes' : 'No'}\n`;
    if (prompt.description) {
      response += `📝 **Description**: ${prompt.description}\n`;
    }
    if (prompt.arguments?.length) {
      response += `🔧 **Arguments**: ${prompt.arguments.map((arg: any) => arg.name).join(', ')}\n`;
    }
    if (prompt.chainSteps?.length) {
      response += `🔗 **Chain Steps**: ${prompt.chainSteps.length}\n`;
    }
    if (gateConfig) {
      response += `🛡️ **Gates**: ${JSON.stringify(gateConfig)}\n`;
    }

    return {
      content: [{ type: 'text' as const, text: response }],
      isError: false,
    };
  }

  // Additional helper methods (maintaining original API)
  private async reloadPrompts(args: any): Promise<ToolResponse> {
    const reason = args.reason || 'Manual reload requested';

    let response = `🔄 **Reloading Prompts System**\n\n`;
    response += `**Reason**: ${reason}\n`;
    response += `**Mode**: ${args.full_restart ? 'Full Server Restart' : 'Hot Reload'}\n\n`;

    if (args.full_restart) {
      setTimeout(() => this.onRestart(reason), 1000);
      response += `⚡ **Server restart initiated**... Please wait for reconnection.\n`;
    } else {
      await this.onRefresh();
      response += `✅ **Hot reload completed** - All prompts refreshed from disk.\n`;
    }

    return { content: [{ type: 'text' as const, text: response }], isError: false };
  }

  // Helper methods
  private findPromptDependencies(promptId: string): ConvertedPrompt[] {
    return this.convertedPrompts.filter((prompt) => {
      if (!prompt.chainSteps || prompt.chainSteps.length === 0) return false;
      return prompt.chainSteps.some((step: any) => step.promptId === promptId);
    });
  }

  private getExecutionTypeIcon(executionType: string): string {
    if (executionType === 'chain') {
      return '🔗';
    }
    return '⚡';
  }

  private async handleSystemRefresh(fullRestart: boolean = false, reason: string): Promise<void> {
    if (fullRestart) {
      setTimeout(() => this.onRestart(reason), 1000);
    } else {
      await this.onRefresh();
    }
  }

  /**
   * Analyze prompt gates and provide recommendations
   */
  private async analyzePromptGates(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    const prompt = this.convertedPrompts.find((p) => p.id === args.id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${args.id}` }],
        isError: true,
      };
    }

    const analysis = await this.gateAnalyzer.analyzePromptForGates(prompt);

    const totalGatesCount =
      analysis.recommendedGates.length + analysis.suggestedTemporaryGates.length;

    let response = `Gate Analysis: ${prompt.name}\n\n`;

    // Consolidated gates section
    if (totalGatesCount > 0) {
      response += `Recommended Gates (${totalGatesCount} total):\n`;

      // List persistent gates
      analysis.recommendedGates.forEach((gate) => {
        response += `• ${gate}\n`;
      });

      // List temporary gates with scope indicators
      analysis.suggestedTemporaryGates.forEach((gate) => {
        response += `• ${gate.name} (temporary, ${gate.scope} scope)\n`;
      });

      response += `\n`;
    } else {
      response += `No specific gate recommendations for this prompt.\n\n`;
    }

    // Gate configuration JSON
    response += `Gate Configuration:\n`;
    response += `\`\`\`json\n${JSON.stringify(analysis.gateConfigurationPreview, null, 2)}\n\`\`\`\n`;

    return { content: [{ type: 'text' as const, text: response }], isError: false };
  }

  private async guidePromptActions(args: any): Promise<ToolResponse> {
    const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
    const includeLegacy = args.include_legacy === true;
    const rankedActions = this.rankActionsForGuide(goal, includeLegacy);
    const recommended = rankedActions.slice(0, Math.min(4, rankedActions.length));
    const quickReference = rankedActions.slice(0, Math.min(8, rankedActions.length));
    const highRisk = PROMPT_MANAGER_ACTIONS.filter(
      (action) => action.status !== 'working' && action.id !== 'guide'
    );

    const sections: string[] = [];
    sections.push('🧭 **Prompt Manager Guide**');
    sections.push(
      goal
        ? `🎯 **Goal**: ${goal}`
        : '🎯 **Goal**: Provide authoring/lifecycle assistance using canonical actions.'
    );

    if (recommended.length > 0) {
      sections.push('### Recommended Actions');
      recommended.forEach((action) => {
        sections.push(this.formatActionSummary(action));
      });
    }

    if (quickReference.length > 0) {
      sections.push('### Quick Reference');
      quickReference.forEach((action) => {
        const argsText = action.requiredArgs.length > 0 ? action.requiredArgs.join(', ') : 'None';
        sections.push(
          `- \`${action.id}\` (${this.describeActionStatus(action)}) — Required: ${argsText}`
        );
      });
    }

    if (highRisk.length > 0 && !includeLegacy) {
      sections.push('### Heads-Up (Advanced or Unstable Actions)');
      highRisk.slice(0, 3).forEach((action) => {
        const issueText =
          action.issues && action.issues.length > 0
            ? `Issues: ${action.issues.map((issue) => issue.summary).join(', ')}`
            : 'Advanced workflow.';
        sections.push(`- \`${action.id}\`: ${issueText}`);
      });
      sections.push('Set `include_legacy:true` to see full details on advanced actions.');
    }

    sections.push(
      '💡 Use `resource_manager(resource_type:"prompt", action:"<id>", ...)` with the required arguments above.'
    );

    return {
      content: [{ type: 'text' as const, text: sections.join('\n\n') }],
      isError: false,
    };
  }

  private rankActionsForGuide(goal: string, includeLegacy: boolean): ActionDescriptor[] {
    const normalizedGoal = goal.toLowerCase();
    const candidates = PROMPT_MANAGER_ACTIONS.filter(
      (action) =>
        action.id !== 'guide' &&
        (includeLegacy || action.status === 'working' || action.id === 'list')
    );

    const scored = candidates.map((action) => ({
      action,
      score: this.computeGuideScore(action, normalizedGoal),
    }));

    return scored.sort((a, b) => b.score - a.score).map((entry) => entry.action);
  }

  private computeGuideScore(action: ActionDescriptor, normalizedGoal: string): number {
    let score = action.status === 'working' ? 5 : 2;
    if (!normalizedGoal) {
      if (action.category === 'lifecycle') {
        score += 1;
      }
      if (action.id === 'list') {
        score += 1;
      }
      return score;
    }

    if (action.description.toLowerCase().includes(normalizedGoal)) {
      score += 3;
    }

    if (normalizedGoal.includes(action.id.replace(/_/g, ' '))) {
      score += 2;
    }

    for (const matcher of GOAL_KEYWORDS) {
      if (
        matcher.keywords.test(normalizedGoal) &&
        matcher.actions.includes(action.id as PromptManagerActionId)
      ) {
        score += 6;
      }
    }

    return score;
  }

  private formatActionSummary(action: ActionDescriptor): string {
    const argsText = action.requiredArgs.length > 0 ? action.requiredArgs.join(', ') : 'None';
    const status = this.describeActionStatus(action);
    let summary = `- \`${action.id}\` (${status}) — ${action.description}\n  Required: ${argsText}`;
    if (action.issues && action.issues.length > 0) {
      const issueList = action.issues
        .map((issue) => `${issue.severity === 'high' ? '❗' : '⚠️'} ${issue.summary}`)
        .join(' • ');
      summary += `\n  Issues: ${issueList}`;
    }
    if (LEGACY_ACTION_ALIASES[action.id]) {
      summary += `\n  ➡️ Prefer action="${LEGACY_ACTION_ALIASES[action.id]}" for canonical workflows.`;
    }
    return summary;
  }

  private describeActionStatus(action: ActionDescriptor): string {
    switch (action.status) {
      case 'working':
        return '✅ Working';
      case 'planned':
        return '🗺️ Planned';
      case 'untested':
        return '🧪 Untested';
      case 'deprecated':
        return '🛑 Deprecated';
      default:
        return `⚠️ ${action.status}`;
    }
  }

  private appendActionWarnings(
    response: ToolResponse,
    actionId: PromptManagerActionId
  ): ToolResponse {
    const descriptor = PROMPT_MANAGER_ACTION_MAP.get(actionId);
    if (!descriptor) {
      return response;
    }

    const warnings: string[] = [];
    if (descriptor.status !== 'working') {
      warnings.push(`Status: ${this.describeActionStatus(descriptor)}`);
    }

    if (descriptor.issues && descriptor.issues.length > 0) {
      descriptor.issues.forEach((issue) => {
        warnings.push(`${issue.severity === 'high' ? '❗' : '⚠️'} ${issue.summary}`);
      });
    }

    if (LEGACY_ACTION_ALIASES[actionId]) {
      warnings.push(`Prefer action="${LEGACY_ACTION_ALIASES[actionId]}" for canonical workflows.`);
    }

    if (warnings.length === 0) {
      return response;
    }

    const originalText = response.content?.[0]?.text ?? '';
    const note = `\n\n---\n⚠️ **Action Notes (${descriptor.displayName})**\n${warnings
      .map((warning) => `- ${warning}`)
      .join('\n')}`;

    return {
      ...response,
      content: [{ type: 'text' as const, text: `${originalText}${note}` }],
      isError: response.isError ?? false,
    };
  }

  private handleError(error: unknown, context: string): ToolResponse {
    const { message, isError } = utilsHandleError(error, context, this.logger);
    return { content: [{ type: 'text' as const, text: message }], isError: true };
  }

  // ============================================================================
  // Versioning Actions
  // ============================================================================

  private async handleHistory(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);
    const { id, limit } = args;

    const prompt = this.convertedPrompts.find((p) => p.id === id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${id}` }],
        isError: true,
      };
    }

    const promptsDir = this.configManager.getPromptsDirectory();
    const effectiveCategory = (prompt.category ?? 'general').toLowerCase().replace(/\s+/g, '-');
    const promptDir = path.join(promptsDir, effectiveCategory, id);

    const history = await this.versionHistoryService.loadHistory(promptDir);

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

    const formatted = this.versionHistoryService.formatHistoryForDisplay(history, limit ?? 10);
    return {
      content: [{ type: 'text' as const, text: formatted }],
      isError: false,
    };
  }

  private async handleRollback(args: any): Promise<ToolResponse> {
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

    const currentPrompt = this.convertedPrompts.find((p) => p.id === id);
    if (!currentPrompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${id}` }],
        isError: true,
      };
    }

    const promptsDir = this.configManager.getPromptsDirectory();
    const effectiveCategory = (currentPrompt.category ?? 'general')
      .toLowerCase()
      .replace(/\s+/g, '-');
    const promptDir = path.join(promptsDir, effectiveCategory, id);

    // Perform rollback
    const result = await this.versionHistoryService.rollback(
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

    // Restore the snapshot using file operations
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

    // Rebuild prompt data from snapshot
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

    // Write restored prompt
    await this.fileOperations.updatePromptImplementation(promptData);

    // Reload prompts
    await this.onRefresh();

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

  private async handleCompare(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id', 'from_version', 'to_version']);
    const { id, from_version, to_version } = args;

    const prompt = this.convertedPrompts.find((p) => p.id === id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${id}` }],
        isError: true,
      };
    }

    const promptsDir = this.configManager.getPromptsDirectory();
    const effectiveCategory = (prompt.category ?? 'general').toLowerCase().replace(/\s+/g, '-');
    const promptDir = path.join(promptsDir, effectiveCategory, id);

    const result = await this.versionHistoryService.compareVersions(
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

    // Generate diff between versions
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
}

/**
 * Create consolidated prompt manager - maintains original factory function API
 */
export function createConsolidatedPromptManager(
  logger: Logger,
  mcpServer: any,
  configManager: ConfigManager,
  semanticAnalyzer: ContentAnalyzer,
  frameworkStateManager: FrameworkStateManager | undefined,
  frameworkManager: FrameworkManager | undefined,
  onRefresh: () => Promise<void>,
  onRestart: (reason: string) => Promise<void>
): ConsolidatedPromptManager {
  return new ConsolidatedPromptManager(
    logger,
    mcpServer,
    configManager,
    semanticAnalyzer,
    frameworkStateManager,
    frameworkManager,
    onRefresh,
    onRestart
  );
}
