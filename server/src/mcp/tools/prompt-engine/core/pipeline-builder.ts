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
 *                 └── PipelineStage[] (22 stages)
 */

import * as path from 'node:path';

import type { GateService } from '#engine/gates/services/gate-service-interface.js';
import type { PipelineDependencies } from './pipeline-dependencies.js';

import { StepCaptureService } from '#engine/execution/capture/step-capture-service.js';
import { ResponseAssembler } from '#engine/execution/formatting/response-assembler.js';
import { ChainBlueprintResolver, SymbolicCommandBuilder } from '#engine/execution/parsers/index.js';
import { GateEnforcementAuthority } from '#engine/execution/pipeline/decisions/index.js';
import {
  // Core pipeline
  PromptExecutionPipeline,
  type PipelineStage,
  // Stages 01-03: Initialization
  RequestNormalizationStage,
  ExecutionLifecycleStage,
  IdentityResolutionStage,
  // Stages 04-09: Parsing, Planning, Scripts
  CommandParsingStage,
  InlineGateExtractionStage,
  OperatorValidationStage,
  ExecutionPlanningStage,
  ScriptExecutionStage,
  ScriptAutoExecuteStage,
  // Stages 10-15: Judge, Gates, Framework, Session, Injection
  GateEnhancementStage,
  FrameworkResolutionStage,
  JudgeSelectionStage,
  PromptGuidanceStage,
  SessionManagementStage,
  InjectionControlStage,
  // Stages 16-22: Capture, Execution, Review, Formatting
  StepResponseCaptureStage,
  createShellVerificationStage,
  StepExecutionStage,
  createPhaseGuardVerificationStage,
  GateReviewStage,
  ResponseFormattingStage,
  PostFormattingCleanupStage,
} from '#engine/execution/pipeline/index.js';
import { getDefaultRuntimeLoader } from '#engine/frameworks/definitions/index.js';
import {
  JudgeMenuFormatter,
  type FrameworkJudgePromptProvider,
} from '#engine/gates/judge/judge-menu-formatter.js';
import { JudgeResourceCollector } from '#engine/gates/judge/judge-resource-collector.js';
import { GateEnhancementService } from '#engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '#engine/gates/services/gate-metrics-recorder.js';
import { GateServiceFactory } from '#engine/gates/services/gate-service-factory.js';
import { GateVerdictProcessor } from '#engine/gates/services/gate-verdict-processor.js';
import { InlineGateProcessor } from '#engine/gates/services/inline-gate-processor.js';
import { TemporaryGateRegistrar } from '#engine/gates/services/temporary-gate-registrar.js';
import {
  createShellVerifyExecutor,
  createVerifyActiveStateStore,
} from '#engine/gates/shell/index.js';
import { createToolDetectionService } from '#modules/automation/detection/tool-detection-service.js';
import { createScriptExecutor } from '#modules/automation/execution/script-executor.js';
import { createToolTriggerFilter } from '#modules/automation/execution/tool-trigger-filter.js';

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

    // ── Stages 01-03: Initialization ──

    const requestStage = new RequestNormalizationStage(
      deps.chainSessionRouter ?? null,
      deps.routeToTool,
      deps.logger
    );

    // Depends only on services this builder already holds, so it is built once
    // here and handed to the pipeline rather than reconstructed per request.
    const gateEnforcement = new GateEnforcementAuthority(
      deps.chainSessionStore,
      deps.logger,
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

    // ── Stages 04-09: Parsing, Planning, Scripts ──

    const symbolicCommandBuilder = new SymbolicCommandBuilder(
      deps.parsingSystem.argumentParser,
      deps.logger
    );
    const blueprintResolver = new ChainBlueprintResolver(deps.chainSessionStore, deps.logger);
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

    // Script execution stage
    const scriptExecutor = createScriptExecutor({ debug: false });
    const toolDetectionService = createToolDetectionService({ debug: false });
    const toolTriggerFilter = createToolTriggerFilter({ debug: false });
    const scriptExecutionStage = new ScriptExecutionStage(
      scriptExecutor,
      toolDetectionService,
      toolTriggerFilter,
      deps.logger
    );

    // Script auto-execute stage
    const scriptAutoExecuteStage = new ScriptAutoExecuteStage(
      this.resolveResourceManagerHandler(),
      deps.logger
    );

    // ── Stages 10-15: Judge, Gates, Framework, Session, Injection ──

    const frameworkStage = this.createFrameworkStage();

    const frameworksProvider = () => {
      try {
        const loader = getDefaultRuntimeLoader();
        const ids = loader.discoverFrameworks();
        return ids
          .map((id) => {
            const def = loader.loadFramework(id);
            if (!def || def.enabled === false) return null;
            const description =
              (def as unknown as Record<string, unknown>)['description'] ??
              def.systemPromptGuidance?.trim().split('\n')[0] ??
              'Framework';
            return {
              id: (def.type || def.id).toLowerCase(),
              name: def.name || def.type || def.id,
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

    const judgePromptProvider: FrameworkJudgePromptProvider = (frameworkId) => {
      try {
        const loader = getDefaultRuntimeLoader();
        const definition = loader.loadFramework(frameworkId);
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

    const sessionStage = new SessionManagementStage(deps.chainSessionStore, deps.logger);
    const injectionControlStage = new InjectionControlStage(
      () => deps.configManager.getInjectionConfig(),
      deps.logger
    );

    // ── Stages 16-22: Capture, Execution, Review, Formatting ──

    const gateVerdictProcessor = new GateVerdictProcessor(
      deps.chainSessionStore,
      deps.logger,
      deps.hookRegistry,
      deps.notificationEmitter
    );
    const stepCaptureService = new StepCaptureService(deps.chainSessionStore, deps.logger);
    const responseCaptureStage = new StepResponseCaptureStage(
      gateVerdictProcessor,
      stepCaptureService,
      deps.chainSessionStore,
      deps.logger
    );

    // Shell verification stage
    const shellVerifyExecutor = createShellVerifyExecutor({ debug: false });
    const verifyActiveStateStore = createVerifyActiveStateStore(deps.logger, {
      runtimeStateDir: path.join(deps.serverRoot, 'runtime-state'),
    });
    const shellVerificationStage = createShellVerificationStage(
      shellVerifyExecutor,
      verifyActiveStateStore,
      deps.chainSessionStore,
      deps.logger
    );

    // Lifecycle hook: clean up verify-state when sessions are cleared
    deps.chainSessionStore.onSessionCleared(async (_sessionId: string, session) => {
      if (session.pendingShellVerification?.shellVerify?.loop === true) {
        await verifyActiveStateStore.clearState(session.chainId);
      }
    });

    const executionStage = new StepExecutionStage(
      deps.chainOperatorExecutor,
      deps.chainSessionStore,
      deps.logger,
      deps.referenceResolver,
      deps.scriptReferenceResolver,
      deps.executionRecordStore
    );

    // Phase guard verification stage
    const phaseGuardVerificationStage = createPhaseGuardVerificationStage(
      () => deps.frameworkManager,
      () =>
        deps.configManager.getConfig().phaseGuards ?? { mode: 'enforce' as const, maxRetries: 2 },
      deps.chainSessionStore,
      deps.logger
    );

    const gateReviewStage = new GateReviewStage(
      deps.chainOperatorExecutor,
      deps.chainSessionStore,
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
      deps.chainSessionStore,
      temporaryGateRegistry,
      deps.logger
    );

    // Execution order. The array IS the contract — the pipeline runs it front to
    // back and does no reordering of its own.
    //
    // Constraints this order encodes, each of which breaks something if inverted.
    // The first three are also declared as `requires`/`provides` on the stages
    // themselves, so inverting one throws from the pipeline constructor rather
    // than failing at runtime; the last two are enforced by this comment only.
    //   - JudgeSelection before PromptGuidance, which reads the
    //     state.framework.clientSelectedStyle that JudgeSelection writes.
    //   - SessionManagement before InjectionControl, which needs currentStep.
    //   - InjectionControl before PromptGuidance, which reads the injection
    //     decisions InjectionControl writes to context.state.injection.
    //   - ScriptExecution before ScriptAutoExecute, so auto-executed tool output
    //     is available to the template context that follows.
    //   - ShellVerification before StepExecution, enabling verify loops where a
    //     shell command grades the previous response.
    //
    // JudgeSelection also runs before GateEnhancement and FrameworkResolution so
    // the judge phase (%judge) returns a clean resource menu with no framework or
    // gate injection. That one is a property of the early return, not of a context
    // key, so it has no `requires` declaration to carry it.
    const stages: readonly PipelineStage[] = [
      requestStage,
      lifecycleStage,
      identityResolutionStage,
      commandParsingStage,
      inlineGateStage,
      operatorValidationStage,
      planningStage,
      scriptExecutionStage,
      scriptAutoExecuteStage,
      judgeSelectionStage,
      gateStage,
      frameworkStage,
      sessionStage,
      injectionControlStage,
      promptGuidanceStage,
      responseCaptureStage,
      shellVerificationStage,
      executionStage,
      phaseGuardVerificationStage,
      gateReviewStage,
      formattingStage,
      postFormattingStage,
    ];

    return new PromptExecutionPipeline(stages, {
      logger: deps.logger,
      metricsProvider: deps.getAnalyticsService,
      hookRegistry: deps.hookRegistry,
      gateEnforcement,
      // Stages take `| null`; PipelinePorts is uniformly optional, so normalize here
      // rather than admitting both empty representations into the ports interface.
      executionRecordStore: deps.executionRecordStore ?? undefined,
    });
  }

  /**
   * Real framework stage when a manager is wired, otherwise an inert stage that
   * keeps the position occupied so the order stays stable.
   */
  private createFrameworkStage(): PipelineStage {
    const { deps } = this;
    if (!deps.frameworkManager) {
      return {
        name: 'FrameworkResolution',
        execute: async () => {
          deps.logger.debug(
            '[PipelineBuilder] Framework stage skipped (framework manager unavailable)'
          );
        },
      };
    }

    return new FrameworkResolutionStage(
      deps.frameworkManager,
      deps.getFrameworkStateEnabled,
      deps.logger,
      deps.lightweightGateSystem.gateLoader
    );
  }

  private resolveResourceManagerHandler(): ReturnType<
    NonNullable<NonNullable<PipelineDependencies['mcpToolsManager']>['getResourceManagerHandler']>
  > | null {
    return this.deps.mcpToolsManager?.getResourceManagerHandler?.() ?? null;
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
