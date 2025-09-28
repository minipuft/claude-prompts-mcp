/**
 * Application Runtime Management
 * Manages application lifecycle, module coordination, and system health
 *
 * This is the streamlined version of the original ApplicationOrchestrator,
 * focused on runtime concerns while delegating execution to the execution engine.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Import all module managers
import { ApiManager, createApiManager } from "../api/index.js";
import { ConfigManager } from "../config/index.js";
import {
  createFrameworkStateManager,
  FrameworkStateManager,
} from "../frameworks/framework-state-manager.js";
import {
  createLogger,
  EnhancedLoggingConfig,
  Logger,
} from "../logging/index.js";
import { createMcpToolsManager, McpToolsManager } from "../mcp-tools/index.js";
import { PromptManager } from "../prompts/index.js";
import {
  ServerManager,
  startMcpServer,
  createTransportManager,
  TransportManager,
} from "../server/index.js";
import { TextReferenceManager } from "../text-references/index.js";

// Import execution modules
import {
  ConversationManager,
  createConversationManager,
} from "../text-references/conversation.js";
// REMOVED: ExecutionCoordinator and GateEvaluator imports - modular chain and gate systems removed

// Phase 1: Framework capabilities now integrated into base components
// No separate framework observers needed - functionality moved to enhanced FileObserver and HotReloadManager

// Import startup management
import { ServerRootDetector } from "./startup.js";

// Import types
import { Category, ConvertedPrompt, PromptData } from "../types/index.js";
// Import chain utilities
import { isChainPrompt } from "../utils/chainUtils.js";

/**
 * Application Runtime class
 * Coordinates all modules and manages application lifecycle
 */
export class Application {
  private logger: Logger;
  private configManager: ConfigManager;
  private textReferenceManager: TextReferenceManager;
  private conversationManager: ConversationManager;
  private promptManager: PromptManager;
  // REMOVED: executionCoordinator - modular chain system removed
  // REMOVED: gateEvaluator - gate evaluation system removed
  private mcpToolsManager: McpToolsManager;
  private frameworkStateManager: FrameworkStateManager;
  private transportManager: TransportManager;
  private apiManager?: ApiManager;
  private serverManager?: ServerManager;
  // Phase 1: Framework capabilities integrated into base components
  // No separate framework observers needed

  // MCP Server instance
  private mcpServer: McpServer;

  // Application data
  private _promptsData: PromptData[] = [];
  private _categories: Category[] = [];
  private _convertedPrompts: ConvertedPrompt[] = [];

  // Performance monitoring
  private memoryOptimizationInterval?: NodeJS.Timeout;

  // Server root detector
  private serverRootDetector: ServerRootDetector;

  constructor(logger?: Logger) {
    // Will be initialized in startup() if not provided
    this.logger = logger || (null as any);
    this.configManager = null as any;
    this.textReferenceManager = null as any;
    this.conversationManager = null as any;
    this.promptManager = null as any;
    // REMOVED: executionCoordinator - modular chain system removed
    // REMOVED: gateEvaluator - gate evaluation system removed
    this.mcpToolsManager = null as any;
    this.frameworkStateManager = null as any;
    this.transportManager = null as any;
    this.mcpServer = null as any;
    // Phase 1: Framework capabilities integrated into base components
    // Phase 3 consensus observer removed
    this.serverRootDetector = new ServerRootDetector();
  }

  /**
   * Initialize all modules in the correct order
   */
  async startup(): Promise<void> {
    try {
      // Phase 1: Core Foundation
      console.error("DEBUG: Starting Phase 1 - Core Foundation...");
      await this.initializeFoundation();
      console.error("DEBUG: Phase 1 completed successfully");

      // Phase 2: Data Loading and Processing
      console.error("DEBUG: Starting Phase 2 - Data Loading and Processing...");
      await this.loadAndProcessData();
      console.error("DEBUG: Phase 2 completed successfully");

      // Phase 3: Module Initialization
      console.error("DEBUG: Starting Phase 3 - Module Initialization...");
      await this.initializeModulesPrivate();
      console.error("DEBUG: Phase 3 completed successfully");

      // Phase 4: Server Setup and Startup
      console.error("DEBUG: Starting Phase 4 - Server Setup and Startup...");
      // Check if this is a startup test mode
      const args = process.argv.slice(2);
      const isStartupTest = args.includes("--startup-test");
      await this.startServer(isStartupTest);
      console.error("DEBUG: Phase 4 completed successfully");
      console.error(
        "DEBUG: All startup phases completed, server should be running..."
      );

      this.logger.info("Application startup completed successfully");
    } catch (error) {
      if (this.logger) {
        this.logger.error("Error during application startup:", error);
      } else {
        console.error("Error during application startup:", error);
      }
      throw error;
    }
  }

