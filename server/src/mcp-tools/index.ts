/**
 * MCP Tools Module - Fully Consolidated Architecture
 *
 * This module provides 3 core MCP tools that have been validated and work correctly:
 *
 * ACTIVE CORE TOOLS:
 * - prompt_engine: Proven execution engine with framework integration
 * - prompt_manager: Complete prompt lifecycle management with filtering
 * - system_control: Framework and system management with analytics
 *
 * REMOVED ENHANCED TOOLS (Phase 1 - 2025-09-26):
 * - prompt-control.ts (663 lines) - Enhanced wrapper removed
 * - prompt-execution.ts (428 lines) - Enhanced wrapper removed
 * - system-management.ts (16,403 lines) - Enhanced wrapper removed
 * - schemas/ directory (1,475 lines) - Over-engineering removed
 * - formatters/ directory (427 lines) - Unnecessary complexity removed
 *
 * ARCHITECTURE BENEFITS:
 * - 2,993 lines of enhanced tool complexity removed
 * - 3 core tools that actually work and register properly
 * - Single source of truth for each functional area
 * - Improved maintainability and reduced complexity
 */

import { z } from "zod";
import { Logger } from "../logging/index.js";
import { PromptManager } from "../prompts/index.js";
import { ConfigManager } from "../config/index.js";
import {
  Category,
  ConvertedPrompt,
  PromptData,
} from "../types/index.js";
// Gate evaluator removed - now using Framework methodology validation
import { createContentAnalyzer } from "../semantic/configurable-semantic-analyzer.js";
import { createSemanticIntegrationFactory } from "../semantic/integrations/index.js";
import { FrameworkStateManager } from "../frameworks/framework-state-manager.js";
import { FrameworkManager, createFrameworkManager } from "../frameworks/framework-manager.js";
import { ConversationManager, createConversationManager } from "../text-references/conversation.js";
// REMOVED: ExecutionCoordinator and ChainOrchestrator - modular chain system removed
import { MetricsCollector, createMetricsCollector } from "../metrics/index.js";

// Consolidated tools
import {
  ConsolidatedPromptEngine,
  createConsolidatedPromptEngine
} from "./prompt-engine/index.js";
import {
  ConsolidatedPromptManager,
  createConsolidatedPromptManager
} from "./prompt-manager.js";
import {
  ConsolidatedSystemControl,
  createConsolidatedSystemControl
} from "./system-control.js";
// Enhanced tools removed - using 3 core tools only (Phase 1.2 completed)
import { ToolDescriptionManager } from "./tool-description-manager.js";
// ChainScaffolderTool removed - functionality consolidated into ConsolidatedPromptEngine

/**
 * Consolidated MCP Tools Manager
 *
 * Manages 3 intelligent consolidated tools that replace the previous 24+ scattered tools
 */
export class ConsolidatedMcpToolsManager {
  private logger: Logger;
  private mcpServer: any;
  private promptManager: PromptManager;
  private configManager: ConfigManager;

  // Consolidated tools (3 instead of 24+)
  private promptEngine!: ConsolidatedPromptEngine;
  private promptManagerTool!: ConsolidatedPromptManager;
  private systemControl!: ConsolidatedSystemControl;
  // Enhanced tools removed (Phase 1.2) - using 3 core tools only
  // chainScaffolder removed - functionality consolidated into promptEngine

  // Shared components
  private semanticAnalyzer!: ReturnType<typeof createContentAnalyzer>;
  private frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  // REMOVED: chainOrchestrator - modular chain system removed
  private conversationManager!: ConversationManager;
  private toolDescriptionManager?: ToolDescriptionManager;
  private analyticsService!: MetricsCollector;
  // Phase 3: Removed executionCoordinator - chains now use LLM-driven execution model

  // Callback references
  private onRestart?: (reason: string) => Promise<void>;

