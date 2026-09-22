/**
 * Unit tests for `claude/no-bindingless-empty-catch`.
 *
 * The rule exists because of one measured gap: `no-empty` stops reporting an empty block the
 * moment it contains a comment, and every bindingless swallow in this tree carried one. The last
 * block below is the positive control for that claim — it runs `no-empty` over the same four
 * spellings and records which two it reports, so a future change to `no-empty`'s defaults shows up
 * here as a failure rather than as a rule that has quietly become redundant.
 */

import { Linter, RuleTester } from 'eslint';

import { rules } from '../../../eslint-rules/claude-plugin.js';

const rule = rules['no-bindingless-empty-catch'];

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const BINDINGLESS_EMPTY = `try { risky(); } catch {}\n`;
const BINDINGLESS_COMMENT = `try { risky(); } catch {\n  // the file may not exist yet\n}\n`;
const BOUND_EMPTY = `try { risky(); } catch (_error) {}\n`;
const BOUND_COMMENT = `try { risky(); } catch (_error) {\n  // the file may not exist yet\n}\n`;

ruleTester.run('no-bindingless-empty-catch', rule, {
  valid: [
    {
      name: 'a catch that binds the error and states the discard in one line',
      code: BOUND_COMMENT,
    },
    {
      name: 'a catch that binds the error, even with nothing in the block',
      code: BOUND_EMPTY,
    },
    {
      name: 'a bindingless catch that runs a statement is doing something',
      code: `try { risky(); } catch {\n  fallback();\n}\n`,
    },
    {
      name: 'a bindingless catch that rethrows',
      code: `try { risky(); } catch {\n  throw new Error('failed');\n}\n`,
    },
  ],
  invalid: [
    {
      name: 'a bindingless catch holding only a comment — the shape no-empty misses',
      code: BINDINGLESS_COMMENT,
      errors: [{ messageId: 'bindinglessEmptyCatch' }],
    },
    {
      name: 'a bindingless catch with a literally empty block',
      code: BINDINGLESS_EMPTY,
      errors: [{ messageId: 'bindinglessEmptyCatch' }],
    },
    {
      name: 'nesting does not hide it',
      code: `try {\n  try { risky(); } catch {\n    // inner\n  }\n} catch (error) {\n  report(error);\n}\n`,
      errors: [{ messageId: 'bindinglessEmptyCatch' }],
    },
  ],
});

describe('no-empty control', () => {
  const linter = new Linter();
  const lintWithNoEmpty = (code: string): number =>
    linter.verify(code, {
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      rules: { 'no-empty': 'error' },
    }).length;

  it('reports the two spellings whose block is literally empty', () => {
    expect(lintWithNoEmpty(BINDINGLESS_EMPTY)).toBe(1);
    expect(lintWithNoEmpty(BOUND_EMPTY)).toBe(1);
  });

  it('reports neither spelling once the block holds a comment — the gap this rule fills', () => {
    expect(lintWithNoEmpty(BINDINGLESS_COMMENT)).toBe(0);
    expect(lintWithNoEmpty(BOUND_COMMENT)).toBe(0);
  });
});
