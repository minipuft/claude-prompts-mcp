// @lifecycle canonical - Bootstraps runtime modules and orchestrates startup lifecycle.
/**
 * Application Runtime Management
 * Manages application lifecycle, module coordination, and system health
 *
 * This is the streamlined version of the original ApplicationOrchestrator,
 * focused on runtime concerns while delegating execution to the execution engine.
 */

import * as path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Import all module managers
import {
  buildClaudeCodeCacheAuxiliaryReloadConfig,
  generateCacheOnStartup,
} from './claude-code-cache-hot-reload.js';
import { createRuntimeFoundation } from './context.js';
import { loadPromptData } from './data-loader.js';
import { buildGateAuxiliaryReloadConfig } from './gate-hot-reload.js';
import { buildHealthReport } from './health.js';
import { buildMethodologyAuxiliaryReloadConfig } from './methodology-hot-reload.js';
import { initializeModules } from './module-initializer.js';
import { resolveRuntimeLaunchOptions, RuntimeLaunchOptions } from './options.js';
import { buildScriptAuxiliaryReloadConfig } from './script-hot-reload.js';
import { startServerWithManagers } from './startup-server.js';
import { ConfigManager } from '../config/index.js';
import { FrameworkStateManager } from '../frameworks/framework-state-manager.js';
import { GateManager } from '../gates/gate-manager.js';
import { Logger } from '../logging/index.js';
import { PromptAssetManager } from '../prompts/index.js';
import { reloadPromptData } from '../prompts/prompt-refresh-service.js';
import { ConversationManager, createConversationManager } from '../text-references/conversation.js';
import { TextReferenceManager } from '../text-references/index.js';

// Import execution modules
// REMOVED: ExecutionCoordinator and GateEvaluator imports - modular chain and gate systems removed

//  Framework capabilities now integrated into base components
// No separate framework observers needed - functionality moved to enhanced FileObserver and HotReloadManager

// Import startup management

// Import types
import {
  Category,
  ConvertedPrompt,
  FrameworksConfig,
  PromptData,
  TransportMode,
} from '../types/index.js';
// Import chain utilities
import { ServiceManager } from '../utils/service-manager.js';

import type { PathResolver } from './paths.js';
import type { ApiManager } from '../api/index.js';
import type { McpToolsManager } from '../mcp-tools/index.js';
import type { ToolDescriptionManager } from '../mcp-tools/tool-description-manager.js';
import type { HotReloadEvent } from '../prompts/hot-reload-manager.js';
import type { ServerManager, TransportManager } from '../server/index.js';

/**
 * Application Runtime class
 * Coordinates all modules and manages application lifecycle
 */
export class Application {
  private logger!: Logger;
  private configManager!: ConfigManager;
  private textReferenceManager!: TextReferenceManager;
  private conversationManager!: ConversationManager;
  private promptManager!: PromptAssetManager;
  // REMOVED: executionCoordinator - modular chain system removed
  // REMOVED: gateEvaluator - gate evaluation system removed
  private mcpToolsManager!: McpToolsManager;
  private toolDescriptionManager!: ToolDescriptionManager;
  private frameworkStateManager!: FrameworkStateManager;
  private gateManager?: GateManager;
  private pathResolver!: PathResolver;
  private transportManager!: TransportManager;
  private apiManager: ApiManager | undefined;
  private serverManager: ServerManager | undefined;
  //  Framework capabilities integrated into base components
  // No separate framework observers needed

  // MCP Server instance
  private mcpServer!: McpServer;

  // Application data
  private _promptsData: PromptData[] = [];
  private _categories: Category[] = [];
  private _convertedPrompts: ConvertedPrompt[] = [];
  private promptsFilePath?: string;
  private hotReloadInitialized = false;
  private promptReloadInProgress: Promise<void> | undefined;
  private promptHotReloadHandler = (event: HotReloadEvent) => this.handlePromptHotReload(event);

  // Performance monitoring
  private memoryOptimizationInterval: NodeJS.Timeout | undefined;

  // Server root detector

  // Debug output control
  private debugOutput: boolean;
  private runtimeOptions: RuntimeLaunchOptions;
  private serviceManager: ServiceManager;
  private serverRoot?: string;
  private transportType?: TransportMode;

