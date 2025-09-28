/**
 * Prompt Converter Module
 * Handles converting markdown prompts to JSON structure with validation
 */

import path from "path";
import { Logger } from "../logging/index.js";
import type { ConvertedPrompt } from "../execution/types.js";
import type { PromptData } from "./types.js";
import { isChainPrompt } from "../utils/chainUtils.js";
import { PromptLoader } from "./loader.js";

/**
 * Prompt Converter class
 */
export class PromptConverter {
  private logger: Logger;
  private loader: PromptLoader;

  constructor(logger: Logger, loader?: PromptLoader) {
    this.logger = logger;
    this.loader = loader || new PromptLoader(logger);
  }

  /**
   * Convert markdown prompts to JSON structure in memory
   */
  async convertMarkdownPromptsToJson(
    promptsData: PromptData[],
    basePath?: string
  ): Promise<ConvertedPrompt[]> {
    const convertedPrompts: ConvertedPrompt[] = [];

    this.logger.info(
      `Converting ${promptsData.length} markdown prompts to JSON structure...`
    );

    for (const promptData of promptsData) {
      try {
        // Determine base path for loading files
        const fileBasePath = basePath || path.join(process.cwd(), "..");

        // Load the prompt file content using the loader
        const promptFile = await this.loader.loadPromptFile(
          promptData.file,
          fileBasePath
        );

        // Load chain steps from markdown-embedded format
        let chainSteps = promptFile.chainSteps || [];

        // Create converted prompt structure
        const convertedPrompt: ConvertedPrompt = {
          id: promptData.id,
          name: promptData.name,
          description: promptData.description,
          category: promptData.category,
          systemMessage: promptFile.systemMessage,
          userMessageTemplate: promptFile.userMessageTemplate,
          arguments: promptData.arguments.map((arg) => ({
            name: arg.name,
            description: arg.description,
            required: arg.required,
          })),
          // Include chain information from markdown-embedded chainSteps
          chainSteps: chainSteps,
          tools: promptData.tools || false,
          onEmptyInvocation:
            promptData.onEmptyInvocation || "execute_if_possible",
        };

        // NOTE: All chains now use markdown-embedded format
        // Modular chain system has been removed - chains are defined inline within markdown files
        if (isChainPrompt(convertedPrompt) && chainSteps.length === 0) {
          this.logger.debug(`Chain prompt '${convertedPrompt.id}' has no embedded chain steps - will be treated as single prompt`);
        }

        // Validate the onEmptyInvocation field
        if (
          promptData.onEmptyInvocation &&
          promptData.onEmptyInvocation !== "return_template" &&
          promptData.onEmptyInvocation !== "execute_if_possible"
        ) {
          this.logger.warn(
            `Prompt '${promptData.id}' has an invalid 'onEmptyInvocation' value: "${promptData.onEmptyInvocation}". ` +
              `Defaulting to "execute_if_possible". Allowed values are "return_template" or "execute_if_possible".`
          );
          convertedPrompt.onEmptyInvocation = "execute_if_possible";
        }

        // Validate the converted prompt
        const validation = this.validateConvertedPrompt(convertedPrompt);
        if (!validation.isValid) {
          this.logger.warn(
            `Prompt ${
              promptData.id
            } has validation issues: ${validation.errors.join(", ")}`
          );
          // Continue processing even with warnings
        }

        convertedPrompts.push(convertedPrompt);
      } catch (error) {
        this.logger.error(`Error converting prompt ${promptData.id}:`, error);
        // Continue with other prompts even if one fails
      }
    }

    this.logger.info(
      `Successfully converted ${convertedPrompts.length} prompts`
    );
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
      errors.push("Missing required field: id");
    }
    if (!prompt.name) {
      errors.push("Missing required field: name");
    }
    if (!prompt.category) {
      errors.push("Missing required field: category");
    }

    // Check that either userMessageTemplate exists or it's a valid chain
    if (!prompt.userMessageTemplate && !((prompt.chainSteps?.length || 0) > 0)) {
      errors.push(
        "Either userMessageTemplate must be provided or prompt must be a valid chain"
      );
    }

    // Validate chain prompts
    if ((prompt.chainSteps?.length || 0) > 0) {
      if (!prompt.chainSteps || prompt.chainSteps.length === 0) {
        errors.push("Chain prompt must have at least one chain step");
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
        if (typeof arg.required !== "boolean") {
          warnings.push(
            `Argument ${arg.name || index + 1} has invalid required value`
          );
        }
      });
    }

    // Check for placeholder validation in template
    if (prompt.userMessageTemplate) {
      const placeholders = this.extractPlaceholders(prompt.userMessageTemplate);
      const argumentNames = prompt.arguments.map((arg) => arg.name);

      // Find placeholders that don't have corresponding arguments
      const orphanedPlaceholders = placeholders.filter(
        (placeholder) =>
          !argumentNames.includes(placeholder) &&
          !this.isSpecialPlaceholder(placeholder)
      );

      if (orphanedPlaceholders.length > 0) {
        warnings.push(
          `Template has placeholders without arguments: ${orphanedPlaceholders.join(
            ", "
          )}`
        );
      }

      // Find arguments that aren't used in the template
      const unusedArguments = argumentNames.filter(
        (argName) => !placeholders.includes(argName)
      );

      if (unusedArguments.length > 0) {
        warnings.push(
          `Arguments not used in template: ${unusedArguments.join(", ")}`
        );
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
      const placeholder = match[1].trim();
      if (!placeholders.includes(placeholder)) {
        placeholders.push(placeholder);
      }
    }

    return placeholders;
  }

  /**
   * Check if a placeholder is a special system placeholder
   */
  private isSpecialPlaceholder(placeholder: string): boolean {
    const specialPlaceholders = [
      "previous_message",
      "tools_available",
      "current_step_number",
      "total_steps",
      "current_step_name",
      "step_number",
      "step_name",
    ];

    return (
      specialPlaceholders.includes(placeholder) ||
      placeholder.startsWith("ref:")
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
    const totalArguments = convertedPrompts.reduce(
      (sum, p) => sum + p.arguments.length,
      0
    );

    return {
      totalOriginal: originalCount,
      totalConverted: convertedPrompts.length,
      successRate:
        originalCount > 0 ? convertedPrompts.length / originalCount : 0,
      chainPrompts,
      regularPrompts,
      totalArguments,
    };
  }
}
