// @lifecycle canonical - Public exports for the modular injection control system.
//
// Architecture:
// ┌─────────────────────────────────────────────────────────────────┐
// │  InjectionDecisionService (public facade)                       │
// │    - Single entry point for all injection decisions             │
// │    - Caches decisions, manages runtime overrides                │
// │    └─────────────────────────────────────────────────────────── │
// │        ├── HierarchyResolver (internal)                         │
// │        │     Walks config hierarchy:                            │
// │        │     step → chain → category → global → default         │
// │        │                                                        │
// │        └── ConditionEvaluator (internal)                        │
// │              Evaluates "when" clauses:                          │
// │              gate-status, step-type, step-number, etc.          │
// └─────────────────────────────────────────────────────────────────┘

// Core types
export type {
  CategoryInjectionConfig,
  ChainInjectionConfig,
  ExecutionContextType,
  InjectionCondition,
  InjectionConditionWhen,
  InjectionConfig,
  InjectionDecision,
  InjectionDecisionInput,
  InjectionDecisionSource,
  InjectionDefaults,
  InjectionFrequency,
  InjectionFrequencyMode,
  InjectionRuntimeOverride,
  InjectionSessionState,
  InjectionState,
  InjectionTarget,
  InjectionType,
  InjectionTypeConfig,
  InjectionTypeRuleConfig,
  ResolvedInjectionConfig,
  StepInjectionConfig,
} from './types.js';

// Constants
export {
  DEFAULT_CONFIG_BY_TYPE,
  DEFAULT_GATE_GUIDANCE_CONFIG,
  DEFAULT_GATE_GUIDANCE_FREQUENCY,
  DEFAULT_INJECTION_CONFIG,
  DEFAULT_INJECTION_TARGET,
  DEFAULT_STYLE_GUIDANCE_CONFIG,
  DEFAULT_STYLE_GUIDANCE_FREQUENCY,
  DEFAULT_SYSTEM_PROMPT_CONFIG,
  DEFAULT_SYSTEM_PROMPT_FREQUENCY,
  DECISION_SOURCE_DESCRIPTIONS,
  DISABLE_INJECT_MODIFIERS,
  FORCE_INJECT_MODIFIERS,
  INJECTION_TARGET_DESCRIPTIONS,
  INJECTION_TYPE_DESCRIPTIONS,
  INJECTION_TYPES,
  MODIFIER_EFFECTS,
  RESOLUTION_PRIORITY,
} from './constants.js';

// Public service classes
export { InjectionDecisionService } from './injection-decision-service.js';

// Internal implementation (exported for testing and advanced usage)
export {
  HierarchyResolver,
  ConditionEvaluator,
  type ConditionEvaluationResult,
} from './internal/index.js';

// Session override management
export {
  SessionOverrideManager,
  initSessionOverrideManager,
  getSessionOverrideManager,
  isSessionOverrideManagerInitialized,
  resetSessionOverrideManager,
} from './session-overrides.js';
