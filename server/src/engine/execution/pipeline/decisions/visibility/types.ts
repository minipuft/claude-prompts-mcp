// @lifecycle canonical - Type definitions for the P5 per-step visibility decision.

import type { VisibilityItem } from '#shared/types/chain-execution.js';

// Re-export so callers importing from this module never need a second import from
// `#shared/types/chain-execution.js` just to name the item vocabulary. `VisibilityItem` itself
// stays declared there (Tier 1 SSOT) — this is a re-export, not a redeclaration.
export type { VisibilityItem };

/**
 * A step's raw visibility declaration, as parsed from `prompt.yaml` (mirrors
 * `ChainStepPrompt['visibility']` / `ChainStepSchema.visibility`).
 *
 * Declared independently of `ChainStepPrompt` rather than imported from
 * `engine/execution/operators/types.ts` — this module lives in `decisions/`, which by
 * convention (sibling `mutation/types.ts`) takes the minimal projection of a domain type, not
 * the domain type itself. Importing `ChainStepPrompt` here would pull the whole chain-operator
 * type surface into a pure decision module for two optional array fields, and would force every
 * test in 2.2 to build a heavier fixture than the policy actually reads.
 */
export interface VisibilityDeclaration {
  readonly withhold?: readonly VisibilityItem[];
  readonly expose?: readonly VisibilityItem[];
}

/**
 * The minimal per-step projection {@link decideVisibility} needs: an optional declaration, and
 * an optional node id carried through for future diagnostics/manifest labelling (v1 never reads
 * it — see {@link DecideVisibilityInput.step} and `priorDeclarations` below).
 *
 * This is the shape the Tier 3 caller is expected to build from `stepPrompts` — one entry per
 * step, in run order, `visibility` copied through unchanged.
 */
export interface StepVisibilityProjection {
  readonly nodeId?: string;
  readonly visibility?: VisibilityDeclaration;
}

/**
 * Inputs to {@link decideVisibility}. Deliberately plain data, not `ExecutionContext` or any
 * pipeline/chain type — matches the sibling decision modules (`mutation/mutation-policy.ts`,
 * `gates/enforcement-mode.ts`, `injection/injection-decision-service.ts`).
 */
export interface DecideVisibilityInput {
  /** The step being rendered right now. Only `visibility.expose` is read — a step's own
   * `withhold` affects LATER steps, never itself (frozen semantics, plan §Semantics). */
  readonly step: StepVisibilityProjection;
  /**
   * Declarations of every step BEFORE the current one, in run order. Only `visibility.withhold`
   * is read from these — a prior step's own `expose` has no bearing on a later step's
   * visibility; `expose` only ever overrides withholding FOR THE STEP THAT DECLARES IT.
   *
   * Deliberately not `readonly ChainStepPrompt[]` — see {@link StepVisibilityProjection}. The
   * caller is expected to slice `stepPrompts` to the steps preceding the current index; this
   * function trusts that slice and does not re-derive ordering itself (it has no ordinal
   * input to do so with, unlike `DecideMutationInput.nodes`).
   */
  readonly priorDeclarations: readonly StepVisibilityProjection[];
}

/**
 * A deterministic visibility decision for one step's render.
 *
 * Pure data — `decideVisibility` never applies this or touches context. The caller (Tier 3)
 * owns filtering the actual render context and formatting the delegation manifest line from
 * these names.
 */
export interface VisibilityDecision {
  /** Items withheld from THIS step's render, after this step's own `expose` overrides have been
   * applied. An item withheld by a prior step but exposed again by this step does NOT appear
   * here — see `exposed`. */
  readonly withheld: readonly VisibilityItem[];
  /**
   * Items this step's own `expose` names, whether or not a prior `withhold` made the override
   * meaningful. `expose`-ing an item nobody withheld is a documented no-op (plan §Semantics /
   * standing lessons) — the item still appears here, since the caller cares "this step asked
   * for X" independent of whether asking changed anything.
   */
  readonly exposed: readonly VisibilityItem[];
  /**
   * Item NAMES to report on the delegation manifest line — OQ-P5-3: names only, never values.
   * Equal to `withheld` in v1 (both answer "what does this step not get") but kept as a
   * separate field because the two are read for different purposes downstream: `withheld`
   * drives context filtering, `manifest` drives the honesty-boundary text a subagent sees. A
   * future divergence (e.g. an item withheld but deliberately unreported) would need only this
   * field to change.
   */
  readonly manifest: readonly VisibilityItem[];
}
