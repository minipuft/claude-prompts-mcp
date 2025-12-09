// @lifecycle canonical - Internal implementation details for injection control.
//
// Architecture:
// ┌─────────────────────────────────────────────────────────────────┐
// │  InjectionDecisionService (public facade)                       │
// │    - Single entry point for all injection decisions             │
// │    - Caches decisions, manages runtime overrides                │
// │    └─────────────────────────────────────────────────────────── │
// │        ├── HierarchyResolver                                    │
// │        │     Walks config hierarchy:                            │
// │        │     step → chain → category → global → default         │
// │        │                                                        │
// │        └── ConditionEvaluator                                   │
// │              Evaluates "when" clauses:                          │
// │              gate-status, step-type, step-number, etc.          │
// └─────────────────────────────────────────────────────────────────┘
//
// These are implementation details. Import from '../index.js' for public API.

export { HierarchyResolver } from './hierarchy-resolver.js';
export { ConditionEvaluator, type ConditionEvaluationResult } from './condition-evaluator.js';
