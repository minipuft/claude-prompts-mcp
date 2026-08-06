/**
 * Unit tests for `claude/no-deprecated-automation-mode`.
 *
 * The rule replaces scripts/validate-no-execution-mode.js (row 1.4). That script ripgrepped
 * `-w -i 'mode'` over the automation paths, so it matched comments, prose and string literals as
 * well as code — which is where most of its ten allowlist entries came from.
 *
 * The valid cases below are therefore load-bearing, not filler: each one is a hit the deleted
 * script reported and needed an allowlist entry to suppress. If any of them starts failing, the
 * rule has regressed into text matching and the allowlist has to come back.
 *
 * Scope (`src/modules/automation/**`) and the deprecation-fold exemption are expressed in
 * eslint.config.js via `files`/`ignores`, not in the rule, so they are not retested here.
 */

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

import { rules } from '../../../eslint-rules/claude-plugin.js';

const rule = rules['no-deprecated-automation-mode'];

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-deprecated-automation-mode', rule, {
  valid: [
    {
      name: 'prose in a line comment is not code (deleted script needed an allowlist entry here)',
      code: `// the deprecated confirm mode maps to trigger + confirm\nexport const x = 1;\n`,
    },
    {
      name: 'prose in a block comment is not code',
      code: `/**\n * Accepts (mode, trigger, strict) from older YAML.\n */\nexport const x = 1;\n`,
    },
    {
      name: 'a string literal mentioning mode is not a property (covered "strict mode" entries)',
      code: `export const msg = 'strict mode: missing params';\n`,
    },
    {
      name: 'an identifier merely containing Mode is untouched',
      code: `import { ExecutionModeSchema } from './script-schema.js';\nexport const s = ExecutionModeSchema;\n`,
    },
    {
      name: 'the replacement vocabulary is allowed',
      code: `export const cfg = { trigger: 'auto', confirm: false };\n`,
    },
    {
      name: 'a variable named mode is not a property access',
      code: `const mode = 1;\nexport default mode;\n`,
    },
  ],
  invalid: [
    {
      name: 'mode as an object property key',
      code: `export const cfg = { mode: 'manual' };\n`,
      errors: [{ messageId: 'deprecatedMode' }],
    },
    {
      name: 'mode as shorthand property',
      code: `const mode = 'manual';\nexport const cfg = { mode };\n`,
      errors: [{ messageId: 'deprecatedMode' }],
    },
    {
      name: 'mode read by dot access',
      code: `export const v = yamlConfig.mode;\n`,
      errors: [{ messageId: 'deprecatedMode' }],
    },
    {
      name: 'bracket access does not evade the rule',
      code: `export const v = yamlConfig['mode'];\n`,
      errors: [{ messageId: 'deprecatedMode' }],
    },
    {
      name: 'a computed property key does not evade the rule',
      code: `export const cfg = { ['mode']: 'manual' };\n`,
      errors: [{ messageId: 'deprecatedMode' }],
    },
  ],
});

/**
 * A separate tester for the TypeScript-only node. `TSPropertySignature` is one of the rule's
 * selectors, and espree cannot parse the syntax that produces it — so without this the selector
 * would be asserted by nothing.
 */
const tsRuleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser as never },
});

tsRuleTester.run('no-deprecated-automation-mode (typescript)', rule, {
  valid: [
    {
      name: 'a type declaring trigger/confirm is allowed',
      filename: 'automation.ts',
      code: `export interface ScriptConfig { trigger: string; confirm: boolean }\n`,
    },
  ],
  invalid: [
    {
      name: 'mode reintroduced as an interface member',
      filename: 'automation.ts',
      code: `export interface ScriptConfig { mode: 'auto' | 'manual' }\n`,
      errors: [{ messageId: 'deprecatedMode' }],
    },
  ],
});
