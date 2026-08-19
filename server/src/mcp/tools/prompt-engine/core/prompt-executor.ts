// @lifecycle canonical - Executes MCP prompts through the execution pipeline.
/**
 * Pipeline-driven prompt execution service.
 *
 * Wires the canonical PromptExecutionPipeline together with the surrounding
 * services (sessions, gates, framework state) so the MCP tool only needs to
 * pass validated requests into the pipeline.
 *
 * Architecture:
 *   PromptExecutor (this file — orchestration)
 *     └── PipelineBuilder (pipeline-builder.ts — factory)
 *           └── PromptExecutionPipeline (coordinator)
 *                 └── PipelineStage[] (22 stages)
 */

import * as path from 'node:path';

import { ChainSessionRouter } from './chain-session-router.js';
import { PipelineBuilder } from './pipeline-builder.js';
import { ToolDescriptionLoader } from '../../tool-description-loader.js';
import { ResponseFormatter } from '../processors/response-formatter.js';
import { renderPromptEngineGuide } from '../utils/guide.js';

import type { ParsingSystem } from '#engine/execution/parsers/index.js';
import type { PromptExecutionPipeline } from '#engine/execution/pipeline/index.js';
import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { ScriptToolRuntime } from '#engine/gates/core/index.js';
import type { GateManager } from '#engine/gates/gate-manager.js';
import type { PromptData } from '#modules/prompts/types.js';
import type { PersistedArgumentHistory } from '#modules/text-refs/types.js';
import type { WorkflowIR } from '#modules/workflow-ir/types.js';
import type { UnknownObservation } from '#shared/types/chain-session.js';
import type { GateSpecification, McpToolRequest } from '#shared/types/execution.js';
import type { StateStore, StateStoreOptions } from '#shared/types/persistence.js';

