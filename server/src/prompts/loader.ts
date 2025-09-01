/**
 * Prompt Loader Module
 * Handles loading prompts from category-specific configuration files and markdown templates
 */

import * as fs from "fs/promises";
import { readFile } from "fs/promises";
import path from "path";
import { Logger } from "../logging/index.js";
import {
  CategoryPromptsResult,
  PromptData,
  PromptsConfigFile,
} from "../types/index.js";
import { safeWriteFile } from "./promptUtils.js";
import { CategoryManager, createCategoryManager } from "./category-manager.js";

/**
 * Prompt Loader class
 */
export class PromptLoader {
  private logger: Logger;
  private categoryManager: CategoryManager;

  constructor(logger: Logger) {
    this.logger = logger;
    this.categoryManager = createCategoryManager(logger);
  }

  /**
   * Load prompts from category-specific prompts.json files
   */
  async loadCategoryPrompts(
    configPath: string
  ): Promise<CategoryPromptsResult> {
    try {
      this.logger.info(
        `🔍 PromptLoader: Starting to load category prompts from: ${configPath}`
      );

      // Read the promptsConfig.json file
      this.logger.info("📖 Reading promptsConfig.json file...");
      const configContent = await readFile(configPath, "utf8");
      this.logger.info(
        `✓ Config file read successfully, ${configContent.length} characters`
      );

      let promptsConfig: PromptsConfigFile;

      try {
        this.logger.info("🔧 Parsing promptsConfig.json...");
        promptsConfig = JSON.parse(configContent) as PromptsConfigFile;
        this.logger.info("✓ Config file parsed successfully");
      } catch (jsonError) {
        this.logger.error(
          `❌ Error parsing config file ${configPath}:`,
          jsonError
        );
        throw new Error(
          `Invalid JSON in config file: ${
            jsonError instanceof Error ? jsonError.message : String(jsonError)
          }`
        );
      }

      // Log the parsed config structure
      this.logger.info(`📋 Config structure analysis:`);
      this.logger.info(
        `   - Categories defined: ${promptsConfig.categories?.length || 0}`
      );
      this.logger.info(
        `   - Import paths defined: ${promptsConfig.imports?.length || 0}`
      );

      if (promptsConfig.categories?.length > 0) {
        this.logger.info("📂 Categories found:");
        promptsConfig.categories.forEach((cat) => {
          this.logger.info(`   - ${cat.name} (${cat.id}): ${cat.description}`);
        });
      }

      if (promptsConfig.imports?.length > 0) {
        this.logger.info("📥 Import paths to process:");
        promptsConfig.imports.forEach((importPath, index) => {
          this.logger.info(`   ${index + 1}. ${importPath}`);
        });
      }

      // Ensure required properties exist
      if (!promptsConfig.categories) {
        this.logger.warn(
          `⚠️ Config file ${configPath} does not have a 'categories' array. Initializing it.`
        );
        promptsConfig.categories = [];
      }

      if (!promptsConfig.imports || !Array.isArray(promptsConfig.imports)) {
        this.logger.warn(
          `⚠️ Config file ${configPath} does not have a valid 'imports' array. Initializing it.`
        );
        promptsConfig.imports = [];
      }

      // Load and validate categories using CategoryManager
      const categoryValidation = await this.categoryManager.loadCategories(promptsConfig.categories);
      
      if (!categoryValidation.isValid) {
        this.logger.error("❌ Category validation failed:");
        categoryValidation.issues.forEach(issue => this.logger.error(`  - ${issue}`));
        throw new Error(`Category validation failed: ${categoryValidation.issues.join('; ')}`);
      }

      if (categoryValidation.warnings.length > 0) {
        this.logger.warn("⚠️ Category validation warnings:");
        categoryValidation.warnings.forEach(warning => this.logger.warn(`  - ${warning}`));
      }

      // Get validated categories
      const categories = this.categoryManager.getCategories();

      // Initialize an array to store all prompts
      let allPrompts: PromptData[] = [];
      let totalImportProcessed = 0;
      let totalImportsFailed = 0;

      this.logger.info(
        `🚀 Starting to process ${promptsConfig.imports.length} import paths...`
      );

      // Load prompts from each import path
      for (const importPath of promptsConfig.imports) {
        totalImportProcessed++;
        this.logger.info(
          `\n📦 Processing import ${totalImportProcessed}/${promptsConfig.imports.length}: ${importPath}`
        );

        try {
          // Construct the full path to the import file
          const fullImportPath = path.join(
            path.dirname(configPath),
            importPath
          );

          this.logger.info(`   🔍 Full path: ${fullImportPath}`);

          // Check if the file exists
          try {
            await fs.access(fullImportPath);
            this.logger.info(`   ✓ Import file exists`);
          } catch (error) {
            this.logger.warn(
              `   ⚠️ Import file not found: ${importPath}. Creating empty file.`
            );

            // Create the directory if it doesn't exist
            const dir = path.dirname(fullImportPath);
            await fs.mkdir(dir, { recursive: true });

            // Create an empty prompts file
            await safeWriteFile(
              fullImportPath,
              JSON.stringify({ prompts: [] }, null, 2),
              "utf8"
            );
            this.logger.info(`   ✓ Created empty prompts file`);
          }

          // Read the file
          this.logger.info(`   📖 Reading import file...`);
          const fileContent = await readFile(fullImportPath, "utf8");
          this.logger.info(
            `   ✓ File read successfully, ${fileContent.length} characters`
          );

          let categoryPromptsFile: any;

          try {
            categoryPromptsFile = JSON.parse(fileContent);
            this.logger.info(`   ✓ Import file parsed successfully`);
          } catch (jsonError) {
            this.logger.error(
              `   ❌ Error parsing import file ${importPath}:`,
              jsonError
            );
            this.logger.info(
              `   🔧 Creating empty prompts file for ${importPath} due to parsing error.`
            );
            categoryPromptsFile = { prompts: [] };
            await safeWriteFile(
              fullImportPath,
              JSON.stringify(categoryPromptsFile, null, 2),
              "utf8"
            );
          }

          // Ensure prompts property exists and is an array
          if (!categoryPromptsFile.prompts) {
            this.logger.warn(
              `   ⚠️ Import file ${importPath} does not have a 'prompts' array. Initializing it.`
            );
            categoryPromptsFile.prompts = [];
            await safeWriteFile(
              fullImportPath,
              JSON.stringify(categoryPromptsFile, null, 2),
              "utf8"
            );
          } else if (!Array.isArray(categoryPromptsFile.prompts)) {
            this.logger.warn(
              `   ⚠️ Import file ${importPath} has an invalid 'prompts' property (not an array). Resetting it.`
            );
            categoryPromptsFile.prompts = [];
            await safeWriteFile(
              fullImportPath,
              JSON.stringify(categoryPromptsFile, null, 2),
              "utf8"
            );
          }

          this.logger.info(
            `   📊 Found ${categoryPromptsFile.prompts.length} prompts in this import`
          );

          // Update the file path to be relative to the category folder
          const categoryPath = path.dirname(importPath);
          const beforeCount = categoryPromptsFile.prompts.length;

          const categoryPrompts = categoryPromptsFile.prompts
            .map((prompt: PromptData, index: number) => {
              // Ensure prompt has all required properties
              if (!prompt.id || !prompt.name || !prompt.file) {
                this.logger.warn(
                  `   ⚠️ Skipping invalid prompt ${
                    index + 1
                  } in ${importPath}: missing required properties (id: ${!!prompt.id}, name: ${!!prompt.name}, file: ${!!prompt.file})`
                );
                return null;
              }

              // If the file path is already absolute or starts with the category folder, keep it as is
              if (
                prompt.file.startsWith("/") ||
                prompt.file.startsWith(categoryPath)
              ) {
                return prompt;
              }

              // Otherwise, update the file path to include the category folder
              return {
                ...prompt,
                file: path.join(categoryPath, prompt.file),
              };
            })
            .filter(Boolean); // Remove any null entries (invalid prompts)

          const afterCount = categoryPrompts.length;
          if (beforeCount !== afterCount) {
            this.logger.warn(
              `   ⚠️ ${
                beforeCount - afterCount
              } prompts were filtered out due to validation issues`
            );
          }

          this.logger.info(
            `   ✅ Successfully processed ${afterCount} valid prompts from ${importPath}`
          );

          // Add the prompts to the array
          allPrompts = [...allPrompts, ...categoryPrompts];
        } catch (error) {
          totalImportsFailed++;
          this.logger.error(
            `   ❌ Error loading prompts from ${importPath}:`,
            error
          );
        }
      }

      this.logger.info(`\n🎯 IMPORT PROCESSING SUMMARY:`);
      this.logger.info(`   Total imports processed: ${totalImportProcessed}`);
      this.logger.info(`   Imports failed: ${totalImportsFailed}`);
      this.logger.info(
        `   Imports succeeded: ${totalImportProcessed - totalImportsFailed}`
      );
      this.logger.info(`   Total prompts collected: ${allPrompts.length}`);
      this.logger.info(`   Categories available: ${categories.length}`);

      // Validate category-prompt relationships using CategoryManager
      this.logger.info(`🔍 Validating category-prompt relationships...`);
      const promptCategoryValidation = this.categoryManager.validatePromptCategories(allPrompts);
      
      if (!promptCategoryValidation.isValid) {
        this.logger.error("❌ Category-prompt relationship validation failed:");
        promptCategoryValidation.issues.forEach(issue => this.logger.error(`  - ${issue}`));
        this.logger.warn("Continuing with loading but some prompts may not display correctly");
      }

      if (promptCategoryValidation.warnings.length > 0) {
        this.logger.warn("⚠️ Category-prompt relationship warnings:");
        promptCategoryValidation.warnings.forEach(warning => this.logger.warn(`  - ${warning}`));
      }

      // Generate category statistics for debugging
      const categoryStats = this.categoryManager.getCategoryStatistics(allPrompts);
      this.logger.info(`📊 Category Statistics:`);
      this.logger.info(`   Categories with prompts: ${categoryStats.categoriesWithPrompts}/${categoryStats.totalCategories}`);
      this.logger.info(`   Empty categories: ${categoryStats.emptyCategoriesCount}`);
      this.logger.info(`   Average prompts per category: ${categoryStats.averagePromptsPerCategory.toFixed(1)}`);

      const result = { promptsData: allPrompts, categories };
      this.logger.info(
        `✅ PromptLoader.loadCategoryPrompts() completed successfully`
      );

      return result;
    } catch (error) {
      this.logger.error(`❌ PromptLoader.loadCategoryPrompts() FAILED:`, error);
      throw error;
    }
  }

