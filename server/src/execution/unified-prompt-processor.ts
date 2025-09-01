/**
 * Unified Prompt Processor (Streamlined - Phase 3)
 *
 * Simplified basic template processor for direct template processing.
 * Complex framework-aware processing now handled by ConsolidatedPromptEngine.
 *
 * Responsibilities:
 * - Basic template variable substitution
 * - Simple text reference processing  
 * - Legacy compatibility for systems that need direct template processing
 * - No framework injection or complex parsing - kept minimal
 */

import { Logger } from "../logging/index.js";
import { PromptManager } from "../prompts/index.js";
import { ConversationManager } from "../text-references/conversation.js";
import { ConvertedPrompt } from "../types/index.js";
import { PromptError } from "../utils/errorHandling.js";
import { TextReferenceManager } from "../text-references/index.js";
import { getAvailableTools } from "../utils/index.js";
import { processTemplate as originalProcessTemplate } from "../utils/jsonUtils.js";

export interface PromptExecutionResult {
  content: string;
  status: 'completed' | 'failed';
  executionTime: number;
  metadata?: {
    processingType?: 'basic' | 'legacy_fallback';
  };
}

/**
 * Streamlined processor for basic template processing (Phase 3)
 * Complex processing delegated to ConsolidatedPromptEngine
 */
export class UnifiedPromptProcessor {
  private logger: Logger;
  private promptManager: PromptManager;
  private conversationManager: ConversationManager;
  private textReferenceManager: TextReferenceManager;

  constructor(
    logger: Logger,
    promptManager: PromptManager,
    conversationManager: ConversationManager,
    textReferenceManager: TextReferenceManager
  ) {
    this.logger = logger;
    this.promptManager = promptManager;
    this.conversationManager = conversationManager;
    this.textReferenceManager = textReferenceManager;

    this.logger.debug("UnifiedPromptProcessor initialized (streamlined) - basic template processing only");
  }

