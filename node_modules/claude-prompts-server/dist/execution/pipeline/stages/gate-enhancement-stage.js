import { METHODOLOGY_GATES } from '../../../gates/constants.js';
import { BasePipelineStage } from '../stage.js';
export class GateEnhancementStage extends BasePipelineStage {
    constructor(gateService, temporaryGateRegistry, frameworksConfigProvider, logger, metricsProvider) {
        super(logger);
        this.gateService = gateService;
        this.temporaryGateRegistry = temporaryGateRegistry;
        this.frameworksConfigProvider = frameworksConfigProvider;
        this.name = 'GateEnhancement';
        this.metricsProvider = metricsProvider;
    }
    /**
     * Returns gate service with validation.
     * This method should only be called after the null check in execute().
     */
    requireGateService() {
        if (this.gateService === null) {
            throw new Error('Gate service not available');
        }
        return this.gateService;
    }
    /**
     * Type-safe resolution of gate enhancement context using type guards.
     * Eliminates runtime errors by using compile-time type narrowing.
     */
    resolveGateContext(context) {
        // Chain execution context
        if (context.hasChainCommand()) {
            return {
                type: 'chain',
                steps: context.parsedCommand.steps,
            };
        }
        // Legacy compatibility: fallback for non-chain commands with steps
        if (context.parsedCommand?.steps !== undefined && context.parsedCommand.steps.length > 0) {
            return {
                type: 'chain',
                steps: context.parsedCommand.steps,
            };
        }
        // Single prompt execution context
        if (context.hasSinglePromptCommand()) {
            return {
                type: 'single',
                prompt: context.parsedCommand.convertedPrompt,
                inlineGateIds: context.parsedCommand.inlineGateIds ?? [],
            };
        }
        // Fallback for non-type-guarded single prompts
        if (context.parsedCommand?.convertedPrompt !== undefined) {
            return {
                type: 'single',
                prompt: context.parsedCommand.convertedPrompt,
                inlineGateIds: context.parsedCommand.inlineGateIds ?? [],
            };
        }
        return null;
    }
    async execute(context) {
        this.logEntry(context);
        if (this.gateService === null) {
            this.logExit({ skipped: 'Gate service unavailable' });
            return;
        }
        const executionPlan = context.executionPlan;
        if (executionPlan === undefined) {
            this.logExit({ skipped: 'Execution plan missing' });
            return;
        }
        const frameworksConfig = this.frameworksConfigProvider?.();
        const registeredTempGates = this.registerTemporaryGates(context);
        // Type-safe variant resolution
        const gateContext = this.resolveGateContext(context);
        if (gateContext === null) {
            this.logExit({ skipped: 'Unsupported execution context' });
            return;
        }
        // Variant-specific processing
        if (gateContext.type === 'chain') {
            await this.enhanceChainSteps(gateContext, context, registeredTempGates, frameworksConfig);
            return;
        }
        if (gateContext.type === 'single') {
            await this.enhanceSinglePrompt(gateContext, context, registeredTempGates, frameworksConfig);
            return;
        }
    }
    /**
     * Enhance a single prompt with gate instructions
     */
    async enhanceSinglePrompt(gateContext, context, registeredTempGates, frameworksConfig) {
        const executionPlan = context.executionPlan;
        if (executionPlan === undefined) {
            return;
        }
        const { prompt, inlineGateIds } = gateContext;
        let gateIds = [...(executionPlan.gates ?? []), ...registeredTempGates, ...inlineGateIds];
        if (frameworksConfig !== undefined && !frameworksConfig.enableMethodologyGates) {
            gateIds = gateIds.filter((gate) => !METHODOLOGY_GATES.has(gate));
        }
        gateIds = Array.from(new Set(gateIds));
        if (gateIds.length === 0) {
            this.logExit({ skipped: 'No gates to apply' });
            return;
        }
        try {
            const originalTemplate = prompt.userMessageTemplate ?? '';
            const gateService = this.requireGateService();
            const result = await gateService.enhancePrompt(prompt, gateIds, {
                framework: context.frameworkContext?.selectedFramework?.id,
                category: executionPlan.category,
                promptId: prompt.id,
            });
            // Extract gate instructions by comparing original vs enhanced template
            const enhancedTemplate = result.enhancedPrompt.userMessageTemplate ?? '';
            if (enhancedTemplate.startsWith(originalTemplate)) {
                // Gate instructions are appended, extract them
                context.gateInstructions = enhancedTemplate.substring(originalTemplate.length).trim();
            }
            executionPlan.gates = gateIds;
            if (result.validationResults !== undefined && result.validationResults.length > 0) {
                context.metadata.gateValidationResults = result.validationResults;
            }
            this.recordGateUsageMetrics(context, gateIds, result.instructionLength, result.validationResults);
            this.logExit({
                gateCount: gateIds.length,
                serviceType: gateService.serviceType,
                gateInstructionsStored: Boolean(context.gateInstructions),
            });
        }
        catch (error) {
            this.logger.warn('[GateEnhancementStage] Gate enhancement failed', {
                error,
            });
        }
    }
    /**
     * Enhance gate instructions for each step in a multi-step command
     */
    async enhanceChainSteps(gateContext, context, registeredTempGates, frameworksConfig) {
        const gateService = this.requireGateService();
        const { steps } = gateContext;
        let totalGatesApplied = 0;
        for (const step of steps) {
            // Each step should have a convertedPrompt (set during parsing)
            const prompt = step.convertedPrompt;
            if (prompt === undefined) {
                this.logger.warn(`[GateEnhancementStage] Skipping step ${step.stepNumber} - no convertedPrompt`);
                continue;
            }
            // Use pre-registered inline gate IDs for this step (if any)
            const stepGates = Array.isArray(step.inlineGateIds) ? step.inlineGateIds : [];
            // Determine gates for this specific step based on its category
            let gateIds = [...registeredTempGates, ...stepGates];
            // Auto-assign gates based on step's category if available
            if (prompt.category !== undefined && prompt.category.length > 0) {
                const categoryGates = this.getCategoryGates(prompt.category);
                gateIds.push(...categoryGates);
            }
            if (frameworksConfig !== undefined && !frameworksConfig.enableMethodologyGates) {
                gateIds = gateIds.filter((gate) => !METHODOLOGY_GATES.has(gate));
            }
            gateIds = Array.from(new Set(gateIds));
            if (gateIds.length === 0) {
                continue; // Skip this step if no gates to apply
            }
            try {
                const originalTemplate = prompt.userMessageTemplate ?? '';
                const result = await gateService.enhancePrompt(prompt, gateIds, {
                    framework: context.frameworkContext?.selectedFramework?.id,
                    category: prompt.category,
                    promptId: prompt.id,
                });
                // Extract gate instructions for this step
                const enhancedTemplate = result.enhancedPrompt.userMessageTemplate ?? '';
                if (enhancedTemplate.startsWith(originalTemplate)) {
                    const stepGateInstructions = enhancedTemplate.substring(originalTemplate.length).trim();
                    // Store step-specific gate instructions in step metadata
                    step.metadata ?? (step.metadata = {});
                    step.metadata.gateInstructions = stepGateInstructions;
                }
                // DON'T update step's convertedPrompt - keep original template unchanged
                // step.convertedPrompt = result.enhancedPrompt; // REMOVED
                totalGatesApplied += gateIds.length;
                this.recordGateUsageMetrics(context, gateIds, result.instructionLength, result.validationResults);
            }
            catch (error) {
                this.logger.warn(`[GateEnhancementStage] Gate enhancement failed for step ${step.stepNumber}`, {
                    error,
                    promptId: step.promptId,
                });
            }
        }
        this.logExit({
            gateCount: totalGatesApplied,
            stepCount: steps.length,
            serviceType: gateService.serviceType,
        });
    }
    /**
     * Get auto-assigned gates based on prompt category
     */
    getCategoryGates(category) {
        const gates = [];
        const normalizedCategory = category?.toLowerCase() ?? 'general';
        switch (normalizedCategory) {
            case 'code_generation':
            case 'development':
                gates.push('code-quality', 'technical-accuracy');
                break;
            case 'analysis':
            case 'research':
                gates.push('research-quality', 'technical-accuracy');
                break;
            case 'documentation':
                gates.push('content-structure', 'educational-clarity');
                break;
            case 'architecture':
                gates.push('technical-accuracy', 'security-awareness');
                break;
        }
        return gates;
    }
    getMetricsCollector() {
        return this.metricsProvider?.();
    }
    recordGateUsageMetrics(context, gateIds, instructionLength, validationResults) {
        const metrics = this.getMetricsCollector();
        if (metrics === undefined || gateIds.length === 0) {
            return;
        }
        const temporaryIds = new Set(Array.isArray(context.metadata.temporaryGateIds)
            ? context.metadata.temporaryGateIds
            : []);
        const validationMap = new Map();
        validationResults?.forEach((result) => validationMap.set(result.gateId, result));
        const baseCharacters = instructionLength !== undefined && gateIds.length > 0
            ? Math.floor(instructionLength / gateIds.length)
            : 0;
        let remainder = instructionLength !== undefined && gateIds.length > 0
            ? instructionLength % gateIds.length
            : 0;
        for (const gateId of gateIds) {
            const isTemporary = temporaryIds.has(gateId) || gateId.startsWith('temp_');
            const validation = validationMap.get(gateId);
            const instructionCharacters = baseCharacters + (remainder > 0 ? 1 : 0);
            if (remainder > 0) {
                remainder--;
            }
            const metric = {
                gateId,
                gateType: isTemporary ? 'temporary' : 'canonical',
                sessionId: context.getSessionId(),
                instructionCount: 1,
                instructionCharacters,
                temporary: isTemporary,
                validationResult: validation !== undefined
                    ? this.toMetricValidationResult(validation)
                    : validationResults !== undefined && validationResults.length > 0
                        ? 'skipped'
                        : undefined,
                metadata: {
                    strategy: context.executionPlan?.strategy,
                    category: context.executionPlan?.category,
                    serviceType: this.gateService?.serviceType,
                },
            };
            metrics.recordGateUsage(metric);
        }
    }
    toMetricValidationResult(validation) {
        return validation.passed ? 'passed' : 'failed';
    }
    /**
     * Generate guidance text from criteria array (mirrors gate-operator-executor pattern)
     */
    generateGuidanceFromCriteria(criteria) {
        if (criteria.length === 0) {
            return 'Validate the output against the inline criteria.';
        }
        return [
            'Evaluate the output against these criteria:',
            ...criteria.map((item, index) => `${index + 1}. ${item}`),
        ].join('\n');
    }
    /**
     * Normalize gate input to standard format, supporting multiple input styles
     */
    normalizeGateInput(gate) {
        // Support simple string format: "criteria text"
        if (typeof gate === 'string') {
            return {
                normalized: {
                    name: 'Inline Quality Criteria',
                    type: 'quality',
                    scope: 'execution',
                    criteria: [gate],
                    description: 'Inline quality criteria',
                    source: 'automatic',
                },
                isValid: true,
            };
        }
        // Normalize gate type with fallback
        const normalizeType = (type) => {
            const validTypes = [
                'validation',
                'approval',
                'condition',
                'quality',
                'guidance',
            ];
            return validTypes.includes(type)
                ? type
                : 'quality';
        };
        // Normalize scope with fallback
        const normalizeScope = (scope) => {
            const validScopes = ['execution', 'session', 'chain', 'step'];
            return validScopes.includes(scope)
                ? scope
                : 'execution';
        };
        // Normalize source with fallback
        const normalizeSource = (source) => {
            const validSources = ['manual', 'automatic', 'analysis'];
            return validSources.includes(source)
                ? source
                : 'automatic';
        };
        // Convert readonly arrays to mutable arrays and filter for strings
        const normalizeCriteria = (criteria) => {
            if (criteria === undefined || !Array.isArray(criteria))
                return undefined;
            const stringCriteria = criteria.filter((c) => typeof c === 'string');
            return stringCriteria.length > 0 ? stringCriteria : undefined;
        };
        // Normalize context to proper type
        const normalizeContext = (context) => {
            if (context === undefined || context === null)
                return undefined;
            if (typeof context === 'object') {
                return context;
            }
            return undefined;
        };
        // Extract criteria from either criteria or pass_criteria property
        const extractedCriteria = 'criteria' in gate ? gate.criteria : undefined;
        const extractedPassCriteria = 'pass_criteria' in gate ? gate.pass_criteria : undefined;
        // Support object with criteria or other gate properties
        return {
            normalized: {
                name: gate.name ?? 'Inline Quality Criteria',
                type: normalizeType(gate.type),
                scope: normalizeScope(gate.scope),
                criteria: normalizeCriteria(extractedCriteria),
                guidance: gate.guidance,
                description: gate.description ?? 'Temporary gate criteria',
                pass_criteria: normalizeCriteria(extractedPassCriteria ?? extractedCriteria),
                source: normalizeSource(gate.source),
                context: normalizeContext(gate.context),
            },
            isValid: true,
        };
    }
    registerTemporaryGates(context) {
        if (this.temporaryGateRegistry === undefined) {
            this.logger.debug('[GateEnhancementStage] No temporary gate registry available');
            return [];
        }
        this.logger.debug('[GateEnhancementStage] registerTemporaryGates - parsedCommand structure', {
            hasOperators: Boolean(context.parsedCommand?.operators),
            operatorTypes: context.parsedCommand?.operators !== undefined
                ? context.parsedCommand.operators.operatorTypes
                : undefined,
            operatorCount: context.parsedCommand?.operators !== undefined
                ? context.parsedCommand.operators.operators?.length
                : undefined,
            format: context.parsedCommand?.format,
        });
        const tempGateInputs = [
            ...(context.mcpRequest?.temporary_gates ?? []),
            ...this.convertCustomChecks(context.mcpRequest?.custom_checks),
        ];
        if (!tempGateInputs.length) {
            return [];
        }
        const scopeId = context.getSessionId?.() ||
            context.mcpRequest.session_id ||
            context.mcpRequest.command ||
            'execution';
        const createdIds = [];
        for (const rawGate of tempGateInputs) {
            try {
                const { normalized: gate, isValid } = this.normalizeGateInput(rawGate);
                if (!isValid) {
                    this.logger.warn('[GateEnhancementStage] Invalid gate format, skipping', {
                        gate: rawGate,
                    });
                    continue;
                }
                // Extract criteria from various possible locations
                const criteria = gate.criteria ?? gate.pass_criteria ?? [];
                const criteriaArray = Array.isArray(criteria)
                    ? criteria.filter((c) => typeof c === 'string')
                    : [];
                // Auto-generate guidance if empty, using available content
                let effectiveGuidance = gate.guidance || '';
                if (!effectiveGuidance && criteriaArray.length > 0) {
                    effectiveGuidance = this.generateGuidanceFromCriteria(criteriaArray);
                    this.logger.debug('[GateEnhancementStage] Auto-generated guidance from criteria', {
                        criteriaCount: criteriaArray.length,
                        guidanceLength: effectiveGuidance.length,
                    });
                }
                else if (!effectiveGuidance && gate.description) {
                    effectiveGuidance = gate.description;
                    this.logger.debug('[GateEnhancementStage] Using description as guidance', {
                        guidanceLength: effectiveGuidance.length,
                    });
                }
                // Skip gates with no usable content
                if (!effectiveGuidance && criteriaArray.length === 0 && !gate.description) {
                    this.logger.warn('[GateEnhancementStage] Skipping gate with no usable content (no guidance, criteria, or description)', { gate });
                    continue;
                }
                const gateId = this.temporaryGateRegistry.createTemporaryGate({
                    name: gate.name,
                    type: gate.type,
                    scope: gate.scope,
                    description: gate.description ?? effectiveGuidance.substring(0, 100),
                    guidance: effectiveGuidance,
                    pass_criteria: criteriaArray.length > 0 ? criteriaArray : gate.pass_criteria,
                    source: gate.source,
                    context: gate.context,
                }, scopeId);
                createdIds.push(gateId);
                this.logger.debug('[GateEnhancementStage] Registered temporary gate', {
                    gateId,
                    name: gate.name,
                    hasGuidance: !!effectiveGuidance,
                    guidanceLength: effectiveGuidance.length,
                    criteriaCount: criteriaArray.length,
                });
            }
            catch (error) {
                this.logger.warn('[GateEnhancementStage] Failed to register temporary gate', {
                    gate: rawGate,
                    error,
                });
            }
        }
        if (createdIds.length) {
            const existing = Array.isArray(context.metadata.temporaryGateIds)
                ? context.metadata.temporaryGateIds
                : [];
            context.metadata.temporaryGateIds = [...existing, ...createdIds];
            this.logger.info('[GateEnhancementStage] Successfully registered temporary gates', {
                count: createdIds.length,
                gateIds: createdIds,
            });
        }
        return createdIds;
    }
    convertCustomChecks(customChecks) {
        if (!Array.isArray(customChecks) || !customChecks.length) {
            return [];
        }
        return customChecks
            .filter((check) => check && (check.name || check.description))
            .map((check) => ({
            name: check.name ?? 'Custom Check',
            type: 'validation',
            scope: 'execution',
            description: check.description ?? check.name ?? '',
            guidance: check.description
                ? `Ensure: ${check.description}`
                : 'Ensure the output satisfies the described custom check.',
            pass_criteria: [],
            source: 'manual',
        }));
    }
}
//# sourceMappingURL=gate-enhancement-stage.js.map