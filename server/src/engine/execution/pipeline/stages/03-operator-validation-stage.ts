// @lifecycle canonical - Validates operator metadata and arguments.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { FrameworkValidator } from '../../../frameworks/framework-validator.js';
import type { ExecutionContext } from '../../context/index.js';
import type { ChainStepPrompt } from '../../operators/types.js';
import type { ChainOperator, SymbolicOperator } from '../../parsers/types/operator-types.js';

/**
 * Pipeline Stage 3: Operator Validation
 *
 * Validates and normalizes symbolic operators from parsed commands,
 * ensuring framework overrides are valid before execution planning.
 *
 * Dependencies: context.parsedCommand, context.parsedCommand.operators
 * Output: Validated operators (framework names normalized)
 * Can Early Exit: No
 */
export class OperatorValidationStage extends BasePipelineStage {
  readonly name = 'OperatorValidation';

  constructor(
    private readonly frameworkValidator: FrameworkValidator | null,
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
    if (!parsedCommand) {
      this.logExit({ skipped: 'Parsed command missing' });
      return;
    }

    const operatorSet = parsedCommand?.operators?.operators;

    if (!Array.isArray(operatorSet) || operatorSet.length === 0) {
      this.logExit({ skipped: 'No operators detected' });
      return;
    }

    // Prompt-level delegation:true → mark all chain steps as delegated
    // Runs regardless of framework validator availability
    this.normalizeDelegation(parsedCommand, operatorSet);

    if (!this.frameworkValidator) {
      this.logExit({ skipped: 'Framework validator unavailable' });
      return;
    }

    try {
      const normalizedFrameworkOperators = this.normalizeFrameworkOperators(
        parsedCommand,
        operatorSet
      );

      if (normalizedFrameworkOperators > 0) {
        // Diagnostic only — nothing downstream branches on this count.
        context.diagnostics.debug(this.name, 'Normalized framework operators', {
          normalizedFrameworkOperators,
        });
      }

      this.logExit({ normalizedFrameworkOperators });
    } catch (error) {
      this.handleError(error, 'Operator validation failed');
    }
  }

  private normalizeFrameworkOperators(
    parsedCommand: ExecutionContext['parsedCommand'],
    operators: SymbolicOperator[]
  ): number {
    let normalizedCount = 0;

    for (const operator of operators) {
      if (operator.type !== 'framework') {
        continue;
      }

      const { normalizedId } = this.frameworkValidator!.validateAndNormalize(operator.frameworkId, {
        requireEnabled: true,
        stage: this.name,
        context: {
          action: 'operator_validation',
          userInput: { frameworkId: operator.frameworkId },
        },
      });

      operator.normalizedId = normalizedId;
      normalizedCount++;

      const symbolicPlan = parsedCommand?.executionPlan;
      if (symbolicPlan?.frameworkOverride) {
        const matches =
          symbolicPlan.frameworkOverride.toUpperCase() === operator.frameworkId.toUpperCase();

        if (matches) {
          symbolicPlan.frameworkOverride = normalizedId;
        }
      }
    }

    return normalizedCount;
  }

  /**
   * Normalize delegation flags on chain steps.
   *
   * Two sources of delegation:
   * 1. Prompt-level `delegation: true` → all steps become delegated
   * 2. Per-step `subagentModel` → that step becomes delegated (implies sub-agent execution)
   *
   * Propagates to both parsedCommand.steps (ChainStepPrompt) and operator steps (ChainStep).
   */
  private normalizeDelegation(
    parsedCommand: ExecutionContext['parsedCommand'],
    operators: SymbolicOperator[]
  ): void {
    const promptWide = parsedCommand?.convertedPrompt?.delegation === true;

    this.markDelegatedStepPrompts(parsedCommand, promptWide);
    this.syncDelegationToOperators(parsedCommand, operators, promptWide);
  }

  /** Mark ChainStepPrompt[] entries as delegated based on prompt-level or per-step subagentModel. */
  private markDelegatedStepPrompts(
    parsedCommand: ExecutionContext['parsedCommand'],
    promptWide: boolean
  ): void {
    if (parsedCommand?.steps == null) return;
    for (const step of parsedCommand.steps) {
      if (promptWide || step.subagentModel != null) {
        step.delegated = true;
      }
    }
  }

  /** Propagate delegation from ChainStepPrompt[] to positionally-aligned operator ChainStep[]. */
  private syncDelegationToOperators(
    parsedCommand: ExecutionContext['parsedCommand'],
    operators: SymbolicOperator[],
    promptWide: boolean
  ): void {
    const stepPrompts = parsedCommand?.steps;
    for (const operator of operators) {
      if (operator.type !== 'chain') continue;
      this.applyDelegationToChainOp(operator, stepPrompts, promptWide);
    }
  }

  private applyDelegationToChainOp(
    operator: ChainOperator,
    stepPrompts: ChainStepPrompt[] | undefined,
    promptWide: boolean
  ): void {
    for (let i = 0; i < operator.steps.length; i++) {
      const step = operator.steps[i];
      if (!step) continue;
      if (promptWide || stepPrompts?.[i]?.delegated === true) {
        step.delegated = true;
      }
    }
    if (operator.steps.some((s) => s.delegated === true)) {
      operator.hasDelegation = true;
    }
  }
}
