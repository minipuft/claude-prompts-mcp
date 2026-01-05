// @lifecycle canonical - Shared filesystem utilities for prompt discovery and safe writes.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { PromptData, PromptsConfigFile } from '../types.js';

import type { Dirent } from 'node:fs';

// Create a simple logger since we can't import from index.ts
// Uses stderr to avoid corrupting STDIO protocol
const log = {
  info: (message: string, ...args: any[]) => {
    console.error(`[INFO] ${message}`, ...args);
  },
  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  },
  warn: (message: string, ...args: any[]) => {
    console.warn(`[WARN] ${message}`, ...args);
  },
};

/**
 * Resolves a prompt file path consistently across the application
 * @param promptFile The file path from the prompt data
 * @param configFilePath The path to the config file (used as reference for absolute paths)
 * @param categoryFolder The path to the category folder (used for relative paths)
 * @returns The fully resolved path to the prompt file
 */
export function resolvePromptFilePath(
  promptFile: string,
  configFilePath: string,
  categoryFolder: string
): string {
  if (promptFile.startsWith('/')) {
    // Absolute path (relative to config file location)
    return path.resolve(path.dirname(configFilePath), promptFile.slice(1));
  } else if (promptFile.includes('/')) {
    // Path already includes category or sub-path
    return path.resolve(path.dirname(configFilePath), promptFile);
  } else {
    // Simple filename, relative to category folder
    return path.resolve(categoryFolder, promptFile);
  }
}

/**
 * Reads a prompt file and returns its content
 * @param promptFilePath Path to the prompt file
 * @returns The content of the prompt file
 */
