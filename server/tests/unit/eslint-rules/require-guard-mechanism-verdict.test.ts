/**
 * Unit tests for `claude/require-guard-mechanism-verdict`.
 *
 * The rule governs INFLOW: a `validate-no-*` guard must state whether it stays a standalone process
 * (`script`, qualified by the property a linter structurally cannot cover) or is pending a move
 * (`rehome`, qualified by its destination and carrying the plan row that owns the port).
 *
 * There is no allowlist option. It had one until 0.5 removed it — an allowlist is a second place to
 * update, and a rule only visits files that exist, so an entry naming a deleted guard was never
 * reported. The `rehome` disposition replaces it, and its marker dies with the guard.
 *
 * This is the first test for `eslint-rules/claude-plugin.js`; the other five rules are verified
 * only by planting violations by hand.
 */

import { RuleTester } from 'eslint';

import { rules } from '../../../eslint-rules/claude-plugin.js';

const rule = rules['require-guard-mechanism-verdict'];

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('require-guard-mechanism-verdict', rule, {
  valid: [
    {
      name: 'a script verdict naming an allowed property and a reason',
      filename: 'scripts/validate-no-example.js',
      code: `/**\n * MECHANISM: script — reach — scans ../cli/src, outside the ESLint root\n */\nexport const x = 1;\n`,
    },
    {
      name: 'disposition and qualifier match case-insensitively',
      filename: 'scripts/validate-no-example.js',
      code: `// MECHANISM: Script — Relation — compares package.json against the filesystem\nexport const x = 1;\n`,
    },
    {
      name: 'a rehome verdict naming a destination and the owning row',
      filename: 'scripts/validate-no-example.js',
      code: `// MECHANISM: rehome — eslint — row 1.4; scope is inside the lint root\nexport const x = 1;\n`,
    },
  ],
  invalid: [
    {
      name: 'a new guard with no verdict is flagged',
      filename: 'scripts/validate-no-example.js',
      code: `/** Guards something. */\nexport const x = 1;\n`,
      errors: [{ messageId: 'missingVerdict' }],
    },
    {
      name: 'a disposition outside the vocabulary is flagged as such',
      filename: 'scripts/validate-no-example.js',
      code: `// MECHANISM: keep — reach — it felt right\nexport const x = 1;\n`,
      errors: [{ messageId: 'unknownDisposition' }],
    },
    {
      name: 'a qualifier outside the vocabulary is flagged separately',
      filename: 'scripts/validate-no-example.js',
      code: `// MECHANISM: script — convenience — it was easier to write this way\nexport const x = 1;\n`,
      errors: [{ messageId: 'unknownQualifier' }],
    },
    {
      name: 'qualifiers are validated per disposition, not pooled',
      filename: 'scripts/validate-no-example.js',
      code: `// MECHANISM: rehome — reach — reach is a script property, not a destination\nexport const x = 1;\n`,
      errors: [{ messageId: 'unknownQualifier' }],
    },
    {
      name: 'a verdict with no reason is flagged separately from a missing verdict',
      filename: 'scripts/validate-no-example.js',
      code: `// MECHANISM: script — reach\nexport const x = 1;\n`,
      errors: [{ messageId: 'missingReason' }],
    },
    {
      name: 'a rehome verdict must also name its reason, so a bare disposition cannot bypass',
      filename: 'scripts/validate-no-example.js',
      code: `// MECHANISM: rehome — eslint\nexport const x = 1;\n`,
      errors: [{ messageId: 'missingReason' }],
    },
  ],
});
