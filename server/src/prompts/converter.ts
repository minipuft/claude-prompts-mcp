// @lifecycle canonical - Converts prompt markdown files into structured prompt data.
/**
 * Prompt Converter Module
 * Handles converting markdown prompts to JSON structure with validation
 */

import * as path from 'node:path';

import { PromptLoader } from './loader.js';
import { Logger } from '../logging/index.js';
import {
  ScriptToolDefinitionLoader,
  createScriptToolDefinitionLoader,
} from '../scripts/core/script-definition-loader.js';
import { isChainPrompt } from '../utils/chainUtils.js';

import type { PromptArgument, PromptData } from './types.js';
import type { ConvertedPrompt } from '../execution/types.js';

/**
 * Resolve the registerWithMcp value using the priority chain:
 * 1. Prompt-level override (highest priority)
 * 2. Category-level default (from _categoryRegisterWithMcp)
 * 3. Global config default (from config.json prompts.registerWithMcp)
 * 4. Hard-coded default: true (register with MCP)
 */
function resolveRegisterWithMcp(
  promptData: PromptData & { _categoryRegisterWithMcp?: boolean },
  globalRegisterWithMcp?: boolean
): boolean {
  // 1. Prompt-level override takes precedence
  if (promptData.registerWithMcp !== undefined) {
    return promptData.registerWithMcp;
  }
  // 2. Category-level default (attached by loader)
  if (promptData._categoryRegisterWithMcp !== undefined) {
    return promptData._categoryRegisterWithMcp;
  }
  // 3. Global config default
  if (globalRegisterWithMcp !== undefined) {
    return globalRegisterWithMcp;
  }
  // 4. Hard-coded default: register with MCP
  return true;
}

/**
 * Prompt Converter class
 */
export class PromptConverter {
  private logger: Logger;
  private loader: PromptLoader;
  private globalRegisterWithMcp: boolean | undefined;
  private scriptToolLoader: ScriptToolDefinitionLoader;

  constructor(logger: Logger, loader?: PromptLoader, globalRegisterWithMcp?: boolean) {
    this.logger = logger;
    this.loader = loader || new PromptLoader(logger);
    this.scriptToolLoader = createScriptToolDefinitionLoader({ debug: false });
    if (globalRegisterWithMcp !== undefined) {
      this.globalRegisterWithMcp = globalRegisterWithMcp;
    }
  }

  /**
   * Get the script tool loader instance.
   * Exposed for hot-reload integration.
   */
  getScriptToolLoader(): ScriptToolDefinitionLoader {
    return this.scriptToolLoader;
  }

  /**
   * Set the global registerWithMcp default value
   */
  setGlobalRegisterWithMcp(value: boolean | undefined): void {
    if (value !== undefined) {
      this.globalRegisterWithMcp = value;
    }
  }