  // Data references
  private promptsData: PromptData[] = [];
  private convertedPrompts: ConvertedPrompt[] = [];
  private categories: Category[] = [];

  // Pending analytics queue for initialization race condition
  private pendingAnalytics: any[] = [];

  constructor(
    logger: Logger,
    mcpServer: any,
    promptManager: PromptManager,
    configManager: ConfigManager,
    // Phase 3: Removed executionCoordinator parameter - using LLM-driven chain model
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.promptManager = promptManager;
    this.configManager = configManager;
    // Phase 3: Removed executionCoordinator assignment - using LLM-driven chain model
  }

  /**
   * Initialize the MCP tools with async configuration
   */
  async initialize(
    onRefresh: () => Promise<void>,
    onRestart: (reason: string) => Promise<void>
  ): Promise<void> {
    // Store callback references
    this.onRestart = onRestart;

    // Initialize shared components with configurable analysis
    const analysisConfig = this.configManager.getSemanticAnalysisConfig();
    const integrationFactory = createSemanticIntegrationFactory(this.logger);
    this.semanticAnalyzer = await integrationFactory.createFromEnvironment(analysisConfig);
    this.conversationManager = createConversationManager(this.logger);
    this.analyticsService = createMetricsCollector(this.logger);

    this.logger.info(`Configurable semantic analyzer initialized (mode: ${analysisConfig.mode})`);

    // Initialize consolidated tools
    this.promptEngine = createConsolidatedPromptEngine(
      this.logger,
      this.mcpServer,
      this.promptManager,
      this.configManager,
      this.semanticAnalyzer,
      this.conversationManager,
      this // Pass manager reference for analytics data flow
      // Phase 3: Removed executionCoordinator - chains now use LLM-driven execution
    );

    this.promptManagerTool = createConsolidatedPromptManager(
      this.logger,
      this.mcpServer,
      this.configManager,
      this.semanticAnalyzer,
      this.frameworkStateManager,
      this.frameworkManager,
      onRefresh,
      onRestart
    );

    // Enhanced tools initialization removed (Phase 1.2)
    // Using 3 core tools: promptEngine, promptManagerTool, systemControl

    this.systemControl = createConsolidatedSystemControl(
      this.logger,
      this.mcpServer,
      onRestart
    );

    // chainScaffolder removed - functionality consolidated into promptEngine

    // Flush any pending analytics data that was queued during initialization
    this.flushPendingAnalytics();

    this.logger.info("Consolidated MCP Tools Manager initialized with 3 intelligent tools (chain management in prompt_engine)");
  }

  /**
   * Set framework state manager (called after initialization)
   */
  setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void {
    this.frameworkStateManager = frameworkStateManager;
    this.promptEngine.setFrameworkStateManager(frameworkStateManager);
    this.systemControl.setFrameworkStateManager(frameworkStateManager);
    this.promptManagerTool.setFrameworkStateManager?.(frameworkStateManager);
    // Enhanced tool framework state management removed (Phase 1.2)
    // Core tools handle framework state directly
  }

  /**
   * Set tool description manager (called after initialization)
   */
  setToolDescriptionManager(manager: ToolDescriptionManager): void {
    this.toolDescriptionManager = manager;

    this.promptEngine.setToolDescriptionManager(manager);
    this.promptEngine.setAnalyticsService(this.analyticsService);
    // promptManagerTool doesn't have setToolDescriptionManager method
    this.systemControl.setToolDescriptionManager?.(manager);
    this.systemControl.setAnalyticsService(this.analyticsService);
    // Enhanced tool description management removed (Phase 1.2)
    // Core tools handle tool descriptions directly

    // Set up hot-reload event listeners
    this.setupToolDescriptionHotReload(manager);

    this.logger.info("Tool description manager set for all MCP tools with hot-reload support");
  }

