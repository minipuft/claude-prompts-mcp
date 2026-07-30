# ADR 0001: Gate Resolution Precedence

- Status: accepted
- Date: 2026-07-29
- Owners: @minipuft

## Context

Gate selection is currently specified in three places that disagree, and two of the three are not
reachable at runtime. Before any of `plans/techincal_debt/arg-gate-pipeline-fixes.md` T2/T3 can be
built, the project needs one stated order that implementations can be checked against.

### Measured current state

Every claim below was read out of the tree at the commit this ADR was written against.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Source priority is **provenance-only, not subtractive**. `GateAccumulator.add` uses `GATE_SOURCE_PRIORITY` to decide which _source label_ a duplicate gate ID keeps. A higher-priority source can neither remove nor suppress a gate a lower-priority source added — the accumulated set is a union.                                                                          | `pipeline/state/accumulators/gate-accumulator.ts:43-84`; ranking at `pipeline/state/types.ts:29-37`                                                                                                                                                                                              |
| F2  | **`framework_gates: false` is inert on the live path.** The planner's methodology-gate filter reads `convertedPrompt.enhancedGateConfiguration`, and `enhancedGateConfiguration` has **no writer anywhere in the repo** — it is declared once and read in five places. A prompt's YAML flag lands in `gateConfiguration.framework_gates`, which that filter does not consult. | filter at `execution/planning/execution-planner.ts:154`; declaration `execution/types.ts:73`; readers `execution-planner.ts:154,548,560` + `chain-session-router.ts:267`; writers: none                                                                                                          |
| F3  | The documented "4-level" and "5-level" precedence in `CategoryExtractor.selectGatesWithPrecedence` / `selectGatesWithEnhancedPrecedence` describes **no live behavior** — both methods have zero callers. They also conflate two concerns: `framework_gates !== false` gates category gates _and_ framework gates.                                                            | `execution/planning/category-extractor.ts:229,363`; caller search over `--type ts` returns only the definitions                                                                                                                                                                                  |
| F4  | **`%lean` keeps framework-dependent gates while suppressing the methodology they score against.** `%lean` sets `requiresFramework: false` and leaves the gate set untouched, so `framework-compliance` may still be scheduled with no methodology injected.                                                                                                                   | `execution-planner.ts:464-466`; documented intent at `docs/guides/injection-control.md:77`                                                                                                                                                                                                       |
| F5  | `inline_gate_definitions` reaches display and analysis only — six consumers, all rendering or previewing. A live registration seam for prompt-scoped ad-hoc gates already exists (`TemporaryGateRegistry`, surfaced through the `temporary-request` source).                                                                                                                  | consumers: `chain-session-router.ts:287`, `gate-analyzer.ts:394`, `prompt-lifecycle-processor.ts:149`, `prompt-discovery-processor.ts:335`, `skills-sync/service.ts:789`, `resource-scaffold.ts:60`; seam: `gates/core/temporary-gate-registry.ts`, `gates/services/temporary-gate-registrar.ts` |
| F6  | The injection hierarchy has seven levels and no prompt tier, so a prompt cannot refuse a methodology system prompt.                                                                                                                                                                                                                                                           | `docs/guides/injection-control.md:88-100`; `decisions/injection/internal/hierarchy-resolver.ts`                                                                                                                                                                                                  |

Only `gate_type: 'framework'` distinguishes a framework-dependent gate, and exactly one bundled gate
carries it (`server/resources/gates/framework-compliance/gate.yaml`). Category auto-assignment
already excludes that type (`gate-manager.ts:302`), so framework gates enter the set through
`prompt-config` or `registry-auto` (`gateManager.selectGates`), not through category auto-assign.

### Constraints

- The accumulator's union semantics (F1) are load-bearing for provenance diagnostics and are not
  being replaced by this ADR.
- STDIO/SSE parity applies: resolution runs in the pipeline, so both transports inherit it.
- `modules/prompts` → `engine/gates` is a new data direction and must satisfy `validate:arch`.

## Decision

