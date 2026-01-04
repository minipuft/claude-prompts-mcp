/**
 * MCP Tools Module - Consolidated Architecture
 *
 * This module provides 3 core MCP tools with framework-aware descriptions:
 *
 * CORE TOOLS:
 * - prompt_engine: Universal execution engine with framework integration
 * - system_control: Framework and system management with analytics
 * - resource_manager: Unified CRUD for prompts, gates, and methodologies
 *
 * ARCHITECTURE:
 * - Framework-aware tool descriptions that change based on active methodology
 * - Single source of truth for each functional area
 * - Integrated ToolDescriptionManager for dynamic descriptions
 * - Improved maintainability and clear separation of concerns
 */
import { ToolDescriptionManager } from './tool-description-manager.js';
import { ConfigManager } from '../config/index.js';
import { FrameworkManager } from '../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../frameworks/framework-state-manager.js';
import { Logger } from '../logging/index.js';
import { PromptAssetManager } from '../prompts/index.js';
import { ConversationManager } from '../text-references/conversation.js';
import { TextReferenceManager } from '../text-references/index.js';
import { Category, ConvertedPrompt, PromptData, ToolResponse } from '../types/index.js';
import { ServiceManager } from '../utils/service-manager.js';
import type { GateManager } from '../gates/gate-manager.js';
/**
 * Consolidated MCP Tools Manager
 *
 * Manages 3 intelligent consolidated tools: prompt_engine, system_control, resource_manager
 */
export declare class ConsolidatedMcpToolsManager {
    private logger;
    private mcpServer;
    private promptManager;
    private configManager;
    private promptExecutionService;
    private promptManagerTool;
    private systemControl;
    private gateManagerTool;
    private frameworkManagerTool;
    private resourceManagerRouter?;
    private semanticAnalyzer;
    private frameworkStateManager?;
    private frameworkManager?;
    private conversationManager;
    private textReferenceManager;
    private toolDescriptionManager?;
    private gateSystemManager?;
    private gateManager;
    private analyticsService;
    private serviceManager;
    private onRestart?;
    private promptsData;
    private convertedPrompts;
    private categories;
    private pendingAnalytics;
    private toolsInitialized;
    constructor(logger: Logger, mcpServer: any, promptManager: PromptAssetManager, configManager: ConfigManager, conversationManager: ConversationManager, textReferenceManager: TextReferenceManager, serviceManager: ServiceManager | undefined, gateManager: GateManager);
    /**
     * Initialize the MCP tools with async configuration
     */
    initialize(onRefresh: () => Promise<void>, onRestart: (reason: string) => Promise<void>): Promise<void>;
    /**
     * Set framework state manager (called after initialization)
     */
    setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void;
    /**
     * Set tool description manager (called after initialization)
     */
    setToolDescriptionManager(manager: ToolDescriptionManager): void;
    /**
     * Setup hot-reload event listeners for tool descriptions
     */
    private setupToolDescriptionHotReload;
    /**
     * Handle tool description changes
     */
    private handleToolDescriptionChange;
    /**
     * Initialize and set framework manager (called after framework state manager)
     */
    setFrameworkManager(existingFrameworkManager?: FrameworkManager): Promise<void>;
    /**
     * Expose the framework manager for runtime integrations (e.g., methodology hot reload).
     */
    getFrameworkManager(): FrameworkManager | undefined;
    /**
     * Get resource manager handler for auto-execute functionality.
     * Returns a function that can execute resource_manager actions internally.
     */
    getResourceManagerHandler(): ((args: Record<string, unknown>, context: Record<string, unknown>) => Promise<import('../types/index.js').ToolResponse>) | null;
    /**
     * Register all consolidated MCP tools with the server (centralized registration)
     */
    registerAllTools(): Promise<void>;
    /**
     * Update tool descriptions for framework switching without re-registering tools.
     * The MCP SDK does not support re-registering already registered tools.
     * Instead, we sync the description manager and notify clients of the change.
     */
    reregisterToolsWithUpdatedDescriptions(): Promise<void>;
    /**
     * Update internal data references
     */
    updateData(promptsData: PromptData[], convertedPrompts: ConvertedPrompt[], categories: Category[]): void;
    /**
     * Update system analytics (from consolidated tools)
     */
    updateAnalytics(analytics: any): void;
    /**
     * Internal entry point for modules that need to reuse prompt_manager actions
     * without going through the MCP transport (e.g., ApiManager). Keeps prompt
     * mutations flowing through the canonical tool implementation.
     */
    runPromptManagerAction(args: PromptManagerActionArgs): Promise<ToolResponse>;
    /**
     * Flush pending analytics data to systemControl after initialization
     */
    private flushPendingAnalytics;
    /**
     * Shutdown all components and cleanup resources
     */
    shutdown(): void;
}
/**
 * Create consolidated MCP tools manager
 */
export declare function createConsolidatedMcpToolsManager(logger: Logger, mcpServer: any, promptManager: PromptAssetManager, configManager: ConfigManager, conversationManager: ConversationManager, textReferenceManager: TextReferenceManager, lifecycleServices: ServiceManager | undefined, onRefresh: () => Promise<void>, onRestart: (reason: string) => Promise<void>, gateManager: GateManager): Promise<ConsolidatedMcpToolsManager>;
export { ConsolidatedMcpToolsManager as McpToolsManager };
export declare const createMcpToolsManager: typeof createConsolidatedMcpToolsManager;
export type PromptManagerActionArgs = {
    action: 'create' | 'analyze_type' | 'update' | 'delete' | 'reload' | 'list' | 'inspect' | 'analyze_gates' | 'guide';
    [key: string]: any;
};
