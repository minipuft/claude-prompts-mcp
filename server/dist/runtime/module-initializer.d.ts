/**
 * Initializes framework state, MCP tools, tool descriptions, and prompt registration.
 * Reuses existing managers without duplicating orchestration inside Application.
 */
import { FrameworkStateManager } from '../frameworks/framework-state-manager.js';
import { GateManager } from '../gates/gate-manager.js';
import { McpToolsManager } from '../mcp-tools/index.js';
import { ToolDescriptionManager } from '../mcp-tools/tool-description-manager.js';
import type { RuntimeLaunchOptions } from './options.js';
import type { ConfigManager } from '../config/index.js';
import type { Logger } from '../logging/index.js';
import type { PromptAssetManager } from '../prompts/index.js';
import type { ConversationManager } from '../text-references/conversation.js';
import type { TextReferenceManager } from '../text-references/index.js';
import type { Category, ConvertedPrompt, PromptData, FrameworksConfig } from '../types/index.js';
import type { ServiceManager } from '../utils/service-manager.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export interface ModuleInitCallbacks {
    fullServerRefresh: () => Promise<void>;
    restartServer: (reason: string) => Promise<void>;
    handleFrameworkConfigChange: (config: FrameworksConfig, previous?: FrameworksConfig) => void;
}
export interface ModuleInitParams {
    logger: Logger;
    configManager: ConfigManager;
    runtimeOptions: RuntimeLaunchOptions;
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
    promptManager: PromptAssetManager;
    conversationManager: ConversationManager;
    textReferenceManager: TextReferenceManager;
    mcpServer: McpServer;
    serviceManager: ServiceManager;
    callbacks: ModuleInitCallbacks;
}
export interface ModuleInitResult {
    frameworkStateManager: FrameworkStateManager;
    gateManager: GateManager;
    mcpToolsManager: McpToolsManager;
    toolDescriptionManager: ToolDescriptionManager;
}
export declare function initializeModules(params: ModuleInitParams): Promise<ModuleInitResult>;
