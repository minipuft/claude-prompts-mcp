# Pre-Flight Completion Gate

Validates that the mandatory pre-flight checklist was completed before any implementation.

## Required Checks

The response must demonstrate that these pre-flight steps were evaluated:

1. **Domain ownership** — What module/service owns this code?
2. **Complexity check** — Cognitive complexity ≤15 per function. No cyclomatic gate: it counts
   every `??` and `?.` as a branch, so idiomatic optional chaining inflated it without costing a
   reader anything (removed 2026-08-02). `~/.claude/rules/refactoring.md` owns the thresholds.
3. **Size check** — How many responsibilities does the file hold? Size is a diagnostic, never a
   write-block; there are no per-layer line ranges. >1000 lines is the one surviving Critical.
4. **Layer identification** — Orchestration, service, or utility?
5. **Naming smell test** — No vague suffixes (Manager, Handler, Helper, Utils)
6. **Service existence** — Extend existing, don't create new
7. **Duplication check** — Import, don't redefine
8. **Mutation check** — Persisted state changes must await
9. **Type matching** — Input/output signatures verified
10. **Architecture pattern** — OOP shell + FP internals

## Pass Criteria

- At minimum, steps 1-5 must be explicitly addressed
- Domain and layer must be named specifically
- Complexity must be acknowledged with actual metrics or estimation
- Any naming smells must be resolved before proceeding

## Source

refactoring.md Pre-Flight Checklist (MANDATORY)
