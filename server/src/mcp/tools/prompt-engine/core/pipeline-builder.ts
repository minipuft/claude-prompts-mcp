// @lifecycle canonical - Factory for PromptExecutionPipeline stage wiring.
/**
 * Pipeline Builder — Factory for PromptExecutionPipeline.
 *
 * Extracted from PromptExecutor to isolate the 23+ service instantiations
 * and stage wiring that constitute pipeline construction. Every new pipeline
 * service adds wiring here, keeping PromptExecutor focused on execution.
 *
 * Architecture:
 *   PromptExecutor (orchestration)
 *     └── PipelineBuilder (factory)
 *           └── PromptExecutionPipeline (coordinator)
 *                 └── PipelineStage[] (stages 00-11)
 */

import * as path from 'node:path';

import { StepCaptureService } from '../../../../engine/execution/capture/step-capture-service.js';
import { ResponseAssembler } from '../../../../engine/execution/formatting/response-assembler.js';
import {
  ChainBlueprintResolver,
  SymbolicCommandBuilder,
} from '../../../../engine/execution/parsers/index.js';
import {
  // Core pipeline
  PromptExecutionPipeline,
  type PipelineStage,
  // Stage 00: Initialization
  RequestNormalizationStage,
  DependencyInjectionStage,
  ExecutionLifecycleStage,
  IdentityResolutionStage,
  // Stage 01-04: Parsing and Planning
  CommandParsingStage,
  InlineGateExtractionStage,
  OperatorValidationStage,
  ExecutionPlanningStage,
  ScriptExecutionStage,
  ScriptAutoExecuteStage,
  // Stage 05-07: Enhancement and Session
  GateEnhancementStage,
  FrameworkResolutionStage,
  JudgeSelectionStage,
  PromptGuidanceStage,
  SessionManagementStage,
  InjectionControlStage,
  // Stage 08-12: Execution and Formatting
  StepResponseCaptureStage,
  createShellVerificationStage,
  StepExecutionStage,
  createPhaseGuardVerificationStage,
  GateReviewStage,
  ResponseFormattingStage,
  PostFormattingCleanupStage,
} from '../../../../engine/execution/pipeline/index.js';
import { getDefaultRuntimeLoader } from '../../../../engine/frameworks/methodology/index.js';
import {
  JudgeMenuFormatter,
  type MethodologyJudgePromptProvider,
} from '../../../../engine/gates/judge/judge-menu-formatter.js';
import { JudgeResourceCollector } from '../../../../engine/gates/judge/judge-resource-collector.js';
import { GateEnhancementService } from '../../../../engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../../engine/gates/services/gate-metrics-recorder.js';
import { GateServiceFactory } from '../../../../engine/gates/services/gate-service-factory.js';
import { GateVerdictProcessor } from '../../../../engine/gates/services/gate-verdict-processor.js';
import { InlineGateProcessor } from '../../../../engine/gates/services/inline-gate-processor.js';
import { TemporaryGateRegistrar } from '../../../../engine/gates/services/temporary-gate-registrar.js';
import {
  createShellVerifyExecutor,
  createVerifyActiveStateStore,
} from '../../../../engine/gates/shell/index.js';
import { createToolDetectionService } from '../../../../modules/automation/detection/tool-detection-service.js';
import { createExecutionModeService } from '../../../../modules/automation/execution/execution-mode-service.js';
import { createScriptExecutor } from '../../../../modules/automation/execution/script-executor.js';

import type { PipelineDependencies } from './pipeline-dependencies.js';
import type { GateService } from '../../../../engine/gates/services/gate-service-interface.js';

/**
 * Factory that constructs and wires the PromptExecutionPipeline.
 *
 * Receives a typed PipelineDependencies bag and produces a fully-wired
 * pipeline with all 23+ stages and intermediate services.
 */
export class PipelineBuilder {
  private readonly deps: PipelineDependencies;

  constructor(deps: PipelineDependencies) {
    this.deps = deps;
  }