  private frameworksConfigListener:
    | ((newConfig: FrameworksConfig, previousConfig: FrameworksConfig) => void)
    | undefined;
  private pendingFrameworkSystemState: boolean | undefined;

  /**
   * Conditional debug logging to prevent output flood during tests
   */
  private debugLog(message: string, ...args: any[]): void {
    if (this.debugOutput) {
      console.error(`DEBUG: ${message}`, ...args);
    }
  }

  constructor(logger?: Logger, runtimeOptions?: RuntimeLaunchOptions) {
    // Will be initialized in startup() if not provided
    if (logger) {
      this.logger = logger;
    }
    this.runtimeOptions = runtimeOptions ?? resolveRuntimeLaunchOptions();
    this.serviceManager = new ServiceManager();

    // Initialize debug output control - suppress in test environments
    this.debugOutput = !this.runtimeOptions.testEnvironment;
  }

  /**
   * Initialize all modules in the correct order
   */
  async startup(): Promise<void> {
    try {
      //  Core Foundation
      this.debugLog('Starting  - Core Foundation...');
      await this.initializeFoundation();
      this.debugLog(' completed successfully');

      // Data Loading and Processing
      this.debugLog('Starting  - Data Loading and Processing...');
      await this.loadAndProcessData();
      this.debugLog(' completed successfully');

      // Module Initialization
      this.debugLog('Starting - Module Initialization...');
      await this.initializeModulesPrivate();
      this.debugLog('completed successfully');

      // Server Setup and Startup
      this.debugLog('Starting - Server Setup and Startup...');
      await this.startServer();
      this.debugLog('completed successfully');
      console.error('DEBUG: All startup phases completed, server should be running...');

      this.logger.info('Application startup completed successfully');
    } catch (error) {
      if (this.logger) {
        this.logger.error('Error during application startup:', error);
      } else {
        console.error('Error during application startup:', error);
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
   *  Initialize foundation (configuration, logging, basic services)
   */
  private async initializeFoundation(): Promise<void> {
    const foundation = await createRuntimeFoundation(this.runtimeOptions, {
      logger: this.logger,
      configManager: this.configManager,
      serviceManager: this.serviceManager,
    });

    this.runtimeOptions = foundation.runtimeOptions;
    this.logger = foundation.logger;
    this.configManager = foundation.configManager;
    this.serviceManager = foundation.serviceManager;
    this.serverRoot = foundation.serverRoot;
    this.transportType = foundation.transport;
    this.pathResolver = foundation.pathResolver;

    const transport = foundation.transport;

    // Check verbosity flags for conditional logging
    const isVerbose = this.runtimeOptions.verbose;
    const isQuiet = this.runtimeOptions.quiet;

    // Monitor framework feature toggles and log state changes
    this.setupFrameworkConfigListener();

    // Only show startup messages if not in quiet mode
    if (!isQuiet) {
      this.debugLog('About to call logger.info - Starting MCP...');
      this.logger.info('Starting MCP Claude Prompts Server...');
      this.debugLog('First logger.info completed');
      this.logger.info(`Transport: ${transport}`);
      this.debugLog('Second logger.info completed');
    }

    // Verbose mode shows detailed configuration info
    if (isVerbose) {
      this.debugLog('About to call verbose logger.info calls');
      this.logger.info(`Server root: ${this.serverRoot}`);
      this.logger.info(`Config file: ${this.configManager.getConfigPath()}`);
      this.logger.debug(`Command line args: ${JSON.stringify(this.runtimeOptions.args)}`);
      this.logger.debug(`Process working directory: ${process.cwd()}`);
      this.debugLog('Verbose logger.info calls completed');
    }

    // Initialize text reference manager
    this.debugLog('About to create TextReferenceManager');
    this.textReferenceManager = new TextReferenceManager(this.logger);
    this.debugLog('TextReferenceManager created');

    // Initialize conversation manager
    this.debugLog('About to create ConversationManager');
    try {
      this.conversationManager = createConversationManager(this.logger);
      this.debugLog('ConversationManager created successfully');
    } catch (error) {
      this.debugLog('ConversationManager creation failed:', error);
      throw error;
    }
    this.debugLog('ConversationManager created');

    // Create MCP server
    this.debugLog('About to get config');
    const config = this.configManager.getConfig();
    this.debugLog('Config retrieved successfully');
    this.debugLog('About to create McpServer');
    this.mcpServer = new McpServer(
      {
        name: config.server.name,
        version: config.server.version,
      },
      {
        capabilities: {
          prompts: { listChanged: true },
          tools: { listChanged: true },
        },
      }
    );
    this.debugLog('McpServer created successfully');

    // Only log completion in verbose mode
    if (isVerbose) {
      this.debugLog('About to log foundation initialized');
      this.logger.info('Foundation modules initialized');
      this.debugLog('Foundation initialized log completed');
    }
    this.debugLog('initializeFoundation completed successfully');
  }

  /**
   * Load and process prompt data
   */
  private async loadAndProcessData(): Promise<void> {
    if (!this.promptManager) {
      this.promptManager = new PromptAssetManager(
        this.logger,
        this.textReferenceManager,
        this.conversationManager,
        this.configManager,
        this.mcpServer
      );
    }

    const loadParams = {
      logger: this.logger,
      configManager: this.configManager,
      promptManager: this.promptManager,
      runtimeOptions: this.runtimeOptions,
      pathResolver: this.pathResolver,
    } as const;

    const optionalParams: Partial<Parameters<typeof loadPromptData>[0]> = {};

    if (this.serverRoot !== undefined) {
      optionalParams.serverRoot = this.serverRoot;
    }
    if (this.mcpToolsManager) {
      optionalParams.mcpToolsManager = this.mcpToolsManager;
    }
    if (this.apiManager) {
      optionalParams.apiManager = this.apiManager;
    }

    const result = await loadPromptData({ ...loadParams, ...optionalParams });

    this._promptsData = result.promptsData;
    this._categories = result.categories;
    this._convertedPrompts = result.convertedPrompts;
    this.promptsFilePath = result.promptsFilePath;
  }

  /**
   * Initialize remaining modules with loaded data
   */
  private async initializeModulesPrivate(): Promise<void> {
    const result = await initializeModules({
      logger: this.logger,
      configManager: this.configManager,
      runtimeOptions: this.runtimeOptions,
      promptsData: this._promptsData,
      categories: this._categories,
      convertedPrompts: this._convertedPrompts,
      promptManager: this.promptManager,
      conversationManager: this.conversationManager,
      textReferenceManager: this.textReferenceManager,
      mcpServer: this.mcpServer,
      serviceManager: this.serviceManager,
      callbacks: {
        fullServerRefresh: () => this.fullServerRefresh(),
        restartServer: (reason: string) => this.restartServer(reason),
        handleFrameworkConfigChange: (config, previous) =>
          this.handleFrameworkConfigChange(config, previous),
      },
    });

    this.frameworkStateManager = result.frameworkStateManager;
    this.gateManager = result.gateManager;
    this.mcpToolsManager = result.mcpToolsManager;
    this.toolDescriptionManager = result.toolDescriptionManager;

    const currentFrameworkConfig = this.configManager.getFrameworksConfig();
    this.syncFrameworkSystemStateFromConfig(
      currentFrameworkConfig,
      'Framework configuration synchronized during initialization'
    );

    await this.ensurePromptHotReload();

    // Generate hooks cache on startup
    if (this.serverRoot) {
      await generateCacheOnStartup(this.logger, this.serverRoot);
    }

    this.logger.info('All modules initialized successfully');
  }

  // Workflow registration completely removed - chains handle all multi-step execution

  /**
   * Setup and start the server
   */
  private async startServer(): Promise<void> {
    const startupParams: Parameters<typeof startServerWithManagers>[0] = {
      logger: this.logger,
      configManager: this.configManager,
      promptManager: this.promptManager,
      mcpToolsManager: this.mcpToolsManager,
      mcpServer: this.mcpServer,
      runtimeOptions: this.runtimeOptions,
      promptsData: this._promptsData,
      categories: this._categories,
      convertedPrompts: this._convertedPrompts,
    };

    if (this.transportType !== undefined) {
      startupParams.transportType = this.transportType;
    }

    const { transportManager, apiManager, serverManager } =
      await startServerWithManagers(startupParams);

    this.transportManager = transportManager;
    this.apiManager = apiManager;
    this.serverManager = serverManager;
  }

  /**
   * Switch to a different framework by ID (built-in or custom)
   * Core functionality: Allow switching between registered frameworks to guide the system
   */
  async switchFramework(frameworkId: string): Promise<{ success: boolean; message: string }> {
    //  Framework switching simplified - basic support only

    try {
      this.logger.info(`Framework switching to ${frameworkId} ( basic support)`);
      const result = {
        success: true,
        message: `Switched to ${frameworkId}`,
        newFramework: frameworkId,
        previousFramework: 'basic',
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
          message: result.message || 'Unknown error during framework switch',
        };
      }
    } catch (error) {
      this.logger.error('Framework switch error:', error);
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
    //  Framework status simplified - basic support only
    const status = {
      currentFramework: 'basic',
      currentFrameworkName: 'Basic Framework',
      isHealthy: true,
    };
    const available = ['basic'];

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
        this.logger.info('Initiating application shutdown...');
      }

      //  Stop server and transport layers
      if (this.serverManager) {
        if (this.logger) {
          this.logger.debug('Shutting down server manager...');
        }
        this.serverManager.shutdown();
      }

      // Stop transport layer (if it has shutdown method)
      if (
        this.transportManager &&
        'shutdown' in this.transportManager &&
        typeof (this.transportManager as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down transport manager...');
        }
        try {
          await (this.transportManager as any).shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down transport manager:', error);
        }
      }

      // Stop monitoring and resource-intensive components (if they have shutdown method)
      if (
        this.frameworkStateManager &&
        'shutdown' in this.frameworkStateManager &&
        typeof (this.frameworkStateManager as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down framework state manager...');
        }
        try {
          await (this.frameworkStateManager as any).shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down framework state manager:', error);
        }
      }

      // Stop file watchers and hot-reload systems (if they have shutdown method)
      if (
        this.promptManager &&
        'shutdown' in this.promptManager &&
        typeof (this.promptManager as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down prompt manager...');
        }
        try {
          await (this.promptManager as any).shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down prompt manager:', error);
        }
      }

      // Stop registered background services (watchers, timers, etc.)
      await this.serviceManager.stopAll();

      // Stop API and MCP tools (if they have shutdown method)
      if (
        this.apiManager &&
        'shutdown' in this.apiManager &&
        typeof (this.apiManager as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down API manager...');
        }
        try {
          await (this.apiManager as any).shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down API manager:', error);
        }
      }

      if (
        this.mcpToolsManager &&
        'shutdown' in this.mcpToolsManager &&
        typeof (this.mcpToolsManager as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down MCP tools manager...');
        }
        try {
          await (this.mcpToolsManager as any).shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down MCP tools manager:', error);
        }
      }

      // Stop conversation and text reference managers (if they have shutdown method)
      if (
        this.conversationManager &&
        'shutdown' in this.conversationManager &&
        typeof (this.conversationManager as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down conversation manager...');
        }
        try {
          await (this.conversationManager as any).shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down conversation manager:', error);
        }
      }

      if (
        this.textReferenceManager &&
        'shutdown' in this.textReferenceManager &&
        typeof (this.textReferenceManager as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down text reference manager...');
        }
        try {
          await (this.textReferenceManager as any).shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down text reference manager:', error);
        }
      }

      // Clean up internal timers
      if (this.configManager) {
        if (this.frameworksConfigListener) {
          this.configManager.removeListener(
            'frameworksConfigChanged',
            this.frameworksConfigListener
          );
          this.frameworksConfigListener = undefined;
        }
        this.configManager.stopWatching();
      }

      this.cleanup();

      if (this.logger) {
        this.logger.info('Application shutdown completed successfully');
      }
    } catch (error) {
      if (this.logger) {
        this.logger.error('Error during shutdown:', error);
      } else {
        console.error('Error during shutdown (logger not available):', error);
      }
      throw error;
    }
  }

  /**
   * Perform a full server refresh (hot-reload).
   * This reloads all prompts from disk and updates all relevant modules.
   */
  public async fullServerRefresh(): Promise<void> {
    this.logger.info('🔥 Application: Starting full server refresh (hot-reload)...');
    try {
      // Step 1: Reload all prompt data from disk by re-running the data loading phase.
      // This updates the application's internal state with the latest file contents.
      await this.loadAndProcessData();
      this.logger.info('✅ Data reloaded and processed from disk.');

      // Step 2: Framework hot-reload integration now handled by enhanced base components
      this.logger.info('✅ Framework capabilities integrated into base components');

      // Step 2.5:  - Simple framework switching status check
      const switchingStatus = {
        currentFramework: 'basic',
        currentFrameworkName: 'Basic Framework',
        enabledFrameworks: 1,
        availableFrameworks: 1,
      };
      this.logger.info(
        `✅ Framework switching system ready: ${switchingStatus.currentFrameworkName} active ` +
          `(${switchingStatus.enabledFrameworks}/${switchingStatus.availableFrameworks} frameworks available)`
      );

      // complexity removed - focusing on simple framework switching instead of multi-framework consensus

      // Step 3: Propagate the new data to all dependent modules.
      // This ensures all parts of the application are synchronized with the new state.
      // REMOVED: ExecutionCoordinator prompts update - modular chain system removed

      if (this.mcpToolsManager) {
        this.mcpToolsManager.updateData(this._promptsData, this._convertedPrompts, this.categories);
        this.logger.info('✅ McpToolsManager updated with new data.');
      }

      if (this.apiManager) {
        // The API manager is only available for the SSE transport.
        this.apiManager.updateData(this._promptsData, this._categories, this.convertedPrompts);
        this.logger.info('✅ ApiManager updated with new data.');
      }

      // Step 4: Notify MCP clients that the prompt list has changed (proper hot-reload)
      // This follows MCP protocol - clients will re-query the server for the updated list
      await this.promptManager.notifyPromptsListChanged();
      this.logger.info('✅ Prompts list_changed notification sent to MCP clients.');

      // Step 5:  - Workflow registration removed

      this.logger.info('🚀 Full server refresh completed successfully.');
    } catch (error) {
      this.logger.error('❌ Error during full server refresh:', error);
      // Re-throw the error so the caller can handle it appropriately.
      throw error;
    }
  }

  private async ensurePromptHotReload(): Promise<void> {
    if (this.hotReloadInitialized) {
      return;
    }

    if (!this.promptManager || !this.promptsFilePath || !this.mcpToolsManager) {
      return;
    }

    try {
      const serviceName = 'prompt-hot-reload';
      if (!this.serviceManager.hasService(serviceName)) {
        this.serviceManager.register({
          name: serviceName,
          start: async () => {
            // Build auxiliary reload configs for methodology, gates, and script tools
            const methodologyAux = buildMethodologyAuxiliaryReloadConfig(
              this.logger,
              this.mcpToolsManager
            );
            const gateAux = buildGateAuxiliaryReloadConfig(this.logger, this.gateManager);

            // Build script tool auxiliary reload config
            const scriptLoader = this.promptManager.getModules().converter.getScriptToolLoader();
            const promptsDir = this.promptsFilePath
              ? path.dirname(this.promptsFilePath)
              : undefined;
            const scriptAux = promptsDir
              ? buildScriptAuxiliaryReloadConfig(this.logger, scriptLoader, promptsDir)
              : undefined;

            // Build Claude Code cache refresh auxiliary reload config
            const claudeCodeCacheAux = this.serverRoot
              ? buildClaudeCodeCacheAuxiliaryReloadConfig(this.logger, this.serverRoot)
              : undefined;

            // Collect all auxiliary reloads
            const auxiliaryReloads = [
              methodologyAux,
              gateAux,
              scriptAux,
              claudeCodeCacheAux,
            ].filter((aux): aux is NonNullable<typeof aux> => aux !== undefined);

            const hotReloadOptions: Parameters<typeof this.promptManager.startHotReload>[2] = {};

            if (auxiliaryReloads.length > 0) {
              hotReloadOptions.auxiliaryReloads = auxiliaryReloads;
            }

            await this.promptManager.startHotReload(
              this.promptsFilePath!,
              this.promptHotReloadHandler,
              hotReloadOptions
            );
          },
          stop: async () => {
            await this.promptManager.stopHotReload();
            this.hotReloadInitialized = false;
          },
        });
      }

      await this.serviceManager.startService(serviceName);
      this.hotReloadInitialized = true;
      this.logger.info('🔄 Prompt hot reload monitoring activated');
    } catch (error) {
      this.logger.error('Failed to start prompt hot reload monitoring:', error);
    }
  }

  private async handlePromptHotReload(event: HotReloadEvent): Promise<void> {
    if (!this.promptManager || !this.mcpToolsManager) {
      this.logger.warn('Hot reload triggered before prompt systems initialized; ignoring event.');
      return;
    }

    if (this.promptReloadInProgress) {
      this.logger.warn(`Hot reload already running; skipping event: ${event.reason}`);
      return;
    }

    const reloadPromise = (async () => {
      try {
        this.logger.info(
          `🔥 Hot reload event received (${event.type}): ${
            event.reason
          } [${event.affectedFiles.join(', ')}]`
        );

        const result = await reloadPromptData({
          configManager: this.configManager,
          promptManager: this.promptManager,
          mcpToolsManager: this.mcpToolsManager,
        });

        this._promptsData = result.promptsData;
        this._convertedPrompts = result.convertedPrompts;
        this._categories = result.categories;
        this.promptsFilePath = result.promptsFilePath;

        if (this.apiManager) {
          this.apiManager.updateData(this._promptsData, this._categories, this._convertedPrompts);
        }

        if (this.mcpServer) {
          const count = await this.promptManager.registerAllPrompts(this._convertedPrompts);
          this.logger.info(`🔁 Re-registered ${count} prompts after hot reload.`);
          await this.promptManager.notifyPromptsListChanged();
        }

        this.logger.info('✅ Prompt data refreshed from filesystem changes.');
      } catch (error) {
        this.logger.error('❌ Prompt hot reload failed:', error);
      } finally {
        this.promptReloadInProgress = undefined;
      }
    })();

    this.promptReloadInProgress = reloadPromise;
    await reloadPromise;
  }

  /**
   * Restart the application by shutting down and exiting with a restart code.
   * Relies on a process manager (e.g., PM2) to restart the process.
   */
  public async restartServer(reason: string = 'Manual restart'): Promise<void> {
    this.logger.info(`🚨 Initiating server restart. Reason: ${reason}`);
    try {
      // Ensure all current operations are gracefully shut down.
      await this.shutdown();
      this.logger.info('✅ Server gracefully shut down. Exiting with restart code.');
    } catch (error) {
      this.logger.error('❌ Error during pre-restart shutdown:', error);
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
      // workflowExecutions: number; // removed, workflows tracked as advanced chains
      successRate: number;
    };
  } {
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
    const foundationHealthy = !!(this.logger && this.configManager && this.textReferenceManager);
    moduleStatus['foundation'] = foundationHealthy;
    if (!foundationHealthy) {
      issues.push('Foundation modules not properly initialized');
    }

    // Check data loading
    const dataLoaded = this._promptsData.length > 0 && this._categories.length > 0;
    moduleStatus['dataLoaded'] = dataLoaded;
    if (!dataLoaded) {
      issues.push('Prompt data not loaded or empty');
    }

    // Check module initialization
    const modulesInitialized = !!(
      this.promptManager &&
      // REMOVED: this.executionCoordinator && this.gateEvaluator - modular systems removed
      this.mcpToolsManager
    );
    moduleStatus['modulesInitialized'] = modulesInitialized;
    moduleStatus['serverRunning'] = !!(this.serverManager && this.transportManager);

    moduleStatus['configManager'] = !!this.configManager;
    moduleStatus['logger'] = !!this.logger;
    moduleStatus['promptManager'] = !!this.promptManager;
    moduleStatus['textReferenceManager'] = !!this.textReferenceManager;
    moduleStatus['conversationManager'] = !!this.conversationManager;
    // REMOVED: moduleStatus for executionCoordinator and gateEvaluator - modular systems removed
    moduleStatus['mcpToolsManager'] = !!this.mcpToolsManager;
    moduleStatus['transportManager'] = !!this.transportManager;
    moduleStatus['apiManager'] = !!this.apiManager;
    moduleStatus['serverManager'] = !!this.serverManager;

    // Check overall health
    return buildHealthReport({
      foundation: foundationHealthy,
      dataLoaded,
      modulesInitialized,
      serverRunning: moduleStatus['serverRunning'],
      moduleStatus,
      promptsLoaded: this._promptsData.length,
      categoriesLoaded: this._categories.length,
      serverStatus: this.serverManager?.getStatus(),
      issues,
    });
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
        ...(this.transportManager?.isSse()
          ? { serverConnections: this.transportManager.getActiveConnectionsCount() }
          : {}),
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
      this.logger.debug('Memory optimization timer stopped');
    }
  }

