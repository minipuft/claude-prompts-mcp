/**
 * Prompt Registry Module
 * Handles registering prompts with MCP server and managing conversation history
 */

import { z } from "zod";
import { ConfigManager } from "../config/index.js";
import { Logger } from "../logging/index.js";
import {
  ConversationHistoryItem,
  ConvertedPrompt,
  RegistrationMode,
} from "../types/index.js";
// TemplateProcessor functionality consolidated into UnifiedPromptProcessor

/**
 * Prompt Registry class
 */
export class PromptRegistry {
  private logger: Logger;
  private mcpServer: any;
  private configManager: ConfigManager;
  // templateProcessor removed - functionality consolidated into UnifiedPromptProcessor
  private conversationHistory: ConversationHistoryItem[] = [];
  private readonly MAX_HISTORY_SIZE = 100;

  /**
   * Direct template processing method (minimal implementation)
   * Replaces templateProcessor calls for basic template processing
   */
  private async processTemplateDirect(
    template: string,
    args: Record<string, string>,
    specialContext: Record<string, string> = {},
    toolsEnabled: boolean = false
  ): Promise<string> {
    // Import jsonUtils for basic template processing
    const { processTemplate } = await import("../utils/jsonUtils.js");
    const { getAvailableTools } = await import("../utils/index.js");
    
    const enhancedSpecialContext = { ...specialContext };
    if (toolsEnabled) {
      enhancedSpecialContext["tools_available"] = getAvailableTools();
    }
    
    return processTemplate(template, args, enhancedSpecialContext);
  }

  constructor(
    logger: Logger,
    mcpServer: any,
    configManager: ConfigManager
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.configManager = configManager;
    // templateProcessor removed - functionality consolidated into UnifiedPromptProcessor
  }

  /**
   * Register MCP resources for prompt schemas (enables AI auto-discovery)
   */
  async registerPromptResources(prompts: ConvertedPrompt[]): Promise<void> {
    try {
      this.logger.info(`Registering MCP resources for ${prompts.length} prompts...`);
      
      for (const prompt of prompts) {
        const resourceUri = `prompt://${prompt.id}/schema`;
        const schema = {
          name: prompt.name,
          id: prompt.id,
          description: prompt.description,
          category: prompt.category,
          arguments: prompt.arguments.map(arg => ({
            name: arg.name,
            description: arg.description || `Argument: ${arg.name}`,
            required: arg.required,
            type: 'string'
          })),
          usage: `>>${prompt.id} ${prompt.arguments.map(arg => `${arg.name}="value"`).join(' ')}`,
          examples: [
            {
              description: 'Basic usage',
              command: `>>${prompt.id} ${prompt.arguments.slice(0, 1).map(arg => `${arg.name}="example value"`).join(' ')}`
            }
          ]
        };
        
        // Register resource with MCP server
        this.mcpServer.resource(
          resourceUri,
          `Prompt schema for ${prompt.name}`,
          'application/json',
          () => ({
            contents: [{
              type: 'text',
              text: JSON.stringify(schema, null, 2)
            }]
          })
        );
        
        this.logger.debug(`Registered resource: ${resourceUri}`);
      }
      
      this.logger.info(`Successfully registered ${prompts.length} prompt resources`);
    } catch (error) {
      this.logger.error('Error registering prompt resources:', error);
    }
  }

  /**
   * Register all prompts with the MCP server
   */
  async registerAllPrompts(prompts: ConvertedPrompt[]): Promise<number> {
    try {
      this.logger.info(
        `Registering ${prompts.length} prompts with the server...`
      );

      // Unregister existing prompts if possible
      await this.unregisterAllPrompts();

      // Register MCP resources for AI auto-discovery
      await this.registerPromptResources(prompts);

      const config = this.configManager.getConfig();
      const registrationMode = config.prompts.registrationMode || "both";

      this.logger.info(`Using prompt registration mode: ${registrationMode}`);

      let registeredCount = 0;
      for (const promptData of prompts) {
        try {
          const success = await this.registerSinglePrompt(
            promptData,
            registrationMode as RegistrationMode
          );
          if (success) {
            registeredCount++;
          }
        } catch (error) {
          this.logger.error(
            `Error registering prompt '${promptData.name}':`,
            error
          );
          // Continue with other prompts even if one fails
        }
      }

      this.logger.info(
        `Successfully registered ${registeredCount} prompts with the server`
      );
      return registeredCount;
    } catch (error) {
      this.logger.error(`Error registering prompts:`, error);
      throw error;
    }
  }

