/**
 * Consolidated Prompt Manager - Unified Lifecycle Management Tool
 *
 * Consolidates all prompt management functionality into a single intelligent tool:
 * - update_prompt (CRUD operations)
 * - delete_prompt (with safety checks)
 * - modify_prompt_section (precision editing)
 * - reload_prompts (system refresh)
 * - listprompts (with intelligent filtering)
 * - Intelligent analysis and feedback
 */

import { z } from "zod";
import * as fs from "fs/promises";
import { readFile } from "fs/promises";
import path from "path";
import { Logger } from "../logging/index.js";
import { ConfigManager } from "../config/index.js";
import {
  ToolResponse,
  ConvertedPrompt,
  PromptData,
  PromptsConfigFile,
  Category
} from "../types/index.js";
import {
  ValidationError,
  PromptError,
  handleError as utilsHandleError,
  safeJsonParse,
  validateJsonArguments
} from "../utils/index.js";
import { modifyPromptSection, safeWriteFile } from "../prompts/promptUtils.js";
import { ContentAnalyzer, ContentAnalysisResult } from "../semantic/configurable-semantic-analyzer.js";
import { FrameworkStateManager } from "../frameworks/framework-state-manager.js";
import { FrameworkManager } from "../frameworks/framework-manager.js";

/**
 * Prompt classification interface for management operations
 */
export interface PromptClassification {
  executionType: "prompt" | "template" | "chain";
  requiresExecution: boolean;
  requiresFramework: boolean;
  confidence: number;
  reasoning: string[];
  suggestedGates: string[];
  framework?: string;
  // Enhanced with configurable analysis information
  analysisMode?: string;
  capabilities?: {
    canDetectStructure: boolean;
    canAnalyzeComplexity: boolean;
    canRecommendFramework: boolean;
    hasSemanticUnderstanding: boolean;
  };
  limitations?: string[];
  warnings?: string[];
}

