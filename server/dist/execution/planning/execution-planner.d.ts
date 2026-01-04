import type { FrameworkManager } from '../../frameworks/framework-manager.js';
import type { GateDefinitionProvider } from '../../gates/core/gate-loader.js';
import type { Logger } from '../../logging/index.js';
import type { ContentAnalyzer } from '../../semantic/configurable-semantic-analyzer.js';
import type { ConvertedPrompt } from '../../types/index.js';
import type { ParsedCommand } from '../context/execution-context.js';
import type { ChainStepPrompt } from '../operators/types.js';
import type { ExecutionPlan } from '../types.js';
type GateOverrideOptions = {
    gates?: import('../../types/execution.js').GateSpecification[];
};
export interface ExecutionPlannerOptions {
    parsedCommand?: ParsedCommand;
    convertedPrompt: ConvertedPrompt;
    frameworkEnabled?: boolean;
    gateOverrides?: GateOverrideOptions;
}
export interface ChainExecutionPlannerOptions {
    parsedCommand: ParsedCommand;
    steps: readonly ChainStepPrompt[];
    frameworkEnabled?: boolean;
    gateOverrides?: GateOverrideOptions;
}
export interface ChainExecutionPlanResult {
    chainPlan: ExecutionPlan;
    stepPlans: ExecutionPlan[];
}
type SemanticAnalyzerLike = Pick<ContentAnalyzer, 'analyzePrompt' | 'isLLMEnabled'>;
/**
 * Determines execution strategy, complexity, and gate requirements for a command.
 * Extracted from PromptExecutionService to make planning reusable across the pipeline.
 */
export declare class ExecutionPlanner {
    private readonly semanticAnalyzer;
    private readonly logger;
    private frameworkManager;
    private gateLoader;
    private readonly categoryExtractor;
    /** Cached methodology gate IDs loaded from GateLoader */
    private methodologyGateIdsCache;
    constructor(semanticAnalyzer: SemanticAnalyzerLike | null, logger: Logger);
    setFrameworkManager(manager?: FrameworkManager): void;
    setGateLoader(loader?: GateDefinitionProvider): void;
    /**
     * Get methodology gate IDs dynamically from GateLoader.
     * Caches the result to avoid repeated disk reads.
     */
    private getMethodologyGateIds;
    createPlan(options: ExecutionPlannerOptions): Promise<ExecutionPlan>;
    createChainPlan(options: ChainExecutionPlannerOptions): Promise<ChainExecutionPlanResult>;
    private resolveStrategy;
    private hasChainIndicators;
    private heuristicResolution;
    private normalizeModifiers;
    private buildModifiers;
    private stripModifierFlags;
    private extractModifierFromFlags;
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
    private applyScriptToolDefaults;
    private applyModifierOverrides;
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
    private shouldAutoAssignGates;
    private autoAssignGates;
    private collectExplicitGateIds;
    private getPromptLevelIncludes;
    private getPromptLevelExcludes;
    private mergeGates;
    private requiresFramework;
    private requiresSession;
}
export {};
