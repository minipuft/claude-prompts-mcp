// @lifecycle canonical - Registers MCP tool implementations exposed to Model Context Protocol clients.
/**
 * MCP Tools Module - Consolidated Architecture
 *
 * This module provides 3 core MCP tools with framework-aware descriptions:
 *
 * CORE TOOLS:
 * - prompt_engine: Universal execution engine with framework integration
 * - system_control: Framework and system management with analytics
 * - resource_manager: Unified CRUD for prompts, gates, and frameworks
 *
 * ARCHITECTURE:
 * - Framework-aware tool descriptions that change based on active framework
 * - Single source of truth for each functional area
 * - Integrated ToolDescriptionLoader for dynamic descriptions
 * - Improved maintainability and clear separation of concerns
 */

import { McpServer } from '@modelcontextprotocol/server';

import { FrameworkToolHandler, createFrameworkToolHandler } from './framework-manager/index.js';
import { GateToolHandler, createGateToolHandler } from './gate-manager/index.js';
import { PromptExecutor, createPromptExecutor } from './prompt-engine/index.js';
import { ResourceManagerRouter, createResourceManagerRouter } from './resource-manager/index.js';
import {
  PromptResourceHandler,
  createPromptResourceHandler,
} from './resource-manager/prompt/index.js';
// Hand-written Zod schemas — SSOT for parameter validation (replaced codegen)
import {
  buildPromptEngineSchema,
  buildSystemControlSchema,
  resourceManagerInputSchema,
  type DescriptionResolver,
  type PromptEngineInput,
  type SystemControlInput,
  type ToolSurfaceState,
  type ResourceManagerInput as ResourceManagerSchemaInput,
} from './schemas/index.js';
import {
  ConsolidatedSystemControl,
  createConsolidatedSystemControl,
} from './system-control/index.js';
import { ToolDescriptionLoader } from './tool-description-loader.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { GateManager } from '#engine/gates/gate-manager.js';
import type { ChainSessionStore } from '#modules/chains/manager.js';
import type { Category, PromptData } from '#modules/prompts/types.js';
import type { GateSpecification } from '#shared/types/execution.js';
import type {
  StateStoreOptions,
  ConfigManager,
  MetricsCollector,
  Logger,
  HookRegistryPort,
  McpNotificationEmitterPort,
} from '#shared/types/index.js';
import type { FrameworkManagerDependencies } from './framework-manager/core/types.js';
import type { ResourceManagerInput } from './resource-manager/core/types.js';
import type { Implementation } from '@modelcontextprotocol/server';

