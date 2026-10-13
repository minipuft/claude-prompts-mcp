// @lifecycle canonical - Enriches prompts with gate instructions prior to execution.
import { inlineDefinitionCarriers } from '../../../gates/services/gate-enhancement-service.js';
import {
  gateSuppressionRefusalDetail,
  requestedGateAddresses,
  suppressingModifier,
} from '../../../gates/services/gate-suppression-refusal.js';
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

/**
 * Pipeline Stage 11: Gate Enhancement
 *
 * Thin orchestrator that delegates gate enrichment logic to domain services.
 *
 * Dependencies: context.executionPlan, context.convertedPrompt or context.parsedCommand.steps
 * Output: Enhanced prompts with gate instructions, context.activeGateIds
 * Can Early Exit: Yes (a request gate that cannot register as sent, R11.8, targeting a step a
 * resume can no longer reach, R65, or carrying a canonical gate's id, R100; a gate the call
 * requested while `%clean`, `%framework` or a gate switch withholds every gate, R11.8)
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

    // Each switch below withholds every gate. A call that requested none skips; one that requested
    // a gate is refused, naming the switch and the gates, rather than run without them (R11.8).
    const gatesConfig = this.gatesConfigProvider();
    if (gatesConfig?.enabled === false) {
      this.skipOrRefuse(context, { kind: 'config' }, 'Gate system disabled by configuration');
      return;
    }

    // The runtime switch too, for this request's scope. Reading only the config flag let a chain
    // started with the switch off select its gates anyway: stage 13 opened a review on its first
    // step and asked for a `gate_verdict` the tool refuses while the switch is off, so no answer
    // could ever move the run (P6.292).
    if (!this.gateSystemEnabled(context.getScopeOptions())) {
      this.skipOrRefuse(context, { kind: 'runtime' }, 'Gate system disabled at runtime');
      return;
    }

    const executionPlan = context.requireExecutionPlan();

    const modifier = suppressingModifier(executionPlan.modifiers);
    if (modifier !== undefined) {
      this.skipOrRefuse(
        context,
        { kind: 'modifier', modifier },
        'Gate enhancement disabled by execution modifier'
      );
      return;
    }

    // R65: a resume's request gate targeting a step it can no longer reach is refused here, before
    // any registration, in stage 04's rejection shape — the registrar alone knows the run's
    // position and the gates it holds. R100: so is a request gate under a canonical gate's id.
    // R11.8: so is one that cannot register as sent (blank, or a bare id naming no gate).
    const refused = [
      ...(await this.registrar.invalidRequestGates(context)).map((refusal) => ({
        reason: 'gate-criteria-invalid' as const,
        ...refusal,
      })),
      ...this.registrar
        .canonicalIdCollisions(context)
        .map((refusal) => ({ reason: 'gate-id-canonical' as const, ...refusal })),
      ...this.registrar
        .unreachableStepTargets(context)
        .map((refusal) => ({ reason: 'gate-target-passed' as const, ...refusal })),
    ];
    if (refused.length > 0) {
      context.diagnostics.warn(this.name, 'Request gate refused', { count: refused.length });
      context.setResponse(
        buildWorkflowRejectionResponse(refused, context.state.session.resumeChainId)
      );
      this.logExit({ refusedRequestGates: refused.length });
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
   * that did. Only the call's own gates count — its request gates, the `::` operators of the command
   * it sent (a resume sends none), and its workflow's node gates — never a prompt author's.
   */
  private skipOrRefuse(
    context: ExecutionContext,
    suppression: GateSuppression,
    skip: string
  ): void {
    const requested = requestedGateAddresses({
      requestGates: this.registrar.ownRequestGates(context),
      commandOperators: context.state.session.isBlueprintRestored
        ? undefined
        : context.parsedCommand?.operators?.operators,
      workflowNodes: context.mcpRequest.workflow?.nodes,
    });
    if (requested.length === 0) {
      this.logExit({ skipped: skip });
      return;
    }
    context.diagnostics.warn(this.name, 'Requested gate refused: gates withheld', {
      suppression: suppression.kind,
      count: requested.length,
    });
    context.setResponse(
      buildWorkflowRejectionResponse(
        [
          {
            reason: 'gate-suppressed',
            detail: gateSuppressionRefusalDetail(suppression, requested),
          },
        ],
        context.state.session.resumeChainId
      )
    );
    this.logExit({ refusedSuppressedGates: requested.length });
  }
}
