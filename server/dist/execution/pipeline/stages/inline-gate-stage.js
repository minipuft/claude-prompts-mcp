import { BasePipelineStage } from '../stage.js';
/**
 * Type guard for validating gate criteria
 */
function isValidGateCriteria(criteria) {
    return Array.isArray(criteria) &&
        criteria.length > 0 &&
        criteria.every(item => typeof item === 'string' && item.trim().length > 0);
}
/**
 * Type guard for validating step has inline gate criteria
 */
function hasInlineGateCriteria(step) {
    return isValidGateCriteria(step.inlineGateCriteria);
}
export class InlineGateExtractionStage extends BasePipelineStage {
    constructor(temporaryGateRegistry, logger) {
        super(logger);
        this.temporaryGateRegistry = temporaryGateRegistry;
        this.name = 'InlineGateExtraction';
    }
    async execute(context) {
        this.logEntry(context);
        const parsedCommand = context.parsedCommand;
        if (!parsedCommand) {
            this.logExit({ skipped: 'Parsed command missing' });
            return;
        }
        const createdIds = [];
        // Validate and create inline gate for the main command
        if (isValidGateCriteria(parsedCommand.inlineGateCriteria)) {
            const gateId = this.createInlineGate(context, parsedCommand.inlineGateCriteria, {
                promptId: parsedCommand.promptId,
            });
            if (gateId) {
                parsedCommand.inlineGateIds = [gateId];
                createdIds.push(gateId);
            }
        }
        // Validate and create inline gates for chain steps
        if (Array.isArray(parsedCommand.steps) && parsedCommand.steps.length > 0) {
            for (const step of parsedCommand.steps) {
                if (hasInlineGateCriteria(step)) {
                    const stepGateId = this.registerStepInlineGate(context, step);
                    if (stepGateId) {
                        createdIds.push(stepGateId);
                    }
                }
            }
        }
        // Track created gate IDs in context metadata
        if (createdIds.length > 0) {
            const existing = Array.isArray(context.metadata.temporaryGateIds)
                ? context.metadata.temporaryGateIds
                : [];
            context.metadata.temporaryGateIds = [...existing, ...createdIds];
        }
        this.logExit({
            registeredInlineGates: createdIds.length,
        });
    }
    registerStepInlineGate(context, step) {
        const gateId = this.createInlineGate(context, step.inlineGateCriteria, {
            promptId: step.promptId,
            stepNumber: step.stepNumber,
        });
        if (!gateId) {
            return null;
        }
        step.inlineGateIds = [...(step.inlineGateIds ?? []), gateId];
        return gateId;
    }
    createInlineGate(context, criteria, scope) {
        // Validate criteria using type guard
        if (!isValidGateCriteria(criteria)) {
            this.logger.warn('[InlineGateExtractionStage] Invalid gate criteria', {
                criteria,
                scope,
            });
            return null;
        }
        const guidance = this.generateGuidance(criteria);
        const description = scope.stepNumber
            ? `Inline criteria for step ${scope.stepNumber}`
            : 'Inline criteria for symbolic command';
        // Determine scope based on step number
        const gateScope = scope.stepNumber !== undefined ? 'step' : 'execution';
        const scopeId = this.getScopeId(context, scope.stepNumber);
        try {
            return this.temporaryGateRegistry.createTemporaryGate({
                name: 'Inline Quality Criteria',
                type: 'quality',
                scope: gateScope,
                description,
                guidance,
                pass_criteria: [...criteria], // Convert readonly to mutable for compatibility
                source: 'automatic',
            }, scopeId);
        }
        catch (error) {
            this.logger.warn('[InlineGateExtractionStage] Failed to register inline gate', {
                error,
                criteria,
                scope,
            });
            return null;
        }
    }
    getScopeId(context, stepNumber) {
        const baseScope = context.getSessionId?.() ||
            context.mcpRequest.session_id ||
            context.mcpRequest.command ||
            'execution';
        if (typeof stepNumber === 'number') {
            return `${baseScope}:step_${stepNumber}`;
        }
        return `${baseScope}:command`;
    }
    generateGuidance(criteria) {
        if (criteria.length === 0) {
            return 'Evaluate the output against the inline criteria.';
        }
        const lines = [
            'Evaluate the output against these criteria:',
            ...criteria.map((item, index) => `${index + 1}. ${item}`),
        ];
        return lines.join('\n');
    }
}
//# sourceMappingURL=inline-gate-stage.js.map