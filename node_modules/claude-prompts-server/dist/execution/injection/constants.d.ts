import type { InjectionConfig, InjectionDecisionSource, InjectionFrequency, InjectionType, InjectionTypeConfig } from './types.js';
/**
 * All available injection types.
 */
export declare const INJECTION_TYPES: readonly InjectionType[];
/**
 * Resolution priority order (highest to lowest).
 * Used for hierarchical configuration resolution.
 */
export declare const RESOLUTION_PRIORITY: readonly InjectionDecisionSource[];
/**
 * Default frequency for system prompt injection.
 * Injects every 2 steps (step 1, 3, 5, etc.)
 */
export declare const DEFAULT_SYSTEM_PROMPT_FREQUENCY: InjectionFrequency;
/**
 * Default frequency for gate guidance injection.
 * Injects on every step.
 */
export declare const DEFAULT_GATE_GUIDANCE_FREQUENCY: InjectionFrequency;
/**
 * Default frequency for style guidance injection.
 * Injects on first step only.
 */
export declare const DEFAULT_STYLE_GUIDANCE_FREQUENCY: InjectionFrequency;
/**
 * Default configuration for system-prompt injection.
 */
export declare const DEFAULT_SYSTEM_PROMPT_CONFIG: InjectionTypeConfig;
/**
 * Default configuration for gate-guidance injection.
 */
export declare const DEFAULT_GATE_GUIDANCE_CONFIG: InjectionTypeConfig;
/**
 * Default configuration for style-guidance injection.
 */
export declare const DEFAULT_STYLE_GUIDANCE_CONFIG: InjectionTypeConfig;
/**
 * Complete default injection configuration.
 * Used when no config.json injection section exists.
 */
export declare const DEFAULT_INJECTION_CONFIG: InjectionConfig;
/**
 * Map of injection type to its default configuration.
 */
export declare const DEFAULT_CONFIG_BY_TYPE: Readonly<Record<InjectionType, InjectionTypeConfig>>;
/**
 * Modifier effects on injection.
 * Maps modifiers to which injection types they disable.
 */
export declare const MODIFIER_EFFECTS: Readonly<Record<string, readonly InjectionType[]>>;
/**
 * Modifiers that force injection regardless of config.
 */
export declare const FORCE_INJECT_MODIFIERS: readonly string[];
/**
 * Modifiers that disable injection.
 */
export declare const DISABLE_INJECT_MODIFIERS: readonly string[];
/**
 * Human-readable descriptions for injection types.
 */
export declare const INJECTION_TYPE_DESCRIPTIONS: Readonly<Record<InjectionType, string>>;
/**
 * Human-readable descriptions for decision sources.
 */
export declare const DECISION_SOURCE_DESCRIPTIONS: Readonly<Record<InjectionDecisionSource, string>>;
