// @lifecycle canonical - Evaluates inline gates before heavy execution work.
import { formatCriteriaAsGuidance } from '../criteria-guidance.js';
import { BasePipelineStage } from '../stage.js';
/**
 * Type guard for validating gate criteria
 */
function isValidGateCriteria(criteria) {
    return (Array.isArray(criteria) &&
        criteria.length > 0 &&
        criteria.every((item) => typeof item === 'string' && item.trim().length > 0));
}
/**
 * Type guard for validating step has inline gate criteria
 */
function hasInlineGateCriteria(step) {
    return isValidGateCriteria(step.inlineGateCriteria);
}
export class InlineGateExtractionStage extends BasePipelineStage {
    constructor(temporaryGateRegistry, gateReferenceResolver, logger) {
        super(logger);
        this.temporaryGateRegistry = temporaryGateRegistry;
        this.gateReferenceResolver = gateReferenceResolver;
        this.name = 'InlineGateExtraction';
    }
    async execute(context) {
        this.logEntry(context);
        if (context.state.session.isBlueprintRestored) {
            this.logExit({ skipped: 'Session blueprint restored' });
            return;
        }
        // Stage 02 focuses on inline gate extraction from :: operator
        // Temporary gates from 'gates' parameter are handled by Stage 05 (GateEnhancementStage)
        // which has comprehensive canonical resolution and normalization
        const parsedCommand = context.parsedCommand;
        if (!parsedCommand) {
            this.logExit({ skipped: 'Parsed command missing' });
            return;
        }
        const createdIds = [];
        const registeredIds = [];
        // Process named inline gates (e.g., `:: security:"no secrets"`)
        // These have explicit IDs from the symbolic parser
        if (Array.isArray(parsedCommand.namedInlineGates) &&
            parsedCommand.namedInlineGates.length > 0) {
            for (const namedGate of parsedCommand.namedInlineGates) {
                if (namedGate.gateId && isValidGateCriteria(namedGate.criteria)) {
                    const gateId = this.createNamedInlineGate(context, namedGate.gateId, namedGate.criteria, {
                        promptId: parsedCommand.promptId,
                    });
                    if (gateId) {
                        parsedCommand.inlineGateIds = this.appendGateId(parsedCommand.inlineGateIds, gateId);
                        createdIds.push(gateId);
                    }
                }
            }
        }
        // Validate and create inline gate for the main command (anonymous criteria)
        if (isValidGateCriteria(parsedCommand.inlineGateCriteria)) {
            const result = await this.applyGateCriteria(context, parsedCommand.inlineGateCriteria, {
                promptId: parsedCommand.promptId,
            });
            this.applyGateResult(parsedCommand, result, createdIds, registeredIds);
        }
        // Validate and create inline gates for chain steps
        if (Array.isArray(parsedCommand.steps) && parsedCommand.steps.length > 0) {
            for (const step of parsedCommand.steps) {
                if (hasInlineGateCriteria(step)) {
                    const result = await this.applyGateCriteria(context, step.inlineGateCriteria, {
                        promptId: step.promptId,
                        stepNumber: step.stepNumber,
                    });
                    this.applyGateResult(step, result, createdIds, registeredIds);
                }
            }
        }
        if (createdIds.length > 0) {
            const existing = context.state.gates.temporaryGateIds ?? [];
            context.state.gates.temporaryGateIds = Array.from(new Set([...existing, ...createdIds]));
        }
        if (registeredIds.length > 0) {
            const existing = context.state.gates.registeredInlineGateIds ?? [];
            context.state.gates.registeredInlineGateIds = Array.from(new Set([...existing, ...registeredIds]));
        }
        this.logExit({
            temporaryInlineGates: createdIds.length,
            namedInlineGates: parsedCommand.namedInlineGates?.length ?? 0,
            registeredInlineGates: registeredIds.length,
        });
    }
    async applyGateCriteria(context, criteria, scope) {
        const partitioned = await this.partitionGateCriteria(criteria);
        let temporaryGateId;
        if (partitioned.inlineCriteria.length > 0) {
            const gateId = this.createInlineGate(context, partitioned.inlineCriteria, scope);
            if (gateId) {
                temporaryGateId = gateId;
            }
        }
        if (temporaryGateId !== undefined) {
            return {
                registeredGateIds: partitioned.registeredGateIds,
                temporaryGateId,
            };
        }
        return {
            registeredGateIds: partitioned.registeredGateIds,
        };
    }
    applyGateResult(target, result, createdIds, registeredIds) {
        for (const gateId of result.registeredGateIds) {
            target.inlineGateIds = this.appendGateId(target.inlineGateIds, gateId);
            registeredIds.push(gateId);
        }
        if (result.temporaryGateId) {
            target.inlineGateIds = this.appendGateId(target.inlineGateIds, result.temporaryGateId);
            createdIds.push(result.temporaryGateId);
        }
    }
    appendGateId(existing, gateId) {
        if (!gateId) {
            return existing ?? [];
        }
        if (!Array.isArray(existing)) {
            return [gateId];
        }
        if (existing.includes(gateId)) {
            return existing;
        }
        return [...existing, gateId];
    }
    /**
     * Creates an inline gate with auto-generated ID for anonymous criteria.
     */
    createInlineGate(context, criteria, scope) {
        // Validate criteria using type guard
        if (!isValidGateCriteria(criteria)) {
            this.logger.warn('[InlineGateExtractionStage] Invalid gate criteria', {
                criteria,
                scope,
            });
            return null;
        }
        const guidance = formatCriteriaAsGuidance(criteria);
        const description = scope.stepNumber
            ? `Inline criteria for step ${scope.stepNumber}`
            : 'Inline criteria for symbolic command';
        // Determine scope based on step number
        const gateScope = scope.stepNumber !== undefined ? 'step' : 'execution';
        const scopeId = this.getScopeId(context, scope.stepNumber);
        try {
            const gateId = this.temporaryGateRegistry.createTemporaryGate({
                name: 'Inline Validation Criteria',
                type: 'validation',
                scope: gateScope,
                description,
                guidance,
                pass_criteria: [...criteria], // Convert readonly to mutable for compatibility
                source: 'automatic',
            }, scopeId);
            this.trackTemporaryGateScope(context, gateScope, scopeId);
            return gateId;
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
    /**
     * Creates a named inline gate with explicit ID from symbolic syntax.
     * Name is derived from ID for display (e.g., "security" displays as "security").
     */
    createNamedInlineGate(context, explicitId, criteria, scope) {
        if (!explicitId || !isValidGateCriteria(criteria)) {
            this.logger.warn('[InlineGateExtractionStage] Invalid named gate input', {
                explicitId,
                criteria,
                scope,
            });
            return null;
        }
        const guidance = formatCriteriaAsGuidance(criteria);
        const description = `Named inline gate "${explicitId}" from symbolic syntax`;
        const gateScope = scope.stepNumber !== undefined ? 'step' : 'execution';
        const scopeId = this.getScopeId(context, scope.stepNumber);
        try {
            // Pass explicit ID - registry will use it as-is if valid
            const gateId = this.temporaryGateRegistry.createTemporaryGate({
                id: explicitId, // Explicit ID from symbolic syntax
                name: explicitId, // Use ID as display name (will be enhanced by Stage 05 normalization)
                type: 'validation',
                scope: gateScope,
                description,
                guidance,
                pass_criteria: [...criteria],
                source: 'automatic',
            }, // Cast needed because facade type doesn't include optional id
            scopeId);
            this.logger.debug('[InlineGateExtractionStage] Created named inline gate', {
                requestedId: explicitId,
                actualId: gateId,
                criteria,
            });
            this.trackTemporaryGateScope(context, gateScope, scopeId);
            return gateId;
        }
        catch (error) {
            this.logger.warn('[InlineGateExtractionStage] Failed to create named inline gate', {
                error,
                explicitId,
                criteria,
                scope,
            });
            return null;
        }
    }
    async partitionGateCriteria(criteria) {
        const inlineCriteria = [];
        const registeredGateIds = [];
        for (const entry of criteria) {
            const trimmed = typeof entry === 'string' ? entry.trim() : '';
            if (!trimmed) {
                continue;
            }
            const registryGateId = this.lookupTemporaryGateId(trimmed);
            if (registryGateId) {
                registeredGateIds.push(registryGateId);
                continue;
            }
            try {
                const resolution = await this.gateReferenceResolver.resolve(trimmed);
                this.applyResolution(resolution, inlineCriteria, registeredGateIds);
            }
            catch (error) {
                this.logger.warn('[InlineGateExtractionStage] Failed to resolve gate reference', {
                    entry: trimmed,
                    error,
                });
                inlineCriteria.push(trimmed);
            }
        }
        return {
            inlineCriteria,
            registeredGateIds: Array.from(new Set(registeredGateIds)),
        };
    }
    lookupTemporaryGateId(reference) {
        if (!reference || !this.temporaryGateRegistry) {
            return undefined;
        }
        const gate = this.temporaryGateRegistry.getTemporaryGate(reference);
        if (gate) {
            this.logger.debug('[InlineGateExtractionStage] Resolved inline reference to temporary gate', {
                reference,
                gateId: gate.id,
            });
            return gate.id;
        }
        return undefined;
    }
    applyResolution(resolution, inlineCriteria, registeredGateIds) {
        if (resolution.referenceType === 'registered') {
            registeredGateIds.push(resolution.gateId);
            return;
        }
        // Log fuzzy match suggestions if available (helps users discover typos)
        if (resolution.suggestions && resolution.suggestions.length > 0) {
            this.logger.warn(`[InlineGateExtractionStage] Unknown gate "${resolution.criteria}". ` +
                `Did you mean: ${resolution.suggestions.join(', ')}?`);
        }
        if (resolution.criteria) {
            inlineCriteria.push(resolution.criteria);
        }
    }
    getScopeId(context, stepNumber) {
        const baseScope = context.state.session.executionScopeId ||
            context.getSessionId?.() ||
            context.mcpRequest.chain_id ||
            context.mcpRequest.command ||
            'execution';
        if (typeof stepNumber === 'number') {
            return `${baseScope}:step_${stepNumber}`;
        }
        return `${baseScope}:command`;
    }
    trackTemporaryGateScope(context, scope, scopeId) {
        if (!scopeId) {
            return;
        }
        const scopes = context.state.gates.temporaryGateScopes ?? [];
        if (!context.state.gates.temporaryGateScopes) {
            context.state.gates.temporaryGateScopes = scopes;
        }
        const exists = scopes.some((entry) => entry.scope === scope && entry.scopeId === scopeId);
        if (!exists) {
            scopes.push({ scope, scopeId });
        }
    }
}
//# sourceMappingURL=02-inline-gate-stage.js.map