// @lifecycle canonical - Validates operator metadata and arguments.
import { BasePipelineStage } from '../stage.js';

import type { FrameworkValidator } from '../../../frameworks/framework-validator.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { FrameworkOperator, SymbolicOperator } from '../../parsers/types/operator-types.js';

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
        context.metadata = {
          ...context.metadata,
          operatorValidation: {
            normalizedFrameworkOperators,
            lastValidatedAt: new Date().toISOString(),
          },
        };
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
}
