// @lifecycle canonical - Pins the option-value escape contract (T0 pre-merge check).
import { describe, expect, it } from '@jest/globals';

import { parseQuotedValue } from '../../../src/shared/utils/jsonUtils.js';

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