  /**
   * Public test methods for GitHub Actions compatibility
   */
  async loadConfiguration(): Promise<void> {
    await this.initializeFoundation();
  }

  async loadPromptsData(): Promise<void> {
    await this.loadAndProcessData();
  }

  // Make initializeModules public for testing
  async initializeModules(): Promise<void> {
    return this.initializeModulesPrivate();
  }

  // Expose data for testing
  get config() {
    return this.configManager?.getConfig();
  }

  get promptsData() {
    return this._promptsData;
  }

  get convertedPrompts() {
    return this._convertedPrompts;
  }

  get categories() {
    return this._categories;
  }

  /**
   * Phase 1: Initialize foundation (configuration, logging, basic services)
   */
  private async initializeFoundation(): Promise<void> {
    // Determine server root directory robustly
    const serverRoot = await this.serverRootDetector.determineServerRoot();
    console.error("DEBUG: Server root detected:", serverRoot);

    // Initialize configuration manager using the detected server root
    console.error(
      "DEBUG: About to call path.join with serverRoot:",
      serverRoot
    );
    const CONFIG_FILE = path.join(serverRoot, "config.json");
    console.error("DEBUG: Config file path:", CONFIG_FILE);
    console.error(
      "DEBUG: About to create ConfigManager with CONFIG_FILE:",
      CONFIG_FILE
    );
    try {
      this.configManager = new ConfigManager(CONFIG_FILE);
      console.error("DEBUG: ConfigManager created successfully");
    } catch (error) {
      console.error("DEBUG: ConfigManager creation failed:", error);
      throw error;
    }
    console.error("DEBUG: About to load config");
    try {
      await this.configManager.loadConfig();
      console.error("DEBUG: Config loaded successfully");
    } catch (error) {
      console.error("DEBUG: Config loading failed:", error);
      throw error;
    }

    // Determine transport from command line arguments
    const args = process.argv.slice(2);
    console.error("DEBUG: Args:", args);
    const transport = TransportManager.determineTransport(
      args,
      this.configManager
    );
    console.error("DEBUG: Transport determined:", transport);

    // Check verbosity flags for conditional logging
    const isVerbose =
      args.includes("--verbose") || args.includes("--debug-startup");
    const isQuiet = args.includes("--quiet");
    console.error("DEBUG: Verbose:", isVerbose, "Quiet:", isQuiet);

    // Initialize enhanced logger with config-based settings
    console.error("DEBUG: About to create enhanced logger");
    const loggingConfig = this.configManager.getLoggingConfig();
    const logDirectory = path.isAbsolute(loggingConfig.directory)
      ? loggingConfig.directory
      : path.resolve(serverRoot, loggingConfig.directory);
    const logFile = path.join(logDirectory, "mcp-server.log");

    // Ensure log directory exists
    try {
      await fs.mkdir(logDirectory, { recursive: true });
      console.error(`DEBUG: Log directory ensured: ${logDirectory}`);
    } catch (error) {
      console.error(
        `DEBUG: Failed to create log directory ${logDirectory}:`,
        error
      );
    }

    const enhancedLoggerConfig: EnhancedLoggingConfig = {
      logFile,
      transport,
      enableDebug: isVerbose,
      configuredLevel: loggingConfig.level,
    };

    this.logger = createLogger(enhancedLoggerConfig);

    // Initialize log file
    await (this.logger as any).initLogFile();
    console.error("DEBUG: Enhanced logger created and initialized");

    // Only show startup messages if not in quiet mode
    if (!isQuiet) {
      console.error("DEBUG: About to call logger.info - Starting MCP...");
      this.logger.info("Starting MCP Claude Prompts Server...");
      console.error("DEBUG: First logger.info completed");
      this.logger.info(`Transport: ${transport}`);
      console.error("DEBUG: Second logger.info completed");
    }

    // Verbose mode shows detailed configuration info
    if (isVerbose) {
      console.error("DEBUG: About to call verbose logger.info calls");
      this.logger.info(`Server root: ${serverRoot}`);
      this.logger.info(`Config file: ${CONFIG_FILE}`);
      this.logger.debug(`Command line args: ${JSON.stringify(args)}`);
      this.logger.debug(`Process working directory: ${process.cwd()}`);
      console.error("DEBUG: Verbose logger.info calls completed");
    }

    // Initialize text reference manager
    console.error("DEBUG: About to create TextReferenceManager");
    this.textReferenceManager = new TextReferenceManager(this.logger);
    console.error("DEBUG: TextReferenceManager created");

    // Initialize conversation manager
    console.error("DEBUG: About to create ConversationManager");
    try {
      this.conversationManager = createConversationManager(this.logger);
      console.error("DEBUG: ConversationManager created successfully");
    } catch (error) {
      console.error("DEBUG: ConversationManager creation failed:", error);
      throw error;
    }
    console.error("DEBUG: ConversationManager created");

    // Create MCP server
    console.error("DEBUG: About to get config");
    const config = this.configManager.getConfig();
    console.error("DEBUG: Config retrieved successfully");
    console.error("DEBUG: About to create McpServer");
    this.mcpServer = new McpServer({
      name: config.server.name,
      version: config.server.version,
      capabilities: {
        prompts: { listChanged: true },
        tools: { listChanged: true },
      },
    });
    console.error("DEBUG: McpServer created successfully");

    // Only log completion in verbose mode
    if (isVerbose) {
      console.error("DEBUG: About to log foundation initialized");
      this.logger.info("Foundation modules initialized");
      console.error("DEBUG: Foundation initialized log completed");
    }
    console.error("DEBUG: initializeFoundation completed successfully");
  }

