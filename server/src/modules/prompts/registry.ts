// @lifecycle canonical - Registers prompts with the MCP server and manages conversation integration.
/**
 * Prompt Registry Module
 * Handles registering prompts with MCP server using proper MCP protocol and managing conversation history
 */

import { z } from 'zod/v4';

import { buildLauncherMessages } from './launcher-envelope.js';
import { ConversationStore } from '../text-refs/conversation.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { type Logger } from '#shared/types/index.js';
import { isChainPrompt } from '#shared/utils/chainUtils.js';
// TemplateProcessor functionality consolidated into UnifiedPromptProcessor

/**
 * The slice of `McpServer` this module binds against.
 *
 * Exported because callers hand a specific serving shell to `registerAllPrompts`
 * and need to name its type without reaching through `Parameters<>`.
 */
export type PromptRegistryServer = Pick<McpServer, 'registerPrompt'>;

/**
 * Prompt Registry class
 *
 * Holds two pieces of state with different lifetimes, and the distinction is the
 * whole design:
 *
 * - **Binding** is per serving unit. Protocol revision 2026-07-28 removed
 *   protocol sessions, so `createMcpServerFactory` builds a fresh `McpServer`
 *   per STDIO connection and per HTTP request. Each shell needs its own
 *   `registerPrompt` calls, tracked in `registeredPromptIds`.
 * - **Content** is one live singleton. `livePrompts` is replaced wholesale on
 *   every load and hot reload, and handlers resolve through it at call time
 *   rather than closing over the prompt they were registered with.
 *
 * Keeping content out of the closure is what makes an edited prompt take effect
 * without re-registration — which the SDK rejects anyway once an id is bound.
 */
export class PromptRegistry {
  private logger: Logger;
  private mcpServer: PromptRegistryServer;
  private conversationStore: ConversationStore;
  // templateProcessor removed - functionality consolidated into UnifiedPromptProcessor
  // Dedup is per serving unit: the same prompt legitimately registers once on
  // each shell, so a single flat Set would let the first unit's ids suppress
  // registration on every later one.
  private registeredPromptIds = new WeakMap<PromptRegistryServer, Set<string>>();
  private exportedPromptIds = new Set<string>(); // Prompt IDs exported as skills (auto-deregistered)
  /** Current content for every loaded prompt, keyed by id. Replaced on reload. */
  private livePrompts = new Map<string, ConvertedPrompt>();

  /**
   * Direct template processing method (minimal implementation)
   * Replaces templateProcessor calls for basic template processing
   */
  private async processTemplateDirect(
    template: string,
    args: Record<string, string>,
    specialContext: Record<string, string> = {}
  ): Promise<string> {
    const { processTemplate } = await import('#shared/utils/jsonUtils.js');
    return processTemplate(template, args, specialContext);
  }

  constructor(
    logger: Logger,
    mcpServer: PromptRegistryServer,
    conversationStore: ConversationStore
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.conversationStore = conversationStore;
    // templateProcessor removed - functionality consolidated into UnifiedPromptProcessor
  }

  /** Registered-id set for one serving unit, created on first sight. */
  private registeredIdsFor(target: PromptRegistryServer): Set<string> {
    let ids = this.registeredPromptIds.get(target);
    if (!ids) {
      ids = new Set<string>();
      this.registeredPromptIds.set(target, ids);
    }
    return ids;
  }

  /**
   * Replace the live content every registered handler resolves through.
   *
   * Called on load and on every hot reload. Handlers registered against any
   * shell — including ones bound before this call — serve the new content from
   * their next invocation, which is why an edited prompt needs no re-binding.
   */
  setLivePrompts(prompts: ConvertedPrompt[]): void {
    this.livePrompts = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  }

  /**
   * Current content for a prompt id.
   *
   * Falls back to the definition captured at registration when the id is absent
   * from the live map — a prompt deleted from disk keeps answering with its last
   * known content rather than throwing at a client that still has it listed.
   */
  private resolveLivePrompt(registered: ConvertedPrompt): ConvertedPrompt {
    return this.livePrompts.get(registered.id) ?? registered;
  }

  /**
   * Set prompt IDs that have been exported as client skills via skills-sync.
   * Exported prompts are auto-deregistered from MCP to avoid duplication.
   * Format: "category/id" (e.g., "development/review")
   */
  setExportedPromptIds(ids: Set<string>): void {
    this.exportedPromptIds = ids;
  }