  /**
   * Convert markdown prompts to JSON structure in memory
   */
  async convertMarkdownPromptsToJson(
    promptsData: PromptData[],
    basePath?: string
  ): Promise<ConvertedPrompt[]> {
    const convertedPrompts: ConvertedPrompt[] = [];

    this.logger.info(`Converting ${promptsData.length} markdown prompts to JSON structure...`);

    for (const promptData of promptsData) {
      try {
        // Determine base path for loading files
        const fileBasePath = basePath || path.join(process.cwd(), '..');

        // Load the prompt file content using the loader
        const promptFile = await this.loader.loadPromptFile(promptData.file, fileBasePath);

        // Load chain steps from markdown-embedded format
        let chainSteps = promptFile.chainSteps || [];

        // Create converted prompt structure
        const convertedPrompt: ConvertedPrompt = {
          id: promptData.id,
          name: promptData.name,
          description: promptData.description,
          category: promptData.category,
          systemMessage: promptFile.systemMessage ?? '',
          userMessageTemplate: promptFile.userMessageTemplate,
          arguments: promptData.arguments.map((arg) => {
            const mappedArgument: PromptArgument = {
              name: arg.name,
              required: arg.required ?? false,
            };

            if (arg.description !== undefined) {
              mappedArgument.description = arg.description;
            }
            if (arg.type !== undefined) {
              mappedArgument.type = arg.type;
            }
            if (arg.defaultValue !== undefined) {
              mappedArgument.defaultValue = arg.defaultValue;
            }
            if (arg.validation) {
              mappedArgument.validation = arg.validation;
            }

            return mappedArgument;
          }),
          // Include chain information from markdown-embedded chainSteps
          chainSteps: chainSteps,
          // Resolve MCP registration from prompt/category/global defaults
          registerWithMcp: resolveRegisterWithMcp(promptData, this.globalRegisterWithMcp),
        };

        if (promptFile.gateConfiguration) {
          convertedPrompt.gateConfiguration = promptFile.gateConfiguration;
        }

        // Load script tools if prompt declares any (Phase 2 integration)
        if (promptData.tools && promptData.tools.length > 0) {
          try {
            // Get the prompt directory from the file path
            const fullFilePath = path.join(fileBasePath, promptData.file);
            const promptDir = promptData.file.endsWith('.yaml')
              ? path.dirname(fullFilePath)
              : path.dirname(path.dirname(fullFilePath)); // For {id}/prompt.yaml

            // Load the declared tools
            const loadedTools = this.scriptToolLoader.loadToolsForPrompt(
              promptDir,
              promptData.tools,
              promptData.id
            );

            if (loadedTools.length > 0) {
              convertedPrompt.scriptTools = loadedTools;
              this.logger.debug(
                `[PromptConverter] Loaded ${loadedTools.length} script tools for '${promptData.id}'`
              );
            }

            // Store promptDir for script reference resolution ({{script:id}} syntax)
            convertedPrompt.promptDir = promptDir;
          } catch (toolLoadError) {
            this.logger.warn(
              `[PromptConverter] Failed to load script tools for '${promptData.id}':`,
              toolLoadError
            );
            // Continue without script tools - non-blocking error
          }
        }

        // NOTE: All chains now use markdown-embedded format
        // Modular chain system has been removed - chains are defined inline within markdown files
        if (isChainPrompt(convertedPrompt) && chainSteps.length === 0) {
          this.logger.debug(
            `Chain prompt '${convertedPrompt.id}' has no embedded chain steps - will be treated as single prompt`
          );
        }

        // Validate the converted prompt
        const validation = this.validateConvertedPrompt(convertedPrompt);
        if (!validation.isValid) {
          this.logger.warn(
            `Prompt ${promptData.id} has validation issues: ${validation.errors.join(', ')}`
          );
          // Continue processing even with warnings
        }

        convertedPrompts.push(convertedPrompt);
      } catch (error) {
        this.logger.error(`Error converting prompt ${promptData.id}:`, error);
        // Continue with other prompts even if one fails
      }
    }

    this.logger.info(`Successfully converted ${convertedPrompts.length} prompts`);
    return convertedPrompts;
  }

  /**
   * Validate a converted prompt
   */
  validateConvertedPrompt(prompt: ConvertedPrompt): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (!prompt.id) {
      errors.push('Missing required field: id');
    }
    if (!prompt.name) {
      errors.push('Missing required field: name');
    }
    if (!prompt.category) {
      errors.push('Missing required field: category');
    }

    // Check that either userMessageTemplate exists or it's a valid chain
    if (!prompt.userMessageTemplate && !((prompt.chainSteps?.length || 0) > 0)) {
      errors.push('Either userMessageTemplate must be provided or prompt must be a valid chain');
    }

    // Validate chain prompts
    if ((prompt.chainSteps?.length || 0) > 0) {
      if (!prompt.chainSteps || prompt.chainSteps.length === 0) {
        errors.push('Chain prompt must have at least one chain step');
      } else {
        // Validate each chain step
        prompt.chainSteps.forEach((step, index) => {
          if (!step.promptId) {
            errors.push(`Chain step ${index + 1} missing promptId`);
          }
          if (!step.stepName) {
            errors.push(`Chain step ${index + 1} missing stepName`);
          }
        });
      }
    }

