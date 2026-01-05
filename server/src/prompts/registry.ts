// @lifecycle canonical - Registers prompts with the MCP server and manages conversation integration.
/**
 * Prompt Registry Module
 * Handles registering prompts with MCP server using proper MCP protocol and managing conversation history
 */

import { z } from 'zod';

import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { ConversationManager } from '../text-references/conversation.js';
import { ConvertedPrompt } from '../types/index.js';
import { isChainPrompt } from '../utils/chainUtils.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// TemplateProcessor functionality consolidated into UnifiedPromptProcessor

/**
 * Prompt Registry class
 */
type PromptRegistryServer = Pick<McpServer, 'registerPrompt'> & {
  notification?: (notification: { method: string; params?: unknown }) => void;
};

export class PromptRegistry {
  private logger: Logger;
  private mcpServer: PromptRegistryServer;
  private configManager: ConfigManager;
  private conversationManager: ConversationManager;
  // templateProcessor removed - functionality consolidated into UnifiedPromptProcessor
  private registeredPromptIds = new Set<string>(); // Track registered prompt IDs to prevent duplicates

  /**
   * Direct template processing method (minimal implementation)
   * Replaces templateProcessor calls for basic template processing
   */
  private async processTemplateDirect(
    template: string,
    args: Record<string, string>,
    specialContext: Record<string, string> = {}
  ): Promise<string> {
    const { processTemplate } = await import('../utils/jsonUtils.js');
    return processTemplate(template, args, specialContext);
  }

  constructor(
    logger: Logger,
    mcpServer: PromptRegistryServer,
    configManager: ConfigManager,
    conversationManager: ConversationManager
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.configManager = configManager;
    this.conversationManager = conversationManager;
    // templateProcessor removed - functionality consolidated into UnifiedPromptProcessor
  }

