// @lifecycle canonical - Creates execution plans and resolves dependencies.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ExecutionPlanner } from '../../planning/execution-planner.js';
import type { ExecutionPlan } from '../../types.js';

type FrameworkEnabledProvider = () => boolean;

/**
 * Pipeline Stage 4: Execution Planning
 *
 * Determines execution strategy (prompt/chain/workflow), identifies required gates,
 * and plans session requirements based on command structure.
 *
 * Dependencies: context.parsedCommand, context.convertedPrompt
 * Output: context.executionPlan (strategy, gates, session requirements)
 * Can Early Exit: No
 */
export class ExecutionPlanningStage extends BasePipelineStage {
  readonly name = 'ExecutionPlanning';

  constructor(
    private readonly executionPlanner: ExecutionPlanner,
    private readonly frameworkEnabled: FrameworkEnabledProvider | null,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.state.session.isBlueprintRestored) {
      this.logExit({ skipped: 'Session blueprint restored' });
      return;
    }

    const parsedCommand = context.parsedCommand;
    if (!parsedCommand?.convertedPrompt && !parsedCommand?.steps?.length) {
      this.handleError(new Error('Parsed command requires either convertedPrompt or steps.'));
    }

    try {
      if (context.hasChainCommand()) {
        await this.planChainExecution(context);
        return;
      }

      await this.planSinglePromptExecution(context);
    } catch (error) {
      this.handleError(error, 'Execution planning failed');
    }
  }

  private async planSinglePromptExecution(context: ExecutionContext): Promise<void> {
    const parsedCommand = context.requireParsedCommand();
    const convertedPrompt = context.requireConvertedPrompt();

    const plan = await this.executionPlanner.createPlan({
      parsedCommand,
      convertedPrompt,
      frameworkEnabled: this.frameworkEnabled?.() ?? false,
      gateOverrides: this.buildGateOverrides(context),
    });

    context.executionPlan = plan;

    // Note: semanticAnalysis is stored in context.executionPlan.semanticAnalysis
    // No need to duplicate in metadata - downstream stages read from executionPlan directly

    // Record diagnostic for execution plan creation
    context.diagnostics.info(this.name, 'Execution plan created for single prompt', {
      strategy: plan.strategy,
      gateCount: plan.gates.length,
      requiresFramework: plan.requiresFramework,
      requiresSession: plan.requiresSession,
      promptId: convertedPrompt.id,
    });

    this.logExit({
      strategy: plan.strategy,
      gateCount: plan.gates.length,
    });
  }

  private async planChainExecution(context: ExecutionContext): Promise<void> {
    const parsedCommand = context.requireParsedCommand();
    const steps = context.requireChainSteps();
    const gateOverrides = this.buildGateOverrides(context);
    const { chainPlan, stepPlans } = await this.executionPlanner.createChainPlan({
      parsedCommand,
      steps,
      frameworkEnabled: this.frameworkEnabled?.() ?? false,
      gateOverrides,
    });

    const aggregatedGates = new Set(chainPlan.gates ?? []);
    let requiresFramework = chainPlan.requiresFramework;

    stepPlans.forEach((plan, index) => {
      if (steps[index]) {
        steps[index].executionPlan = plan;
      }

      for (const gateId of plan.gates ?? []) {
        aggregatedGates.add(gateId);
      }

      requiresFramework = requiresFramework || plan.requiresFramework;
    });

    const executionPlan: ExecutionPlan = {
      ...chainPlan,
      strategy: 'chain',
      gates: Array.from(aggregatedGates),
      requiresFramework,
      requiresSession: true,
    };

    if (chainPlan.modifiers !== undefined) {
      executionPlan.modifiers = chainPlan.modifiers;
    }

    context.executionPlan = executionPlan;

    // Record diagnostic for chain execution plan creation
    context.diagnostics.info(this.name, 'Execution plan created for chain', {
      strategy: 'chain',
      stepCount: stepPlans.length,
      gateCount: aggregatedGates.size,
      requiresFramework,
      stepIds: steps.map((s) => s.promptId),
    });

    this.logExit({
      strategy: 'chain',
      stepsPlanned: stepPlans.length,
      gateCount: aggregatedGates.size,
      requiresFramework,
    });
  }

  /**
   * Build gate overrides from normalized gates in metadata.
   * Uses unified 'gates' parameter (already normalized from legacy parameters).
   */
  private buildGateOverrides(context: ExecutionContext) {
    const overrides = context.state.gates.requestedOverrides as Record<string, any> | undefined;

    return {
      gates: overrides?.['gates'] ?? context.mcpRequest.gates,
    };
  }
}
