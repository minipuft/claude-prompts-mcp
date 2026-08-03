// @lifecycle canonical - Bootstraps runtime modules and orchestrates startup lifecycle.
/**
 * Application Runtime Management
 * Manages application lifecycle, module coordination, and system health
 *
 * This is the streamlined version of the original ApplicationOrchestrator,
 * focused on runtime concerns while delegating execution to the execution engine.
 */

import * as path from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';

// Import all module managers
import { createRuntimeFoundation } from './context.js';
import { loadPromptData } from './data-loader.js';
import { buildFrameworkAuxiliaryReloadConfig } from './framework-hot-reload.js';
import { buildGateAuxiliaryReloadConfig } from './gate-hot-reload.js';
import { buildHealthReport } from './health.js';
import { publishResourcesChanged, publishToolsChanged } from './list-change-notifier.js';
import { initializeModules } from './module-initializer.js';
import { resolveRuntimeLaunchOptions, RuntimeLaunchOptions } from './options.js';
import { buildResourceChangeTrackerAuxiliaryReloadConfig } from './resource-change-tracking.js';
import { registerMcpResources as registerMcpResourcesOn } from './resource-registration.js';
import { buildScriptAuxiliaryReloadConfig } from './script-hot-reload.js';
import { resolveServingUnitScope } from './serving-unit-scope.js';
import { startServerWithManagers } from './startup-server.js';
import { TelemetryLifecycle } from './telemetry-lifecycle.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { ServerLifecycle, TransportRouter } from '#infra/http/index.js';
import type { ApiRouter } from '#mcp/http/api.js';
import type { McpToolRouter } from '#mcp/tools/index.js';
import type { HotReloadEvent } from '#modules/hot-reload/hot-reload-observer.js';
import type { Category, PromptData } from '#modules/prompts/types.js';
import type { ListChangeTargets } from './list-change-notifier.js';
import type { PathResolver } from './paths.js';
import type { McpServerFactory } from '@modelcontextprotocol/server';

import { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import { GateManager } from '#engine/gates/gate-manager.js';
import { ConfigLoader } from '#infra/config/index.js';
import { HookRegistry } from '#infra/hooks/index.js';
import { Logger } from '#infra/logging/index.js';
import { McpNotificationEmitter } from '#infra/observability/notifications/index.js';
import { PromptAssetManager } from '#modules/prompts/index.js';
import { reloadPromptData } from '#modules/prompts/prompt-refresh-service.js';
import { ConversationStore, createConversationStore } from '#modules/text-refs/conversation.js';
import { TextReferenceStore } from '#modules/text-refs/index.js';
import { ResolvedFrameworkConfig, TransportMode } from '#shared/types/index.js';
import { ServiceOrchestrator } from '#shared/utils/service-orchestrator.js';

/**
 * Application Runtime class
 * Coordinates all modules and manages application lifecycle
 */
export class Application {
  private logger!: Logger;
  private configManager!: ConfigLoader;
  private textReferenceStore!: TextReferenceStore;
  private conversationStore!: ConversationStore;
  private promptManager!: PromptAssetManager;
  private mcpToolsManager!: McpToolRouter;
  private frameworkStateStore!: FrameworkStateStore;
  private gateManager?: GateManager;
  private hookRegistry!: HookRegistry;
  private notificationEmitter!: McpNotificationEmitter;
  private telemetryLifecycle?: TelemetryLifecycle;
  private pathResolver!: PathResolver;
  private transportRouter!: TransportRouter;
  private apiRouter: ApiRouter | undefined;
  private serverLifecycle: ServerLifecycle | undefined;

  // MCP Server instance
  private mcpServer!: McpServer;

  // Application data
  private _promptsData: PromptData[] = [];
  private _categories: Category[] = [];
  private _convertedPrompts: ConvertedPrompt[] = [];
  private promptsDirectory?: string;
  private hotReloadInitialized = false;
  private promptReloadInProgress: Promise<void> | undefined;
  private promptHotReloadHandler = (event: HotReloadEvent) => this.handlePromptHotReload(event);

  private memoryOptimizationInterval: NodeJS.Timeout | undefined;
  private debugOutput: boolean;
  private runtimeOptions: RuntimeLaunchOptions;
  private serviceOrchestrator: ServiceOrchestrator;
  private serverRoot?: string;
  private transportType?: TransportMode;

  private frameworksConfigListener:
    | ((newConfig: ResolvedFrameworkConfig, previousConfig: ResolvedFrameworkConfig) => void)
    | undefined;
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
    this.serviceOrchestrator = new ServiceOrchestrator();

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

      // Start telemetry (SDK init + exporter connection, no-ops if disabled)
      if (this.telemetryLifecycle) {
        await this.telemetryLifecycle.start();
      }

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
      serviceOrchestrator: this.serviceOrchestrator,
    });

    this.runtimeOptions = foundation.runtimeOptions;
    this.logger = foundation.logger;
    // Cast safe: runtime/ composition root creates the concrete ConfigManager
    this.configManager = foundation.configManager as ConfigLoader;
    this.serviceOrchestrator = foundation.serviceOrchestrator;
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
      this.logger.info('Starting MCP Claude Prompts Server...');
      this.logger.info(`Transport: ${transport}`);
    }

    if (isVerbose) {
      this.logger.info(`Server root: ${this.serverRoot}`);
      this.logger.info(`Config file: ${this.configManager.getConfigPath()}`);
      this.logger.debug(`Command line args: ${JSON.stringify(this.runtimeOptions.args)}`);
      this.logger.debug(`Process working directory: ${process.cwd()}`);
    }

    this.textReferenceStore = new TextReferenceStore(this.logger);
    this.conversationStore = createConversationStore(this.logger);

    this.mcpServer = this.constructMcpServer();
    this.debugLog('McpServer created successfully');

    // Initialize hook registry and notification emitter
    this.hookRegistry = new HookRegistry(this.logger);
    this.notificationEmitter = new McpNotificationEmitter(this.logger);
    // McpServer has notification() at runtime - cast to the expected interface
    // The emitter has canSend() guard that checks typeof notification === 'function'
    this.notificationEmitter.setServer(
      this
        .mcpServer as unknown as import('#infra/observability/notifications/index.js').McpNotificationServer
    );
    this.debugLog('HookRegistry and McpNotificationEmitter initialized');

    // Initialize telemetry lifecycle (creates runtime + hook observer, does not start SDK yet)
    const serverConfig = this.configManager.getConfig().server;
    const telemetryConfig = this.configManager.getTelemetryConfig();
    this.telemetryLifecycle = new TelemetryLifecycle({
      config: telemetryConfig,
      logger: this.logger,
      hookRegistry: this.hookRegistry,
      serviceName: serverConfig.name,
      serviceVersion: serverConfig.version,
    });
    this.debugLog('TelemetryLifecycle initialized');

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
        this.textReferenceStore,
        this.conversationStore,
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
    if (this.apiRouter) {
      optionalParams.apiRouter = this.apiRouter;
    }

    const result = await loadPromptData({ ...loadParams, ...optionalParams });

    this._promptsData = result.promptsData;
    this._categories = result.categories;
    this._convertedPrompts = result.convertedPrompts;
    this.promptsDirectory = result.promptsDirectory;
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
      textReferenceStore: this.textReferenceStore,
      mcpServer: this.mcpServer,
      serverRoot: this.serverRoot,
      pathResolver: this.pathResolver,
      hookRegistry: this.hookRegistry,
      notificationEmitter: this.notificationEmitter,
      callbacks: {
        fullServerRefresh: () => this.fullServerRefresh(),
        restartServer: (reason: string) => this.restartServer(reason),
        handleFrameworkConfigChange: (config, previous) =>
          this.handleFrameworkConfigChange(config, previous),
      },
    });

    this.frameworkStateStore = result.frameworkStateStore;
    this.gateManager = result.gateManager;
    this.mcpToolsManager = result.mcpToolsManager;

    const currentFrameworkConfig = this.configManager.getFrameworksConfig();
    this.syncFrameworkSystemStateFromConfig(
      currentFrameworkConfig,
      'Framework configuration synchronized during initialization'
    );

    await this.ensurePromptHotReload();

    // Register MCP resources for token-efficient read-only access
    this.registerMcpResources(this.mcpServer);

    // Route tool-list-changed to whichever transport is serving. HTTP has no
    // long-lived instance to push from, so it publishes through the handler's
    // notifier; STDIO pushes from the instance `serveStdio` pinned.
    // The notifier stays async so the routing can change without rippling into
    // every caller, though both publish paths are synchronous today.
    this.mcpToolsManager.setToolsChangedNotifier(async () => {
      publishToolsChanged(this.listChangeTargets());
    });

    this.logger.info('All modules initialized successfully');
  }

  /**
   * Register MCP resources for prompts, gates, frameworks, and observability.
   * Resources provide 5-16x more token-efficient discovery than tool-based list operations.
   */
  /**
   * Construct an unregistered `McpServer` shell.
   *
   * Capabilities are declared per instance, so every serving unit — the STDIO
   * connection and each HTTP request — advertises the same surface.
   */
  private constructMcpServer(): McpServer {
    const config = this.configManager.getConfig();
    return new McpServer(
      {
        name: config.server.name,
        version: config.server.version,
      },
      {
        capabilities: {
          prompts: { listChanged: true },
          tools: { listChanged: true },
          resources: { listChanged: true },
        },
      }
    );
  }

  /**
   * Build the factory the SDK calls once per serving unit.
   *
   * Protocol revision 2026-07-28 removes protocol sessions: `createMcpHandler`
   * constructs a fresh `McpServer` for each HTTP request, and `serveStdio` one
   * per connection. Only the server shell and its tool/resource bindings are
   * per-unit — the executors, managers, and stores those bindings close over
   * stay the singletons built during module initialization, so this is a
   * binding step rather than a second startup.
   */
  createMcpServerFactory(): McpServerFactory {
    return async (ctx) => {
      const server = this.constructMcpServer();
      // The advertised tool surface is state-dependent, and that state is
      // workspace-scoped. `ctx` is the only scope signal available here: the
      // schema is built now, before any call has been dispatched, so the
      // per-call `extra` the rest of the server reads does not exist yet.
      await this.mcpToolsManager.registerAllTools(server, resolveServingUnitScope(ctx));
      this.registerMcpResources(server);
      return server;
    };
  }

  /**
   * The same factory, wrapped to capture the instance STDIO pins.
   *
   * `serveStdio` builds exactly one server for the connection's lifetime, and
   * the handle it returns exposes only `close()` — there is no notifier on it.
   * The pinned instance is therefore the only thing that can push a
   * notification over STDIO, so it is recorded as it is built.
   *
   * HTTP needs no equivalent: it has no long-lived instance to record, and
   * publishes through the handler's own `notify` facade instead.
   */
  createStdioServerFactory(): McpServerFactory {
    const build = this.createMcpServerFactory();
    return async (ctx) => {
      const server = (await build(ctx)) as McpServer;
      this.mcpServer = server;
      this.mcpToolsManager.setPinnedServer(server);
      this.notificationEmitter.setServer(
        server as unknown as import('#infra/observability/notifications/index.js').McpNotificationServer
      );
      return server;
    };
  }

  /**
   * Tell clients the resource list changed, through whichever transport serves.
   *
   * Resources are hot-reloaded, so without this a client holds a stale list
   * until it re-lists on its own. The channel existed but had no producer; the
   * prompt hot-reload completion below is it.
   */
  private notifyResourcesChanged(): void {
    publishResourcesChanged(this.listChangeTargets());
  }

  /** Collaborators the list-change routing picks between. */
  private listChangeTargets(): ListChangeTargets {
    return {
      httpPublisher: this.transportRouter?.getHttpHandler()?.notify,
      pinnedServer: this.mcpServer,
      logger: this.logger,
    };
  }

  private registerMcpResources(target: McpServer): void {
    registerMcpResourcesOn(target, {
      logger: this.logger,
      configManager: this.configManager,
      frameworkStateStore: this.frameworkStateStore,
      mcpToolsManager: this.mcpToolsManager,
      ...(this.gateManager ? { gateManager: this.gateManager } : {}),
      getConvertedPrompts: () => this._convertedPrompts,
    });
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
      mcpServerFactory: this.createMcpServerFactory(),
      stdioServerFactory: this.createStdioServerFactory(),
      runtimeOptions: this.runtimeOptions,
      promptsData: this._promptsData,
      categories: this._categories,
      convertedPrompts: this._convertedPrompts,
    };

    if (this.transportType !== undefined) {
      startupParams.transportType = this.transportType;
    }

    const { transportRouter, apiRouter, serverLifecycle } =
      await startServerWithManagers(startupParams);

    this.transportRouter = transportRouter;
    this.apiRouter = apiRouter;
    this.serverLifecycle = serverLifecycle;
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

      // Flush telemetry spans before tearing down services
      if (this.telemetryLifecycle) {
        try {
          await this.telemetryLifecycle.shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down telemetry:', error);
        }
      }

      //  Stop server and transport layers
      if (this.serverLifecycle) {
        if (this.logger) {
          this.logger.debug('Shutting down server manager...');
        }
        this.serverLifecycle.shutdown();
      }

      // Stop transport layer (if it has shutdown method)
      if (
        this.transportRouter &&
        'shutdown' in this.transportRouter &&
        typeof (this.transportRouter as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down transport manager...');
        }
        try {
          await (this.transportRouter as any).shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down transport manager:', error);
        }
      }

      // Stop monitoring and resource-intensive components (if they have shutdown method)
      if (
        this.frameworkStateStore &&
        'shutdown' in this.frameworkStateStore &&
        typeof (this.frameworkStateStore as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down framework state manager...');
        }
        try {
          await (this.frameworkStateStore as any).shutdown();
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
          this.logger.debug('Shutting down prompt assets...');
        }
        try {
          await (this.promptManager as any).shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down prompt assets:', error);
        }
      }

      // Stop registered background services (watchers, timers, etc.)
      await this.serviceOrchestrator.stopAll();

      // Stop API and MCP tools (if they have shutdown method)
      if (
        this.apiRouter &&
        'shutdown' in this.apiRouter &&
        typeof (this.apiRouter as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down API manager...');
        }
        try {
          await (this.apiRouter as any).shutdown();
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
        this.conversationStore &&
        'shutdown' in this.conversationStore &&
        typeof (this.conversationStore as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down conversation manager...');
        }
        try {
          await (this.conversationStore as any).shutdown();
        } catch (error) {
          this.logger?.warn('Error shutting down conversation manager:', error);
        }
      }

      if (
        this.textReferenceStore &&
        'shutdown' in this.textReferenceStore &&
        typeof (this.textReferenceStore as any).shutdown === 'function'
      ) {
        if (this.logger) {
          this.logger.debug('Shutting down text reference manager...');
        }
        try {
          await (this.textReferenceStore as any).shutdown();
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

      if (this.mcpToolsManager) {
        this.mcpToolsManager.updateData(this._promptsData, this._convertedPrompts, this.categories);
        this.logger.info('✅ McpToolsManager updated with new data.');
      }

      if (this.apiRouter) {
        // The API manager is only available for the SSE transport.
        this.apiRouter.updateData(this._promptsData, this._categories, this.convertedPrompts);
        this.logger.info('✅ ApiRouter updated with new data.');
      }

      // Step 3.5: Re-sync resource index for hook consumption
      if (this.serverRoot) {
        try {
          const { SqliteEngine } = await import('#infra/database/sqlite-engine.js');
          const { createResourceIndexer } = await import('#infra/database/resource-indexer.js');
          const { ScriptToolDefinitionLoader } =
            await import('#modules/automation/core/script-definition-loader.js');
          const dbManager = await SqliteEngine.getInstance(this.serverRoot, this.logger);
          await dbManager.initialize();
          const resourcesDir =
            this.pathResolver?.getResourcesPath() ?? path.join(this.serverRoot, 'resources');
          const scriptLoader = new ScriptToolDefinitionLoader({ validateOnLoad: true });
          const indexer = createResourceIndexer(dbManager, this.logger, {
            resourcesDir,
            toolLoader: (dir, id) => scriptLoader.loadAllToolsForPrompt(dir, id),
          });
          await indexer.syncAll();
          this.logger.info('✅ Resource index re-synced after hot-reload.');
        } catch (error) {
          this.logger.warn('Failed to re-sync resource index:', error);
        }
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

    if (!this.promptManager || !this.promptsDirectory || !this.mcpToolsManager) {
      return;
    }

    try {
      const serviceName = 'prompt-hot-reload';
      if (!this.serviceOrchestrator.hasService(serviceName)) {
        this.serviceOrchestrator.register({
          name: serviceName,
          start: async () => {
            // Build auxiliary reload configs for framework, gates, and script tools
            const frameworkAux = buildFrameworkAuxiliaryReloadConfig(
              this.logger,
              this.mcpToolsManager
            );
            const gateAux = buildGateAuxiliaryReloadConfig(this.logger, this.gateManager);

            // Build script tool auxiliary reload config
            const scriptLoader = this.promptManager.getModules().converter.getScriptToolLoader();
            const promptsDir = this.promptsDirectory ?? undefined;
            const scriptAux = promptsDir
              ? buildScriptAuxiliaryReloadConfig(this.logger, scriptLoader, promptsDir)
              : undefined;

            // Build resource change tracking auxiliary reload config
            const resourceChangeTrackerAux = buildResourceChangeTrackerAuxiliaryReloadConfig(
              this.logger,
              this.configManager
            );

            // Collect all auxiliary reloads
            const auxiliaryReloads = [
              frameworkAux,
              gateAux,
              scriptAux,
              resourceChangeTrackerAux,
            ].filter((aux): aux is NonNullable<typeof aux> => aux !== undefined);

            const hotReloadOptions: Parameters<typeof this.promptManager.startHotReload>[2] = {};

            if (auxiliaryReloads.length > 0) {
              hotReloadOptions.auxiliaryReloads = auxiliaryReloads;
            }

            await this.promptManager.startHotReload(
              this.promptsDirectory!,
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

      await this.serviceOrchestrator.startService(serviceName);
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
        this.promptsDirectory = result.promptsDirectory;

        if (this.apiRouter) {
          this.apiRouter.updateData(this._promptsData, this._categories, this._convertedPrompts);
        }

        if (this.mcpServer) {
          const count = await this.promptManager.registerAllPrompts(this._convertedPrompts);
          this.logger.info(`🔁 Re-registered ${count} prompts after hot reload.`);
          await this.promptManager.notifyPromptsListChanged();
        }

        // Prompt resources project `_convertedPrompts`, so a reload changes the
        // resource list too. Prompts were already announced above; resources
        // were the half that had no producer.
        this.notifyResourcesChanged();

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
      running: this.serverLifecycle?.isRunning() || false,
      transport: this.transportRouter?.getTransportType(),
      promptsLoaded: this._promptsData.length,
      categoriesLoaded: this._categories.length,
      serverStatus: this.serverLifecycle?.getStatus(),
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
      textReferenceStore: this.textReferenceStore,
      conversationStore: this.conversationStore,

      mcpToolsManager: this.mcpToolsManager,
      apiRouter: this.apiRouter,
      serverLifecycle: this.serverLifecycle,
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
    const foundationHealthy = !!(this.logger && this.configManager && this.textReferenceStore);
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
    const modulesInitialized = !!(this.promptManager && this.mcpToolsManager);
    moduleStatus['modulesInitialized'] = modulesInitialized;
    moduleStatus['serverRunning'] = !!(this.serverLifecycle && this.transportRouter);

    moduleStatus['configManager'] = !!this.configManager;
    moduleStatus['logger'] = !!this.logger;
    moduleStatus['promptManager'] = !!this.promptManager;
    moduleStatus['textReferenceStore'] = !!this.textReferenceStore;
    moduleStatus['conversationStore'] = !!this.conversationStore;

    moduleStatus['mcpToolsManager'] = !!this.mcpToolsManager;
    moduleStatus['transportRouter'] = !!this.transportRouter;
    moduleStatus['apiRouter'] = !!this.apiRouter;
    moduleStatus['serverLifecycle'] = !!this.serverLifecycle;

    // Check overall health
    return buildHealthReport({
      foundation: foundationHealthy,
      dataLoaded,
      modulesInitialized,
      serverRunning: moduleStatus['serverRunning'],
      moduleStatus,
      promptsLoaded: this._promptsData.length,
      categoriesLoaded: this._categories.length,
      serverStatus: this.serverLifecycle?.getStatus(),
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
      newConfig: ResolvedFrameworkConfig,
      previousConfig: ResolvedFrameworkConfig
    ) => {
      this.handleFrameworkConfigChange(newConfig, previousConfig);
    };

    this.configManager.on('frameworksConfigChanged', this.frameworksConfigListener);
    this.handleFrameworkConfigChange(this.configManager.getFrameworksConfig());
  }

  private handleFrameworkConfigChange(
    newConfig: ResolvedFrameworkConfig,
    previousConfig?: ResolvedFrameworkConfig
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

  private syncFrameworkSystemStateFromConfig(
    config: ResolvedFrameworkConfig,
    reason?: string
  ): void {
    const gatesConfig = this.configManager.getGatesConfig();
    const systemPromptEnabled = config.injection?.systemPrompt?.enabled ?? true;
    const shouldEnable =
      systemPromptEnabled || gatesConfig.enableFrameworkGates || config.dynamicToolDescriptions;

    if (!this.frameworkStateStore) {
      return;
    }

    const resolvedReason =
      reason ??
      (shouldEnable
        ? 'Framework system enabled via configuration toggles'
        : 'Framework system disabled via configuration toggles');
    this.frameworkStateStore.setFrameworkSystemEnabled(shouldEnable, resolvedReason);
  }

  private describeDisabledFrameworkFeatures(config: ResolvedFrameworkConfig): string[] {
    const gatesConfig = this.configManager.getGatesConfig();
    const disabled: string[] = [];
    const systemPromptEnabled = config.injection?.systemPrompt?.enabled ?? true;
    if (!systemPromptEnabled) {
      disabled.push('system prompt injection');
    }
    if (!gatesConfig.enableFrameworkGates) {
      disabled.push('framework gates');
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
          transport: this.transportRouter?.getTransportType() || 'unknown',
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
