/**
 * Application Orchestration Module
 * Coordinates all modules and provides clean startup sequence
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import path from "path";
import { fileURLToPath } from "url";

// Import all module managers
import { ApiManager, createApiManager } from "../api/index.js";
import { ConfigManager } from "../config/index.js";
import { createSimpleLogger, Logger } from "../logging/index.js";
import { createMcpToolsManager, McpToolsManager } from "../mcp-tools/index.js";
import { PromptManager } from "../prompts/index.js";
import { ServerManager, startMcpServer } from "../server/index.js";
import { TextReferenceManager } from "../text-references/index.js";
import {
  createTransportManager,
  TransportManager,
} from "../transport/index.js";

// Import orchestration modules
import {
  ConversationManager,
  createConversationManager,
} from "./conversation-manager.js";
import { createPromptExecutor, PromptExecutor } from "./prompt-executor.js";
import { createWorkflowEngine, WorkflowEngine } from "./workflow-engine.js";
import { createGateEvaluator, GateEvaluator } from "../utils/gateValidation.js";
import { createEnhancedGateEvaluator, EnhancedGateEvaluator } from "../utils/enhanced-gate-evaluator.js";
import { createGateManagementTools, GateManagementTools } from "../mcp-tools/gate-management-tools.js";

// Import types
import { Category, ConvertedPrompt, PromptData } from "../types/index.js";

/**
 * Application Orchestrator class
 * Coordinates all modules and manages application lifecycle
 */
export class ApplicationOrchestrator {
  private logger: Logger;
  private configManager: ConfigManager;
  private textReferenceManager: TextReferenceManager;
  private conversationManager: ConversationManager;
  private promptManager: PromptManager;
  private promptExecutor: PromptExecutor;
  private workflowEngine: WorkflowEngine;
  private gateEvaluator: GateEvaluator;
  private enhancedGateEvaluator: EnhancedGateEvaluator;
  private gateManagementTools: GateManagementTools;
  private mcpToolsManager: McpToolsManager;
  private transportManager: TransportManager;
  private apiManager?: ApiManager;
  private serverManager?: ServerManager;

  // MCP Server instance
  private mcpServer: McpServer;

  // Application data
  private _promptsData: PromptData[] = [];
  private _categories: Category[] = [];
  private _convertedPrompts: ConvertedPrompt[] = [];

