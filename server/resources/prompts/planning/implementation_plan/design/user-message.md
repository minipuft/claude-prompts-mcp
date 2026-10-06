# Step 2: Design & Pre-flight

## Feature

{{feature}}

{% if constraints %}

## Constraints

{{constraints}}
{% endif %}

{% if non_goals %}

## Non-Goals

{{non_goals}}
{% endif %}

## Instructions

Using the discovery findings from Step 1, run the pre-flight checklist and produce the design artifacts. The pre-flight runs AFTER identification — describe what you're building before checking it.

Invoke `/refactoring` for pre-flight protocol if needed.

## RESULT (Step 2 — design is not complete without this)

```
scope:
  objective     : [one sentence — what this achieves]
  success_signal: [observable behavior that proves it works]
  non_goals     : [what this explicitly does NOT do]
  constraints   : [hard limits]

pre_flight:
  domain      : [pass | fail: ___]
  layer       : [pass | fail: ___]
  naming      : [pass | fail: ___]
  complexity  : [pass | fail: ___]
  size        : [pass | fail: ___]
  service     : [pass | fail: ___]
  defined     : [pass | fail: ___]
  contracts   : [pass | fail: ___]
  pattern     : [pass | fail: ___]
  reuse-scope : [pass | fail: ___ | n/a]
  persistence : [pass | fail: ___ | n/a]
  lib-api     : [pass | fail: ___ | n/a]
  lib-version : [pass | fail: ___ | n/a]

  failures    : [count]
  compound    : none | <diagnosis name> → <action>

  WHEN(creating or extracting):
    identification:
      behavior  : [what it does — not what it's called]
      state     : [none | config | lifecycle | connections]
      shape     : [function | class | module] — derived from state
      placement : [which layer/directory — derived from shape + consumers]
    alternatives:
      chosen    : [what + why]
      rejected  : [at least one alternative + why not]

decisions:
  | Decision | Chosen | Rejected | Why |
  |----------|--------|----------|-----|
  | ...      | ...    | ...      | ... |

interfaces:
  [Define contracts BEFORE implementation — types, APIs, schemas]

read_before_implementing:
  - [file:lines — integration point]
  - [file:lines — existing types]
  - [file:lines — test patterns to follow]

IF 2+ pre-flight failures:
  diagnosis_card:
    pattern       : [compound name from diagnostics table]
    layers_touched: [list of layers/modules]
    data_flow     : [how data moves through the change]
    risk          : [low | medium | high: assessment]
    impl_order    : [which tier first and why]
```