  /**
   * Register individual prompts using MCP SDK registerPrompt API
   * This implements the standard MCP prompts protocol using the high-level API
   */
  private registerIndividualPrompts(prompts: ConvertedPrompt[]): void {
    try {
      this.logger.info('Registering individual prompts with MCP SDK...');
      let registeredCount = 0;

      for (const prompt of prompts) {
        // Skip MCP registration if disabled (prompt or category level)
        if (prompt.registerWithMcp === false) {
          this.logger.debug(`Skipping MCP registration: ${prompt.id} (registerWithMcp=false)`);
          continue;
        }

        // Skip if already registered (deduplication guard)
        if (this.registeredPromptIds.has(prompt.id)) {
          this.logger.debug(`Skipping already registered prompt: ${prompt.id}`);
          continue;
        }

        // Create argument schema
        const argsSchema: Record<string, any> = {};
        for (const arg of prompt.arguments) {
          argsSchema[arg.name] = z
            .string()
            .optional()
            .describe(arg.description || `Argument: ${arg.name}`);
        }

        // Register the prompt using the correct MCP SDK API with error recovery
        // Use prompt.id for all MCP registration (slug-based, no spaces)
        try {
          this.mcpServer.registerPrompt(
            prompt.id,
            {
              title: prompt.id,
              description: prompt.description || `Prompt: ${prompt.id}`,
              argsSchema,
            },
            async (args: any) => {
              this.logger.debug(`Executing prompt '${prompt.id}' with args:`, args);
              return await this.executePromptLogic(prompt, args || {});
            }
          );

          // Track the registered prompt
          this.registeredPromptIds.add(prompt.id);
          registeredCount++;
          this.logger.debug(`Registered prompt: ${prompt.id}`);
        } catch (error: any) {
          if (error.message?.includes('already registered')) {
            // Handle MCP SDK's "already registered" error gracefully
            this.logger.warn(
              `Prompt '${prompt.id}' already registered in MCP SDK, skipping re-registration`
            );
            this.registeredPromptIds.add(prompt.id); // Track it anyway
            continue;
          } else {
            // Re-throw other errors
            this.logger.error(`Failed to register prompt '${prompt.id}':`, error.message || error);
            throw error;
          }
        }
      }

      this.logger.info(
        `Successfully registered ${registeredCount} of ${prompts.length} prompts with MCP SDK`
      );
    } catch (error) {
      this.logger.error(
        'Error registering individual prompts:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Execute prompt logic (extracted from createPromptHandler for MCP protocol)
   */
  private async executePromptLogic(promptData: ConvertedPrompt, args: any): Promise<any> {
    try {
      this.logger.info(`Executing prompt '${promptData.name}'...`);

      // Check if this is a chain prompt
      if (isChainPrompt(promptData) && promptData.chainSteps && promptData.chainSteps.length > 0) {
        this.logger.info(
          `Prompt '${promptData.name}' is a chain with ${promptData.chainSteps.length} steps. NOT automatically executing the chain.`
        );
        // Note: Chain execution is handled elsewhere
      }

      // Create messages array with only user and assistant roles
      const messages: {
        role: 'user' | 'assistant';
        content: { type: 'text'; text: string };
      }[] = [];

      // Create user message with placeholders replaced
      let userMessageText = promptData.userMessageTemplate;

      // If there's a system message, prepend it to the user message
      if (promptData.systemMessage) {
        userMessageText = `[System Info: ${promptData.systemMessage}]\n\n${userMessageText}`;
      }

      const previousMessageContext = this.conversationManager.getPreviousMessage();

      // Process the template with special context
      // Using direct processing since TemplateProcessor was consolidated
      userMessageText = await this.processTemplateDirect(userMessageText, args, {
        previous_message: previousMessageContext,
      });

      // Store in conversation history for future reference
      this.conversationManager.addToConversationHistory({
        role: 'user',
        content: userMessageText,
        timestamp: Date.now(),
        isProcessedTemplate: true, // Mark as a processed template
      });

      // Push the user message to the messages array
      messages.push({
        role: 'user',
        content: {
          type: 'text',
          text: userMessageText,
        },
      });

      this.logger.debug(`Processed messages for prompt '${promptData.name}':`, messages);
      return { messages };
    } catch (error) {
      this.logger.error(`Error executing prompt '${promptData.name}':`, error);
      throw error; // Re-throw to let the MCP framework handle it
    }
  }

  /**
   * Register all prompts with the MCP server using proper MCP protocol
   */
  async registerAllPrompts(prompts: ConvertedPrompt[]): Promise<number> {
    try {
      this.logger.info(`Registering ${prompts.length} prompts with MCP SDK registerPrompt API...`);

      // Register individual prompts using the correct MCP SDK API
      this.registerIndividualPrompts(prompts);

      this.logger.info(`Successfully registered ${prompts.length} prompts with MCP SDK`);
      return prompts.length;
    } catch (error) {
      this.logger.error(`Error registering prompts:`, error);
      throw error;
    }
  }

  /**
   * Send list_changed notification to clients (for hot-reload)
   * This is the proper MCP way to notify clients about prompt updates
   */
  async notifyPromptsListChanged(): Promise<void> {
    try {
      // Send MCP notification that prompt list has changed
      if (this.mcpServer && typeof this.mcpServer.notification === 'function') {
        this.mcpServer.notification({
          method: 'notifications/prompts/list_changed',
        });
        this.logger.info('✅ Sent prompts/list_changed notification to clients');
      } else {
        this.logger.debug("MCP server doesn't support notifications");
      }
    } catch (error) {
      this.logger.warn('Could not send prompts/list_changed notification:', error);
    }
  }

  // Note: MCP SDK doesn't provide prompt unregistration
  // Hot-reload is handled through list_changed notifications to clients

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

      this.logger.debug(`Running prompt directly: ${promptId} with arguments:`, args);

      // Missing arguments are handled by ArgumentParser's default resolution chain
      // which includes author-defined defaultValue as first priority

      // Process template with context
      // Using direct processing since TemplateProcessor was consolidated
      const userMessageText = await this.processTemplateDirect(
        convertedPrompt.userMessageTemplate,
        args,
        { previous_message: this.conversationManager.getPreviousMessage() }
      );

      // Add the message to conversation history
      this.conversationManager.addToConversationHistory({
        role: 'user',
        content: userMessageText,
        timestamp: Date.now(),
        isProcessedTemplate: true,
      });

      // Generate a response (echo in this MCP implementation)
      const response = `Processed prompt: ${promptId}\nWith message: ${userMessageText}`;

      // Store the response in conversation history
      this.conversationManager.addToConversationHistory({
        role: 'assistant',
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
    categoriesCount: number;
    averageArgumentsPerPrompt: number;
  } {
    const chainPrompts = prompts.filter((p) => isChainPrompt(p)).length;
    const categoriesSet = new Set(prompts.map((p) => p.category));
    const totalArguments = prompts.reduce((sum, p) => sum + p.arguments.length, 0);

    return {
      totalPrompts: prompts.length,
      chainPrompts,
      regularPrompts: prompts.length - chainPrompts,
      categoriesCount: categoriesSet.size,
      averageArgumentsPerPrompt: prompts.length > 0 ? totalArguments / prompts.length : 0,
    };
  }
}
