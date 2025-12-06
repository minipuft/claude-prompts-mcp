// @lifecycle canonical - Public exports for the modular injection control system.
// Constants
export { DEFAULT_CONFIG_BY_TYPE, DEFAULT_GATE_GUIDANCE_CONFIG, DEFAULT_GATE_GUIDANCE_FREQUENCY, DEFAULT_INJECTION_CONFIG, DEFAULT_STYLE_GUIDANCE_CONFIG, DEFAULT_STYLE_GUIDANCE_FREQUENCY, DEFAULT_SYSTEM_PROMPT_CONFIG, DEFAULT_SYSTEM_PROMPT_FREQUENCY, DECISION_SOURCE_DESCRIPTIONS, DISABLE_INJECT_MODIFIERS, FORCE_INJECT_MODIFIERS, INJECTION_TYPE_DESCRIPTIONS, INJECTION_TYPES, MODIFIER_EFFECTS, RESOLUTION_PRIORITY, } from './constants.js';
// Authority classes
export { InjectionDecisionAuthority } from './authority/injection-decision-authority.js';
export { DecisionResolver } from './authority/decision-resolver.js';
export { ConditionEvaluator } from './authority/condition-evaluator.js';
// Session override management
export { SessionOverrideManager, initSessionOverrideManager, getSessionOverrideManager, isSessionOverrideManagerInitialized, resetSessionOverrideManager, } from './state/session-overrides.js';
//# sourceMappingURL=index.js.map