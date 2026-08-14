// @lifecycle canonical - Exhaustive branch coverage for the P5 per-step visibility decision.
import { describe, expect, test } from '@jest/globals';

import { decideVisibility } from '../../../../src/engine/execution/pipeline/decisions/visibility/index.js';

import type {
  DecideVisibilityInput,
  StepVisibilityProjection,
  VisibilityDecision,
  VisibilityItem,
} from '../../../../src/engine/execution/pipeline/decisions/visibility/index.js';

/**
 * Each test's comment names the guard in `visibility-policy.ts` it exercises, mirroring
 * `mutation-policy.test.ts` — a future regression review can map a failing test straight back
 * to the branch that broke.
 */
function step(overrides: Partial<StepVisibilityProjection> = {}): StepVisibilityProjection {
  return { ...overrides };
}

function withholding(...items: VisibilityItem[]): StepVisibilityProjection {
  return { visibility: { withhold: items } };
}

function exposing(...items: VisibilityItem[]): StepVisibilityProjection {
  return { visibility: { expose: items } };
}

function buildInput(overrides: Partial<DecideVisibilityInput> = {}): DecideVisibilityInput {
  return {
    step: step(),
    priorDeclarations: [],
    ...overrides,
  };
}

/**
 * `expect(x).toEqual<T>(...)` generic call syntax is rejected by this repo's `@jest/globals`
 * types (TS2558, confirmed by `mutation-policy.test.ts` D-T1-2 for the sibling module — same
 * `@jest/globals` version, same constraint). Routing every assertion through a helper typed on
 * `expected: VisibilityDecision` preserves compile-time shape-checking without it.
 */
function expectDecision(actual: VisibilityDecision, expected: VisibilityDecision): void {
  expect(actual).toEqual(expected);
}

describe('decideVisibility', () => {
  test('no declarations anywhere: everything flows, decision is fully empty', () => {
    // Guard: both collectDeclaredItems calls return empty sets — both loops in decideVisibility
    // never execute, so withheld/exposed/manifest all stay at their initial [].
    const result = decideVisibility(buildInput());

    expectDecision(result, { withheld: [], exposed: [], manifest: [] });
  });

  test('withhold without expose: item stays withheld and appears on the manifest', () => {
    // Guard: withheldByPriors non-empty, exposedByCurrent empty — the
    // `exposedByCurrent.has(item)` check is false, so the item goes to `withheld`, not
    // `exposed`. Discriminates the withhold branch: if a mutant deleted this push, `withheld`
    // would come back [] here even though a prior declared it.
    const result = decideVisibility(
      buildInput({
        priorDeclarations: [withholding('chain_history')],
      })
    );

    expectDecision(result, {
      withheld: ['chain_history'],
      exposed: [],
      manifest: ['chain_history'],
    });
  });

  test('withhold+later expose: the current step exposing a prior-withheld item overrides it for this step only', () => {
    // Guard: withheldByPriors AND exposedByCurrent both contain the item — the override branch
    // (`exposedByCurrent.has(item)` true) routes it to `exposed`, never to `withheld`.
    // Discriminates the expose-override branch: if a mutant neutered this check (always false),
    // the item would land in `withheld` instead, and `manifest` would wrongly include it.
    const result = decideVisibility(
      buildInput({
        priorDeclarations: [withholding('unknowns_ledger')],
        step: exposing('unknowns_ledger'),
      })
    );

    expectDecision(result, {
      withheld: [],
      exposed: ['unknowns_ledger'],
      manifest: [],
    });
  });

  test('expose without withhold: a no-op that still appears in exposed', () => {
    // Guard: the second loop's `!withheldByPriors.has(item)` branch — nothing was withheld, so
    // the item is never considered in the first loop, but it is still recorded via the second.
    // Distinct from the override test above: no prior declaration exists at all here.
    const result = decideVisibility(
      buildInput({
        step: exposing('previous_step_output'),
      })
    );

    expectDecision(result, {
      withheld: [],
      exposed: ['previous_step_output'],
      manifest: [],
    });
  });

  test('two priors withholding the same item + one expose still exposes it once', () => {
    // Guard: `withheldByPriors` is a Set, so duplicate withholds across multiple prior steps
    // collapse to one membership check — the override still fires exactly once, no duplicate
    // entries in `exposed`.
    const result = decideVisibility(
      buildInput({
        priorDeclarations: [withholding('chain_history'), withholding('chain_history')],
        step: exposing('chain_history'),
      })
    );

    expectDecision(result, { withheld: [], exposed: ['chain_history'], manifest: [] });
  });

  test('withhold in a LATER step does not affect an EARLIER step', () => {
    // Guard: decideVisibility only ever reads `priorDeclarations` — a later step's withhold,
    // correctly excluded from an earlier step's priorDeclarations slice by the caller contract,
    // has no channel to reach this call. Modelled here by calling for "step 0" with the empty
    // slice its position actually has, even though a later step (never passed in) withholds the
    // same item — proving the decision is a pure function of what is actually in the input, not
    // of some ambient run-wide state.
    const laterStepDeclaration = withholding('unknowns_ledger'); // step 1 — never passed below

    const earlierStepResult = decideVisibility(
      buildInput({
        step: step(),
        priorDeclarations: [], // step 0 has no steps before it, including the one above
      })
    );

    expectDecision(earlierStepResult, { withheld: [], exposed: [], manifest: [] });
    // Sanity: the later declaration is real and would withhold if it were ever a prior.
    expect(laterStepDeclaration.visibility?.withhold).toEqual(['unknowns_ledger']);
  });

  test('a withheld item independent of others: only the declared item is affected, not the full vocabulary', () => {
    // Guard: `collectDeclaredItems` builds its Set purely from declared values — it does not
    // enumerate `VisibilityItem`'s full membership, so an item nobody mentioned never appears
    // in withheld, exposed, or manifest.
    const result = decideVisibility(
      buildInput({
        priorDeclarations: [withholding('chain_history')],
      })
    );

    expect(result.withheld).not.toContain('previous_step_output');
    expect(result.withheld).not.toContain('unknowns_ledger');
    expect(result.exposed).toEqual([]);
  });

  test('unknown item rejected at schema not policy: an unrecognized item string passes through untouched, not thrown or filtered', () => {
    // Guard: `collectDeclaredItems` performs no membership check against the known
    // `VisibilityItem` union — it trusts typed input (module docblock). Zod already rejects an
    // unknown item at `ChainStepSchema.visibility` parse time; this test proves the POLICY layer
    // itself has no second, redundant validation that would behave differently (e.g. silently
    // drop the value or throw) if a caller ever bypassed the schema.
    const unrecognizedItem = 'made_up_item' as unknown as VisibilityItem;

    const result = decideVisibility(
      buildInput({
        priorDeclarations: [withholding(unrecognizedItem)],
      })
    );

    expectDecision(result, {
      withheld: [unrecognizedItem],
      exposed: [],
      manifest: [unrecognizedItem],
    });
  });
});