export async function readPromptFile(promptFilePath: string): Promise<string> {
  try {
    return await fs.readFile(promptFilePath, 'utf8');
  } catch (error) {
    log.error(`Error reading prompt file ${promptFilePath}:`, error);
    throw new Error(
      `Failed to read prompt file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Parses a prompt file content into sections
 * @param content The content of the prompt file
 * @returns An object containing the different sections of the prompt
 */
export function parsePromptSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};

  // Extract the title and description (everything before the first ## heading)
  const titleMatch = content.match(/^# (.+?)(?=\n\n|\n##)/s);
  if (titleMatch) {
    const title = titleMatch[1];
    if (title) {
      sections['title'] = title.trim();
    }

    // Extract description (content between title and first ## heading)
    const descMatch = content.match(/^# .+?\n\n([\s\S]+?)(?=\n## )/s);
    const description = descMatch?.[1];
    sections['description'] = description ? description.trim() : '';
  }

  // Extract other sections (## headings)
  const sectionMatches = content.matchAll(/## ([^\n]+)\n\n([\s\S]+?)(?=\n## |\n# |\n$)/g);
  for (const match of sectionMatches) {
    const sectionName = match[1]?.trim();
    const sectionContent = match[2]?.trim();
    if (sectionName && sectionContent !== undefined) {
      sections[sectionName] = sectionContent;
    }
  }

  return sections;
}

/**
 * Modifies a specific section of a prompt markdown file
 * @param promptId Unique identifier of the prompt to modify
 * @param sectionName Name of the section to modify (e.g., "title", "description", "System Message", "User Message Template")
 * @param newContent New content for the specified section
 * @param configPath Path to the promptsConfig.json file
 * @returns Object containing the result of the operation
 */
export async function modifyPromptSection(
  promptId: string,
  sectionName: string,
  newContent: string,
  configPath: string
): Promise<{
  success: boolean;
  message: string;
  promptData?: PromptData;
  filePath?: string;
}> {
  try {
    const messages: string[] = [];
    // Read the promptsConfig.json file
    const configFilePath = path.resolve(configPath);
    const configContent = await fs.readFile(configFilePath, 'utf8');
    const promptsConfig = JSON.parse(configContent) as PromptsConfigFile;

    // Find the prompt in all category files
    let prompt: PromptData | null = null;
    let categoryFilePath: string = '';
    let promptIndex: number = -1;
    let promptsFile: any = null;

    // Search through each import path
    for (const importPath of promptsConfig.imports) {
      try {
        // Construct the full path to the import file
        const fullImportPath = path.resolve(path.dirname(configFilePath), importPath);

        // Check if the file exists
        try {
          await fs.access(fullImportPath);
        } catch (error) {
          log.warn(`Import file not found: ${importPath}. Skipping.`);
          continue;
        }

        // Read the file
        const fileContent = await fs.readFile(fullImportPath, 'utf8');
        const categoryPromptsFile = JSON.parse(fileContent);

        if (categoryPromptsFile.prompts && Array.isArray(categoryPromptsFile.prompts)) {
          // Find the prompt in this category file
          const foundIndex = categoryPromptsFile.prompts.findIndex(
            (p: PromptData) => p.id === promptId
          );

          if (foundIndex !== -1) {
            prompt = categoryPromptsFile.prompts[foundIndex];
            categoryFilePath = fullImportPath;
            promptIndex = foundIndex;
            promptsFile = categoryPromptsFile;
            messages.push(
              `✅ Found prompt '${promptId}' in category file: ${path.basename(categoryFilePath)}`
            );
            break;
          }
        }
      } catch (error) {
        log.error(`Error processing import file ${importPath}:`, error);
      }
    }

    // If prompt not found, throw an error
    if (!prompt) {
      return {
        success: false,
        message: `Prompt with ID '${promptId}' not found in any category file`,
      };
    }

    // Determine the category folder path
    const categoryFolder = path.dirname(categoryFilePath);

    // Get the full path to the prompt file using the new utility function
    const promptFilePath = resolvePromptFilePath(prompt.file, configFilePath, categoryFolder);

    // Read the prompt file
    const promptContent = await readPromptFile(promptFilePath);

    // Parse the prompt sections
    const sections = parsePromptSections(promptContent);

    // Check if the section exists
    if (!(sectionName in sections) && sectionName !== 'description') {
      return {
        success: false,
        message: `Section '${sectionName}' not found in prompt '${promptId}'`,
      };
    }

    // Store the original prompt data for potential rollback
    const originalPrompt = { ...prompt };
    const originalContent = promptContent;

    // Modify the section
    if (sectionName === 'title') {
      sections['title'] = newContent;
    } else if (sectionName === 'description') {
      sections['description'] = newContent;
    } else {
      sections[sectionName] = newContent;
    }

    // Reconstruct the prompt content
    const title = sections['title'] ?? '';
    const description = sections['description'] ?? '';
    let newPromptContent = `# ${title}\n\n${description}\n\n`;

    // Add other sections
    for (const [name, content] of Object.entries(sections)) {
      if (name !== 'title' && name !== 'description') {
        newPromptContent += `## ${name}\n\n${content}\n\n`;
      }
    }

    // Create the updated prompt
    const updatedPrompt: PromptData = {
      ...originalPrompt,
      name: sectionName === 'title' ? newContent : originalPrompt.name,
    };

    // Create a copy of the prompts file with the prompt removed
    const updatedPromptsFile = {
      ...promptsFile,
      prompts: [...promptsFile.prompts],
    };
    updatedPromptsFile.prompts.splice(promptIndex, 1);

    // Add the updated prompt to the new prompts array
    updatedPromptsFile.prompts.push(updatedPrompt);

    // Define the operations and rollbacks for the transaction
    const operations = [
      // 1. Write the updated prompt content to the file
      async () => await safeWriteFile(promptFilePath, newPromptContent),

      // 2. Write the updated category file with the prompt removed and added back
      async () =>
        await safeWriteFile(categoryFilePath, JSON.stringify(updatedPromptsFile, null, 2)),
    ];

    const rollbacks = [
      // 1. Restore the original prompt content
      async () => await fs.writeFile(promptFilePath, originalContent, 'utf8'),

      // 2. Restore the original category file
      async () =>
        await fs.writeFile(categoryFilePath, JSON.stringify(promptsFile, null, 2), 'utf8'),
    ];

    // Perform the operations as a transaction
    await performTransactionalFileOperations(operations, rollbacks);

    messages.push(`✅ Updated section '${sectionName}' in markdown file: ${prompt.file}`);
    if (sectionName === 'title') {
      messages.push(`✅ Updated prompt name in category file to '${newContent}'`);
    }

    return {
      success: true,
      message: messages.join('\n'),
      promptData: updatedPrompt,
      filePath: promptFilePath,
    };
  } catch (error) {
    log.error(`Error in modifyPromptSection:`, error);
    return {
      success: false,
      message: `Failed to modify prompt section: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Helper function to perform a series of file operations as a transaction
 * Automatically rolls back all changes if any operation fails
 * @param operations Array of async functions that perform file operations
 * @param rollbacks Array of async functions that undo the operations
 * @returns Result of the last operation if successful
 */
export async function performTransactionalFileOperations<T>(
  operations: Array<() => Promise<any>>,
  rollbacks: Array<() => Promise<any>>
): Promise<T> {
  // Validate inputs
  if (!operations || !Array.isArray(operations) || operations.length === 0) {
    throw new Error('No operations provided for transaction');
  }

  if (!rollbacks || !Array.isArray(rollbacks)) {
    log.warn(
      'No rollbacks provided for transaction - operations cannot be rolled back if they fail'
    );
    rollbacks = [];
  }

  // Ensure rollbacks array matches operations array length
  if (rollbacks.length < operations.length) {
    log.warn(
      `Rollbacks array (${rollbacks.length}) is shorter than operations array (${operations.length}) - some operations cannot be rolled back`
    );
    // Fill with dummy rollbacks
    for (let i = rollbacks.length; i < operations.length; i++) {
      rollbacks.push(async () => {
        log.warn(`No rollback defined for operation ${i}`);
      });
    }
  }

  let lastSuccessfulIndex = -1;
  let result: any;

  try {
    // Perform operations
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      if (typeof operation !== 'function') {
        throw new Error(`Operation at index ${i} is not a function`);
      }
      result = await operation();
      lastSuccessfulIndex = i;
    }
    return result as T;
  } catch (error) {
    log.error(`Transaction failed at operation ${lastSuccessfulIndex + 1}:`, error);

    // Perform rollbacks in reverse order
    for (let i = lastSuccessfulIndex; i >= 0; i--) {
      try {
        const rollback = rollbacks[i];
        if (typeof rollback === 'function') {
          await rollback();
        } else {
          log.warn(`Skipping invalid rollback at index ${i} (not a function)`);
        }
      } catch (rollbackError) {
        log.error(`Error during rollback operation ${i}:`, rollbackError);
        // Continue with other rollbacks even if one fails
      }
    }
    throw error;
  }
}

/**
 * Safely writes content to a file by first writing to a temp file, then renaming
 * This ensures the file is either completely written or left unchanged
 * @param filePath Path to the file
 * @param content Content to write
 * @param encoding Optional encoding (defaults to 'utf8')
 */
export async function safeWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf8'
): Promise<void> {
  const tempPath = `${filePath}.tmp`;

  try {
    // Write to temp file
    await fs.writeFile(tempPath, content, encoding);

    // Check if the original file exists
    try {
      await fs.access(filePath);
      // If it exists, make a backup
      const backupPath = `${filePath}.bak`;
      await fs.copyFile(filePath, backupPath);

      // Replace the original with the temp file
      await fs.rename(tempPath, filePath);

      // Remove the backup
      await fs.unlink(backupPath);
    } catch (error) {
      // File doesn't exist, just rename the temp file
      await fs.rename(tempPath, filePath);
    }
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      // Ignore errors during cleanup
    }
    throw error;
  }
}

/**
 * Finds and deletes a prompt file
 * @param promptId Unique identifier of the prompt to delete
 * @param baseDir Base directory to search in (usually the prompts directory)
 * @returns Object containing information about the deletion
 */
export async function findAndDeletePromptFile(
  promptId: string,
  baseDir: string
): Promise<{
  found: boolean;
  deleted: boolean;
  path?: string;
  error?: string;
}> {
  try {
    // First, find the prompt file
    const findResult = await findPromptFile(promptId, baseDir);

    // If the file wasn't found, return the result
    if (!findResult.found) {
      return { found: false, deleted: false };
    }

    // Try to delete the file
    try {
      await fs.unlink(findResult.path!);
      log.info(`Successfully deleted markdown file: ${findResult.path}`);
      return findResult.path
        ? { found: true, deleted: true, path: findResult.path }
        : { found: true, deleted: true };
    } catch (deleteError) {
      const errorMessage = `Error deleting file at ${findResult.path}: ${
        deleteError instanceof Error ? deleteError.message : String(deleteError)
      }`;
      log.error(errorMessage);
      const response: { found: boolean; deleted: boolean; path?: string; error?: string } = {
        found: true,
        deleted: false,
        error: errorMessage,
      };
      if (findResult.path) {
        response.path = findResult.path;
      }
      return response;
    }
  } catch (error) {
    const errorMessage = `Error finding and deleting prompt file: ${
      error instanceof Error ? error.message : String(error)
    }`;
    log.error(errorMessage);
    return { found: false, deleted: false, error: errorMessage };
  }
}

/**
 * Checks if a prompt file exists and returns its path
 * @param promptId Unique identifier of the prompt to find
 * @param baseDir Base directory to search in (usually the prompts directory)
 * @returns Object containing information about the prompt file
 */
export async function findPromptFile(
  promptId: string,
  baseDir: string
): Promise<{
  found: boolean;
  path?: string;
  category?: string;
  error?: string;
}> {
  try {
    // Get all category directories
    const categoryDirs = await fs.readdir(baseDir, { withFileTypes: true });

    // Filter for directories only
    const categories = categoryDirs
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    log.info(
      `Searching for markdown file with ID '${promptId}' in ${categories.length} category folders`
    );

    // Possible filenames to look for
    const possibleFilenames = [
      `${promptId}.md`, // Simple ID.md
      `${promptId.replace(/-/g, '_')}.md`, // ID with underscores instead of hyphens
      `${promptId.replace(/_/g, '-')}.md`, // ID with hyphens instead of underscores
    ];

    // Search each category directory for the file
    for (const category of categories) {
      const categoryPath = path.join(baseDir, category);

      try {
        const files = await fs.readdir(categoryPath);

        // Check each possible filename
        for (const filename of possibleFilenames) {
          if (files.includes(filename)) {
            const filePath = path.join(categoryPath, filename);
            log.info(`Found markdown file at: ${filePath}`);
            return { found: true, path: filePath, category };
          }
        }
      } catch (readError) {
        log.warn(
          `Error reading directory ${categoryPath}: ${
            readError instanceof Error ? readError.message : String(readError)
          }`
        );
        // Continue to next category
      }
    }

    log.warn(`Could not find markdown file for prompt '${promptId}' in any category folder`);
    return { found: false };
  } catch (error) {
    const errorMessage = `Error searching for prompt file: ${
      error instanceof Error ? error.message : String(error)
    }`;
    log.error(errorMessage);
    return { found: false, error: errorMessage };
  }
}