  constructor(logger?: Logger) {
    // Will be initialized in startup() if not provided
    this.logger = logger || null as any;
    this.configManager = null as any;
    this.textReferenceManager = null as any;
    this.conversationManager = null as any;
    this.promptManager = null as any;
    this.promptExecutor = null as any;
    this.workflowEngine = null as any;
    this.gateEvaluator = null as any;
    this.enhancedGateEvaluator = null as any;
    this.gateManagementTools = null as any;
    this.mcpToolsManager = null as any;
    this.transportManager = null as any;
    this.mcpServer = null as any;
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
      const isStartupTest = args.includes('--startup-test');
      await this.startServer(isStartupTest);
      console.error("DEBUG: Phase 4 completed successfully");
      console.error("DEBUG: All startup phases completed, server should be running...");

      this.logger.info(
        "Application orchestrator startup completed successfully"
      );
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
   * Determine the server root directory using multiple strategies
   * This is more robust for different execution contexts (direct execution vs Claude Desktop)
   */
  private async determineServerRoot(): Promise<string> {
    // Check for debug/verbose logging flags
    const args = process.argv.slice(2);
    const isVerbose =
      args.includes("--verbose") || args.includes("--debug-startup");
    const isQuiet = args.includes("--quiet");

    // Early termination: If environment variable is set, use it immediately
    if (process.env.MCP_SERVER_ROOT) {
      const envPath = path.resolve(process.env.MCP_SERVER_ROOT);
      try {
        const configPath = path.join(envPath, "config.json");
        const fs = await import("fs/promises");
        await fs.access(configPath);

        if (!isQuiet) {
          console.error(`✓ SUCCESS: MCP_SERVER_ROOT environment variable`);
          console.error(`  Path: ${envPath}`);
          console.error(`  Config found: ${configPath}`);
        }
        return envPath;
      } catch (error) {
        if (isVerbose) {
          console.error(`✗ WARNING: MCP_SERVER_ROOT env var set but invalid`);
          console.error(`  Tried path: ${envPath}`);
          console.error(
            `  Error: ${error instanceof Error ? error.message : String(error)}`
          );
          console.error(`  Falling back to automatic detection...`);
        }
      }
    }

    // Build strategies in optimal order (most likely to succeed first)
    const strategies = [];

    // Strategy 1: process.argv[1] script location (most successful in Claude Desktop)
    if (process.argv[1]) {
      const scriptPath = process.argv[1];

      // Primary strategy: Direct script location to server root
      strategies.push({
        name: "process.argv[1] script location",
        path: path.dirname(path.dirname(scriptPath)), // Go up from dist to server root
        source: `script: ${scriptPath}`,
        priority: "high",
      });

      // Secondary strategy: If we're specifically in a dist directory
      // Use path.normalize to ensure cross-platform compatibility
      const normalizedScriptPath = path.normalize(scriptPath);
      const distPattern = path.normalize(path.sep + "dist" + path.sep);
      if (normalizedScriptPath.includes(distPattern) || scriptPath.includes('/dist/') || scriptPath.includes('\\dist\\')) {
        strategies.push({
          name: "process.argv[1] (dist-aware)",
          path: path.dirname(path.dirname(scriptPath)), // Fixed: go up 2 levels, not 3
          source: `script in dist: ${scriptPath}`,
          priority: "high",
        });
      }
    }

    // Strategy 2: import.meta.url (current module location) - reliable fallback
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    strategies.push({
      name: "import.meta.url relative",
      path: path.join(__dirname, "..", ".."),
      source: `module: ${__filename}`,
      priority: "medium",
    });

    // Strategy 3: Common Claude Desktop patterns (ordered by likelihood)
    const commonPaths = [
      { path: path.join(process.cwd(), "server"), desc: "cwd/server" },
      { path: process.cwd(), desc: "cwd" },
      { path: path.join(process.cwd(), "..", "server"), desc: "parent/server" },
      { path: path.join(__dirname, "..", "..", ".."), desc: "module parent" },
    ];

    for (const { path: commonPath, desc } of commonPaths) {
      strategies.push({
        name: `common pattern (${desc})`,
        path: commonPath,
        source: `pattern: ${commonPath}`,
        priority: "low",
      });
    }

    // Only show diagnostic information in verbose mode
    if (isVerbose) {
      console.error("=== SERVER ROOT DETECTION STRATEGIES ===");
      console.error(`Environment: process.cwd() = ${process.cwd()}`);
      console.error(`Environment: process.argv[0] = ${process.argv[0]}`);
      console.error(
        `Environment: process.argv[1] = ${process.argv[1] || "undefined"}`
      );
      console.error(
        `Environment: __filename = ${fileURLToPath(import.meta.url)}`
      );
      console.error(
        `Environment: MCP_SERVER_ROOT = ${
          process.env.MCP_SERVER_ROOT || "undefined"
        }`
      );
      console.error(`Strategies to test: ${strategies.length}`);
      console.error("");
    }

    // Test strategies with optimized flow
    let lastHighPriorityIndex = -1;
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];

      // Track where high-priority strategies end for early termination logic
      if (strategy.priority === "high") {
        lastHighPriorityIndex = i;
      }

      try {
        const resolvedPath = path.resolve(strategy.path);

        // Check if config.json exists in this location
        const configPath = path.join(resolvedPath, "config.json");
        const fs = await import("fs/promises");
        await fs.access(configPath);

        // Success! Only log if not in quiet mode
        if (!isQuiet) {
          console.error(`✓ SUCCESS: ${strategy.name}`);
          console.error(`  Path: ${resolvedPath}`);
          console.error(`  Source: ${strategy.source}`);
          console.error(`  Config found: ${configPath}`);

          // Show efficiency info in verbose mode
          if (isVerbose) {
            console.error(
              `  Strategy #${i + 1}/${strategies.length} (${
                strategy.priority
              } priority)`
            );
            console.error(
              `  Skipped ${strategies.length - i - 1} remaining strategies`
            );
          }
        }

        return resolvedPath;
      } catch (error) {
        // Only log failures in verbose mode
        if (isVerbose) {
          console.error(`✗ FAILED: ${strategy.name}`);
          console.error(`  Tried path: ${path.resolve(strategy.path)}`);
          console.error(`  Source: ${strategy.source}`);
          console.error(`  Priority: ${strategy.priority}`);
          console.error(
            `  Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        // Early termination: If all high-priority strategies fail and we're not in verbose mode,
        // provide a simplified error message encouraging environment variable usage
        if (
          i === lastHighPriorityIndex &&
          !isVerbose &&
          lastHighPriorityIndex >= 0
        ) {
          if (!isQuiet) {
            console.error(
              `⚠️  High-priority detection strategies failed. Trying fallback methods...`
            );
            console.error(
              `💡 Tip: Set MCP_SERVER_ROOT environment variable for instant detection`
            );
            console.error(`📝 Use --verbose to see detailed strategy testing`);
          }
        }
      }
    }

    // If all strategies fail, provide optimized troubleshooting information
    const attemptedPaths = strategies
      .map(
        (s, i) =>
          `  ${i + 1}. ${s.name} (${s.priority}): ${path.resolve(s.path)}`
      )
      .join("\n");

    const troubleshootingInfo = `
TROUBLESHOOTING CLAUDE DESKTOP ISSUES:

🎯 RECOMMENDED SOLUTION (fastest):
   Set MCP_SERVER_ROOT environment variable:
   Windows: set MCP_SERVER_ROOT=E:\\path\\to\\claude-prompts-mcp\\server
   macOS/Linux: export MCP_SERVER_ROOT=/path/to/claude-prompts-mcp/server

📁 Claude Desktop Configuration:
   Update your claude_desktop_config.json:
   {
     "mcpServers": {
       "claude-prompts-mcp": {
         "command": "node",
         "args": ["E:\\\\full\\\\path\\\\to\\\\server\\\\dist\\\\index.js", "--transport=stdio"],
         "env": {
           "MCP_SERVER_ROOT": "E:\\\\full\\\\path\\\\to\\\\server"
         }
       }
     }
   }

🔧 Alternative Solutions:
   1. Create wrapper script that sets working directory before launching server
   2. Use absolute paths in your Claude Desktop configuration
   3. Run from the correct working directory (server/)

🐛 Debug Mode:
   Use --verbose or --debug-startup flag to see detailed strategy testing

📊 Detection Summary:
   Current working directory: ${process.cwd()}
   Strategies tested (in order of priority):
${attemptedPaths}
`;

    console.error(troubleshootingInfo);

    throw new Error(
      `Unable to determine server root directory after testing ${strategies.length} strategies.\n\n` +
        `QUICK FIX: Set MCP_SERVER_ROOT environment variable to your server directory path.\n\n` +
        `See detailed troubleshooting information above.`
    );
  }

  /**
   * Phase 1: Initialize foundation (configuration, logging, basic services)
   */
  private async initializeFoundation(): Promise<void> {
    // Determine server root directory robustly
    const serverRoot = await this.determineServerRoot();
    console.error("DEBUG: Server root detected:", serverRoot);
    
    // Check if the process is still alive
    console.error("DEBUG: Process still alive after serverRoot assignment");
    
    try {
      console.error("DEBUG: About to check serverRoot type");
      const rootType = typeof serverRoot;
      console.error("DEBUG: Server root type:", rootType);
    } catch (error) {
      console.error("DEBUG: Error checking serverRoot type:", error);
      throw error;
    }
    
    try {
      console.error("DEBUG: About to check serverRoot length");
      const rootLength = serverRoot ? serverRoot.length : 'undefined';
      console.error("DEBUG: Server root length:", rootLength);
    } catch (error) {
      console.error("DEBUG: Error checking serverRoot length:", error);
      throw error;
    }

    // Initialize configuration manager using the detected server root
    console.error("DEBUG: About to call path.join with serverRoot:", serverRoot);
    const CONFIG_FILE = path.join(serverRoot, "config.json");
    console.error("DEBUG: Config file path:", CONFIG_FILE);
    console.error("DEBUG: About to create ConfigManager with CONFIG_FILE:", CONFIG_FILE);
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

    // Initialize logger with verbosity awareness
    console.error("DEBUG: About to create logger");
    this.logger = createSimpleLogger(transport);
    console.error("DEBUG: Logger created");

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
        // TODO: Add other capabilities if supported, e.g., for tools
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
      const serverRoot = await this.determineServerRoot(); // Ensure serverRoot is available
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

      // BEGIN ADDED CODE
      // Propagate updated data to other relevant managers
      // (This might already be happening if these managers fetch data on demand or are updated elsewhere,
      // but explicit updates ensure consistency after a hot-reload)
      if (this.mcpToolsManager) {
        this.mcpToolsManager.updateData(
          this._promptsData,
          this._convertedPrompts,
          this.categories
        );
      }
      if (this.promptExecutor) {
        this.promptExecutor.updatePrompts(this._convertedPrompts);
      }
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
    const isVerbose = args.includes("--verbose") || args.includes("--debug-startup");
    
    // Initialize gate evaluator (legacy)
    if (isVerbose) this.logger.info("🔄 Initializing gate evaluator...");
    this.gateEvaluator = createGateEvaluator(this.logger);
    
    // Initialize enhanced gate evaluator (Phase 2)
    if (isVerbose) this.logger.info("🔄 Initializing enhanced gate evaluator...");
    this.enhancedGateEvaluator = createEnhancedGateEvaluator(this.logger);
    
    // Initialize gate management tools
    if (isVerbose) this.logger.info("🔄 Initializing gate management tools...");
    this.gateManagementTools = createGateManagementTools(this.logger, this.enhancedGateEvaluator);
    
    // Initialize prompt executor
    if (isVerbose) this.logger.info("🔄 Initializing prompt executor...");
    this.promptExecutor = createPromptExecutor(
      this.logger,
      this.promptManager,
      this.conversationManager
    );
    this.promptExecutor.updatePrompts(this._convertedPrompts);
    
    // Initialize workflow engine with enhanced gate evaluator
    if (isVerbose) this.logger.info("🔄 Initializing workflow engine...");
    this.workflowEngine = createWorkflowEngine(
      this.logger,
      this.promptExecutor,
      this.enhancedGateEvaluator as any // Type assertion to handle interface compatibility
    );
    
    // Set up cross-references
    if (isVerbose) this.logger.info("🔄 Setting up cross-references...");
    this.promptExecutor.setWorkflowEngine(this.workflowEngine);
    
    // Register workflows from converted prompts
    if (isVerbose) this.logger.info("🔄 Registering workflows...");
    await this.registerWorkflows();

    // Initialize MCP tools manager
    if (isVerbose) this.logger.info("🔄 Initializing MCP tools manager...");
    this.mcpToolsManager = createMcpToolsManager(
      this.logger,
      this.mcpServer,
      this.promptManager,
      this.configManager,
      () => this.fullServerRefresh(),
      (reason: string) => this.restartServer(reason)
    );

    // Update MCP tools manager with current data
    if (isVerbose) this.logger.info("🔄 Updating MCP tools manager data...");
    this.mcpToolsManager.updateData(
      this._promptsData,
      this._convertedPrompts,
      this.categories
    );

    // Set gate management tools
    // this.mcpToolsManager.setGateManagementTools(this.gateManagementTools); // TODO: Add when gate management tools are implemented

    // Register all MCP tools
    if (isVerbose) this.logger.info("🔄 Registering all MCP tools...");
    await this.mcpToolsManager.registerAllTools();

    // Register all prompts
    if (isVerbose) this.logger.info("🔄 Registering all prompts...");
    await this.promptManager.registerAllPrompts(this._convertedPrompts);

    this.logger.info("All modules initialized successfully");
  }

  /**
   * Register workflows from converted prompts
   */
  private async registerWorkflows(): Promise<void> {
    let workflowCount = 0;
    
    for (const prompt of this._convertedPrompts) {
      if (prompt.isWorkflow && prompt.workflowDefinition) {
        try {
          await this.workflowEngine.registerWorkflow(prompt.workflowDefinition);
          workflowCount++;
          this.logger.debug(`Registered workflow: ${prompt.workflowDefinition.id}`);
        } catch (error) {
          this.logger.error(`Failed to register workflow ${prompt.workflowDefinition.id}:`, error);
        }
      }
    }
    
    if (workflowCount > 0) {
      this.logger.info(`Registered ${workflowCount} workflows`);
    }
  }

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
      console.error("DEBUG: startServer() - Using STDIO transport (no API manager needed)");
    }

    if (isStartupTest) {
      console.error("DEBUG: startServer() - Skipping MCP server startup (test mode)");
      // Create a mock server manager for health validation
      this.serverManager = {
        shutdown: () => console.error("DEBUG: Mock server shutdown"),
        getStatus: () => ({ running: true, transport: 'stdio' }),
        isRunning: () => true
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
      "🔥 Orchestrator: Starting full server refresh (hot-reload)..."
    );
    try {
      // Step 1: Reload all prompt data from disk by re-running the data loading phase.
      // This updates the orchestrator's internal state with the latest file contents.
      await this.loadAndProcessData();
      this.logger.info("✅ Data reloaded and processed from disk.");

      // Step 2: Propagate the new data to all dependent modules.
      // This ensures all parts of the application are synchronized with the new state.
      this.promptExecutor.updatePrompts(this._convertedPrompts);
      this.logger.info("✅ PromptExecutor updated with new prompts.");

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

      // Step 3: Re-register the newly loaded prompts with the running MCP server instance.
      // This makes the new/updated prompts available for execution immediately.
      await this.promptManager.registerAllPrompts(this._convertedPrompts);
      this.logger.info("✅ Prompts re-registered with MCP Server.");

      // Step 4: Re-register workflows from updated prompts
      await this.registerWorkflows();
      this.logger.info("✅ Workflows re-registered with Workflow Engine.");

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
  } {
    return {
      running: this.serverManager?.isRunning() || false,
      transport: this.transportManager?.getTransportType(),
      promptsLoaded: this._promptsData.length,
      categoriesLoaded: this._categories.length,
      serverStatus: this.serverManager?.getStatus(),
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
      promptExecutor: this.promptExecutor,
      workflowEngine: this.workflowEngine,
      gateEvaluator: this.gateEvaluator,
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
      this.promptExecutor &&
      this.workflowEngine &&
      this.gateEvaluator &&
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
    moduleStatus.promptExecutor = !!this.promptExecutor;
    moduleStatus.workflowEngine = !!this.workflowEngine;
    moduleStatus.gateEvaluator = !!this.gateEvaluator;
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
  } {
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
    };
  }

  /**
   * Emergency diagnostic information for troubleshooting
   */
  getDiagnosticInfo(): {
    timestamp: string;
    health: ReturnType<ApplicationOrchestrator["validateHealth"]>;
    performance: ReturnType<ApplicationOrchestrator["getPerformanceMetrics"]>;
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
 * Create and configure an application orchestrator
 */
export function createApplicationOrchestrator(): ApplicationOrchestrator {
  return new ApplicationOrchestrator();
}

/**
 * Main application entry point
 */
export async function startApplication(): Promise<ApplicationOrchestrator> {
  const orchestrator = createApplicationOrchestrator();
  await orchestrator.startup();
  return orchestrator;
}
