// @lifecycle canonical - Enriches prompts with gate instructions prior to execution.
import { inlineDefinitionCarriers } from '../../../gates/services/gate-enhancement-service.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../../infra/logging/index.js';
import type { GateEnhancementService } from '../../../gates/services/gate-enhancement-service.js';
import type { TemporaryGateRegistrar } from '../../../gates/services/temporary-gate-registrar.js';
import type { GatesConfig } from '../../../gates/types.js';
import type { ExecutionContext } from '../../context/index.js';

type GatesConfigProvider = () => GatesConfig | undefined;

/**
 * Pipeline Stage 5: Gate Enhancement
 *
 * Thin orchestrator that delegates gate enrichment logic to domain services.
 *
 * Dependencies: context.executionPlan, context.convertedPrompt or context.parsedCommand.steps
 * Output: Enhanced prompts with gate instructions, context.activeGateIds
 * Can Early Exit: No
 */
export class GateEnhancementStage extends BasePipelineStage {
  readonly name = 'GateEnhancement';

  constructor(
    private readonly enhancementService: GateEnhancementService,
    private readonly registrar: TemporaryGateRegistrar,
    private readonly gatesConfigProvider: GatesConfigProvider | undefined,
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

    const methodologyGates = await this.enhancementService.loadFrameworkGateIds();
    const registeredGates = await this.registrar.registerTemporaryGates(context);

    const gateContext = this.enhancementService.resolveGateContext(context);
    if (gateContext === null) {
      this.logExit({ skipped: 'Unsupported execution context' });
      return;
    }

    // ADR 0001 (d) ships inline gate execution in two releases. Both the enablement check and
    // the single-vs-chain prompt walk live in services, so this stage adds no branches of its
    // own — it stays a thin orchestrator.
    const inlineDefinitionGateIds = this.registrar.registerInlineGateDefinitions(
      context,
      inlineDefinitionCarriers(gateContext),
      gatesConfig?.executeInlineGateDefinitions === true
    );

    if (gateContext.type === 'chain') {
      await this.enhancementService.enhanceChainSteps(
        gateContext,
        context,
        registeredGates,
        gatesConfig,
        methodologyGates,
        inlineDefinitionGateIds
      );
      return;
    }

    await this.enhancementService.enhanceSinglePrompt(
      gateContext,
      context,
      registeredGates,
      gatesConfig,
      methodologyGates,
      inlineDefinitionGateIds
    );
  }
}