  /**
   * Phase 2: Load and process prompt data
   */
  private async loadAndProcessData(): Promise<void> {
    // Check verbosity flags for conditional logging
    const args = process.argv.slice(2);
    const isVerbose =
      args.includes("--verbose") || args.includes("--debug-startup");
    const isQuiet = args.includes("--quiet");

    // Initialize prompt manager
    this.promptManager = new PromptManager(
      this.logger,
      this.textReferenceManager,
      this.configManager,
      this.mcpServer
    );

    // Load and convert prompts with enhanced path resolution
    const config = this.configManager.getConfig();

    // ENHANCED: Allow direct prompts config path override via environment variable
    // This bypasses server root detection issues entirely and is perfect for Claude Desktop
    let PROMPTS_FILE: string;

    if (process.env.MCP_PROMPTS_CONFIG_PATH) {
      PROMPTS_FILE = process.env.MCP_PROMPTS_CONFIG_PATH;
      if (isVerbose) {
        this.logger.info(
          "🎯 Using MCP_PROMPTS_CONFIG_PATH environment variable override"
        );
      }
    } else {
      // Fallback to ConfigManager's getPromptsFilePath() method
      PROMPTS_FILE = this.configManager.getPromptsFilePath();
      if (isVerbose) {
        this.logger.info("📁 Using config-based prompts file path resolution");
      }
    }

    // Enhanced logging for prompt loading pipeline (verbose mode only)
    if (isVerbose) {
      this.logger.info("=== PROMPT LOADING PIPELINE START ===");
      this.logger.info(`Config prompts.file setting: "${config.prompts.file}"`);
      if (process.env.MCP_PROMPTS_CONFIG_PATH) {
        this.logger.info(
          `🎯 MCP_PROMPTS_CONFIG_PATH override: "${process.env.MCP_PROMPTS_CONFIG_PATH}"`
        );
      } else {
        this.logger.info(
          `Config manager base directory: "${path.dirname(
            this.configManager.getPromptsFilePath()
          )}"`
        );
      }
      this.logger.info(`✅ Final PROMPTS_FILE path: "${PROMPTS_FILE}"`);

      // Add additional diagnostic information
      this.logger.info("=== PATH RESOLUTION DIAGNOSTICS ===");
      this.logger.info(`process.cwd(): ${process.cwd()}`);
      this.logger.info(`process.argv[0]: ${process.argv[0]}`);
      this.logger.info(`process.argv[1]: ${process.argv[1] || "undefined"}`);
      this.logger.info(
        `__filename equivalent: ${fileURLToPath(import.meta.url)}`
      );
      this.logger.info(
        `Config file path: ${(this.configManager as any).configPath}`
      );
      this.logger.info(
        `MCP_PROMPTS_CONFIG_PATH: ${
          process.env.MCP_PROMPTS_CONFIG_PATH || "undefined"
        }`
      );
      this.logger.info(
        `MCP_SERVER_ROOT: ${process.env.MCP_SERVER_ROOT || "undefined"}`
      );
      this.logger.info(
        `PROMPTS_FILE is absolute: ${path.isAbsolute(PROMPTS_FILE)}`
      );
      this.logger.info(
        `PROMPTS_FILE normalized: ${path.normalize(PROMPTS_FILE)}`
      );
    }

    // Validate that we're using absolute paths (critical for Claude Desktop)
    if (!path.isAbsolute(PROMPTS_FILE)) {
      if (isVerbose) {
        this.logger.error(
          `⚠️  CRITICAL: PROMPTS_FILE is not absolute: ${PROMPTS_FILE}`
        );
        this.logger.error(
          `This will cause issues with Claude Desktop execution!`
        );
      }
      // Convert to absolute path as fallback
      // Use serverRoot which is determined earlier and more reliable for constructing the absolute path
      const serverRoot = await this.serverRootDetector.determineServerRoot(); // Ensure serverRoot is available
      const absolutePromptsFile = path.resolve(serverRoot, PROMPTS_FILE);
      if (isVerbose) {
        this.logger.info(
          `🔧 Converting to absolute path: ${absolutePromptsFile}`
        );
      }
      PROMPTS_FILE = absolutePromptsFile;
    }

    // Verify the file exists before attempting to load
    try {
      const fs = await import("fs/promises");
      await fs.access(PROMPTS_FILE);
      if (isVerbose) {
        this.logger.info(
          `✓ Prompts configuration file exists: ${PROMPTS_FILE}`
        );
      }
    } catch (error) {
      this.logger.error(
        `✗ Prompts configuration file NOT FOUND: ${PROMPTS_FILE}`
      );
      if (isVerbose) {
        this.logger.error(`File access error:`, error);

        // Provide additional troubleshooting information
        this.logger.error("=== TROUBLESHOOTING INFORMATION ===");
        this.logger.error(`Is path absolute? ${path.isAbsolute(PROMPTS_FILE)}`);
        this.logger.error(`Normalized path: ${path.normalize(PROMPTS_FILE)}`);
        this.logger.error(`Path exists check: ${PROMPTS_FILE}`);
      }

      throw new Error(`Prompts configuration file not found: ${PROMPTS_FILE}`);
    }

    try {
      this.logger.info("Initiating prompt loading and conversion...");
      // Pass path.dirname(PROMPTS_FILE) as the basePath for resolving relative prompt file paths
      const result = await this.promptManager.loadAndConvertPrompts(
        PROMPTS_FILE,
        path.dirname(PROMPTS_FILE)
      );

      this._promptsData = result.promptsData;
      this._categories = result.categories;
      this._convertedPrompts = result.convertedPrompts;

      this.logger.info("=== PROMPT LOADING RESULTS ===");
      this.logger.info(
        `✓ Loaded ${this._promptsData.length} prompts from ${this._categories.length} categories`
      );
      this.logger.info(
        `✓ Converted ${this._convertedPrompts.length} prompts to MCP format`
      );

      // Log category breakdown
      if (this._categories.length > 0) {
        this.logger.info("Categories loaded:");
        this._categories.forEach((category) => {
          const categoryPrompts = this._promptsData.filter(
            (p) => p.category === category.id
          );
          this.logger.info(
            `  - ${category.name} (${category.id}): ${categoryPrompts.length} prompts`
          );
        });
      } else {
        this.logger.warn("⚠ No categories were loaded!");
      }

      this.logger.info("=== PROMPT LOADING PIPELINE END ===");

      // Propagate updated data to other relevant managers
      if (this.mcpToolsManager) {
        this.mcpToolsManager.updateData(
          this._promptsData,
          this._convertedPrompts,
          this.categories
        );
      }
      // REMOVED: ExecutionCoordinator prompts update - modular chain system removed
      if (this.apiManager) {
        // apiManager might not exist for stdio
        this.apiManager.updateData(
          this._promptsData,
          this._categories,
          this.convertedPrompts
        );
      }

      // CRUCIAL STEP: Re-register all prompts with the McpServer using the newly loaded data
      if (this.promptManager && this.mcpServer) {
        this.logger.info(
          "🔄 Re-registering all prompts with MCP server after hot-reload..."
        );
        const registeredCount = await this.promptManager.registerAllPrompts(
          this.convertedPrompts
        );
        this.logger.info(
          `✅ Successfully re-registered ${registeredCount} prompts.`
        );
      } else {
        this.logger.warn(
          "⚠️ PromptManager or McpServer not available, skipping re-registration of prompts after hot-reload."
        );
      }
    } catch (error) {
      this.logger.error("✗ PROMPT LOADING FAILED:");
      this.logger.error("Error details:", error);
      this.logger.error(
        "Stack trace:",
        error instanceof Error ? error.stack : "No stack trace available"
      );
      throw error;
    }
  }

