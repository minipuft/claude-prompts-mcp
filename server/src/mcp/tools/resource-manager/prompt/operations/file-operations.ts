// @lifecycle canonical - Handles prompt file read/write operations with transactional guarantees.
/**
 * File system and category management operations for YAML-based prompts.
 * Uses ResourceMutationTransaction for snapshot-based rollback on validation failure.
 */

import { existsSync, readdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { OperationResult, PromptResourceDependencies } from '../core/types.js';

import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { ToolDefinitionInput } from '../../core/types.js';

import {
  findYamlPromptInCategory,
  hasYamlPromptsInCategory,
  deleteYamlPrompt,
} from '#modules/prompts/category-maintenance.js';
import {
  ResourceMutationTransaction,
  ResourceVerificationService,
} from '#modules/resources/services/index.js';
import { safeWriteFile } from '#shared/utils/file-transactions.js';
import { serializeYaml } from '#shared/utils/yaml/yaml-parser.js';

export interface FileOperationsDependencies extends Pick<
  PromptResourceDependencies,
  'logger' | 'configManager'
> {
  resourceVerificationService?: ResourceVerificationService;
  resourceMutationTransaction?: ResourceMutationTransaction;
}

/**
 * File system operations for prompt management
 */
export class FileOperations {
  private logger: Logger;
  private configManager: ConfigManager;
  private readonly verificationService: ResourceVerificationService;
  private readonly mutationTransaction: ResourceMutationTransaction;

  constructor(dependencies: FileOperationsDependencies) {
    this.logger = dependencies.logger;
    this.configManager = dependencies.configManager;
    this.verificationService =
      dependencies.resourceVerificationService ?? new ResourceVerificationService();
    this.mutationTransaction =
      dependencies.resourceMutationTransaction ?? new ResourceMutationTransaction();
  }

  /**
   * Update prompt implementation (shared by create/update)
   * Creates YAML directory structure: {category}/{id}/prompt.yaml + message files
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
  async updatePromptImplementation(promptData: any): Promise<OperationResult> {
    const promptsDir = this.configManager.getResolvedPromptsDirectory();
    const effectiveCategory = promptData.category.toLowerCase().replace(/\s+/g, '-');
    const promptDir = path.join(promptsDir, effectiveCategory, promptData.id);
    const yamlPath = path.join(promptDir, 'prompt.yaml');

    const txResult = await this.mutationTransaction.run({
      targets: [{ path: promptDir, kind: 'directory' }],
      mutate: async () => {
        const messages: string[] = [];
        const affectedFiles: string[] = [];

        // Ensure category directory exists
        const categoryDir = path.join(promptsDir, effectiveCategory);
        if (!existsSync(categoryDir)) {
          await fs.mkdir(categoryDir, { recursive: true });
          messages.push(`Created category directory: '${effectiveCategory}'`);
        }

        // Create/update YAML prompt
        const { exists: promptExists, paths } = await this.createOrUpdateYamlPrompt(
          promptData,
          effectiveCategory,
          promptsDir
        );

        messages.push(`${promptExists ? 'Updated' : 'Created'} prompt: ${promptData.id}`);
        affectedFiles.push(...paths);

        // Scaffold chain step directories for nested sub-prompts
        if (Array.isArray(promptData.chainSteps) && promptData.chainSteps.length > 0) {
          const scaffolded = await this.scaffoldChainStepDirectories(
            promptDir,
            promptData.id,
            promptData.chainSteps
          );
          if (scaffolded.length > 0) {
            messages.push(`Scaffolded sub-prompt directories (${scaffolded.length} files)`);
            affectedFiles.push(...scaffolded);
          }
        }

        // Create/update tools if provided
        if (Array.isArray(promptData.tools) && promptData.tools.length > 0) {
          const toolResult = await this.createOrUpdateTools(
            promptDir,
            promptData.tools,
            promptData.id
          );
          messages.push(...toolResult.messages);
          affectedFiles.push(...toolResult.paths);
        }

        return { messages, affectedFiles };
      },
      validate: () => this.verificationService.validateFile('prompts', promptData.id, yamlPath),
    });

    if (!txResult.success) {
      const errorMsg = txResult.rolledBack
        ? `Prompt write failed and was rolled back: ${txResult.error}`
        : `Prompt write failed: ${txResult.error}`;
      throw new Error(errorMsg);
    }

    const result = txResult.result ?? { messages: [], affectedFiles: [] };
    return {
      message: result.messages.join('\n'),
      affectedFiles: result.affectedFiles,
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
    const promptsDir = this.configManager.getResolvedPromptsDirectory();
    const categoryDirs = this.discoverCategoryDirectories(promptsDir);

    // Find the prompt first to determine the transaction target
    let targetDir: string | null = null;
    for (const categoryDir of categoryDirs) {
      const yamlPrompt = findYamlPromptInCategory(categoryDir, id);
      if (yamlPrompt !== null) {
        targetDir =
          yamlPrompt.format === 'directory' ? yamlPrompt.path : path.dirname(yamlPrompt.path);
        break;
      }
    }

    if (targetDir === null) {
      throw new Error(`Prompt not found: ${id}`);
    }

    const txResult = await this.mutationTransaction.run({
      targets: [{ path: targetDir, kind: 'directory' }],
      mutate: async () => {
        const messages: string[] = [];
        const affectedFiles: string[] = [];
        let deletedFromCategoryDir: string | null = null;
        let deletedFromCategoryId: string | null = null;

        for (const categoryDir of categoryDirs) {
          const yamlPrompt = findYamlPromptInCategory(categoryDir, id);
          if (yamlPrompt !== null) {
            const deletedPaths = await deleteYamlPrompt(yamlPrompt);
            if (deletedPaths.length > 0) {
              const formatLabel = yamlPrompt.format === 'directory' ? 'directory' : 'file';
              messages.push(`Deleted prompt ${formatLabel}: ${yamlPrompt.id}`);
              affectedFiles.push(...deletedPaths);
              deletedFromCategoryDir = categoryDir;
              deletedFromCategoryId = path.basename(categoryDir);
              break;
            }
          }
        }

        // Clean up empty category directory
        if (deletedFromCategoryDir !== null && deletedFromCategoryId !== null) {
          const hasRemainingPrompts = hasYamlPromptsInCategory(deletedFromCategoryDir);
          if (!hasRemainingPrompts) {
            const entries = readdirSync(deletedFromCategoryDir, { withFileTypes: true });
            const nonMetadataEntries = entries.filter(
              (e) => e.name !== 'category.yaml' && !e.name.startsWith('.')
            );
            if (nonMetadataEntries.length === 0) {
              await fs.rm(deletedFromCategoryDir, { recursive: true, force: true });
              messages.push(`Cleaned up empty category directory: ${deletedFromCategoryId}`);
            }
          }
        }

        return { messages, affectedFiles };
      },
      // No validation for delete — directory gone = success
    });

    if (!txResult.success) {
      throw new Error(`Prompt deletion failed: ${txResult.error}`);
    }

    const deleteResult = txResult.result ?? { messages: [], affectedFiles: [] };
    return {
      message: deleteResult.messages.join('\n'),
      affectedFiles: deleteResult.affectedFiles,
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
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unsafe-member-access */
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
    await safeWriteFile(userMessagePath, promptData.userMessageTemplate ?? '', 'utf8');
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
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unsafe-member-access */

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
        description: tool.description ?? '',
        script: this.getScriptFilename(tool.runtime),
        runtime: tool.runtime ?? 'auto',
        timeout: tool.timeout ?? 30000,
        enabled: true,
        execution: {
          trigger: tool.trigger ?? 'schema_match',
          confirm: tool.confirm ?? false,
          strict: tool.strict ?? false,
        },
      };

      // Write tool.yaml
      const toolYamlPath = path.join(toolDir, 'tool.yaml');
      const yamlContent = serializeYaml(toolYaml, { sortKeys: false });
      await safeWriteFile(toolYamlPath, yamlContent, 'utf8');
      paths.push(toolYamlPath);

      // Write schema.json if provided
      if (tool.schema !== undefined) {
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
   * Scaffold sub-prompt directories for nested chain steps.
   *
   * Only scaffolds steps whose promptId follows the nested pattern (parentId/stepName).
   * External references (plain promptId without '/') are skipped.
   * Already-existing directories are skipped.
   *
   * Creates: {parentDir}/{stepDirName}/prompt.yaml + user-message.md
   */
  async scaffoldChainStepDirectories(
    parentDir: string,
    parentId: string,
    steps: unknown[]
  ): Promise<string[]> {
    const scaffoldedPaths: string[] = [];
    const prefix = `${parentId}/`;

    for (const rawStep of steps) {
      const step = rawStep as Record<string, unknown>;
      const promptId = step?.['promptId'];
      if (typeof promptId !== 'string' || !promptId.startsWith(prefix)) {
        continue; // External reference — skip
      }

      const stepDirName = promptId.slice(prefix.length);
      if (!stepDirName || stepDirName.includes('/')) {
        continue; // Empty or deeply nested — skip
      }

      const stepDir = path.join(parentDir, stepDirName);
      if (existsSync(stepDir)) {
        continue; // Already exists — skip
      }

      await fs.mkdir(stepDir, { recursive: true });

      const stepName = typeof step['stepName'] === 'string' ? step['stepName'] : stepDirName;
      const yamlData = {
        id: stepDirName,
        name: stepName,
        description: `Step: ${stepName}`,
        userMessageTemplateFile: 'user-message.md',
      };
      const yamlPath = path.join(stepDir, 'prompt.yaml');
      await safeWriteFile(yamlPath, serializeYaml(yamlData, { sortKeys: false }), 'utf8');
      scaffoldedPaths.push(yamlPath);

      const userMessagePath = path.join(stepDir, 'user-message.md');
      await safeWriteFile(userMessagePath, `# ${stepName}\n\nExecute this step.\n`, 'utf8');
      scaffoldedPaths.push(userMessagePath);

      this.logger.info(`Scaffolded sub-prompt directory: ${stepDirName}`);
    }

    return scaffoldedPaths;
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
}
