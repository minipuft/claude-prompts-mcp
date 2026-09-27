// @lifecycle canonical - Enriches prompts with gate instructions prior to execution.
import { inlineDefinitionCarriers } from '../../../gates/services/gate-enhancement-service.js';
import { BasePipelineStage } from '../stage.js';
import { buildWorkflowRejectionResponse } from '../workflow-rejection-response.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateSystemSettings } from '#shared/types/index.js';
import type { GateEnhancementService } from '../../../gates/services/gate-enhancement-service.js';
import type { TemporaryGateRegistrar } from '../../../gates/services/temporary-gate-registrar.js';
import type { ExecutionContext } from '../../context/index.js';

type GateSystemSettingsProvider = () => GateSystemSettings | undefined;

/**
 * Pipeline Stage 11: Gate Enhancement
 *
 * Thin orchestrator that delegates gate enrichment logic to domain services.
 *
 * Dependencies: context.executionPlan, context.convertedPrompt or context.parsedCommand.steps
 * Output: Enhanced prompts with gate instructions, context.activeGateIds
 * Can Early Exit: Yes (a request gate targeting a step a resume can no longer reach, R65)
 */
export class GateEnhancementStage extends BasePipelineStage {
  readonly name = 'GateEnhancement';

  constructor(
    private readonly enhancementService: GateEnhancementService,
    private readonly registrar: TemporaryGateRegistrar,
    private readonly gatesConfigProvider: GateSystemSettingsProvider | undefined,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (!this.enhancementService.isAvailable()) {
      this.logExit({ skipped: 'Gate service unavailable' });
      return;
    }

    const gatesConfig = this.gatesConfigProvider?.();
    if (gatesConfig?.enabled === false) {
      this.logExit({ skipped: 'Gate system disabled by configuration' });
      return;
    }

    const executionPlan = context.executionPlan;
    if (executionPlan === undefined) {
      this.logExit({ skipped: 'Execution plan missing' });
      return;
    }

    if (this.enhancementService.shouldSkip(executionPlan.modifiers)) {
      this.logExit({ skipped: 'Gate enhancement disabled by execution modifier' });
      return;
    }

    // R65: a resume's request gate targeting a step it can no longer reach is refused here, before
    // any registration, in stage 04's rejection shape — the registrar alone knows the run's
    // position and the gates it holds.
    const unreachable = this.registrar.unreachableStepTargets(context);
    if (unreachable.length > 0) {
      context.diagnostics.warn(this.name, 'Gate target refused', { count: unreachable.length });
      context.setResponse(
        buildWorkflowRejectionResponse(
          unreachable.map((refusal) => ({ reason: 'gate-target-passed', ...refusal }))
        )
      );
      this.logExit({ refusedGateTargets: unreachable.length });
      return;
    }

    const frameworkGateIds = await this.enhancementService.loadFrameworkGateIds();
    const registeredGates = await this.registrar.registerTemporaryGates(context);

    const gateContext = this.enhancementService.resolveGateContext(context);
    if (gateContext === null) {
      this.logExit({ skipped: 'Unsupported execution context' });
      return;
    }

    // ADR 0001 (d) ships inline gate execution in two releases. Both the enablement check and
    // the single-vs-chain prompt walk live in services, so this stage adds no branches of its
    // own — it stays a thin orchestrator.
    const executeDefinitions = gatesConfig?.executeInlineGateDefinitions === true;
    const inlineDefinitionGateIds = this.registrar.registerInlineGateDefinitions(
      context,
      inlineDefinitionCarriers(gateContext),
      executeDefinitions
    );
    // A chain prompt's own definitions bind the steps that name them (P6.158).
    const stepDefinitionIds = this.registrar.registerStepGateDefinitions(
      context,
      this.enhancementService.chainStepGateDefinitions(gateContext),
      executeDefinitions
    );

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
}
