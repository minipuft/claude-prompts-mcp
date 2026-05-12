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
 *                 └── PipelineStage[] (stages 00-11)
 */

import * as path from 'node:path';

import { ChainSessionRouter } from './chain-session-router.js';
import { PipelineBuilder } from './pipeline-builder.js';
import { ChainOperatorExecutor } from '../../../../engine/execution/operators/chain-operator-executor.js';
import { createParsingSystem } from '../../../../engine/execution/parsers/index.js';
import { createSymbolicCommandParser } from '../../../../engine/execution/parsers/symbolic-operator-parser.js';
import { ExecutionPlanner } from '../../../../engine/execution/planning/execution-planner.js';
import {
  PromptReferenceResolver,
  ScriptReferenceResolver,
} from '../../../../engine/execution/reference/index.js';
import { FrameworkManager } from '../../../../engine/frameworks/framework-manager.js';
import { FrameworkStateStore } from '../../../../engine/frameworks/framework-state-store.js';
import { FrameworkValidator } from '../../../../engine/frameworks/framework-validator.js';
import {
  PromptGuidanceService,
  createPromptGuidanceService,
} from '../../../../engine/frameworks/prompt-guidance/index.js';
import { FrameworkExecutionContext } from '../../../../engine/frameworks/types/index.js';
import {
  LightweightGateSystem,
  createGateValidator,
  createTemporaryGateRegistry,
} from '../../../../engine/gates/core/index.js';
import {
  GateGuidanceRenderer,
  createGateGuidanceRenderer,
} from '../../../../engine/gates/guidance/GateGuidanceRenderer.js';
import { GateManagerProvider } from '../../../../engine/gates/registry/gate-provider-adapter.js';
import { GateReferenceResolver } from '../../../../engine/gates/services/gate-reference-resolver.js';
import { WorkspaceScriptLoader } from '../../../../modules/automation/core/index.js';
import { createScriptExecutor } from '../../../../modules/automation/execution/script-executor.js';
import {
  ExecutionRecordStore,
  createExecutionRecordStore,
} from '../../../../modules/chains/execution-record-store.js';
import { createChainSessionManager } from '../../../../modules/chains/manager.js';
import { StyleManager, createStyleManager } from '../../../../modules/formatting/index.js';
import { PromptAssetManager } from '../../../../modules/prompts/index.js';
import { ContentAnalyzer } from '../../../../modules/semantic/configurable-semantic-analyzer.js';
import { ConversationStore } from '../../../../modules/text-refs/conversation.js';
import { TextReferenceStore, ArgumentHistoryTracker } from '../../../../modules/text-refs/index.js';
import {
  type Logger,
  type MetricsCollector,
  type HookRegistryPort,
  type McpNotificationEmitterPort,
  ToolResponse,
  ConfigManager,
  ChainSessionService,
} from '../../../../shared/types/index.js';
import { CHAIN_ID_PATTERN } from '../../../../shared/utils/index.js';
import { ToolDescriptionLoader } from '../../tool-description-loader.js';
import { ResponseFormatter } from '../processors/response-formatter.js';
import { renderPromptEngineGuide } from '../utils/guide.js';

import type { ParsingSystem } from '../../../../engine/execution/parsers/index.js';
import type { PromptExecutionPipeline } from '../../../../engine/execution/pipeline/index.js';
import type { ConvertedPrompt } from '../../../../engine/execution/types.js';
import type { GateManager } from '../../../../engine/gates/gate-manager.js';
import type { PromptData } from '../../../../modules/prompts/types.js';
import type { McpToolRequest } from '../../../../shared/types/execution.js';

export class PromptExecutor {
  public readonly inlineGateParser: ReturnType<typeof createSymbolicCommandParser>;

  private readonly logger: Logger;
  private readonly mcpServer: any;
  private readonly promptManager: PromptAssetManager;
  private readonly configManager: ConfigManager;
  private readonly semanticAnalyzer: ContentAnalyzer;
  private readonly conversationStore: ConversationStore;
  private readonly textReferenceStore: TextReferenceStore;
  private readonly responseFormatter: ResponseFormatter;
  private readonly executionPlanner: ExecutionPlanner;
  private readonly parsingSystem: ParsingSystem;
  private readonly chainSessionRouter: ChainSessionRouter;
  private readonly lightweightGateSystem: LightweightGateSystem;
  private readonly gateReferenceResolver: GateReferenceResolver;
  private readonly gateGuidanceRenderer: GateGuidanceRenderer;
  private readonly chainSessionManager: ChainSessionService;
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
  /** Hook registry for pipeline event emissions */
  private hookRegistry?: HookRegistryPort;
  /** Notification emitter for MCP client notifications */
  private notificationEmitter?: McpNotificationEmitterPort;

  private convertedPrompts: ConvertedPrompt[] = [];
  private readonly serverRoot: string;

