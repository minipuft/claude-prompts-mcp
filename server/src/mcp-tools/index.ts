/**
 * MCP Tools Module - Consolidated Architecture
 *
 * This module provides 3 core MCP tools with framework-aware descriptions:
 *
 * CORE TOOLS:
 * - prompt_engine: Universal execution engine with framework integration
 * - prompt_manager: Complete prompt lifecycle management with intelligent filtering
 * - system_control: Framework and system management with analytics
 *
 * ARCHITECTURE:
 * - Framework-aware tool descriptions that change based on active methodology
 * - Single source of truth for each functional area
 * - Integrated ToolDescriptionManager for dynamic descriptions
 * - Improved maintainability and clear separation of concerns
 */

import { z } from "zod";
import { ConfigManager } from "../config/index.js";
import { Logger } from "../logging/index.js";
import { PromptManager } from "../prompts/index.js";
import { Category, ConvertedPrompt, PromptData } from "../types/index.js";
// Gate evaluator removed - now using Framework methodology validation
import {
  FrameworkManager,
  createFrameworkManager,
} from "../frameworks/framework-manager.js";
import { FrameworkStateManager } from "../frameworks/framework-state-manager.js";
import { createContentAnalyzer } from "../semantic/configurable-semantic-analyzer.js";
import { createSemanticIntegrationFactory } from "../semantic/integrations/index.js";
import {
  ConversationManager,
  createConversationManager,
} from "../text-references/conversation.js";
import {
  TextReferenceManager,
  createTextReferenceManager,
} from "../text-references/index.js";
// REMOVED: ExecutionCoordinator and ChainOrchestrator - modular chain system removed
import { MetricsCollector, createMetricsCollector } from "../metrics/index.js";

