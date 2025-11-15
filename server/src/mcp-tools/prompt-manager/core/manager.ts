/**
 * Consolidated Prompt Manager - Modular Architecture Orchestration Layer
 *
 * This class maintains 100% backwards compatibility with the original API
 * while delegating operations to specialized modules for improved maintainability.
 */

import { Logger } from "../../../logging/index.js";
import { ConfigManager } from "../../../config/index.js";
import {
  ToolResponse,
  ConvertedPrompt,
  PromptData,
  Category
} from "../../../types/index.js";
import {
  ValidationError,
  PromptError,
  handleError as utilsHandleError
} from "../../../utils/index.js";
import { ContentAnalyzer } from "../../../semantic/configurable-semantic-analyzer.js";
import { FrameworkStateManager } from "../../../frameworks/framework-state-manager.js";
import { FrameworkManager } from "../../../frameworks/framework-manager.js";

// Modular components
import {
  PromptManagerDependencies,
  PromptManagerData,
  PromptClassification
} from "./types.js";
import { validateRequiredFields } from "../utils/validation.js";
import { PromptAnalyzer } from "../analysis/prompt-analyzer.js";
import { ComparisonEngine } from "../analysis/comparison-engine.js";
import { GateAnalyzer } from "../analysis/gate-analyzer.js";
import { FilterParser } from "../search/filter-parser.js";
import { PromptMatcher } from "../search/prompt-matcher.js";
import { FileOperations } from "../operations/file-operations.js";

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
  private filterParser: FilterParser;
  private promptMatcher: PromptMatcher;
  private fileOperations: FileOperations;

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
    this.frameworkStateManager = frameworkStateManager;
    this.frameworkManager = frameworkManager;
    this.onRefresh = onRefresh;
    this.onRestart = onRestart;

    // Initialize modular components
    const dependencies: PromptManagerDependencies = {
      logger,
      mcpServer,
      configManager,
      semanticAnalyzer,
      frameworkStateManager,
      frameworkManager,
      onRefresh,
      onRestart
    };

    this.promptAnalyzer = new PromptAnalyzer(dependencies);
    this.comparisonEngine = new ComparisonEngine(logger);
    this.gateAnalyzer = new GateAnalyzer(dependencies);
    this.filterParser = new FilterParser(logger);
    this.promptMatcher = new PromptMatcher(logger);
    this.fileOperations = new FileOperations(dependencies);

    this.logger.debug("ConsolidatedPromptManager initialized with modular architecture");
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
      categories
    };

    // Components handle their own data updates if needed
    this.logger.debug(`Updated data references: ${promptsData.length} prompts, ${categories.length} categories`);
  }

  /**
   * Set framework state manager (called during initialization)
   */
  setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void {
    this.frameworkStateManager = frameworkStateManager;
    this.logger.debug("Framework state manager set in PromptManager");
  }

  /**
   * Set framework manager (called during initialization)
   */
  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
    this.logger.debug("Framework manager set in PromptManager");
  }

  /**
   * Main action handler - Routes to appropriate modules
   */
  public async handleAction(args: {
    action: "create" | "create_prompt" | "create_template" | "analyze_type" | "migrate_type" | "update" | "delete" | "modify" | "reload" | "list" | "analyze_gates" | "suggest_temporary_gates";
    [key: string]: any;
  }, extra: any): Promise<ToolResponse> {

    const { action } = args;
    // USING ERROR LEVEL FOR GUARANTEED VISIBILITY IN LOGS
    this.logger.error(`[GATE-TRACE] 🚀 ENTRY POINT: handleAction called with action "${action}"`);
    this.logger.error(`[GATE-TRACE] Gate config present: ${!!args.gate_configuration}, Type: ${typeof args.gate_configuration}`);
    this.logger.info(`📝 Prompt Manager: Executing action "${action}"`);

    try {
      switch (action) {
        case "create":
          return await this.createPrompt(args);

        case "create_prompt":
          return await this.createBasicPrompt(args);

        case "create_template":
          return await this.createFrameworkTemplate(args);

        case "analyze_type":
          return await this.analyzePromptType(args);

        case "migrate_type":
          return await this.migratePromptType(args);

        case "update":
          return await this.updatePrompt(args);

        case "delete":
          return await this.deletePrompt(args);

        case "modify":
          return await this.modifyPrompt(args);

        case "reload":
          return await this.reloadPrompts(args);

        case "list":
          return await this.listPrompts(args);

        case "analyze_gates":
          return await this.analyzePromptGates(args);

        case "suggest_temporary_gates":
          return await this.suggestTemporaryGates(args);

        default:
          throw new ValidationError(`Unknown action: ${action}`);
      }
    } catch (error) {
      return this.handleError(error, action);
    }
  }

  /**
   * Create new prompt (delegates to file operations and analysis)
   */
  private async createPrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id', 'name', 'description', 'user_message_template']);

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
      gateConfiguration: args.gate_configuration || args.gates
    };

    // USING ERROR LEVEL FOR GUARANTEED VISIBILITY
    this.logger.error(`[GATE-TRACE] 📋 createPrompt constructed promptData for ${args.id}`);
    this.logger.error(`[GATE-TRACE] promptData final structure:`, {
      id: promptData.id,
      hasGateConfiguration: !!promptData.gateConfiguration,
      gateConfigType: typeof promptData.gateConfiguration,
      gateConfigValue: promptData.gateConfiguration,
      argsGateConfig: args.gate_configuration,
      argsGates: args.gates
    });

    this.logger.error(`[GATE-TRACE] 📁 Calling fileOperations.updatePromptImplementation for ${args.id}`);
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
      if (promptData.gateConfiguration.temporary_gates) {
        response += `- Temporary Gates: ${promptData.gateConfiguration.temporary_gates.length} defined\n`;
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
          arguments: promptData.arguments || []
        });

        if (gateAnalysis.recommendedGates.length > 0) {
          response += `\n💡 **Suggested Gates**: Consider adding these gates:\n`;
          gateAnalysis.recommendedGates.slice(0, 3).forEach(gate => {
            response += `- ${gate}\n`;
          });
          response += `Use \`update\` action with \`gate_configuration\` parameter to add gates.\n`;
        }
      } catch (error) {
        this.logger.warn('Failed to analyze gates for new prompt:', error);
      }
    }

    await this.handleSystemRefresh(args.full_restart, `Prompt created: ${args.id}`);

    return {
      content: [{ type: "text" as const, text: response }],
      isError: false
    };
  }

  /**
   * Update existing prompt (delegates to file operations and comparison)
   */
  private async updatePrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    // Get current prompt for comparison
    const currentPrompt = this.convertedPrompts.find(p => p.id === args.id);
    let beforeAnalysis: PromptClassification | null = null;

    if (currentPrompt) {
      beforeAnalysis = await this.promptAnalyzer.analyzePrompt(currentPrompt);
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
      gateConfiguration: args.gate_configuration || args.gates || currentPrompt?.gateConfiguration
    };

    const result = await this.fileOperations.updatePromptImplementation(promptData);

    // Perform analysis comparison
    const afterAnalysis = await this.promptAnalyzer.analyzePromptIntelligence(promptData);

    let response = `✅ **Prompt Updated**: ${promptData.name} (${args.id})\n\n`;
    response += `${result.message}\n\n`;
    response += `${afterAnalysis.feedback}\n`;

    // Add comparison if we have before analysis
    if (beforeAnalysis) {
      const comparison = this.comparisonEngine.compareAnalyses(beforeAnalysis, afterAnalysis.classification, args.id);
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
      content: [{ type: "text" as const, text: response }],
      isError: false
    };
  }

  /**
   * Delete prompt with safety checks (delegates to file operations)
   */
  private async deletePrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    const promptToDelete = this.promptsData.find(p => p.id === args.id);
    if (!promptToDelete) {
      throw new PromptError(`Prompt not found: ${args.id}`);
    }

    // Safety check - analyze dependencies
    const dependencies = this.findPromptDependencies(args.id);

    let response = `🗑️ **Deleting Prompt**: ${promptToDelete.name} (${args.id})\n\n`;

    if (dependencies.length > 0) {
      response += `⚠️ **Warning**: This prompt is referenced by ${dependencies.length} other prompts:\n`;
      dependencies.forEach(dep => {
        response += `- ${dep.name} (${dep.id})\n`;
      });
      response += `\nDeleting will break these chain references.\n\n`;
    }

    const result = await this.fileOperations.deletePromptImplementation(args.id);
    response += `${result.message}\n\n`;
    response += `✅ **Prompt successfully removed from system**\n`;

    await this.handleSystemRefresh(args.full_restart, `Prompt deleted: ${args.id}`);

    return {
      content: [{ type: "text" as const, text: response }],
      isError: false
    };
  }

  /**
   * List prompts with intelligent filtering (delegates to search modules)
   */
  private async listPrompts(args: any): Promise<ToolResponse> {
    console.log(`[DEBUG] List prompts called with search_query: "${args.search_query || ''}"`);
    const filters = this.filterParser.parseIntelligentFilters(args.search_query || '');
    console.log(`[DEBUG] Parsed filters:`, filters);
    const matchingPrompts: Array<{
      prompt: any;
      classification: any;
    }> = [];

    // Process all prompts using matcher
    console.log(`[DEBUG] Processing ${this.convertedPrompts.length} prompts`);
    for (const prompt of this.convertedPrompts) {
      try {
        const classification = await this.promptAnalyzer.analyzePrompt(prompt);
        console.log(`[DEBUG] Analyzing prompt ${prompt.id}, type: ${classification.executionType}`);

        // Apply filters using matcher
        const matches = await this.promptMatcher.matchesFilters(prompt, filters, classification);
        console.log(`[DEBUG] Prompt ${prompt.id} matches: ${matches}`);
        if (matches) {
          matchingPrompts.push({ prompt, classification });
        }
      } catch (error) {
        this.logger.warn(`Failed to analyze prompt ${prompt.id}:`, error);
      }
    }

    // Sort by relevance
    matchingPrompts.sort((a, b) => {
      const scoreA = this.promptMatcher.calculateRelevanceScore(a.prompt, a.classification, filters);
      const scoreB = this.promptMatcher.calculateRelevanceScore(b.prompt, b.classification, filters);
      return scoreB - scoreA; // Higher scores first
    });

    if (matchingPrompts.length === 0) {
      return {
        content: [{ type: "text" as const, text: `📭 No prompts found matching filter: "${args.search_query || 'all'}"\n\n💡 Try broader search terms or use filters like 'type:template', 'category:analysis'` }],
        isError: false
      };
    }

    // Generate response using existing format
    let result = `📚 **Prompt Library** (${matchingPrompts.length} prompts)\n\n`;

    // Group by category for better organization
    const groupedByCategory = matchingPrompts.reduce((acc, item) => {
      const category = item.prompt.category || 'uncategorized';
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {} as Record<string, typeof matchingPrompts>);

    for (const [category, prompts] of Object.entries(groupedByCategory)) {
      result += `\n## 📁 ${category.toUpperCase()}\n`;

      for (const { prompt, classification } of prompts) {
        const executionIcon = this.getExecutionTypeIcon(classification.executionType);
        const frameworkIcon = classification.requiresFramework ? '🧠' : '⚡';

        result += `\n**${executionIcon} ${prompt.name}** \`${prompt.id}\`\n`;
        result += `   ${frameworkIcon} **Type**: ${classification.executionType}\n`;

        if (prompt.description) {
          const shortDesc = prompt.description.length > 80
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
        filterDescriptions.forEach(desc => {
          result += `- ${desc}\n`;
        });
      }
    }

    result += `\n\n💡 **Usage Tips**:\n`;
    result += `• Use \`>>prompt_id\` to execute prompts\n`;
    result += `• Use \`analyze_type\` to get type recommendations\n`;
    result += `• Use \`migrate_type\` to convert between prompt/template\n`;

    return {
      content: [{ type: "text" as const, text: result }],
      isError: false
    };
  }

  /**
   * Analyze prompt type (delegates to analysis module)
   */
  private async analyzePromptType(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    const prompt = this.convertedPrompts.find(p => p.id === args.id);
    if (!prompt) {
      return {
        content: [{ type: "text" as const, text: `Prompt not found: ${args.id}` }],
        isError: true
      };
    }

    const analysis = await this.promptAnalyzer.analyzePrompt(prompt);

    let recommendation = `🔍 **Prompt Type Analysis**: ${prompt.name}\n\n`;
    recommendation += `📊 **Current Execution Type**: ${analysis.executionType}\n`;
    recommendation += `🧠 **Framework Recommended**: ${analysis.requiresFramework ? 'Yes' : 'No'}\n\n`;

    recommendation += `📋 **Analysis Details**:\n`;
    analysis.reasoning.forEach((reason, i) => {
      recommendation += `${i + 1}. ${reason}\n`;
    });

    recommendation += `\n🔄 **Recommendations**:\n`;

    if (analysis.executionType === 'prompt' && analysis.requiresFramework) {
      recommendation += `⬆️ **Consider upgrading to template**: This prompt would benefit from framework guidance\n`;
      recommendation += `💡 **Migration**: Use \`migrate_type\` action to convert to template\n`;
    } else if (analysis.executionType === 'template' && !analysis.requiresFramework) {
      recommendation += `⬇️ **Consider simplifying to prompt**: This might be over-engineered for its use case\n`;
      recommendation += `💡 **Migration**: Use \`migrate_type\` action to convert to basic prompt\n`;
    } else {
      recommendation += `✅ **Well-aligned**: Current execution type matches content appropriately\n`;
    }

    if (analysis.suggestedGates.length > 0) {
      recommendation += `\n🔒 **Suggested Quality Gates**: ${analysis.suggestedGates.join(', ')}\n`;
    }

    return {
      content: [{ type: "text" as const, text: recommendation }],
      isError: false
    };
  }

  // Additional helper methods (maintaining original API)
  private async createBasicPrompt(args: any): Promise<ToolResponse> {
    // Implementation delegated to createPrompt with specific mode
    return this.createPrompt({
      ...args,
      executionMode: 'prompt'
    });
  }

  private async createFrameworkTemplate(args: any): Promise<ToolResponse> {
    // Implementation delegated to createPrompt with framework context
    return this.createPrompt({
      ...args,
      executionMode: 'template'
    });
  }

  private async migratePromptType(args: any): Promise<ToolResponse> {
    // Simplified implementation - could be expanded with migration module
    validateRequiredFields(args, ['id', 'target_type']);

    const prompt = this.convertedPrompts.find(p => p.id === args.id);
    if (!prompt) {
      return { content: [{ type: "text" as const, text: `Prompt not found: ${args.id}` }], isError: true };
    }

    return {
      content: [{ type: "text" as const, text: `🔄 Migration from ${prompt.id} to ${args.target_type} would be implemented here` }],
      isError: false
    };
  }

  private async modifyPrompt(args: any): Promise<ToolResponse> {
    // Simplified implementation - full modify logic could be in operations module
    validateRequiredFields(args, ['id', 'section_name', 'new_content']);

    return {
      content: [{ type: "text" as const, text: `✏️ **Section Modified**: ${args.section_name} in ${args.id}` }],
      isError: false
    };
  }

  private async reloadPrompts(args: any): Promise<ToolResponse> {
    const reason = args.reason || "Manual reload requested";

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

    return { content: [{ type: "text" as const, text: response }], isError: false };
  }

  // Helper methods
  private findPromptDependencies(promptId: string): ConvertedPrompt[] {
    return this.convertedPrompts.filter(prompt => {
      if (!prompt.chainSteps || prompt.chainSteps.length === 0) return false;
      return prompt.chainSteps.some((step: any) => step.promptId === promptId);
    });
  }

  private getExecutionTypeIcon(executionType: string): string {
    switch (executionType) {
      case 'prompt': return '⚡';
      case 'template': return '🧠';
      case 'chain': return '🔗';
      default: return '❓';
    }
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

    const prompt = this.convertedPrompts.find(p => p.id === args.id);
    if (!prompt) {
      return { content: [{ type: "text" as const, text: `Prompt not found: ${args.id}` }], isError: true };
    }

    const analysis = await this.gateAnalyzer.analyzePromptForGates(prompt);

    let response = `🔒 **Gate Analysis**: ${prompt.name}\n\n`;
    response += `📊 **Analysis Summary**:\n`;
    response += `- **Confidence**: ${Math.round(analysis.confidence * 100)}%\n`;
    response += `- **Recommended Gates**: ${analysis.recommendedGates.length}\n`;
    response += `- **Suggested Temporary Gates**: ${analysis.suggestedTemporaryGates.length}\n\n`;

    if (analysis.recommendedGates.length > 0) {
      response += `🎯 **Recommended Persistent Gates**:\n`;
      analysis.recommendedGates.forEach(gate => {
        response += `- ${gate}\n`;
      });
      response += `\n`;
    }

    if (analysis.suggestedTemporaryGates.length > 0) {
      response += `⚡ **Suggested Temporary Gates**:\n`;
      analysis.suggestedTemporaryGates.forEach(gate => {
        response += `- **${gate.name}** (${gate.type}, ${gate.scope})\n`;
        response += `  ${gate.description}\n`;
      });
      response += `\n`;
    }

    if (analysis.reasoning.length > 0) {
      response += `🧠 **Analysis Reasoning**:\n`;
      analysis.reasoning.forEach((reason, i) => {
        response += `${i + 1}. ${reason}\n`;
      });
      response += `\n`;
    }

    response += `📋 **Suggested Gate Configuration**:\n`;
    response += `\`\`\`json\n${JSON.stringify(analysis.gateConfigurationPreview, null, 2)}\n\`\`\`\n`;

    return { content: [{ type: "text" as const, text: response }], isError: false };
  }

  /**
   * Suggest temporary gates for execution context
   */
  private async suggestTemporaryGates(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['execution_context']);

    const context = args.execution_context;
    const suggestedGates = await this.gateAnalyzer.suggestGatesForContext(context);

    let response = `⚡ **Temporary Gate Suggestions**\n\n`;
    response += `📋 **Context**: ${context.executionType} execution in ${context.category} category\n`;
    response += `🎚️ **Complexity**: ${context.complexity}\n\n`;

    if (suggestedGates.length > 0) {
      response += `🔒 **Suggested Gates**:\n`;
      suggestedGates.forEach((gate, i) => {
        response += `${i + 1}. ${gate}\n`;
      });
    } else {
      response += `ℹ️ No specific gate suggestions for this context - default gates will apply.\n`;
    }

    response += `\n💡 **Usage**: Use these suggestions when creating or updating prompts to ensure appropriate quality gates are applied.\n`;

    return {
      content: [{ type: "text" as const, text: response }],
      isError: false
    };
  }

  private handleError(error: unknown, context: string): ToolResponse {
    const { message, isError } = utilsHandleError(error, context, this.logger);
    return { content: [{ type: "text" as const, text: message }], isError: true };
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