/**
 * Pins the knip-ratchet.js baseline-increase guard: `update-baseline` used to write a fresh
 * ceiling unconditionally, with nothing comparing it against the previous baseline, so a live
 * regression could become the new floor silently. `findUnauthorizedIncreases` +
 * `buildOverrideLog` are the fix. knip-ratchet.js already has `--self-test` (a synthetic-data
 * CLI harness), extended in the same row to cover this guard — this Jest file additionally pins
 * it through the project's own test surface (`tests/unit/scripts`), which no prior gate ran for
 * this script.
 *
 * The dispatcher at the bottom of knip-ratchet.js is guarded by
 * `process.argv[1] === fileURLToPath(import.meta.url)`, so importing these functions here does
 * not spawn knip or touch the committed baseline file.
 */

import { describe, expect, it } from '@jest/globals';

import {
  buildOverrideLog,
  compareSummaries,
  findUnauthorizedIncreases,
  parseAllowIncreaseArgs,
} from '../../../scripts/knip-ratchet.js';

describe('knip-ratchet findUnauthorizedIncreases', () => {
  it('refuses an increase and names the category', () => {
    const increases = findUnauthorizedIncreases({ exports: 10 }, { exports: 12 }, new Map());

    expect(increases).toEqual([{ category: 'exports', before: 10, after: 12 }]);
  });

  it('treats a category missing from the baseline as an increase from an implicit zero', () => {
    const increases = findUnauthorizedIncreases({}, { files: 1 }, new Map());

    expect(increases).toEqual([{ category: 'files', before: 0, after: 1 }]);
  });

  it('clears the refusal once the category is named via an explicit override', () => {
    const increases = findUnauthorizedIncreases(
      { exports: 10 },
      { exports: 12 },
      new Map([['exports', 'reason']])
    );

    expect(increases).toEqual([]);
  });

  it('passes a decrease with no override needed', () => {
    const increases = findUnauthorizedIncreases({ types: 678 }, { types: 670 }, new Map());

    expect(increases).toEqual([]);
  });

  it('passes a category that disappears entirely with no override needed', () => {
    const increases = findUnauthorizedIncreases({ retiring: 3 }, {}, new Map());

    expect(increases).toEqual([]);
  });
});

describe('knip-ratchet buildOverrideLog', () => {
  it('records the reason for an override that was actually needed', () => {
    const { overrideLog, unused } = buildOverrideLog(
      undefined,
      new Map([['files', 'planted for the demo']]),
      { files: 11 },
      { files: 12 },
      '2026-09-16T00:00:00.000Z'
    );

    expect(overrideLog).toEqual([
      {
        date: '2026-09-16T00:00:00.000Z',
        category: 'files',
        reason: 'planted for the demo',
        before: 11,
        after: 12,
      },
    ]);
    expect(unused).toEqual([]);
  });

  it('appends to a previous overrideLog rather than replacing it', () => {
    const previous = [
      {
        date: '2026-09-01T00:00:00.000Z',
        category: 'exports',
        reason: 'earlier override',
        before: 480,
        after: 485,
      },
    ];

    const { overrideLog } = buildOverrideLog(
      previous,
      new Map([['files', 'new override']]),
      { files: 11 },
      { files: 12 },
      '2026-09-16T00:00:00.000Z'
    );

    expect(overrideLog).toHaveLength(2);
    expect(overrideLog[0]).toEqual(previous[0]);
    expect(overrideLog[1].category).toBe('files');
  });

  it('reports an override as unused, and does not log it, when nothing increased', () => {
    const { overrideLog, unused } = buildOverrideLog(
      undefined,
      new Map([['types', 'not actually needed']]),
      { types: 678 },
      { types: 670 },
      '2026-09-16T00:00:00.000Z'
    );

    expect(overrideLog).toEqual([]);
    expect(unused).toEqual(['types']);
  });
});

describe('knip-ratchet parseAllowIncreaseArgs', () => {
  it('reads repeatable --allow-increase <category> <reason> pairs', () => {
    const overrides = parseAllowIncreaseArgs([
      '--allow-increase',
      'files',
      'reason a',
      '--allow-increase',
      'exports',
      'reason b',
    ]);

    expect(overrides.get('files')).toBe('reason a');
    expect(overrides.get('exports')).toBe('reason b');
  });

  it('throws when a pair is incomplete', () => {
    expect(() => parseAllowIncreaseArgs(['--allow-increase', 'files'])).toThrow(/--allow-increase/);
  });
});

describe('knip-ratchet compareSummaries (pre-existing check() logic)', () => {
  it('reports a category regression distinctly from a vanished category', () => {
    const { regressions, vanished } = compareSummaries(
      { byCategory: { exports: 10, retiring: 3 } },
      { byCategory: { exports: 12 } }
    );

    expect(regressions).toEqual([{ category: 'exports', baseline: 10, current: 12 }]);
    expect(vanished).toEqual([{ category: 'retiring', baseline: 3 }]);
  });
});
