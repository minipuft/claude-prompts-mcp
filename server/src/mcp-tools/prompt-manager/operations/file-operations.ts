/**
 * File system and category management operations
 */

import * as fs from "fs/promises";
import { readFile } from "fs/promises";
import path from "path";
import { Logger } from "../../../logging/index.js";
import { ConfigManager } from "../../../config/index.js";
import { PromptData, PromptsConfigFile } from "../../../types/index.js";
import { safeWriteFile } from "../../../prompts/promptUtils.js";
import {
  OperationResult,
  CategoryResult,
  FileOperationResult,
  PromptManagerDependencies
} from "../core/types.js";
import { CategoryManager } from "../utils/category-manager.js";

/**
 * File system operations for prompt management
 */
export class FileOperations {
  private logger: Logger;
  private configManager: ConfigManager;
  private categoryManager: CategoryManager;

  constructor(dependencies: Pick<PromptManagerDependencies, 'logger' | 'configManager'>) {
    this.logger = dependencies.logger;
    this.configManager = dependencies.configManager;
    this.categoryManager = new CategoryManager(this.logger);
  }

  /**
   * Update prompt implementation (shared by create/update)
   */
  async updatePromptImplementation(promptData: any): Promise<OperationResult> {
    const PROMPTS_FILE = this.configManager.getPromptsFilePath();
    const messages: string[] = [];

    const fileContent = await readFile(PROMPTS_FILE, "utf8");
    const promptsConfig = JSON.parse(fileContent) as PromptsConfigFile;

    if (!promptsConfig.categories) promptsConfig.categories = [];
    if (!promptsConfig.imports) promptsConfig.imports = [];

    // Ensure category exists
    const { effectiveCategory, created: categoryCreated } =
      await this.categoryManager.ensureCategoryExists(promptData.category, promptsConfig, PROMPTS_FILE);

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

    return {
      message: messages.join('\n'),
      affectedFiles: [`${promptData.id}.md`]
    };
  }

  /**
   * Delete prompt implementation
   */
  async deletePromptImplementation(id: string): Promise<OperationResult> {
    const PROMPTS_FILE = this.configManager.getPromptsFilePath();
    const promptsConfigDir = path.dirname(PROMPTS_FILE);
    const messages: string[] = [];
    const affectedFiles: string[] = [];

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
            affectedFiles.push(promptEntry.file);
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
            const cleanupResult = await this.categoryManager.cleanupEmptyCategory(categoryImport, promptsConfig, PROMPTS_FILE);
            messages.push(`🧹 **Automatic Category Cleanup**:\n${cleanupResult.message}`);
          }