  constructor(
    logger: Logger,
    mcpServer: any,
    promptManager: PromptAssetManager,
    configManager: ConfigManager,
    semanticAnalyzer: ContentAnalyzer,
    conversationStore: ConversationStore,
    textReferenceStore: TextReferenceStore,
    gateManager: GateManager,
    mcpToolsManager?: any,
    promptGuidanceService?: PromptGuidanceService
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.promptManager = promptManager;
    this.configManager = configManager;
    this.semanticAnalyzer = semanticAnalyzer;
    this.conversationStore = conversationStore;
    this.textReferenceStore = textReferenceStore;
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
    const chainSessionOptions = sessionConfig
      ? {
          defaultSessionTimeoutMs: sessionConfig.sessionTimeoutMinutes * 60 * 1000,
          reviewSessionTimeoutMs: sessionConfig.reviewTimeoutMinutes * 60 * 1000,
          cleanupIntervalMs: sessionConfig.cleanupIntervalMinutes * 60 * 1000,
        }
      : undefined;

    this.argumentHistoryTracker = new ArgumentHistoryTracker(logger, 50);
    // Initialize async - will be ready when DatabasePort is set via setDatabasePort
    this.argumentHistoryTracker.initialize().catch((error) => {
      logger.warn('Failed to initialize ArgumentHistoryTracker:', error);
    });

    this.chainSessionManager = createChainSessionManager(
      logger,
      textReferenceStore,
      this.serverRoot,
      chainSessionOptions,
      this.argumentHistoryTracker
    );
    const config = configManager.getConfig();
    const gatesDirectory = config.gates?.definitionsDirectory
      ? path.isAbsolute(config.gates.definitionsDirectory)
        ? config.gates.definitionsDirectory
        : path.resolve(this.serverRoot, config.gates.definitionsDirectory)
      : path.resolve(this.serverRoot, 'gates');

    const llmConfig = config.analysis?.semanticAnalysis?.llmIntegration;

    const temporaryGateRegistry = createTemporaryGateRegistry(logger, {
      maxMemoryGates: 100,
      defaultExpirationMs: 30 * 60 * 1000,
    });

    const gateProvider = new GateManagerProvider(gateManager, temporaryGateRegistry);
    const gateValidator = createGateValidator(logger, gateProvider, llmConfig);
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
      this.chainSessionManager,
      this.responseFormatter,
      this.lightweightGateSystem
    );
    this.chainOperatorExecutor = this.createChainOperatorExecutor();

    // Inject GateLoader into ExecutionPlanner for dynamic methodology gate detection
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
    this.chainOperatorExecutor = this.createChainOperatorExecutor();
    this.resetPipeline();
  }

  setFrameworkStateStore(frameworkStateStore: FrameworkStateStore): void {
    this.frameworkStateStore = frameworkStateStore;
  }

  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
    this.executionPlanner.setFrameworkManager(frameworkManager);
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

  setDatabasePort(db: import('../../../../shared/types/persistence.js').DatabasePort): void {
    this.argumentHistoryTracker.setDatabasePort(db);
    if ('setDatabasePort' in this.chainSessionManager) {
      (this.chainSessionManager as { setDatabasePort(db: unknown): void }).setDatabasePort(db);
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
    this.lightweightGateSystem.setGateStateStore(gateStateStore);
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
  getChainSessionManager(): ChainSessionService {
    return this.chainSessionManager;
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
      'cleanup' in this.chainSessionManager &&
      typeof this.chainSessionManager.cleanup === 'function'
    ) {
      await this.chainSessionManager.cleanup();
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
      gate_verdict?: string;
      gate_action?: 'retry' | 'skip' | 'abort';
      user_response?: string;
      /** Unified gate specifications (canonical in v3.0.0+). Accepts gate IDs, simple checks, or full definitions. */
      gates?: import('../../../../shared/types/execution.js').GateSpecification[];
      options?: Record<string, unknown>;
    },
    extra: any
  ): Promise<ToolResponse> {
    const sdkExtra =
      extra != null && typeof extra === 'object' && '_sdkExtra' in extra
        ? (extra as Record<string, unknown>)['_sdkExtra']
        : undefined;
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

    const request = {
      ...(commandValue && { command: commandValue }),
      ...(chainIdValue && { chain_id: chainIdValue }),
      ...(args.gate_verdict && { gate_verdict: args.gate_verdict }),
      ...(args.gate_action && { gate_action: args.gate_action }),
      ...(args.user_response && { user_response: args.user_response }),
      ...(args.force_restart !== undefined && { force_restart: args.force_restart }),
      ...(args.gates && { gates: args.gates }),
      ...(args.options && { options: args.options }),
      ...(sdkExtra != null ? { _extra: sdkExtra as Record<string, unknown> } : {}),
    } as McpToolRequest;

    this.logger.info('[PromptExecutor] Executing request', {
      command: request.command ?? '<resume>',
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
    const match = command.trim().match(CHAIN_ID_PATTERN);
    return match ? match[0] : undefined;
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
            enableArgumentSuggestions: true,
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
      this.referenceResolver,
      this.scriptReferenceResolver
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
        userPreference: activeFramework.type as any,
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
        chainSessionManager: this.chainSessionManager,
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
  mcpServer: any,
  promptManager: PromptAssetManager,
  configManager: ConfigManager,
  semanticAnalyzer: ContentAnalyzer,
  conversationStore: ConversationStore,
  textReferenceStore: TextReferenceStore,
  gateManager: GateManager,
  mcpToolsManager?: any,
  promptGuidanceService?: PromptGuidanceService
): PromptExecutor {
  return new PromptExecutor(
    logger,
    mcpServer,
    promptManager,
    configManager,
    semanticAnalyzer,
    conversationStore,
    textReferenceStore,
    gateManager,
    mcpToolsManager,
    promptGuidanceService
  );
}

export async function cleanupPromptExecutor(tool: PromptExecutor): Promise<void> {
  await tool.cleanup();
}
