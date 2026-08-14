// @lifecycle canonical - Sole owner of the P5 per-step visibility decision.

import type {
  DecideVisibilityInput,
  StepVisibilityProjection,
  VisibilityDecision,
  VisibilityItem,
} from './types.js';

/**
 * Decide which context items are withheld from, or exposed to, one step's render.
 *
 * Pure: no I/O, no mutation of `input`, no pipeline/context dependency — matches the sibling
 * decision modules (`mutation/mutation-policy.ts::decideMutation`,
 * `gates/enforcement-mode.ts::resolveEnforcementMode`). The caller (Tier 3) applies the
 * returned {@link VisibilityDecision} by filtering the actual render context and formatting the
 * delegation manifest line; this function never touches either.
 *
 * It also never validates `VisibilityItem` vocabulary. Unknown item strings are rejected by
 * `ChainStepSchema.visibility`'s Zod validation at parse time (`prompt-schema.ts`) — by the
 * time a declaration reaches here it is already-typed input, and re-checking it would restate a
 * rule this module does not own (mirrors `decideMutation` trusting `entry.blocking` rather than
 * re-deriving the ledger's own defaults).
 *
 * Semantics (frozen — plan §Semantics to implement):
 * - No declarations anywhere → nothing withheld, nothing exposed, empty manifest. Absence of
 *   policy changes nothing.
 * - A PRIOR step's `withhold: [item]` withholds that item from every step after it, by default.
 * - The CURRENT step's `expose: [item]` overrides a prior withhold FOR THIS STEP ONLY — the
 *   item flows and is reported in `exposed`. `expose`-ing an item nobody withheld is a no-op
 *   that still appears in `exposed` (nothing to override, but the ask is still on record).
 * - The current step's own `withhold` is never read here — it affects later steps' calls to
 *   this function, not this one (the caller passes it back as a `priorDeclarations` entry on a
 *   later call, never as part of `step`).
 * - `manifest` is `withheld` after overrides, named separately for the caller's benefit (see
 *   {@link VisibilityDecision.manifest} doc-comment) — never a separate computation.
 */
export function decideVisibility(input: DecideVisibilityInput): VisibilityDecision {
  const withheldByPriors = collectDeclaredItems(input.priorDeclarations, 'withhold');
  const exposedByCurrent = collectDeclaredItems([input.step], 'expose');

  const withheld: VisibilityItem[] = [];
  const exposed: VisibilityItem[] = [];

  for (const item of withheldByPriors) {
    if (exposedByCurrent.has(item)) {
      exposed.push(item);
    } else {
      withheld.push(item);
    }
  }

  for (const item of exposedByCurrent) {
    if (!withheldByPriors.has(item)) {
      exposed.push(item);
    }
  }

  return { withheld, exposed, manifest: withheld };
}

/**
 * Collect the union of `field` (`withhold` or `expose`) across a set of step projections, in
 * first-declared order. A plain `Set` traversal rather than a fixed enumeration of
 * `VisibilityItem`'s members — see the module docblock's "never validates vocabulary" note;
 * enumerating the known vocabulary here would silently drop any value the schema layer did not
 * already filter, which is exactly the check this module is not supposed to own.
 */
function collectDeclaredItems(
  declarations: readonly StepVisibilityProjection[],
  field: 'withhold' | 'expose'
): Set<VisibilityItem> {
  const items = new Set<VisibilityItem>();
  for (const declaration of declarations) {
    for (const item of declaration.visibility?.[field] ?? []) {
      items.add(item);
    }
  }
  return items;
}