          break;
        }
      } catch (error) {
        this.logger.warn(`Could not process category file: ${categoryPath}`, error);
      }
    }

    if (!promptFound) {
      throw new Error(`Prompt not found: ${id}`);
    }

    return {
      message: messages.join('\n'),
      affectedFiles
    };
  }

  /**
   * Create or update prompt file
   */
  async createOrUpdatePromptFile(
    promptData: any,
    effectiveCategory: string,
    promptsFile: string
  ): Promise<FileOperationResult> {
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

    return {
      exists: existsBefore,
      path: promptPath
    };
  }

  /**
   * Ensure category exists in the configuration
   */
  async ensureCategoryExists(
    category: string,
    promptsConfig: PromptsConfigFile,
    promptsFile: string
  ): Promise<CategoryResult> {
    return this.categoryManager.ensureCategoryExists(category, promptsConfig, promptsFile);
  }

  /**
   * Clean up empty category
   */
  async cleanupEmptyCategory(
    categoryImport: string,
    promptsConfig: PromptsConfigFile,
    promptsFile: string
  ): Promise<OperationResult> {
    return this.categoryManager.cleanupEmptyCategory(categoryImport, promptsConfig, promptsFile);
  }

  /**
   * Validate file system state
   */
  async validateFileSystemState(): Promise<{
    valid: boolean;
    issues: string[];
    stats: Record<string, number>;
  }> {
    const issues: string[] = [];
    const PROMPTS_FILE = this.configManager.getPromptsFilePath();

    try {
      // Check main config file
      const fileContent = await readFile(PROMPTS_FILE, "utf8");
      const promptsConfig = JSON.parse(fileContent) as PromptsConfigFile;

      // Validate categories and imports
      const stats = await this.categoryManager.getCategoryStats(promptsConfig.imports || [], PROMPTS_FILE);

      // Check each category structure
      for (const categoryImport of promptsConfig.imports || []) {
        const validation = await this.categoryManager.validateCategoryStructure(categoryImport, PROMPTS_FILE);
        if (!validation.valid) {
          issues.push(`Category ${categoryImport}: ${validation.issues.join(', ')}`);
        }
      }

      return {
        valid: issues.length === 0,
        issues,
        stats
      };

    } catch (error) {
      issues.push(`Failed to validate file system: ${error instanceof Error ? error.message : String(error)}`);
      return {
        valid: false,
        issues,
        stats: {}
      };
    }
  }

  /**
   * Backup prompt files
   */
  async backupPrompts(): Promise<{
    backupPath: string;
    fileCount: number;
  }> {
    const PROMPTS_FILE = this.configManager.getPromptsFilePath();
    const promptsDir = path.dirname(PROMPTS_FILE);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(promptsDir, `backup-${timestamp}`);

    await fs.mkdir(backupDir, { recursive: true });

    // Copy main config
    await fs.copyFile(PROMPTS_FILE, path.join(backupDir, 'promptsConfig.json'));
    let fileCount = 1;

    // Copy all categories and their prompts
    const fileContent = await readFile(PROMPTS_FILE, "utf8");
    const promptsConfig = JSON.parse(fileContent) as PromptsConfigFile;

    for (const categoryImport of promptsConfig.imports || []) {
      const sourcePath = path.join(promptsDir, categoryImport);
      const targetPath = path.join(backupDir, categoryImport);

      // Create category directory in backup
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      try {
        // Copy category config
        await fs.copyFile(sourcePath, targetPath);
        fileCount++;

        // Copy all markdown files in category
        const categoryDir = path.dirname(sourcePath);
        const files = await fs.readdir(categoryDir);

        for (const file of files) {
          if (file.endsWith('.md')) {
            const sourceFile = path.join(categoryDir, file);
            const targetFile = path.join(path.dirname(targetPath), file);
            await fs.copyFile(sourceFile, targetFile);
            fileCount++;
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to backup category ${categoryImport}:`, error);
      }
    }

    this.logger.info(`Created backup with ${fileCount} files at ${backupDir}`);

    return {
      backupPath: backupDir,
      fileCount
    };
  }

  /**
   * Get file system statistics
   */
  async getFileSystemStats(): Promise<{
    totalCategories: number;
    totalPrompts: number;
    totalFiles: number;
    diskUsage: number;
  }> {
    const PROMPTS_FILE = this.configManager.getPromptsFilePath();
    const promptsDir = path.dirname(PROMPTS_FILE);

    let totalCategories = 0;
    let totalPrompts = 0;
    let totalFiles = 0;
    let diskUsage = 0;

    try {
      const fileContent = await readFile(PROMPTS_FILE, "utf8");
      const promptsConfig = JSON.parse(fileContent) as PromptsConfigFile;

      totalCategories = promptsConfig.categories?.length || 0;

      const stats = await this.categoryManager.getCategoryStats(promptsConfig.imports || [], PROMPTS_FILE);
      totalPrompts = Object.values(stats).reduce((sum, count) => sum + count, 0);

      // Count files and calculate disk usage
      const calculateDirSize = async (dirPath: string): Promise<{ files: number; size: number }> => {
        let files = 0;
        let size = 0;

        try {
          const items = await fs.readdir(dirPath, { withFileTypes: true });

          for (const item of items) {
            const itemPath = path.join(dirPath, item.name);

            if (item.isDirectory()) {
              const subResult = await calculateDirSize(itemPath);
              files += subResult.files;
              size += subResult.size;
            } else {
              files++;
              const stat = await fs.stat(itemPath);
              size += stat.size;
            }
          }
        } catch (error) {
          // Ignore errors for inaccessible directories
        }

        return { files, size };
      };

      const dirStats = await calculateDirSize(promptsDir);
      totalFiles = dirStats.files;
      diskUsage = dirStats.size;

    } catch (error) {
      this.logger.warn('Failed to calculate file system stats:', error);
    }

    return {
      totalCategories,
      totalPrompts,
      totalFiles,
      diskUsage
    };
  }
}