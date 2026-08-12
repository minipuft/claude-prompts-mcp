import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { OPERATOR_PATTERNS } from '../../../../src/engine/execution/parsers/operator-patterns.js';
import { findFrameworkOperatorOutsideQuotes } from '../../../../src/engine/execution/parsers/parser-utils.js';
import { createSymbolicCommandParser } from '../../../../src/engine/execution/parsers/symbolic-operator-parser.js';

import type { Logger } from '../../../../src/infra/logging/index.js';

/**
 * The framework operator had FOUR definitions and no gate holding them together, so
 * `operators.json` sat two revisions stale (pre-`^`, pre-relaxation) while the standalone
 * extractor in `parser-utils.ts` had moved on. Nothing failed, because the only consumer of the
 * registry pattern is the chain-prefix STRIP — and no test drove a framework operator through a
 * CHAIN. The result: `^CAGEERF >>a --> >>b` threw `Invalid chain step format`, i.e. the canonical
 * sigil was broken for every chained command while the plan recorded it as landed.
 *
 * These tests drive the chain path specifically. A mutation to the registry pattern reds them.
 */
describe('framework operator — registry is the single definition', () => {
  let parser: ReturnType<typeof createSymbolicCommandParser>;

  beforeEach(() => {
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;
    parser = createSymbolicCommandParser(logger, new Set(['CAGEERF']));
  });

  test('registry declares `^` canonical with `@` deprecated, not removed', () => {
    const framework = OPERATOR_PATTERNS.framework;
    expect(framework.symbol).toBe('^');
    // Both spellings must still match — `@` parses until the next major.
    expect(new RegExp(framework.pattern.source).test('^CAGEERF >>x')).toBe(true);
    expect(new RegExp(framework.pattern.source).test('@CAGEERF >>x')).toBe(true);
  });

  // Every combination of {canonical, deprecated} sigil x {spaced, unspaced} must survive the
  // chain-prefix strip. Three of these four threw before the registry was repaired.
  test.each([
    ['^CAGEERF >>a --> >>b', 'canonical sigil, spaced'],
    ['@CAGEERF >>a --> >>b', 'deprecated sigil, spaced'],
    ['^CAGEERF>>a --> >>b', 'canonical sigil, unspaced'],
    ['@CAGEERF>>a --> >>b', 'deprecated sigil, unspaced'],
  ])('%s (%s) strips cleanly and yields both chain steps', (command) => {
    const result = parser.detectOperators(command);

    const framework = result.operators.find((op) => op.type === 'framework');
    expect(framework).toMatchObject({ frameworkId: 'CAGEERF' });

    const chain = result.operators.find((op) => op.type === 'chain') as
      { steps?: { promptId: string }[] } | undefined;
    expect(chain?.steps?.map((step) => step.promptId)).toEqual(['a', 'b']);
  });

  test('the extractor derives from the registry rather than its own copy', () => {
    // Discriminating case: the registry's char class is what admits `^`. An extractor carrying a
    // stale private copy would still resolve `@` here and fail only on `^`.
    expect(findFrameworkOperatorOutsideQuotes('^CAGEERF >>x')?.frameworkId).toBe('CAGEERF');
    expect(findFrameworkOperatorOutsideQuotes('@CAGEERF >>x')?.frameworkId).toBe('CAGEERF');
  });

  test('non-operator text is not claimed as a framework', () => {
    // `a^b` is mid-token, so the leading `(?:^|\s)` must reject it.
    expect(findFrameworkOperatorOutsideQuotes('a^b >>x')).toBeNull();
    expect(findFrameworkOperatorOutsideQuotes('plain >>x')).toBeNull();
    // Path-like references are rejected by the extractor's own `/` and `.` guards, which do not
    // derive from the registry.
    expect(findFrameworkOperatorOutsideQuotes('see @docs/guide >>x')).toBeNull();
    expect(findFrameworkOperatorOutsideQuotes('see @file.md >>x')).toBeNull();
  });
});
