// @lifecycle canonical - formatAttempt, attemptInHand, and the scan for renders that bypass them.
/**
 * The scan fails when a string in `src/` builds an attempt number outside `formatAttempt` (an
 * attempt word or counter beside an interpolation). The planted sources prove each pattern fires;
 * the counts (`N attempts`, `attempt${s}`) prove it does not fire on prose that counts attempts
 * rather than numbering one.
 */
import { describe, expect, test } from '@jest/globals';

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { attemptInHand, formatAttempt } from '../../../../src/shared/utils/attempt-number.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../src');
const FORMATTER = 'shared/utils/attempt-number.ts';

/**
 * Shapes of an attempt number built outside the formatter:
 * - the word, then a separator, then an interpolation: `attempt ${n}`, `Attempts:** ${n}`,
 *   `Attempts:** 0/${max}`;
 * - an attempt or retry counter interpolated before `/` or `of`: `${x.attemptCount}/${max}`;
 * - the word closing a string that a `+` continues: `'attempt ' + n`.
 */
const ATTEMPT_NUMBER_SHAPES: readonly RegExp[] = [
  /\b[Aa]ttempts?(?:(?:\*\*)?:(?:\*\*)?\s?|\s)(?:\d+\/)?\$\{/g,
  /\$\{[^}]*(?:[Aa]ttempt|[Rr]etry)[^}]*\}\s*(?:\/|of\b)/g,
  /\b[Aa]ttempts?\b[\s:*]*['"]\s*\+/g,
];

function attemptNumberRenders(source: string): string[] {
  return ATTEMPT_NUMBER_SHAPES.flatMap((shape) =>
    [...source.matchAll(shape)].map((match) => match[0])
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('formatAttempt', () => {
  test('renders a 1-based ordinal against its budget, or alone when none is known', () => {
    expect(formatAttempt(1, 2)).toBe('attempt 1/2');
    expect(formatAttempt(3)).toBe('attempt 3');
    expect(formatAttempt(2, 5, 'Attempt')).toBe('Attempt 2/5');
  });

  test('attemptInHand turns a consumed count into the next attempt, clamped to the budget', () => {
    expect(attemptInHand(0, 2)).toBe(1);
    expect(attemptInHand(1, 2)).toBe(2);
    expect(attemptInHand(2, 2)).toBe(2);
  });
});

describe('every attempt number in src/ renders through formatAttempt', () => {
  test('positive control: each shape fires on a planted bypass', () => {
    const planted = [
      'const a = `(attempt ${review.attemptCount})`;',
      'const b = `**Attempts:** ${pending.attemptCount}/${pending.maxAttempts}`;',
      'const c = `**Attempts:** 0/${pending.maxAttempts}`;',
      'const d = `(${review.attemptCount}/${review.maxAttempts} attempts)`;',
      'const e = `**Attempt ${counter.current} of ${counter.max}**`;',
      'const f = `retry ${this.retryCount}/${this.config.maxRetries}`;',
      "const g = 'attempt ' + n;",
    ];
    for (const line of planted) {
      expect({ line, hits: attemptNumberRenders(line).length > 0 }).toEqual({ line, hits: true });
    }
  });

  test('negative control: counting attempts is not numbering one', () => {
    const counts = [
      'const a = `failed after ${max} attempts: **${gates}**`;',
      "const b = `${attempts} attempt${attempts === 1 ? '' : 's'}`;",
      "const c = remaining === 1 ? 'attempt remains' : 'attempts remain';",
      'const d = `(${formatAttempt(n, max)})`;',
    ];
    for (const line of counts) {
      expect({ line, hits: attemptNumberRenders(line) }).toEqual({ line, hits: [] });
    }
  });

  test('no file but the formatter builds an attempt number', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(100);
    const bypasses = files.flatMap((file) => {
      const site = path.relative(SRC, file).split(path.sep).join('/');
      if (site === FORMATTER) return [];
      return attemptNumberRenders(readFileSync(file, 'utf8')).map((hit) => `${site}: ${hit}`);
    });
    expect(bypasses).toEqual([]);
  });

  test('the scan reads the routed sites: the ledger handler is scanned and calls the formatter', () => {
    const ledger = path.join(
      SRC,
      'mcp/tools/system-control/handlers/execution-history-action-handler.ts'
    );
    expect(sourceFiles(SRC)).toContain(ledger);
    expect(readFileSync(ledger, 'utf8')).toContain('formatAttempt(');
  });
});