  build(): PromptExecutionPipeline {
    const { deps } = this;
    const temporaryGateRegistry = deps.lightweightGateSystem.getTemporaryGateRegistry();
    if (!temporaryGateRegistry) {
      throw new Error('Temporary gate registry unavailable');
    }

    // ── Stage 00: Initialization ──

    const requestStage = new RequestNormalizationStage(
      deps.chainSessionRouter ?? null,
      deps.routeToTool,
      deps.logger
    );

    const dependencyStage = new DependencyInjectionStage(
      temporaryGateRegistry,
      deps.chainSessionManager,
      deps.getFrameworkStateEnabled,
      deps.getAnalyticsService,
      'canonical-stage-0',
      deps.logger,
      deps.hookRegistry,
      deps.notificationEmitter,
      deps.lightweightGateSystem.gateLoader
    );

    const lifecycleStage = new ExecutionLifecycleStage(temporaryGateRegistry, deps.logger);

    const identityResolutionStage = new IdentityResolutionStage(() => {
      const identityConfig = deps.configManager.getConfig().identity;
      if (!identityConfig?.mode) {
        return null;
      }
      return {
        mode: identityConfig.mode,
        allowPerRequestOverride: identityConfig.allowPerRequestOverride ?? true,
        launchDefaults: identityConfig.launchDefaults,
        transportMode: deps.configManager.getConfig().transport,
      };
    }, deps.logger);

    // ── Stage 01-04: Parsing and Planning ──

    const symbolicCommandBuilder = new SymbolicCommandBuilder(
      deps.parsingSystem.argumentParser,
      deps.logger
    );
    const blueprintResolver = new ChainBlueprintResolver(deps.chainSessionManager, deps.logger);
    const commandParsingStage = new CommandParsingStage(
      deps.parsingSystem.commandParser,
      deps.parsingSystem.argumentParser,
      deps.getConvertedPrompts,
      deps.logger,
      symbolicCommandBuilder,
      blueprintResolver
    );

    const inlineGateProcessor = new InlineGateProcessor(
      temporaryGateRegistry,
      deps.gateReferenceResolver,
      deps.logger
    );
    const inlineGateStage = new InlineGateExtractionStage(inlineGateProcessor, deps.logger);
    const operatorValidationStage = new OperatorValidationStage(
      deps.frameworkValidator ?? null,
      deps.logger
    );
    const planningStage = new ExecutionPlanningStage(
      deps.executionPlanner,
      deps.getFrameworkStateEnabled,
      deps.logger
    );

    // Script execution stage (04b)
    const scriptExecutor = createScriptExecutor({ debug: false });
    const toolDetectionService = createToolDetectionService({ debug: false });
    const executionModeService = createExecutionModeService({ debug: false });
    const scriptExecutionStage = new ScriptExecutionStage(
      scriptExecutor,
      toolDetectionService,
      executionModeService,
      deps.logger
    );

    // Script auto-execute stage (04c)
    const resourceManagerHandler = deps.mcpToolsManager?.getResourceManagerHandler?.() ?? null;
    const scriptAutoExecuteStage = new ScriptAutoExecuteStage(resourceManagerHandler, deps.logger);

    // ── Stage 05-07: Enhancement and Session ──

    const frameworkStage: PipelineStage = deps.frameworkManager
      ? new FrameworkResolutionStage(
          deps.frameworkManager,
          deps.getFrameworkStateEnabled,
          deps.logger,
          deps.lightweightGateSystem.gateLoader
        )
      : {
          name: 'FrameworkResolution',
          execute: async () => {
            deps.logger.debug(
              '[PipelineBuilder] Framework stage skipped (framework manager unavailable)'
            );
          },
        };

    const frameworksProvider = () => {
      try {
        const loader = getDefaultRuntimeLoader();
        const ids = loader.discoverMethodologies();
        return ids
          .map((id) => {
            const def = loader.loadMethodology(id);
            if (!def || def.enabled === false) return null;
            const description =
              (def as unknown as Record<string, unknown>)['description'] ??
              def.systemPromptGuidance?.trim().split('\n')[0] ??
              'Methodology framework';
            return {
              id: (def.methodology || def.id).toLowerCase(),
              name: def.name || def.methodology || def.id,
              description: String(description),
              category: 'guidance' as const,
              userMessageTemplate: '',
              arguments: [],
              registerWithMcp: false,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
      } catch {
        return [];
      }
    };

    const judgePromptProvider: MethodologyJudgePromptProvider = (frameworkId) => {
      try {
        const loader = getDefaultRuntimeLoader();
        const definition = loader.loadMethodology(frameworkId);
        return definition?.judgePrompt;
      } catch {
        return undefined;
      }
    };

    const judgeResourceCollector = new JudgeResourceCollector(
      deps.getConvertedPrompts,
      deps.lightweightGateSystem.gateLoader,
      deps.logger,
      frameworksProvider,
      deps.styleManager ?? null
    );
    const judgeMenuFormatter = new JudgeMenuFormatter(deps.logger, judgePromptProvider);
    const judgeSelectionStage = new JudgeSelectionStage(
      judgeResourceCollector,
      judgeMenuFormatter,
      deps.configManager,
      deps.logger
    );

    const promptGuidanceStage = new PromptGuidanceStage(
      deps.promptGuidanceService ?? null,
      deps.styleManager ?? null,
      deps.logger
    );

    const gateService = this.createGateService();
    const gateEnhancementService = new GateEnhancementService(
      gateService,
      temporaryGateRegistry,
      () => deps.frameworkManager?.selectFramework({})?.id,
      () => deps.gateManager,
      deps.lightweightGateSystem.gateLoader,
      new GateMetricsRecorder(deps.getAnalyticsService, gateService?.serviceType),
      deps.logger
    );
    const temporaryGateRegistrar = new TemporaryGateRegistrar(
      temporaryGateRegistry,
      deps.gateReferenceResolver,
      deps.logger
    );
    const gateStage = new GateEnhancementStage(
      gateEnhancementService,
      temporaryGateRegistrar,
      () => deps.configManager.getGatesConfig(),
      deps.logger
    );

    const sessionStage = new SessionManagementStage(deps.chainSessionManager, deps.logger);
    const injectionControlStage = new InjectionControlStage(
      () => deps.configManager.getInjectionConfig(),
      deps.logger
    );

    // ── Stage 08-12: Execution and Formatting ──

    const gateVerdictProcessor = new GateVerdictProcessor(deps.chainSessionManager, deps.logger);
    const stepCaptureService = new StepCaptureService(deps.chainSessionManager, deps.logger);
    const responseCaptureStage = new StepResponseCaptureStage(
      gateVerdictProcessor,
      stepCaptureService,
      deps.chainSessionManager,
      deps.logger
    );

    // Shell verification stage (08b)
    const shellVerifyExecutor = createShellVerifyExecutor({ debug: false });
    const verifyActiveStateStore = createVerifyActiveStateStore(deps.logger, {
      runtimeStateDir: path.join(deps.serverRoot, 'runtime-state'),
    });
    const shellVerificationStage = createShellVerificationStage(
      shellVerifyExecutor,
      verifyActiveStateStore,
      deps.chainSessionManager,
      deps.logger
    );

    // Lifecycle hook: clean up verify-state when sessions are cleared
    deps.chainSessionManager.onSessionCleared(async (_sessionId: string, session) => {
      if (session.pendingShellVerification?.shellVerify?.loop === true) {
        await verifyActiveStateStore.clearState(session.chainId);
      }
    });

    const executionStage = new StepExecutionStage(
      deps.chainOperatorExecutor,
      deps.chainSessionManager,
      deps.logger,
      deps.referenceResolver,
      deps.scriptReferenceResolver,
      deps.executionRecordStore
    );

    // Phase guard verification stage (09b)
    const phaseGuardVerificationStage = createPhaseGuardVerificationStage(
      () => deps.frameworkManager,
      () =>
        deps.configManager.getConfig().phaseGuards ?? { mode: 'enforce' as const, maxRetries: 2 },
      deps.chainSessionManager,
      deps.logger
    );

    const gateReviewStage = new GateReviewStage(
      deps.chainOperatorExecutor,
      deps.chainSessionManager,
      deps.lightweightGateSystem.gateLoader,
      deps.logger,
      () => deps.configManager.getConfig().gates
    );
    const responseAssembler = new ResponseAssembler();
    const formattingStage = new ResponseFormattingStage(
      deps.responseFormatter,
      responseAssembler,
      deps.logger,
      deps.executionRecordStore
    );
    const postFormattingStage = new PostFormattingCleanupStage(
      deps.chainSessionManager,
      temporaryGateRegistry,
      deps.logger
    );

    return new PromptExecutionPipeline(
      requestStage,
      dependencyStage,
      lifecycleStage,
      identityResolutionStage,
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
      phaseGuardVerificationStage, // 09b - Phase guard verification (methodology phases)
      gateReviewStage,
      formattingStage,
      postFormattingStage,
      deps.logger,
      deps.getAnalyticsService,
      deps.hookRegistry
    );
  }

  private createGateService(): GateService {
    const { deps } = this;
    const factory = new GateServiceFactory(
      deps.logger,
      deps.configManager,
      deps.gateGuidanceRenderer,
      deps.lightweightGateSystem.gateValidator
    );
    return factory.createGateService();
  }
}