// Consolidated tools
import {
  ConsolidatedPromptEngine,
  createConsolidatedPromptEngine,
} from "./prompt-engine/index.js";
import {
  ConsolidatedPromptManager,
  createConsolidatedPromptManager,
} from "./prompt-manager/index.js";
import {
  ConsolidatedSystemControl,
  createConsolidatedSystemControl,
} from "./system-control.js";
import { ToolDescriptionManager } from "./tool-description-manager.js";
// Gate system management integration
import {
  GateSystemManager,
  createGateSystemManager,
} from "../gates/gate-state-manager.js";

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
  // Core tools: prompt engine, manager, and system control

  // Shared components
  private semanticAnalyzer!: ReturnType<typeof createContentAnalyzer>;
  private frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  // REMOVED: chainOrchestrator - modular chain system removed
  private conversationManager!: ConversationManager;
  private textReferenceManager!: TextReferenceManager;
  private toolDescriptionManager?: ToolDescriptionManager;
  private gateSystemManager?: GateSystemManager;
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
    configManager: ConfigManager
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
    this.semanticAnalyzer = await integrationFactory.createFromEnvironment(
      analysisConfig
    );
    this.conversationManager = createConversationManager(this.logger);
    this.textReferenceManager = createTextReferenceManager(this.logger);
    this.analyticsService = createMetricsCollector(this.logger);

    // Initialize gate system manager for runtime gate control
    this.gateSystemManager = createGateSystemManager(this.logger, undefined);
    await this.gateSystemManager.initialize();

    // Integrate text reference manager with conversation manager
    this.conversationManager.setTextReferenceManager(this.textReferenceManager);

    this.logger.info(
      `Configurable semantic analyzer initialized (mode: ${analysisConfig.mode})`
    );

    // Initialize consolidated tools
    this.promptEngine = createConsolidatedPromptEngine(
      this.logger,
      this.mcpServer,
      this.promptManager,
      this.configManager,
      this.semanticAnalyzer,
      this.conversationManager,
      this.textReferenceManager,
      this // Pass manager reference for analytics data flow
      // Phase 3: Removed executionCoordinator - chains now use LLM-driven execution
    );

    // Set gate system manager in prompt engine
    this.promptEngine.setGateSystemManager(this.gateSystemManager);

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

    // Initialize 3 core consolidated tools

    this.systemControl = createConsolidatedSystemControl(
      this.logger,
      this.mcpServer,
      onRestart
    );

    // Set gate system manager in system control
    this.systemControl.setGateSystemManager(this.gateSystemManager);
    this.systemControl.setGateGuidanceRenderer(
      this.promptEngine.getGateGuidanceRenderer()
    );

    // chainScaffolder removed - functionality consolidated into promptEngine

    // Flush any pending analytics data that was queued during initialization
    this.flushPendingAnalytics();

    this.logger.info(
      "Consolidated MCP Tools Manager initialized with 3 intelligent tools (chain management in prompt_engine)"
    );
  }

  /**
   * Set framework state manager (called after initialization)
   */
  setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void {
    this.frameworkStateManager = frameworkStateManager;
    this.promptEngine.setFrameworkStateManager(frameworkStateManager);
    this.systemControl.setFrameworkStateManager(frameworkStateManager);
    this.promptManagerTool.setFrameworkStateManager?.(frameworkStateManager);
    // FIXED: Synchronize Framework Manager with Framework State Manager to prevent injection duplication
    if (this.frameworkManager) {
      this.frameworkManager.setFrameworkStateManager(frameworkStateManager);
    }
    // Core tools handle framework state integration
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
    // Core tools integrated with framework-aware descriptions

    // Set up hot-reload event listeners
    this.setupToolDescriptionHotReload(manager);

    this.logger.info(
      "Tool description manager set for all MCP tools with hot-reload support"
    );
  }

  /**
   * Setup hot-reload event listeners for tool descriptions
   */
  private setupToolDescriptionHotReload(manager: ToolDescriptionManager): void {
    // Listen for description changes
    manager.on("descriptions-changed", (stats) => {
      this.logger.info(
        `🔥 Tool descriptions hot-reloaded: ${stats.totalDescriptions} descriptions loaded`
      );
      this.handleToolDescriptionChange(stats);
    });

    // Listen for reload errors
    manager.on("descriptions-error", (error) => {
      this.logger.error(
        `❌ Tool description reload failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
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
          usingDefaults: stats.usingDefaults,
        },
      });

      // Note: MCP SDK doesn't support dynamic tool updates
      // The new descriptions will be loaded on next tool registration or server restart
      this.logger.info("✅ Tool descriptions reloaded from file");
      this.logger.info(
        `📊 Stats: ${stats.totalDescriptions} total, using ${
          stats.usingDefaults > 0 ? "defaults" : "external config"
        }`
      );

      // Check if restart is configured for tool description changes
      const restartOnChange =
        this.configManager.getConfig().toolDescriptions?.restartOnChange ??
        false;

      if (restartOnChange) {
        this.logger.info(
          "🚨 Restart on tool description change is enabled - initiating server restart..."
        );
        // Use the existing restart mechanism
        await this.onRestart?.(
          "Tool descriptions updated - restart required for clients to see new descriptions"
        );
      } else {
        this.logger.info(
          "💡 Tip: New tool descriptions will be used for new client connections. For immediate effect, restart the server manually or enable 'restartOnChange' in config."
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle tool description change: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Initialize and set framework manager (called after framework state manager)
   */
  async setFrameworkManager(
    existingFrameworkManager?: FrameworkManager
  ): Promise<void> {
    if (!this.frameworkManager) {
      // Use provided framework manager or create a new one
      this.frameworkManager =
        existingFrameworkManager || (await createFrameworkManager(this.logger));
      this.promptEngine.setFrameworkManager(this.frameworkManager);
      this.systemControl.setFrameworkManager(this.frameworkManager);
      this.promptManagerTool.setFrameworkManager?.(this.frameworkManager);
      // Core tools integrated with framework management

      // Set ConfigManager for system control config operations
      this.systemControl.setConfigManager(this.configManager);

      // Set MCPToolsManager reference for dynamic tool updates
      this.systemControl.setMCPToolsManager(this);

      // Enhanced tool delegation removed (Phase 1.2)
      // Using core tools directly without delegation patterns

      // REMOVED: ChainOrchestrator initialization - modular chain system removed

      if (existingFrameworkManager) {
        this.logger.info(
          "Framework manager integrated with MCP tools (shared instance)"
        );
      } else {
        this.logger.info(
          "Framework manager initialized and integrated with MCP tools"
        );
      }
    }
  }

  // REMOVED: wireExecutionCoordinator - ExecutionCoordinator removed

  /**
   * Register all consolidated MCP tools with the server (centralized registration)
   */
  async registerAllTools(): Promise<void> {
    this.logger.info(
      "Registering consolidated MCP tools with server (centralized)..."
    );

    // Get current framework state for dynamic descriptions
    const frameworkEnabled =
      this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false;
    const activeFramework = this.frameworkStateManager?.getActiveFramework();
    const activeMethodology =
      activeFramework?.methodology ?? activeFramework?.id;

    this.logger.info(`🔧 Registering tools with framework-aware descriptions:`);
    this.logger.info(`   Framework enabled: ${frameworkEnabled}`);
    this.logger.info(`   Active framework: ${activeFramework?.id || "none"}`);
    this.logger.info(`   Active methodology: ${activeMethodology || "none"}`);
    this.logger.info(
      `   Tool description manager: ${
        this.toolDescriptionManager ? "available" : "not available"
      }`
    );

    // Register prompt_engine tool
    try {
      // Get dynamic description based on current framework state
      const promptEngineDescription =
        this.toolDescriptionManager?.getDescription(
          "prompt_engine",
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ??
        "🚀 PROMPT ENGINE [HOT-RELOAD]: Processes Nunjucks templates, returns executable instructions. WARNING: Output contains instructions YOU must execute (code gen, analysis, multi-step tasks) - not just information. IMPORTANT: When your arguments include newlines or structured blocks, wrap the call in JSON so the parser receives a single-line command shell.";

      const getPromptEngineParamDescription = (
        paramName: string,
        fallback: string
      ) =>
        this.toolDescriptionManager?.getParameterDescription(
          "prompt_engine",
          paramName,
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ?? fallback;

      // Log which description source is being used for transparency
      if (this.toolDescriptionManager) {
        this.logger.info(
          `   prompt_engine: Using ToolDescriptionManager (framework: ${frameworkEnabled}, methodology: ${activeMethodology})`
        );
      } else {
        this.logger.info(
          `   prompt_engine: Using fallback description (ToolDescriptionManager not available)`
        );
      }

      this.mcpServer.registerTool(
        "prompt_engine",
        {
          title: "Prompt Engine",
          description: promptEngineDescription,
          inputSchema: {
            command: z
              .string()
              .min(1, "Command cannot be empty")
              .describe(
                getPromptEngineParamDescription(
                  "command",
                  "Prompt name and arguments to process. WARNING: Will return instructions for YOU to execute, not just information. SIMPLE: >>prompt_name content (single-line arguments only). MULTI-LINE / RICH FORMATTING: {\\\"command\\\": \\\" >>prompt_name\\\", \\\"args\\\":{...}} keeps payload intact. ADVANCED: JSON with execution options"
                )
              ),
            execution_mode: z
              .enum(["auto", "prompt", "template", "chain"])
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  "execution_mode",
                  "Override intelligent auto-detection (default: auto). 'auto' intelligently detects execution type, 'prompt' for single execution, 'template' for variable substitution, 'chain' for multi-step workflows"
                )
              ),
            gate_validation: z
              .boolean()
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  "gate_validation",
                  "Quality gate validation (MANDATORY for chains, auto-detected by default, see metadata sections for gate details)"
                )
              ),
            step_confirmation: z
              .boolean()
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  "step_confirmation",
                  "Require confirmation between chain steps"
                )
              ),
            llm_driven_execution: z
              .boolean()
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  "llm_driven_execution",
                  "Enable LLM-driven chain step coordination (requires semantic LLM integration)"
                )
              ),
            force_restart: z
              .boolean()
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  "force_restart",
                  "Force restart chain from beginning, clearing all existing state"
                )
              ),
            session_id: z
              .string()
              .min(1, "Session ID cannot be empty if provided")
              .regex(
                /^[a-zA-Z0-9_-]+$/,
                "Session ID must contain only alphanumeric characters, underscores, and hyphens"
              )
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  "session_id",
                  "Specific session ID to use or resume"
                )
              ),
            chain_uri: z
              .string()
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  "chain_uri",
                  "Full chain URI for precise session control (e.g., chain://research_pipeline/session-abc123?force_restart=true)"
                )
              ),
            timeout: z
              .number()
              .int()
              .positive()
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  "timeout",
                  "Execution timeout in milliseconds"
                )
              ),
            options: z
              .record(z.any())
              .optional()
              .describe(
                getPromptEngineParamDescription(
                  "options",
                  "Additional execution options (key-value pairs). Supports framework-specific flags, debugging controls, and experimental features"
                )
              ),
          },
        },
        async (args: {
          command: string;
          execution_mode?: "auto" | "prompt" | "template" | "chain";
          gate_validation?: boolean;
          step_confirmation?: boolean;
          llm_driven_execution?: boolean;
          force_restart?: boolean;
          session_id?: string;
          chain_uri?: string;
          timeout?: number;
          options?: Record<string, any>;
        }) => {
          try {
            const toolResponse = await this.promptEngine.executePromptCommand(
              args,
              {}
            );
            return {
              content: toolResponse.content,
              isError: toolResponse.isError,
              ...(toolResponse.structuredContent && {
                structuredContent: toolResponse.structuredContent,
              }),
            };
          } catch (error) {
            this.logger.error(
              `prompt_engine error: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
              ],
              isError: true,
            };
          }
        }
      );
      this.logger.debug("✅ prompt_engine tool registered successfully");
    } catch (error) {
      this.logger.error(
        `❌ Failed to register prompt_engine tool: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }

    // Register prompt_manager tool
    try {
      // Get dynamic description based on current framework state
      const promptManagerDescription =
        this.toolDescriptionManager?.getDescription(
          "prompt_manager",
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ??
        "🧰 PROMPT MANAGER: Create, update, delete, list, and analyze prompts. Supports gate configuration, temporary gates, and prompt-type migration.";

      const getPromptManagerParamDescription = (
        paramName: string,
        fallback: string
      ) =>
        this.toolDescriptionManager?.getParameterDescription(
          "prompt_manager",
          paramName,
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ?? fallback;

      // Log which description source is being used for transparency
      if (this.toolDescriptionManager) {
        this.logger.info(
          `   prompt_manager: Using ToolDescriptionManager (framework: ${frameworkEnabled}, methodology: ${activeMethodology})`
        );
      } else {
        this.logger.info(
          `   prompt_manager: Using fallback description (ToolDescriptionManager not available)`
        );
      }

      this.mcpServer.registerTool(
        "prompt_manager",
        {
          title: "Prompt Manager",
          description: promptManagerDescription,
          inputSchema: {
            action: z
              .enum([
                "create",
                "create_prompt",
                "create_template",
                "analyze_type",
                "migrate_type",
                "update",
                "delete",
                "modify",
                "reload",
                "list",
                "analyze_gates",
                "suggest_temporary_gates",
                "create_with_gates",
                "update_gates",
                "add_temporary_gates",
              ])
              .describe(
                getPromptManagerParamDescription(
                  "action",
                  "Action to perform. Supported: create, create_prompt, create_template, create_with_gates, update, delete, modify, reload, list, analyze_type, migrate_type, analyze_gates, update_gates, add_temporary_gates, suggest_temporary_gates."
                )
              ),
            id: z
              .string()
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "id",
                  "Prompt identifier. Required for create*, update, delete, modify, analyze_type, migrate_type, analyze_gates, update_gates, add_temporary_gates. Use letters, numbers, underscores, or hyphens."
                )
              ),
            name: z
              .string()
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "name",
                  "Friendly prompt name. Required for create*, create_with_gates."
                )
              ),
            description: z
              .string()
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "description",
                  "Short description of the prompt purpose. Required for create*, create_with_gates."
                )
              ),
            user_message_template: z
              .string()
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "user_message_template",
                  "Prompt body with Nunjucks placeholders (e.g. 'Analyze {{input}}'). Required for create*, create_with_gates."
                )
              ),
            system_message: z
              .string()
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "system_message",
                  "Optional system message to store with the prompt."
                )
              ),
            content: z
              .string()
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "content",
                  "Full prompt content for create/update operations when not using templates."
                )
              ),
            category: z
              .string()
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "category",
                  "Category label used for filtering and organization."
                )
              ),
            arguments: z
              .array(
                z.object({
                  name: z.string(),
                  type: z.string(),
                  description: z.string(),
                })
              )
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "arguments",
                  "Array of argument definitions ({name, type, description}) for prompts with structured inputs."
                )
              ),
            suggested_gates: z
              .array(
                z.object({
                  type: z.enum(['validation', 'quality', 'approval', 'condition', 'guidance']),
                  name: z.string(),
                  description: z.string(),
                  criteria: z.array(z.string()).optional(),
                })
              )
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "suggested_gates",
                  "Gate suggestions used by create_with_gates. Each entry should include type, name, description, and optional criteria."
                )
              ),
            gate_configuration: z
              .object({
                include: z.array(z.string()).optional(),
                exclude: z.array(z.string()).optional(),
                temporary_gates: z.array(z.any()).optional(),
                framework_gates: z.boolean().optional(),
              })
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "gate_configuration",
                  "Explicit gate configuration (include/exclude lists, temporary gates, framework_gates flag)."
                )
              ),
            temporary_gates: z
              .array(z.any())
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "temporary_gates",
                  "Temporary gate definitions used by add_temporary_gates (include name, type, scope, description, guidance, pass_criteria)."
                )
              ),
            gate_scope: z
              .enum(['execution', 'session', 'chain', 'step'])
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "gate_scope",
                  "Scope for temporary gates (execution, session, chain, step)."
                )
              ),
            inherit_chain_gates: z
              .boolean()
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "inherit_chain_gates",
                  "When true, inherit gates from the parent chain (default true for add_temporary_gates)."
                )
              ),
            search_query: z
              .string()
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "search_query",
                  "Search expression for list (e.g. 'category:code type:chain')."
                )
              ),
            force: z
              .boolean()
              .optional()
              .describe(
                getPromptManagerParamDescription(
                  "force",
                  "Bypass confirmation prompts for supported actions."
                )
              ),
          },
        },
        async (args: {
          action:
            | "create"
            | "create_prompt"
            | "create_template"
            | "analyze_type"
            | "migrate_type"
            | "update"
            | "delete"
            | "modify"
            | "reload"
            | "list"
            | "analyze_gates"
            | "suggest_temporary_gates"
            | "create_with_gates"
            | "update_gates"
            | "add_temporary_gates";
          [key: string]: any;
        }) => {
          try {
            // Check if promptManagerTool exists
            if (!this.promptManagerTool) {
              this.logger.error(`ERROR: promptManagerTool is undefined!`);
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: promptManagerTool is not initialized`,
                  },
                ],
                isError: true,
              };
            }

            // CRITICAL: Adding error-level logging to trace MCP tool invocation
            this.logger.error(`[GATE-TRACE] 🔥 MCP TOOL INVOCATION: About to call promptManagerTool.handleAction for action: ${args.action}`);
            this.logger.error(`[GATE-TRACE] 🔥 MCP args being passed:`, args);

            const toolResponse = await this.promptManagerTool.handleAction(
              args,
              {}
            );

            this.logger.error(`[GATE-TRACE] 🔥 MCP TOOL RESPONSE: handleAction completed for action: ${args.action}`);

            // Debug logging and validation
            if (!toolResponse) {
              this.logger.error(
                `prompt_manager returned undefined response for action: ${args.action}`
              );
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: Tool returned undefined response`,
                  },
                ],
                isError: true,
              };
            }

            if (!toolResponse.content) {
              this.logger.error(
                `prompt_manager returned response with undefined content for action: ${args.action}`,
                toolResponse
              );
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: Tool returned response with undefined content`,
                  },
                ],
                isError: true,
              };
            }

            return {
              content: toolResponse.content,
              isError: toolResponse.isError,
              ...(toolResponse.structuredContent && {
                structuredContent: toolResponse.structuredContent,
              }),
            };
          } catch (error) {
            this.logger.error(
              `prompt_manager error: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
              ],
              isError: true,
            };
          }
        }
      );
      this.logger.debug("✅ prompt_manager tool registered successfully");
    } catch (error) {
      this.logger.error(
        `❌ Failed to register prompt_manager tool: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }

    // Register system_control tool
    try {
      // Get dynamic description based on current framework state
      const systemControlDescription =
        this.toolDescriptionManager?.getDescription(
          "system_control",
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ??
        "⚙️ SYSTEM CONTROL: Unified interface for status, framework controls, gate management, analytics, configuration, and maintenance actions.";

      // Log which description source is being used for transparency
      if (this.toolDescriptionManager) {
        this.logger.info(
          `   system_control: Using ToolDescriptionManager (framework: ${frameworkEnabled}, methodology: ${activeMethodology})`
        );
      } else {
        this.logger.info(
          `   system_control: Using fallback description (ToolDescriptionManager not available)`
        );
      }

      const getSystemControlParamDescription = (
        paramName: string,
        fallback: string
      ) =>
        this.toolDescriptionManager?.getParameterDescription(
          "system_control",
          paramName,
          frameworkEnabled,
          activeMethodology,
          { applyMethodologyOverride: true }
        ) ?? fallback;

      this.mcpServer.registerTool(
        "system_control",
        {
          title: "System Control",
          description: systemControlDescription,
          inputSchema: {
            action: z
              .string()
              .describe(
                getSystemControlParamDescription(
                  "action",
                  "Top-level command. Supported values: status, framework, gates, analytics, config, maintenance."
                )
              ),
            operation: z
              .string()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  "operation",
                  "Sub-command for the selected action (e.g. framework: switch|list|enable|disable, analytics: view|reset|history)."
                )
              ),
            framework: z
              .string()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  "framework",
                  "Framework identifier when switching (CAGEERF, ReACT, 5W1H, SCAMPER)."
                )
              ),
            config_path: z
              .string()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  "config_path",
                  "Configuration path or key for config operations."
                )
              ),
            config_value: z
              .any()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  "config_value",
                  "Value to write when performing config updates."
                )
              ),
            restart_reason: z
              .string()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  "restart_reason",
                  "Specific reason recorded for maintenance/restart operations."
                )
              ),
            reason: z
              .string()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  "reason",
                  "Audit-friendly explanation for switches, config changes, or restarts."
                )
              ),
            include_history: z
              .boolean()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  "include_history",
                  "Include historical entries (where supported)."
                )
              ),
            include_metrics: z
              .boolean()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  "include_metrics",
                  "Include detailed metrics output (where supported)."
                )
              ),
            show_details: z
              .boolean()
              .optional()
              .describe(
                getSystemControlParamDescription(
                  "show_details",
                  "Request an expanded response for list/status style commands."
                )
              ),
          },
        },
        async (args: { action: string; [key: string]: any }) => {
          try {
            const toolResponse = await this.systemControl.handleAction(
              args,
              {}
            );
            return {
              content: toolResponse.content,
              isError: toolResponse.isError,
              ...(toolResponse.structuredContent && {
                structuredContent: toolResponse.structuredContent,
              }),
            };
          } catch (error) {
            this.logger.error(
              `system_control error: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
              ],
              isError: true,
            };
          }
        }
      );
      this.logger.debug("✅ system_control tool registered successfully");
    } catch (error) {
      this.logger.error(
        `❌ Failed to register system_control tool: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
    this.logger.info("🎉 Centralized MCP tools registered successfully!");
    this.logger.info("📊 Core Tools: 3 centrally managed tools");
    this.logger.info(
      "🚀 Active Tools: prompt_engine, prompt_manager, system_control"
    );

    // Log available tools for user reference
    const toolSummary = [
      "Available Core Tools (centralized registration):",
      "🎯 prompt_engine - Centralized prompt execution engine",
      "🎯 prompt_manager - Centralized prompt lifecycle management",
      "⚙️ system_control - Centralized framework and system management",
    ].join("\n   ");

    this.logger.info(toolSummary);
  }

  /**
   * Re-register all tools with updated descriptions (for framework switching) - centralized version
   */
  async reregisterToolsWithUpdatedDescriptions(): Promise<void> {
    this.logger.info(
      "🔄 Re-registering tools with updated framework-aware descriptions..."
    );

    try {
      // Simply call the centralized registration method which now uses dynamic descriptions
      await this.registerAllTools();

      // Notify MCP clients that tool list has changed
      if (this.mcpServer?.server?.sendToolListChanged) {
        await this.mcpServer.server.sendToolListChanged();
        this.logger.info(
          "✅ Sent tool list changed notification to MCP clients"
        );
      } else {
        this.logger.warn(
          "⚠️ MCP server does not support sendToolListChanged notification"
        );
      }

      this.logger.info(
        "🎉 Tools re-registered successfully with updated descriptions (centralized)!"
      );
    } catch (error) {
      this.logger.error(
        `Failed to re-register tools: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
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
    this.promptManagerTool.updateData(
      promptsData,
      convertedPrompts,
      categories
    );
    // Core tools handle data updates directly
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
      this.logger.debug(
        `SystemControl not yet initialized, queued analytics data (${this.pendingAnalytics.length} pending)`
      );
    }
  }

  /**
   * Flush pending analytics data to systemControl after initialization
   */
  private flushPendingAnalytics(): void {
    if (this.systemControl && this.pendingAnalytics.length > 0) {
      this.logger.debug(
        `Flushing ${this.pendingAnalytics.length} pending analytics updates`
      );
      this.pendingAnalytics.forEach((analytics) => {
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

    // Cleanup gate system manager
    if (this.gateSystemManager) {
      this.gateSystemManager.cleanup().catch((error) => {
        this.logger.error("Error during gate system manager cleanup:", error);
      });
      this.logger.info("✅ Gate system manager cleanup initiated");
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
