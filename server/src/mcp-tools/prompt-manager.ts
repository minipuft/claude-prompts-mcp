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
import { SemanticAnalyzer } from "../analysis/semantic-analyzer.js";

/**
 * Prompt classification interface for management operations
 */
export interface PromptClassification {
  executionType: "prompt" | "template" | "chain" | "workflow";
  requiresExecution: boolean;
  requiresFramework: boolean;
  confidence: number;
  reasoning: string[];
  suggestedGates: string[];
  framework?: string;
}

/**
 * Consolidated Prompt Manager Tool
 */
export class ConsolidatedPromptManager {
  private logger: Logger;
  private mcpServer: any;
  private configManager: ConfigManager;
  private semanticAnalyzer: SemanticAnalyzer;
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
    semanticAnalyzer: SemanticAnalyzer,
    onRefresh: () => Promise<void>,
    onRestart: (reason: string) => Promise<void>
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.configManager = configManager;
    this.semanticAnalyzer = semanticAnalyzer;
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
   * Register the consolidated prompt manager tool
   */
  registerTool(): void {
    this.mcpServer.tool(
      "prompt_manager",
      "📝 INTELLIGENT PROMPT MANAGER: Complete lifecycle management with smart analysis, category organization, and comprehensive CRUD operations. Handles create, update, delete, modify, reload, and list operations with intelligent feedback.\n\n🎯 NEW: Type-specific creation commands:\n- 'create_prompt': Create basic prompt (fast variable substitution)\n- 'create_template': Create framework-aware template (intelligent analysis)\n- 'analyze_type': Analyze existing prompt and recommend type\n- 'migrate_type': Convert between prompt and template types",
      {
        action: z
          .enum(["create", "create_prompt", "create_template", "analyze_type", "migrate_type", "update", "delete", "modify", "reload", "list"])
          .describe("Management action: 'create' (auto-detect type), 'create_prompt' (basic prompt), 'create_template' (framework-aware), 'analyze_type' (recommend type), 'migrate_type' (convert type), 'update', 'delete', 'modify', 'reload', 'list'"),

        // Common parameters
        id: z
          .string()
          .optional()
          .describe("Prompt ID (required for update, delete, modify operations)"),

        // Creation/Update parameters
        name: z
          .string()
          .optional()
          .describe("Display name for the prompt"),

        category: z
          .string()
          .optional()
          .describe("Category for organization"),

        description: z
          .string()
          .optional()
          .describe("Prompt description"),

        system_message: z
          .string()
          .optional()
          .describe("Optional system message"),

        user_message_template: z
          .string()
          .optional()
          .describe("Main prompt template"),

        arguments: z
          .array(z.object({
            name: z.string(),
            description: z.string().optional(),
            required: z.boolean()
          }))
          .optional()
          .describe("Prompt arguments definition"),

        is_chain: z
          .boolean()
          .optional()
          .describe("Whether this is a chain prompt"),

        chain_steps: z
          .array(z.object({
            promptId: z.string(),
            stepName: z.string(),
            inputMapping: z.record(z.string()).optional(),
            outputMapping: z.record(z.string()).optional()
          }))
          .optional()
          .describe("Chain steps definition"),

        // Modification parameters
        section_name: z
          .string()
          .optional()
          .describe("Section to modify (for modify action)"),

        new_content: z
          .string()
          .optional()
          .describe("New content for section (for modify action)"),

        // System parameters
        full_restart: z
          .boolean()
          .optional()
          .describe("Perform full server restart instead of hot-reload"),

        reason: z
          .string()
          .optional()
          .describe("Reason for reload/restart operation"),

        // NEW: Type-specific parameters
        target_type: z
          .enum(["prompt", "template"])
          .optional()
          .describe("Target execution type for migration (migrate_type action)"),

        // List parameters
        filter: z
          .string()
          .optional()
          .describe("Intelligent filter for list operation. Examples: 'type:prompt', 'type:template', 'category:code', 'framework:needed', 'confidence:>80', or text search"),

        // Options
        options: z
          .record(z.any())
          .optional()
          .describe("Additional operation options")
      },
      async (args: {
        action: "create" | "update" | "delete" | "modify" | "reload" | "list";
        id?: string;
        name?: string;
        category?: string;
        description?: string;
        system_message?: string;
        user_message_template?: string;
        arguments?: Array<{name: string; description?: string; required: boolean}>;
        is_chain?: boolean;
        chain_steps?: Array<{promptId: string; stepName: string; inputMapping?: Record<string, string>; outputMapping?: Record<string, string>}>;
        section_name?: string;
        new_content?: string;
        full_restart?: boolean;
        reason?: string;
        filter?: string;
        options?: Record<string, any>;
      }, extra: any) => {
        try {
          return await this.handleAction(args, extra);
        } catch (error) {
          return this.handleError(error, `prompt_manager_${args.action}`);
        }
      }
    );

    this.logger.info("Consolidated Prompt Manager registered successfully");
  }

