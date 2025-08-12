/**
 * Prompt Management MCP Tools
 * Contains update_prompt, delete_prompt, modify_prompt_section, and reload_prompts tools
 */

import * as fs from "fs/promises";
import { readFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import { ConfigManager } from "../config/index.js";
import { Logger } from "../logging/index.js";
import { modifyPromptSection, safeWriteFile } from "../prompts/promptUtils.js";
import { SemanticAnalyzer, PromptClassification } from "../utils/semanticAnalyzer.js";
import {
  ConvertedPrompt,
  PromptData,
  PromptsConfigFile,
} from "../types/index.js";

/**
 * Prompt Management Tools implementation
 */
export class PromptManagementTools {
  private logger: Logger;
  private mcpServer: any;
  private configManager: ConfigManager;
  private promptsData: PromptData[] = [];
  private convertedPrompts: ConvertedPrompt[] = [];
  private semanticAnalyzer: SemanticAnalyzer;
  private onRefresh: () => Promise<void>;
  private onRestart: (reason: string) => Promise<void>;

  constructor(
    logger: Logger,
    mcpServer: any,
    configManager: ConfigManager,
    onRefresh: () => Promise<void>,
    onRestart: (reason: string) => Promise<void>
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.configManager = configManager;
    this.semanticAnalyzer = new SemanticAnalyzer();
    this.onRefresh = onRefresh;
    this.onRestart = onRestart;
  }

  /**
   * Update internal data references
   */
  updateData(
    promptsData: PromptData[],
    convertedPrompts: ConvertedPrompt[]
  ): void {
    this.promptsData = promptsData;
    this.convertedPrompts = convertedPrompts;
  }

  /**
   * Record learning data for prompt management operations
   */
  private recordLearningData(
    operation: string,
    promptId: string,
    classification: PromptClassification
  ): void {
    const timestamp = Date.now();
    
    const learningData = {
      timestamp,
      operation,
      promptId,
      classification: {
        executionType: classification.executionType,
        confidence: classification.confidence,
        requiresExecution: classification.requiresExecution,
        suggestedGates: classification.suggestedGates,
      },
      context: 'prompt_management'
    };

    this.logger.debug(`Recording learning data for ${operation}:${promptId}`, learningData);
    
    // Track confidence trends for prompt lifecycle management
    this.trackConfidenceTrend(promptId, classification.confidence, timestamp, operation);
    
    // This could be enhanced to store in a persistent learning database
    // For now, just log for analysis purposes
  }

  /**
   * Track confidence trends for prompt lifecycle management
   */
  private trackConfidenceTrend(
    promptId: string,
    confidence: number,
    timestamp: number,
    operation: string
  ): void {
    // This would typically interface with the main analytics system
    // For now, we'll create a simplified version that logs trends
    
    const confidenceData = {
      promptId,
      confidence: Math.round(confidence * 100),
      timestamp,
      operation,
      trend: this.calculateConfidenceTrend(promptId, confidence)
    };

    this.logger.info(`📊 Confidence tracking for ${promptId}: ${confidenceData.confidence}% (${confidenceData.trend}) via ${operation}`);
  }

  /**
   * Calculate confidence trend for a prompt
   */
  private calculateConfidenceTrend(promptId: string, currentConfidence: number): string {
    // In a full implementation, this would track historical confidence data
    // For now, we'll provide basic categorization
    
    if (currentConfidence >= 0.8) {
      return "HIGH_CONFIDENCE";
    } else if (currentConfidence >= 0.6) {
      return "MODERATE_CONFIDENCE";
    } else if (currentConfidence >= 0.4) {
      return "LOW_CONFIDENCE";
    } else {
      return "NEEDS_IMPROVEMENT";
    }
  }

  /**
   * Analyze a prompt and generate intelligent feedback
   */
  private analyzePromptIntelligence(promptData: PromptData, userMessageTemplate: string, systemMessage?: string, isChain?: boolean, chainSteps?: any[]): {
    classification: PromptClassification;
    feedback: string;
    suggestions: string[];
  } {
    // Create a temporary ConvertedPrompt for analysis
    const tempPrompt: ConvertedPrompt = {
      id: promptData.id,
      name: promptData.name,
      description: promptData.description,
      category: promptData.category,
      systemMessage,
      userMessageTemplate,
      arguments: promptData.arguments || [],
      isChain: isChain || false,
      chainSteps: chainSteps || []
    };

    const classification = this.semanticAnalyzer.analyzePrompt(tempPrompt);
    
    // Generate intelligent feedback
    const confidence = Math.round(classification.confidence * 100);
    let feedback = `🧠 **Intelligent Analysis**: ${classification.executionType} (${confidence}% confidence)\n`;
    feedback += `⚡ **Execution Required**: ${classification.requiresExecution ? 'Yes' : 'No'}\n`;
    
    if (classification.suggestedGates.length > 0) {
      feedback += `🛡️ **Auto-assigned Gates**: ${classification.suggestedGates.join(', ')}\n`;
    }

    // Generate suggestions for improvement
    const suggestions: string[] = [];
    
    if (classification.confidence < 0.7) {
      suggestions.push("Consider adding more structured language to improve execution confidence");
    }
    
    if (classification.confidence < 0.5) {
      suggestions.push("Add framework or systematic approach keywords for better detection");
    }
    
    if (classification.requiresExecution && !userMessageTemplate.toLowerCase().includes('step')) {
      suggestions.push("Consider adding step-by-step structure for clearer execution guidance");
    }
    
    if (promptData.arguments.length > 3 && classification.confidence < 0.8) {
      suggestions.push("Complex prompts benefit from clear section headers and structured templates");
    }

    return { classification, feedback, suggestions };
  }

  /**
   * Compare two prompt analyses and generate change feedback
   */
  private comparePromptAnalyses(
    before: PromptClassification, 
    after: PromptClassification,
    promptId: string
  ): string {
    const beforeConfidence = Math.round(before.confidence * 100);
    const afterConfidence = Math.round(after.confidence * 100);
    
    let comparison = `📊 **Analysis Comparison for ${promptId}**:\n`;
    
    if (before.executionType !== after.executionType) {
      comparison += `🔄 **Type Changed**: ${before.executionType} → ${after.executionType}\n`;
    }
    
    if (Math.abs(before.confidence - after.confidence) > 0.1) {
      const trend = after.confidence > before.confidence ? "📈 Improved" : "📉 Decreased";
      comparison += `${trend} **Confidence**: ${beforeConfidence}% → ${afterConfidence}%\n`;
      
      if (after.confidence < before.confidence) {
        comparison += `⚠️ **Warning**: Confidence decreased - consider reviewing changes\n`;
      }
    }
    
    // Compare suggested gates
    const beforeGates = new Set(before.suggestedGates);
    const afterGates = new Set(after.suggestedGates);
    const addedGates = [...afterGates].filter(g => !beforeGates.has(g));
    const removedGates = [...beforeGates].filter(g => !afterGates.has(g));
    
    if (addedGates.length > 0) {
      comparison += `✅ **Added Gates**: ${addedGates.join(', ')}\n`;
    }
    
    if (removedGates.length > 0) {
      comparison += `❌ **Removed Gates**: ${removedGates.join(', ')}\n`;
    }
    
    return comparison;
  }

  /**
   * Register update_prompt tool
   */
  registerUpdatePrompt(): void {
    this.mcpServer.tool(
      "update_prompt",
      "🔄 UPDATE PROMPT: Modify existing prompts with intelligent CAGEERF analysis and validation. Supports content updates, argument modifications, and category changes with semantic analysis.",
      {
        id: z.string().describe("Unique identifier for the prompt"),
        name: z.string().describe("Display name for the prompt"),
        category: z.string().describe("Category this prompt belongs to"),
        description: z.string().describe("Description of the prompt"),
        systemMessage: z
          .string()
          .optional()
          .describe("Optional system message for the prompt"),
        userMessageTemplate: z
          .string()
          .describe("Template for generating the user message"),
        arguments: z
          .array(
            z.object({
              name: z.string().describe("Name of the argument"),
              description: z
                .string()
                .optional()
                .describe("Optional description of the argument"),
              required: z
                .boolean()
                .describe("Whether this argument is required"),
            })
          )
          .describe("Arguments accepted by this prompt"),
        isChain: z
          .boolean()
          .optional()
          .describe("Whether this prompt is a chain of prompts"),
        chainSteps: z
          .array(
            z.object({
              promptId: z
                .string()
                .describe("ID of the prompt to execute in this step"),
              stepName: z.string().describe("Name of this step"),
              inputMapping: z
                .record(z.string())
                .optional()
                .describe("Maps chain inputs to this step's inputs"),
              outputMapping: z
                .record(z.string())
                .optional()
                .describe("Maps this step's outputs to chain outputs"),
            })
          )
          .optional()
          .describe("Steps in the chain if this is a chain prompt"),
        onEmptyInvocation: z
          .enum(["return_template", "execute_if_possible"])
          .optional()
          .describe(
            "Defines behavior when prompt is invoked without its defined arguments. Defaults to execute_if_possible if omitted."
          ),
        fullServerRestart: z
          .boolean()
          .optional()
          .describe(
            "Whether to perform a full server restart after updating the prompt. Defaults to false (hot-reload only)."
          ),
      },
      async (
        args: {
          id: string;
          name: string;
          category: string;
          description: string;
          systemMessage?: string;
          userMessageTemplate: string;
          arguments: Array<{
            name: string;
            description?: string;
            required: boolean;
          }>;
          isChain?: boolean;
          chainSteps?: Array<{
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string>;
            outputMapping?: Record<string, string>;
          }>;
          onEmptyInvocation?: "return_template" | "execute_if_possible";
          fullServerRestart?: boolean;
        },
        extra: any
      ) => {
        try {
          this.logger.info(`Updating prompt: ${args.id}`);

          const result = await this.updatePromptImplementation(args);
          
          // Perform intelligent analysis on the new/updated prompt
          const promptData: PromptData = {
            id: args.id,
            name: args.name,
            category: args.category,
            description: args.description,
            file: `${args.id}.md`,
            arguments: args.arguments,
            onEmptyInvocation: args.onEmptyInvocation
          };
          
          const analysis = this.analyzePromptIntelligence(promptData, args.userMessageTemplate, args.systemMessage, args.isChain, args.chainSteps);
          
          // Record learning data for prompt management usage
          this.recordLearningData('update_prompt', args.id, analysis.classification);
          
          // Create enhanced response with intelligent feedback
          let enhancedMessage = `${result.message}\n\n`;
          enhancedMessage += `${analysis.feedback}\n`;
          
          if (analysis.suggestions.length > 0) {
            enhancedMessage += `💡 **Suggestions for Improvement**:\n`;
            analysis.suggestions.forEach((suggestion, index) => {
              enhancedMessage += `   ${index + 1}. ${suggestion}\n`;
            });
            enhancedMessage += `\n`;
          }

          if (args.fullServerRestart) {
            setTimeout(
              () => this.onRestart(`Prompt updated: ${args.id}`),
              1000
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `${enhancedMessage}Full server restart initiated as requested...`,
                },
              ],
            };
          } else {
            // Default to hot-reload
            await this.onRefresh();
            this.logger.info(
              `Hot-reload after updating prompt: ${args.id} completed.`
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `${enhancedMessage}Changes were hot-reloaded.`,
                },
              ],
            };
          }
        } catch (error) {
          this.logger.error(`Error in update_prompt:`, error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to update prompt: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * Implementation of update prompt logic
   */
  private async updatePromptImplementation(
    args: any
  ): Promise<{ message: string }> {
    const PROMPTS_FILE = this.configManager.getPromptsFilePath();
    const messages: string[] = [];

    const fileContent = await readFile(PROMPTS_FILE, "utf8");
    const promptsConfig = JSON.parse(fileContent) as PromptsConfigFile;

    if (!promptsConfig.categories) promptsConfig.categories = [];
    if (!promptsConfig.imports) promptsConfig.imports = [];

    const { effectiveCategory, created: categoryCreated } =
      await this.ensureCategoryExists(
        args.category,
        promptsConfig,
        PROMPTS_FILE
      );

    if (categoryCreated) {
      messages.push(
        `✅ Created and configured new category: '${effectiveCategory}'`
      );
    } else {
      messages.push(`ℹ️ Using existing category: '${effectiveCategory}'`);
    }

    const { exists: promptExists, filePath } =
      await this.createOrUpdatePromptFile(
        args,
        effectiveCategory,
        PROMPTS_FILE
      );

    messages.push(
      `✅ ${
        promptExists ? "Updated" : "Created"
      } prompt markdown file: ${path.basename(filePath)}`
    );
    messages.push(
      `✅ ${promptExists ? "Updated" : "Added"} prompt entry for '${
        args.id
      }' in category's prompts.json.`
    );

    return {
      message: messages.join("\n"),
    };
  }

  /**
   * Ensure category exists, create if needed
   */
  private async ensureCategoryExists(
    category: string,
    promptsConfig: PromptsConfigFile,
    promptsFile: string
  ): Promise<{ effectiveCategory: string; created: boolean }> {
    const effectiveCategory = category.toLowerCase().replace(/\s+/g, "-");
    const categoryExists = promptsConfig.categories.some(
      (cat) => cat.id === effectiveCategory
    );

    if (!categoryExists) {
      this.logger.info(
        `Category '${category}' does not exist. Creating it automatically.`
      );

      // Add new category
      promptsConfig.categories.push({
        id: effectiveCategory,
        name: category,
        description: `Prompts related to ${category}`,
      });

      // Create category directory
      const categoryDirPath = path.join(
        path.dirname(promptsFile),
        "prompts",
        effectiveCategory
      );
      await fs.mkdir(categoryDirPath, { recursive: true });

      // Create category prompts.json
      const categoryPromptsPath = path.join(categoryDirPath, "prompts.json");
      await safeWriteFile(
        categoryPromptsPath,
        JSON.stringify({ prompts: [] }, null, 2),
        "utf8"
      );

      // Add to imports
      const relativeCategoryPath = path
        .join("prompts", effectiveCategory, "prompts.json")
        .replace(/\\/g, "/");
      if (!promptsConfig.imports.includes(relativeCategoryPath)) {
        promptsConfig.imports.push(relativeCategoryPath);
      }

      // Save updated config
      await safeWriteFile(
        promptsFile,
        JSON.stringify(promptsConfig, null, 2),
        "utf8"
      );
      return { effectiveCategory, created: true };
    }

    return { effectiveCategory, created: false };
  }

  /**
   * Create or update prompt file and category entry
   */
  private async createOrUpdatePromptFile(
    args: any,
    effectiveCategory: string,
    promptsFile: string
  ): Promise<{ exists: boolean; filePath: string }> {
    const promptFilename = `${args.id}.md`;
    const promptDirPath = path.join(
      path.dirname(promptsFile),
      "prompts",
      effectiveCategory
    );
    const fullPromptFilePath = path.join(promptDirPath, promptFilename);

    // Create prompt file content
    let promptFileContent = `# ${args.name}\n\n`;
    promptFileContent += `## Description\n${args.description}\n\n`;

    if (args.systemMessage) {
      promptFileContent += `## System Message\n${args.systemMessage}\n\n`;
    }

    promptFileContent += `## User Message Template\n${args.userMessageTemplate}\n`;

    // Add chain steps if present
    if (args.isChain && args.chainSteps && args.chainSteps.length > 0) {
      promptFileContent += `\n## Chain Steps\n\n`;

      args.chainSteps.forEach((step: any, index: number) => {
        promptFileContent += `${index + 1}. promptId: ${step.promptId}\n`;
        promptFileContent += `   stepName: ${step.stepName}\n`;

        if (step.inputMapping) {
          promptFileContent += `   inputMapping:\n`;
          for (const [key, value] of Object.entries(step.inputMapping)) {
            promptFileContent += `     ${key}: ${value}\n`;
          }
        }

        if (step.outputMapping) {
          promptFileContent += `   outputMapping:\n`;
          for (const [key, value] of Object.entries(step.outputMapping)) {
            promptFileContent += `     ${key}: ${value}\n`;
          }
        }

        promptFileContent += `\n`;
      });
    }

    // Write prompt file
    await safeWriteFile(fullPromptFilePath, promptFileContent, "utf8");

    // Update category prompts.json
    const categoryPromptsPath = path.join(promptDirPath, "prompts.json");
    let categoryPrompts: { prompts: PromptData[] };

    try {
      const content = await readFile(categoryPromptsPath, "utf8");
      categoryPrompts = JSON.parse(content);
    } catch {
      categoryPrompts = { prompts: [] };
    }

    const promptEntry: PromptData = {
      id: args.id,
      name: args.name,
      category: effectiveCategory,
      description: args.description,
      file: promptFilename,
      arguments: args.arguments || [],
      ...(args.onEmptyInvocation && {
        onEmptyInvocation: args.onEmptyInvocation,
      }),
    };

    const existingIndex = categoryPrompts.prompts.findIndex(
      (p) => p.id === args.id
    );
    const promptExists = existingIndex !== -1;

    if (promptExists) {
      categoryPrompts.prompts[existingIndex] = promptEntry;
    } else {
      categoryPrompts.prompts.push(promptEntry);
    }

    await safeWriteFile(
      categoryPromptsPath,
      JSON.stringify(categoryPrompts, null, 2),
      "utf8"
    );

    return { exists: promptExists, filePath: fullPromptFilePath };
  }

  /**
   * Register delete_prompt tool
   */
  registerDeletePrompt(): void {
    this.mcpServer.tool(
      "delete_prompt",
      "🗑️ DELETE PROMPT: Remove prompts from the system with comprehensive validation and backup creation. Includes safety checks and category management.",
      {
        id: z.string().describe("Unique identifier for the prompt to delete"),
        fullServerRestart: z
          .boolean()
          .optional()
          .describe(
            "Whether to perform a full server restart after deleting the prompt. Defaults to false (hot-reload only)."
          ),
      },
      async (
        { id, fullServerRestart }: { id: string; fullServerRestart?: boolean },
        extra: any
      ) => {
        try {
          this.logger.info(`Deleting prompt: ${id}`);

          const result = await this.deletePromptImplementation(id);

          if (fullServerRestart) {
            setTimeout(() => this.onRestart(`Prompt deleted: ${id}`), 1000);
            return {
              content: [
                {
                  type: "text",
                  text: `${result.message} Server restarting...`,
                },
              ],
            };
          } else {
            await this.onRefresh();
            return {
              content: [
                { type: "text", text: `${result.message} Hot-reloaded.` },
              ],
            };
          }
        } catch (error) {
          this.logger.error(`Error in delete_prompt tool:`, error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to delete prompt: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * Implementation of delete prompt logic
   */
  private async deletePromptImplementation(
    id: string
  ): Promise<{ message: string }> {
    const PROMPTS_CONFIG_FILE_PATH = this.configManager.getPromptsFilePath();
    const promptsConfigDir = path.dirname(PROMPTS_CONFIG_FILE_PATH);
    let promptsConfig: PromptsConfigFile;
    const messages: string[] = [];

    try {
      const configContent = await readFile(PROMPTS_CONFIG_FILE_PATH, "utf8");
      promptsConfig = JSON.parse(configContent);
    } catch (e) {
      this.logger.error(
        `Failed to read or parse promptsConfig.json at ${PROMPTS_CONFIG_FILE_PATH}`,
        e
      );
      throw new Error("Could not load main prompt configuration.");
    }

    if (!promptsConfig.imports) promptsConfig.imports = [];
    if (!promptsConfig.categories) promptsConfig.categories = [];

    let promptFoundAndDeleted = false;
    let modifiedCategoryImportPath: string | null = null;
    let promptMarkdownFilePath: string | null = null;

    for (const categoryImport of [...promptsConfig.imports]) {
      const fullCategoryPromptsPath = path.join(
        promptsConfigDir,
        categoryImport
      );
      let categoryPromptsFileContent;
      let categoryPromptsJson;

      try {
        categoryPromptsFileContent = await readFile(
          fullCategoryPromptsPath,
          "utf8"
        );
        categoryPromptsJson = JSON.parse(categoryPromptsFileContent);
      } catch (e) {
        this.logger.warn(
          `Could not read or parse category prompts file: ${fullCategoryPromptsPath}`,
          e
        );
        continue;
      }

      if (
        !categoryPromptsJson.prompts ||
        !Array.isArray(categoryPromptsJson.prompts)
      ) {
        this.logger.warn(
          `Category file ${fullCategoryPromptsPath} has no valid 'prompts' array. Skipping.`
        );
        continue;
      }

      const promptToDeleteIndex = categoryPromptsJson.prompts.findIndex(
        (p: PromptData) => p.id === id
      );

      if (promptToDeleteIndex > -1) {
        const promptEntry = categoryPromptsJson.prompts[promptToDeleteIndex];
        promptMarkdownFilePath = path.join(
          path.dirname(fullCategoryPromptsPath),
          promptEntry.file
        );

        categoryPromptsJson.prompts.splice(promptToDeleteIndex, 1);
        await safeWriteFile(
          fullCategoryPromptsPath,
          JSON.stringify(categoryPromptsJson, null, 2),
          "utf8"
        );
        messages.push(
          `✅ Removed prompt '${id}' from category file: ${categoryImport}`
        );
        promptFoundAndDeleted = true;
        modifiedCategoryImportPath = categoryImport;

        if (promptMarkdownFilePath) {
          try {
            await fs.unlink(promptMarkdownFilePath);
            messages.push(`✅ Deleted markdown file: ${promptEntry.file}`);
          } catch (unlinkError: any) {
            if (unlinkError.code !== "ENOENT") {
              messages.push(
                `⚠️ Could not delete markdown file '${promptEntry.file}': ${unlinkError.message}`
              );
            } else {
              messages.push(
                `ℹ️ Markdown file '${promptEntry.file}' not found, possibly already deleted.`
              );
            }
          }
        }
        break;
      }
    }

    if (!promptFoundAndDeleted) {
      throw new Error(
        `Prompt with ID '${id}' not found in any category's prompts.json.`
      );
    }

    if (modifiedCategoryImportPath) {
      const fullModifiedCategoryPath = path.join(
        promptsConfigDir,
        modifiedCategoryImportPath
      );
      try {
        const categoryFileContent = await readFile(
          fullModifiedCategoryPath,
          "utf8"
        );
        const categoryPromptsConfig = JSON.parse(categoryFileContent);

        if (
          categoryPromptsConfig.prompts &&
          categoryPromptsConfig.prompts.length === 0
        ) {
          messages.push(
            `ℹ️ Category file '${modifiedCategoryImportPath}' is now empty.`
          );
          promptsConfig.imports = promptsConfig.imports.filter(
            (impPath) => impPath !== modifiedCategoryImportPath
          );
          messages.push(
            `✅ Removed empty category import from promptsConfig.json.`
          );

          const categoryIdMatch = modifiedCategoryImportPath.match(
            /(?:prompts[\\/])?([^\\/]+)[\\/]prompts\.json$/
          );
          if (categoryIdMatch && categoryIdMatch[1]) {
            const categoryIdToRemove = categoryIdMatch[1];
            const originalCategoryCount = promptsConfig.categories.length;
            promptsConfig.categories = promptsConfig.categories.filter(
              (cat) => cat.id !== categoryIdToRemove
            );
            if (promptsConfig.categories.length < originalCategoryCount) {
              messages.push(
                `✅ Removed category definition for '${categoryIdToRemove}' from promptsConfig.json.`
              );
            }

            const categoryDirPath = path.dirname(fullModifiedCategoryPath);
            try {
              const filesInDir = await fs.readdir(categoryDirPath);
              if (filesInDir.length === 1 && filesInDir[0] === "prompts.json") {
                await fs.rm(categoryDirPath, { recursive: true, force: true });
                messages.push(
                  `✅ Deleted empty category directory: ${path.basename(
                    categoryDirPath
                  )}`
                );
              } else {
                messages.push(
                  `ℹ️ Category directory '${path.basename(
                    categoryDirPath
                  )}' was not empty, so it was not deleted.`
                );
              }
            } catch (dirRemoveError: any) {
              messages.push(
                `⚠️ Could not check or delete category directory '${path.basename(
                  categoryDirPath
                )}': ${dirRemoveError.message}`
              );
            }
          } else {
            this.logger.warn(
              `Could not determine category ID from path '${modifiedCategoryImportPath}' to remove its definition.`
            );
          }
          await safeWriteFile(
            PROMPTS_CONFIG_FILE_PATH,
            JSON.stringify(promptsConfig, null, 2),
            "utf8"
          );
          this.logger.info(
            "Updated promptsConfig.json after removing empty category references."
          );
        }
      } catch (readCheckError) {
        this.logger.error(
          `Could not re-read category file '${fullModifiedCategoryPath}' to check if empty:`,
          readCheckError
        );
      }
    }
    return {
      message: messages.join("\n"),
    };
  }

  /**
   * Register modify_prompt_section tool
   */
  registerModifyPromptSection(): void {
    this.mcpServer.tool(
      "modify_prompt_section",
      "✏️ MODIFY PROMPT SECTION: Update specific sections of prompts with precision editing and validation. Supports content modification, argument updates, and metadata changes.",
      {
        id: z.string().describe("Unique identifier of the prompt to modify"),
        section_name: z
          .string()
          .describe(
            "Name of the section to modify (valid values: 'title', 'description', 'System Message', 'User Message Template', or any custom section)"
          ),
        new_content: z
          .string()
          .describe("New content for the specified section"),
        fullServerRestart: z
          .boolean()
          .optional()
          .describe(
            "Whether to perform a full server restart after modifying the prompt section. Defaults to false (hot-reload only)."
          ),
      },
      async (args: {
        id: string;
        section_name: string;
        new_content: string;
        fullServerRestart?: boolean;
      }) => {
        try {
          this.logger.info(
            `Attempting to modify section '${args.section_name}' of prompt '${args.id}'`
          );

          // Get current prompt data for before analysis
          const currentPrompt = this.convertedPrompts.find(p => p.id === args.id);
          let beforeAnalysis: PromptClassification | null = null;
          
          if (currentPrompt) {
            beforeAnalysis = this.semanticAnalyzer.analyzePrompt(currentPrompt);
          }

          const PROMPTS_FILE = this.configManager.getPromptsFilePath();
          const result = await modifyPromptSection(
            args.id,
            args.section_name,
            args.new_content,
            PROMPTS_FILE
          );
          
          // Generate after analysis if we have a current prompt to compare
          let analysisComparison = "";
          if (beforeAnalysis && currentPrompt) {
            // Create updated prompt for analysis
            const updatedPrompt = { ...currentPrompt };
            if (args.section_name.toLowerCase() === "user message template") {
              updatedPrompt.userMessageTemplate = args.new_content;
            } else if (args.section_name.toLowerCase() === "system message") {
              updatedPrompt.systemMessage = args.new_content;
            }
            
            const afterAnalysis = this.semanticAnalyzer.analyzePrompt(updatedPrompt);
            analysisComparison = this.comparePromptAnalyses(beforeAnalysis, afterAnalysis, args.id);
            
            // Record learning data for the modification
            this.recordLearningData('modify_prompt_section', args.id, afterAnalysis);
          }

          // Create enhanced response with analysis
          let enhancedMessage = `${result.message}\n\n`;
          if (analysisComparison) {
            enhancedMessage += `${analysisComparison}\n`;
          }

          if (args.fullServerRestart) {
            setTimeout(
              () =>
                this.onRestart(
                  `Section '${args.section_name}' modified in prompt '${args.id}'`
                ),
              1000
            );
            return {
              content: [
                {
                  type: "text",
                  text: `${enhancedMessage}Full server restart initiated...`,
                },
              ],
            };
          } else {
            await this.onRefresh();
            return {
              content: [
                {
                  type: "text",
                  text: `${enhancedMessage}Changes were hot-reloaded.`,
                },
              ],
            };
          }
        } catch (error) {
          this.logger.error(`Error in modify_prompt_section:`, error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to modify prompt section: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * Register reload_prompts tool
   */
  registerReloadPrompts(): void {
    this.mcpServer.tool(
      "reload_prompts",
      "🔄 RELOAD PROMPTS: Refresh all prompts from disk with hot-reloading and system refresh. Supports full server restart or graceful reload modes.",
      {
        fullServerRestart: z
          .boolean()
          .optional()
          .describe(
            "Whether to perform a full server restart after reloading prompts. Defaults to false (hot-reload only)."
          ),
        reason: z
          .string()
          .optional()
          .describe("Optional reason for reloading/restarting"),
      },
      async (
        {
          fullServerRestart,
          reason,
        }: { fullServerRestart?: boolean; reason?: string },
        extra: any
      ) => {
        const reloadReason = reason || "Manual reload requested";
        this.logger.info(
          `Reload prompts request received${
            fullServerRestart ? " with restart" : ""
          }: ${reloadReason}`
        );

        try {
          if (fullServerRestart) {
            setTimeout(() => this.onRestart(reloadReason), 1000);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Server is restarting. Reason: ${reloadReason}`,
                },
              ],
            };
          } else {
            await this.onRefresh();
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Successfully hot-reloaded all prompts.",
                },
              ],
            };
          }
        } catch (error) {
          this.logger.error("Error in reload_prompts tool:", error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to reload prompts: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }
}
