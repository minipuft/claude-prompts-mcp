/**
 * Pins the eslint-ratchet.js baseline-increase guard: `update-baseline` used to write a fresh
 * ceiling unconditionally, with nothing comparing it against the previous baseline, so a live
 * regression could become the new floor silently. `findUnauthorizedIncreases` +
 * `buildOverrideLog` are the fix — this file is the automated proof the refusal actually works,
 * where before it was only checked by hand with a planted mutation (row B.39).
 *
 * The dispatcher at the bottom of eslint-ratchet.js is guarded by
 * `process.argv[1] === fileURLToPath(import.meta.url)`, so importing these functions here does
 * not spawn ESLint or touch the committed baseline file.
 */

import { describe, expect, it } from '@jest/globals';

import {
  buildOverrideLog,
  compareSummaries,
  findUnauthorizedIncreases,
  parseAllowIncreaseArgs,
} from '../../../scripts/eslint-ratchet.js';

describe('eslint-ratchet findUnauthorizedIncreases', () => {
  it('refuses an increase and names the rule', () => {
    const increases = findUnauthorizedIncreases(
      { 'no-useless-assignment': { errors: 0, warnings: 0 } },
      { 'no-useless-assignment': { errors: 1, warnings: 0 } },
      new Map()
    );

    expect(increases).toEqual([
      {
        ruleId: 'no-useless-assignment',
        before: { errors: 0, warnings: 0 },
        after: { errors: 1, warnings: 0 },
      },
    ]);
  });

  it('treats a rule missing from the baseline as an increase from an implicit zero', () => {
    const increases = findUnauthorizedIncreases(
      {},
      { 'brand-new-rule': { errors: 2, warnings: 0 } },
      new Map()
    );

    expect(increases.some((i) => i.ruleId === 'brand-new-rule')).toBe(true);
  });

  it('clears the refusal once the rule is named via an explicit override', () => {
    const increases = findUnauthorizedIncreases(
      { 'no-useless-assignment': { errors: 0, warnings: 0 } },
      { 'no-useless-assignment': { errors: 1, warnings: 0 } },
      new Map([['no-useless-assignment', 'reason']])
    );

    expect(increases).toEqual([]);
  });

  it('does not let an override for one rule clear an increase in another', () => {
    const increases = findUnauthorizedIncreases(
      { a: { errors: 1, warnings: 0 }, b: { errors: 1, warnings: 0 } },
      { a: { errors: 2, warnings: 0 }, b: { errors: 1, warnings: 0 } },
      new Map([['b', 'unrelated reason']])
    );

    expect(increases.map((i) => i.ruleId)).toEqual(['a']);
  });

  it('passes a decrease with no override needed', () => {
    const increases = findUnauthorizedIncreases(
      { 'strict-boolean-expressions': { errors: 10, warnings: 0 } },
      { 'strict-boolean-expressions': { errors: 5, warnings: 0 } },
      new Map()
    );

    expect(increases).toEqual([]);
  });

  it('passes a rule that disappears entirely with no override needed', () => {
    const increases = findUnauthorizedIncreases(
      { retiring: { errors: 3, warnings: 0 } },
      {},
      new Map()
    );

    expect(increases).toEqual([]);
  });

  it('gives __unknown__ no special case — it is refused and overridden like any rule', () => {
    const refused = findUnauthorizedIncreases(
      { __unknown__: { errors: 0, warnings: 5 } },
      { __unknown__: { errors: 0, warnings: 6 } },
      new Map()
    );
    expect(refused.map((i) => i.ruleId)).toEqual(['__unknown__']);

    const overridden = findUnauthorizedIncreases(
      { __unknown__: { errors: 0, warnings: 5 } },
      { __unknown__: { errors: 0, warnings: 6 } },
      new Map([['__unknown__', 'reason']])
    );
    expect(overridden).toEqual([]);
  });
});

describe('eslint-ratchet buildOverrideLog', () => {
  it('records the reason for an override that was actually needed', () => {
    const { overrideLog, unused } = buildOverrideLog(
      undefined,
      new Map([['no-useless-assignment', 'planted for the demo']]),
      { 'no-useless-assignment': { errors: 0, warnings: 0 } },
      { 'no-useless-assignment': { errors: 1, warnings: 0 } },
      '2026-09-16T00:00:00.000Z'
    );

    expect(overrideLog).toEqual([
      {
        date: '2026-09-16T00:00:00.000Z',
        ruleId: 'no-useless-assignment',
        reason: 'planted for the demo',
        before: { errors: 0, warnings: 0 },
        after: { errors: 1, warnings: 0 },
      },
    ]);
    expect(unused).toEqual([]);
  });

  it('appends to a previous overrideLog rather than replacing it', () => {
    const previous = [
      {
        date: '2026-09-01T00:00:00.000Z',
        ruleId: 'no-explicit-any',
        reason: 'earlier override',
        before: { errors: 100, warnings: 0 },
        after: { errors: 101, warnings: 0 },
      },
    ];

    const { overrideLog } = buildOverrideLog(
      previous,
      new Map([['no-useless-assignment', 'new override']]),
      { 'no-useless-assignment': { errors: 0, warnings: 0 } },
      { 'no-useless-assignment': { errors: 1, warnings: 0 } },
      '2026-09-16T00:00:00.000Z'
    );

    expect(overrideLog).toHaveLength(2);
    expect(overrideLog[0]).toEqual(previous[0]);
    expect(overrideLog[1].ruleId).toBe('no-useless-assignment');
  });

  it('reports an override as unused, and does not log it, when nothing increased', () => {
    const { overrideLog, unused } = buildOverrideLog(
      undefined,
      new Map([['strict-boolean-expressions', 'not actually needed']]),
      { 'strict-boolean-expressions': { errors: 10, warnings: 0 } },
      { 'strict-boolean-expressions': { errors: 5, warnings: 0 } },
      '2026-09-16T00:00:00.000Z'
    );

    expect(overrideLog).toEqual([]);
    expect(unused).toEqual(['strict-boolean-expressions']);
  });
});

describe('eslint-ratchet parseAllowIncreaseArgs', () => {
  it('reads repeatable --allow-increase <ruleId> <reason> pairs', () => {
    const overrides = parseAllowIncreaseArgs([
      '--allow-increase',
      'rule-a',
      'reason a',
      '--allow-increase',
      'rule-b',
      'reason b',
    ]);

    expect(overrides.get('rule-a')).toBe('reason a');
    expect(overrides.get('rule-b')).toBe('reason b');
  });

  it('throws when a pair is incomplete', () => {
    expect(() => parseAllowIncreaseArgs(['--allow-increase', 'rule-a'])).toThrow(
      /--allow-increase/
    );
  });
});

describe('eslint-ratchet compareSummaries (pre-existing check() logic)', () => {
  it('reports a rule regression distinctly from a vanished rule', () => {
    const baseline = {
      byRule: {
        'rule-up': { errors: 1, warnings: 0 },
        'rule-gone': { errors: 2, warnings: 0 },
      },
    };
    const current = {
      byRule: {
        'rule-up': { errors: 2, warnings: 0 },
      },
    };

    const { regressions, vanished } = compareSummaries(baseline, current);
    expect(regressions).toEqual([{ ruleId: 'rule-up', type: 'errors', baseline: 1, current: 2 }]);
    expect(vanished).toEqual([{ ruleId: 'rule-gone', errors: 2, warnings: 0 }]);
  });
});
