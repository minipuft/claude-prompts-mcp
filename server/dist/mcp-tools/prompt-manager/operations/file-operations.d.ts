/**
 * File system and category management operations for YAML-based prompts
 */
import { OperationResult, PromptManagerDependencies } from '../core/types.js';
import type { ToolDefinitionInput } from '../../resource-manager/core/types.js';
/**
 * File system operations for prompt management
 */
export declare class FileOperations {
    private logger;
    private configManager;
    constructor(dependencies: Pick<PromptManagerDependencies, 'logger' | 'configManager'>);
    /**
     * Update prompt implementation (shared by create/update)
     * Creates YAML directory structure: {category}/{id}/prompt.yaml + message files
     */
    updatePromptImplementation(promptData: any): Promise<OperationResult>;
    /**
     * Delete prompt implementation (YAML-only)
     *
     * Searches for YAML-format prompts in all category directories:
     * - Directory format: {category}/{id}/ (deleted recursively)
     * - File format: {category}/{id}.yaml (deleted as single file)
     *
     * Automatically cleans up empty category directories.
     */
    deletePromptImplementation(id: string): Promise<OperationResult>;
    /**
     * Discover category directories in the prompts folder
     */
    private discoverCategoryDirectories;
    /**
     * Create or update YAML prompt directory structure
     *
     * Creates/updates:
     * - {category}/{id}/prompt.yaml - Metadata (id, name, category, description, arguments, gates)
     * - {category}/{id}/user-message.md - User message template (required)
     * - {category}/{id}/system-message.md - System message (optional)
     */
    createOrUpdateYamlPrompt(promptData: any, effectiveCategory: string, promptsDir: string): Promise<{
        exists: boolean;
        paths: string[];
    }>;
    /**
     * Create or update script tools for a prompt
     *
     * Creates:
     * - {promptDir}/tools/{toolId}/tool.yaml - Tool configuration
     * - {promptDir}/tools/{toolId}/schema.json - Input schema (if provided)
     * - {promptDir}/tools/{toolId}/script.{ext} - Script file
     */
    createOrUpdateTools(promptDir: string, tools: ToolDefinitionInput[], promptId: string): Promise<{
        messages: string[];
        paths: string[];
    }>;
    /**
     * Get script filename based on runtime
     */
    private getScriptFilename;
    /**
     * Validate file system state (YAML-based)
     */
    validateFileSystemState(): Promise<{
        valid: boolean;
        issues: string[];
        stats: Record<string, number>;
    }>;
    /**
     * Backup prompt files (YAML-based)
     */
    backupPrompts(): Promise<{
        backupPath: string;
        fileCount: number;
    }>;
    /**
     * Get file system statistics (YAML-based)
     */
    getFileSystemStats(): Promise<{
        totalCategories: number;
        totalPrompts: number;
        totalFiles: number;
        diskUsage: number;
    }>;
}