Gate resolution is defined as **two stages**: an additive stage that unions ID sources under a
provenance ranking, then a subtractive stage that applies an **order-independent set of vetoes**.
Precedence questions belong to whichever stage actually owns them — conflating the two is what
produced F1/F3.

This shape was cross-checked against five systems that solve layered policy resolution (see
§ Prior art). The additive-then-subtractive split and the order-independence of the subtractive
stage are both convergent findings there, not local invention.

### (a) Total order

**Stage 1 — additive.** Sources contribute gate IDs; the set is their union. Rank decides only which
source a duplicate ID is attributed to, and which definition body wins under (b).

| Rank | Source              | Origin                                                                        |
| ---- | ------------------- | ----------------------------------------------------------------------------- |
| 100  | `inline-operator`   | `::` operator typed in the command                                            |
| 90   | `client-selection`  | gate chosen during a judge phase                                              |
| 80   | `temporary-request` | caller-supplied gate spec via the MCP `gates` parameter                       |
| 60   | `prompt-config`     | prompt/folder configuration — **including `inline_gate_definitions`**         |
| 50   | `chain-level`       | a chain's `finalValidation`                                                   |
| 40   | `methodology`       | active framework's methodology gates                                          |
| 20   | `registry-auto`     | `GateManager.selectGates()` — the registry's activation-rule query. See below |

This is the existing `GATE_SOURCE_PRIORITY` table, adopted unchanged as the canonical ranking.
Prompt-authored inline definitions enter at **60 (`prompt-config`)**, not at 80: 80 is the caller's
tier, and a prompt author does not outrank the person invoking the prompt.

**`registry-auto` is the registry's own activation query — `GateManager.selectGates()` — and that
is the single definition.** The gate registry holds the semantic; callers supply context and read
the answer. Two consequences, both binding:

- `GateManager.getCategoryGates()` is a **category-only convenience**, not a second definition of
  `registry-auto`. It exists because it filters `gate_type: 'framework'` out by hand
  (`gate-manager.ts:302`), which duplicates a decision the activation rules already encode. No
  resolution path may use it, and it is a deletion candidate once its last caller is gone.
- Framework-awareness is expressed **by the context passed in**, never by picking a different
  query. `selectGates({ promptCategory })` and `selectGates({ promptCategory, framework })` are the
  same semantic with different inputs — and a framework gate declaring `framework_context` rules
  does not activate when no framework is present (`gate-activation.ts:90-99`, AND logic). That is
  why the registry can be the sole authority without every caller needing to know a framework id.

This was an open gap that implementing T1.5 exposed: the planner queried `getCategoryGates()` while
`GateEnhancementService` queried `selectGates()`, so "category gates" named two different sets
depending on which side of the pipeline asked. Naming one authority is what lets a single resolver
serve both callers.

**Stage 2 — subtractive.** One **precomputed input**, then a **set of vetoes with no defined order
between them**.

_Input (not a veto):_ resolve whether a methodology is injected for this execution, through the
injection hierarchy in (c). It is computed before the veto set because one veto reads it.

_Veto set._ Every member removes gates and nothing else, so all members commute — a gate vetoed by
any member is absent from the result regardless of evaluation order. Implementations may evaluate
them in any order or in parallel; tests must not pin an order between them.

| Veto                                   | Removes                                                                                        | Binds sources up to rank                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `%clean` / `%framework` modifier       | the entire set                                                                                 | **100** — the caller's own instruction, so it binds everything       |
| `exclude` list (prompt, then category) | the named IDs                                                                                  | **60** — author preference, so it cannot veto the caller (80/90/100) |
| Methodology nesting                    | every gate with `gate_type: 'framework'`, when the input resolved to "no methodology injected" | **100** — a coherence invariant, see (c)                             |
| Global `enableMethodologyGates: false` | methodology gates, server-wide                                                                 | **100** — operator configuration                                     |

