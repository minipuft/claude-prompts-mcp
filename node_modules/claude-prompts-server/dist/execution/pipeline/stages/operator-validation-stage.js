import { BasePipelineStage } from '../stage.js';
/**
 * Stage 3: Operator validation/normalization.
 *
 * Ensures symbolic operators are validated after parsing so later stages and
 * executors operate on normalized data (especially framework overrides).
 */
export class OperatorValidationStage extends BasePipelineStage {
    constructor(frameworkValidator, logger) {
        super(logger);
        this.frameworkValidator = frameworkValidator;
        this.name = 'OperatorValidation';
    }
    async execute(context) {
        this.logEntry(context);
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
            const normalizedFrameworkOperators = this.normalizeFrameworkOperators(parsedCommand, operatorSet);
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
        }
        catch (error) {
            this.handleError(error, 'Operator validation failed');
        }
    }
    normalizeFrameworkOperators(parsedCommand, operators) {
        let normalizedCount = 0;
        for (const operator of operators) {
            if (operator.type !== 'framework') {
                continue;
            }
            const { normalizedId } = this.frameworkValidator.validateAndNormalize(operator.frameworkId, {
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
                const matches = symbolicPlan.frameworkOverride.toUpperCase() === operator.frameworkId.toUpperCase();
                if (matches) {
                    symbolicPlan.frameworkOverride = normalizedId;
                }
            }
        }
        return normalizedCount;
    }
}
//# sourceMappingURL=operator-validation-stage.js.map