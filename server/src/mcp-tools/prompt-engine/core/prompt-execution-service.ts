// @lifecycle canonical - Executes MCP prompts through the execution pipeline.
/**
 * Pipeline-driven prompt execution service.
 *
 * Wires the canonical PromptExecutionPipeline together with the surrounding
 * services (sessions, gates, framework state) so the MCP tool only needs to
 * pass validated requests into the pipeline.
 */

import * as path from 'node:path';

import { ChainManagementService } from './chain-management.js';
import { createChainSessionManager } from '../../../chain-session/manager.js';
import { ConfigManager } from '../../../config/index.js';
import { ChainOperatorExecutor } from '../../../execution/operators/chain-operator-executor.js';
import { createParsingSystem } from '../../../execution/parsers/index.js';
import { createSymbolicCommandParser } from '../../../execution/parsers/symbolic-operator-parser.js';
import { PromptExecutionPipeline } from '../../../execution/pipeline/prompt-execution-pipeline.js';
import { DependencyInjectionStage } from '../../../execution/pipeline/stages/00-dependency-injection-stage.js';
import { ExecutionLifecycleStage } from '../../../execution/pipeline/stages/00-execution-lifecycle-stage.js';
import { RequestNormalizationStage } from '../../../execution/pipeline/stages/00-request-normalization-stage.js';
import { CommandParsingStage } from '../../../execution/pipeline/stages/01-parsing-stage.js';
import { InlineGateExtractionStage } from '../../../execution/pipeline/stages/02-inline-gate-stage.js';
import { OperatorValidationStage } from '../../../execution/pipeline/stages/03-operator-validation-stage.js';
import { ExecutionPlanningStage } from '../../../execution/pipeline/stages/04-planning-stage.js';
import { ScriptExecutionStage } from '../../../execution/pipeline/stages/04b-script-execution-stage.js';
import { ScriptAutoExecuteStage } from '../../../execution/pipeline/stages/04c-script-auto-execute-stage.js';
import { GateEnhancementStage } from '../../../execution/pipeline/stages/05-gate-enhancement-stage.js';
import { FrameworkResolutionStage } from '../../../execution/pipeline/stages/06-framework-stage.js';
import { JudgeSelectionStage } from '../../../execution/pipeline/stages/06a-judge-selection-stage.js';
import { PromptGuidanceStage } from '../../../execution/pipeline/stages/06b-prompt-guidance-stage.js';
import { SessionManagementStage } from '../../../execution/pipeline/stages/07-session-stage.js';
import { InjectionControlStage } from '../../../execution/pipeline/stages/07b-injection-control-stage.js';
import { StepResponseCaptureStage } from '../../../execution/pipeline/stages/08-response-capture-stage.js';
import { createShellVerificationStage } from '../../../execution/pipeline/stages/08b-shell-verification-stage.js';
import { StepExecutionStage } from '../../../execution/pipeline/stages/09-execution-stage.js';
import { ResponseFormattingStage } from '../../../execution/pipeline/stages/10-formatting-stage.js';
import { GateReviewStage } from '../../../execution/pipeline/stages/10-gate-review-stage.js';
import { CallToActionStage } from '../../../execution/pipeline/stages/11-call-to-action-stage.js';
import { PostFormattingCleanupStage } from '../../../execution/pipeline/stages/12-post-formatting-cleanup-stage.js';
import { ExecutionPlanner } from '../../../execution/planning/execution-planner.js';
import {
  PromptReferenceResolver,
  ScriptReferenceResolver,
} from '../../../execution/reference/index.js';
import { FrameworkManager } from '../../../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import { FrameworkValidator } from '../../../frameworks/framework-validator.js';
import {
  PromptGuidanceService,
  createPromptGuidanceService,
} from '../../../frameworks/prompt-guidance/index.js';
import { FrameworkExecutionContext } from '../../../frameworks/types/index.js';
import {
  LightweightGateSystem,
  createGateValidator,
  createTemporaryGateRegistry,
} from '../../../gates/core/index.js';
import {
  GateGuidanceRenderer,
  createGateGuidanceRenderer,
} from '../../../gates/guidance/GateGuidanceRenderer.js';
import { GateManagerProvider } from '../../../gates/registry/gate-provider-adapter.js';
import { GateReferenceResolver } from '../../../gates/services/gate-reference-resolver.js';
import { GateServiceFactory } from '../../../gates/services/gate-service-factory.js';
import { createShellVerifyExecutor } from '../../../gates/shell/index.js';
import { Logger } from '../../../logging/index.js';
import { PromptAssetManager } from '../../../prompts/index.js';
import { WorkspaceScriptLoader } from '../../../scripts/core/index.js';
import { createToolDetectionService } from '../../../scripts/detection/tool-detection-service.js';
import { createExecutionModeService } from '../../../scripts/execution/execution-mode-service.js';
import { createScriptExecutor } from '../../../scripts/execution/script-executor.js';
import { ContentAnalyzer } from '../../../semantic/configurable-semantic-analyzer.js';
import { StyleManager, createStyleManager } from '../../../styles/index.js';
import { ConversationManager } from '../../../text-references/conversation.js';
import { TextReferenceManager, ArgumentHistoryTracker } from '../../../text-references/index.js';
import { ConvertedPrompt, PromptData, ToolResponse } from '../../../types/index.js';
import { CHAIN_ID_PATTERN } from '../../../utils/index.js';
import { ToolDescriptionManager } from '../../tool-description-manager.js';
import { ResponseFormatter } from '../processors/response-formatter.js';
import { renderPromptEngineGuide } from '../utils/guide.js';