**Each veto declares the highest source rank it binds.** This is the one place where Stage 1's
ranking becomes subtractive, and it is deliberate: a veto whose scope is unstated defaults to
binding everything, which is how a prompt author would silently overrule the person invoking the
prompt. `exclude` is capped at rank 60 for exactly that reason — it is an authoring preference, not
a safety constraint, so it does not transfer Cedar's forbid-wins justification. A caller who types
`:: gate` (rank 100), selects one in a judge phase (90), or passes a spec through the MCP `gates`
parameter (80) keeps it against any prompt or category `exclude`.

Within a single rank tier, exclude beats include: an ID both included and excluded by prompt-level
config is excluded.

Existing behavior preserved: modifier clears at `execution-planner.ts:454-462`, global methodology
filter at `gate-enhancement-service.ts:158-167`.

`framework_gates: false` is redefined as a **prompt-level opt-out of methodology gates only** —
scoped to `gate_type: 'framework'`, applied at step 4 alongside the nesting rule. It stops gating
category gates (the F3 conflation is not carried forward), and it must be read from
`gateConfiguration`, the field loaders actually populate.

### (b) Merge or override for inline gates

**Union over IDs; shallow per-field override over bodies.**

- An inline definition contributes its ID to the union like any other source. It does not displace
  category-auto or framework gates, and they do not displace it. Removal is the Stage 2 veto set's
  job alone.
- When an inline definition declares an ID that already resolves to a registered gate, the ID stays
  a **single entry** in the set and the body is resolved field by field: **a field the
  higher-ranked source declares replaces it wholesale; a field it omits is inherited unchanged.**
  At rank 60 a prompt's inline definition overrides a `registry-auto` or `methodology` body, and is
  itself overridden by a caller-supplied `temporary-request` spec.

| Field kind                                                                          | Strategy                                                  | Why                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scalars — `description`, `guidance`, `severity`, `enforcementMode`, `type`, `scope` | declared replaces, omitted inherits                       | The common case, and the one readers predict                                                                                                        |
| Arrays — `criteria`, `pass_criteria`, `apply_to_steps`                              | declared **replaces** the whole array; it does not append | Appending makes narrowing impossible: an author who wants two of a registry gate's five criteria could not express it, and would silently get seven |
| Objects — `retry_config`, `context`                                                 | declared replaces the whole object, not key-by-key        | Key-by-key merge on `retry_config` can produce a combination neither source authored (one source's limit with the other's backoff)                  |

Stating the strategy per field kind, rather than one global deep-merge rule, follows the same
conclusion `webpack-merge` and ESLint flat config reached independently (see § Prior art). Deep
merge is rejected: it is the mechanism that yields configurations no author wrote.

