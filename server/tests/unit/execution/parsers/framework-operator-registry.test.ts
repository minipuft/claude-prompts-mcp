import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  DEPRECATED_FRAMEWORK_SIGILS,
  FRAMEWORK_SIGIL,
  FRAMEWORK_SIGIL_CLASS,
  OPERATOR_PATTERNS,
  deprecatedFrameworkSigilNote,
} from '../../../../src/engine/execution/parsers/operator-patterns.js';
import {
  findFrameworkOperatorOutsideQuotes,
  normalizeSymbolicPrefixes,
} from '../../../../src/engine/execution/parsers/parser-utils.js';
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
    parser = createSymbolicCommandParser(logger, (normalizedId) => normalizedId === 'CAGEERF');
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

/**
 * The framework set changes while the server runs, so the parser asks the lookup on every parse
 * instead of holding the ids it was built with. A copy taken at construction kept a framework
 * created afterwards out of `@id` detection until restart.
 */
describe('framework operator — registration is read at parse time', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  const frameworkOperatorIn = (
    parser: ReturnType<typeof createSymbolicCommandParser>,
    command: string
  ): unknown => parser.detectOperators(command).operators.find((op) => op.type === 'framework');

  test('an id registered after the parser was built is detected, and stops being once removed', () => {
    const registered = new Set(['CAGEERF']);
    const parser = createSymbolicCommandParser(logger, (normalizedId) =>
      registered.has(normalizedId)
    );

    expect(frameworkOperatorIn(parser, '@later >>x')).toBeUndefined();

    registered.add('LATER');
    expect(frameworkOperatorIn(parser, '@later >>x')).toMatchObject({
      frameworkId: 'later',
      normalizedId: 'LATER',
    });

    registered.delete('LATER');
    expect(frameworkOperatorIn(parser, '@later >>x')).toBeUndefined();
  });

  test('without a lookup, every @word is treated as a framework operator', () => {
    const parser = createSymbolicCommandParser(logger);
    expect(frameworkOperatorIn(parser, '@anything >>x')).toMatchObject({
      normalizedId: 'ANYTHING',
    });
  });
});

/**
 * `^` is the canonical framework sigil and `@` a deprecated alias: both resolve the same
 * framework, the operator records which one was typed, and every site that strips a framework
 * prefix takes both. Those strip sites once named only `@`, so the canonical spelling threw
 * `Invalid chain step format` in a position where the deprecated one parsed.
 */
describe('framework operator — `^` canonical, `@` deprecated alias', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const parser = createSymbolicCommandParser(
    logger,
    (normalizedId) => normalizedId === 'REACT' || normalizedId === 'CAGEERF'
  );

  test('the sigils come from the registry: `^` canonical, `@` the only deprecated spelling', () => {
    expect(FRAMEWORK_SIGIL).toBe('^');
    expect(DEPRECATED_FRAMEWORK_SIGILS).toEqual(['@']);
    const accepted = new RegExp(`^${FRAMEWORK_SIGIL_CLASS}$`);
    expect(accepted.test('^')).toBe(true);
    expect(accepted.test('@')).toBe(true);
    expect(accepted.test('#')).toBe(false);
  });

  test.each([
    ['^ReACT >>p', '^'],
    ['@ReACT >>p', '@'],
  ])('%s resolves the framework and records the sigil it was typed with', (command, sigil) => {
    const detection = parser.detectOperators(command);

    expect(detection.operators.find((op) => op.type === 'framework')).toMatchObject({
      frameworkId: 'ReACT',
      normalizedId: 'REACT',
      sigil,
    });
    expect(parser.generateExecutionPlan(detection, 'p', '').frameworkOverride).toBe('REACT');
  });

  test('the note names `^` for a deprecated sigil, and is absent for the canonical one', () => {
    expect(deprecatedFrameworkSigilNote('^', 'ReACT')).toBeNull();
    expect(deprecatedFrameworkSigilNote('@', 'ReACT')).toBe(
      'Deprecated spelling: `@ReACT` still works, but the framework operator is `^ReACT`; ' +
        '`@` is removed at the next major.'
    );
    // A sigil the registry does not list as a framework spelling owes no note.
    expect(deprecatedFrameworkSigilNote('#', 'ReACT')).toBeNull();
  });

  // A framework operator on a later chain step is dropped before the step's prompt id is read.
  // `^` threw `Invalid chain step format` here while `@` parsed.
  test.each([
    ['^CAGEERF >>a --> %lean ^ReACT >>b', 'canonical sigil on a later step'],
    ['@CAGEERF >>a --> %lean @ReACT >>b', 'deprecated sigil on a later step'],
    ['^CAGEERF >>a --> ^ReACT >>b', 'canonical sigil on a later step, no modifier'],
  ])('%s (%s) yields both chain steps', (command) => {
    const chain = parser.detectOperators(command).operators.find((op) => op.type === 'chain') as
      { steps?: { promptId: string }[] } | undefined;

    expect(chain?.steps?.map((step) => step.promptId)).toEqual(['a', 'b']);
  });

  test.each([
    ['>> ^CAGEERF >>a', '^CAGEERF >>a'],
    ['>>^CAGEERF >>a', '^CAGEERF >>a'],
    ['>> @CAGEERF >>a', '@CAGEERF >>a'],
  ])('a leading >> before a framework operator is dropped: %s', (command, normalized) => {
    expect(normalizeSymbolicPrefixes(command)).toMatchObject({ normalized, hadPrefixes: true });
  });

  test('a leading >> before a prompt id is left alone', () => {
    expect(normalizeSymbolicPrefixes('>> plain')).toMatchObject({
      normalized: '>> plain',
      hadPrefixes: false,
    });
  });
});
