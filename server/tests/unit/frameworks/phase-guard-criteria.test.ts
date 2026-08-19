/**
 * Phase-guard criteria registry.
 *
 * Two things are under test and they are not the same thing: that each criterion still evaluates
 * as it did before the registry replaced the hardcoded branch chain, and that the declarability
 * split holds — positive criteria may be told to the model, negative ones may never be.
 */

import {
  GUARD_CRITERIA,
  declareCriteria,
} from '../../../src/engine/frameworks/phase-guards/criteria.js';

import type { ProcessingStep } from '../../../src/engine/frameworks/types/framework-types.js';

type PhaseGuards = NonNullable<ProcessingStep['guards']>;

const criterion = (key: string) => {
  const found = GUARD_CRITERIA.find((c) => c.key === key);
  if (!found) throw new Error(`no criterion registered for '${key}'`);
  return found;
};

const PLACEHOLDERS = ['TODO', 'TBD', 'placeholder'];

describe('GUARD_CRITERIA registry', () => {
  it('registers every content criterion the guards schema allows, and not `required`', () => {
    expect(GUARD_CRITERIA.map((c) => c.key)).toEqual([
      'min_length',
      'max_length',
      'contains_any',
      'contains_all',
      'matches_pattern',
      'forbidden_terms',
    ]);
  });

  it('only applies a criterion the phase actually configures', () => {
    const guards: PhaseGuards = { min_length: 10 };
    expect(criterion('min_length').applies(guards)).toBe(true);
    expect(criterion('contains_any').applies(guards)).toBe(false);
    // An empty list is not a configured criterion — it would otherwise pass vacuously forever.
    expect(criterion('contains_any').applies({ contains_any: [] })).toBe(false);
    expect(criterion('forbidden_terms').applies({ forbidden_terms: [] })).toBe(false);
  });
});

describe('criterion evaluation', () => {
  it('min_length fails short content and names the threshold', () => {
    const result = criterion('min_length').evaluate({ min_length: 100 }, 'too short', '## Context');
    expect(result).toMatchObject({ type: 'min_length', passed: false, expected: 100, actual: 9 });
    expect(result.feedback).toContain('at least 100 characters');
  });

  it('contains_any passes on one match, case-insensitively', () => {
    const guards: PhaseGuards = { contains_any: ['OKLCH', 'pigment'] };
    expect(criterion('contains_any').evaluate(guards, 'uses oklch here', '## Draw').passed).toBe(
      true
    );
    expect(criterion('contains_any').evaluate(guards, 'nothing relevant', '## Draw').passed).toBe(
      false
    );
  });

  it('contains_all reports only the missing terms', () => {
    const result = criterion('contains_all').evaluate(
      { contains_all: ['alpha', 'beta'] },
      'alpha only',
      '## Goals'
    );
    expect(result.passed).toBe(false);
    expect(result.feedback).toContain('"beta"');
    expect(result.feedback).not.toContain('"alpha"');
  });

  it('forbidden_terms matches on word boundaries, not substrings', () => {
    const evaluate = (content: string) =>
      criterion('forbidden_terms').evaluate({ forbidden_terms: PLACEHOLDERS }, content, '## X');
    expect(evaluate('this has a TODO left').passed).toBe(false);
    // 'TODOS' must not trip the 'TODO' term — the pre-registry implementation used \b for this.
    expect(evaluate('mentions TODOS in passing').passed).toBe(true);
  });

  it('matches_pattern reports an invalid regex instead of throwing', () => {
    const result = criterion('matches_pattern').evaluate(
      { matches_pattern: '([unclosed' },
      'any content',
      '## X'
    );
    expect(result.passed).toBe(false);
    expect(result.feedback).toContain('not a valid regex');
  });
});

describe('declarability', () => {
  it('declares an unguessable keyword list', () => {
    expect(declareCriteria({ contains_any: ['album', 'pigment'] })).toEqual([
      'mentions one of "album", "pigment"',
    ]);
  });

  it('declares a maximum length but not a minimum', () => {
    expect(declareCriteria({ max_length: 400 })).toEqual(['at most 400 characters']);
    expect(declareCriteria({ min_length: 100 })).toEqual([]);
  });

  it('never declares a negative criterion', () => {
    // The security-relevant invariant: telling the model what is rejected describes the evasion
    // target. `forbidden_terms` and `matches_pattern` are evaluated but must stay unspoken.
    expect(declareCriteria({ forbidden_terms: PLACEHOLDERS })).toEqual([]);
    expect(declareCriteria({ matches_pattern: '\\d{16}' })).toEqual([]);

    const negatives = GUARD_CRITERIA.filter((c) => c.polarity === 'negative');
    expect(negatives.map((c) => c.key)).toEqual(['matches_pattern', 'forbidden_terms']);
    for (const c of negatives) {
      expect(c.declare).toBeUndefined();
    }
  });

  it('declares nothing for the guard shape every shipped framework actually uses', () => {
    // CAGEERF and five others configure only min_length + forbidden_terms: one deliberately
    // undeclared, one structurally undeclarable. The header alone carries the declaration.
    expect(
      declareCriteria({ required: true, min_length: 100, forbidden_terms: PLACEHOLDERS })
    ).toEqual([]);
  });

  it('treats absent guards as declaring nothing', () => {
    expect(declareCriteria(undefined)).toEqual([]);
  });
});