- Inline definitions are registered through `TemporaryGateRegistry` with `scope: 'execution'`
  (or the definition's declared scope) and are referenced afterwards by canonical ID — reusing the
  seam in F5 rather than adding a second registration path into gate selection.

### (c) Methodology-gate nesting

**Unconditional, scoped to `gate_type: 'framework'`. No feature flag.**

When no methodology is injected for an execution, framework-typed gates are withheld. This covers
`%lean`, `%clean`, a per-prompt injection opt-out, and any config-level suppression, because all of
them are resolved by the same step-1 query.

Two boundaries this deliberately does not cross:

- Non-framework gates continue to run under `%lean`. "Disable system-prompt and style-guidance,
  keep gates" stays true as documented; the correction is narrower than the docs' current wording
  suggests, and only `framework-compliance` changes behavior today.
- No flag guards this. Per `cleanup-standards.md`, a flag is warranted when someone could
  legitimately choose the old behavior or when the value is only gradeable live. Scoring adherence
  to a methodology that was never injected is neither — it is a defect with a verifiable target, so
  it ships on and the old path is deleted rather than parked behind a knob.

The injection hierarchy grows a **prompt tier between step and chain**, taking it to eight levels:
modifiers → runtime override → step → **prompt** → chain → category → global → system default.
A prompt sits above chain because a self-contained prompt carrying its own section contract should
hold its refusal when reused inside someone else's chain.

### (d) Migration for prompts already shipping inert definitions

The bundled corpus is effectively unexposed — three prompt files carry a `gateConfiguration` block,
and the only `inline_gate_definitions` occurrences are inside the `create_prompt` scaffold's schema
and script, which document the field rather than configure gates. The exposure is user workspaces
overlaid via `MCP_WORKSPACE`, which this repo cannot inventory.

Migration is therefore **warn-then-arm across two releases**:

1. **This release** — `normalizeInlineGateDefinitions` stops dropping malformed definitions in
   silence. Each drop logs a warning naming the prompt, the gate, and the missing field (plan item
   3.1, already independent of this ADR). Definitions still do not execute. Operators get one
   release in which a workspace that would newly arm gates is visible in the logs.
2. **Next release** — definitions register and execute per (a)/(b). `CHANGELOG.md` flags it as a
   behavior change under "Changed", naming `inline_gate_definitions` explicitly.

Definitions that fail validation are dropped with a warning rather than failing the load, so a
malformed block degrades to today's behavior instead of taking a prompt out of service.

### Scope

**In**: the resolution order above; the `framework_gates` redefinition; the prompt injection tier;
inline-definition registration via the temporary-gate seam.

**Out**: replacing the accumulator's union semantics; per-step gate precedence inside chains
(`chain-level` keeps rank 50 and its current behavior); the `gates` MCP parameter's shape.

### Interfaces impacted

- `PromptData` / `ConvertedPrompt` — prompt-level injection block (plan 2.1/2.2).
- `hierarchy-resolver.ts` — a prompt tier at all three `findCategoryConfig` callsites (130, 396,
  431); threading only the first lets a prompt opt out of injection yet inherit a category
  frequency.
- `gate-manager.ts` / `gate-enhancement-service.ts` — accept prompt-scoped inline definitions.
- `execution-planner.ts:154` — read `gateConfiguration`, not the unwritten
  `enhancedGateConfiguration`.

### Legacy removal criteria

- `CategoryExtractor.selectGatesWithPrecedence` and `selectGatesWithEnhancedPrecedence` (F3) are
  deleted once T2 lands. They encode a competing order with no callers, and leaving them invites a
  future reader to implement against them.
- `GateManager.getCategoryGates()` is deleted once its last caller is gone. Per the `registry-auto`
  decision above it is not a resolution path, and its hand-rolled `gate_type: 'framework'` filter
  re-implements what the activation rules already decide.
- `EnhancedGateConfiguration` and the `enhancedGateConfiguration` field (F2) are deleted or given a
  writer in the same change. A read-only phantom field that silently disables a documented flag is
  the defect, not a compatibility surface.

## Prior art

The model above was checked against five systems that resolve policy from layered sources. Three
findings are convergent across systems designed independently of each other, which is the reason
they are adopted here rather than treated as one option among several.

| System                       | Mechanism                                                                                                                                                                            | What it settles here                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes dynamic admission | Mutating phase runs first, then validating; validating webhooks are **called in parallel and any rejection fails the request**, so validation observes the final post-mutation state | The two-stage split, and that the subtractive stage is order-independent by construction                                                                                              |
| OPA / Rego                   | Statement order "does not matter — reordering any two statements means the policy means exactly the same thing"; deny-override denies if at least one rule denies                    | Monotonic vetoes are what make layered composition tractable; ordering a commutative set buys nothing                                                                                 |
| AWS Cedar                    | Default-deny, forbid-wins-over-permit, order-independent evaluation, no side effects — designed so guardrails "cannot be accidentally overridden"                                    | The veto-scope column in Stage 2. Cedar's unconditional forbid-wins is justified as a _safety_ property, which is why it is adopted for methodology nesting but **not** for `exclude` |
| CSS cascade layers           | Layer precedence is evaluated **before** selector specificity; `revert-layer` opts an element out of one layer                                                                       | Stage 1 unchanged — explicit named layers outrank finer-grained strength, which is what `GATE_SOURCE_PRIORITY` already is. `exclude` is our `revert-layer`                            |
| ESLint flat config           | Replaced the implicit `eslintrc` directory cascade with one explicit array, last-match-wins                                                                                          | Names our actual failure mode: the cascade was abandoned because of "confusion about which rules were actually being applied" — F1/F2/F3 are that confusion                           |
| `webpack-merge`              | Per-key strategies (`append`, `prepend`, `replace`, `unique`) declared explicitly rather than one global deep merge                                                                  | The per-field table in (b)                                                                                                                                                            |

Two cautions taken from the same sources:

- **Kubernetes orders webhooks _within_ a phase** by configuration name. That is an operational
  tiebreak for independently-authored webhooks, not a semantic one. It is not adopted: our veto set
  is closed and known at build time, so alphabetical ordering would add a rule with no meaning.
- **ESLint had to reintroduce `extends`** after removing it, because pure explicitness made common
  compositions verbose. Read as a caution against over-purifying: (b) keeps field inheritance rather
  than requiring every inline definition to restate a full gate body.

## Alternatives considered

1. **Make higher-priority sources subtractive** — let `inline-operator` replace the whole set rather
   than union into it. Rejected: it discards category and safety gates on any command carrying a
   `::` operator, and it contradicts `GateAccumulator`'s contract, which every current source is
   written against. The narrow version of this is `exclude`, which already exists.
2. **Revive `selectGatesWithEnhancedPrecedence` as the canonical resolver** — it reads as a complete
   precedence implementation. Rejected: it predates the accumulator, has no provenance tracking, no
   callers, and carries the `framework_gates` conflation (F3). Adopting it would mean porting the
   accumulator's diagnostics onto it.
3. **Gate the nesting rule behind a flag** (`enableMethodologyGateNesting`). Rejected under the
   parity-gate rule in `cleanup-standards.md`: it would ship a permanent second code path for a
   defect fix whose correct outcome is verifiable offline, with no stated evidence that would ever
   retire it.
4. **Mark `inline_gate_definitions` unsupported and delete it** — the cheapest resolution of F5.
   Rejected because the field is documented as working, the registration seam already exists, and
   removing it costs the same doc/changelog churn as arming it while delivering less.
5. **Do nothing.** Rejected: T2 and T3 are both blocked on an answer, and F2's inert flag means a
   prompt author writing `framework_gates: false` today receives no error and no effect.

## Consequences

### Positive

- One order, stated once, that T2 and T3 can be tested against rather than inferred from.
- F2 and F3 stop being latent: the phantom field and the dead resolver are on a removal path instead
  of waiting to mislead the next reader.
- `%lean` becomes coherent — no gate scores adherence to a methodology that was not injected.
- Prompt authors get a real opt-out, replacing the `%clean` / `%lean` call-site workaround, which is
  per-request and so is lost on chain continuations.

### Negative / risks

| Risk                                                                                                     | Mitigation                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspaces with inert `inline_gate_definitions` gain live gates on upgrade                               | Two-release warn-then-arm (d); changelog entry                                                                                                                                |
| `framework_gates: false` starts having an effect where it previously had none, in either direction       | It only ever gated methodology gates in its documented meaning; the F3 category conflation was never live, so no shipped behavior depends on it                               |
| Prompt tier placed above chain surprises a chain author who expected chain config to win                 | Documented in the 8-level table; the prompt tier is opt-in per prompt and absent by default                                                                                   |
| A prompt author expects `exclude` to remove a gate the caller supplied, and it does not (rank cap of 60) | Stated in the Stage 2 table and surfaced in the (a) test; the author-facing alternative is to not include the gate rather than to exclude someone else's                      |
| A future veto is added that is genuinely order-dependent, breaking the commutativity the model assumes   | The permutation property test in Validation fails when a non-commutative veto is introduced, which is the intended signal to revisit this ADR rather than to reorder silently |
| Deleting the dead resolver breaks an out-of-tree consumer                                                | Both methods are private to a class with no export path to consumers outside `engine/execution/planning`                                                                      |

### Follow-ups

- Plan `plans/techincal_debt/arg-gate-pipeline-fixes.md` T2 (2.1-2.5) and T3 (3.1-3.5) are unblocked
  by this ADR.
- **Correction to plan item 2.4**: its named file, `gate-enforcement-authority.ts`, owns verdict
  parsing, enforcement-mode resolution and retry limits — not selection. The nesting rule belongs
  where the gate set and the injection decision are both in hand: `execution-planner.ts`
  (`applyModifierOverrides`) and `gate-enhancement-service.ts`, which already receives
  `methodologyGates` as a parameter. Retarget 2.4 before implementing it.
- Delete the two dead `CategoryExtractor` methods and resolve `enhancedGateConfiguration` (new plan
  rows under T2).
- `docs/guides/injection-control.md:77` needs its `%lean` line narrowed to "keeps non-framework
  gates".

## Validation

- `npm run typecheck && npm run lint:ratchet && npm run test:ci`
- `npm run validate:arch` — required, because (b) moves definition data from `modules/prompts` into
  `engine/gates`.
- Behavioral checks that prove each answer, to be written with the tier that implements it:
  - (a) a prompt naming a gate in both `include` and `exclude` resolves to excluded; a gate the
    caller supplies at rank 80/90/100 **survives** a prompt-level `exclude` naming it.
  - (a) the veto set is order-independent: applying the four vetoes in any permutation yields the
    same set. Worth a property test over permutations rather than one fixed-order assertion.
  - (b) a prompt whose inline definition reuses a registry gate ID yields one entry in the executed
    set, carrying the inline body; a field the inline definition omits retains the registry value,
    and a `criteria` array it declares replaces rather than extends the registry array.
  - (c) under `%lean`, zero gates with `gate_type: 'framework'` are scheduled; non-framework gates
    are unchanged.
  - (d) a prompt with no `inline_gate_definitions` produces a byte-identical gate set before and
    after the change.
- Transport parity: resolution runs inside the pipeline, so a STDIO smoke check covers SSE.

## References

- Plan: `plans/techincal_debt/arg-gate-pipeline-fixes.md` (T1 row 1.1; T2/T3 gated on this ADR)
- Issue log: `docs/TODO.md` § Known Issues — Argument & Gate Pipeline
- `docs/guides/injection-control.md` (hierarchy, modifiers), `docs/guides/gates.md`,
  `docs/reference/prompt-yaml-schema.md`, `docs/reference/gate-configuration.md`
- Flag policy: global `cleanup-standards.md` § Parity Gates Are Debt, Not Safety

Prior-art sources (surveyed 2026-07-29):

- [Kubernetes — Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/)
  (two-phase order; validating webhooks called in parallel, any rejection fails the request)
- [Open Policy Agent — FAQ](https://www.openpolicyagent.org/docs/faq) (statement order does not
  affect meaning; allow/deny precedence is an explicit authoring choice, not a language keyword)
- [How we designed Cedar to be intuitive to use, fast, and safe — AWS Security Blog](https://aws.amazon.com/blogs/security/how-we-designed-cedar-to-be-intuitive-to-use-fast-and-safe/)
  and [Cedar policy syntax](https://docs.cedarpolicy.com/policies/syntax-policy.html)
  (default-deny, forbid-wins, order-independent evaluation)
- [Cascade Layers Guide — CSS-Tricks](https://css-tricks.com/css-cascade-layers/) and
  [Cascade layers — MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/Cascade_layers)
  (layer precedence evaluated before specificity; `revert-layer`)
- [ESLint's new config system, Part 2 — Introduction to flat config](https://eslint.org/blog/2022/08/new-config-system-part-2/)
  and [Evolving flat config with extends](https://eslint.org/blog/2025/03/flat-config-extends-define-config-global-ignores/)
  (cascade removed to end ambiguity about applied rules; `extends` later reintroduced)
- [`webpack-merge`](https://www.npmjs.com/package/webpack-merge) (`mergeWithCustomize`,
  per-key `append` / `prepend` / `replace` / `unique` strategies)
