/**
 * Prompt Registry Module
 * Handles registering prompts with MCP server using proper MCP protocol and managing conversation history
 */
import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { ConversationManager } from '../text-references/conversation.js';
import { ConvertedPrompt } from '../types/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Prompt Registry class
 */
type PromptRegistryServer = Pick<McpServer, 'registerPrompt'> & {
    notification?: (notification: {
        method: string;
        params?: unknown;
    }) => void;
};
export declare class PromptRegistry {
    private logger;
    private mcpServer;
    private configManager;
    private conversationManager;
    private registeredPromptIds;
    /**
     * Direct template processing method (minimal implementation)
     * Replaces templateProcessor calls for basic template processing
     */
    private processTemplateDirect;
    constructor(logger: Logger, mcpServer: PromptRegistryServer, configManager: ConfigManager, conversationManager: ConversationManager);
    /**
     * Register individual prompts using MCP SDK registerPrompt API
     * This implements the standard MCP prompts protocol using the high-level API
     */
    private registerIndividualPrompts;
    /**
     * Execute prompt logic (extracted from createPromptHandler for MCP protocol)
     */
    private executePromptLogic;
    /**
     * Register all prompts with the MCP server using proper MCP protocol
     */
    registerAllPrompts(prompts: ConvertedPrompt[]): Promise<number>;
    /**
     * Send list_changed notification to clients (for hot-reload)
     * This is the proper MCP way to notify clients about prompt updates
     */
    notifyPromptsListChanged(): Promise<void>;
    /**
     * Execute a prompt directly (for testing or internal use)
     */
    executePromptDirectly(promptId: string, args: Record<string, string>, prompts: ConvertedPrompt[]): Promise<string>;
    /**
     * Get registration statistics
     */
    getRegistrationStats(prompts: ConvertedPrompt[]): {
        totalPrompts: number;
        chainPrompts: number;
        regularPrompts: number;
        categoriesCount: number;
        averageArgumentsPerPrompt: number;
    };
}
export {};