  /**
   * Setup hot-reload event listeners for tool descriptions
   */
  private setupToolDescriptionHotReload(manager: ToolDescriptionManager): void {
    // Listen for description changes
    manager.on('descriptions-changed', (stats) => {
      this.logger.info(`🔥 Tool descriptions hot-reloaded: ${stats.totalDescriptions} descriptions loaded`);
      this.handleToolDescriptionChange(stats);
    });

    // Listen for reload errors
    manager.on('descriptions-error', (error) => {
      this.logger.error(`❌ Tool description reload failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    // Start file watching if not already watching
    if (!manager.isWatchingFile()) {
      manager.startWatching();
    }
  }

  /**
   * Handle tool description changes
   */
  private async handleToolDescriptionChange(stats: any): Promise<void> {
    try {
      this.logger.info("🔄 Processing tool description changes...");

      // Emit analytics update
      this.updateAnalytics({
        toolDescriptions: {
          lastReload: new Date().toISOString(),
          totalDescriptions: stats.totalDescriptions,
          loadedFromFile: stats.loadedFromFile,
          usingDefaults: stats.usingDefaults
        }
      });

      // Note: MCP SDK doesn't support dynamic tool updates
      // The new descriptions will be loaded on next tool registration or server restart
      this.logger.info("✅ Tool descriptions reloaded from file");
      this.logger.info(`📊 Stats: ${stats.totalDescriptions} total, using ${stats.usingDefaults > 0 ? 'defaults' : 'external config'}`);

      // Check if restart is configured for tool description changes
      const restartOnChange = this.configManager.getConfig().toolDescriptions?.restartOnChange ?? false;

      if (restartOnChange) {
        this.logger.info("🚨 Restart on tool description change is enabled - initiating server restart...");
        // Use the existing restart mechanism
        await this.onRestart?.("Tool descriptions updated - restart required for clients to see new descriptions");
      } else {
        this.logger.info("💡 Tip: New tool descriptions will be used for new client connections. For immediate effect, restart the server manually or enable 'restartOnChange' in config.");
      }

    } catch (error) {
      this.logger.error(`Failed to handle tool description change: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Initialize and set framework manager (called after framework state manager)
   */
  async setFrameworkManager(existingFrameworkManager?: FrameworkManager): Promise<void> {
    if (!this.frameworkManager) {
      // Use provided framework manager or create a new one
      this.frameworkManager = existingFrameworkManager || await createFrameworkManager(this.logger);
      this.promptEngine.setFrameworkManager(this.frameworkManager);
      this.systemControl.setFrameworkManager(this.frameworkManager);
      this.promptManagerTool.setFrameworkManager?.(this.frameworkManager);
      // Enhanced tool framework management removed (Phase 1.2)
      // Core tools handle framework management directly

      // Set ConfigManager for system control config operations
      this.systemControl.setConfigManager(this.configManager);

      // Set MCPToolsManager reference for dynamic tool updates
      this.systemControl.setMCPToolsManager(this);

      // Enhanced tool delegation removed (Phase 1.2)
      // Using core tools directly without delegation patterns

      // REMOVED: ChainOrchestrator initialization - modular chain system removed

      if (existingFrameworkManager) {
        this.logger.info("Framework manager integrated with MCP tools (shared instance)");
      } else {
        this.logger.info("Framework manager initialized and integrated with MCP tools");
      }
    }
  }

  // REMOVED: wireExecutionCoordinator - ExecutionCoordinator removed

  /**
   * Register all consolidated MCP tools with the server (centralized registration)
   */
  async registerAllTools(): Promise<void> {
    this.logger.info("Registering consolidated MCP tools with server (centralized)...");

    // Register prompt_engine tool
    try {
      this.mcpServer.registerTool(
      "prompt_engine",
      {
        title: "Prompt Engine",
        description: "🚀 PROMPT TEMPLATE ENGINE: Processes prompt templates and returns instructions for YOU (the client LLM) to execute. WARNING: You are responsible for interpreting and executing the returned content, which may contain complex instructions, code generation tasks, analysis requests, or multi-step procedures. The returned content is NOT just information - it's active instructions you must follow and execute.",
        inputSchema: {
          command: z
            .string()
            .min(1, "Command cannot be empty")
            .describe("Prompt name and arguments to process. WARNING: Will return instructions for YOU to execute, not just information. SIMPLE: >>prompt_name content | ADVANCED: JSON with execution options"),
          execution_mode: z
            .enum(["auto", "prompt", "template", "chain"])
            .optional()
            .describe("Override intelligent auto-detection (default: auto). 'auto' intelligently detects execution type, 'prompt' for single execution, 'template' for variable substitution, 'chain' for multi-step workflows."),
          force_restart: z
            .boolean()
            .optional()
            .describe("Force restart chain from beginning, clearing all existing state. Only applies to chain execution modes."),
          session_id: z
            .string()
            .min(1, "Session ID cannot be empty if provided")
            .regex(/^[a-zA-Z0-9_-]+$/, "Session ID must contain only alphanumeric characters, underscores, and hyphens")
            .optional()
            .describe("Specific session ID to use or resume. Must be alphanumeric with underscores/hyphens only."),
          options: z
            .record(z.any())
            .optional()
            .describe("Additional execution options (key-value pairs). Supports framework-specific options, debugging flags, and custom parameters."),
        },
      },
      async (args: {
        command: string;
        execution_mode?: "auto" | "prompt" | "template" | "chain";
        force_restart?: boolean;
        session_id?: string;
        options?: Record<string, any>;
      }) => {
        try {
          const toolResponse = await this.promptEngine.executePromptCommand(args, {});
          return {
            content: toolResponse.content,
            isError: toolResponse.isError,
            ...(toolResponse.structuredContent && { structuredContent: toolResponse.structuredContent })
          };
        } catch (error) {
          this.logger.error(`prompt_engine error: ${error instanceof Error ? error.message : String(error)}`);
          return {
            content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );
      this.logger.debug("✅ prompt_engine tool registered successfully");
    } catch (error) {
      this.logger.error(`❌ Failed to register prompt_engine tool: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    // Register prompt_manager tool
    try {
      this.mcpServer.registerTool(
      "prompt_manager",
      {
        title: "Prompt Manager",
        description: "🎯 PROMPT MANAGER: Complete prompt lifecycle management with advanced filtering and smart discovery capabilities. Handles creation, updating, deletion, analysis, and search of prompts with intelligent categorization and context-aware recommendations.",
        inputSchema: {
          action: z
            .enum(["create", "create_prompt", "create_template", "analyze_type", "migrate_type", "update", "delete", "modify", "reload", "list"])
            .describe("Action to perform: create (prompts/templates), analyze_type (detect prompt type), migrate_type (change type), update/modify (edit), delete (remove), reload (refresh), list (search/filter)"),
          id: z
            .string()
            .optional()
            .describe("Prompt ID for update/delete/modify operations"),
          content: z
            .string()
            .optional()
            .describe("Prompt content for create/update operations"),
          category: z
            .string()
            .optional()
            .describe("Category for organization"),
          arguments: z
            .array(z.object({
              name: z.string(),
              type: z.string(),
              description: z.string()
            }))
            .optional()
            .describe("Argument definitions for prompt parameters"),
          search_query: z
            .string()
            .optional()
            .describe("Search query for list operations. Supports filters like 'category:code', 'type:chain', 'confidence:>80', etc."),
          force: z
            .boolean()
            .optional()
            .describe("Force operation without confirmation prompts")
        },
      },
      async (args: {
        action: "create" | "create_prompt" | "create_template" | "analyze_type" | "migrate_type" | "update" | "delete" | "modify" | "reload" | "list";
        [key: string]: any;
      }) => {
        try {
          this.logger.error(`DEBUG: MCP handler called for prompt_manager with action: ${args.action}`);

          // Check if promptManagerTool exists
          if (!this.promptManagerTool) {
            this.logger.error(`ERROR: promptManagerTool is undefined!`);
            return {
              content: [{ type: "text", text: `Error: promptManagerTool is not initialized` }],
              isError: true
            };
          }

          this.logger.error(`DEBUG: promptManagerTool exists, calling handleAction`);

          const toolResponse = await this.promptManagerTool.handleAction(args, {});

          // Debug logging and validation
          if (!toolResponse) {
            this.logger.error(`prompt_manager returned undefined response for action: ${args.action}`);
            return {
              content: [{ type: "text", text: `Error: Tool returned undefined response` }],
              isError: true
            };
          }

          if (!toolResponse.content) {
            this.logger.error(`prompt_manager returned response with undefined content for action: ${args.action}`, toolResponse);
            return {
              content: [{ type: "text", text: `Error: Tool returned response with undefined content` }],
              isError: true
            };
          }

          return {
            content: toolResponse.content,
            isError: toolResponse.isError,
            ...(toolResponse.structuredContent && { structuredContent: toolResponse.structuredContent })
          };
        } catch (error) {
          this.logger.error(`prompt_manager error: ${error instanceof Error ? error.message : String(error)}`);
          return {
            content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );
      this.logger.debug("✅ prompt_manager tool registered successfully");
    } catch (error) {
      this.logger.error(`❌ Failed to register prompt_manager tool: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    // Register system_control tool
    try {
      this.mcpServer.registerTool(
      "system_control",
      {
        title: "System Control",
        description: "⚙️ SYSTEM CONTROL: Framework and system management with comprehensive analytics, health monitoring, and configuration control. Handles framework switching, system diagnostics, performance metrics, and server management operations.",
        inputSchema: {
          action: z
            .string()
            .describe("Action to perform: status, framework, analytics, config, maintenance"),
          operation: z
            .string()
            .optional()
            .describe("Sub-operation to perform (required for framework action): switch, list, enable, disable"),
          framework: z
            .string()
            .optional()
            .describe("Framework name for framework switch operation (CAGEERF, ReACT, 5W1H, SCAMPER)"),
          config_path: z
            .string()
            .optional()
            .describe("Configuration path for config operations"),
          config_value: z
            .any()
            .optional()
            .describe("Configuration value for update operations"),
          restart_reason: z
            .string()
            .optional()
            .describe("Reason for server restart (for logging and user notification)"),
          reason: z
            .string()
            .optional()
            .describe("Reason for the operation (framework switching, maintenance, etc.)"),
          include_history: z
            .boolean()
            .optional()
            .describe("Include historical data in response"),
          include_metrics: z
            .boolean()
            .optional()
            .describe("Include performance metrics in response"),
          show_details: z
            .boolean()
            .optional()
            .describe("Show detailed information in response")
        },
      },
      async (args: {
        action: string;
        [key: string]: any;
      }) => {
        try {
          const toolResponse = await this.systemControl.handleAction(args, {});
          return {
            content: toolResponse.content,
            isError: toolResponse.isError,
            ...(toolResponse.structuredContent && { structuredContent: toolResponse.structuredContent })
          };
        } catch (error) {
          this.logger.error(`system_control error: ${error instanceof Error ? error.message : String(error)}`);
          return {
            content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );
      this.logger.debug("✅ system_control tool registered successfully");
    } catch (error) {
      this.logger.error(`❌ Failed to register system_control tool: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    this.logger.info("🎉 Centralized MCP tools registered successfully!");
    this.logger.info("📊 Core Tools: 3 centrally managed tools");
    this.logger.info("🚀 Active Tools: prompt_engine, prompt_manager, system_control");

    // Log available tools for user reference
    const toolSummary = [
      "Available Core Tools (centralized registration):",
      "🎯 prompt_engine - Centralized prompt execution engine",
      "🎯 prompt_manager - Centralized prompt lifecycle management",
      "⚙️ system_control - Centralized framework and system management"
    ].join("\n   ");

    this.logger.info(toolSummary);
  }

  /**
   * Re-register all tools with updated descriptions (for framework switching) - centralized version
   */
  async reregisterToolsWithUpdatedDescriptions(): Promise<void> {
    this.logger.info("Re-registering tools with updated descriptions (centralized)...");

    try {
      // Simply call the centralized registration method
      await this.registerAllTools();

      // Notify MCP clients that tool list has changed
      if (this.mcpServer?.server?.sendToolListChanged) {
        await this.mcpServer.server.sendToolListChanged();
        this.logger.info("✅ Sent tool list changed notification to MCP clients");
      } else {
        this.logger.warn("⚠️ MCP server does not support sendToolListChanged notification");
      }

      this.logger.info("🎉 Tools re-registered successfully with updated descriptions (centralized)!");
    } catch (error) {
      this.logger.error(`Failed to re-register tools: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Update internal data references
   */
  updateData(
    promptsData: PromptData[],
    convertedPrompts: ConvertedPrompt[],
    categories: Category[]
  ): void {
    this.promptsData = promptsData;
    this.convertedPrompts = convertedPrompts;
    this.categories = categories;

    // Update all consolidated tools with new data
    this.promptEngine.updateData(promptsData, convertedPrompts);
    this.promptManagerTool.updateData(promptsData, convertedPrompts, categories);
    // Enhanced tool updateData calls removed (Phase 1.2)
    // Core tools handle data updates directly
    // chainScaffolder removed - functionality consolidated into promptEngine
  }

  /**
   * Update system analytics (from consolidated tools)
   */
  updateAnalytics(analytics: any): void {
    if (this.systemControl) {
      this.systemControl.updateAnalytics(analytics);
    } else {
      // Queue analytics data until systemControl is initialized
      this.pendingAnalytics.push(analytics);
      this.logger.debug(`SystemControl not yet initialized, queued analytics data (${this.pendingAnalytics.length} pending)`);
    }
  }

  /**
   * Flush pending analytics data to systemControl after initialization
   */
  private flushPendingAnalytics(): void {
    if (this.systemControl && this.pendingAnalytics.length > 0) {
      this.logger.debug(`Flushing ${this.pendingAnalytics.length} pending analytics updates`);
      this.pendingAnalytics.forEach(analytics => {
        this.systemControl.updateAnalytics(analytics);
      });
      this.pendingAnalytics = [];
    }
  }

  /**
   * Shutdown all components and cleanup resources
   */
  shutdown(): void {
    this.logger.info("🛑 Shutting down MCP tools manager...");

    // Shutdown tool description manager and stop file watching
    if (this.toolDescriptionManager) {
      this.toolDescriptionManager.shutdown();
      this.logger.info("✅ Tool description manager shut down");
    }

    // Clear pending analytics
    this.pendingAnalytics = [];

    this.logger.info("✅ MCP tools manager shutdown completed");
  }
}

/**
 * Create consolidated MCP tools manager
 */
export async function createConsolidatedMcpToolsManager(
  logger: Logger,
  mcpServer: any,
  promptManager: PromptManager,
  configManager: ConfigManager,
  onRefresh: () => Promise<void>,
  onRestart: (reason: string) => Promise<void>
  // Phase 3: Removed executionCoordinator parameter - using LLM-driven chain model
): Promise<ConsolidatedMcpToolsManager> {
  const manager = new ConsolidatedMcpToolsManager(
    logger,
    mcpServer,
    promptManager,
    configManager
    // Phase 3: Removed executionCoordinator parameter
  );
  
  await manager.initialize(onRefresh, onRestart);
  return manager;
}

// Legacy compatibility - export the consolidated manager as the old name
export { ConsolidatedMcpToolsManager as McpToolsManager };
export const createMcpToolsManager = createConsolidatedMcpToolsManager;