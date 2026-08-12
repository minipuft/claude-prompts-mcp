// @lifecycle canonical - Pipeline decision authorities public API.
//
// Architecture:
// ┌─────────────────────────────────────────────────────────────────┐
// │  Pipeline Decision Authorities                                  │
// │  Single source of truth for all pipeline decisions              │
// │                                                                 │
// │  ├── FrameworkDecisionAuthority                                 │
// │  │     Resolves framework application: modifier → operator →    │
// │  │     global-active                                            │
// │  │                                                              │
// │  ├── GateEnforcementAuthority                                   │
// │  │     Gate verdicts, retry limits, enforcement modes           │
// │  │                                                              │
// │  ├── InjectionDecisionService                                   │
// │  │     Content injection: system-prompt, gate-guidance,         │
// │  │     style-guidance with config hierarchy resolution          │
// │  │                                                              │
// │  └── decideMutation (P4)                                        │
// │        Adaptive chain mutation: insert an investigation step on  │
// │        a blocking unknown, skip a declared target on an          │
// │        irrelevant resolution. Tier 1: pure decision only — dead   │
// │        until Tier 3 wires it into stage 16.                      │
// └─────────────────────────────────────────────────────────────────┘
//
// All pipeline stages MUST consult these authorities instead of
// making decisions independently. Decisions are computed once and
// cached for the duration of the request.

// Shared decision types
export type { FrameworkDecision, StrategyDecision } from './types.js';

// Framework decisions
export { FrameworkDecisionAuthority } from './framework/index.js';
export type { FrameworkDecisionInput } from './framework/index.js';

// Gate enforcement decisions
export { GateEnforcementAuthority, resolveEnforcementMode } from './gates/index.js';
export type {
  ActionResult,
  CreateReviewOptions,
  EnforcementMode,
  GateAction,
  ParsedVerdict,
  PendingGateReview,
  RetryConfig,
  ReviewOutcome,
  VerdictSource,
} from './gates/index.js';

// Injection decisions
export {
  InjectionDecisionService,
  HierarchyResolver,
  ConditionEvaluator,
  SessionOverrideResolver,
  initSessionOverrideResolver,
  getSessionOverrideResolver,
  isSessionOverrideResolverInitialized,
  resetSessionOverrideResolver,
  // Constants
  DEFAULT_CONFIG_BY_TYPE,
  DEFAULT_GATE_GUIDANCE_CONFIG,
  DEFAULT_GATE_GUIDANCE_FREQUENCY,
  DEFAULT_INJECTION_CONFIG,
  DEFAULT_STYLE_GUIDANCE_CONFIG,
  DEFAULT_STYLE_GUIDANCE_FREQUENCY,
  DEFAULT_SYSTEM_PROMPT_CONFIG,
  DEFAULT_SYSTEM_PROMPT_FREQUENCY,
  DECISION_SOURCE_DESCRIPTIONS,
  DISABLE_INJECT_MODIFIERS,
  FORCE_INJECT_MODIFIERS,
  INJECTION_TYPE_DESCRIPTIONS,
  INJECTION_TYPES,
  MODIFIER_EFFECTS,
  RESOLUTION_PRIORITY,
} from './injection/index.js';
export type {
  CategoryInjectionConfig,
  ChainInjectionConfig,
  ConditionEvaluationResult,
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
  InjectionType,
  InjectionTypeConfig,
  InjectionTypeRuleConfig,
  ResolvedInjectionConfig,
  StepInjectionConfig,
} from './injection/index.js';

// Adaptive chain-mutation decision (P4 Tier 1 — pure; wired into stage 16 at Tier 3)
export { decideMutation, MAX_INSERTIONS_PER_RUN } from './mutation/index.js';
export type { ChainMutation, DecideMutationInput, MutationNoneReason } from './mutation/index.js';