  /**
   * Main action handler
   */
  private async handleAction(args: {
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

    let response = `✅ **Prompt Created**: ${args.name} (${args.id})\n\n`;
    response += `${result.message}\n\n`;
    response += `${analysis.feedback}\n`;

    if (analysis.suggestions.length > 0) {
      response += `\n💡 **Suggestions**:\n`;
      analysis.suggestions.forEach((suggestion, i) => {
        response += `${i + 1}. ${suggestion}\n`;
      });
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
      isChain: args.is_chain || currentPrompt?.isChain || false,
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
      response += `\nDeleting will break these chain/workflow references.\n\n`;
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

          // Clean up empty category if needed
          if (categoryData.prompts.length === 0) {
            messages.push(`ℹ️ Category is now empty - consider cleanup`);
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
      const categoryDir = path.join(path.dirname(promptsFile), "prompts", effectiveCategory);
      await fs.mkdir(categoryDir, { recursive: true });

      const categoryPromptsPath = path.join(categoryDir, "prompts.json");
      await safeWriteFile(categoryPromptsPath, JSON.stringify({ prompts: [] }, null, 2), "utf8");

      // Add to imports
      const relativePath = path.join("prompts", effectiveCategory, "prompts.json").replace(/\\/g, "/");
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
    const categoryDir = path.join(path.dirname(promptsFile), "prompts", effectiveCategory);
    const promptPath = path.join(categoryDir, promptFilename);

    // Create markdown content
    let content = `# ${promptData.name}\n\n`;
    content += `## Description\n${promptData.description}\n\n`;

    if (promptData.systemMessage) {
      content += `## System Message\n${promptData.systemMessage}\n\n`;
    }

    content += `## User Message Template\n${promptData.userMessageTemplate}\n`;

    if (promptData.isChain && promptData.chainSteps?.length > 0) {
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
   * Analyze prompt for intelligence feedback
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
      isChain: promptData.isChain || false,
      chainSteps: promptData.chainSteps || []
    };

    const classification = await this.analyzePrompt(tempPrompt);

    // Generate feedback
    const confidence = Math.round(classification.confidence * 100);
    let feedback = `🧠 **Intelligent Analysis**: ${classification.executionType} (${confidence}% confidence)\n`;
    feedback += `⚡ **Execution Required**: ${classification.requiresExecution ? 'Yes' : 'No'}\n`;

    if (classification.suggestedGates.length > 0) {
      feedback += `🛡️ **Auto-assigned Gates**: ${classification.suggestedGates.join(', ')}\n`;
    }

    // Generate suggestions
    const suggestions: string[] = [];

    if (classification.confidence < 0.7) {
      suggestions.push("Consider adding more structured language to improve execution confidence");
    }

    if (classification.requiresExecution && !promptData.userMessageTemplate.toLowerCase().includes('step')) {
      suggestions.push("Consider adding step-by-step structure for clearer execution guidance");
    }

    if (promptData.arguments.length > 3 && classification.confidence < 0.8) {
      suggestions.push("Complex prompts benefit from clear section headers and structured templates");
    }

    return { classification, feedback, suggestions };
  }

  /**
   * Analyze prompt using semantic analyzer
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
        framework: 'semantic'
      };
    } catch (error) {
      this.logger.error(`Semantic analysis failed for ${prompt.id}:`, error);
      return {
        executionType: prompt.isChain ? 'chain' : 'template',
        requiresExecution: true,
        requiresFramework: true, // Default to requiring framework for fallback
        confidence: 0.5,
        reasoning: [`Fallback analysis: ${error}`],
        suggestedGates: ['execution_validation'],
        framework: 'fallback'
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
    const beforeConfidence = Math.round(before.confidence * 100);
    const afterConfidence = Math.round(after.confidence * 100);

    const changes: string[] = [];

    if (before.executionType !== after.executionType) {
      changes.push(`🔄 **Type**: ${before.executionType} → ${after.executionType}`);
    }

    if (Math.abs(before.confidence - after.confidence) > 0.1) {
      const trend = after.confidence > before.confidence ? "📈" : "📉";
      changes.push(`${trend} **Confidence**: ${beforeConfidence}% → ${afterConfidence}%`);
    }

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
   * Find prompt dependencies (chains/workflows that reference this prompt)
   */
  private findPromptDependencies(promptId: string): ConvertedPrompt[] {
    return this.convertedPrompts.filter(prompt => {
      if (!prompt.isChain || !prompt.chainSteps) return false;
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

    const confidenceMatch = filterText.match(/confidence:([<>]?)(\d+)(?:-(\d+))?/);
    if (confidenceMatch) {
      const [, operator, num1, num2] = confidenceMatch;
      const val1 = parseInt(num1);
      const val2 = num2 ? parseInt(num2) : undefined;

      if (operator === '>') {
        filters.confidence = { min: val1 };
      } else if (operator === '<') {
        filters.confidence = { max: val1 };
      } else if (val2) {
        filters.confidence = { min: val1, max: val2 };
      }
    }

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
        const confidence = Math.round(classification.confidence * 100);

        const confidenceIcon = confidence > 75 ? "🟢" : confidence > 50 ? "🟡" : "🔴";
        const typeIcon = classification.executionType === "workflow" ? "⚙️" :
                         classification.executionType === "chain" ? "🔗" : "📄";

        response += `### ${typeIcon} ${prompt.id} ${confidenceIcon}\n\n`;
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
        response += `🧠 **Analysis**: ${classification.executionType} (${confidence}% confidence)`;

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
      if (filters.confidence) {
        const { min, max } = filters.confidence;
        if (min && max) response += `- **Confidence**: ${min}%-${max}%\n`;
        else if (min) response += `- **Confidence**: >${min}%\n`;
        else if (max) response += `- **Confidence**: <${max}%\n`;
      }
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
    const confidence = Math.round(classification.confidence * 100);

    if (filters.type && classification.executionType !== filters.type) return false;

    if (filters.category && prompt.category !== filters.category) return false;

    if (filters.confidence) {
      if (filters.confidence.min && confidence < filters.confidence.min) return false;
      if (filters.confidence.max && confidence > filters.confidence.max) return false;
    }

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
        const confidenceScore = Math.round(classification.confidence * 100);

        result += `\n**${executionIcon} ${prompt.name}** \`${prompt.id}\`\n`;
        result += `   ${frameworkIcon} **Type**: ${classification.executionType} (${confidenceScore}% confidence)\n`;

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
      case 'chain': return '🔗'; // Sequential execution
      case 'workflow': return '⚙️'; // Complex orchestration
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

    // Add type-specific feedback
    const resultText = result.content[0]?.text || '';
    const enhancedResult = `✅ **Basic Prompt Created**: ${args.name}\n` +
      `🚀 **Execution Type**: Fast variable substitution (no framework processing)\n` +
      `📋 **Use Case**: Simple text replacement and basic prompts\n\n` +
      resultText;

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

    // Ensure framework-appropriate defaults
    const templateData = {
      ...args,
      executionMode: 'template' as const, // Force template execution
      // Add system message if not provided to encourage framework usage
      system_message: args.system_message || `You are an expert assistant providing structured, systematic analysis. Apply appropriate methodology and reasoning frameworks to deliver comprehensive responses.`
    };

    const result = await this.createPrompt(templateData);

    // Add type-specific feedback with framework guidance
    const resultText = result.content[0]?.text || '';
    const enhancedResult = `✅ **Framework Template Created**: ${args.name}\n` +
      `🧠 **Execution Type**: Intelligent analysis with framework guidance\n` +
      `🎯 **Framework Benefits**: CAGEERF methodology, structured reasoning, systematic approach\n` +
      `📋 **Use Case**: Complex analysis, structured reasoning, methodology-driven responses\n\n` +
      resultText;

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
    recommendation += `🎯 **Confidence**: ${Math.round(analysis.confidence * 100)}%\n`;
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
  semanticAnalyzer: SemanticAnalyzer,
  onRefresh: () => Promise<void>,
  onRestart: (reason: string) => Promise<void>
): ConsolidatedPromptManager {
  return new ConsolidatedPromptManager(
    logger,
    mcpServer,
    configManager,
    semanticAnalyzer,
    onRefresh,
    onRestart
  );
}