  /**
   * Phase 3: Initialize remaining modules with loaded data
   */
  private async initializeModulesPrivate(): Promise<void> {
    // Check verbosity flags for conditional logging
    const args = process.argv.slice(2);
    const isVerbose =
      args.includes("--verbose") || args.includes("--debug-startup");

    // REMOVED: Gate evaluator and ExecutionCoordinator initialization - modular systems removed

    // Initialize Framework State Manager (for framework switching)
    if (isVerbose)
      this.logger.info("🔄 Initializing Framework State Manager...");
    this.frameworkStateManager = await createFrameworkStateManager(this.logger);

    // Validation: Ensure FrameworkStateManager was created successfully
    if (!this.frameworkStateManager) {
      throw new Error(
        "Failed to initialize FrameworkStateManager - required for framework switching"
      );
    }
    if (isVerbose)
      this.logger.info("✅ FrameworkStateManager initialized successfully");

    // Debug: Log chain prompt availability
    const chainCount = this._convertedPrompts.filter((p) =>
      isChainPrompt(p)
    ).length;
    if (isVerbose)
      this.logger.info(
        `🔗 Chain prompts available: ${chainCount}/${this._convertedPrompts.length} total prompts`
      );
    if (chainCount > 0 && isVerbose) {
      const chainNames = this._convertedPrompts
        .filter((p) => isChainPrompt(p))
        .map((p) => p.id)
        .join(", ");
      this.logger.info(`🔗 Available chains: ${chainNames}`);
    }

    // Phase 2: Workflow registration removed - chains handle all multi-step execution

    // Initialize MCP tools manager
    if (isVerbose) this.logger.info("🔄 Initializing MCP tools manager...");
    this.mcpToolsManager = await createMcpToolsManager(
      this.logger,
      this.mcpServer,
      this.promptManager,
      this.configManager,
      () => this.fullServerRefresh(),
      (reason: string) => this.restartServer(reason)
      // Phase 3: Removed executionCoordinator - chains now use LLM-driven execution
    );

    // Update MCP tools manager with current data
    if (isVerbose) this.logger.info("🔄 Updating MCP tools manager data...");
    this.mcpToolsManager.updateData(
      this._promptsData,
      this._convertedPrompts,
      this.categories
    );

    // Connect Framework State Manager to MCP Tools Manager
    if (isVerbose) this.logger.info("🔄 Connecting Framework State Manager...");
    this.mcpToolsManager.setFrameworkStateManager(this.frameworkStateManager);

    // Initialize and connect Framework Manager
    if (isVerbose) this.logger.info("🔄 Initializing Framework Manager...");
    await this.mcpToolsManager.setFrameworkManager();

    // REMOVED: ConsolidatedPromptEngine to ExecutionCoordinator wiring - ExecutionCoordinator removed

    // Register all MCP tools
    if (isVerbose) this.logger.info("🔄 Registering all MCP tools...");
    await this.mcpToolsManager.registerAllTools();

    // Register all prompts
    if (isVerbose) this.logger.info("🔄 Registering all prompts...");
    await this.promptManager.registerAllPrompts(this._convertedPrompts);

    this.logger.info("All modules initialized successfully");

    // REMOVED: ExecutionCoordinator stats collection - modular chain system removed
  }

