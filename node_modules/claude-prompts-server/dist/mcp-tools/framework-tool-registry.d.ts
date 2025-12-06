/**
 * Framework Tool Registry
 *
 * Manages framework-specific tool registration and switching.
 * Instead of 3 tools with dynamic descriptions, this registry maintains
 * 12 framework-suffixed tools (3 tools × 4 frameworks), activating only
 * the 3 tools corresponding to the active framework.
 *
 * This approach attempts to trigger client tool cache refresh by changing
 * which tools exist (remove/add operations) rather than just updating descriptions.
 */
import { Logger } from "../logging/index.js";
import type { FrameworkStateManager } from "../frameworks/framework-state-manager.js";
import type { ToolDescriptionManager } from "./tool-description-manager.js";
type CallbackFn = (...args: any[]) => Promise<any> | any;
/**
 * Minimal MCP server interface needed for registering tools.
 */
interface McpServer {
    registerTool(id: string, config: ToolRegistrationConfig, callback: CallbackFn): RegisteredToolHandle;
}
interface RegisteredToolHandle {
    remove: () => void;
    description?: string;
    [key: string]: unknown;
}
interface ToolRegistrationConfig {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
}
interface ToolRegistrationDefinition {
    id: string;
    config: ToolRegistrationConfig;
    callback: CallbackFn;
}
interface ToolRegistrationSet {
    promptEngine: ToolRegistrationDefinition;
    promptManager: ToolRegistrationDefinition;
    systemControl: ToolRegistrationDefinition;
}
type KnownFrameworkId = "CAGEERF" | "REACT" | "5W1H" | "SCAMPER";
type FrameworkId = KnownFrameworkId | string;
interface FrameworkToolStats {
    totalFactories: number;
    registeredFrameworks: number;
    activeTools: number;
    activeFramework: FrameworkId;
}
/**
 * Framework Tool Registry
 *
 * Manages registration and switching of framework-specific tools.
 * Implements GODA-style pattern: change which tools exist rather than updating descriptions.
 */
export declare class FrameworkToolRegistry {
    private readonly logger;
    private readonly mcpServer;
    private frameworkStateManager;
    private toolDescriptionManager;
    private readonly toolSets;
    private readonly toolFactories;
    private readonly FRAMEWORKS;
    private activeFramework;
    constructor(logger: Logger, mcpServer: McpServer, initialFramework?: FrameworkId);
    /**
     * Set framework state manager (called after initialization)
     */
    setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void;
    /**
     * Set tool description manager (called after initialization)
     */
    setToolDescriptionManager(toolDescriptionManager: ToolDescriptionManager): void;
    /**
     * Register tool factories for all framework variants.
     * This stores the configs and callbacks but doesn't register tools yet.
     */
    registerToolFactories(toolRegistrations: ToolRegistrationSet): void;
    /**
     * Get framework-specific description for a tool.
     */
    private getFrameworkDescription;
    /**
     * Register tools for the active framework only.
     * This is called on startup to register the initial 3 tools.
     */
    registerActiveFrameworkTools(): Promise<void>;
    /**
     * Register the 3 tools for a specific framework.
     */
    private registerFrameworkTools;
    /**
     * Switch from one framework to another.
     * Removes old framework's 3 tools and registers new framework's 3 tools.
     *
     * This is the core mechanism to trigger client tool cache refresh.
     */
    switchFramework(from: FrameworkId, to: FrameworkId): Promise<void>;
    /**
     * Get active framework.
     */
    getActiveFramework(): FrameworkId;
    /**
     * Get active tool IDs for current framework.
     */
    getActiveToolIds(): string[];
    /**
     * Get all registered tool IDs across all frameworks.
     */
    getAllRegisteredToolIds(): string[];
    /**
     * Get tool count statistics.
     */
    getToolStats(): FrameworkToolStats;
}
/**
 * Factory function to create FrameworkToolRegistry.
 */
export declare function createFrameworkToolRegistry(logger: Logger, mcpServer: McpServer, initialFramework?: FrameworkId): FrameworkToolRegistry;
export {};
