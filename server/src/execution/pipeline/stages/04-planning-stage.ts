// @lifecycle canonical - Creates execution plans and resolves dependencies.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ExecutionPlanner } from '../../planning/execution-planner.js';

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

    if (context.metadata['sessionBlueprintRestored']) {
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
      executionMode: context.getExecutionMode(),
      frameworkEnabled: this.frameworkEnabled?.() ?? false,
      gateOverrides: this.buildGateOverrides(context),
    });

    context.executionPlan = plan;

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
      executionMode: context.getExecutionMode(),
      frameworkEnabled: this.frameworkEnabled?.() ?? false,
      gateOverrides,
    });

    const aggregatedGates = new Set(chainPlan.gates ?? []);
    let requiresFramework = chainPlan.requiresFramework;
    let apiValidationEnabled = Boolean(chainPlan.apiValidationEnabled);

    stepPlans.forEach((plan, index) => {
      if (steps[index]) {
        steps[index].executionPlan = plan;
      }

      for (const gateId of plan.gates ?? []) {
        aggregatedGates.add(gateId);
      }

      requiresFramework = requiresFramework || plan.requiresFramework;
      apiValidationEnabled = apiValidationEnabled || Boolean(plan.apiValidationEnabled);
    });

    context.executionPlan = {
      ...chainPlan,
      strategy: 'chain',
      gates: Array.from(aggregatedGates),
      requiresFramework,
      requiresSession: true,
      apiValidationEnabled,
    };

    this.logExit({
      strategy: 'chain',
      stepsPlanned: stepPlans.length,
      gateCount: aggregatedGates.size,
      requiresFramework,
    });
  }

  private buildGateOverrides(context: ExecutionContext) {
    return {
      apiValidation: context.mcpRequest.api_validation,
      qualityGates: context.mcpRequest.quality_gates
        ? Array.from(context.mcpRequest.quality_gates)
        : undefined,
      customChecks: context.mcpRequest.custom_checks
        ? context.mcpRequest.custom_checks.map((check) => ({
            name: check.name,
            description: check.description,
          }))
        : undefined,
    };
  }
}