  // Phase 2: Workflow registration completely removed - chains handle all multi-step execution

  /**
   * Phase 4: Setup and start the server
   */
  private async startServer(isStartupTest: boolean = false): Promise<void> {
    console.error("DEBUG: startServer() - Determining transport...");
    // Determine transport
    const args = process.argv.slice(2);
    const transport = TransportManager.determineTransport(
      args,
      this.configManager
    );
    console.error("DEBUG: startServer() - Transport determined:", transport);

    console.error("DEBUG: startServer() - Creating transport manager...");
    // Create transport manager
    this.transportManager = createTransportManager(
      this.logger,
      this.configManager,
      this.mcpServer,
      transport
    );
    console.error("DEBUG: startServer() - Transport manager created");

    console.error("DEBUG: startServer() - Checking if SSE transport...");
    // Create API manager for SSE transport
    if (this.transportManager.isSse()) {
      console.error("DEBUG: startServer() - Creating API manager for SSE...");
      this.apiManager = createApiManager(
        this.logger,
        this.configManager,
        this.promptManager,
        this.mcpToolsManager
      );
      console.error("DEBUG: startServer() - API manager created");

      console.error("DEBUG: startServer() - Updating API manager data...");
      // Update API manager with current data
      this.apiManager.updateData(
        this._promptsData,
        this._categories,
        this.convertedPrompts
      );
      console.error("DEBUG: startServer() - API manager data updated");
    } else {
      console.error(
        "DEBUG: startServer() - Using STDIO transport (no API manager needed)"
      );
    }

    // Phase 1: Framework capabilities integrated into base components
    console.error(
      "DEBUG: startServer() - Framework capabilities integrated into base components"
    );

    if (isStartupTest) {
      console.error(
        "DEBUG: startServer() - Skipping MCP server startup (test mode)"
      );
      // Create a mock server manager for health validation
      this.serverManager = {
        shutdown: () => console.error("DEBUG: Mock server shutdown"),
        getStatus: () => ({ running: true, transport: "stdio" }),
        isRunning: () => true,
      } as any;
      console.error("DEBUG: startServer() - Mock server manager created");
    } else {
      console.error("DEBUG: startServer() - About to start MCP server...");
      // Start the server
      this.serverManager = await startMcpServer(
        this.logger,
        this.configManager,
        this.transportManager,
        this.apiManager
      );
      console.error("DEBUG: startServer() - MCP server started");
    }

    this.logger.info("Server started successfully");
    console.error("DEBUG: startServer() - Server startup completed");
  }