  /**
   * Register a single prompt with the MCP server
   */
  async registerSinglePrompt(
    promptData: ConvertedPrompt,
    registrationMode: RegistrationMode | "both" = "both"
  ): Promise<boolean> {
    try {
      // Create the argument schema for this prompt
      const argsSchema = this.createArgsSchema(promptData.arguments);

      // Create the prompt handler
      const promptHandler = this.createPromptHandler(promptData);

      // Register the prompt based on the configuration mode
      if (registrationMode === "id" || registrationMode === "both") {
        this.mcpServer.prompt(promptData.id, argsSchema, promptHandler);
        this.logger.debug(`Registered prompt with ID: ${promptData.id}`);
      }

      if (registrationMode === "name" || registrationMode === "both") {
        this.mcpServer.prompt(promptData.name, argsSchema, promptHandler);
        this.logger.debug(`Registered prompt with name: ${promptData.name}`);
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Error registering single prompt '${promptData.name}':`,
        error
      );
      return false;
    }
  }

  /**
   * Unregister all prompts if possible
   */
  async unregisterAllPrompts(): Promise<void> {
    if (typeof (this.mcpServer as any).unregisterAllPrompts === "function") {
      try {
        (this.mcpServer as any).unregisterAllPrompts();
        this.logger.info("Unregistered all existing prompts");
      } catch (unregisterError) {
        this.logger.warn(
          "Could not unregister existing prompts:",
          unregisterError
        );
      }
    }
  }

  /**
   * Helper function to determine if provided arguments are effectively empty
   * for the given prompt definition.
   */
  private areArgumentsEffectivelyEmpty(
    promptArgs: Array<{ name: string }>,
    providedArgs: any
  ): boolean {
    if (
      !providedArgs ||
      typeof providedArgs !== "object" ||
      Object.keys(providedArgs).length === 0
    ) {
      return true; // No arguments provided at all
    }
    // Check if any of the defined arguments for the prompt have a meaningful value
    for (const definedArg of promptArgs) {
      const value = providedArgs[definedArg.name];
      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
      ) {
        return false; // Found at least one provided argument with a value
      }
    }
    return true; // All defined arguments are missing or have empty values
  }

  /**
   * Create prompt handler function
   */
  private createPromptHandler(promptData: ConvertedPrompt) {
    return async (args: any, extra: any) => {
      try {
        this.logger.info(`Executing prompt '${promptData.name}'...`);

        // Check if arguments are effectively empty
        const effectivelyEmptyArgs = this.areArgumentsEffectivelyEmpty(
          promptData.arguments,
          args
        );

        if (
          effectivelyEmptyArgs &&
          promptData.onEmptyInvocation === "return_template"
        ) {
          this.logger.info(
            `Prompt '${promptData.name}' invoked without arguments and onEmptyInvocation is 'return_template'. Returning template info.`
          );

          let responseText = `Prompt: '${promptData.name}'\n`;
          responseText += `Description: ${promptData.description}\n`;

          if (promptData.arguments && promptData.arguments.length > 0) {
            responseText += `This prompt requires the following arguments:\n`;
            promptData.arguments.forEach((arg) => {
              responseText += `  - ${arg.name}${
                arg.required ? " (required)" : " (optional)"
              }: ${arg.description || "No description"}\n`;
            });
            responseText += `\nExample usage: >>${
              promptData.id || promptData.name
            } ${promptData.arguments
              .map((arg) => `${arg.name}=\"value\"`)
              .join(" ")}`;
          } else {
            responseText += "This prompt does not require any arguments.\n";
          }

          return {
            messages: [
              {
                role: "assistant" as const,
                content: { type: "text" as const, text: responseText },
              },
            ],
          };
        }

        // Check if this is a chain prompt
        if (
          promptData.isChain &&
          promptData.chainSteps &&
          promptData.chainSteps.length > 0
        ) {
          this.logger.info(
            `Prompt '${promptData.name}' is a chain with ${promptData.chainSteps.length} steps. NOT automatically executing the chain.`
          );
          // Note: Chain execution is handled elsewhere
        }

        // Create messages array with only user and assistant roles
        const messages: {
          role: "user" | "assistant";
          content: { type: "text"; text: string };
        }[] = [];

        // Create user message with placeholders replaced
        let userMessageText = promptData.userMessageTemplate;

        // If there's a system message, prepend it to the user message
        if (promptData.systemMessage) {
          userMessageText = `[System Info: ${promptData.systemMessage}]\n\n${userMessageText}`;
        }

        // Process the template with special context
        // Using direct processing since TemplateProcessor was consolidated
        userMessageText = await this.processTemplateDirect(
          userMessageText,
          args,
          { previous_message: this.getPreviousMessage() },
          promptData.tools || false
        );

        // Store in conversation history for future reference
        this.addToConversationHistory({
          role: "user",
          content: userMessageText,
          timestamp: Date.now(),
          isProcessedTemplate: true, // Mark as a processed template
        });

        // Push the user message to the messages array
        messages.push({
          role: "user",
          content: {
            type: "text",
            text: userMessageText,
          },
        });

        this.logger.debug(
          `Processed messages for prompt '${promptData.name}':`,
          messages
        );
        return { messages };
      } catch (error) {
        this.logger.error(
          `Error executing prompt '${promptData.name}':`,
          error
        );
        throw error; // Re-throw to let the MCP framework handle it
      }
    };
  }

  /**
   * Create argument schema for a prompt
   */
  private createArgsSchema(
    promptArgs: Array<{
      name: string;
      description?: string;
      required: boolean;
    }>
  ): Record<string, z.ZodType> {
    const schema: Record<string, z.ZodType> = {};

    for (const arg of promptArgs) {
      // All arguments are treated as optional strings regardless of required flag
      schema[arg.name] = z
        .string()
        .optional()
        .describe(arg.description || `Argument: ${arg.name}`);
    }

    return schema;
  }

  /**
   * Add item to conversation history with size management
   */
  addToConversationHistory(item: ConversationHistoryItem): void {
    this.conversationHistory.push(item);

    // Trim history if it exceeds maximum size
    if (this.conversationHistory.length > this.MAX_HISTORY_SIZE) {
      // Remove oldest entries, keeping recent ones
      this.conversationHistory.splice(
        0,
        this.conversationHistory.length - this.MAX_HISTORY_SIZE
      );
      this.logger.debug(
        `Trimmed conversation history to ${this.MAX_HISTORY_SIZE} entries to prevent memory leaks`
      );
    }
  }

  /**
   * Get the previous message from conversation history
   */
  getPreviousMessage(): string {
    // Try to find the last user message in conversation history
    if (this.conversationHistory.length > 0) {
      // Start from the end and find the first non-template user message
      for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
        const historyItem = this.conversationHistory[i];
        // Only consider user messages that aren't processed templates
        if (historyItem.role === "user" && !historyItem.isProcessedTemplate) {
          this.logger.debug(
            `Found previous user message for context: ${historyItem.content.substring(
              0,
              50
            )}...`
          );
          return historyItem.content;
        }
      }
    }

    // Return a default prompt if no suitable history item is found
    return "[Please check previous messages in the conversation for context]";
  }

  /**
   * Get conversation history
   */
  getConversationHistory(): ConversationHistoryItem[] {
    return [...this.conversationHistory];
  }

  /**
   * Clear conversation history
   */
  clearConversationHistory(): void {
    this.conversationHistory = [];
    this.logger.info("Conversation history cleared");
  }

  /**
   * Get conversation history statistics
   */
  getConversationStats(): {
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    processedTemplates: number;
    oldestMessage?: number;
    newestMessage?: number;
  } {
    const userMessages = this.conversationHistory.filter(
      (item) => item.role === "user"
    ).length;
    const assistantMessages = this.conversationHistory.filter(
      (item) => item.role === "assistant"
    ).length;
    const processedTemplates = this.conversationHistory.filter(
      (item) => item.isProcessedTemplate
    ).length;

    const timestamps = this.conversationHistory.map((item) => item.timestamp);
    const oldestMessage =
      timestamps.length > 0 ? Math.min(...timestamps) : undefined;
    const newestMessage =
      timestamps.length > 0 ? Math.max(...timestamps) : undefined;

    return {
      totalMessages: this.conversationHistory.length,
      userMessages,
      assistantMessages,
      processedTemplates,
      oldestMessage,
      newestMessage,
    };
  }

  /**
   * Execute a prompt directly (for testing or internal use)
   */
  async executePromptDirectly(
    promptId: string,
    args: Record<string, string>,
    prompts: ConvertedPrompt[]
  ): Promise<string> {
    try {
      const convertedPrompt = prompts.find((cp) => cp.id === promptId);
      if (!convertedPrompt) {
        throw new Error(`Could not find prompt with ID: ${promptId}`);
      }

      this.logger.debug(
        `Running prompt directly: ${promptId} with arguments:`,
        args
      );

      // Check for missing arguments but treat all as optional
      const missingArgs = convertedPrompt.arguments
        .filter((arg) => !args[arg.name])
        .map((arg) => arg.name);

      if (missingArgs.length > 0) {
        this.logger.info(
          `Missing arguments for '${promptId}': ${missingArgs.join(
            ", "
          )}. Will attempt to use conversation context.`
        );

        // Use previous_message for all missing arguments
        missingArgs.forEach((argName) => {
          args[argName] = `{{previous_message}}`;
        });
      }

      // Process template with context
      // Using direct processing since TemplateProcessor was consolidated
      const userMessageText = await this.processTemplateDirect(
        convertedPrompt.userMessageTemplate,
        args,
        { previous_message: this.getPreviousMessage() },
        convertedPrompt.tools || false
      );

      // Add the message to conversation history
      this.addToConversationHistory({
        role: "user",
        content: userMessageText,
        timestamp: Date.now(),
        isProcessedTemplate: true,
      });

      // Generate a response (echo in this MCP implementation)
      const response = `Processed prompt: ${promptId}\nWith message: ${userMessageText}`;

      // Store the response in conversation history
      this.addToConversationHistory({
        role: "assistant",
        content: response,
        timestamp: Date.now(),
      });

      return response;
    } catch (error) {
      this.logger.error(`Error executing prompt '${promptId}':`, error);
      throw error;
    }
  }

  /**
   * Get registration statistics
   */
  getRegistrationStats(prompts: ConvertedPrompt[]): {
    totalPrompts: number;
    chainPrompts: number;
    regularPrompts: number;
    toolEnabledPrompts: number;
    categoriesCount: number;
    averageArgumentsPerPrompt: number;
  } {
    const chainPrompts = prompts.filter((p) => p.isChain).length;
    const toolEnabledPrompts = prompts.filter((p) => p.tools).length;
    const categoriesSet = new Set(prompts.map((p) => p.category));
    const totalArguments = prompts.reduce(
      (sum, p) => sum + p.arguments.length,
      0
    );

    return {
      totalPrompts: prompts.length,
      chainPrompts,
      regularPrompts: prompts.length - chainPrompts,
      toolEnabledPrompts,
      categoriesCount: categoriesSet.size,
      averageArgumentsPerPrompt:
        prompts.length > 0 ? totalArguments / prompts.length : 0,
    };
  }
}
