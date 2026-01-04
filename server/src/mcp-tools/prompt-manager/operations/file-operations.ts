// @lifecycle canonical - Handles prompt file read/write operations.
/**
 * File system and category management operations for YAML-based prompts
 */

import { existsSync, readdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { ConfigManager } from '../../../config/index.js';
import { Logger } from '../../../logging/index.js';
import {
  discoverYamlPromptsInCategory,
  findYamlPromptInCategory,
  hasYamlPromptsInCategory,
  deleteYamlPrompt,
} from '../../../prompts/category-maintenance.js';
import { safeWriteFile } from '../../../prompts/promptUtils.js';
import { serializeYaml } from '../../../utils/yaml/yaml-parser.js';
import { OperationResult, FileOperationResult, PromptManagerDependencies } from '../core/types.js';

import type { ToolDefinitionInput } from '../../resource-manager/core/types.js';

/**
 * File system operations for prompt management
 */
export class FileOperations {
  private logger: Logger;
  private configManager: ConfigManager;

  constructor(dependencies: Pick<PromptManagerDependencies, 'logger' | 'configManager'>) {
    this.logger = dependencies.logger;
    this.configManager = dependencies.configManager;
  }

  /**
   * Update prompt implementation (shared by create/update)
   * Creates YAML directory structure: {category}/{id}/prompt.yaml + message files
   */
  async updatePromptImplementation(promptData: any): Promise<OperationResult> {
    // Use resolved path that respects MCP_RESOURCES_PATH for user data persistence
    const promptsDir = this.configManager.getResolvedPromptsFilePath();
    const messages: string[] = [];
    const affectedFiles: string[] = [];

    // Normalize category ID (lowercase, hyphenated)
    const effectiveCategory = promptData.category.toLowerCase().replace(/\s+/g, '-');
    const categoryDir = path.join(promptsDir, effectiveCategory);

    // Ensure category directory exists
    if (!existsSync(categoryDir)) {
      await fs.mkdir(categoryDir, { recursive: true });
      messages.push(`✅ Created category directory: '${effectiveCategory}'`);
    }

    // Create/update YAML prompt
    const { exists: promptExists, paths } = await this.createOrUpdateYamlPrompt(
      promptData,
      effectiveCategory,
      promptsDir
    );

    messages.push(`✅ ${promptExists ? 'Updated' : 'Created'} prompt: ${promptData.id}`);
    affectedFiles.push(...paths);

    // Create/update tools if provided
    if (promptData.tools && promptData.tools.length > 0) {
      const promptDir = path.join(promptsDir, effectiveCategory, promptData.id);
      const toolResult = await this.createOrUpdateTools(promptDir, promptData.tools, promptData.id);
      messages.push(...toolResult.messages);
      affectedFiles.push(...toolResult.paths);
    }

    return {
      message: messages.join('\n'),
      affectedFiles,
    };
  }

  /**
   * Delete prompt implementation (YAML-only)
   *
   * Searches for YAML-format prompts in all category directories:
   * - Directory format: {category}/{id}/ (deleted recursively)
   * - File format: {category}/{id}.yaml (deleted as single file)
   *
   * Automatically cleans up empty category directories.
   */
  async deletePromptImplementation(id: string): Promise<OperationResult> {
    // Use resolved path that respects MCP_RESOURCES_PATH for user data persistence
    const promptsDir = this.configManager.getResolvedPromptsFilePath();
    const messages: string[] = [];
    const affectedFiles: string[] = [];

    let promptFound = false;
    let deletedFromCategoryDir: string | null = null;
    let deletedFromCategoryId: string | null = null;

    // Discover all category directories
    const categoryDirs = this.discoverCategoryDirectories(promptsDir);

    // Search for the prompt in each category
    for (const categoryDir of categoryDirs) {
      const yamlPrompt = findYamlPromptInCategory(categoryDir, id);

      if (yamlPrompt) {
        const deletedPaths = await deleteYamlPrompt(yamlPrompt);
        if (deletedPaths.length > 0) {
          const formatLabel = yamlPrompt.format === 'directory' ? 'directory' : 'file';
          messages.push(`✅ Deleted prompt ${formatLabel}: ${yamlPrompt.id}`);
          affectedFiles.push(...deletedPaths);
          promptFound = true;
          deletedFromCategoryDir = categoryDir;
          deletedFromCategoryId = path.basename(categoryDir);
          break;
        }
      }
    }

    if (!promptFound) {
      throw new Error(`Prompt not found: ${id}`);
    }

    // Check if category is now empty (no YAML prompts remaining)
    if (deletedFromCategoryDir && deletedFromCategoryId) {
      const hasRemainingPrompts = hasYamlPromptsInCategory(deletedFromCategoryDir);

      if (!hasRemainingPrompts) {
        // Clean up empty category directory (but preserve category.yaml if exists)
        const entries = readdirSync(deletedFromCategoryDir, { withFileTypes: true });
        const nonMetadataEntries = entries.filter(
          (e) => e.name !== 'category.yaml' && !e.name.startsWith('.')
        );

        if (nonMetadataEntries.length === 0) {
          try {
            await fs.rm(deletedFromCategoryDir, { recursive: true, force: true });
            messages.push(`🧹 Cleaned up empty category directory: ${deletedFromCategoryId}`);
            this.logger.info(`Deleted empty category directory: ${deletedFromCategoryId}`);
          } catch (rmError: any) {
            messages.push(`⚠️ Could not remove empty category: ${rmError.message}`);
          }
        }
      } else {
        this.logger.debug(`Category ${deletedFromCategoryId} still has prompts, keeping directory`);
      }
    }

    return {
      message: messages.join('\n'),
      affectedFiles,
    };
  }

  /**
   * Discover category directories in the prompts folder
   */
  private discoverCategoryDirectories(promptsDir: string): string[] {
    if (!existsSync(promptsDir)) {
      return [];
    }

    try {
      const entries = readdirSync(promptsDir, { withFileTypes: true });
      return entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            !entry.name.startsWith('_') &&
            entry.name !== 'backup'
        )
        .map((entry) => path.join(promptsDir, entry.name));
    } catch {
      return [];
    }
  }

  /**
   * Create or update YAML prompt directory structure
   *
   * Creates/updates:
   * - {category}/{id}/prompt.yaml - Metadata (id, name, category, description, arguments, gates)
   * - {category}/{id}/user-message.md - User message template (required)
   * - {category}/{id}/system-message.md - System message (optional)
   */
  async createOrUpdateYamlPrompt(
    promptData: any,
    effectiveCategory: string,
    promptsDir: string
  ): Promise<{ exists: boolean; paths: string[] }> {
    const promptDir = path.join(promptsDir, effectiveCategory, promptData.id);
    const paths: string[] = [];

    // Check if prompt directory already exists
    const existsBefore = existsSync(promptDir);

    // Create prompt directory
    await fs.mkdir(promptDir, { recursive: true });
    paths.push(promptDir);

    // Build prompt.yaml metadata
    const promptYamlData: Record<string, unknown> = {
      id: promptData.id,
      name: promptData.name,
      category: effectiveCategory,
      description: promptData.description,
    };

    // Add optional fields
    if (promptData.systemMessage) {
      promptYamlData['systemMessageFile'] = 'system-message.md';
    }
    promptYamlData['userMessageTemplateFile'] = 'user-message.md';

    // Add arguments if present
    if (promptData.arguments && promptData.arguments.length > 0) {
      promptYamlData['arguments'] = promptData.arguments;
    }

    // Add gate configuration if present
    if (promptData.gateConfiguration) {
      promptYamlData['gateConfiguration'] = promptData.gateConfiguration;
      this.logger.debug(`[YAML-CREATE] Adding gate configuration to ${promptData.id}`);
    }

    // Add chain steps if present (for chain prompts)
    if (promptData.chainSteps && promptData.chainSteps.length > 0) {
      promptYamlData['chainSteps'] = promptData.chainSteps;
    }

    // Add tools reference if present (just tool IDs, not full definitions)
    if (promptData.tools && promptData.tools.length > 0) {
      promptYamlData['tools'] = promptData.tools.map((t: ToolDefinitionInput) => t.id);
    }

    // Write prompt.yaml
    const promptYamlPath = path.join(promptDir, 'prompt.yaml');
    const yamlContent = serializeYaml(promptYamlData, { sortKeys: false });
    await safeWriteFile(promptYamlPath, yamlContent, 'utf8');
    paths.push(promptYamlPath);

    // Write user-message.md (required)
    const userMessagePath = path.join(promptDir, 'user-message.md');
    await safeWriteFile(userMessagePath, promptData.userMessageTemplate || '', 'utf8');
    paths.push(userMessagePath);

    // Write system-message.md (optional)
    if (promptData.systemMessage) {
      const systemMessagePath = path.join(promptDir, 'system-message.md');
      await safeWriteFile(systemMessagePath, promptData.systemMessage, 'utf8');
      paths.push(systemMessagePath);
    }

    this.logger.info(`${existsBefore ? 'Updated' : 'Created'} YAML prompt: ${promptData.id}`);

    return {
      exists: existsBefore,
      paths,
    };
  }

  /**
   * Create or update script tools for a prompt
   *
   * Creates:
   * - {promptDir}/tools/{toolId}/tool.yaml - Tool configuration
   * - {promptDir}/tools/{toolId}/schema.json - Input schema (if provided)
   * - {promptDir}/tools/{toolId}/script.{ext} - Script file
   */
  async createOrUpdateTools(
    promptDir: string,
    tools: ToolDefinitionInput[],
    promptId: string
  ): Promise<{ messages: string[]; paths: string[] }> {
    const messages: string[] = [];
    const paths: string[] = [];

    const toolsDir = path.join(promptDir, 'tools');

    for (const tool of tools) {
      const toolDir = path.join(toolsDir, tool.id);

      // Create tool directory
      await fs.mkdir(toolDir, { recursive: true });
      paths.push(toolDir);

      // Build tool.yaml configuration
      const toolYaml: Record<string, unknown> = {
        id: tool.id,
        name: tool.name,
        description: tool.description || '',
        script: this.getScriptFilename(tool.runtime),
        runtime: tool.runtime || 'auto',
        timeout: tool.timeout || 30000,
        enabled: true,
        execution: {
          trigger: tool.trigger || 'schema_match',
          confirm: tool.confirm || false,
          strict: tool.strict || false,
        },
      };

      // Write tool.yaml
      const toolYamlPath = path.join(toolDir, 'tool.yaml');
      const yamlContent = serializeYaml(toolYaml, { sortKeys: false });
      await safeWriteFile(toolYamlPath, yamlContent, 'utf8');
      paths.push(toolYamlPath);

      // Write schema.json if provided
      if (tool.schema) {
        const schemaPath = path.join(toolDir, 'schema.json');
        const schemaContent = JSON.stringify(tool.schema, null, 2);
        await safeWriteFile(schemaPath, schemaContent, 'utf8');
        paths.push(schemaPath);
      }

      // Write script file
      const scriptFilename = this.getScriptFilename(tool.runtime);
      const scriptPath = path.join(toolDir, scriptFilename);
      await safeWriteFile(scriptPath, tool.script, 'utf8');
      paths.push(scriptPath);

      messages.push(`✅ Created tool '${tool.id}' in ${toolDir}`);
      this.logger.info(`Created script tool '${tool.id}' for prompt '${promptId}'`);
    }

    return { messages, paths };
  }

  /**
   * Get script filename based on runtime
   */
  private getScriptFilename(runtime?: string): string {
    switch (runtime) {
      case 'python':
        return 'script.py';
      case 'node':
        return 'script.js';
      case 'shell':
        return 'script.sh';
      default:
        return 'script.py'; // Default to Python
    }
  }

  /**
   * Validate file system state (YAML-based)
   */
  async validateFileSystemState(): Promise<{
    valid: boolean;
    issues: string[];
    stats: Record<string, number>;
  }> {
    const issues: string[] = [];
    const stats: Record<string, number> = {};
    // Use resolved path that respects MCP_RESOURCES_PATH
    const promptsDir = this.configManager.getResolvedPromptsFilePath();

    try {
      const categoryDirs = this.discoverCategoryDirectories(promptsDir);

      for (const categoryDir of categoryDirs) {
        const categoryId = path.basename(categoryDir);
        const prompts = discoverYamlPromptsInCategory(categoryDir);
        stats[categoryId] = prompts.length;

        // Validate each YAML prompt
        for (const prompt of prompts) {
          const promptYamlPath =
            prompt.format === 'directory' ? path.join(prompt.path, 'prompt.yaml') : prompt.path;

          try {
            await fs.access(promptYamlPath);
          } catch {
            issues.push(`Category ${categoryId}: Missing prompt.yaml for ${prompt.id}`);
          }
        }
      }

      return {
        valid: issues.length === 0,
        issues,
        stats,
      };
    } catch (error) {
      issues.push(
        `Failed to validate file system: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        valid: false,
        issues,
        stats: {},
      };
    }
  }

  /**
   * Backup prompt files (YAML-based)
   */
  async backupPrompts(): Promise<{
    backupPath: string;
    fileCount: number;
  }> {
    // Use resolved path that respects MCP_RESOURCES_PATH
    const promptsDir = this.configManager.getResolvedPromptsFilePath();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(promptsDir, `backup-${timestamp}`);

    await fs.mkdir(backupDir, { recursive: true });
    let fileCount = 0;

    // Recursively copy all category directories
    const copyDir = async (src: string, dest: string): Promise<number> => {
      let count = 0;
      await fs.mkdir(dest, { recursive: true });

      const entries = await fs.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory() && entry.name !== 'backup' && !entry.name.startsWith('backup-')) {
          count += await copyDir(srcPath, destPath);
        } else if (entry.isFile()) {
          await fs.copyFile(srcPath, destPath);
          count++;
        }
      }
      return count;
    };

    const categoryDirs = this.discoverCategoryDirectories(promptsDir);
    for (const categoryDir of categoryDirs) {
      const categoryId = path.basename(categoryDir);
      const destDir = path.join(backupDir, categoryId);
      fileCount += await copyDir(categoryDir, destDir);
    }

    this.logger.info(`Created backup with ${fileCount} files at ${backupDir}`);

    return {
      backupPath: backupDir,
      fileCount,
    };
  }

  /**
   * Get file system statistics (YAML-based)
   */
  async getFileSystemStats(): Promise<{
    totalCategories: number;
    totalPrompts: number;
    totalFiles: number;
    diskUsage: number;
  }> {
    // Use resolved path that respects MCP_RESOURCES_PATH
    const promptsDir = this.configManager.getResolvedPromptsFilePath();

    let totalCategories = 0;
    let totalPrompts = 0;
    let totalFiles = 0;
    let diskUsage = 0;

    try {
      const categoryDirs = this.discoverCategoryDirectories(promptsDir);
      totalCategories = categoryDirs.length;

      for (const categoryDir of categoryDirs) {
        const prompts = discoverYamlPromptsInCategory(categoryDir);
        totalPrompts += prompts.length;
      }

      // Count files and calculate disk usage
      const calculateDirSize = async (
        dirPath: string
      ): Promise<{ files: number; size: number }> => {
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
        } catch {
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
      diskUsage,
    };
  }
}
