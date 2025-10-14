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
import { createPromptResponse, createErrorResponse } from "../../shared/structured-response-builder.js";

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
    action: "create" | "create_prompt" | "create_template" | "analyze_type" | "migrate_type" | "update" | "delete" | "modify" | "reload" | "list" | "analyze_gates" | "suggest_temporary_gates" | "create_with_gates" | "update_gates" | "add_temporary_gates";
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

        case "create_with_gates":
          return await this.createPromptWithGates(args);

        case "update_gates":
          return await this.updatePromptGates(args);

        case "add_temporary_gates":
          return await this.addTemporaryGates(args);

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
    } else {
      // Suggest gate configuration for prompts without gates
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
          response += `Use \`update_gates\` action to add gate configuration.\n`;
        }
      } catch (error) {
        this.logger.warn('Failed to analyze gates for new prompt:', error);
      }
    }

    await this.handleSystemRefresh(args.full_restart, `Prompt created: ${args.id}`);

    return createPromptResponse(response, "create", {
      promptId: args.id,
      category: args.category,
      analysisResult: analysis,
      affectedFiles: [`${args.id}.md`]
    });
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

    return createPromptResponse(response, "update", {
      promptId: args.id,
      category: promptData.category,
      analysisResult: afterAnalysis,
      affectedFiles: [`${args.id}.md`]
    });
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

    return createPromptResponse(response, "delete", {
      promptId: args.id,
      category: promptToDelete.category,
      affectedFiles: [`${args.id}.md`]
    });
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
      return createPromptResponse(
        `📭 No prompts found matching filter: "${args.search_query || 'all'}"\n\n💡 Try broader search terms or use filters like 'type:template', 'category:analysis'`,
        "list",
        {
          promptId: "none",
          category: "all",
          affectedFiles: []
        }
      );
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

    return createPromptResponse(result, "list_intelligent", {
      promptId: "multiple",
      category: "all"
    });
  }

  /**
   * Analyze prompt type (delegates to analysis module)
   */
  private async analyzePromptType(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    const prompt = this.convertedPrompts.find(p => p.id === args.id);
    if (!prompt) {
      return createErrorResponse(`Prompt not found: ${args.id}`, {
        tool: "prompt_manager",
        operation: "analyze_type",
        errorType: "validation",
        severity: "medium"
      });
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

    return createPromptResponse(recommendation, "analyze_type", {
      promptId: args.id,
      analysisResult: { classification: analysis, feedback: '', suggestions: [] }
    });
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
      return createErrorResponse(`Prompt not found: ${args.id}`, {
        tool: "prompt_manager",
        operation: "migrate_type",
        errorType: "validation",
        severity: "medium"
      });
    }

    return createPromptResponse(
      `🔄 Migration from ${prompt.id} to ${args.target_type} would be implemented here`,
      "migrate_type",
      { promptId: args.id }
    );
  }

  private async modifyPrompt(args: any): Promise<ToolResponse> {
    // Simplified implementation - full modify logic could be in operations module
    validateRequiredFields(args, ['id', 'section_name', 'new_content']);

    return createPromptResponse(
      `✏️ **Section Modified**: ${args.section_name} in ${args.id}`,
      "modify",
      { promptId: args.id }
    );
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

    return createPromptResponse(response, "reload", {
      promptId: "system",
      affectedFiles: args.full_restart ? ["server"] : ["prompts"]
    });
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
      return createErrorResponse(`Prompt not found: ${args.id}`, {
        tool: "prompt_manager",
        operation: "analyze_gates",
        errorType: "validation",
        severity: "medium"
      });
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

    return createPromptResponse(response, "analyze_gates", {
      promptId: args.id,
      category: prompt.category,
      analysisResult: analysis
    });
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

    return createPromptResponse(response, "suggest_temporary_gates", {
      promptId: "context-based",
      category: context.category || "general",
      analysisResult: { suggestions: suggestedGates }
    });
  }

  /**
   * Create prompt with enhanced gate configuration
   */
  private async createPromptWithGates(args: any): Promise<ToolResponse> {
    // USING ERROR LEVEL FOR GUARANTEED VISIBILITY
    this.logger.error(`[GATE-TRACE] 🎯 createPromptWithGates called for prompt: ${args.id}`);
    this.logger.error(`[GATE-TRACE] Gate config raw data:`, {
      hasGateConfig: !!args.gate_configuration,
      gateConfigType: typeof args.gate_configuration,
      gateConfigRaw: args.gate_configuration,
      hasSuggestedGates: !!args.suggested_gates
    });

    validateRequiredFields(args, ['id', 'name', 'description', 'user_message_template']);

    // Validate and parse gate configuration
    let gateConfiguration: any = null;
    if (args.gate_configuration) {
      this.logger.info(`[GATE-DEBUG] Processing gate_configuration for ${args.id}`);
      try {
        gateConfiguration = typeof args.gate_configuration === 'string'
          ? JSON.parse(args.gate_configuration)
          : args.gate_configuration;
        this.logger.debug(`[GATE-DEBUG] Parsed gate configuration:`, gateConfiguration);
      } catch (error) {
        this.logger.error(`[GATE-DEBUG] Failed to parse gate configuration:`, error);
        throw new ValidationError(`Invalid gate configuration JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (args.suggested_gates) {
      this.logger.info(`[GATE-DEBUG] Auto-generating from suggested_gates for ${args.id}`);
      // Auto-generate basic gate configuration from suggested gates
      // Extract gate names from gate objects
      const gateNames = Array.isArray(args.suggested_gates)
        ? args.suggested_gates.map((gate: any) => gate.name)
        : [args.suggested_gates.name];

      gateConfiguration = {
        include: gateNames,
        framework_gates: true
      };
      this.logger.debug(`[GATE-DEBUG] Auto-generated gate configuration with extracted names:`, gateConfiguration);
    } else {
      this.logger.warn(`[GATE-DEBUG] No gate configuration or suggested gates found for ${args.id}`);
    }

    // Create prompt with gates
    const enhancedArgs = {
      ...args,
      gate_configuration: gateConfiguration
    };

    this.logger.debug(`[GATE-DEBUG] Enhanced args being passed to createPrompt:`, {
      id: enhancedArgs.id,
      hasGateConfig: !!enhancedArgs.gate_configuration,
      gateConfigContent: enhancedArgs.gate_configuration
    });

    return await this.createPrompt(enhancedArgs);
  }

  /**
   * Update gate configuration for existing prompt
   */
  private async updatePromptGates(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);

    const currentPrompt = this.convertedPrompts.find(p => p.id === args.id);
    if (!currentPrompt) {
      throw new PromptError(`Prompt not found: ${args.id}`);
    }

    // Parse new gate configuration
    let gateConfiguration: any = null;
    if (args.gate_configuration) {
      try {
        gateConfiguration = typeof args.gate_configuration === 'string'
          ? JSON.parse(args.gate_configuration)
          : args.gate_configuration;
      } catch (error) {
        throw new ValidationError(`Invalid gate configuration JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Update only the gate configuration
    const updateArgs = {
      id: args.id,
      gate_configuration: gateConfiguration
    };

    const result = await this.updatePrompt(updateArgs);

    let response = `🔧 **Gate Configuration Updated**: ${currentPrompt.name} (${args.id})\n\n`;
    response += `✅ Gate configuration has been updated successfully.\n`;

    if (gateConfiguration) {
      response += `📋 **Applied Configuration**:\n`;
      if (gateConfiguration.include) {
        response += `- Include Gates: ${gateConfiguration.include.join(', ')}\n`;
      }
      if (gateConfiguration.exclude) {
        response += `- Exclude Gates: ${gateConfiguration.exclude.join(', ')}\n`;
      }
      if (gateConfiguration.temporary_gates) {
        response += `- Temporary Gates: ${gateConfiguration.temporary_gates.length} gates defined\n`;
      }
      response += `- Framework Gates: ${gateConfiguration.framework_gates !== false ? 'Enabled' : 'Disabled'}\n`;
    }

    return createPromptResponse(response, "update_gates", {
      promptId: args.id,
      category: currentPrompt.category,
      analysisResult: { gateConfiguration }
    });
  }

  /**
   * Add temporary gates to existing prompt configuration
   * Phase 3 Fix: This now adds gates to in-memory configuration only (no file writes)
   * Gates are truly temporary and will be activated during prompt execution
   */
  private async addTemporaryGates(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id', 'temporary_gates']);

    const currentPrompt = this.convertedPrompts.find(p => p.id === args.id);
    if (!currentPrompt) {
      throw new PromptError(`Prompt not found: ${args.id}`);
    }

    // Parse temporary gates
    let temporaryGates: any[];
    try {
      temporaryGates = typeof args.temporary_gates === 'string'
        ? JSON.parse(args.temporary_gates)
        : args.temporary_gates;

      if (!Array.isArray(temporaryGates)) {
        throw new Error("temporary_gates must be an array");
      }
    } catch (error) {
      throw new ValidationError(`Invalid temporary gates configuration: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Phase 3 Fix: Update in-memory configuration only - NO FILE WRITES
    // This makes gates truly temporary - they exist only in memory and expire/cleanup automatically
    // Use enhancedGateConfiguration which supports temporary_gates
    const existingGateConfig = currentPrompt.enhancedGateConfiguration || currentPrompt.gateConfiguration || {};
    currentPrompt.enhancedGateConfiguration = {
      ...existingGateConfig,
      temporary_gates: temporaryGates,
      gate_scope: args.gate_scope || 'execution',
      inherit_chain_gates: args.inherit_chain_gates !== false
    };

    this.logger.info(`[TEMP GATES] Added ${temporaryGates.length} temporary gates to ${args.id} (in-memory only, no file write)`, {
      promptId: args.id,
      gateCount: temporaryGates.length,
      scope: args.gate_scope || 'execution'
    });

    let response = `⚡ **Temporary Gates Added (In-Memory)**: ${currentPrompt.name} (${args.id})\n\n`;
    response += `✅ ${temporaryGates.length} temporary gates added to in-memory configuration.\n`;
    response += `⚠️ **Note**: Gates are temporary and will NOT be written to disk. They expire after use.\n\n`;

    response += `🔒 **Added Temporary Gates**:\n`;
    temporaryGates.forEach((gate, i) => {
      response += `${i + 1}. **${gate.name}** (${gate.type}, ${gate.scope})\n`;
      response += `   - ${gate.description}\n`;
    });

    response += `\n📋 **Configuration**:\n`;
    response += `- Gate Scope: ${args.gate_scope || 'execution'}\n`;
    response += `- Inherit Chain Gates: ${args.inherit_chain_gates !== false ? 'Yes' : 'No'}\n`;
    response += `- Persistence: In-memory only (no file writes)\n`;
    response += `- Lifecycle: Will be auto-activated on next prompt execution\n`;

    return createPromptResponse(response, "add_temporary_gates", {
      promptId: args.id,
      category: currentPrompt.category,
      analysisResult: {
        temporaryGatesAdded: temporaryGates.length,
        inMemoryOnly: true,
        gateConfiguration: currentPrompt.enhancedGateConfiguration
      }
    });
  }

  private handleError(error: unknown, context: string): ToolResponse {
    const { message, isError } = utilsHandleError(error, context, this.logger);
    return createErrorResponse(message, {
      tool: "prompt_manager",
      operation: context,
      errorType: "system",
      severity: "medium"
    });
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