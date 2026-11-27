import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  FRAMEWORK_SIGIL,
  FRAMEWORK_SIGIL_SOURCE,
  OPERATOR_PATTERNS,
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

  test('registry declares `^` as the framework operator and no other sigil', () => {
    const framework = OPERATOR_PATTERNS.framework;
    expect(framework.symbol).toBe('^');
    expect(new RegExp(framework.pattern.source).test('^CAGEERF >>x')).toBe(true);
    expect(new RegExp(framework.pattern.source).test('@CAGEERF >>x')).toBe(false);
  });

  // Spaced and unspaced must both survive the chain-prefix strip; the unspaced form threw before
  // the registry was repaired.
  test.each([
    ['^CAGEERF >>a --> >>b', 'spaced'],
    ['^CAGEERF>>a --> >>b', 'unspaced'],
  ])('%s (%s) strips cleanly and yields both chain steps', (command) => {
    const result = parser.detectOperators(command);

    const framework = result.operators.find((op) => op.type === 'framework');
    expect(framework).toMatchObject({ frameworkId: 'CAGEERF' });

    const chain = result.operators.find((op) => op.type === 'chain') as
      { steps?: { promptId: string }[] } | undefined;
    expect(chain?.steps?.map((step) => step.promptId)).toEqual(['a', 'b']);
  });

  test('the extractor derives from the registry rather than its own copy', () => {
    // Discriminating case: the registry pattern admits `^` and nothing else. An extractor carrying
    // a stale private copy would still resolve `@` here.
    expect(findFrameworkOperatorOutsideQuotes('^CAGEERF >>x')?.frameworkId).toBe('CAGEERF');
    expect(findFrameworkOperatorOutsideQuotes('@CAGEERF >>x')).toBeNull();
  });

  test('non-operator text is not claimed as a framework', () => {
    // `a^b` is mid-token, so the leading `(?:^|\s)` must reject it.
    expect(findFrameworkOperatorOutsideQuotes('a^b >>x')).toBeNull();
    expect(findFrameworkOperatorOutsideQuotes('plain >>x')).toBeNull();
    // Path-like references are rejected by the extractor's own `/` and `.` guards, which do not
    // derive from the registry.
    expect(findFrameworkOperatorOutsideQuotes('see ^docs/guide >>x')).toBeNull();
    expect(findFrameworkOperatorOutsideQuotes('see ^file.md >>x')).toBeNull();
  });
});

/**
 * The framework set changes while the server runs, so the parser asks the lookup on every parse
 * instead of holding the ids it was built with. A copy taken at construction kept a framework
 * created afterwards out of `^id` detection until restart.
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

    expect(frameworkOperatorIn(parser, '^later >>x')).toBeUndefined();

    registered.add('LATER');
    expect(frameworkOperatorIn(parser, '^later >>x')).toMatchObject({
      frameworkId: 'later',
      normalizedId: 'LATER',
    });

    registered.delete('LATER');
    expect(frameworkOperatorIn(parser, '^later >>x')).toBeUndefined();
  });

  test('without a lookup, every ^word is treated as a framework operator', () => {
    const parser = createSymbolicCommandParser(logger);
    expect(frameworkOperatorIn(parser, '^anything >>x')).toMatchObject({
      normalizedId: 'ANYTHING',
    });
  });
});

/**
 * `^` is the framework sigil, taken from the registry by every site that strips a framework
 * prefix. Those strip sites once named only `@`, so `^` threw `Invalid chain step format` in a
 * position where `@` parsed.
 */
describe('framework operator — `^` from the registry at every strip site', () => {
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

  test('the sigil comes from the registry: `^`, and only `^`', () => {
    expect(FRAMEWORK_SIGIL).toBe('^');
    const accepted = new RegExp(`^${FRAMEWORK_SIGIL_SOURCE}$`);
    expect(accepted.test('^')).toBe(true);
    expect(accepted.test('@')).toBe(false);
  });

  test('`^ReACT >>p` resolves the framework', () => {
    const detection = parser.detectOperators('^ReACT >>p');

    expect(detection.operators.find((op) => op.type === 'framework')).toMatchObject({
      frameworkId: 'ReACT',
      normalizedId: 'REACT',
    });
    expect(parser.generateExecutionPlan(detection, 'p', '').frameworkOverride).toBe('REACT');
  });

  // A framework operator on a later chain step is dropped before the step's prompt id is read.
  test.each([
    ['^CAGEERF >>a --> %lean ^ReACT >>b', 'on a later step after a modifier'],
    ['^CAGEERF >>a --> ^ReACT >>b', 'on a later step, no modifier'],
  ])('%s (%s) yields both chain steps', (command) => {
    const chain = parser.detectOperators(command).operators.find((op) => op.type === 'chain') as
      { steps?: { promptId: string }[] } | undefined;

    expect(chain?.steps?.map((step) => step.promptId)).toEqual(['a', 'b']);
  });

  test.each([
    ['>> ^CAGEERF >>a', '^CAGEERF >>a'],
    ['>>^CAGEERF >>a', '^CAGEERF >>a'],
  ])('a leading >> before a framework operator is dropped: %s', (command, normalized) => {
    expect(normalizeSymbolicPrefixes(command)).toMatchObject({ normalized, hadPrefixes: true });
  });

  test.each(['>> plain', '>> @CAGEERF >>a'])('a leading >> before %s is left alone', (command) => {
    expect(normalizeSymbolicPrefixes(command)).toMatchObject({
      normalized: command,
      hadPrefixes: false,
    });
  });
});
