// @lifecycle canonical - A gate's shipped examples run through the gate's own check, fail-closed.
/**
 * `runGateExamples` hands each example file to the same shell path a review hands a real reply to
 * and compares the exit-status verdict with the example's expectation.
 *
 * The fixture gate ships a tiny `check.js` that passes a reply containing `## Summary` and fails
 * any other; the example files are a reply of each kind. The allowlist is read from the
 * environment variable the executor reads in production, not injected, so the unset case is the
 * operator's real default.
 *
 * Classification: Unit (real loader, real executor, real child process; no mocks).
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';
import {
  GATE_EXAMPLES_MODEL_JUDGED_REASON,
  runGateExamples,
} from '../../../../src/engine/gates/services/gate-example-runner.js';
import { SHELL_VERIFY_ALLOWLIST_ENV } from '../../../../src/engine/gates/shell/shell-command-allowlist.js';
import { createShellVerifyExecutor } from '../../../../src/engine/gates/shell/shell-verify-executor.js';

import type { LoadedGateDefinition } from '../../../../src/engine/gates/core/gate-schema.js';

const CHECK_SCRIPT = [
  "let input = '';",
  "process.stdin.on('data', (chunk) => (input += chunk));",
  "process.stdin.on('end', () => process.exit(input.includes('## Summary') ? 0 : 1));",
  '',
].join('\n');

function writeGate(
  root: string,
  id: string,
  body: readonly string[],
  files: Record<string, string>
): void {
  const dir = join(root, id);
  mkdirSync(join(dir, 'examples'), { recursive: true });
  writeFileSync(
    join(dir, 'gate.yaml'),
    [
      `id: ${id}`,
      'name: Example probe',
      'type: validation',
      'description: probe',
      ...body,
      '',
    ].join('\n')
  );
  for (const [relative, content] of Object.entries(files)) {
    writeFileSync(join(dir, relative), content);
  }
}

function examplesBlock(passExpect: string, failExpect: string): string[] {
  return [
    'examples:',
    '  - file: examples/pass.md',
    `    expect: ${passExpect}`,
    '  - file: examples/fail-missing-section.md',
    `    expect: ${failExpect}`,
  ];
}

const EXAMPLE_FILES = {
  'examples/pass.md': '## Summary\nThe change is done.\n',
  'examples/fail-missing-section.md': 'The change is done.\n',
};

describe('runGateExamples', () => {
  let root: string;
  let loader: GateDefinitionLoader;
  const savedAllowlist = process.env[SHELL_VERIFY_ALLOWLIST_ENV];
  const executor = createShellVerifyExecutor({ gateSystemEnabled: () => true });

  function commandGate(passExpect: string, failExpect: string): LoadedGateDefinition {
    writeGate(
      root,
      'summary-check',
      [
        'pass_criteria:',
        '  - type: shell_verify',
        '    shell_command: [node, check.js]',
        '    shell_stdin_source: agent_response',
        ...examplesBlock(passExpect, failExpect),
      ],
      { 'check.js': CHECK_SCRIPT, ...EXAMPLE_FILES }
    );
    const gate = loader.loadGate('summary-check');
    if (gate === undefined) throw new Error('fixture gate did not load');
    return gate;
  }

  /** The command as the executor sees it: the shipped script resolved to the gate directory. */
  function allowFixtureCommand(): void {
    process.env[SHELL_VERIFY_ALLOWLIST_ENV] = `node ${join(root, 'summary-check', 'check.js')}`;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gate-example-runner-'));
    loader = new GateDefinitionLoader({ gatesDir: root, enableCache: false });
    delete process.env[SHELL_VERIFY_ALLOWLIST_ENV];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (savedAllowlist === undefined) delete process.env[SHELL_VERIFY_ALLOWLIST_ENV];
    else process.env[SHELL_VERIFY_ALLOWLIST_ENV] = savedAllowlist;
    jest.restoreAllMocks();
  });

  test('a pass and a fail example each report as expected, with no mismatch', async () => {
    allowFixtureCommand();

    const report = await runGateExamples(commandGate('pass', 'fail'), { executor });

    expect(report).toMatchObject({ gateId: 'summary-check', executed: true, mismatches: 0 });
    expect(report.reason).toBeUndefined();
    expect(report.results.map((r) => [r.file, r.expect, r.outcome])).toEqual([
      ['examples/pass.md', 'pass', 'pass'],
      ['examples/fail-missing-section.md', 'fail', 'fail'],
    ]);
    expect(report.results[1]?.detail).toContain('exited 1');
  });

  test('swapping the two expectations reports two mismatches', async () => {
    allowFixtureCommand();

    const report = await runGateExamples(commandGate('fail', 'pass'), { executor });

    expect(report.executed).toBe(true);
    expect(report.mismatches).toBe(2);
    expect(report.results.map((r) => [r.expect, r.outcome])).toEqual([
      ['fail', 'pass'],
      ['pass', 'fail'],
    ]);
  });

  test('an unset allowlist refuses every example, names the variable, and passes none', async () => {
    const report = await runGateExamples(commandGate('pass', 'fail'), { executor });

    expect(report.executed).toBe(false);
    expect(report.reason).toContain(SHELL_VERIFY_ALLOWLIST_ENV);
    expect(report.results).toHaveLength(2);
    expect(report.results.every((r) => r.outcome === 'refused')).toBe(true);
    expect(report.results.some((r) => r.outcome === 'pass')).toBe(false);
    expect(report.mismatches).toBe(2);
  });

  test('a gate judged by the client model lists its examples as not executed', async () => {
    writeGate(
      root,
      'model-judged',
      ['pass_criteria:', '  - type: inline_guidance', ...examplesBlock('pass', 'fail')],
      EXAMPLE_FILES
    );
    allowFixtureCommand();
    const gate = loader.loadGate('model-judged');
    if (gate === undefined) throw new Error('fixture gate did not load');

    const report = await runGateExamples(gate, { executor });

    expect(report).toMatchObject({
      gateId: 'model-judged',
      executed: false,
      mismatches: 0,
      reason: GATE_EXAMPLES_MODEL_JUDGED_REASON,
    });
    expect(report.results.map((r) => [r.file, r.expect, r.outcome])).toEqual([
      ['examples/pass.md', 'pass', 'not_executed'],
      ['examples/fail-missing-section.md', 'fail', 'not_executed'],
    ]);
  });
});