  /**
   * Get the CategoryManager instance for external access
   */
  getCategoryManager(): CategoryManager {
    return this.categoryManager;
  }

  /**
   * Load prompt content from markdown file
   */
  async loadPromptFile(
    filePath: string,
    basePath: string
  ): Promise<{
    systemMessage?: string;
    userMessageTemplate: string;
    isChain?: boolean;
    chainSteps?: Array<{
      promptId: string;
      stepName: string;
      inputMapping?: Record<string, string>;
      outputMapping?: Record<string, string>;
    }>;
  }> {
    try {
      const fullPath = path.join(basePath, filePath);
      const content = await readFile(fullPath, "utf8");

      // Extract system message and user message template from markdown
      const systemMessageMatch = content.match(
        /## System Message\s*\n([\s\S]*?)(?=\n##|$)/
      );
      const userMessageMatch = content.match(
        /## User Message Template\s*\n([\s\S]*)$/
      );

      const systemMessage = systemMessageMatch
        ? systemMessageMatch[1].trim()
        : undefined;
      const userMessageTemplate = userMessageMatch
        ? userMessageMatch[1].trim()
        : "";

      // Extract chain information if present
      const chainMatch = content.match(
        /## Chain Steps\s*\n([\s\S]*?)(?=\n##|$)/
      );
      let isChain = false;
      let chainSteps: Array<{
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string>;
        outputMapping?: Record<string, string>;
      }> = [];

      if (chainMatch) {
        isChain = true;
        const chainContent = chainMatch[1].trim();
        // Updated regex to match the current markdown format
        const stepMatches = chainContent.matchAll(
          /(\d+)\.\s*promptId:\s*([^\n]+)\s*\n\s*stepName:\s*([^\n]+)(?:\s*\n\s*inputMapping:\s*([\s\S]*?)(?=\s*\n\s*(?:outputMapping|promptId|\d+\.|$)))?\s*(?:\n\s*outputMapping:\s*([\s\S]*?)(?=\s*\n\s*(?:promptId|\d+\.|$)))?\s*/g
        );

        for (const match of stepMatches) {
          const [
            _,
            stepNumber,
            promptId,
            stepName,
            inputMappingStr,
            outputMappingStr,
          ] = match;

          const step: {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string>;
            outputMapping?: Record<string, string>;
          } = {
            promptId: promptId.trim(),
            stepName: stepName.trim(),
          };

          if (inputMappingStr) {
            try {
              // Parse YAML-style mapping into JSON object
              const inputMapping: Record<string, string> = {};
              const lines = inputMappingStr.trim().split("\n");
              for (const line of lines) {
                const [key, value] = line
                  .trim()
                  .split(":")
                  .map((s) => s.trim());
                if (key && value) {
                  inputMapping[key] = value;
                }
              }
              step.inputMapping = inputMapping;
            } catch (e) {
              this.logger.warn(
                `Invalid input mapping in chain step ${stepNumber} of ${filePath}: ${e}`
              );
            }
          }

          if (outputMappingStr) {
            try {
              // Parse YAML-style mapping into JSON object
              const outputMapping: Record<string, string> = {};
              const lines = outputMappingStr.trim().split("\n");
              for (const line of lines) {
                const [key, value] = line
                  .trim()
                  .split(":")
                  .map((s) => s.trim());
                if (key && value) {
                  outputMapping[key] = value;
                }
              }
              step.outputMapping = outputMapping;
            } catch (e) {
              this.logger.warn(
                `Invalid output mapping in chain step ${stepNumber} of ${filePath}: ${e}`
              );
            }
          }

          chainSteps.push(step);
        }

        this.logger.debug(
          `Loaded chain with ${chainSteps.length} steps from ${filePath}`
        );
      }

      if (!userMessageTemplate && !isChain) {
        throw new Error(`No user message template found in ${filePath}`);
      }

      return { systemMessage, userMessageTemplate, isChain, chainSteps };
    } catch (error) {
      this.logger.error(`Error loading prompt file ${filePath}:`, error);
      throw error;
    }
  }
}