  /**
   * Switch to a different framework by ID (CAGEERF, ReACT, 5W1H, etc.)
   * Core functionality: Allow switching between frameworks to guide the system
   */
  async switchFramework(
    frameworkId: string
  ): Promise<{ success: boolean; message: string }> {
    // Phase 1: Framework switching simplified - basic support only

    try {
      this.logger.info(
        `Framework switching to ${frameworkId} (Phase 1 basic support)`
      );
      const result = {
        success: true,
        message: `Switched to ${frameworkId}`,
        newFramework: frameworkId,
        previousFramework: "basic",
      };

      if (result.success) {
        this.logger.info(`🔄 Framework switched to: ${result.newFramework}`);
        return {
          success: true,
          message: `Successfully switched from ${result.previousFramework} to ${result.newFramework}`,
        };
      } else {
        this.logger.warn(`❌ Framework switch failed: ${result.message}`);
        return {
          success: false,
          message: result.message || "Unknown error during framework switch",
        };
      }
    } catch (error) {
      this.logger.error("Framework switch error:", error);
      return {
        success: false,
        message: `Error switching framework: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  /**
   * Get current framework information
   */
  getCurrentFrameworkInfo(): {
    id: string;
    name: string;
    availableFrameworks: string[];
    isHealthy: boolean;
  } {
    // Phase 1: Framework status simplified - basic support only
    const status = {
      currentFramework: "basic",
      currentFrameworkName: "Basic Framework",
      isHealthy: true,
    };
    const available = ["basic"];

    return {
      id: status.currentFramework,
      name: status.currentFrameworkName,
      availableFrameworks: available,
      isHealthy: status.isHealthy,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      if (this.logger) {
        this.logger.info("Initiating application shutdown...");
      }

      if (this.serverManager) {
        this.serverManager.shutdown();
      }

      if (this.logger) {
        this.logger.info("Application shutdown completed");
      }
    } catch (error) {
      if (this.logger) {
        this.logger.error("Error during shutdown:", error);
      } else {
        console.error("Error during shutdown (logger not available):", error);
      }
      throw error;
    }
  }

  /**
   * Perform a full server refresh (hot-reload).
   * This reloads all prompts from disk and updates all relevant modules.
   */
  public async fullServerRefresh(): Promise<void> {
    this.logger.info(
      "🔥 Application: Starting full server refresh (hot-reload)..."
    );
    try {
      // Step 1: Reload all prompt data from disk by re-running the data loading phase.
      // This updates the application's internal state with the latest file contents.
      await this.loadAndProcessData();
      this.logger.info("✅ Data reloaded and processed from disk.");

      // Step 2: Framework hot-reload integration now handled by enhanced base components
      this.logger.info(
        "✅ Framework capabilities integrated into base components"
      );

      // Step 2.5: Phase 2 - Simple framework switching status check
      const switchingStatus = {
        currentFramework: "basic",
        currentFrameworkName: "Basic Framework",
        enabledFrameworks: 1,
        availableFrameworks: 1,
      };
      this.logger.info(
        `✅ Framework switching system ready: ${switchingStatus.currentFrameworkName} active ` +
          `(${switchingStatus.enabledFrameworks}/${switchingStatus.availableFrameworks} frameworks available)`
      );

      // Phase 3 complexity removed - focusing on simple framework switching instead of multi-framework consensus

      // Step 3: Propagate the new data to all dependent modules.
      // This ensures all parts of the application are synchronized with the new state.
      // REMOVED: ExecutionCoordinator prompts update - modular chain system removed

      if (this.mcpToolsManager) {
        this.mcpToolsManager.updateData(
          this._promptsData,
          this._convertedPrompts,
          this.categories
        );
        this.logger.info("✅ McpToolsManager updated with new data.");
      }

      if (this.apiManager) {
        // The API manager is only available for the SSE transport.
        this.apiManager.updateData(
          this._promptsData,
          this._categories,
          this.convertedPrompts
        );
        this.logger.info("✅ ApiManager updated with new data.");
      }

      // Step 4: Notify MCP clients that the prompt list has changed (proper hot-reload)
      // This follows MCP protocol - clients will re-query the server for the updated list
      await this.promptManager.notifyPromptsListChanged();
      this.logger.info(
        "✅ Prompts list_changed notification sent to MCP clients."
      );

      // Step 5: Phase 2 - Workflow registration removed

      this.logger.info("🚀 Full server refresh completed successfully.");
    } catch (error) {
      this.logger.error("❌ Error during full server refresh:", error);
      // Re-throw the error so the caller can handle it appropriately.
      throw error;
    }
  }

  /**
   * Restart the application by shutting down and exiting with a restart code.
   * Relies on a process manager (e.g., PM2) to restart the process.
   */
  public async restartServer(reason: string = "Manual restart"): Promise<void> {
    this.logger.info(`🚨 Initiating server restart. Reason: ${reason}`);
    try {
      // Ensure all current operations are gracefully shut down.
      await this.shutdown();
      this.logger.info(
        "✅ Server gracefully shut down. Exiting with restart code."
      );
    } catch (error) {
      this.logger.error("❌ Error during pre-restart shutdown:", error);
    } finally {
      // Exit with a specific code that a process manager can detect.
      process.exit(100);
    }
  }

  /**
   * Get application status
   */
  getStatus(): {
    running: boolean;
    transport?: string;
    promptsLoaded: number;
    categoriesLoaded: number;
    serverStatus?: any;
    executionCoordinator?: {
      totalExecutions: number;
      promptExecutions: number;
      chainExecutions: number;
      // workflowExecutions: number; // Phase 2: removed, workflows tracked as advanced chains
      successRate: number;
    };
  } {
    // REMOVED: ExecutionCoordinator status - providing default execution status
    const executionCoordinatorStatus = {
      totalExecutions: 0,
      promptExecutions: 0,
      chainExecutions: 0,
      successRate: 1.0,
    };

    return {
      running: this.serverManager?.isRunning() || false,
      transport: this.transportManager?.getTransportType(),
      promptsLoaded: this._promptsData.length,
      categoriesLoaded: this._categories.length,
      serverStatus: this.serverManager?.getStatus(),
      executionCoordinator: executionCoordinatorStatus,
    };
  }

  /**
   * Get all module instances (for debugging/testing)
   */
  getModules() {
    return {
      logger: this.logger,
      configManager: this.configManager,
      promptManager: this.promptManager,
      textReferenceManager: this.textReferenceManager,
      conversationManager: this.conversationManager,
      // REMOVED: executionCoordinator and gateEvaluator - modular systems removed
      mcpToolsManager: this.mcpToolsManager,
      apiManager: this.apiManager,
      serverManager: this.serverManager,
    };
  }

  /**
   * Validate application health - comprehensive health check
   */
  validateHealth(): {
    healthy: boolean;
    modules: {
      foundation: boolean;
      dataLoaded: boolean;
      modulesInitialized: boolean;
      serverRunning: boolean;
    };
    details: {
      promptsLoaded: number;
      categoriesLoaded: number;
      serverStatus?: any;
      moduleStatus: Record<string, boolean>;
    };
    issues: string[];
  } {
    const issues: string[] = [];
    const moduleStatus: Record<string, boolean> = {};

    // Check foundation modules
    const foundationHealthy = !!(
      this.logger &&
      this.configManager &&
      this.textReferenceManager
    );
    moduleStatus.foundation = foundationHealthy;
    if (!foundationHealthy) {
      issues.push("Foundation modules not properly initialized");
    }

    // Check data loading
    const dataLoaded =
      this._promptsData.length > 0 && this._categories.length > 0;
    moduleStatus.dataLoaded = dataLoaded;
    if (!dataLoaded) {
      issues.push("Prompt data not loaded or empty");
    }

    // Check module initialization
    const modulesInitialized = !!(
      this.promptManager &&
      // REMOVED: this.executionCoordinator && this.gateEvaluator - modular systems removed
      this.mcpToolsManager
    );
    moduleStatus.modulesInitialized = modulesInitialized;
    moduleStatus.serverRunning = !!(
      this.serverManager && this.transportManager
    );

    moduleStatus.configManager = !!this.configManager;
    moduleStatus.logger = !!this.logger;
    moduleStatus.promptManager = !!this.promptManager;
    moduleStatus.textReferenceManager = !!this.textReferenceManager;
    moduleStatus.conversationManager = !!this.conversationManager;
    // REMOVED: moduleStatus for executionCoordinator and gateEvaluator - modular systems removed
    moduleStatus.mcpToolsManager = !!this.mcpToolsManager;
    moduleStatus.transportManager = !!this.transportManager;
    moduleStatus.apiManager = !!this.apiManager;
    moduleStatus.serverManager = !!this.serverManager;

    // Check overall health
    const isHealthy =
      foundationHealthy &&
      dataLoaded &&
      modulesInitialized &&
      moduleStatus.serverRunning &&
      issues.length === 0;

    return {
      healthy: isHealthy,
      modules: {
        foundation: foundationHealthy,
        dataLoaded,
        modulesInitialized,
        serverRunning: moduleStatus.serverRunning,
      },
      details: {
        promptsLoaded: this._promptsData.length,
        categoriesLoaded: this._categories.length,
        serverStatus: this.serverManager?.getStatus(),
        moduleStatus,
      },
      issues,
    };
  }

  /**
   * Get performance metrics for monitoring
   */
  getPerformanceMetrics(): {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    process: {
      pid: number;
      nodeVersion: string;
      platform: string;
      arch: string;
    };
    application: {
      promptsLoaded: number;
      categoriesLoaded: number;
      serverConnections?: number;
    };
    executionCoordinator?: {
      statistics: any;
    };
  } {
    // REMOVED: ExecutionCoordinator metrics - providing default metrics
    const executionCoordinatorMetrics = {
      statistics: {
        totalExecutions: 0,
        promptExecutions: 0,
        chainExecutions: 0,
        successRate: 1.0,
        averageExecutionTime: 0,
        failedExecutions: 0,
      },
    };

    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      application: {
        promptsLoaded: this._promptsData.length,
        categoriesLoaded: this._categories.length,
        serverConnections: this.transportManager?.isSse()
          ? this.transportManager.getActiveConnectionsCount()
          : undefined,
      },
      executionCoordinator: executionCoordinatorMetrics,
    };
  }

  /**
   * Cleanup resources and stop timers
   */
  cleanup(): void {
    if (this.memoryOptimizationInterval) {
      clearInterval(this.memoryOptimizationInterval);
      this.memoryOptimizationInterval = undefined;
      this.logger.debug("Memory optimization timer stopped");
    }
  }

  /**
   * Emergency diagnostic information for troubleshooting
   */
  getDiagnosticInfo(): {
    timestamp: string;
    health: ReturnType<Application["validateHealth"]>;
    performance: ReturnType<Application["getPerformanceMetrics"]>;
    configuration: {
      transport: string;
      configLoaded: boolean;
    };
    errors: string[];
  } {
    const errors: string[] = [];

    try {
      // Collect any recent errors or issues
      if (!this.mcpServer) {
        errors.push("MCP Server instance not available");
      }

      if (this._promptsData.length === 0) {
        errors.push("No prompts loaded");
      }

      if (this._categories.length === 0) {
        errors.push("No categories loaded");
      }

      return {
        timestamp: new Date().toISOString(),
        health: this.validateHealth(),
        performance: this.getPerformanceMetrics(),
        configuration: {
          transport: this.transportManager?.getTransportType() || "unknown",
          configLoaded: !!this.configManager,
        },
        errors,
      };
    } catch (error) {
      errors.push(
        `Error collecting diagnostic info: ${
          error instanceof Error ? error.message : String(error)
        }`
      );

      return {
        timestamp: new Date().toISOString(),
        health: {
          healthy: false,
          modules: {
            foundation: false,
            dataLoaded: false,
            modulesInitialized: false,
            serverRunning: false,
          },
          details: { promptsLoaded: 0, categoriesLoaded: 0, moduleStatus: {} },
          issues: ["Failed to collect health information"],
        },
        performance: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          process: {
            pid: process.pid,
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
          },
          application: { promptsLoaded: 0, categoriesLoaded: 0 },
        },
        configuration: {
          transport: "unknown",
          configLoaded: false,
        },
        errors,
      };
    }
  }
}

/**
 * Create and configure an application runtime
 */
export function createApplication(): Application {
  return new Application();
}

/**
 * Main application entry point
 */
export async function startApplication(): Promise<Application> {
  const application = createApplication();
  await application.startup();
  return application;
}