import { FrameworkManager, createFrameworkManager } from '#engine/frameworks/framework-manager.js';
import { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import {
  isValidGateVerdict,
  GATE_VERDICT_VALIDATION_MESSAGE,
} from '#engine/gates/core/gate-verdict-contract.js';
import {
  isGateVerdictSubmission,
  renderGateVerdict,
} from '#engine/gates/core/gate-verdict-renderer.js';
import { GateStateStore, createGateStateStore } from '#engine/gates/gate-state-store.js';
import { PromptAssetManager } from '#modules/prompts/index.js';
// Gate evaluator removed - now using Framework validation
import { createContentAnalyzer } from '#modules/semantic/content-analyzer.js';
import { TextReferenceStore } from '#modules/text-refs/index.js';
// Schemas now hand-written in ./schemas/ (replaced generated mcp-schemas.ts)

// REMOVED: ExecutionCoordinator and ChainOrchestrator - modular chain system removed

// Consolidated tools
// Gate system management integration

/**
 * Read the client identity captured during the `initialize` handshake.
 *
 * Protocol revision 2026-07-28 removes that handshake — client identity moves to
 * per-request `_meta` (`io.modelcontextprotocol/clientInfo`). This function is the
 * single seam that migration has to replace, so it is typed rather than cast: the
 * compiler must be able to see it break.
 */
function readClientVersion(mcpServer: McpServer): Implementation | undefined {
  return mcpServer.server?.getClientVersion();
}

/** Envelope key carrying client identity under protocol revision 2026-07-28. */
const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';

/**
 * Read client identity from the per-request `_meta` envelope.
 *
 * The SDK lifts the reserved `io.modelcontextprotocol/*` keys onto
 * `ctx.mcpReq.envelope`, but types that envelope as an empty shape, so the key
 * is read by name and narrowed here rather than by the compiler.
 */
export function readEnvelopeClientInfo(extra: unknown): Implementation | undefined {
  if (extra == null || typeof extra !== 'object') {
    return undefined;
  }
  const mcpReq = (extra as { mcpReq?: unknown }).mcpReq;
  if (mcpReq == null || typeof mcpReq !== 'object') {
    return undefined;
  }
  const envelope = (mcpReq as { envelope?: unknown }).envelope;
  if (envelope == null || typeof envelope !== 'object') {
    return undefined;
  }
  const info = (envelope as Record<string, unknown>)[CLIENT_INFO_META_KEY];
  if (info == null || typeof info !== 'object') {
    return undefined;
  }
  const { name, version } = info as { name?: unknown; version?: unknown };
  if (typeof name !== 'string') {
    return undefined;
  }
  return {
    name,
    ...(typeof version === 'string' ? { version } : {}),
  } as Implementation;
}

/**
 * MCP Tool Router
 *
 * Manages 3 intelligent consolidated tools: prompt_engine, system_control, resource_manager
 */
export class McpToolRouter {
  private logger: Logger;
  private mcpServer: McpServer;
  private promptManager: PromptAssetManager;
  private configManager: ConfigManager;

  // Consolidated tools (5 core tools)
  private promptExecutor!: PromptExecutor;
  private promptResourceHandler!: PromptResourceHandler;
  private systemControl!: ConsolidatedSystemControl;
  private gateManagerTool!: GateToolHandler;
  private frameworkManagerTool!: FrameworkToolHandler;
  private resourceManagerRouter?: ResourceManagerRouter;
  // Core tools: prompt engine, prompt resources, system control, gate manager, framework manager, resource manager

  // Shared components
  private semanticAnalyzer!: ReturnType<typeof createContentAnalyzer>;
  private frameworkStateStore?: FrameworkStateStore;
  private frameworkManager?: FrameworkManager;
  // ChainSessionStore is owned by PromptExecutor, accessed via getter
  // REMOVED: chainOrchestrator - modular chain system removed
  private textReferenceStore: TextReferenceStore;
  private toolDescriptionLoader?: ToolDescriptionLoader;
  private gateStateStore?: GateStateStore;
  private gateManager: GateManager;
  private analyticsService!: MetricsCollector;
  // Removed executionCoordinator - chains now use LLM-driven execution model

  // Callback references
  private onRestart?: (reason: string) => Promise<void>;
  private toolsChangedNotifier?: () => Promise<void>;
  /**
   * Handle to the registered `prompt_engine`, kept only for the STDIO reshape.
   *
   * On the HTTP path this is overwritten by every per-request registration and
   * is never the one a later reshape would want — which is harmless, because
   * that path rebuilds from state per request and never calls `update()`.
   */
  private promptEngineTool?: ReturnType<McpServer['registerTool']>;
  /**
   * The workspace this serving unit was built for, or undefined for the
   * process default. Gate state is workspace-scoped, so the surface has to be
   * read for the same workspace whose toggle would change it.
   */
  private servingUnitScope?: StateStoreOptions;

  // Pending analytics queue for initialization race condition
  private pendingAnalytics: any[] = [];
  private toolsInitialized = false;

  constructor(
    logger: Logger,
    mcpServer: McpServer,
    promptManager: PromptAssetManager,
    configManager: ConfigManager,
    textReferenceStore: TextReferenceStore,
    gateManager: GateManager
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.promptManager = promptManager;
    this.configManager = configManager;
    this.textReferenceStore = textReferenceStore;
    this.gateManager = gateManager;
  }

  /**
   * Initialize the MCP tools with async configuration
   */
  async initialize(
    onRefresh: () => Promise<void>,
    onRestart: (reason: string) => Promise<void>,
    metricsCollector: MetricsCollector
  ): Promise<void> {
    // Store callback references
    this.onRestart = onRestart;

    this.semanticAnalyzer = createContentAnalyzer(this.logger);
    this.analyticsService = metricsCollector;

    // Initialize gate system manager for runtime gate control
    this.gateStateStore = createGateStateStore(this.logger, this.configManager.getServerRoot());
    await this.gateStateStore.initialize();

    this.logger.info('Content analyzer initialized');

    // Initialize consolidated tools
    // Note: ChainSessionStore is created inside PromptExecutor and exposed via getter
    this.promptExecutor = createPromptExecutor(
      this.logger,
      this.promptManager,
      this.configManager,
      this.semanticAnalyzer,
      this.textReferenceStore,
      this.gateManager,
      this // Pass manager reference for analytics data flow
      // Removed executionCoordinator - chains now use LLM-driven execution
    );

    // Set gate system manager in prompt engine
    this.promptExecutor.setGateStateStore(this.gateStateStore);

    this.promptResourceHandler = createPromptResourceHandler(
      this.logger,
      this.configManager,
      this.semanticAnalyzer,
      this.frameworkStateStore,
      this.frameworkManager,
      onRefresh,
      onRestart
    );

    // Initialize 5 core consolidated tools

    this.systemControl = createConsolidatedSystemControl(this.logger, onRestart);

    // Set managers in system control
    this.systemControl.setGateStateStore(this.gateStateStore);
    // ChainSessionStore is owned by promptExecutor (definite at this point)
    this.systemControl.setChainSessionStore(this.promptExecutor.getChainSessionStore());
    this.systemControl.setGateGuidanceRenderer(this.promptExecutor.getGateGuidanceRenderer());

    // Initialize gate manager tool
    this.gateManagerTool = createGateToolHandler({
      logger: this.logger,
      gateManager: this.gateManager,
      configManager: this.configManager,
      onRefresh,
    });

    // Initialize framework manager tool (framework manager set later via setFrameworkManager)
    // Note: frameworkManager is not yet available at this point, will be set in setFrameworkManager

    // chainScaffolder removed - functionality consolidated into promptEngine

    // Flush any pending analytics data that was queued during initialization
    this.toolsInitialized = true;
    this.flushPendingAnalytics();

    this.logger.info(
      'McpToolRouter initialized with 5 intelligent tools (chain management in prompt_engine)'
    );
  }

  /**
   * Set framework state manager (called after initialization)
   */
  setFrameworkStateStore(frameworkStateStore: FrameworkStateStore): void {
    this.frameworkStateStore = frameworkStateStore;
    this.promptExecutor.setFrameworkStateStore(frameworkStateStore);
    this.systemControl.setFrameworkStateStore(frameworkStateStore);
    this.promptResourceHandler.setFrameworkStateStore(frameworkStateStore);
    // FIXED: Synchronize Framework Manager with Framework State Manager to prevent injection duplication
    if (this.frameworkManager != null) {
      this.frameworkManager.setFrameworkStateStore(frameworkStateStore);
    }
    // Set on framework manager tool if already initialized
    if (this.frameworkManagerTool != null) {
      this.frameworkManagerTool.setFrameworkStateStore(frameworkStateStore);
    }
    // Core tools handle framework state integration
  }

  /**
   * Set tool description manager (called after initialization)
   */
  setToolDescriptionLoader(manager: ToolDescriptionLoader): void {
    this.toolDescriptionLoader = manager;

    this.promptExecutor.setToolDescriptionLoader(manager);
    this.promptExecutor.setAnalyticsService(this.analyticsService);
    // prompt resource service and system_control do not consume tool descriptions
    this.systemControl.setAnalyticsService(this.analyticsService);
    // Core tools integrated with framework-aware descriptions

    // Set up hot-reload event listeners
    this.setupToolDescriptionHotReload(manager);

    this.logger.info('Tool description manager set for all MCP tools with hot-reload support');
  }

  /**
   * Set database port for persistence (cascades to all sub-handlers that need DB access).
   */
  setDatabasePort(
    db: import('#shared/types/persistence.js').DatabasePort,
    argHistoryStore?: import('#shared/types/persistence.js').StateStore<
      import('#modules/text-refs/types.js').PersistedArgumentHistory
    >,
    // Version history is scoped from here rather than inside each handler: all three handlers
    // share one VersionHistoryService shape, and the launch workspace is known only at the
    // composition root that calls this.
    scope?: import('#shared/types/persistence.js').StateStoreOptions
  ): void {
    this.promptExecutor.setDatabasePort(db, argHistoryStore);
    this.promptResourceHandler.setDatabasePort(db, scope);
    this.gateManagerTool.setDatabasePort(db, scope);
    if (this.frameworkManagerTool) {
      this.frameworkManagerTool.setDatabasePort(db, scope);
    }

    // Wired here, not alongside the other systemControl setters above: the executor
    // creates its ExecutionRecordStore inside setDatabasePort, so reading it any earlier
    // returns null and the execution_history action silently reports "not wired".
    const executionRecordStore = this.promptExecutor.getExecutionRecordStore();
    if (executionRecordStore !== null) {
      this.systemControl.setExecutionRecordStore(executionRecordStore);
    }
  }

  /**
   * Set hook registry for pipeline event emissions
   */
  setHookRegistry(hookRegistry: HookRegistryPort): void {
    this.promptExecutor.setHookRegistry(hookRegistry);
  }

  /**
   * Set notification emitter for MCP client notifications
   */
  setNotificationEmitter(emitter: McpNotificationEmitterPort): void {
    this.promptExecutor.setNotificationEmitter(emitter);
  }

  /**
   * Publish `tools/list` changes through the transport that is actually serving.
   *
   * Under protocol revision 2026-07-28 an unsolicited push is replaced by
   * `subscriptions/listen`, and the publish side differs per transport: HTTP
   * uses the handler's notifier, STDIO the instance `serveStdio` pinned. Only
   * the runtime knows which is live, so it supplies the routing.
   */
  setToolsChangedNotifier(notifier: () => Promise<void>): void {
    this.toolsChangedNotifier = notifier;
  }

  /**
   * Adopt the instance `serveStdio` pinned for this connection.
   *
   * The server handed to the constructor is built before any transport exists
   * and, on the STDIO path, is never the one that ends up connected — the
   * factory builds a fresh instance and `serveStdio` pins that. Reads that must
   * reflect the live connection, such as the 2025-era client handshake behind
   * {@link getDetectedClientInfo}, would otherwise consult a dead object.
   */
  setPinnedServer(server: McpServer): void {
    this.mcpServer = server;
  }

  /**
   * Read the runtime state the `prompt_engine` parameter shape depends on.
   *
   * `isGateSystemEnabled()` is the master switch: with it off, `GateService`
   * short-circuits guidance and validation for every gate id whatever rank
   * contributed it, so the three gate parameters cannot affect an execution.
   *
   * The adjacent `gatesConfig.enableFrameworkGates` switch is deliberately not
   * consulted. It vetoes only the `framework-guide` rank — gates the server
   * loads from the active framework — and leaves client-supplied gates fully
   * functional, so reading it here would withdraw a parameter that still works.
   *
   * Read from the state store rather than `GateManager.isGateSystemEnabled()`,
   * which is the same source `GateService` consults. `GateManager` has a
   * `setStateManager()` seam that nothing calls, so its check falls through to
   * its "no state manager, assume enabled" default and reports `true` however
   * the switch is set — a surface built on it would never narrow.
   *
   * Read for {@link servingUnitScope}, the workspace this instance serves.
   * Reading unscoped would resolve to the process default while a client's
   * toggle wrote to its own workspace row, so the surface would never narrow
   * for that client — and a toggle of the default row would reshape everyone's.
   *
   * Absent store means enabled, matching the store-less default everywhere else.
   */
  private readToolSurfaceState(): ToolSurfaceState {
    return {
      gateSystemEnabled: this.gateStateStore?.isGateSystemEnabled(this.servingUnitScope) ?? true,
    };
  }

  /**
   * Build the `prompt_engine` input schema from current runtime state.
   *
   * Shared by registration and by the STDIO reshape, so both read the same
   * state through the same path. Framework state is read here rather than
   * captured by the caller because the reshape happens *after* a framework
   * switch, when the values the caller once held are stale.
   */
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  private buildPromptEngineSurface() {
    const frameworkEnabled = this.frameworkStateStore?.isFrameworkSystemEnabled() ?? false;
    const activeFramework = this.frameworkStateStore?.getActiveFramework();
    const activeFrameworkType = activeFramework?.type ?? activeFramework?.id;

    const describe: DescriptionResolver = (paramName, fallback) =>
      this.toolDescriptionLoader?.getParameterDescription(
        'prompt_engine',
        paramName,
        frameworkEnabled,
        activeFrameworkType,
        { applyFrameworkOverride: true }
      ) ?? fallback;

    return buildPromptEngineSchema(isValidGateVerdict, GATE_VERDICT_VALIDATION_MESSAGE, {
      describe,
      state: this.readToolSurfaceState(),
    });
  }

  /**
   * Read client info for the request being handled.
   *
   * Two eras, in priority order. Revision 2026-07-28 removed the `initialize`
   * handshake and moved identity into a per-request `_meta` envelope, so that
   * is read first. A 2025-era STDIO client has no envelope, and for it the
   * handshake value captured on the connected instance still applies.
   *
   * The envelope is not merely the newer source — it is the only correct one
   * over HTTP. Each request there is served by its own `McpServer`, so
   * `this.mcpServer` is the STDIO instance and holds no handshake for it.
   */
  private getDetectedClientInfo(extra: unknown): { name: string; version?: string } | undefined {
    try {
      const impl = readEnvelopeClientInfo(extra) ?? readClientVersion(this.mcpServer);
      // `name` is typed as a required string, but it arrives off the wire — an
      // empty one is still possible and is treated as "no client detected".
      const name = impl?.name.trim();
      if (name == null || name.length === 0) {
        return undefined;
      }
      return { name, version: impl?.version };
    } catch {
      return undefined;
    }
  }

  /**
   * Enrich the MCP SDK extra with a normalized `clientInfo`.
   *
   * The SDK surfaces client identity on `mcpReq.envelope` under a reserved
   * namespaced key rather than as `clientInfo`, so downstream consumers get a
   * flat, era-independent shape injected here.
   */
  private enrichExtraWithClientInfo(extra: unknown): unknown {
    const detected = this.getDetectedClientInfo(extra);
    if (detected == null) {
      return extra;
    }

    const base = extra != null && typeof extra === 'object' ? extra : {};
    // Don't overwrite if clientInfo already present (e.g. from a future SDK version)
    if ('clientInfo' in base && (base as Record<string, unknown>)['clientInfo'] != null) {
      return extra;
    }

    return { ...base, clientInfo: detected };
  }

  /**
   * Setup hot-reload event listeners for tool descriptions
   */
  private setupToolDescriptionHotReload(manager: ToolDescriptionLoader): void {
    // Listen for description changes
    manager.on('descriptions-changed', (stats) => {
      this.logger.info(
        `🔥 Tool descriptions hot-reloaded: ${stats.totalDescriptions} descriptions loaded`
      );
      this.handleToolDescriptionChange(stats);
    });

    // Listen for reload errors
    manager.on('descriptions-error', (error) => {
      this.logger.error(
        `❌ Tool description reload failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  /**
   * Handle tool description changes
   */
  private async handleToolDescriptionChange(stats: any): Promise<void> {
    try {
      this.logger.info('🔄 Processing tool description changes...');

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
      this.logger.info('✅ Tool descriptions reloaded');
      this.logger.info(
        `📊 Stats: ${stats.totalDescriptions} total, using ${
          stats.usingDefaults > 0 ? 'defaults' : 'external config'
        }`
      );

      // Check if restart is configured for tool description changes
      const restartOnChange =
        this.configManager.getConfig().toolDescriptions?.restartOnChange ?? false;

      if (restartOnChange) {
        this.logger.info(
          '🚨 Restart on tool description change is enabled - initiating server restart...'
        );
        // Use the existing restart mechanism
        await this.onRestart?.(
          'Tool descriptions updated - restart required for clients to see new descriptions'
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
  async setFrameworkManager(existingFrameworkManager?: FrameworkManager): Promise<void> {
    if (this.frameworkManager == null) {
      // Use provided framework manager or create a new one
      this.frameworkManager =
        existingFrameworkManager ??
        (await createFrameworkManager(this.logger, {
          defaultFramework: this.configManager.getFrameworksConfig().defaultFramework,
        }));

      // FIX: Connect frameworkStateStore if it was set before frameworkManager was created
      // This handles the startup order where setFrameworkStateStore() is called first
      if (this.frameworkStateStore != null) {
        this.frameworkManager.setFrameworkStateStore(this.frameworkStateStore);
      }

      this.promptExecutor.setFrameworkManager(this.frameworkManager);
      this.systemControl.setFrameworkManager(this.frameworkManager);
      this.promptResourceHandler.setFrameworkManager(this.frameworkManager);

      // Initialize framework manager tool now that frameworkManager is available
      const frameworkManagerDeps: FrameworkManagerDependencies = {
        logger: this.logger,
        frameworkManager: this.frameworkManager,
        configManager: this.configManager,
        onRefresh: async () => {
          // Trigger reload via the onRestart mechanism (full refresh)
          this.logger.debug('Framework manager triggered refresh');
        },
        onToolsUpdate: async () => {
          // Re-register tools with updated descriptions
          await this.reregisterToolsWithUpdatedDescriptions();
        },
      };

      if (this.frameworkStateStore != null) {
        frameworkManagerDeps.frameworkStateStore = this.frameworkStateStore;
      }

      this.frameworkManagerTool = createFrameworkToolHandler(frameworkManagerDeps);

      // Initialize unified resource manager router (routes to prompt/gate/framework managers)
      this.resourceManagerRouter = createResourceManagerRouter({
        logger: this.logger,
        promptResourceHandler: this.promptResourceHandler,
        gateManager: this.gateManagerTool,
        frameworkManager: this.frameworkManagerTool,
      });
      this.logger.debug('ResourceManagerRouter initialized for unified resource management');

      // Core tools integrated with framework management

      // Set ConfigManager for system control config operations
      this.systemControl.setConfigManager(this.configManager);

      // Set MCPToolsManager reference for dynamic tool updates
      this.systemControl.setMCPToolsManager(this);
      // Toggling the gate system changes which parameters `prompt_engine`
      // advertises, so it refreshes the surface exactly as a framework switch does.
      this.systemControl.setToolSurfaceChangedHandler(async () => {
        await this.reregisterToolsWithUpdatedDescriptions();
      });

      // Enhanced tool delegation removed (.2)
      // Using core tools directly without delegation patterns

      // REMOVED: ChainOrchestrator initialization - modular chain system removed

      if (existingFrameworkManager != null) {
        this.logger.info('Framework manager integrated with MCP tools (shared instance)');
      } else {
        this.logger.info('Framework manager initialized and integrated with MCP tools');
      }
    }
  }

  /**
   * Expose the framework manager for runtime integrations (e.g., framework hot reload).
   */
  getFrameworkManager(): FrameworkManager | undefined {
    return this.frameworkManager;
  }

  /**
   * Get chain session manager for MCP resource access.
   * Delegates to PromptExecutor which owns the canonical instance.
   */
  getChainSessionStore(): ChainSessionStore | undefined {
    return this.promptExecutor.getChainSessionStore() as ChainSessionStore | undefined;
  }

  /**
   * Get metrics collector for MCP resource access.
   */
  getMetricsCollector(): MetricsCollector {
    return this.analyticsService;
  }

  /**
   * Get resource manager handler for auto-execute functionality.
   * Returns a function that can execute resource_manager actions internally.
   */
  getResourceManagerHandler():
    | ((
        args: Record<string, unknown>,
        context: Record<string, unknown>
      ) => Promise<import('#shared/types/index.js').ToolResponse>)
    | null {
    const router = this.resourceManagerRouter;
    if (router == null) {
      return null;
    }
    return (args, context) => router.handleAction(args as any, context);
  }

  // REMOVED: wireExecutionCoordinator - ExecutionCoordinator removed

  /**
   * Register all consolidated MCP tools with the server (centralized registration)
   */
  /**
   * Bind the three consolidated tools onto `target`.
   *
   * The server is a parameter rather than `this.mcpServer` because protocol
   * revision 2026-07-28 serves each HTTP request from a freshly constructed
   * `McpServer` (`McpServerFactory`), while the STDIO path keeps one instance
   * for the life of the connection. The handlers close over this router's
   * singletons either way, so only the registration target varies.
   */
  async registerAllTools(target: McpServer, scope?: StateStoreOptions): Promise<void> {
    // Held for the STDIO reshape, which happens long after this returns and has
    // no context of its own. STDIO serves one workspace per process, so the
    // value it records is the default scope — which is the correct one there.
    this.servingUnitScope = scope;
    this.logger.info('Registering consolidated MCP tools with server (centralized)...');

    // Get current framework state for dynamic descriptions
    const frameworkEnabled = this.frameworkStateStore?.isFrameworkSystemEnabled() ?? false;
    const activeFramework = this.frameworkStateStore?.getActiveFramework();
    const activeFrameworkType = activeFramework?.type ?? activeFramework?.id;

    this.logger.info(`🔧 Registering tools with framework-aware descriptions:`);
    this.logger.info(`   Framework enabled: ${frameworkEnabled}`);
    this.logger.info(`   Active framework: ${activeFramework?.id ?? 'none'}`);
    this.logger.info(`   Active framework: ${activeFrameworkType ?? 'none'}`);
    this.logger.info(
      `   Tool description manager: ${
        this.toolDescriptionLoader != null ? 'available' : 'not available'
      }`
    );

    // Register prompt_engine tool
    try {
      // Get dynamic description based on current framework state
      // Description loaded from tool-descriptions.contracts.json via ToolDescriptionLoader
      const promptEngineDescription =
        this.toolDescriptionLoader?.getDescription(
          'prompt_engine',
          frameworkEnabled,
          activeFrameworkType,
          { applyFrameworkOverride: true }
        ) ?? '';

      // Log which description source is being used for transparency
      if (this.toolDescriptionLoader != null) {
        this.logger.info(
          `   prompt_engine: Using ToolDescriptionLoader (framework: ${frameworkEnabled}, framework: ${activeFrameworkType})`
        );
      } else {
        this.logger.info(
          `   prompt_engine: Using fallback description (ToolDescriptionLoader not available)`
        );
      }

      const promptEngineSchema = this.buildPromptEngineSurface();

      this.promptEngineTool = target.registerTool(
        'prompt_engine',
        {
          title: 'Prompt Engine',
          description: promptEngineDescription,
          inputSchema: promptEngineSchema,
        },
        async (args: PromptEngineInput, extra: unknown) => {
          try {
            // Normalize and validate string inputs (trim whitespace, filter empty values)
            const trimmedCommand = args.command?.trim();
            const trimmedChainId = args.chain_id?.trim();
            const trimmedUserResponse = args.user_response?.trim();
            // A structured submission is rendered to the canonical form here,
            // at the boundary, so the pipeline keeps receiving a `string`.
            // Widening `gate_verdict` downstream would touch execution-context,
            // validation/schemas, and request-validator for no gain — each
            // already consumes a verdict that has been parsed.
            const trimmedGateVerdict = isGateVerdictSubmission(args.gate_verdict)
              ? renderGateVerdict(args.gate_verdict)
              : args.gate_verdict?.trim();
            const trimmedGateAction = args.gate_action?.trim();

            const extraPayload = trimmedUserResponse
              ? { previous_step_output: trimmedUserResponse }
              : undefined;
            const requestExtras = extraPayload != null ? { extra: extraPayload } : {};

            // Build normalized args, only including non-empty values
            const normalizedArgs: Parameters<PromptExecutor['executePromptCommand']>[0] = {
              ...(trimmedCommand ? { command: trimmedCommand } : {}),
              ...(trimmedChainId ? { chain_id: trimmedChainId } : {}),
              ...(trimmedUserResponse ? { user_response: trimmedUserResponse } : {}),
              ...(trimmedGateVerdict ? { gate_verdict: trimmedGateVerdict } : {}),
              ...(trimmedGateAction
                ? { gate_action: trimmedGateAction as 'retry' | 'skip' | 'abort' }
                : {}),
              ...(args.force_restart !== undefined ? { force_restart: args.force_restart } : {}),
              ...(args.options != null ? { options: args.options } : {}),
              ...(args.observations != null ? { observations: args.observations } : {}),
            };

            if (args.gates != null) {
              const normalizedGates = args.gates
                .map((gate): GateSpecification | null => {
                  if (typeof gate === 'string') {
                    return gate;
                  }

                  // Check for CustomCheck type ({name, description} - simple inline gate)
                  if ('name' in gate && 'description' in gate) {
                    // Validate non-empty name and description
                    const trimmedName = gate.name?.trim();
                    const trimmedDescription = gate.description?.trim();
                    if (trimmedName && trimmedDescription) {
                      return {
                        name: trimmedName,
                        description: trimmedDescription,
                      };
                    }
                    return null;
                  }

                  const normalized: Record<string, unknown> = {};
                  if (gate['id'] !== undefined) {
                    normalized['id'] = gate['id'];
                  }
                  if (gate['name'] !== undefined) {
                    normalized['name'] = gate['name'];
                  }
                  if (gate['description'] !== undefined) {
                    normalized['description'] = gate['description'];
                  }
                  if (gate['criteria'] !== undefined) {
                    normalized['criteria'] = gate['criteria'];
                  }
                  if (gate['pass_criteria'] !== undefined) {
                    normalized['pass_criteria'] = gate['pass_criteria'];
                  }
                  if (gate['severity'] !== undefined) {
                    normalized['severity'] = gate['severity'];
                  }
                  if (gate['type'] !== undefined) {
                    normalized['type'] = gate['type'];
                  }
                  if (gate['scope'] !== undefined) {
                    normalized['scope'] = gate['scope'];
                  }
                  if (gate['context'] !== undefined) {
                    normalized['context'] = gate['context'];
                  }
                  if (gate['guidance'] !== undefined) {
                    normalized['guidance'] = gate['guidance'];
                  }
                  if (gate['source'] !== undefined) {
                    normalized['source'] = gate['source'];
                  }
                  if (gate['target_step_number'] !== undefined) {
                    normalized['target_step_number'] = gate['target_step_number'];
                  }
                  if (gate['target_step_id'] !== undefined) {
                    normalized['target_step_id'] = gate['target_step_id'];
                  }
                  if (gate['apply_to_steps'] !== undefined) {
                    normalized['apply_to_steps'] = gate['apply_to_steps'];
                  }

                  return normalized;
                })
                .filter((entry): entry is GateSpecification => entry !== null);
              normalizedArgs.gates = normalizedGates;
            }

            const toolResponse = await this.promptExecutor.executePromptCommand(normalizedArgs, {
              ...requestExtras,
              _sdkExtra: this.enrichExtraWithClientInfo(extra),
            });

            return {
              content: toolResponse.content,
              isError: toolResponse.isError,
            };
          } catch (error) {
            this.logger.error(
              `prompt_engine error: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      );
      this.logger.debug('✅ prompt_engine tool registered successfully');
    } catch (error) {
      this.logger.error(
        `❌ Failed to register prompt_engine tool: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }

    // Register system_control tool
    try {
      // Description loaded from tool-descriptions.contracts.json via ToolDescriptionLoader
      const systemControlDescription =
        this.toolDescriptionLoader?.getDescription(
          'system_control',
          frameworkEnabled,
          activeFrameworkType,
          { applyFrameworkOverride: true }
        ) ?? '';

      // Log which description source is being used for transparency
      if (this.toolDescriptionLoader != null) {
        this.logger.info(
          `   system_control: Using ToolDescriptionLoader (framework: ${frameworkEnabled}, framework: ${activeFrameworkType})`
        );
      } else {
        this.logger.info(
          `   system_control: Using fallback description (ToolDescriptionLoader not available)`
        );
      }

      const getSystemControlParamDescription = (paramName: string, fallback: string) =>
        this.toolDescriptionLoader?.getParameterDescription(
          'system_control',
          paramName,
          frameworkEnabled,
          activeFrameworkType,
          { applyFrameworkOverride: true }
        ) ?? fallback;

      // Build schema with framework-aware parameter descriptions
      const systemControlSchema = buildSystemControlSchema(getSystemControlParamDescription);

      target.registerTool(
        'system_control',
        {
          title: 'System Control',
          description: systemControlDescription,
          inputSchema: systemControlSchema,
        },
        async (args: SystemControlInput, extra: unknown) => {
          try {
            const toolResponse = await this.systemControl.handleAction(
              args,
              this.enrichExtraWithClientInfo(extra)
            );
            return {
              content: toolResponse.content,
              isError: toolResponse.isError,
              ...(toolResponse.structuredContent != null
                ? { structuredContent: toolResponse.structuredContent }
                : {}),
            };
          } catch (error) {
            this.logger.error(
              `system_control error: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      );
      this.logger.debug('✅ system_control tool registered successfully');
    } catch (error) {
      this.logger.error(
        `❌ Failed to register system_control tool: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }

    // Register resource_manager tool (unified router for prompts, gates, frameworks)
    try {
      // Description loaded from tool-descriptions.contracts.json via ToolDescriptionLoader
      const resourceManagerDescription =
        this.toolDescriptionLoader?.getDescription(
          'resource_manager',
          frameworkEnabled,
          activeFrameworkType,
          { applyFrameworkOverride: true }
        ) ?? '';

      target.registerTool(
        'resource_manager',
        {
          title: 'Resource Manager',
          description: resourceManagerDescription,
          // Hand-written schema — includes .passthrough() for advanced framework fields
          inputSchema: resourceManagerInputSchema,
        },
        async (args: ResourceManagerSchemaInput, extra: unknown) => {
          try {
            const router = this.resourceManagerRouter;
            if (router == null) {
              return {
                content: [{ type: 'text', text: 'Error: resource_manager not initialized' }],
                isError: true,
              };
            }
            // Cast to ResourceManagerInput - the generated schema uses .passthrough() so advanced
            // framework fields flow through, but router expects the more specific local type
            const toolResponse = await router.handleAction(
              args as ResourceManagerInput,
              (this.enrichExtraWithClientInfo(extra) ?? {}) as Record<string, unknown>
            );
            return {
              content: toolResponse.content,
              isError: toolResponse.isError,
            };
          } catch (error) {
            this.logger.error(
              `resource_manager error: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      );
      this.logger.debug('✅ resource_manager tool registered successfully');
    } catch (error) {
      this.logger.error(
        `❌ Failed to register resource_manager tool: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }

    this.logger.info('🎉 MCP tools registered successfully!');
    this.logger.info('📊 Core Tools: 3 registered MCP tools');
    this.logger.info('🚀 Active Tools: prompt_engine, system_control, resource_manager');

    // Log available tools for user reference
    const toolSummary = [
      'Available MCP Tools:',
      '🎯 prompt_engine - Execute prompts with frameworks and gates',
      '⚙️ system_control - System administration and status',
      '📦 resource_manager - Unified CRUD for prompts, gates, and frameworks',
    ].join('\n   ');

    this.logger.info(toolSummary);
  }

  /**
   * Refresh the advertised tool surface after a state change.
   *
   * The real constraint is instance lifetime, not SDK capability. An earlier
   * comment here claimed the SDK cannot re-register a registered tool;
   * `RegisteredTool.update({ paramsSchema })` has always existed, and the
   * parameter *shape* is mutable through it, not only description text.
   *
   * What actually differs is how long a server instance lives:
   *
   * - HTTP builds a fresh instance per request from the factory, so it already
   *   reflects current state by the time this runs. Mutating here would touch
   *   an instance belonging to a finished request — which is why the schema is
   *   a pure function of state rather than an accumulation of mutations.
   * - STDIO keeps one instance for the connection, so it is the only path with
   *   anything to reshape, and `update()` is how that happens.
   *
   * Either way the notification is what tells opted-in subscribers to re-list.
   */
  async reregisterToolsWithUpdatedDescriptions(): Promise<void> {
    this.logger.info('🔄 Refreshing tool surface after state change...');

    try {
      // Sync tool description manager with new framework state
      // The descriptions are fetched dynamically when clients request tool info
      if (this.toolDescriptionLoader != null) {
        await this.toolDescriptionLoader.reload();
        this.logger.info('✅ Tool description manager synchronized');
      }

      // Reshape the long-lived STDIO instance. Rebuilt from current state, so
      // it picks up both the new descriptions and any change to which
      // parameters are reachable.
      if (this.promptEngineTool != null) {
        this.promptEngineTool.update({ paramsSchema: this.buildPromptEngineSurface() });
        this.logger.info('✅ prompt_engine input schema rebuilt for current state');
      }

      // Notify MCP clients that the tool list changed. The routing lives in the
      // runtime, which is the only place that knows whether HTTP or STDIO is
      // serving; this class holds no instance it could correctly push from.
      if (this.toolsChangedNotifier == null) {
        this.logger.warn('⚠️ No tool-list-changed notifier wired; clients will not be told');
      } else {
        await this.toolsChangedNotifier();
        this.logger.info('✅ Sent tool list changed notification to MCP clients');
      }

      this.logger.info('🎉 Tool descriptions updated successfully for framework switch!');
    } catch (error) {
      this.logger.error(
        `Failed to update tool descriptions: ${error instanceof Error ? error.message : String(error)}`
      );
      // Don't throw - framework switch should still succeed even if description update fails
      this.logger.warn(
        'Framework switch completed but tool descriptions may not reflect new framework'
      );
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
    // Update all consolidated tools with new data
    this.promptExecutor.updateData(promptsData, convertedPrompts);
    this.promptResourceHandler.updateData(promptsData, convertedPrompts, categories);
    // Core tools handle data updates directly
  }

  /**
   * Update system analytics (from consolidated tools)
   */
  updateAnalytics(analytics: any): void {
    if (this.toolsInitialized) {
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
    if (this.toolsInitialized && this.pendingAnalytics.length > 0) {
      this.logger.debug(`Flushing ${this.pendingAnalytics.length} pending analytics updates`);
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
    this.logger.info('🛑 Shutting down MCP tools manager...');

    // Shutdown tool description manager and stop file watching
    if (this.toolDescriptionLoader != null) {
      this.toolDescriptionLoader.shutdown();
      this.logger.info('✅ Tool description manager shut down');
    }

    // Cleanup gate system manager
    if (this.gateStateStore != null) {
      this.gateStateStore.cleanup().catch((error) => {
        this.logger.error('Error during gate system manager cleanup:', error);
      });
      this.logger.info('✅ Gate system manager cleanup initiated');
    }

    // Clear pending analytics
    this.pendingAnalytics = [];

    this.logger.info('✅ MCP tools manager shutdown completed');
  }
}

/**
 * Create MCP tool router
 */
export async function createMcpToolRouter(
  logger: Logger,
  mcpServer: McpServer,
  promptManager: PromptAssetManager,
  configManager: ConfigManager,
  textReferenceStore: TextReferenceStore,
  onRefresh: () => Promise<void>,
  onRestart: (reason: string) => Promise<void>,
  gateManager: GateManager,
  metricsCollector: MetricsCollector
): Promise<McpToolRouter> {
  const manager = new McpToolRouter(
    logger,
    mcpServer,
    promptManager,
    configManager,
    textReferenceStore,
    gateManager
  );

  await manager.initialize(onRefresh, onRestart, metricsCollector);
  return manager;
}

// Legacy compatibility - export the consolidated manager as the old name
export { McpToolRouter as McpToolsManager };
export const createMcpToolsManager = createMcpToolRouter;
