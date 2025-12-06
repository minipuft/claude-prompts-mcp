/**
 * Types of content that can be injected into prompts.
 * Each type is controlled separately for fine-grained customization.
 */
export type InjectionType = 'system-prompt' | 'gate-guidance' | 'style-guidance';
/**
 * Sources from which an injection decision can originate.
 * Listed in resolution priority order (highest to lowest).
 */
export type InjectionDecisionSource = 'modifier' | 'runtime-override' | 'step-config' | 'chain-config' | 'category-config' | 'global-config' | 'system-default';
/**
 * Clear, unambiguous injection decision.
 *
 * IMPORTANT: `inject: true` means INJECT, `inject: false` means SKIP.
 * No inversions, no confusion.
 */
export interface InjectionDecision {
    /** Whether to inject this content. true = inject, false = skip. */
    inject: boolean;
    /** Human-readable explanation of why this decision was made. */
    reason: string;
    /** The source that determined this decision. */
    source: InjectionDecisionSource;
    /** Timestamp when this decision was made. */
    decidedAt: number;
}
/**
 * Frequency modes for injection.
 * Controls how often content is injected during chain execution.
 */
export type InjectionFrequencyMode = 'every' | 'first-only' | 'never';
/**
 * Frequency configuration for injection.
 */
export interface InjectionFrequency {
    /** The injection mode. */
    mode: InjectionFrequencyMode;
    /** For 'every' mode: inject every N steps. Default is 1 (every step). */
    interval?: number;
}
/**
 * Conditions that trigger injection rules.
 */
export type InjectionConditionWhen = {
    type: 'gate-status';
    gateId: string;
    status: 'pass' | 'fail' | 'pending';
} | {
    type: 'step-type';
    stepType: string;
} | {
    type: 'step-number';
    comparison: 'eq' | 'gt' | 'lt' | 'gte' | 'lte';
    value: number;
} | {
    type: 'previous-step-result';
    status: 'success' | 'failure' | 'skipped';
} | {
    type: 'chain-position';
    position: 'first' | 'last' | 'middle';
} | {
    type: 'always';
};
/**
 * A conditional injection rule.
 * When the condition matches, the `then` action is taken.
 */
export interface InjectionCondition {
    /** Unique identifier for this condition. */
    id: string;
    /** The condition to evaluate. */
    when: InjectionConditionWhen;
    /** Action to take when condition matches. */
    then: 'inject' | 'skip' | 'inherit';
    /** Optional reason override for decision explanation. */
    reason?: string;
}
/**
 * Configuration for a single injection type.
 */
export interface InjectionTypeConfig {
    /** Whether this injection type is enabled. */
    enabled: boolean;
    /** Frequency configuration for chain execution. */
    frequency?: InjectionFrequency;
    /** Conditional rules evaluated in order. First match wins. */
    conditions?: InjectionCondition[];
}
/**
 * Input data for making an injection decision.
 * Decoupled from ExecutionContext for testability.
 */
export interface InjectionDecisionInput {
    /** The type of injection being decided. */
    injectionType: InjectionType;
    /** Current step number in chain (1-based). Undefined for single prompts. */
    currentStep?: number;
    /** Total steps in chain. Undefined for single prompts. */
    totalSteps?: number;
    /** Previous step result. Undefined for first step or single prompts. */
    previousStepResult?: 'success' | 'failure' | 'skipped';
    /** Step type identifier (e.g., 'analysis', 'generation'). */
    stepType?: string;
    /** Gate statuses for condition evaluation. */
    gateStatuses?: Map<string, 'pass' | 'fail' | 'pending'>;
    /** Modifiers from command parsing. */
    modifiers?: {
        clean?: boolean;
        lean?: boolean;
        guided?: boolean;
    };
    /** Session-level overrides from runtime. */
    sessionOverrides?: Partial<Record<InjectionType, boolean>>;
    /** Category ID for hierarchical lookup. */
    categoryId?: string;
    /** Chain ID for hierarchical lookup. */
    chainId?: string;
    /** Prompt ID for hierarchical lookup. */
    promptId?: string;
}
/**
 * Complete state for all injection types.
 * Stored in pipeline internal state.
 */
export interface InjectionState {
    /** Decision for system prompt injection. */
    systemPrompt?: InjectionDecision;
    /** Decision for gate guidance injection. */
    gateGuidance?: InjectionDecision;
    /** Decision for style guidance injection. */
    styleGuidance?: InjectionDecision;
    /** Current step number in chain execution. */
    currentStep?: number;
    /** Step number when system prompt was last injected. */
    lastSystemPromptStep?: number;
    /** Active session overrides. */
    sessionOverrides?: Partial<Record<InjectionType, boolean>>;
}
/**
 * Result of hierarchical config resolution.
 * Combines configs from all levels with source tracking.
 */
export interface ResolvedInjectionConfig {
    /** The effective configuration for this injection type. */
    config: InjectionTypeConfig;
    /** The source that provided this configuration. */
    source: InjectionDecisionSource;
    /** Chain of sources consulted during resolution. */
    resolutionPath: InjectionDecisionSource[];
}
