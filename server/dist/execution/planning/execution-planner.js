// @lifecycle canonical - Plans operator execution order and dependencies.
import { CategoryExtractor, } from '../../mcp-tools/prompt-engine/utils/category-extractor.js';
/**
 * Determines execution strategy, complexity, and gate requirements for a command.
 * Extracted from PromptExecutionService to make planning reusable across the pipeline.
 */
export class ExecutionPlanner {
    constructor(semanticAnalyzer, logger) {
        this.semanticAnalyzer = semanticAnalyzer;
        this.logger = logger;
        /** Cached methodology gate IDs loaded from GateLoader */
        this.methodologyGateIdsCache = null;
        this.categoryExtractor = new CategoryExtractor(logger);
    }
    setFrameworkManager(manager) {
        this.frameworkManager = manager;
    }
    setGateLoader(loader) {
        this.gateLoader = loader;
        // Invalidate cache when loader changes
        this.methodologyGateIdsCache = null;
    }
    /**
     * Set the GateManager for category-based gate selection.
     * Used by autoAssignGates to dynamically select gates based on YAML activation rules.
     */
    setGateManager(manager) {
        this.gateManager = manager;
    }
    /**
     * Get methodology gate IDs dynamically from GateLoader.
     * Caches the result to avoid repeated disk reads.
     */
    async getMethodologyGateIds() {
        if (this.methodologyGateIdsCache) {
            return this.methodologyGateIdsCache;
        }
        if (!this.gateLoader) {
            this.logger.debug('[ExecutionPlanner] No GateLoader available for methodology gate detection');
            return new Set();
        }
        try {
            const ids = await this.gateLoader.getMethodologyGateIds();
            this.methodologyGateIdsCache = new Set(ids);
            return this.methodologyGateIdsCache;
        }
        catch (error) {
            this.logger.warn('[ExecutionPlanner] Failed to load methodology gate IDs', { error });
            return new Set();
        }
    }
    async createPlan(options) {
        const { parsedCommand, convertedPrompt, frameworkEnabled = false, gateOverrides } = options;
        let analysis = null;
        if (this.semanticAnalyzer) {
            try {
                analysis = await this.semanticAnalyzer.analyzePrompt(convertedPrompt);
            }
            catch (error) {
                this.logger.warn('[ExecutionPlanner] Semantic analysis failed', {
                    promptId: convertedPrompt.id,
                    error,
                });
            }
        }
        const categoryInfo = this.categoryExtractor.extractCategory(convertedPrompt);
        const strategyInput = {
            convertedPrompt,
            analysis,
        };
        if (parsedCommand !== undefined) {
            strategyInput.parsedCommand = parsedCommand;
        }
        const strategyInfo = this.resolveStrategy(strategyInput);
        const modifierResolution = this.normalizeModifiers(parsedCommand?.modifiers ?? convertedPrompt.executionModifiers);
        // Apply script-tools default: clean mode if prompt has script tools and no explicit overrides
        this.applyScriptToolDefaults(modifierResolution, convertedPrompt, parsedCommand, gateOverrides);
        const explicitGates = this.collectExplicitGateIds(convertedPrompt, categoryInfo);
        const autoGates = this.shouldAutoAssignGates()
            ? this.autoAssignGates(categoryInfo.category)
            : [];
        const mergedGates = this.mergeGates(explicitGates, autoGates, [
            ...(categoryInfo.gateConfiguration?.exclude ?? []),
            ...this.getPromptLevelExcludes(convertedPrompt),
        ]);
        // Add string gate IDs from unified gates parameter
        if (gateOverrides?.gates?.length) {
            gateOverrides.gates.forEach((gate) => {
                if (typeof gate === 'string') {
                    mergedGates.add(gate);
                }
            });
        }
        // Filter methodology gates if framework_gates is explicitly disabled
        if (convertedPrompt.enhancedGateConfiguration?.framework_gates === false) {
            const methodologyGateIds = await this.getMethodologyGateIds();
            methodologyGateIds.forEach((gateId) => mergedGates.delete(gateId));
        }
        // Check for framework override from symbolic operators
        const hasFrameworkOverride = Boolean(parsedCommand?.executionPlan?.frameworkOverride ?? parsedCommand?.executionPlan);
        let requiresFramework = this.requiresFramework(strategyInfo.strategy, convertedPrompt, analysis, mergedGates, frameworkEnabled, hasFrameworkOverride);
        const adjusted = this.applyModifierOverrides(modifierResolution.modifiers, mergedGates, requiresFramework);
        requiresFramework = adjusted.requiresFramework;
        const plan = {
            strategy: strategyInfo.strategy,
            gates: Array.from(adjusted.gates),
            requiresFramework,
            requiresSession: this.requiresSession(parsedCommand, convertedPrompt, strategyInfo.strategy),
        };
        if (categoryInfo.category !== undefined) {
            plan.category = categoryInfo.category;
        }
        if (modifierResolution.modifiers !== undefined) {
            plan.modifiers = modifierResolution.modifiers;
        }
        if (analysis !== null) {
            plan.semanticAnalysis = analysis;
        }
        return plan;
    }
    async createChainPlan(options) {
        const { parsedCommand, steps, frameworkEnabled = false, gateOverrides } = options;
        if (!Array.isArray(steps) || steps.length === 0) {
            throw new Error('Chain planning requires at least one step with a converted prompt');
        }
        const chainPrompt = parsedCommand.convertedPrompt ?? steps[0]?.convertedPrompt;
        if (!chainPrompt) {
            throw new Error('Chain planning requires a converted prompt on the command or first step');
        }
        const chainPlanOptions = {
            convertedPrompt: chainPrompt,
        };
        if (parsedCommand !== undefined) {
            chainPlanOptions.parsedCommand = parsedCommand;
        }
        if (frameworkEnabled !== undefined) {
            chainPlanOptions.frameworkEnabled = frameworkEnabled;
        }
        if (gateOverrides !== undefined) {
            chainPlanOptions.gateOverrides = gateOverrides;
        }
        const chainPlan = await this.createPlan(chainPlanOptions);
        const stepPlans = [];
        for (const step of steps) {
            if (!step?.convertedPrompt) {
                throw new Error(`Chain step ${step?.promptId ?? 'unknown'} missing converted prompt for planning`);
            }
            const stepPlanOptions = {
                convertedPrompt: step.convertedPrompt,
            };
            if (parsedCommand !== undefined) {
                stepPlanOptions.parsedCommand = parsedCommand;
            }
            if (frameworkEnabled !== undefined) {
                stepPlanOptions.frameworkEnabled = frameworkEnabled;
            }
            if (gateOverrides !== undefined) {
                stepPlanOptions.gateOverrides = gateOverrides;
            }
            const stepPlan = await this.createPlan(stepPlanOptions);
            stepPlans.push(stepPlan);
        }
        return {
            chainPlan,
            stepPlans,
        };
    }
    resolveStrategy(params) {
        const { convertedPrompt, parsedCommand, analysis } = params;
        if (this.hasChainIndicators(parsedCommand, convertedPrompt, analysis)) {
            return { strategy: 'chain' };
        }
        if (analysis?.executionType === 'chain') {
            return { strategy: 'chain' };
        }
        if (analysis?.executionType === 'single') {
            return { strategy: 'single' };
        }
        return this.heuristicResolution(convertedPrompt);
    }
    hasChainIndicators(parsedCommand, prompt, analysis) {
        if (prompt?.chainSteps?.length) {
            return true;
        }
        if (parsedCommand?.commandType === 'chain') {
            return true;
        }
        const hasChainOperator = parsedCommand?.operators?.operators?.some((op) => op.type === 'chain');
        if (hasChainOperator) {
            return true;
        }
        if (analysis?.executionType === 'chain') {
            return true;
        }
        if (analysis?.executionCharacteristics?.hasChainSteps) {
            return true;
        }
        return false;
    }
    heuristicResolution(prompt) {
        if (prompt.chainSteps?.length) {
            return { strategy: 'chain' };
        }
        const hasSystemMessage = Boolean(prompt.systemMessage?.trim());
        const hasTemplateVars = /\{\{.*?\}\}/.test(prompt.userMessageTemplate ?? '');
        const hasComplexLogic = /{%-|{%\s*if|{%\s*for/.test(prompt.userMessageTemplate ?? '');
        // All single prompts resolve to 'single' strategy (formerly 'prompt' or 'template')
        return { strategy: 'single' };
    }
    normalizeModifiers(modifiers) {
        const normalizedModifier = this.extractModifierFromFlags(modifiers);
        const normalizedModifiers = normalizedModifier !== undefined
            ? this.buildModifiers(normalizedModifier)
            : modifiers
                ? this.stripModifierFlags(modifiers)
                : undefined;
        return { modifiers: normalizedModifiers };
    }
    buildModifiers(modifier) {
        return {
            clean: modifier === 'clean',
            judge: modifier === 'judge',
            lean: modifier === 'lean',
            framework: modifier === 'framework',
        };
    }
    stripModifierFlags(modifiers) {
        return {
            clean: modifiers.clean === true,
            judge: modifiers.judge === true,
            lean: modifiers.lean === true,
            framework: modifiers.framework === true,
        };
    }
    extractModifierFromFlags(modifiers) {
        if (!modifiers) {
            return undefined;
        }
        const enabled = [];
        if (modifiers.clean)
            enabled.push('clean');
        if (modifiers.judge)
            enabled.push('judge');
        if (modifiers.lean)
            enabled.push('lean');
        if (modifiers.framework)
            enabled.push('framework');
        if (enabled.length > 1) {
            this.logger.warn('[ExecutionPlanner] Multiple execution modifiers detected; using the first match', {
                modifiers: enabled,
            });
        }
        return enabled[0];
    }
    /**
     * Apply script-tools default: clean mode for prompts with script tools.
     *
     * Script tool prompts default to %clean to focus output on tool results.
     * This default is overridden if the user explicitly provides:
     * - Any modifier flag (%judge, %lean, %framework, or even %clean)
     * - Custom gates via the gates parameter
     *
     * @param modifierResolution - Current modifier resolution (mutated in place)
     * @param convertedPrompt - The prompt being executed
     * @param parsedCommand - User's parsed command (to detect explicit modifiers)
     * @param gateOverrides - User's gate overrides (to detect custom gates)
     */
    applyScriptToolDefaults(modifierResolution, convertedPrompt, parsedCommand, gateOverrides) {
        // Only apply to prompts with script tools
        if (!convertedPrompt.scriptTools || convertedPrompt.scriptTools.length === 0) {
            return;
        }
        // Don't override if user explicitly provided modifier flags via command
        const userModifiers = parsedCommand?.modifiers;
        if (userModifiers) {
            const hasExplicitModifier = userModifiers.clean === true ||
                userModifiers.judge === true ||
                userModifiers.lean === true ||
                userModifiers.framework === true;
            if (hasExplicitModifier) {
                return;
            }
        }
        const hasExistingModifier = modifierResolution.modifiers?.clean === true ||
            modifierResolution.modifiers?.judge === true ||
            modifierResolution.modifiers?.lean === true ||
            modifierResolution.modifiers?.framework === true;
        if (hasExistingModifier) {
            return;
        }
        // Don't override if user provided custom gates
        if (gateOverrides?.gates && gateOverrides.gates.length > 0) {
            return;
        }
        // Apply clean mode as default for script-tool prompts
        if (!modifierResolution.modifiers) {
            modifierResolution.modifiers = { clean: true };
        }
        else if (!modifierResolution.modifiers.clean) {
            modifierResolution.modifiers = { ...modifierResolution.modifiers, clean: true };
        }
        this.logger.debug('[ExecutionPlanner] Applied clean mode default for script-tool prompt', {
            promptId: convertedPrompt.id,
            scriptToolCount: convertedPrompt.scriptTools.length,
        });
    }
    applyModifierOverrides(modifiers, gates, requiresFramework) {
        if (!modifiers) {
            return { gates, requiresFramework };
        }
        const normalized = this.stripModifierFlags(modifiers);
        if (normalized.clean) {
            gates.clear();
            return { gates, requiresFramework: false };
        }
        if (normalized.framework) {
            gates.clear();
            return { gates, requiresFramework: true };
        }
        if (normalized.lean) {
            return { gates, requiresFramework: false };
        }
        if (normalized.judge) {
            return { gates, requiresFramework: true };
        }
        return { gates, requiresFramework };
    }
    /**
     * Determines whether gates should be auto-assigned based on category.
     * Gates are always auto-assigned when appropriate for the prompt category.
     *
     * Note: The semantic layer (LLM integration) controls whether the SERVER validates gates,
     * not whether gates are assigned. Gate instructions are always rendered so the LLM client
     * can self-validate when server-side validation is disabled.
     *
     * Explicit gates from user/prompt configuration are always honored.
     */
    shouldAutoAssignGates() {
        // Gates should always be auto-assigned based on category
        // Server-side validation is controlled separately by semantic layer config
        return true;
    }
    /**
     * Auto-assign gates based on prompt category using YAML activation rules.
     *
     * Uses GateManager.getCategoryGates() to dynamically select gates that have
     * activation.prompt_categories matching the current prompt's category.
     * Falls back to empty array if GateManager is not available.
     *
     * Note: Framework gates (gate_type: 'framework') are handled separately via
     * the framework_gates configuration flag, not by this method.
     */
    autoAssignGates(category) {
        // Use GateManager for data-driven gate selection based on YAML activation rules
        if (this.gateManager !== undefined) {
            const normalizedCategory = category.length > 0 ? category.toLowerCase() : 'general';
            const categoryGates = this.gateManager.getCategoryGates(normalizedCategory);
            this.logger.debug('[ExecutionPlanner] Auto-assigned gates from activation rules', {
                category: normalizedCategory,
                gates: categoryGates,
            });
            return categoryGates;
        }
        // Fallback: No GateManager available - return empty (gates will come from explicit config)
        this.logger.debug('[ExecutionPlanner] No GateManager available for category-based gate selection');
        return [];
    }
    collectExplicitGateIds(prompt, categoryInfo) {
        const gateIds = new Set();
        const addGate = (gateId) => {
            if (gateId && gateId.trim().length > 0) {
                gateIds.add(gateId.trim());
            }
        };
        (prompt.gates || []).forEach((gate) => addGate(gate.id || gate.name));
        prompt.autoAssignedGates?.forEach?.((gate) => addGate(gate?.id));
        this.getPromptLevelIncludes(prompt).forEach(addGate);
        (categoryInfo.gateConfiguration?.include || []).forEach(addGate);
        return gateIds;
    }
    getPromptLevelIncludes(prompt) {
        const includes = [];
        const gateConfig = prompt.gateConfiguration;
        if (gateConfig?.include) {
            includes.push(...gateConfig.include);
        }
        if (prompt.enhancedGateConfiguration?.include) {
            includes.push(...prompt.enhancedGateConfiguration.include);
        }
        return includes;
    }
    getPromptLevelExcludes(prompt) {
        const excludes = [];
        const gateConfig = prompt.gateConfiguration;
        if (gateConfig?.exclude) {
            excludes.push(...gateConfig.exclude);
        }
        if (prompt.enhancedGateConfiguration?.exclude) {
            excludes.push(...prompt.enhancedGateConfiguration.exclude);
        }
        return excludes;
    }
    mergeGates(explicitGates, autoAssigned, exclude) {
        const merged = new Set(explicitGates);
        autoAssigned.forEach((gate) => {
            if (gate)
                merged.add(gate);
        });
        exclude.forEach((gateId) => merged.delete(gateId));
        return merged;
    }
    requiresFramework(strategy, prompt, analysis, gates, frameworkEnabled, hasFrameworkOverride) {
        // Framework context required when:
        // . Enabled in config (normal framework resolution)
        // . Framework override detected from symbolic operator (@)
        // This supports BOTH system prompt injection AND gate filtering
        return frameworkEnabled || hasFrameworkOverride;
    }
    requiresSession(parsedCommand, prompt, strategy) {
        if (strategy === 'chain') {
            return true;
        }
        if (prompt.chainSteps?.length) {
            return true;
        }
        // Check for any operator that requires session state (chain, gate)
        const hasSessionOperator = parsedCommand?.operators?.operators?.some((op) => op.type === 'chain' || op.type === 'gate') ?? false;
        if (hasSessionOperator) {
            return true;
        }
        return false;
    }
}
//# sourceMappingURL=execution-planner.js.map