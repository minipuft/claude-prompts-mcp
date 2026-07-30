// @lifecycle canonical - Pins the option-value escape contract (T0 pre-merge check).
import { describe, expect, it } from '@jest/globals';

import { parseQuotedValue, serializeOptionValue } from '../../../src/shared/utils/jsonUtils.js';

/**
 * Simulate the full wire path for a value passed via the `options` parameter:
 * stage 00 serializes it into the command string, the argument parser captures the inside of
 * the quotes, and `parseQuotedValue` decodes it before the prompt sees it.
 */
const roundTrip = (value: string): string => {
  const wire = serializeOptionValue(value);
  return parseQuotedValue(wire.slice(1, -1));
};

describe('option values passed through `options` round-trip losslessly', () => {
  // The T0 plan flagged "a value containing a literal backslash changes meaning" as a
  // pre-merge risk. Measured, that is not true of this path: the encoder escapes and the
  // decoder unescapes, so backslashes survive. The risk is real only for hand-authored
  // command strings, pinned in the next block.

  it.each([
    ['Windows path', 'C:\\Users\\dev\\project'],
    ['regex with classes', String.raw`^GATE_REVIEW:\s*(PASS|FAIL)\s*-\s*(.+)$`],
    ['regex with groups', String.raw`function\s+\w+\s*\(`],
    ['regex with quantifiers', String.raw`\d{4}-\d{2}-\d{2}`],
    ['escaped dot', String.raw`bridge\.scss|--spice`],
    ['apostrophe', "it's a lifted ground"],
    ['double quote', 'the "lifted" ground'],
    ['both quote kinds', `it's a "lifted" ground`],
    ['colon-bearing prose', 'ground lifted. Target: dark ground.'],
    ['real newline', '**Standards:**\n- Criterion 1'],
    ['tab', 'a\tb'],
    ['trailing backslash', 'ends with\\'],
    ['only backslashes', '\\\\\\'],
    ['empty', ''],
  ])('%s survives unchanged', (_label, value) => {
    expect(roundTrip(value)).toBe(value);
  });

  it('serializes non-strings without quoting them', () => {
    expect(serializeOptionValue(42)).toBe('42');
    expect(serializeOptionValue(true)).toBe('true');
  });
});

describe('hand-authored quoted values treat backslash as an escape', () => {
  // This is the one genuinely breaking behavior of the T0 change, and it is deliberate: the
  // decoder cannot tell a hand-typed `C:\Users` from an encoder-emitted escape. Documented in
  // docs/reference/mcp-tools.md § Quoting and escapes. These tests exist so the doc and the
  // code cannot drift — if someone makes backslashes literal again, the doc becomes wrong and
  // these fail.

  it('consumes a single backslash before an ordinary character', () => {
    // An author typing path:'C:\Users\dev' gets this. Hence "double any backslash you mean".
    expect(parseQuotedValue('C:\\Users\\dev')).toBe('C:Usersdev');
  });

  it('yields one backslash from a doubled backslash — the documented workaround', () => {
    expect(parseQuotedValue('C:\\\\Users\\\\dev')).toBe('C:\\Users\\dev');
  });

  it('honours the recognized control escapes', () => {
    expect(parseQuotedValue('a\\nb')).toBe('a\nb');
    expect(parseQuotedValue('a\\tb')).toBe('a\tb');
    expect(parseQuotedValue('a\\rb')).toBe('a\rb');
    expect(parseQuotedValue('a\\bb')).toBe('a\bb');
    expect(parseQuotedValue('a\\fb')).toBe('a\fb');
  });

  it('decodes the \\uXXXX form JSON.stringify emits for control characters', () => {
    expect(parseQuotedValue('a\\u0041b')).toBe('aAb');
  });

  it('lets an escaped quote through, which keeps hand-written apostrophes working', () => {
    expect(parseQuotedValue("it\\'s fine")).toBe("it's fine");
  });

  it('leaves a value with no backslashes untouched', () => {
    // The backwards-compatibility guarantee: every command written before this convention
    // existed contains no backslashes, so every one of them decodes to itself.
    expect(parseQuotedValue('a plain value')).toBe('a plain value');
    expect(parseQuotedValue('Target: dark ground.')).toBe('Target: dark ground.');
  });
});