import type { ChainSessionService } from '../../../chain-session/types.js';
import type { ParsingSystem } from '../../../execution/parsers/index.js';
import type { PipelineStage } from '../../../execution/pipeline/stage.js';
import type { GateManager } from '../../../gates/gate-manager.js';
import type { IGateService } from '../../../gates/services/gate-service-interface.js';
import type { MetricsCollector } from '../../../metrics/index.js';
import type { McpToolRequest, TemporaryGateInput } from '../../../types/execution.js';

export class PromptExecutionService {
  public readonly inlineGateParser: ReturnType<typeof createSymbolicCommandParser>;

  private readonly logger: Logger;
  private readonly mcpServer: any;
  private readonly promptManager: PromptAssetManager;
  private readonly configManager: ConfigManager;
  private readonly semanticAnalyzer: ContentAnalyzer;
  private readonly conversationManager: ConversationManager;
  private readonly textReferenceManager: TextReferenceManager;
  private readonly responseFormatter: ResponseFormatter;
  private readonly executionPlanner: ExecutionPlanner;
  private readonly parsingSystem: ParsingSystem;
  private readonly chainManagementService: ChainManagementService;
  private readonly lightweightGateSystem: LightweightGateSystem;
  private readonly gateReferenceResolver: GateReferenceResolver;
  private readonly gateGuidanceRenderer: GateGuidanceRenderer;
  private readonly chainSessionManager: ChainSessionService;
  private readonly argumentHistoryTracker: ArgumentHistoryTracker;

  private frameworkStateManager?: FrameworkStateManager;
  private frameworkManager?: FrameworkManager;
  private promptGuidanceService: PromptGuidanceService | undefined;
  private chainOperatorExecutor?: ChainOperatorExecutor;
  private frameworkValidator: FrameworkValidator | null = null;
  private toolDescriptionManager?: ToolDescriptionManager;
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

  private convertedPrompts: ConvertedPrompt[] = [];
  private readonly serverRoot: string;