  private setupFrameworkConfigListener(): void {
    if (!this.configManager || this.frameworksConfigListener) {
      return;
    }

    this.frameworksConfigListener = (
      newConfig: FrameworksConfig,
      previousConfig: FrameworksConfig
    ) => {
      this.handleFrameworkConfigChange(newConfig, previousConfig);
    };

    this.configManager.on('frameworksConfigChanged', this.frameworksConfigListener);
    this.handleFrameworkConfigChange(this.configManager.getFrameworksConfig());
  }

  private handleFrameworkConfigChange(
    newConfig: FrameworksConfig,
    previousConfig?: FrameworksConfig
  ): void {
    if (!this.logger) {
      return;
    }

    const disabled = this.describeDisabledFrameworkFeatures(newConfig);
    if (disabled.length > 0) {
      this.logger.warn(`⚠️ Framework features disabled via config: ${disabled.join(', ')}`);
    }

    this.syncFrameworkSystemStateFromConfig(newConfig);

    if (previousConfig) {
      const previouslyDisabled = this.describeDisabledFrameworkFeatures(previousConfig);
      if (previouslyDisabled.length > 0 && disabled.length === 0) {
        this.logger.info('✅ Framework features re-enabled; all toggles active');
      }
    }
  }

  private syncFrameworkSystemStateFromConfig(config: FrameworksConfig, reason?: string): void {
    const gatesConfig = this.configManager.getGatesConfig();
    const systemPromptEnabled = config.injection?.systemPrompt?.enabled ?? true;
    const shouldEnable =
      systemPromptEnabled || gatesConfig.enableMethodologyGates || config.dynamicToolDescriptions;

    if (!this.frameworkStateManager) {
      this.pendingFrameworkSystemState = shouldEnable;
      return;
    }

    const resolvedReason =
      reason ??
      (shouldEnable
        ? 'Framework system enabled via configuration toggles'
        : 'Framework system disabled via configuration toggles');
    this.frameworkStateManager.setFrameworkSystemEnabled(shouldEnable, resolvedReason);
    this.pendingFrameworkSystemState = undefined;
  }