  /**
   * Register individual prompts using MCP SDK registerPrompt API
   * This implements the standard MCP prompts protocol using the high-level API
   */
  private registerIndividualPrompts(
    prompts: ConvertedPrompt[],
    target: PromptRegistryServer
  ): number {
    try {
      this.logger.info('Registering individual prompts with MCP SDK...');
      const registeredIds = this.registeredIdsFor(target);
      let registeredCount = 0;

      for (const prompt of prompts) {
        // Skip MCP registration if disabled (prompt or category level)
        if (prompt.registerWithMcp === false) {
          this.logger.debug(`Skipping MCP registration: ${prompt.id} (registerWithMcp=false)`);
          continue;
        }

        // Skip if exported as a client skill (auto-deregistered via skills-sync.yaml)
        const exportKey = `${prompt.category}/${prompt.id}`;
        if (this.exportedPromptIds.has(exportKey)) {
          this.logger.debug(`Skipping MCP registration: ${prompt.id} (exported as skill)`);
          continue;
        }

        // Skip if already registered on THIS shell (deduplication guard)
        if (registeredIds.has(prompt.id)) {
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
          target.registerPrompt(
            prompt.id,
            {
              // `title` is the human-readable label, distinct from the registered name --
              // the SDK's own example registers `'review-code'` with `title: 'Code Review'`.
              // This passed `prompt.id`, making it byte-identical to the name for 34/34
              // registered prompts: ~775 bytes of zero-information duplication in every
              // `prompts/list`, which clients typically fetch at connect (measured
              // 2026-08-25). Every prompt already authors a real name (`Codebase Protocol
              // Initialization` vs `codebase_protocol_init`); it was simply never sent.
              title: prompt.name || prompt.id,
              description: prompt.description || `Prompt: ${prompt.id}`,
              argsSchema,
            },
            async (args: any) => {
              this.logger.debug(`Executing prompt '${prompt.id}' with args:`, args);
              // Resolve content now, not at registration: a hot reload replaces
              // the live map, and this closure outlives it.
              return await this.executePromptLogic(this.resolveLivePrompt(prompt), args || {});
            }
          );

          // Track the registered prompt
          registeredIds.add(prompt.id);
          registeredCount++;
          this.logger.debug(`Registered prompt: ${prompt.id}`);
        } catch (error: any) {
          if (error.message?.includes('already registered')) {
            // Handle MCP SDK's "already registered" error gracefully
            this.logger.warn(
              `Prompt '${prompt.id}' already registered in MCP SDK, skipping re-registration`
            );
            registeredIds.add(prompt.id); // Track it anyway
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
      return registeredCount;
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

      // Launch mode: route the native MCP prompt invocation through the prompt_engine
      // pipeline (framework/gates/chains/telemetry) instead of plain template expansion.
      // A prompts/get response cannot itself enforce gates or drive chains, so we return
      // a directive that invokes the tool surface (with argument + gate hints inline).
      if (promptData.mcpPromptMode === 'launch') {
        this.logger.info(`Prompt '${promptData.name}' → launcher (routing to prompt_engine)`);
        return { messages: buildLauncherMessages(promptData, args || {}) };
      }

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

      const previousMessageContext = this.conversationStore.getPreviousMessage();

      // Process the template with special context
      // Using direct processing since TemplateProcessor was consolidated
      userMessageText = await this.processTemplateDirect(userMessageText, args, {
        previous_message: previousMessageContext,
      });

      // Store in conversation history for future reference
      this.conversationStore.addToConversationHistory({
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
  async registerAllPrompts(
    prompts: ConvertedPrompt[],
    target: PromptRegistryServer = this.mcpServer
  ): Promise<number> {
    try {
      this.logger.info(`Registering ${prompts.length} prompts with MCP SDK registerPrompt API...`);

      // Content first: handlers bound below resolve through the live map, and
      // handlers bound on earlier shells pick the new content up from here too.
      this.setLivePrompts(prompts);

      // Returns what actually bound, which is lower than `prompts.length`
      // whenever a prompt opts out or is exported as a skill. Reporting the
      // input length instead is what let a fully dead prompt surface log as a
      // success.
      return this.registerIndividualPrompts(prompts, target);
    } catch (error) {
      this.logger.error(`Error registering prompts:`, error);
      throw error;
    }
  }

  // Announcing the list change is NOT this class's job: the registry only ever
  // holds the shell it was constructed with, which no client connects to once
  // binding became per serving unit. `runtime/list-change-notifier.ts` owns the
  // transport choice for all three list kinds — see `publishPromptsChanged`.

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
        { previous_message: this.conversationStore.getPreviousMessage() }
      );

      // Add the message to conversation history
      this.conversationStore.addToConversationHistory({
        role: 'user',
        content: userMessageText,
        timestamp: Date.now(),
        isProcessedTemplate: true,
      });

      // Generate a response (echo in this MCP implementation)
      const response = `Processed prompt: ${promptId}\nWith message: ${userMessageText}`;

      // Store the response in conversation history
      this.conversationStore.addToConversationHistory({
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
