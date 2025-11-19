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
import { createSymbolicCommandParser } from '../../../execution/parsers/symbolic-command-parser.js';
import { PromptExecutionPipeline } from '../../../execution/pipeline/prompt-execution-pipeline.js';
import { DependencyInjectionStage } from '../../../execution/pipeline/stages/00-dependency-injection-stage.js';
import { ExecutionLifecycleStage } from '../../../execution/pipeline/stages/00-execution-lifecycle-stage.js';
import { RequestNormalizationStage } from '../../../execution/pipeline/stages/00-request-normalization-stage.js';
import { CommandParsingStage } from '../../../execution/pipeline/stages/01-parsing-stage.js';
import { InlineGateExtractionStage } from '../../../execution/pipeline/stages/02-inline-gate-stage.js';
import { OperatorValidationStage } from '../../../execution/pipeline/stages/03-operator-validation-stage.js';
import { ExecutionPlanningStage } from '../../../execution/pipeline/stages/04-planning-stage.js';
import { GateEnhancementStage } from '../../../execution/pipeline/stages/05-gate-enhancement-stage.js';
import { FrameworkResolutionStage } from '../../../execution/pipeline/stages/06-framework-stage.js';
import { PromptGuidanceStage } from '../../../execution/pipeline/stages/06b-prompt-guidance-stage.js';
import { SessionManagementStage } from '../../../execution/pipeline/stages/07-session-stage.js';
import { StepResponseCaptureStage } from '../../../execution/pipeline/stages/08-response-capture-stage.js';
import { StepExecutionStage } from '../../../execution/pipeline/stages/09-execution-stage.js';
import { ResponseFormattingStage } from '../../../execution/pipeline/stages/10-formatting-stage.js';
import { GateReviewStage } from '../../../execution/pipeline/stages/10-gate-review-stage.js';
import { CallToActionStage } from '../../../execution/pipeline/stages/11-call-to-action-stage.js';
import { PostFormattingCleanupStage } from '../../../execution/pipeline/stages/12-post-formatting-cleanup-stage.js';
import { ExecutionPlanner } from '../../../execution/planning/execution-planner.js';
import { FrameworkManager } from '../../../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import { FrameworkValidator } from '../../../frameworks/framework-validator.js';
import { FrameworkRegistry } from '../../../frameworks/methodology/framework-registry.js';
import {
  PromptGuidanceService,
  createPromptGuidanceService,
} from '../../../frameworks/prompt-guidance/index.js';
import { FrameworkExecutionContext } from '../../../frameworks/types/index.js';
import {
  LightweightGateSystem,
  createLightweightGateSystem,
  type TemporaryGateRegistryDefinition as TemporaryGateDefinition,
} from '../../../gates/core/index.js';
import {
  GateGuidanceRenderer,
  createGateGuidanceRenderer,
} from '../../../gates/guidance/GateGuidanceRenderer.js';
import { GateReferenceResolver } from '../../../gates/services/gate-reference-resolver.js';
import { GateServiceFactory } from '../../../gates/services/gate-service-factory.js';
import { Logger } from '../../../logging/index.js';
import { PromptAssetManager } from '../../../prompts/index.js';
import { ContentAnalyzer } from '../../../semantic/configurable-semantic-analyzer.js';
import { ConversationManager } from '../../../text-references/conversation.js';
import { TextReferenceManager, ArgumentHistoryTracker } from '../../../text-references/index.js';
import { renderPromptEngineGuide } from '../utils/guide.js';
import { ConvertedPrompt, PromptData, ToolResponse } from '../../../types/index.js';
import { ToolDescriptionManager } from '../../tool-description-manager.js';
import { ResponseFormatter } from '../processors/response-formatter.js';

