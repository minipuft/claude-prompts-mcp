export type { InjectionCondition, InjectionConditionWhen, InjectionDecision, InjectionDecisionInput, InjectionDecisionSource, InjectionFrequency, InjectionFrequencyMode, InjectionState, InjectionType, InjectionTypeConfig, ResolvedInjectionConfig, } from './types.js';
export type { CategoryInjectionConfig, ChainInjectionConfig, InjectionBackwardCompatConfig, InjectionConfig, InjectionDefaults, InjectionRuntimeOverride, InjectionSessionState, InjectionTypeRuleConfig, StepInjectionConfig, } from './config-types.js';
export { DEFAULT_CONFIG_BY_TYPE, DEFAULT_GATE_GUIDANCE_CONFIG, DEFAULT_GATE_GUIDANCE_FREQUENCY, DEFAULT_INJECTION_CONFIG, DEFAULT_STYLE_GUIDANCE_CONFIG, DEFAULT_STYLE_GUIDANCE_FREQUENCY, DEFAULT_SYSTEM_PROMPT_CONFIG, DEFAULT_SYSTEM_PROMPT_FREQUENCY, DECISION_SOURCE_DESCRIPTIONS, DISABLE_INJECT_MODIFIERS, FORCE_INJECT_MODIFIERS, INJECTION_TYPE_DESCRIPTIONS, INJECTION_TYPES, MODIFIER_EFFECTS, RESOLUTION_PRIORITY, } from './constants.js';
export { InjectionDecisionAuthority } from './authority/injection-decision-authority.js';
export { DecisionResolver } from './authority/decision-resolver.js';
export { ConditionEvaluator } from './authority/condition-evaluator.js';
export type { ConditionEvaluationResult } from './authority/condition-evaluator.js';
export { SessionOverrideManager, initSessionOverrideManager, getSessionOverrideManager, isSessionOverrideManagerInitialized, resetSessionOverrideManager, } from './state/session-overrides.js';
