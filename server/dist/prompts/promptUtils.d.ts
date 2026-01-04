import { PromptData } from '../types.js';
/**
 * Resolves a prompt file path consistently across the application
 * @param promptFile The file path from the prompt data
 * @param configFilePath The path to the config file (used as reference for absolute paths)
 * @param categoryFolder The path to the category folder (used for relative paths)
 * @returns The fully resolved path to the prompt file
 */
export declare function resolvePromptFilePath(promptFile: string, configFilePath: string, categoryFolder: string): string;
/**
 * Reads a prompt file and returns its content
 * @param promptFilePath Path to the prompt file
 * @returns The content of the prompt file
 */
export declare function readPromptFile(promptFilePath: string): Promise<string>;
/**
 * Parses a prompt file content into sections
 * @param content The content of the prompt file
 * @returns An object containing the different sections of the prompt
 */
export declare function parsePromptSections(content: string): Record<string, string>;
/**
 * Modifies a specific section of a prompt markdown file
 * @param promptId Unique identifier of the prompt to modify
 * @param sectionName Name of the section to modify (e.g., "title", "description", "System Message", "User Message Template")
 * @param newContent New content for the specified section
 * @param configPath Path to the promptsConfig.json file
 * @returns Object containing the result of the operation
 */
export declare function modifyPromptSection(promptId: string, sectionName: string, newContent: string, configPath: string): Promise<{
    success: boolean;
    message: string;
    promptData?: PromptData;
    filePath?: string;
}>;
/**
 * Helper function to perform a series of file operations as a transaction
 * Automatically rolls back all changes if any operation fails
 * @param operations Array of async functions that perform file operations
 * @param rollbacks Array of async functions that undo the operations
 * @returns Result of the last operation if successful
 */
export declare function performTransactionalFileOperations<T>(operations: Array<() => Promise<any>>, rollbacks: Array<() => Promise<any>>): Promise<T>;
/**
 * Safely writes content to a file by first writing to a temp file, then renaming
 * This ensures the file is either completely written or left unchanged
 * @param filePath Path to the file
 * @param content Content to write
 * @param encoding Optional encoding (defaults to 'utf8')
 */
export declare function safeWriteFile(filePath: string, content: string, encoding?: BufferEncoding): Promise<void>;
/**
 * Finds and deletes a prompt file
 * @param promptId Unique identifier of the prompt to delete
 * @param baseDir Base directory to search in (usually the prompts directory)
 * @returns Object containing information about the deletion
 */
export declare function findAndDeletePromptFile(promptId: string, baseDir: string): Promise<{
    found: boolean;
    deleted: boolean;
    path?: string;
    error?: string;
}>;
/**
 * Checks if a prompt file exists and returns its path
 * @param promptId Unique identifier of the prompt to find
 * @param baseDir Base directory to search in (usually the prompts directory)
 * @returns Object containing information about the prompt file
 */
export declare function findPromptFile(promptId: string, baseDir: string): Promise<{
    found: boolean;
    path?: string;
    category?: string;
    error?: string;
}>;