  /**
   * Process a single prompt with basic template processing (Phase 3 - Streamlined)
   * Complex processing delegated to ConsolidatedPromptEngine
   */
  async processPrompt(
    promptId: string,
    args: Record<string, any>
  ): Promise<PromptExecutionResult> {
    const startTime = Date.now();

    try {
      // Find the converted prompt
      const convertedPrompt = (this.promptManager as any).convertedPrompts?.find(
        (cp: ConvertedPrompt) => cp.id === promptId
      );

      if (!convertedPrompt) {
        throw new PromptError(`Could not find prompt with ID: ${promptId}`);
      }

      this.logger.debug(`Processing prompt (basic): ${promptId}`);

      // Basic argument processing - handle missing args with defaults
      const processedArgs = await this.handleBasicArguments(convertedPrompt, args);

      // Basic template processing without framework enhancement
      const userMessageText = await this.processBasicTemplate(
        convertedPrompt,
        processedArgs
      );

      // Add to conversation history
      this.conversationManager.addToConversationHistory({
        role: "user",
        content: userMessageText,
        timestamp: Date.now(),
        isProcessedTemplate: true,
      });

      // Generate response (MCP echo pattern)
      const response = `Basic prompt processed: ${promptId}\nContent: ${userMessageText}`;

      // Store response in conversation history
      this.conversationManager.addToConversationHistory({
        role: "assistant",
        content: response,
        timestamp: Date.now(),
      });

      const executionTime = Date.now() - startTime;
      this.logger.debug(`Basic prompt processing completed in ${executionTime}ms`);

      return {
        content: response,
        status: 'completed',
        executionTime,
        metadata: {
          processingType: 'basic',
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Basic prompt processing failed for ${promptId}:`, error);

      return {
        content: `Error processing prompt: ${errorMessage}`,
        status: 'failed',
        executionTime,
        metadata: {
          processingType: 'legacy_fallback',
        }
      };
    }
  }

  /**
   * Handle basic arguments with simple fallback logic (Phase 3 - Streamlined)
   */
  private async handleBasicArguments(
    convertedPrompt: ConvertedPrompt,
    args: Record<string, any>
  ): Promise<Record<string, any>> {
    const processedArgs = { ...args };

    // Check for missing arguments and provide simple defaults
    const missingArgs = convertedPrompt.arguments
      .filter((arg: any) => !processedArgs[arg.name])
      .map((arg: any) => arg.name);

    if (missingArgs.length > 0) {
      this.logger.debug(
        `Missing arguments for '${convertedPrompt.id}': ${missingArgs.join(", ")}. Using defaults.`
      );

      // Use previous_message for all missing arguments (simple fallback)
      missingArgs.forEach((argName: string) => {
        processedArgs[argName] = `{{previous_message}}`;
      });
    }

    return processedArgs;
  }

  /**
   * Process template with basic context (Phase 3 - Streamlined)
   * No complex context resolution - basic template processing only
   */
  private async processBasicTemplate(
    convertedPrompt: ConvertedPrompt,
    processedArgs: Record<string, any>
  ): Promise<string> {
    // Build basic special context
    const specialContext = this.buildBasicContext();

    // Process the template directly using basic template processing
    return await this.processTemplateAsyncDirect(
      convertedPrompt.userMessageTemplate,
      processedArgs,
      specialContext,
      convertedPrompt.tools || false
    );
  }

  /**
   * Build basic special context without complex resolution
   */
  private buildBasicContext(): Record<string, any> {
    const specialContext: Record<string, any> = {};

    // Simple previous_message resolution from conversation history
    const history = this.conversationManager.getConversationHistory();
    const lastMessage = history.length > 0 ? history[history.length - 1] : null;
    specialContext.previous_message = lastMessage ? lastMessage.content : "";

    // Add minimal contextual information
    specialContext.timestamp = new Date().toISOString();
    specialContext.execution_context = 'basic_processor';

    return specialContext;
  }

  // ===== CONSOLIDATED TEMPLATE PROCESSING METHODS =====
  // Merged from TemplateProcessor for direct template processing without delegation

  /**
   * Process template asynchronously with text reference support
   * (Consolidated from TemplateProcessor)
   */
  async processTemplateAsyncDirect(
    template: string,
    args: Record<string, string>,
    specialContext: Record<string, string> = {},
    toolsEnabled: boolean = false
  ): Promise<string> {
    try {
      // First, store any long text arguments as references
      const processedArgs = { ...args };
      for (const [key, value] of Object.entries(processedArgs)) {
        if (value && value.length > 500) {
          // Store texts longer than 500 characters as references
          processedArgs[key] = await this.textReferenceManager.storeTextReference(value);
        }
      }

      // Add tools_available to specialContext if tools are enabled
      const enhancedSpecialContext = { ...specialContext };
      if (toolsEnabled) {
        enhancedSpecialContext["tools_available"] = getAvailableTools();
      }

      // Process the template with the modified arguments
      let processedTemplate = originalProcessTemplate(
        template,
        processedArgs,
        enhancedSpecialContext
      );

      // Replace any reference placeholders with their content
      processedTemplate = this.textReferenceManager.processTemplateReferences(processedTemplate);

      return processedTemplate;
    } catch (error) {
      this.logger.error("Error processing template async:", error);
      throw error;
    }
  }

  /**
   * Process template synchronously (no text reference storage)
   * (Consolidated from TemplateProcessor)
   */
  processTemplateSyncDirect(
    template: string,
    args: Record<string, string>,
    specialContext: Record<string, string> = {},
    toolsEnabled: boolean = false
  ): string {
    try {
      // Add tools_available to specialContext if tools are enabled
      const enhancedSpecialContext = { ...specialContext };
      if (toolsEnabled) {
        enhancedSpecialContext["tools_available"] = getAvailableTools();
      }

      // Process the template with the arguments directly
      let processedTemplate = originalProcessTemplate(
        template,
        args,
        enhancedSpecialContext
      );

      // Replace any reference placeholders with their content
      processedTemplate = this.textReferenceManager.processTemplateReferences(processedTemplate);

      return processedTemplate;
    } catch (error) {
      this.logger.error("Error processing template sync:", error);
      throw error;
    }
  }

  /**
   * Extract placeholders from a template
   * (Consolidated from TemplateProcessor)
   */
  extractPlaceholders(template: string): string[] {
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
   * (Consolidated from TemplateProcessor)
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
   * Validate template against provided arguments
   * (Consolidated from TemplateProcessor)
   */
  validateTemplate(
    template: string,
    argumentNames: string[]
  ): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    orphanedPlaceholders: string[];
    unusedArguments: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!template || typeof template !== "string") {
      errors.push("Template must be a non-empty string");
      return {
        isValid: false,
        errors,
        warnings,
        orphanedPlaceholders: [],
        unusedArguments: argumentNames,
      };
    }

    const placeholders = this.extractPlaceholders(template);

    // Find placeholders that don't have corresponding arguments
    const orphanedPlaceholders = placeholders.filter(
      (placeholder) =>
        !argumentNames.includes(placeholder) &&
        !this.isSpecialPlaceholder(placeholder)
    );

    // Find arguments that aren't used in the template
    const unusedArguments = argumentNames.filter(
      (argName) => !placeholders.includes(argName)
    );

    if (orphanedPlaceholders.length > 0) {
      warnings.push(
        `Template has placeholders without arguments: ${orphanedPlaceholders.join(
          ", "
        )}`
      );
    }

    if (unusedArguments.length > 0) {
      warnings.push(
        `Arguments not used in template: ${unusedArguments.join(", ")}`
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      orphanedPlaceholders,
      unusedArguments,
    };
  }

  /**
   * Get template processing statistics
   * (Consolidated from TemplateProcessor)
   */
  getTemplateStats(template: string): {
    totalLength: number;
    placeholderCount: number;
    uniquePlaceholders: string[];
    specialPlaceholders: string[];
    argumentPlaceholders: string[];
  } {
    const placeholders = this.extractPlaceholders(template);
    const specialPlaceholders = placeholders.filter((p) =>
      this.isSpecialPlaceholder(p)
    );
    const argumentPlaceholders = placeholders.filter(
      (p) => !this.isSpecialPlaceholder(p)
    );

    return {
      totalLength: template.length,
      placeholderCount: placeholders.length,
      uniquePlaceholders: placeholders,
      specialPlaceholders,
      argumentPlaceholders,
    };
  }

  /**
   * Preview template processing without actually storing text references
   * (Consolidated from TemplateProcessor)
   */
  previewTemplate(
    template: string,
    args: Record<string, string>,
    specialContext: Record<string, string> = {},
    toolsEnabled: boolean = false
  ): {
    processedTemplate: string;
    longTextArguments: string[];
    placeholdersUsed: string[];
  } {
    const longTextArguments: string[] = [];

    // Identify long text arguments that would be stored as references
    for (const [key, value] of Object.entries(args)) {
      if (value && value.length > 500) {
        longTextArguments.push(key);
      }
    }

    // Process template without storing references
    const enhancedSpecialContext = { ...specialContext };
    if (toolsEnabled) {
      enhancedSpecialContext["tools_available"] = getAvailableTools();
    }

    const processedTemplate = originalProcessTemplate(
      template,
      args,
      enhancedSpecialContext
    );

    const placeholdersUsed = this.extractPlaceholders(template);

    return {
      processedTemplate,
      longTextArguments,
      placeholdersUsed,
    };
  }

  // ===== ORIGINAL METHODS =====

  /**
   * Get processing statistics for monitoring (Phase 3 - Simplified)
   */
  getProcessingStats() {
    return {
      processingType: 'basic_template_processing',
      complexProcessingDelegatedTo: 'ConsolidatedPromptEngine'
    };
  }
}

/**
 * Factory function to create streamlined prompt processor (Phase 3)
 * Basic template processing only - complex processing via ConsolidatedPromptEngine
 */
export function createUnifiedPromptProcessor(
  logger: Logger,
  promptManager: PromptManager,
  conversationManager: ConversationManager,
  textReferenceManager: TextReferenceManager
): UnifiedPromptProcessor {
  return new UnifiedPromptProcessor(
    logger,
    promptManager,
    conversationManager,
    textReferenceManager
  );
}