  private describeDisabledFrameworkFeatures(config: FrameworksConfig): string[] {
    const gatesConfig = this.configManager.getGatesConfig();
    const disabled: string[] = [];
    const systemPromptEnabled = config.injection?.systemPrompt?.enabled ?? true;
    if (!systemPromptEnabled) {
      disabled.push('system prompt injection');
    }
    if (!gatesConfig.enableMethodologyGates) {
      disabled.push('methodology gates');
    }
    if (!config.dynamicToolDescriptions) {
      disabled.push('dynamic tool descriptions');
    }
    return disabled;
  }

  /**
   * Emergency diagnostic information for troubleshooting
   */
  getDiagnosticInfo(): {
    timestamp: string;
    health: ReturnType<Application['validateHealth']>;
    performance: ReturnType<Application['getPerformanceMetrics']>;
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
        errors.push('MCP Server instance not available');
      }

      if (this._promptsData.length === 0) {
        errors.push('No prompts loaded');
      }

      if (this._categories.length === 0) {
        errors.push('No categories loaded');
      }

      return {
        timestamp: new Date().toISOString(),
        health: this.validateHealth(),
        performance: this.getPerformanceMetrics(),
        configuration: {
          transport: this.transportManager?.getTransportType() || 'unknown',
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
          issues: ['Failed to collect health information'],
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
          transport: 'unknown',
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
export function createApplication(
  logger?: Logger,
  runtimeOptions?: RuntimeLaunchOptions
): Application {
  return new Application(logger, runtimeOptions);
}

/**
 * Main application entry point
 */
export async function startApplication(
  runtimeOptions?: RuntimeLaunchOptions
): Promise<Application> {
  const application = createApplication(undefined, runtimeOptions);
  await application.startup();
  return application;
}
