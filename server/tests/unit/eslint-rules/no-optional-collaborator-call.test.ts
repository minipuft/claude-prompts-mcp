/**
 * Unit tests for `claude/no-optional-collaborator-call`.
 *
 * The rule reports `this.<member>?.()` only when the SAME class declares `<member>` as possibly
 * absent. The invalid cases plant each declaration spelling it reads; the valid cases are the
 * homonyms that share the call's surface but not its meaning — a data field dereferenced with
 * `?.`, a local optional callback, a required collaborator, and an optional member of a
 * different class.
 */

import tseslint from 'typescript-eslint';
import { RuleTester } from 'eslint';

import { rules } from '../../../eslint-rules/claude-plugin.js';

const rule = rules['no-optional-collaborator-call'];

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' },
});

const error = (name: string) => ({ messageId: 'optionalCollaboratorCall', data: { name } });

ruleTester.run('no-optional-collaborator-call', rule, {
  valid: [
    {
      name: 'a required constructor collaborator called directly',
      code: `class Stage {\n  constructor(private readonly enabled: (scope: string) => boolean) {}\n  run() { return this.enabled('s'); }\n}\n`,
    },
    {
      name: 'an optional data field dereferenced with ?. is not a call',
      code: `class Stage {\n  private data?: { field: string };\n  run() { return this.data?.field; }\n}\n`,
    },
    {
      name: 'a local optional callback parameter is not a class member',
      code: `class Stage {\n  run(onDone?: () => void) { onDone?.(); }\n}\n`,
    },
    {
      name: 'a required member called with ?. is not flagged — the declaration decides',
      code: `class Stage {\n  constructor(private readonly provider: () => number) {}\n  run() { return this.provider?.(); }\n}\n`,
    },
    {
      name: 'an optional member of ANOTHER class with the same name is a homonym',
      code: `class Other {\n  private provider?: () => number;\n}\nclass Stage {\n  constructor(private readonly provider: () => number) {}\n  run() { return this.provider?.(); }\n}\n`,
    },
    {
      name: 'an optional collaborator object dereferenced as this.x?.method() is out of scope',
      code: `class Stage {\n  private store?: { save(): void };\n  run() { this.store?.save(); }\n}\n`,
    },
  ],
  invalid: [
    {
      name: 'planted: optional constructor parameter property (?)',
      code: `class Stage {\n  constructor(private readonly provider?: () => number) {}\n  run() { return this.provider?.(); }\n}\n`,
      errors: [error('provider')],
    },
    {
      name: 'planted: constructor parameter property typed `| undefined` — the stage 11 shape',
      code: `class Stage {\n  constructor(private readonly enabled: ((scope: string) => boolean) | undefined) {}\n  run() { return this.enabled?.('s') === false; }\n}\n`,
      errors: [error('enabled')],
    },
    {
      name: 'planted: defaulted constructor parameter property typed `| null`',
      code: `class Stage {\n  constructor(private readonly refuse: ((p: object) => string | null) | null = null) {}\n  run() { return this.refuse?.({}); }\n}\n`,
      errors: [error('refuse')],
    },
    {
      name: 'planted: optional class property assigned in the constructor',
      code: `class Tools {\n  private onRestart?: (reason: string) => Promise<void>;\n  constructor(onRestart: (reason: string) => Promise<void>) { this.onRestart = onRestart; }\n  async restart() { await this.onRestart?.('reload'); }\n}\n`,
      errors: [error('onRestart')],
    },
    {
      name: 'planted: class property typed `| undefined`, inside a class expression',
      code: `const Recorder = class {\n  private metrics: (() => number) | undefined;\n  record() { return this.metrics?.(); }\n};\n`,
      errors: [error('metrics')],
    },
  ],
});