import { ChainOperatorExecutor } from '#engine/execution/operators/chain-operator-executor.js';
import { createParsingSystem } from '#engine/execution/parsers/index.js';
import { createSymbolicCommandParser } from '#engine/execution/parsers/symbolic-operator-parser.js';
import { ExecutionPlanner } from '#engine/execution/planning/execution-planner.js';
import {
  PromptReferenceResolver,
  ScriptReferenceResolver,
} from '#engine/execution/reference/index.js';
import { resolveDeclaredSections } from '#engine/frameworks/declared-sections.js';
import { FrameworkManager } from '#engine/frameworks/framework-manager.js';
import { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import { FrameworkValidator } from '#engine/frameworks/framework-validator.js';
import {
  PromptGuidanceService,
  createPromptGuidanceService,
} from '#engine/frameworks/prompt-guidance/index.js';
import { FrameworkExecutionContext } from '#engine/frameworks/types/index.js';
import {
  LightweightGateSystem,
  createGateValidator,
  createTemporaryGateRegistry,
} from '#engine/gates/core/index.js';
import {
  GateGuidanceRenderer,
  createGateGuidanceRenderer,
} from '#engine/gates/guidance/GateGuidanceRenderer.js';
import { GateManagerProvider } from '#engine/gates/registry/gate-provider-adapter.js';
import { GateReferenceResolver } from '#engine/gates/services/gate-reference-resolver.js';
import { WorkspaceScriptLoader } from '#modules/automation/core/index.js';
import { createScriptExecutor } from '#modules/automation/execution/script-executor.js';
import {
  ExecutionRecordStore,
  createExecutionRecordStore,
} from '#modules/chains/execution-record-store.js';
import { createChainSessionStore } from '#modules/chains/manager.js';
import { StyleManager, createStyleManager } from '#modules/formatting/index.js';
import { PromptAssetManager } from '#modules/prompts/index.js';
import { ContentAnalyzer } from '#modules/semantic/content-analyzer.js';
import { TextReferenceStore, ArgumentHistoryTracker } from '#modules/text-refs/index.js';
import {
  type Logger,
  type MetricsCollector,
  type HookRegistryPort,
  type McpNotificationEmitterPort,
  ToolResponse,
  ConfigManager,
  ChainSessionService,
} from '#shared/types/index.js';
import { isChainId } from '#shared/utils/chain-id-codec.js';
import { resolveRequestIdentity } from '#shared/utils/request-identity-resolver.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

export class PromptExecutor {
  public readonly inlineGateParser: ReturnType<typeof createSymbolicCommandParser>;

  private readonly logger: Logger;
  private readonly promptManager: PromptAssetManager;
  private readonly configManager: ConfigManager;
  private readonly responseFormatter: ResponseFormatter;
  private readonly executionPlanner: ExecutionPlanner;
  private readonly parsingSystem: ParsingSystem;
  private readonly chainSessionRouter: ChainSessionRouter;
  private readonly lightweightGateSystem: LightweightGateSystem;
  private readonly gateReferenceResolver: GateReferenceResolver;
  private readonly gateGuidanceRenderer: GateGuidanceRenderer;
  private readonly chainSessionStore: ChainSessionService;
  private readonly argumentHistoryTracker: ArgumentHistoryTracker;

  /** Execution log writer (Tier 5). Created when setDatabasePort wires the DB. */
  private executionRecordStore: ExecutionRecordStore | null = null;

  private frameworkStateStore?: FrameworkStateStore;
  private frameworkManager?: FrameworkManager;
  private promptGuidanceService: PromptGuidanceService | undefined;
  private chainOperatorExecutor?: ChainOperatorExecutor;
  private frameworkValidator: FrameworkValidator | null = null;
  private toolDescriptionLoader?: ToolDescriptionLoader;
  private analyticsService?: MetricsCollector;
  private promptPipeline: PromptExecutionPipeline | undefined;
  private mcpToolsManager?: any;
  /** GateManager for registry-based gate selection in pipeline stages */
  private readonly gateManager: GateManager;
  /** StyleManager for dynamic style guidance (# operator) */
  private styleManager?: StyleManager;
  /** Resolver for {{ref:prompt_id}} references in templates */
  private referenceResolver?: PromptReferenceResolver;
  /** Resolver for {{script:id}} references in templates */
  private scriptReferenceResolver?: ScriptReferenceResolver;
  /**
   * The script-tool registry and executor, shared by the inline `{{script:id}}`
   * resolver and by `script_tool` gate criteria. Rebuilt on every prompt reload
   * (see `updateData`), which is why gates read it through a provider rather
   * than holding the instance.
   */
  private scriptToolRuntime?: ScriptToolRuntime;
  /** Hook registry for pipeline event emissions */
  private hookRegistry?: HookRegistryPort;
  /** Notification emitter for MCP client notifications */
  private notificationEmitter?: McpNotificationEmitterPort;

  /** Launch workspace scope, shared by the chain stores and the argument history store. */
  private readonly workspaceScope: StateStoreOptions | undefined;

  private convertedPrompts: ConvertedPrompt[] = [];
  private readonly serverRoot: string;

  constructor(
    logger: Logger,
    promptManager: PromptAssetManager,
    configManager: ConfigManager,
    semanticAnalyzer: ContentAnalyzer,
    textReferenceStore: TextReferenceStore,
    gateManager: GateManager,
    mcpToolsManager?: any,
    promptGuidanceService?: PromptGuidanceService
  ) {
    this.logger = logger;
    this.promptManager = promptManager;
    this.configManager = configManager;
    this.gateManager = gateManager; // Store for registry-based gate selection
    this.responseFormatter = new ResponseFormatter();
    this.executionPlanner = new ExecutionPlanner(semanticAnalyzer, logger);
    this.parsingSystem = createParsingSystem(logger);
    this.inlineGateParser = createSymbolicCommandParser(logger);
    this.mcpToolsManager = mcpToolsManager;
    this.promptGuidanceService = promptGuidanceService;

    const resolvedServerRoot =
      typeof configManager.getServerRoot === 'function' ? configManager.getServerRoot() : undefined;
    if (!resolvedServerRoot) {
      throw new Error(
        'PromptExecutor requires serverRoot: configManager.getServerRoot() returned undefined'
      );
    }
    this.serverRoot = resolvedServerRoot;

    const sessionConfig = configManager.getChainSessionConfig?.();
    // Read before either store is constructed: `applyRuntimeIdentityOverrides` has already
    // populated this during runtime bootstrap (deriving from cwd when nothing explicit was
    // given), and a value read after construction never reaches the constructed store.
    const launchWorkspaceId = configManager.getConfig().identity?.launchDefaults?.workspaceId;
    const workspaceScope =
      launchWorkspaceId != null ? { workspaceId: launchWorkspaceId } : undefined;

    // Built unconditionally rather than only when `sessionConfig` exists: the scope has to
    // survive the no-session-config branch, which previously collapsed the whole object to
    // undefined and would have dropped it.
    this.workspaceScope = workspaceScope;

    const chainSessionOptions = {
      ...(sessionConfig
        ? {
            defaultSessionTimeoutMs: sessionConfig.sessionTimeoutMinutes * 60 * 1000,
            reviewSessionTimeoutMs: sessionConfig.reviewTimeoutMinutes * 60 * 1000,
            cleanupIntervalMs: sessionConfig.cleanupIntervalMinutes * 60 * 1000,
          }
        : {}),
      ...(workspaceScope !== undefined ? { defaultScope: workspaceScope } : {}),
    };

    this.argumentHistoryTracker = new ArgumentHistoryTracker(logger, 50);
    // Initialize async - will be ready when DatabasePort is set via setDatabasePort
    this.argumentHistoryTracker.initialize().catch((error) => {
      logger.warn('Failed to initialize ArgumentHistoryTracker:', error);
    });

    this.chainSessionStore = createChainSessionStore(
      logger,
      textReferenceStore,
      this.serverRoot,
      chainSessionOptions,
      this.argumentHistoryTracker
    );
    const temporaryGateRegistry = createTemporaryGateRegistry(logger, {
      maxMemoryGates: 100,
      defaultExpirationMs: 30 * 60 * 1000,
    });

    const gateProvider = new GateManagerProvider(gateManager, temporaryGateRegistry);
    const gateValidator = createGateValidator(logger, gateProvider, () => this.scriptToolRuntime);
    this.lightweightGateSystem = new LightweightGateSystem(
      gateProvider,
      gateValidator,
      temporaryGateRegistry
    );
    this.gateReferenceResolver = new GateReferenceResolver(this.lightweightGateSystem.gateLoader);
    this.gateGuidanceRenderer = createGateGuidanceRenderer(logger, {
      gateLoader: this.lightweightGateSystem.gateLoader,
      temporaryGateRegistry:
        this.lightweightGateSystem.getTemporaryGateRegistry?.() ?? temporaryGateRegistry,
      frameworkIdentifierProvider: () => {
        const frameworks = this.frameworkManager?.listFrameworks(false) ?? [];
        const identifiers = new Set<string>();

        for (const framework of frameworks) {
          if (framework?.id) {
            identifiers.add(framework.id.toUpperCase());
          }
          if (framework?.type) {
            identifiers.add(framework.type.toUpperCase());
          }
        }

        return Array.from(identifiers);
      },
    });

    this.chainSessionRouter = new ChainSessionRouter(
      [],
      this.chainSessionStore,
      this.responseFormatter,
      this.lightweightGateSystem
    );
    this.chainOperatorExecutor = this.createChainOperatorExecutor();

    // Inject GateLoader into ExecutionPlanner for dynamic framework gate detection
    this.executionPlanner.setGateLoader(this.lightweightGateSystem.gateLoader);

    // Inject GateManager into ExecutionPlanner for category-based gate selection
    if (this.gateManager) {
      this.executionPlanner.setGateManager(this.gateManager);
    }

    // Initialize StyleManager asynchronously
    void this.initializeStyleManager();

    this.logger.info('[PromptExecutor] Initialized pipeline dependencies');
  }

  updateData(_promptsData: PromptData[], convertedPrompts: ConvertedPrompt[]): void {
    this.convertedPrompts = convertedPrompts;
    this.chainSessionRouter.updatePrompts(convertedPrompts);
    // Create reference resolver with updated prompts
    this.referenceResolver = new PromptReferenceResolver(this.logger, convertedPrompts);
    // Create script reference resolver with workspace loader
    const scriptLoader = new WorkspaceScriptLoader({
      workspaceScriptsPath: path.join(this.serverRoot, 'resources', 'scripts'),
    });
    const scriptExecutor = createScriptExecutor({ debug: false });
    this.scriptReferenceResolver = new ScriptReferenceResolver(
      this.logger,
      scriptLoader,
      scriptExecutor
    );
    this.scriptToolRuntime = { loader: scriptLoader, executor: scriptExecutor };
    this.chainOperatorExecutor = this.createChainOperatorExecutor();
    this.resetPipeline();
  }

  setFrameworkStateStore(frameworkStateStore: FrameworkStateStore): void {
    this.frameworkStateStore = frameworkStateStore;
  }

  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
    this.rebuildFrameworkValidator();
    this.chainOperatorExecutor = this.createChainOperatorExecutor();
    this.resetPipeline();
    void this.initializePromptGuidanceService();

    // Update parsing system with registered framework IDs for quote-aware @framework detection
    // This allows @docs/, @mention, etc. to be treated as literal text while @CAGEERF works
    const frameworkIds = new Set(frameworkManager.getFrameworkIds(false));
    this.parsingSystem.updateRegisteredFrameworkIds(frameworkIds);
  }

  setToolDescriptionLoader(manager: ToolDescriptionLoader): void {
    this.toolDescriptionLoader = manager;
  }

  setAnalyticsService(analyticsService: MetricsCollector): void {
    this.analyticsService = analyticsService;
  }

  setDatabasePort(
    db: import('#shared/types/persistence.js').DatabasePort,
    argHistoryStore?: StateStore<PersistedArgumentHistory>
  ): void {
    // The store arrives already built rather than being constructed here: `mcp/` (Layer 4) is
    // barred from importing `infra/` by `mcp-no-infra-static`, exactly as `modules/` is by
    // `modules-no-infra-static`. Only the composition root may name the concrete store, so it
    // hands one down. Scope is applied here because this layer owns the launch workspace.
    if (argHistoryStore !== undefined) {
      this.argumentHistoryTracker.setStateStore(argHistoryStore, this.workspaceScope);
    } else {
      this.logger.warn(
        'PromptExecutor.setDatabasePort called without an argument-history store; argument history will not persist.'
      );
    }
    if ('setDatabasePort' in this.chainSessionStore) {
      (this.chainSessionStore as { setDatabasePort(db: unknown): void }).setDatabasePort(db);
    }
    this.executionRecordStore = createExecutionRecordStore(db, this.logger);
    this.promptPipeline = undefined;
  }

  setHookRegistry(hookRegistry: HookRegistryPort): void {
    this.hookRegistry = hookRegistry;
  }

  setNotificationEmitter(emitter: McpNotificationEmitterPort): void {
    this.notificationEmitter = emitter;
  }

  setGateStateStore(gateStateStore: any): void {
    this.lightweightGateSystem.setGateStateStore(gateStateStore, this.workspaceScope);
  }

  getLightweightGateSystem(): LightweightGateSystem {
    return this.lightweightGateSystem;
  }

  getGateGuidanceRenderer(): GateGuidanceRenderer {
    return this.gateGuidanceRenderer;
  }

  /**
   * Get chain session manager for external access (MCP resources).
   * This is the canonical instance that tracks all chain sessions.
   */
  getChainSessionStore(): ChainSessionService {
    return this.chainSessionStore;
  }

  /**
   * The execution ledger reader, for consumers outside the pipeline (currently the
   * `execution_history` system_control action). Null until a database is wired — the
   * ledger is optional, so callers check rather than assume.
   */
  getExecutionRecordStore(): ExecutionRecordStore | null {
    return this.executionRecordStore;
  }

  async cleanup(): Promise<void> {
    this.logger.debug('[PromptExecutor] Cleaning up');

    if (this.analyticsService && 'shutdown' in this.analyticsService) {
      await this.analyticsService.shutdown?.();
    }

    if (this.toolDescriptionLoader && 'shutdown' in this.toolDescriptionLoader) {
      await this.toolDescriptionLoader.shutdown?.();
    }

    if ('shutdown' in this.configManager && typeof this.configManager.shutdown === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- duck-typed shutdown on ConfigManager
      this.configManager.shutdown();
    }

    if ('shutdown' in this.promptManager && typeof this.promptManager.shutdown === 'function') {
      await this.promptManager.shutdown();
    }

    if (this.frameworkStateStore && 'shutdown' in this.frameworkStateStore) {
      await this.frameworkStateStore.shutdown?.();
    }

    if (
      'cleanup' in this.chainSessionStore &&
      typeof this.chainSessionStore.cleanup === 'function'
    ) {
      await this.chainSessionStore.cleanup();
    }

    await this.argumentHistoryTracker.shutdown();

    if (
      'cleanup' in this.lightweightGateSystem &&
      typeof this.lightweightGateSystem.cleanup === 'function'
    ) {
      await this.lightweightGateSystem.cleanup();
    }

    if (this.promptGuidanceService && 'shutdown' in this.promptGuidanceService) {
      await this.promptGuidanceService.shutdown?.();
    }
  }

  async executePromptCommand(
    args: {
      command?: string; // Optional - not needed for chain resume (chain_id + user_response)
      force_restart?: boolean;
      chain_id?: string;
      /** Stop the run named by `chain_id`. See `handleCancel`. */
      cancel?: boolean;
      gate_verdict?: string;
      gate_action?: 'retry' | 'skip' | 'abort';
      user_response?: string;
      /** Unified gate specifications (canonical in v3.0.0+). Accepts gate IDs, simple checks, or full definitions. */
      gates?: import('#shared/types/execution.js').GateSpecification[];
      options?: Record<string, unknown>;
      /** Typed unknowns discovered/resolved by the current step. Threaded through unchanged (Tier 3 consumes it). */
      observations?: UnknownObservation[];
      /**
       * A planner-submitted Workflow IR (P6 Tier 5). Mutually exclusive with `command` and
       * `chain_id`; the conflict is rejected by the tool schema's refinement and, for callers
       * that bypass the schema, by stage 04.
       */
      workflow?: WorkflowIR;
    },
    extra: any
  ): Promise<ToolResponse> {
    const sdkExtra =
      extra != null && typeof extra === 'object' && '_sdkExtra' in extra
        ? (extra as Record<string, unknown>)['_sdkExtra']
        : undefined;
    // `cancel` short-circuits before any command parsing: it names an existing run rather than
    // describing one to start, so nothing below it applies.
    if (args.cancel === true) {
      return await this.handleCancel(args.chain_id, sdkExtra);
    }

    const normalizedCommand = typeof args.command === 'string' ? args.command.trim() : '';
    const chainIdFromCommand = this.extractChainId(normalizedCommand);
    const hasResumePayload = Boolean(
      (args.user_response && args.user_response.trim().length > 0) ||
      (args.gate_verdict && args.gate_verdict.trim().length > 0)
    );
    const shouldTreatAsResumeOnly =
      Boolean(chainIdFromCommand) && hasResumePayload && args.force_restart !== true;

    if (shouldTreatAsResumeOnly && !args.chain_id) {
      this.logger.debug('[PromptExecutor] Normalizing chain resume command into chain_id', {
        inferredChainId: chainIdFromCommand,
      });
    }

    const commandValue = shouldTreatAsResumeOnly ? undefined : normalizedCommand || undefined;
    const chainIdValue =
      args.chain_id ?? (shouldTreatAsResumeOnly ? chainIdFromCommand : undefined);

    // A workflow's own `gates` ride the SAME request channel as the `gates` parameter, rather
    // than a second IR-specific gate path (OQ-P6-8). That channel is already node-addressed:
    // `temporary-gate-registrar` reconciles `target_step_id` against the run's node ids, which
    // for an IR run ARE the node ids the submission declared. Concatenated rather than
    // substituted so a caller supplying both keeps both — `gates` and `workflow` are not
    // mutually exclusive, only the three command sources are.
    //
    // Written as two pushes rather than `[...(args.gates ?? []), …]`: the `no-restricted-syntax`
    // guard added 2026-08-06 matches the SHAPE `args.gates` coalesced onto anything, because the
    // defect it exists for (`args.gate_configuration ?? args.gates`) came back once already after
    // a guard that pinned literal expressions. Defaulting to `[]` is not that defect, but a guard
    // narrowed to admit it would stop matching the shape it was widened to catch.
    const mergedGates: GateSpecification[] = [];
    if (args.gates !== undefined) {
      mergedGates.push(...args.gates);
    }
    if (args.workflow?.gates !== undefined) {
      mergedGates.push(...args.workflow.gates);
    }

    const request = {
      ...(commandValue && { command: commandValue }),
      ...(chainIdValue && { chain_id: chainIdValue }),
      ...(args.gate_verdict && { gate_verdict: args.gate_verdict }),
      ...(args.gate_action && { gate_action: args.gate_action }),
      ...(args.user_response && { user_response: args.user_response }),
      ...(args.force_restart !== undefined && { force_restart: args.force_restart }),
      ...(mergedGates.length > 0 && { gates: mergedGates }),
      ...(args.workflow != null && { workflow: args.workflow }),
      ...(args.options && { options: args.options }),
      ...(args.observations != null ? { observations: args.observations } : {}),
      ...(sdkExtra != null ? { _extra: sdkExtra as Record<string, unknown> } : {}),
    } as McpToolRequest;

    this.logger.info('[PromptExecutor] Executing request', {
      command: request.command ?? (args.workflow != null ? '<workflow>' : '<resume>'),
    });

    const pipeline = this.getPromptExecutionPipeline();
    return pipeline.execute(request);
  }

  /**
   * Extracts a chain_id from a bare command string when users send chain resumes
   * as the command value (common with LLM-generated calls). Only used for resume
   * scenarios to avoid colliding with real commands.
   */
  private extractChainId(command?: string): string | undefined {
    if (!command) {
      return undefined;
    }
    const trimmed = command.trim();
    return isChainId(trimmed) ? trimmed : undefined;
  }

  /**
   * Stop the run named by `chainId` and block further progression.
   *
   * Relocated from `system_control session cancel`. The rule that decides the placement is which
   * id the caller holds: a `chain_id` is held BECAUSE you are running the chain, so ending that
   * run is part of running it. `system_control session` keeps `list`/`inspect`/`clear`, which are
   * operator work across runs you are not in, keyed on a `session_id` read from a listing.
   *
   * Cancel is NOT clear. It transitions the run to `cancelled` and leaves its state and artifacts
   * in place so the operator can still inspect what happened; removing them is `clear`'s job.
   * It is also not `force_restart`: that abandons this run and immediately begins a new one, which
   * is cancel-then-start. Both verbs now live on one tool, so the distinction is stated in both
   * descriptions rather than being implied by which tool you reached for.
   */
  private async handleCancel(
    chainId: string | undefined,
    sdkExtra: unknown
  ): Promise<ToolResponse> {
    if (chainId === undefined || chainId.trim().length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              '❌ `cancel: true` requires `chain_id` — it names the run to stop.\n\n' +
              'Use `system_control(action:"session", operation:"list")` to find one.',
          },
        ],
        isError: true,
      };
    }

    // Same scope posture the relocated handler used: a cancel must not reach another workspace's
    // session. `cancelChain` enforces it via `getSessionForMutation`; the caller has to supply it.
    const scope = this.resolveRequestScope(sdkExtra);
    const trimmed = chainId.trim();

    // `cancelChain` is keyed on the INTERNAL session id (e.g.
    // `review-content_analysis-1786998494932`), while the caller holds the resume token
    // (`chain-content_analysis#1`). Resolving one to the other here is the substance of the
    // relocation, not a detail of it: the old `system_control` operation took the internal id, so
    // stopping your own run meant listing sessions first to look up an identifier you never chose.
    // `includeDormant` is set because a run parked awaiting review is exactly the one an operator
    // reaches for cancel on.
    const session = this.chainSessionStore.getSessionByChainIdentifier(trimmed, {
      ...scope,
      includeDormant: true,
    });
    const cancelled = await this.chainSessionStore.cancelChain(
      session?.sessionId ?? trimmed,
      scope
    );

    if (!cancelled) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `⚠️ **Cancel Not Applied**: \`${chainId}\`\n\n` +
              'The run is already in a terminal state (completed/failed/cancelled), or no run ' +
              'with that id exists in this workspace. Use `system_control(action:"session", ' +
              'operation:"inspect")` to view its current status.',
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `🛑 **Chain Cancelled**: \`${chainId}\`\n\n` +
            'Further progression is blocked. Session state and artifacts are retained — remove ' +
            'them with `system_control(action:"session", operation:"clear")`.',
        },
      ],
      isError: false,
    };
  }

  /**
   * Request-scoped workspace identity, or `undefined` when the request carries none.
   *
   * `undefined` rather than a substituted default, mirroring the `system_control` handler this
   * verb moved from: `getSessionForMutation` SKIPS the scope check when it receives `undefined`
   * and enforces it when it receives a value. Falling back to the process workspace scope here
   * looks more careful and is strictly worse — a session created without a `continuityScopeId`
   * then compares unequal to the substituted one and every cancel returns "not applied". That is
   * exactly what happened before this comment existed, and only a live drive showed it: the unit
   * tests pass a mock store whose `cancelChain` resolves `true` regardless of scope.
   */
  private resolveRequestScope(sdkExtra: unknown): StateStoreOptions | undefined {
    if (sdkExtra === null || typeof sdkExtra !== 'object') {
      return undefined;
    }
    const identity = resolveRequestIdentity(sdkExtra as Record<string, unknown>);
    const scopeId = resolveContinuityScopeId(identity);
    return scopeId !== 'default' ? { continuityScopeId: scopeId } : undefined;
  }

  private async routeToTool(
    targetTool: string,
    params: Record<string, any>,
    originalCommand: string
  ): Promise<ToolResponse> {
    if (!this.mcpToolsManager) {
      throw new Error('MCP tool registry unavailable');
    }

    try {
      switch (targetTool) {
        case 'resource_manager': {
          const resourceHandler = this.mcpToolsManager.getResourceManagerHandler?.();
          if (resourceHandler) {
            return resourceHandler(params, {});
          }
          return this.buildPromptListFallback(params?.['search_query']);
        }
        case 'system_control':
          if (this.mcpToolsManager.systemControl) {
            return this.mcpToolsManager.systemControl.handleAction(params, {});
          }
          break;
        case 'prompt_engine_guide':
          return this.generatePromptEngineGuide(params?.['goal']);
        case 'prompt_engine_invalid_command':
          return this.responseFormatter.formatErrorResponse(
            'Commands must start with a real prompt id after `>>`. Use resource_manager(resource_type:"prompt", action:"list") to find valid ids before executing.'
          );
        default:
          break;
      }

      throw new Error(`Unknown target tool: ${targetTool}`);
    } catch (error) {
      const message =
        error instanceof Error
          ? `Tool routing failed (${targetTool}): ${error.message}`
          : `Tool routing failed (${targetTool}): ${String(error)}`;
      this.logger.error('[PromptExecutor] Tool routing failed', {
        targetTool,
        originalCommand,
        error,
      });
      return this.responseFormatter.formatErrorResponse(message);
    }
  }

  private buildPromptListFallback(searchQuery?: string): ToolResponse {
    const normalizedQuery = searchQuery?.toLowerCase().trim();
    const matchingPrompts = this.convertedPrompts
      .filter((prompt) => {
        if (!normalizedQuery) {
          return true;
        }
        return (
          prompt.id.toLowerCase().includes(normalizedQuery) ||
          (prompt.name?.toLowerCase().includes(normalizedQuery) ?? false) ||
          (prompt.category?.toLowerCase().includes(normalizedQuery) ?? false)
        );
      })
      .slice(0, 25);

    if (matchingPrompts.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `📭 No prompts match "${searchQuery}". Try a broader search or provide fewer keywords.`,
          },
        ],
        isError: false,
      };
    }

    const lines: string[] = [];
    lines.push('📚 **Prompt Catalog Snapshot**');
    if (normalizedQuery) {
      lines.push(`Filter: ${normalizedQuery}`);
    }
    lines.push('');
    matchingPrompts.forEach((prompt) => {
      const category = prompt.category ?? 'uncategorized';
      const description = prompt.description
        ? prompt.description.length > 80
          ? `${prompt.description.slice(0, 77)}…`
          : prompt.description
        : 'No description provided.';
      lines.push(`- \`${prompt.id}\` — ${prompt.name ?? prompt.id} _(category: ${category})_`);
      lines.push(`  ${description}`);
    });

    if (matchingPrompts.length === 25) {
      lines.push(
        '\n…results truncated. Use resource_manager(resource_type:"prompt", action:"list") for full search capabilities.'
      );
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      isError: false,
    };
  }

  private generatePromptEngineGuide(goal?: string): ToolResponse {
    const text = renderPromptEngineGuide(goal);
    return {
      content: [{ type: 'text', text }],
      isError: false,
    };
  }

  private async initializePromptGuidanceService(): Promise<void> {
    if (this.promptGuidanceService || !this.frameworkManager) {
      return;
    }

    try {
      this.promptGuidanceService = await createPromptGuidanceService(
        this.logger,
        {
          systemPromptInjection: {
            enabled: true,
          },
          templateEnhancement: {
            enabled: true,
            enhancementLevel: 'moderate',
            enableStructureOptimization: true,
          },
        },
        this.frameworkManager
      );
    } catch (error) {
      this.logger.warn('[PromptExecutor] Failed to initialize PromptGuidanceService', {
        error,
      });
    }
  }

  private async initializeStyleManager(): Promise<void> {
    if (this.styleManager) {
      return;
    }

    try {
      this.styleManager = await createStyleManager(this.logger, {
        loaderConfig: {
          stylesDir: path.join(this.serverRoot, 'resources', 'styles'),
        },
      });
      this.logger.info('[PromptExecutor] StyleManager initialized');
    } catch (error) {
      this.logger.warn('[PromptExecutor] Failed to initialize StyleManager', {
        error,
      });
      // StyleManager is optional - pipeline will fall back to hardcoded styles
    }
  }

  private resetPipeline(): void {
    this.promptPipeline = undefined;
  }

  private rebuildFrameworkValidator(): void {
    if (!this.frameworkManager) {
      this.frameworkValidator = null;
      return;
    }

    // FrameworkValidator now uses FrameworkManager directly as the single source of truth
    this.frameworkValidator = new FrameworkValidator(this.frameworkManager, this.logger, {
      defaultStage: 'operator_validation',
    });
  }

  private createChainOperatorExecutor(): ChainOperatorExecutor {
    return new ChainOperatorExecutor(
      this.logger,
      this.convertedPrompts,
      this.gateGuidanceRenderer,
      this.resolveFrameworkContextForPrompt.bind(this),
      {
        referenceResolver: this.referenceResolver,
        scriptReferenceResolver: this.scriptReferenceResolver,
        // Phase-guard declared headers, read through per call so framework hot-reload keeps
        // working. `frameworkManager` satisfies `FrameworkGuideProvider` structurally.
        declaredSectionsProvider: (frameworkId: string) =>
          resolveDeclaredSections(() => this.frameworkManager, frameworkId),
      }
    );
  }

  private async resolveFrameworkContextForPrompt(promptId: string) {
    const prompt = this.convertedPrompts.find((p) => p.id === promptId);
    if (!prompt) {
      return null;
    }

    const frameworkContext = await this.getFrameworkExecutionContext(prompt);
    if (!frameworkContext) {
      return {
        category: prompt.category,
      };
    }

    return {
      selectedFramework: frameworkContext.selectedFramework,
      category: prompt.category,
      systemPrompt: frameworkContext.systemPrompt,
    };
  }

  private async getFrameworkExecutionContext(
    prompt: ConvertedPrompt
  ): Promise<FrameworkExecutionContext | null> {
    if (!this.frameworkManager || !this.frameworkStateStore) {
      return null;
    }

    if (!this.frameworkStateStore.isFrameworkSystemEnabled()) {
      return null;
    }

    try {
      const activeFramework = this.frameworkStateStore.getActiveFramework();
      return this.frameworkManager.generateExecutionContext(prompt, {
        userPreference: activeFramework.type,
      });
    } catch (error) {
      this.logger.warn('[PromptExecutor] Failed to generate framework execution context', {
        promptId: prompt.id,
        error,
      });
      return null;
    }
  }

  private getPromptExecutionPipeline(): PromptExecutionPipeline {
    if (!this.promptPipeline) {
      if (!this.chainOperatorExecutor) {
        this.chainOperatorExecutor = this.createChainOperatorExecutor();
      }

      const builder = new PipelineBuilder({
        logger: this.logger,
        serverRoot: this.serverRoot,
        configManager: this.configManager,
        parsingSystem: this.parsingSystem,
        executionPlanner: this.executionPlanner,
        chainSessionStore: this.chainSessionStore,
        chainSessionRouter: this.chainSessionRouter,
        executionRecordStore: this.executionRecordStore,
        lightweightGateSystem: this.lightweightGateSystem,
        gateManager: this.gateManager,
        gateReferenceResolver: this.gateReferenceResolver,
        gateGuidanceRenderer: this.gateGuidanceRenderer,
        chainOperatorExecutor: this.chainOperatorExecutor,
        responseFormatter: this.responseFormatter,
        referenceResolver: this.referenceResolver,
        scriptReferenceResolver: this.scriptReferenceResolver,
        frameworkManager: this.frameworkManager,
        frameworkValidator: this.frameworkValidator,
        promptGuidanceService: this.promptGuidanceService ?? null,
        styleManager: this.styleManager ?? null,
        hookRegistry: this.hookRegistry,
        notificationEmitter: this.notificationEmitter,
        mcpToolsManager: this.mcpToolsManager,
        getFrameworkStateEnabled: () =>
          this.frameworkStateStore?.isFrameworkSystemEnabled() ?? false,
        getAnalyticsService: () => this.analyticsService,
        getConvertedPrompts: () => this.convertedPrompts,
        routeToTool: this.routeToTool.bind(this),
      });
      this.promptPipeline = builder.build();
    }
    return this.promptPipeline;
  }
}

export function createPromptExecutor(
  logger: Logger,
  promptManager: PromptAssetManager,
  configManager: ConfigManager,
  semanticAnalyzer: ContentAnalyzer,
  textReferenceStore: TextReferenceStore,
  gateManager: GateManager,
  mcpToolsManager?: any,
  promptGuidanceService?: PromptGuidanceService
): PromptExecutor {
  return new PromptExecutor(
    logger,
    promptManager,
    configManager,
    semanticAnalyzer,
    textReferenceStore,
    gateManager,
    mcpToolsManager,
    promptGuidanceService
  );
}

export async function cleanupPromptExecutor(tool: PromptExecutor): Promise<void> {
  await tool.cleanup();
}