    // Validate arguments
    if (prompt.arguments) {
      prompt.arguments.forEach((arg, index) => {
        if (!arg.name) {
          errors.push(`Argument ${index + 1} missing name`);
        }
        if (typeof arg.required !== 'boolean') {
          warnings.push(`Argument ${arg.name || index + 1} has invalid required value`);
        }
      });
    }

    // Check for placeholder validation in template
    if (prompt.userMessageTemplate) {
      // Validate template syntax - reject Handlebars syntax
      if (
        prompt.userMessageTemplate.includes('{{#if') ||
        prompt.userMessageTemplate.includes('{{/if') ||
        prompt.userMessageTemplate.includes('{{#each') ||
        prompt.userMessageTemplate.includes('{{/each') ||
        prompt.userMessageTemplate.includes('{{#unless') ||
        prompt.userMessageTemplate.includes('{{/unless')
      ) {
        errors.push(
          `Handlebars syntax detected in template. This system uses Nunjucks syntax.\n` +
            `Replace: {{#if condition}} → {% if condition %}\n` +
            `Replace: {{/if}} → {% endif %}\n` +
            `Replace: {{#each items}} → {% for item in items %}\n` +
            `Replace: {{/each}} → {% endfor %}`
        );
      }

      const placeholders = this.extractPlaceholders(prompt.userMessageTemplate);
      const argumentNames = prompt.arguments.map((arg) => arg.name);

      // Find placeholders that don't have corresponding arguments
      const orphanedPlaceholders = placeholders.filter(
        (placeholder) =>
          !argumentNames.includes(placeholder) && !this.isSpecialPlaceholder(placeholder)
      );

      if (orphanedPlaceholders.length > 0) {
        warnings.push(
          `Template has placeholders without arguments: ${orphanedPlaceholders.join(', ')}`
        );
      }

      // Find arguments that aren't used in the template
      const unusedArguments = argumentNames.filter((argName) => !placeholders.includes(argName));

      if (unusedArguments.length > 0) {
        warnings.push(`Arguments not used in template: ${unusedArguments.join(', ')}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Extract placeholders from a template string
   */
  private extractPlaceholders(template: string): string[] {
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const placeholders: string[] = [];
    let match;

    while ((match = placeholderRegex.exec(template)) !== null) {
      const placeholder = (match[1] ?? '').trim();
      if (!placeholders.includes(placeholder)) {
        placeholders.push(placeholder);
      }
    }

    return placeholders;
  }

  /**
   * Check if a placeholder is a special system placeholder.
   * These are injected at runtime and don't require argument definitions.
   */
  private isSpecialPlaceholder(placeholder: string): boolean {
    const specialPlaceholders = [
      'previous_message', // Last non-template user message (ConversationManager)
      // Chain step variables (ChainSessionManager.getChainContext)
      'chain_id',
      'input', // Current step's arguments object
      'previous_step_result',
      'step_results',
    ];

    // Also match stepN_result patterns (step1_result, step2_result, etc.)
    const isStepResultPattern = /^step\d+_result$/.test(placeholder);

    return (
      specialPlaceholders.includes(placeholder) ||
      isStepResultPattern ||
      placeholder.startsWith('ref:')
    );
  }

  /**
   * Get conversion statistics
   */
  getConversionStats(
    originalCount: number,
    convertedPrompts: ConvertedPrompt[]
  ): {
    totalOriginal: number;
    totalConverted: number;
    successRate: number;
    chainPrompts: number;
    regularPrompts: number;
    totalArguments: number;
  } {
    const chainPrompts = convertedPrompts.filter((p) => isChainPrompt(p)).length;
    const regularPrompts = convertedPrompts.length - chainPrompts;
    const totalArguments = convertedPrompts.reduce((sum, p) => sum + p.arguments.length, 0);

    return {
      totalOriginal: originalCount,
      totalConverted: convertedPrompts.length,
      successRate: originalCount > 0 ? convertedPrompts.length / originalCount : 0,
      chainPrompts,
      regularPrompts,
      totalArguments,
    };
  }
}
