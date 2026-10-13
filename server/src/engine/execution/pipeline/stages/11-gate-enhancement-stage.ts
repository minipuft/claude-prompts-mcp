// @lifecycle canonical - Enriches prompts with gate instructions prior to execution.
import { inlineDefinitionCarriers } from '../../../gates/services/gate-enhancement-service.js';
import { resolveGateSuppression } from '../../../gates/services/gate-suppression-refusal.js';
import {
  callerRequestedGates,
  gateSuppressionRejection,
} from '../../../gates/services/request-gate-admission.js';
import { BasePipelineStage } from '../stage.js';
import { buildWorkflowRejectionResponse } from '../workflow-rejection-response.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateSystemSettings } from '#shared/types/index.js';
import type { StateStoreOptions } from '#shared/types/persistence.js';
import type { GateEnhancementService } from '../../../gates/services/gate-enhancement-service.js';
import type { GateSuppression } from '../../../gates/services/gate-suppression-refusal.js';
import type { TemporaryGateRegistrar } from '../../../gates/services/temporary-gate-registrar.js';
import type { ExecutionContext } from '../../context/index.js';

type GateSystemSettingsProvider = () => GateSystemSettings | undefined;
/** The runtime gate switch (`system_control gates`), read for a request's scope. */
type GateSystemSwitch = (scope: StateStoreOptions | undefined) => boolean;

const SKIP_REASONS: Record<GateSuppression['kind'], string> = {
  config: 'Gate system disabled by configuration',
  runtime: 'Gate system disabled at runtime',
  modifier: 'Gate enhancement disabled by execution modifier',
};

/**
 * Pipeline Stage 11: Gate Enhancement
 *
 * Thin orchestrator that delegates gate enrichment logic to domain services.
 *
 * Dependencies: context.executionPlan, context.convertedPrompt or context.parsedCommand.steps
 * Output: Enhanced prompts with gate instructions, context.activeGateIds
 * Can Early Exit: Yes, only for a gate the call requested while a switch withholds every gate and
 * stage 05 could not see that switch: the planner's default `%clean` for a script-tool prompt.
 * Every other refusal of a gate request is stage 05's (`RequestGateAdmission`), raised
 * before any script tool runs.
 */
export class GateEnhancementStage extends BasePipelineStage {
  readonly name = 'GateEnhancement';
  readonly requires = ['executionPlan'] as const;

  constructor(
    private readonly enhancementService: GateEnhancementService,
    private readonly registrar: TemporaryGateRegistrar,
    private readonly gatesConfigProvider: GateSystemSettingsProvider,
    logger: Logger,
    private readonly gateSystemEnabled: GateSystemSwitch,
    private readonly remapInlineDefinitions: (
      context: ExecutionContext,
      registered: ReadonlyMap<string, string>
    ) => Promise<void>
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (!this.enhancementService.isAvailable()) {
      this.logExit({ skipped: 'Gate service unavailable' });
      return;
    }

    // Each switch withholds every gate. A call that requested none skips; one that requested a
    // gate was refused at stage 05, except under a switch only the final plan carries.
    const gatesConfig = this.gatesConfigProvider();
    const suppression = resolveGateSuppression({
      configEnabled: gatesConfig?.enabled !== false,
      // The runtime switch too, for this request's scope: reading only the config flag let a chain
      // started with the switch off select its gates and then wait on a verdict the tool refuses.
      runtimeEnabled: () => this.gateSystemEnabled(context.getScopeOptions()),
      modifiers: () => context.requireExecutionPlan().modifiers,
    });
    if (suppression !== undefined) {
      this.skipOrRefuse(context, suppression);
      return;
    }

    // Resolved before anything is registered: stage 07 throws on the only input that yields null
    // (a parsed command with neither a prompt nor steps), so null here is a broken pipeline
    // invariant, not a request to skip — and it must not leave registered gates behind.
    const gateContext = this.enhancementService.resolveGateContext(context);
    if (gateContext === null) {
      throw new Error(
        'Gate enhancement reached a parsed command with neither a converted prompt nor chain steps - PlanningStage should have rejected it'
      );
    }

    const frameworkGateIds = await this.enhancementService.loadFrameworkGateIds();
    const registeredGates = await this.registrar.registerTemporaryGates(context);

    // ADR 0001 (d) ships inline gate execution in two releases. Both the enablement check and
    // the single-vs-chain prompt walk live in services, so this stage adds no branches of its
    // own — it stays a thin orchestrator.
    const executeDefinitions = gatesConfig?.executeInlineGateDefinitions === true;
    const inlineRemap = new Map<string, string>();
    const inlineDefinitionGateIds = this.registrar.registerInlineGateDefinitions(
      context,
      inlineDefinitionCarriers(gateContext),
      executeDefinitions,
      inlineRemap
    );
    // A chain prompt's own definitions bind the steps that name them (P6.158).
    const stepDefinitionIds = this.registrar.registerStepGateDefinitions(
      context,
      this.enhancementService.chainStepGateDefinitions(gateContext),
      executeDefinitions,
      inlineRemap
    );
    await this.remapInlineDefinitions(context, inlineRemap);

    if (gateContext.type === 'chain') {
      await this.enhancementService.enhanceChainSteps(
        { ...gateContext, stepDefinitionIds },
        context,
        registeredGates,
        gatesConfig,
        frameworkGateIds,
        inlineDefinitionGateIds
      );
      return;
    }

    await this.enhancementService.enhanceSinglePrompt(
      gateContext,
      context,
      registeredGates,
      gatesConfig,
      frameworkGateIds,
      inlineDefinitionGateIds
    );
  }

  /**
   * The step every gate-withholding switch shares: skip a call that requested no gate, refuse one
   * that did. Stage 05 refuses the second for every switch it can read, so a refusal here means a
   * switch decided after it (the planner's script-tool `%clean`) — and a script may have run.
   */
  private skipOrRefuse(context: ExecutionContext, suppression: GateSuppression): void {
    const requested = callerRequestedGates(this.registrar, context);
    if (requested.length === 0) {
      this.logExit({ skipped: SKIP_REASONS[suppression.kind] });
      return;
    }
    context.diagnostics.warn(this.name, 'Requested gate refused: gates withheld', {
      suppression: suppression.kind,
      count: requested.length,
    });
    context.setResponse(
      buildWorkflowRejectionResponse(
        [gateSuppressionRejection(suppression, requested)],
        context.state.session.resumeChainId
      )
    );
    this.logExit({ refusedSuppressedGates: requested.length });
  }
}