  constructor(
    logger: Logger,
    mcpServer: any,
    promptManager: PromptAssetManager,
    configManager: ConfigManager,
    semanticAnalyzer: ContentAnalyzer,
    conversationManager: ConversationManager,
    textReferenceManager: TextReferenceManager,
    gateManager: GateManager,
    mcpToolsManager?: any,
    promptGuidanceService?: PromptGuidanceService
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.promptManager = promptManager;
    this.configManager = configManager;
    this.semanticAnalyzer = semanticAnalyzer;
    this.conversationManager = conversationManager;
    this.textReferenceManager = textReferenceManager;
    this.gateManager = gateManager; // Store for registry-based gate selection
    this.responseFormatter = new ResponseFormatter();
    this.executionPlanner = new ExecutionPlanner(semanticAnalyzer, logger);
    this.parsingSystem = createParsingSystem(logger);
    this.inlineGateParser = createSymbolicCommandParser(logger);
    this.mcpToolsManager = mcpToolsManager;
    this.promptGuidanceService = promptGuidanceService;

    const resolvedServerRoot =
      typeof configManager.getServerRoot === 'function'
        ? configManager.getServerRoot()
        : path.dirname(configManager.getConfigPath?.() ?? path.join(process.cwd(), 'config.json'));
    this.serverRoot = resolvedServerRoot;

    const sessionConfig = configManager.getChainSessionConfig?.();
    const chainSessionOptions = sessionConfig
      ? {
          defaultSessionTimeoutMs: sessionConfig.sessionTimeoutMinutes * 60 * 1000,
          reviewSessionTimeoutMs: sessionConfig.reviewTimeoutMinutes * 60 * 1000,
          cleanupIntervalMs: sessionConfig.cleanupIntervalMinutes * 60 * 1000,
        }
      : undefined;

    this.argumentHistoryTracker = new ArgumentHistoryTracker(
      logger,
      50,
      path.join(this.serverRoot, 'runtime-state', 'argument-history.json')
    );

    this.chainSessionManager = createChainSessionManager(
      logger,
      textReferenceManager,
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

    this.chainManagementService = new ChainManagementService(
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

    this.logger.info('[PromptExecutionService] Initialized pipeline dependencies');
  }

  updateData(_promptsData: PromptData[], convertedPrompts: ConvertedPrompt[]): void {
    this.convertedPrompts = convertedPrompts;
    this.chainManagementService.updatePrompts(convertedPrompts);
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

  setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void {
    this.frameworkStateManager = frameworkStateManager;
  }

  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
    this.executionPlanner.setFrameworkManager(frameworkManager);
    this.rebuildFrameworkValidator();
    this.chainOperatorExecutor = this.createChainOperatorExecutor();
    this.resetPipeline();
    void this.initializePromptGuidanceService();
  }

  setToolDescriptionManager(manager: ToolDescriptionManager): void {
    this.toolDescriptionManager = manager;
  }

  setAnalyticsService(analyticsService: MetricsCollector): void {
    this.analyticsService = analyticsService;
    this.responseFormatter.setAnalyticsService(analyticsService);
  }

  setGateSystemManager(gateSystemManager: any): void {
    this.lightweightGateSystem.setGateSystemManager(gateSystemManager);
  }

  getLightweightGateSystem(): LightweightGateSystem {
    return this.lightweightGateSystem;
  }

  getGateGuidanceRenderer(): GateGuidanceRenderer {
    return this.gateGuidanceRenderer;
  }

  async cleanup(): Promise<void> {
    this.logger.debug('[PromptExecutionService] Cleaning up');

    if (this.analyticsService && 'shutdown' in this.analyticsService) {
      await this.analyticsService.shutdown?.();
    }

    if (this.toolDescriptionManager && 'shutdown' in this.toolDescriptionManager) {
      await this.toolDescriptionManager.shutdown?.();
    }

    if ('shutdown' in this.configManager && typeof this.configManager.shutdown === 'function') {
      this.configManager.shutdown();
    }

    if ('shutdown' in this.promptManager && typeof this.promptManager.shutdown === 'function') {
      await this.promptManager.shutdown();
    }

    if (this.frameworkStateManager && 'shutdown' in this.frameworkStateManager) {
      await this.frameworkStateManager.shutdown?.();
    }

    if (
      'cleanup' in this.chainSessionManager &&
      typeof this.chainSessionManager.cleanup === 'function'
    ) {
      await this.chainSessionManager.cleanup();
    }

    this.argumentHistoryTracker.shutdown();

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
      gates?: import('../../../types/execution.js').GateSpecification[];
      options?: Record<string, unknown>;
    },
    extra: any
  ): Promise<ToolResponse> {
    void extra;
    const normalizedCommand = typeof args.command === 'string' ? args.command.trim() : '';
    const chainIdFromCommand = this.extractChainId(normalizedCommand);
    const hasResumePayload = Boolean(
      (args.user_response && args.user_response.trim().length > 0) ||
      (args.gate_verdict && args.gate_verdict.trim().length > 0)
    );
    const shouldTreatAsResumeOnly =
      Boolean(chainIdFromCommand) && hasResumePayload && args.force_restart !== true;

    if (shouldTreatAsResumeOnly && !args.chain_id) {
      this.logger.debug('[PromptExecutionService] Normalizing chain resume command into chain_id', {
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
    } as McpToolRequest;

    this.logger.info('[PromptExecutionService] Executing request', {
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
        case 'prompt_manager':
          if (this.mcpToolsManager.promptManagerTool) {
            return this.mcpToolsManager.promptManagerTool.handleAction(params, {});
          }
          return this.buildPromptListFallback(params?.['search_query']);
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
      this.logger.error('[PromptExecutionService] Tool routing failed', {
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
      const methodologyStatePath = path.join(
        this.serverRoot,
        'runtime-state',
        'framework-state.json'
      );
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
          methodologyTracking: {
            enabled: true,
            persistStateToDisk: true,
            enableHealthMonitoring: true,
            stateFilePath: methodologyStatePath,
          },
        },
        this.frameworkManager
      );
    } catch (error) {
      this.logger.warn('[PromptExecutionService] Failed to initialize PromptGuidanceService', {
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
      this.logger.info('[PromptExecutionService] StyleManager initialized');
    } catch (error) {
      this.logger.warn('[PromptExecutionService] Failed to initialize StyleManager', {
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
      this.promptGuidanceService,
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
    if (!this.frameworkManager || !this.frameworkStateManager) {
      return null;
    }

    if (!this.frameworkStateManager.isFrameworkSystemEnabled()) {
      return null;
    }

    try {
      const activeFramework = this.frameworkStateManager.getActiveFramework();
      return this.frameworkManager.generateExecutionContext(prompt, {
        userPreference: activeFramework.type as any,
      });
    } catch (error) {
      this.logger.warn('[PromptExecutionService] Failed to generate framework execution context', {
        promptId: prompt.id,
        error,
      });
      return null;
    }
  }

  private getPromptExecutionPipeline(): PromptExecutionPipeline {
    if (!this.promptPipeline) {
      this.promptPipeline = this.buildPromptExecutionPipeline();
    }
    return this.promptPipeline;
  }

  private buildPromptExecutionPipeline(): PromptExecutionPipeline {
    const temporaryGateRegistry = this.lightweightGateSystem.getTemporaryGateRegistry();
    if (!temporaryGateRegistry) {
      throw new Error('Temporary gate registry unavailable');
    }

    if (!this.chainOperatorExecutor) {
      this.chainOperatorExecutor = this.createChainOperatorExecutor();
    }

    const requestStage = new RequestNormalizationStage(
      this.chainManagementService ?? null,
      this.routeToTool.bind(this),
      this.logger
    );

    const dependencyStage = new DependencyInjectionStage(
      temporaryGateRegistry,
      this.chainSessionManager,
      () => this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false,
      () => this.analyticsService,
      'canonical-stage-0',
      this.logger
    );

    const lifecycleStage = new ExecutionLifecycleStage(temporaryGateRegistry, this.logger);

    const commandParsingStage = new CommandParsingStage(
      this.parsingSystem.commandParser,
      this.parsingSystem.argumentParser,
      this.convertedPrompts,
      this.logger,
      this.chainSessionManager
    );

    const inlineGateStage = new InlineGateExtractionStage(
      temporaryGateRegistry,
      this.gateReferenceResolver,
      this.logger
    );
    const operatorValidationStage = new OperatorValidationStage(
      this.frameworkValidator,
      this.logger
    );
    const planningStage = new ExecutionPlanningStage(
      this.executionPlanner,
      () => this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false,
      this.logger
    );

    // Script execution stage (04b) - executes prompt-scoped script tools
    // Creates services lazily to avoid startup overhead when scripts aren't used
    const scriptExecutor = createScriptExecutor({ debug: false });
    const toolDetectionService = createToolDetectionService({ debug: false });
    const executionModeService = createExecutionModeService({ debug: false });
    const scriptExecutionStage = new ScriptExecutionStage(
      scriptExecutor,
      toolDetectionService,
      executionModeService,
      this.logger
    );

    // Script auto-execute stage (04c) - calls MCP tools based on script output
    // Uses resource manager handler from mcpToolsManager if available
    const resourceManagerHandler = this.mcpToolsManager?.getResourceManagerHandler?.() ?? null;
    const scriptAutoExecuteStage = new ScriptAutoExecuteStage(resourceManagerHandler, this.logger);

    const frameworkStage: PipelineStage = this.frameworkManager
      ? new FrameworkResolutionStage(
          this.frameworkManager,
          () => this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false,
          this.logger,
          this.lightweightGateSystem.gateLoader
        )
      : {
          name: 'FrameworkResolution',
          execute: async () => {
            this.logger.debug(
              '[PromptExecutionService] Framework stage skipped (framework manager unavailable)'
            );
          },
        };

    const judgeSelectionStage = new JudgeSelectionStage(
      () => this.convertedPrompts,
      this.lightweightGateSystem.gateLoader,
      this.configManager,
      this.logger,
      undefined, // frameworksProvider - uses default methodology loader
      this.styleManager ?? null
    );

    const promptGuidanceStage = new PromptGuidanceStage(
      this.promptGuidanceService ?? null,
      this.styleManager ?? null,
      this.logger
    );

    const gateStage = new GateEnhancementStage(
      this.createGateService(),
      temporaryGateRegistry,
      () => this.configManager.getFrameworksConfig(),
      this.gateReferenceResolver,
      () => this.frameworkManager,
      this.logger,
      () => this.analyticsService,
      () => this.configManager.getGatesConfig(),
      this.lightweightGateSystem.gateLoader,
      () => this.gateManager // Provider for registry-based gate selection
    );

    const sessionStage = new SessionManagementStage(this.chainSessionManager, this.logger);
    // Use modular injection control stage for system-prompt/gate-guidance/style-guidance decisions
    const injectionControlStage = new InjectionControlStage(
      () => this.configManager.getInjectionConfig(),
      this.logger
    );
    const responseCaptureStage = new StepResponseCaptureStage(
      this.chainSessionManager,
      this.logger
    );

    // Shell verification stage (08b) - executes shell commands for ground-truth validation
    // Enables "Ralph Wiggum" style loops where Claude's work is validated by real command execution
    const shellVerifyExecutor = createShellVerifyExecutor({ debug: false });
    const shellVerificationStage = createShellVerificationStage(shellVerifyExecutor, this.logger);

    const executionStage = new StepExecutionStage(
      this.chainOperatorExecutor,
      this.chainSessionManager,
      this.logger,
      this.referenceResolver,
      this.scriptReferenceResolver
    );
    const gateReviewStage = new GateReviewStage(
      this.chainOperatorExecutor,
      this.chainSessionManager,
      this.logger
    );
    const callToActionStage = new CallToActionStage(this.logger);
    const formattingStage = new ResponseFormattingStage(this.responseFormatter, this.logger);
    const postFormattingStage = new PostFormattingCleanupStage(
      this.chainSessionManager,
      temporaryGateRegistry,
      this.logger
    );

    return new PromptExecutionPipeline(
      requestStage,
      dependencyStage,
      lifecycleStage,
      commandParsingStage,
      inlineGateStage,
      operatorValidationStage,
      planningStage,
      scriptExecutionStage, // 04b - Script tool execution
      scriptAutoExecuteStage, // 04c - Script auto-execute
      frameworkStage,
      judgeSelectionStage,
      promptGuidanceStage,
      gateStage,
      sessionStage,
      injectionControlStage,
      responseCaptureStage,
      shellVerificationStage, // 08b - Shell verification (Ralph Wiggum loops)
      executionStage,
      gateReviewStage,
      callToActionStage,
      formattingStage,
      postFormattingStage,
      this.logger,
      () => this.analyticsService
    );
  }

  private createGateService(): IGateService {
    const factory = new GateServiceFactory(
      this.logger,
      this.configManager,
      this.gateGuidanceRenderer,
      this.lightweightGateSystem.gateValidator
    );
    return factory.createGateService();
  }
}

export function createPromptExecutionService(
  logger: Logger,
  mcpServer: any,
  promptManager: PromptAssetManager,
  configManager: ConfigManager,
  semanticAnalyzer: ContentAnalyzer,
  conversationManager: ConversationManager,
  textReferenceManager: TextReferenceManager,
  gateManager: GateManager,
  mcpToolsManager?: any,
  promptGuidanceService?: PromptGuidanceService
): PromptExecutionService {
  return new PromptExecutionService(
    logger,
    mcpServer,
    promptManager,
    configManager,
    semanticAnalyzer,
    conversationManager,
    textReferenceManager,
    gateManager,
    mcpToolsManager,
    promptGuidanceService
  );
}

export async function cleanupPromptExecutionService(tool: PromptExecutionService): Promise<void> {
  await tool.cleanup();
}