import type { ChainSessionService } from '../../../chain-session/types.js';
import type { ParsingSystem } from '../../../execution/parsers/index.js';
import type { PipelineStage } from '../../../execution/pipeline/stage.js';
import type { IGateService } from '../../../gates/services/gate-service-interface.js';
import type { MetricsCollector } from '../../../metrics/index.js';
import type { McpToolRequest } from '../../../types/execution.js';

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
  private promptGuidanceService?: PromptGuidanceService;
  private chainOperatorExecutor?: ChainOperatorExecutor;
  private frameworkValidator: FrameworkValidator | null = null;
  private toolDescriptionManager?: ToolDescriptionManager;
  private analyticsService?: MetricsCollector;
  private promptPipeline?: PromptExecutionPipeline;
  private mcpToolsManager?: any;

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
      : path.resolve(this.serverRoot, 'src/gates/definitions');

    const llmConfig = config.analysis?.semanticAnalysis?.llmIntegration;
    this.lightweightGateSystem = createLightweightGateSystem(logger, gatesDirectory, undefined, {
      enableTemporaryGates: true,
      maxMemoryGates: 100,
      defaultExpirationMs: 30 * 60 * 1000,
      llmConfig,
    });
    this.gateReferenceResolver = new GateReferenceResolver(this.lightweightGateSystem.gateLoader);
    this.gateGuidanceRenderer = createGateGuidanceRenderer(logger, {
      gateLoader: this.lightweightGateSystem.gateLoader,
      temporaryGateRegistry: this.lightweightGateSystem.getTemporaryGateRegistry?.(),
      frameworkIdentifierProvider: () => {
        const frameworks = this.frameworkManager?.listFrameworks(false) ?? [];
        const identifiers = new Set<string>();

        for (const framework of frameworks) {
          if (framework?.id) {
            identifiers.add(framework.id.toUpperCase());
          }
          if (framework?.methodology) {
            identifiers.add(framework.methodology.toUpperCase());
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

    this.logger.info('[PromptExecutionService] Initialized pipeline dependencies');
  }

  updateData(_promptsData: PromptData[], convertedPrompts: ConvertedPrompt[]): void {
    this.convertedPrompts = convertedPrompts;
    this.chainManagementService.updatePrompts(convertedPrompts);
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
      command: string;
      execution_mode?: 'auto' | 'prompt' | 'template' | 'chain';
      api_validation?: boolean;
      gate_validation?: boolean;
      force_restart?: boolean;
      chain_id?: string;
      user_response?: string;
      timeout?: number;
      temporary_gates?: TemporaryGateDefinition[];
      gate_scope?: 'execution' | 'session' | 'chain' | 'step';
      quality_gates?: string[];
      custom_checks?: Array<{ name: string; description: string }>;
      options?: Record<string, unknown>;
    },
    extra: any
  ): Promise<ToolResponse> {
    void extra;
    const normalizedCommand = typeof args.command === 'string' ? args.command.trim() : '';

    const request: McpToolRequest = {
      command: normalizedCommand || undefined,
      chain_id: args.chain_id,
      user_response: args.user_response,
      force_restart: args.force_restart,
      execution_mode: args.execution_mode ?? 'auto',
      api_validation:
        args.api_validation ??
        (typeof args.gate_validation === 'boolean' ? args.gate_validation : undefined),
      quality_gates: args.quality_gates,
      custom_checks: args.custom_checks,
      temporary_gates: args.temporary_gates as McpToolRequest['temporary_gates'],
      gate_scope: args.gate_scope,
      timeout: args.timeout,
      options: args.options,
    };

    this.logger.info('[PromptExecutionService] Executing request', {
      command: request.command ?? '<resume>',
      executionMode: request.execution_mode,
    });

    const pipeline = this.getPromptExecutionPipeline();
    return pipeline.execute(request);
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
          return this.buildPromptListFallback(params?.search_query);
        case 'system_control':
          if (this.mcpToolsManager.systemControl) {
            return this.mcpToolsManager.systemControl.handleAction(params, {});
          }
          break;
        case 'prompt_engine_guide':
          return this.generatePromptEngineGuide(params?.goal);
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
        '\n…results truncated. Use prompt_manager(action:"list") for full search capabilities.'
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
            injectionMethod: 'smart',
            enableTemplateVariables: true,
            enableContextualEnhancement: true,
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

  private resetPipeline(): void {
    this.promptPipeline = undefined;
  }

  private rebuildFrameworkValidator(): void {
    if (!this.frameworkManager) {
      this.frameworkValidator = null;
      return;
    }

    try {
      const registry = new FrameworkRegistry(this.logger);
      registry.loadDefinitions(this.frameworkManager.listFrameworks(false));
      this.frameworkValidator = new FrameworkValidator(registry, this.logger, {
        defaultStage: 'operator_validation',
      });
    } catch (error) {
      this.logger.warn('[PromptExecutionService] Failed to rebuild framework validator', { error });
      this.frameworkValidator = null;
    }
  }

  private createChainOperatorExecutor(): ChainOperatorExecutor {
    return new ChainOperatorExecutor(
      this.logger,
      this.convertedPrompts,
      this.gateGuidanceRenderer,
      this.resolveFrameworkContextForPrompt.bind(this)
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
        selectedFramework: undefined,
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
        userPreference: activeFramework.methodology as any,
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

    const frameworkStage: PipelineStage = this.frameworkManager
      ? new FrameworkResolutionStage(
          this.frameworkManager,
          () => this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false,
          this.logger
        )
      : {
          name: 'FrameworkResolution',
          execute: async () => {
            this.logger.debug(
              '[PromptExecutionService] Framework stage skipped (framework manager unavailable)'
            );
          },
        };

    const promptGuidanceStage = new PromptGuidanceStage(
      this.promptGuidanceService ?? null,
      this.logger
    );

    const gateStage = new GateEnhancementStage(
      this.createGateService(),
      temporaryGateRegistry,
      () => this.configManager.getFrameworksConfig(),
      this.logger,
      () => this.analyticsService
    );

    const sessionStage = new SessionManagementStage(this.chainSessionManager, this.logger);
    const responseCaptureStage = new StepResponseCaptureStage(
      this.chainSessionManager,
      this.logger
    );
    const executionStage = new StepExecutionStage(
      this.chainOperatorExecutor,
      this.chainSessionManager,
      this.logger
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
      frameworkStage,
      promptGuidanceStage,
      gateStage,
      sessionStage,
      responseCaptureStage,
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
    mcpToolsManager,
    promptGuidanceService
  );
}

export async function cleanupPromptExecutionService(tool: PromptExecutionService): Promise<void> {
  await tool.cleanup();
}