/**
 * Consolidated Prompt Manager Tool
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
   * Main action handler
   */
  public async handleAction(args: {
    action: "create" | "create_prompt" | "create_template" | "analyze_type" | "migrate_type" | "update" | "delete" | "modify" | "reload" | "list";
    [key: string]: any;
  }, extra: any): Promise<ToolResponse> {

    const { action } = args;
    this.logger.info(`📝 Prompt Manager: Executing action "${action}"`);

    switch (action) {
      case "create":
        return await this.createPrompt(args); // Auto-detect type

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

      default:
        throw new ValidationError(`Unknown action: ${action}`);
    }
  }

  /**
   * Create new prompt
   */
  private async createPrompt(args: any): Promise<ToolResponse> {
    this.validateRequiredFields(args, ['id', 'name', 'description', 'user_message_template']);

    // Create prompt data
    const promptData: any = {
      id: args.id,
      name: args.name,
      category: args.category || 'general',
      description: args.description,
      systemMessage: args.system_message,
      userMessageTemplate: args.user_message_template,
      arguments: args.arguments || [],
      isChain: args.is_chain || false,
      chainSteps: args.chain_steps || []
    };

    const result = await this.updatePromptImplementation(promptData);

    // Perform intelligent analysis
    const analysis = await this.analyzePromptIntelligence(promptData);

    let response = `✅ **Prompt Created**: ${args.name} (${args.id})\n`;
    response += `📝 ${args.description}\n`;
    response += `${analysis.feedback}`;

    if (analysis.suggestions.length > 0) {
      response += `💡 ${analysis.suggestions.join(' • ')}\n`;
    }

    await this.handleSystemRefresh(args.full_restart, `Prompt created: ${args.id}`);

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Update existing prompt
   */
  private async updatePrompt(args: any): Promise<ToolResponse> {
    this.validateRequiredFields(args, ['id']);

    // Get current prompt for comparison
    const currentPrompt = this.convertedPrompts.find(p => p.id === args.id);
    let beforeAnalysis: PromptClassification | null = null;

    if (currentPrompt) {
      beforeAnalysis = await this.analyzePrompt(currentPrompt);
    }

    // Update prompt data
    const promptData: any = {
      id: args.id,
      name: args.name || currentPrompt?.name || args.id,
      category: args.category || currentPrompt?.category || 'general',
      description: args.description || currentPrompt?.description || '',
      systemMessage: args.system_message || currentPrompt?.systemMessage,
      userMessageTemplate: args.user_message_template || currentPrompt?.userMessageTemplate || '',
      arguments: args.arguments || currentPrompt?.arguments || [],
      chainSteps: args.chain_steps || currentPrompt?.chainSteps || []
    };

    const result = await this.updatePromptImplementation(promptData);

    // Perform analysis comparison
    const afterAnalysis = await this.analyzePromptIntelligence(promptData);

    let response = `✅ **Prompt Updated**: ${promptData.name} (${args.id})\n\n`;
    response += `${result.message}\n\n`;
    response += `${afterAnalysis.feedback}\n`;

    // Add comparison if we have before analysis
    if (beforeAnalysis) {
      const comparison = this.compareAnalyses(beforeAnalysis, afterAnalysis.classification, args.id);
      if (comparison) {
        response += `\n${comparison}\n`;
      }
    }

    if (afterAnalysis.suggestions.length > 0) {
      response += `\n💡 **Improvement Suggestions**:\n`;
      afterAnalysis.suggestions.forEach((suggestion, i) => {
        response += `${i + 1}. ${suggestion}\n`;
      });
    }

    await this.handleSystemRefresh(args.full_restart, `Prompt updated: ${args.id}`);

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Delete prompt with safety checks
   */
  private async deletePrompt(args: any): Promise<ToolResponse> {
    this.validateRequiredFields(args, ['id']);

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

    const result = await this.deletePromptImplementation(args.id);
    response += `${result.message}\n\n`;
    response += `✅ **Prompt successfully removed from system**\n`;

    await this.handleSystemRefresh(args.full_restart, `Prompt deleted: ${args.id}`);

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Modify specific prompt section
   */
  private async modifyPrompt(args: any): Promise<ToolResponse> {
    this.validateRequiredFields(args, ['id', 'section_name', 'new_content']);

    // Get current prompt for before analysis
    const currentPrompt = this.convertedPrompts.find(p => p.id === args.id);
    let beforeAnalysis: PromptClassification | null = null;

    if (currentPrompt) {
      beforeAnalysis = await this.analyzePrompt(currentPrompt);
    }

    const PROMPTS_FILE = this.configManager.getPromptsFilePath();
    const result = await modifyPromptSection(
      args.id,
      args.section_name,
      args.new_content,
      PROMPTS_FILE
    );

    let response = `✏️ **Section Modified**: ${args.section_name} in ${args.id}\n\n`;
    response += `${result.message}\n\n`;

    // Generate after analysis comparison if possible
    if (beforeAnalysis && currentPrompt) {
      const updatedPrompt = { ...currentPrompt };
      if (args.section_name.toLowerCase() === "user message template") {
        updatedPrompt.userMessageTemplate = args.new_content;
      } else if (args.section_name.toLowerCase() === "system message") {
        updatedPrompt.systemMessage = args.new_content;
      }

      const afterAnalysis = await this.analyzePrompt(updatedPrompt);
      const comparison = this.compareAnalyses(beforeAnalysis, afterAnalysis, args.id);
      if (comparison) {
        response += `${comparison}\n`;
      }
    }

    await this.handleSystemRefresh(args.full_restart, `Section modified in ${args.id}: ${args.section_name}`);

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Reload prompts system
   */
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

    return { content: [{ type: "text", text: response }] };
  }


  /**
   * Implementation helpers
   */

  /**
   * Update prompt implementation (shared by create/update)
   */
  private async updatePromptImplementation(promptData: any): Promise<{ message: string }> {
    const PROMPTS_FILE = this.configManager.getPromptsFilePath();
    const messages: string[] = [];

    const fileContent = await readFile(PROMPTS_FILE, "utf8");
    const promptsConfig = JSON.parse(fileContent) as PromptsConfigFile;

    if (!promptsConfig.categories) promptsConfig.categories = [];
    if (!promptsConfig.imports) promptsConfig.imports = [];

    // Ensure category exists
    const { effectiveCategory, created: categoryCreated } =
      await this.ensureCategoryExists(promptData.category, promptsConfig, PROMPTS_FILE);

    if (categoryCreated) {
      messages.push(`✅ Created category: '${effectiveCategory}'`);
    }

    // Create/update prompt file
    const { exists: promptExists } = await this.createOrUpdatePromptFile(
      promptData,
      effectiveCategory,
      PROMPTS_FILE
    );

    messages.push(`✅ ${promptExists ? 'Updated' : 'Created'} prompt file and registry entry`);

    return { message: messages.join('\n') };
  }

  /**
   * Delete prompt implementation
   */
  private async deletePromptImplementation(id: string): Promise<{ message: string }> {
    const PROMPTS_FILE = this.configManager.getPromptsFilePath();
    const promptsConfigDir = path.dirname(PROMPTS_FILE);
    const messages: string[] = [];

    const fileContent = await readFile(PROMPTS_FILE, "utf8");
    const promptsConfig = JSON.parse(fileContent) as PromptsConfigFile;

    let promptFound = false;

    // Search through category imports
    for (const categoryImport of promptsConfig.imports || []) {
      const categoryPath = path.join(promptsConfigDir, categoryImport);

      try {
        const categoryContent = await readFile(categoryPath, "utf8");
        const categoryData = JSON.parse(categoryContent);

        const promptIndex = categoryData.prompts.findIndex((p: PromptData) => p.id === id);

        if (promptIndex > -1) {
          const promptEntry = categoryData.prompts[promptIndex];

          // Remove from category
          categoryData.prompts.splice(promptIndex, 1);
          await safeWriteFile(categoryPath, JSON.stringify(categoryData, null, 2), "utf8");

          // Delete markdown file
          const markdownPath = path.join(path.dirname(categoryPath), promptEntry.file);
          try {
            await fs.unlink(markdownPath);
            messages.push(`✅ Deleted prompt file: ${promptEntry.file}`);
          } catch (unlinkError: any) {
            if (unlinkError.code !== "ENOENT") {
              messages.push(`⚠️ Could not delete file: ${unlinkError.message}`);
            }
          }

          messages.push(`✅ Removed from category: ${categoryImport}`);
          promptFound = true;

          // Automatically clean up empty category
          if (categoryData.prompts.length === 0) {
            this.logger.info(`Category ${categoryImport} is now empty, performing automatic cleanup`);
            const cleanupResult = await this.cleanupEmptyCategory(categoryImport, promptsConfig, PROMPTS_FILE);
            messages.push(`🧹 **Automatic Category Cleanup**:\n${cleanupResult.message}`);
          }

          break;
        }
      } catch (error) {
        this.logger.warn(`Could not process category file: ${categoryPath}`, error);
      }
    }

    if (!promptFound) {
      throw new PromptError(`Prompt not found: ${id}`);
    }

    return { message: messages.join('\n') };
  }

  /**
   * Clean up empty category (remove from config and delete folder)
   */
  private async cleanupEmptyCategory(
    categoryImport: string,
    promptsConfig: PromptsConfigFile,
    promptsFile: string
  ): Promise<{ message: string }> {
    const promptsConfigDir = path.dirname(promptsFile);
    const categoryPath = path.join(promptsConfigDir, categoryImport);
    const categoryDir = path.dirname(categoryPath);
    const messages: string[] = [];

    try {
      // Extract category ID from import path (e.g., "examples/prompts.json" -> "examples")
      const categoryId = categoryImport.split('/')[0];

      // Remove from categories array
      const categoryIndex = promptsConfig.categories.findIndex(cat => cat.id === categoryId);
      if (categoryIndex > -1) {
        const removedCategory = promptsConfig.categories.splice(categoryIndex, 1)[0];
        messages.push(`✅ Removed category definition: ${removedCategory.name}`);
      }

      // Remove from imports array
      const importIndex = promptsConfig.imports.findIndex(imp => imp === categoryImport);
      if (importIndex > -1) {
        promptsConfig.imports.splice(importIndex, 1);
        messages.push(`✅ Removed import path: ${categoryImport}`);
      }

      // Save updated config
      await safeWriteFile(promptsFile, JSON.stringify(promptsConfig, null, 2), "utf8");
      messages.push(`✅ Updated promptsConfig.json`);

      // Delete empty category folder and its contents
      try {
        // Delete prompts.json file
        await fs.unlink(categoryPath);
        messages.push(`✅ Deleted category file: ${categoryImport}`);

        // Delete category directory if empty
        await fs.rmdir(categoryDir);
        messages.push(`✅ Deleted empty category folder: ${path.basename(categoryDir)}`);
      } catch (folderError: any) {
        if (folderError.code !== "ENOENT") {
          messages.push(`⚠️ Could not delete category folder: ${folderError.message}`);
        }
      }

    } catch (error: any) {
      this.logger.error(`Failed to cleanup category ${categoryImport}:`, error);
      messages.push(`❌ Category cleanup failed: ${error.message}`);
    }

    return { message: messages.join('\n') };
  }

  /**
   * Ensure category exists
   */
  private async ensureCategoryExists(
    category: string,
    promptsConfig: PromptsConfigFile,
    promptsFile: string
  ): Promise<{ effectiveCategory: string; created: boolean }> {
    const effectiveCategory = category.toLowerCase().replace(/\s+/g, "-");

    const exists = promptsConfig.categories.some(cat => cat.id === effectiveCategory);

    if (!exists) {
      // Create new category
      promptsConfig.categories.push({
        id: effectiveCategory,
        name: category,
        description: `Prompts related to ${category}`
      });

      // Create directory and files
      const categoryDir = path.join(path.dirname(promptsFile), effectiveCategory);
      await fs.mkdir(categoryDir, { recursive: true });

      const categoryPromptsPath = path.join(categoryDir, "prompts.json");
      await safeWriteFile(categoryPromptsPath, JSON.stringify({ prompts: [] }, null, 2), "utf8");

      // Add to imports
      const relativePath = path.join(effectiveCategory, "prompts.json").replace(/\\/g, "/");
      if (!promptsConfig.imports.includes(relativePath)) {
        promptsConfig.imports.push(relativePath);
      }

      // Save config
      await safeWriteFile(promptsFile, JSON.stringify(promptsConfig, null, 2), "utf8");

      return { effectiveCategory, created: true };
    }

    return { effectiveCategory, created: false };
  }

  /**
   * Create or update prompt file
   */
  private async createOrUpdatePromptFile(
    promptData: any,
    effectiveCategory: string,
    promptsFile: string
  ): Promise<{ exists: boolean }> {
    const promptFilename = `${promptData.id}.md`;
    const categoryDir = path.join(path.dirname(promptsFile), effectiveCategory);
    const promptPath = path.join(categoryDir, promptFilename);

    // Create markdown content
    let content = `# ${promptData.name}\n\n`;
    content += `## Description\n${promptData.description}\n\n`;

    if (promptData.systemMessage) {
      content += `## System Message\n${promptData.systemMessage}\n\n`;
    }

    content += `## User Message Template\n${promptData.userMessageTemplate}\n`;

    if ((promptData.chainSteps?.length ?? 0) > 0) {
      content += `\n## Chain Steps\n\n`;
      promptData.chainSteps.forEach((step: any, index: number) => {
        content += `${index + 1}. **${step.stepName}** (${step.promptId})\n`;
        if (step.inputMapping) {
          content += `   - Input Mapping: ${JSON.stringify(step.inputMapping)}\n`;
        }
        if (step.outputMapping) {
          content += `   - Output Mapping: ${JSON.stringify(step.outputMapping)}\n`;
        }
        content += `\n`;
      });
    }

    // Write markdown file
    const existsBefore = await fs.access(promptPath).then(() => true).catch(() => false);
    await safeWriteFile(promptPath, content, "utf8");

    // Update category prompts.json
    const categoryPromptsPath = path.join(categoryDir, "prompts.json");
    let categoryData: { prompts: PromptData[] };

    try {
      const categoryContent = await readFile(categoryPromptsPath, "utf8");
      categoryData = JSON.parse(categoryContent);
    } catch {
      categoryData = { prompts: [] };
    }

    const promptEntry: PromptData = {
      id: promptData.id,
      name: promptData.name,
      category: effectiveCategory,
      description: promptData.description,
      file: promptFilename,
      arguments: promptData.arguments || []
    };

    const existingIndex = categoryData.prompts.findIndex(p => p.id === promptData.id);
    if (existingIndex > -1) {
      categoryData.prompts[existingIndex] = promptEntry;
    } else {
      categoryData.prompts.push(promptEntry);
    }

    await safeWriteFile(categoryPromptsPath, JSON.stringify(categoryData, null, 2), "utf8");

    return { exists: existsBefore };
  }

  /**
   * Analyze prompt for intelligence feedback (compact format)
   */
  private async analyzePromptIntelligence(promptData: any): Promise<{
    classification: PromptClassification;
    feedback: string;
    suggestions: string[];
  }> {
    // Create temporary ConvertedPrompt for analysis
    const tempPrompt: ConvertedPrompt = {
      id: promptData.id,
      name: promptData.name,
      description: promptData.description,
      category: promptData.category,
      systemMessage: promptData.systemMessage,
      userMessageTemplate: promptData.userMessageTemplate,
      arguments: promptData.arguments || [],
      // isChain property removed - derived from chainSteps presence
      chainSteps: promptData.chainSteps || []
    };

    const classification = await this.analyzePrompt(tempPrompt);

    // Build analysis-aware feedback showing current capabilities
    const analysisIcon = this.getAnalysisIcon(classification.analysisMode || classification.framework);
    let feedback = `${analysisIcon} ${classification.executionType}`;
    
    // Add gates info if present
    if (classification.suggestedGates.length > 0) {
      feedback += ` • gates: ${classification.suggestedGates.slice(0, 2).join(', ')}`;
    }
    feedback += '\n';

    // Analysis status line (show what analysis is actually doing)
    if (classification.analysisMode === 'disabled' || classification.framework === 'disabled') {
      feedback += `⚠️ Semantic analysis disabled - using basic structure detection\n`;
    } else if (classification.analysisMode === 'structural') {
      feedback += `🔧 Structural analysis mode - no semantic understanding\n`;
    } else if (classification.analysisMode === 'fallback' || classification.framework === 'fallback') {
      feedback += `🚨 Analysis failed - using fallback detection\n`;
    }

    // Show key limitations if present
    const importantLimitations = classification.limitations?.filter(l => 
      l.includes('disabled') || l.includes('No semantic') || l.includes('Framework recommendation unavailable')) || [];
    
    if (importantLimitations.length > 0) {
      const shortLimitation = importantLimitations[0].length > 50 
        ? importantLimitations[0].substring(0, 47) + '...'
        : importantLimitations[0];
      feedback += `⚠️ ${shortLimitation}\n`;
    }

    // Generate capability-aware suggestions
    const suggestions: string[] = [];

    if (classification.analysisMode === 'disabled' || classification.framework === 'disabled') {
      suggestions.push("💡 Enable semantic analysis for enhanced capabilities");
      suggestions.push("🎯 Framework recommendation unavailable");
    } else if (classification.analysisMode === 'structural') {
      suggestions.push("💡 Configure LLM integration for intelligent analysis");
    } else if (classification.analysisMode === 'fallback' || classification.framework === 'fallback') {
      suggestions.push("🚨 Fix analysis configuration");
    }
    
    if (!classification.capabilities?.canRecommendFramework) {
      suggestions.push("🎯 Framework recommendation unavailable");
    }

    return { classification, feedback, suggestions };
  }

  /**
   * Get analysis icon based on analysis mode/framework
   */
  private getAnalysisIcon(mode: string | undefined): string {
    switch (mode) {
      case 'disabled': return '🔧'; // Basic structural detection
      case 'structural': return '🔬'; // Structural analysis
      case 'hybrid': return '🔍'; // Enhanced structural
      case 'semantic': return '🧠'; // Full semantic analysis
      case 'fallback': return '🚨'; // Error fallback
      case 'configurable': return '🧠'; // Configured semantic analysis
      default: return '🧠'; // Default intelligent analysis
    }
  }

  /**
   * Create fallback analysis when semantic analysis is disabled
   */
  private createDisabledAnalysisFallback(prompt: ConvertedPrompt): PromptClassification {
    const hasChainSteps = Boolean(prompt.chainSteps?.length);
    const hasComplexArgs = (prompt.arguments?.length || 0) > 2;
    const hasTemplateVars = /\{\{.*?\}\}/g.test(prompt.userMessageTemplate || '');
    
    // Basic execution type detection without semantic analysis
    let executionType: 'prompt' | 'template' | 'chain' = 'prompt';
    if (hasChainSteps) {
      executionType = 'chain';
    } else if (hasComplexArgs || hasTemplateVars) {
      executionType = 'template';
    }
    
    return {
      executionType,
      requiresExecution: true,
      requiresFramework: false, // Conservative - don't assume framework needed
      confidence: 0.7, // High confidence in basic structural facts
      reasoning: [
        "Semantic analysis unavailable - using basic structural detection",
        `Detected ${executionType} type from file structure`,
        "Framework recommendation unavailable"
      ],
      suggestedGates: ['basic_validation'],
      framework: 'disabled',
      // Analysis metadata
      analysisMode: 'disabled',
      capabilities: {
        canDetectStructure: true,
        canAnalyzeComplexity: false,
        canRecommendFramework: false,
        hasSemanticUnderstanding: false
      },
      limitations: [
        "Semantic analysis unavailable (no LLM integration)",
        "No intelligent framework recommendations available", 
        "Limited complexity analysis capabilities"
      ],
      warnings: [
        "⚠️ Semantic analysis unavailable",
        "💡 Configure LLM integration in config for semantic analysis",
        "🔧 Using basic structural detection only"
      ]
    };
  }

  /**
   * Analyze prompt using semantic analyzer (configuration-aware)
   */
  private async analyzePrompt(prompt: ConvertedPrompt): Promise<PromptClassification> {
    try {
      const analysis = await this.semanticAnalyzer.analyzePrompt(prompt);
      return {
        executionType: analysis.executionType,
        requiresExecution: analysis.requiresExecution,
        requiresFramework: analysis.requiresFramework,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        suggestedGates: analysis.suggestedGates,
        framework: 'configurable',
        // Enhanced configurable analysis information
        analysisMode: analysis.analysisMetadata.mode,
        capabilities: analysis.capabilities,
        limitations: analysis.limitations,
        warnings: analysis.warnings
      };
    } catch (error) {
      this.logger.error(`Configurable semantic analysis failed for ${prompt.id}:`, error);
      return {
        executionType: (prompt.chainSteps?.length ?? 0) > 0 ? 'chain' : 'template',
        requiresExecution: true,
        requiresFramework: true, // Default to requiring framework for fallback
        confidence: 0.5,
        reasoning: [`Fallback analysis: ${error}`],
        suggestedGates: ['execution_validation'],
        framework: 'fallback',
        analysisMode: 'fallback',
        capabilities: {
          canDetectStructure: false,
          canAnalyzeComplexity: false,
          canRecommendFramework: false,
          hasSemanticUnderstanding: false
        },
        limitations: ['Analysis failed - using minimal fallback'],
        warnings: ['⚠️ Analysis error occurred', '🚨 Using minimal fallback analysis']
      };
    }
  }

  /**
   * Compare two prompt analyses
   */
  private compareAnalyses(
    before: PromptClassification,
    after: PromptClassification,
    promptId: string
  ): string | null {
    const changes: string[] = [];

    if (before.executionType !== after.executionType) {
      changes.push(`🔄 **Type**: ${before.executionType} → ${after.executionType}`);
    }

    // Confidence comparisons removed - focusing on actionable changes

    const beforeGates = new Set(before.suggestedGates);
    const afterGates = new Set(after.suggestedGates);
    const addedGates = [...afterGates].filter(g => !beforeGates.has(g));
    const removedGates = [...beforeGates].filter(g => !afterGates.has(g));

    if (addedGates.length > 0) {
      changes.push(`✅ **Added Gates**: ${addedGates.join(', ')}`);
    }

    if (removedGates.length > 0) {
      changes.push(`❌ **Removed Gates**: ${removedGates.join(', ')}`);
    }

    if (changes.length > 0) {
      return `📊 **Analysis Comparison**:\n${changes.join('\n')}`;
    }

    return null;
  }

  /**
   * Find prompt dependencies (chains that reference this prompt)
   */
  private findPromptDependencies(promptId: string): ConvertedPrompt[] {
    return this.convertedPrompts.filter(prompt => {
      if (!prompt.chainSteps || prompt.chainSteps.length === 0) return false;
      return prompt.chainSteps.some((step: any) => step.promptId === promptId);
    });
  }

  /**
   * Parse intelligent filters for list operation
   */
  private parseIntelligentFilters(filterText: string): {
    text?: string;
    type?: string;
    category?: string;
    confidence?: { min?: number; max?: number };
    execution?: boolean;
    gates?: boolean;
    intent?: string;
  } {
    const filters: any = {};

    if (!filterText) return filters;

    // Parse various filter patterns
    const typeMatch = filterText.match(/type:(\w+)/);
    if (typeMatch) filters.type = typeMatch[1];

    const categoryMatch = filterText.match(/category:([a-z-_]+)/);
    if (categoryMatch) filters.category = categoryMatch[1];

    const intentMatch = filterText.match(/intent:([a-z-_\s]+)/i);
    if (intentMatch) filters.intent = intentMatch[1].trim();

    // Confidence filtering removed - focusing on actionable filters only

    if (filterText.includes('execution:required')) filters.execution = true;
    else if (filterText.includes('execution:optional')) filters.execution = false;

    if (filterText.includes('gates:yes')) filters.gates = true;
    else if (filterText.includes('gates:no')) filters.gates = false;

    // Remaining text as search term
    const cleanedText = filterText
      .replace(/type:\w+/g, '')
      .replace(/category:[a-z-_]+/g, '')
      .replace(/intent:[a-z-_\s]+/gi, '')
      .replace(/confidence:[<>]?\d+(?:-\d+)?/g, '')
      .replace(/execution:(required|optional)/g, '')
      .replace(/gates:(yes|no)/g, '')
      .trim();

    if (cleanedText) filters.text = cleanedText;

    return filters;
  }

  /**
   * Generate intelligent prompts list with filtering
   */
  private async generateIntelligentPromptsList(filters: any): Promise<ToolResponse> {
    let response = "# 📝 Available Prompts\n\n";

    // Group by category
    const promptsByCategory: Record<string, ConvertedPrompt[]> = {};

    this.categories.forEach(cat => {
      promptsByCategory[cat.id] = [];
    });

    // Filter and categorize prompts
    for (const prompt of this.convertedPrompts) {
      if (!promptsByCategory[prompt.category]) {
        promptsByCategory[prompt.category] = [];
      }

      if (await this.matchesFilters(prompt, filters)) {
        promptsByCategory[prompt.category].push(prompt);
      }
    }

    // Generate list
    for (const [categoryId, prompts] of Object.entries(promptsByCategory)) {
      if (prompts.length === 0) continue;

      const category = this.categories.find(c => c.id === categoryId);
      const categoryName = category?.name || categoryId;

      response += `## ${categoryName}\n\n`;

      for (const prompt of prompts) {
        const classification = await this.analyzePrompt(prompt);
        const typeIcon = classification.executionType === "chain" ? "🔗" : "📄";

        response += `### ${typeIcon} ${prompt.id}\n\n`;
        response += `**Description**: ${prompt.description}\n\n`;

        // Add usage guidance for LLMs
        response += `**Usage**: Execute with \`>>${prompt.id}\``;
        if (prompt.arguments && prompt.arguments.length > 0) {
          const argExamples = prompt.arguments.slice(0, 3).map(arg => `${arg.name}="value"`).join(' ');
          response += ` ${argExamples}`;
          if (prompt.arguments.length > 3) {
            response += ` (${prompt.arguments.length - 3} more args)`;
          }
        }
        response += `\n\n`;

        // Add semantic analysis
        response += `🧠 **Analysis**: ${classification.executionType}`;

        if (classification.requiresExecution) {
          response += ` • Requires execution`;
        }

        if (classification.suggestedGates.length > 0) {
          response += ` • Gates: ${classification.suggestedGates.slice(0, 2).join(', ')}`;
        }

        // Add best use cases from reasoning
        if (classification.reasoning && classification.reasoning.length > 0) {
          const bestReason = classification.reasoning[0];
          if (bestReason && bestReason.length > 10) {
            response += `\n📋 **Best for**: ${bestReason.charAt(0).toUpperCase() + bestReason.slice(1)}`;
          }
        }

        response += `\n\n`;
      }
    }

    // Add filter summary if filters were applied
    if (Object.keys(filters).length > 0) {
      response += "\n## 🔍 Active Filters\n\n";
      if (filters.type) response += `- **Type**: ${filters.type}\n`;
      if (filters.category) response += `- **Category**: ${filters.category}\n`;
      if (filters.intent) response += `- **Intent**: "${filters.intent}"\n`;
      if (filters.text) response += `- **Search**: "${filters.text}"\n`;
      // Confidence filtering removed - focusing on actionable filters
      if (filters.execution !== undefined) {
        response += `- **Execution**: ${filters.execution ? 'Required' : 'Optional'}\n`;
      }
      if (filters.gates !== undefined) {
        response += `- **Quality Gates**: ${filters.gates ? 'Required' : 'None'}\n`;
      }
    }

    return { content: [{ type: "text", text: response }] };
  }

  /**
   * Check if prompt matches filters
   */
  private async matchesFilters(prompt: ConvertedPrompt, filters: any): Promise<boolean> {
    if (Object.keys(filters).length === 0) return true;

    const classification = await this.analyzePrompt(prompt);

    if (filters.type && classification.executionType !== filters.type) return false;

    if (filters.category && prompt.category !== filters.category) return false;

    // Confidence filtering removed - all prompts pass confidence checks

    if (filters.execution !== undefined &&
        filters.execution !== classification.requiresExecution) return false;

    if (filters.gates !== undefined) {
      const hasGates = classification.suggestedGates.length > 0;
      if (filters.gates !== hasGates) return false;
    }

    // Intent-based matching - match against category and semantic content
    if (filters.intent) {
      const intent = filters.intent.toLowerCase();
      const intentSearchable = [
        prompt.category,
        prompt.name,
        prompt.description,
        classification.executionType,
        ...classification.reasoning,
        ...classification.suggestedGates
      ].join(' ').toLowerCase();

      // Check if intent matches category, content, or reasoning
      if (!intentSearchable.includes(intent)) return false;
    }

    // Enhanced text search with basic fuzzy matching
    if (filters.text) {
      const searchText = filters.text.toLowerCase();
      const searchWords = searchText.split(/\s+/);
      const searchable = [
        prompt.id, prompt.name, prompt.description,
        classification.executionType,
        ...classification.suggestedGates
      ].join(' ').toLowerCase();

      // Check if all search words are found (allows partial word matching)
      const allWordsFound = searchWords.every((word: string) => {
        return searchable.includes(word) ||
               // Basic fuzzy match - check if any searchable word starts with the search word
               searchable.split(/\s+/).some((searchableWord: string) =>
                 searchableWord.startsWith(word) || word.startsWith(searchableWord.slice(0, 3))
               );
      });

      if (!allWordsFound) return false;
    }

    return true;
  }

  /**
   * Handle system refresh
   */
  private async handleSystemRefresh(fullRestart: boolean = false, reason: string): Promise<void> {
    if (fullRestart) {
      setTimeout(() => this.onRestart(reason), 1000);
    } else {
      await this.onRefresh();
    }
  }

  /**
   * Enhanced list prompts with execution type visibility
   */
  private async listPrompts(args: any): Promise<ToolResponse> {
    const filters = this.parseIntelligentFilters(args.filter || '');
    const matchingPrompts: Array<{
      prompt: any;
      classification: any;
    }> = [];

    // Process all prompts
    for (const prompt of this.convertedPrompts) {
      try {
        const classification = await this.analyzePrompt(prompt);

        // Apply filters
        if (filters.type && classification.executionType !== filters.type) continue;
        if (filters.category && prompt.category !== filters.category) continue;
        if (filters.text && !prompt.name.toLowerCase().includes(filters.text.toLowerCase()) &&
            !prompt.description?.toLowerCase().includes(filters.text.toLowerCase())) continue;

        matchingPrompts.push({ prompt, classification });
      } catch (error) {
        this.logger.warn(`Failed to analyze prompt ${prompt.id}:`, error);
      }
    }

    // Sort by category, then name
    matchingPrompts.sort((a, b) => {
      const categoryCompare = a.prompt.category.localeCompare(b.prompt.category);
      if (categoryCompare !== 0) return categoryCompare;
      return a.prompt.name.localeCompare(b.prompt.name);
    });

    if (matchingPrompts.length === 0) {
      return {
        content: [{
          type: "text",
          text: `📭 No prompts found matching filter: "${args.filter || 'all'}"\n\n💡 Try broader search terms or use filters like 'type:template', 'category:analysis'`
        }]
      };
    }

    // Enhanced listing with execution type visibility
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

        if (classification.requiresFramework) {
          result += `   🎯 **Framework**: CAGEERF/ReACT ready\n`;
        }

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
      result += `\n\n🔍 **Applied Filters**: ${args.filter}`;
    }

    result += `\n\n💡 **Usage Tips**:\n`;
    result += `• Use \`>>prompt_id\` to execute prompts\n`;
    result += `• Use \`analyze_type\` to get type recommendations\n`;
    result += `• Use \`migrate_type\` to convert between prompt/template\n`;

    return { content: [{ type: "text", text: result }] };
  }

  /**
   * Get icon for execution type
   */
  private getExecutionTypeIcon(executionType: string): string {
    switch (executionType) {
      case 'prompt': return '⚡'; // Fast basic prompts
      case 'template': return '🧠'; // Smart framework-aware templates
      case 'chain': return '🔗'; // LLM-driven multi-step execution
      default: return '❓';
    }
  }

  /**
   * NEW: Create basic prompt (fast variable substitution)
   */
  private async createBasicPrompt(args: any): Promise<ToolResponse> {
    this.validateRequiredFields(args, ['id', 'name', 'user_message_template']);

    // Create prompt with explicit execution mode
    const promptData = {
      ...args,
      executionMode: 'prompt' as const, // Force basic prompt execution
      // Keep system message minimal for basic prompts
      system_message: args.system_message || undefined
    };

    const result = await this.createPrompt(promptData);

    // Use unified clean format (no marketing text)
    const resultText = result.content[0]?.text || '';
    const analysisMatch = resultText.match(/🧠 .*$/m);
    const analysisLine = analysisMatch ? analysisMatch[0] : '';
    
    const enhancedResult = `✅ **Prompt Created**: ${args.name} (${args.id})\n` +
      `📝 ${args.description || 'Basic prompt for variable substitution'}\n` +
      (analysisLine ? `${analysisLine}` : '');

    return {
      content: [{ type: "text", text: enhancedResult }],
      isError: result.isError
    };
  }

  /**
   * NEW: Create framework-aware template
   */
  private async createFrameworkTemplate(args: any): Promise<ToolResponse> {
    this.validateRequiredFields(args, ['id', 'name', 'user_message_template']);

    // Get active framework context if available
    let frameworkSystemPrompt = '';
    let activeFrameworkName = 'Framework';
    
    this.logger.debug(`Framework managers available: StateManager=${!!this.frameworkStateManager}, FrameworkManager=${!!this.frameworkManager}`);
    
    if (this.frameworkStateManager && this.frameworkManager) {
      try {
        const activeFramework = this.frameworkStateManager.getActiveFramework();
        activeFrameworkName = activeFramework.name;
        
        // Get system prompt template from active framework
        frameworkSystemPrompt = activeFramework.systemPromptTemplate.replace(/\{PROMPT_NAME\}/g, args.name);
        
        this.logger.info(`Framework template creation using ${activeFrameworkName} methodology`);
        this.logger.debug(`System prompt length: ${frameworkSystemPrompt.length} characters`);
      } catch (error) {
        this.logger.warn("Failed to get framework context for template creation:", error);
      }
    } else {
      this.logger.warn("Framework managers not available for template creation");
    }

    // Ensure framework-appropriate defaults
    const templateData = {
      ...args,
      executionMode: 'template' as const, // Force template execution
      // Add system message if not provided to encourage framework usage
      system_message: args.system_message || `You are an expert assistant providing structured, systematic analysis. Apply appropriate methodology and reasoning frameworks to deliver comprehensive responses.`
    };

    const result = await this.createPrompt(templateData);

    // Use unified clean format with framework context
    const resultText = result.content[0]?.text || '';
    const analysisMatch = resultText.match(/🧠 .*$/m);
    const analysisLine = analysisMatch ? analysisMatch[0] : '';
    
    let enhancedResult = `✅ **Prompt Created**: ${args.name} (${args.id})\n` +
      `📝 ${args.description || 'Framework-enhanced template for structured analysis'}\n` +
      (analysisLine ? `${analysisLine}` : '');

    // Add framework system prompt if available
    if (frameworkSystemPrompt) {
      enhancedResult += `\n\n## Active Framework System Prompt\n${frameworkSystemPrompt}`;
    }

    return {
      content: [{ type: "text", text: enhancedResult }],
      isError: result.isError
    };
  }

  /**
   * NEW: Analyze prompt type and recommend optimal execution mode
   */
  private async analyzePromptType(args: any): Promise<ToolResponse> {
    this.validateRequiredFields(args, ['id']);

    const prompt = this.convertedPrompts.find(p => p.id === args.id);
    if (!prompt) {
      return {
        content: [{ type: "text", text: `❌ Prompt not found: ${args.id}` }],
        isError: true
      };
    }

    // Use semantic analyzer to classify the prompt
    const analysis = await this.analyzePrompt(prompt);

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

    return { content: [{ type: "text", text: recommendation }] };
  }

  /**
   * NEW: Migrate prompt between execution types
   */
  private async migratePromptType(args: any): Promise<ToolResponse> {
    this.validateRequiredFields(args, ['id', 'target_type']);

    const prompt = this.convertedPrompts.find(p => p.id === args.id);
    if (!prompt) {
      return {
        content: [{ type: "text", text: `❌ Prompt not found: ${args.id}` }],
        isError: true
      };
    }

    const currentAnalysis = await this.analyzePrompt(prompt);
    const currentType = currentAnalysis.executionType;
    const targetType = args.target_type;

    if (currentType === targetType) {
      return {
        content: [{ type: "text", text: `ℹ️ Prompt "${prompt.name}" is already optimized for ${targetType} execution` }]
      };
    }

    let migrationResult = `🔄 **Type Migration**: ${prompt.name}\n`;
    migrationResult += `📍 **From**: ${currentType} → **To**: ${targetType}\n\n`;

    // Prepare updated prompt data
    const updatedData: any = {
      id: prompt.id,
      executionMode: targetType
    };

    // Apply type-specific optimizations
    if (targetType === 'template' && currentType === 'prompt') {
      // Upgrading to template - add framework-friendly system message
      if (!prompt.systemMessage || prompt.systemMessage.length < 50) {
        updatedData.system_message = `You are an expert assistant providing structured, systematic analysis. Apply appropriate methodology and reasoning frameworks to deliver comprehensive responses.`;
        migrationResult += `✅ **Enhanced system message** for framework compatibility\n`;
      }
      migrationResult += `🧠 **Framework benefits enabled**: CAGEERF methodology, structured reasoning\n`;

    } else if (targetType === 'prompt' && currentType === 'template') {
      // Simplifying to basic prompt - minimize system message
      if (prompt.systemMessage && prompt.systemMessage.length > 100) {
        updatedData.system_message = undefined; // Remove complex system message
        migrationResult += `🚀 **Simplified system message** for faster execution\n`;
      }
      migrationResult += `⚡ **Performance benefits**: Faster execution, no framework overhead\n`;
    }

    // Update the prompt
    const updateResult = await this.updatePrompt(updatedData);

    migrationResult += `\n${updateResult.content[0]?.text || 'Migration completed'}`;

    // Re-analyze to confirm migration
    const newAnalysis = await this.analyzePrompt({...prompt, ...updatedData});
    migrationResult += `\n\n📊 **Post-Migration Analysis**:\n`;
    migrationResult += `✅ **New execution type**: ${newAnalysis.executionType}\n`;
    migrationResult += `🎯 **Framework alignment**: ${newAnalysis.requiresFramework ? 'Optimized' : 'Simplified'}\n`;

    return { content: [{ type: "text", text: migrationResult }] };
  }

  /**
   * Validate required fields
   */
  private validateRequiredFields(args: any, required: string[]): void {
    for (const field of required) {
      if (!args[field]) {
        throw new ValidationError(`Missing required field: ${field}`);
      }
    }
  }

  /**
   * Error handling helper
   */
  private handleError(error: unknown, context: string): ToolResponse {
    const { message, isError } = utilsHandleError(error, context, this.logger);
    return {
      content: [{ type: "text", text: message }],
      isError
    };
  }
}

/**
 * Create consolidated prompt manager
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