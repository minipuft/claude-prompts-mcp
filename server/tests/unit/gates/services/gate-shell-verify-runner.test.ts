import { createShellVerifyExecutor } from '../../../../src/engine/gates/shell/shell-verify-executor.js';
import { SHELL_VERIFY_ALLOW_ALL } from '../../../../src/engine/gates/shell/shell-command-allowlist.js';
import { SHELL_VERIFY_ALLOW_ANY_DIR } from '../../../../src/engine/gates/shell/shell-working-dir-policy.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, jest, test, beforeEach } from '@jest/globals';

import {
  formatGateShellVerifySection,
  type GateShellVerifyResult,
} from '../../../../src/engine/gates/shell/shell-verify-message-formatter.js';

describe('formatGateShellVerifySection', () => {
  test('returns empty string when no results', () => {
    expect(formatGateShellVerifySection([])).toBe('');
  });

  test('formats passing gate with summary only', () => {
    const results: GateShellVerifyResult[] = [
      {
        gateId: 'test-suite',
        gateName: 'Test Suite',
        command: 'npm test',
        passed: true,
        exitCode: 0,
        stdout: 'All 42 tests passed',
        stderr: '',
        durationMs: 3000,
      },
    ];

    const output = formatGateShellVerifySection(results);
    expect(output).toContain('## Shell Verification Results');
    expect(output).toContain('Test Suite — PASSED');
    expect(output).toContain('`npm test`');
    expect(output).toContain('**Exit Code:** 0');
    // Passed gates should NOT include error output block
    expect(output).not.toContain('```');
  });

  test('formats failing gate with error output', () => {
    const results: GateShellVerifyResult[] = [
      {
        gateId: 'test-suite',
        gateName: 'Test Suite',
        command: 'npm test',
        passed: false,
        exitCode: 1,
        stdout: '',
        stderr: 'FAIL src/handler.test.ts\n  Expected: true, Received: false',
        durationMs: 1200,
      },
    ];

    const output = formatGateShellVerifySection(results);
    expect(output).toContain('Test Suite — FAILED');
    expect(output).toContain('Expected: true, Received: false');
    expect(output).toContain('```');
  });

  test('shows timeout status', () => {
    const results: GateShellVerifyResult[] = [
      {
        gateId: 'test-suite',
        gateName: 'Test Suite',
        command: 'npm test',
        passed: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        durationMs: 300000,
        timedOut: true,
      },
    ];

    const output = formatGateShellVerifySection(results);
    expect(output).toContain('Timed out after 300000ms');
  });

  test('formats multiple gates', () => {
    const results: GateShellVerifyResult[] = [
      {
        gateId: 'test-suite',
        gateName: 'Test Suite',
        command: 'npm test',
        passed: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 1000,
      },
      {
        gateId: 'lint',
        gateName: 'Linter',
        command: 'npm run lint',
        passed: false,
        exitCode: 1,
        stdout: '',
        stderr: 'error: Unused variable',
        durationMs: 500,
      },
    ];

    const output = formatGateShellVerifySection(results);
    expect(output).toContain('Test Suite — PASSED');
    expect(output).toContain('Linter — FAILED');
    expect(output).toContain('Unused variable');
  });

  test('prefers stderr over stdout for error output', () => {
    const results: GateShellVerifyResult[] = [
      {
        gateId: 'test',
        gateName: 'Tests',
        command: 'npm test',
        passed: false,
        exitCode: 1,
        stdout: 'Running tests...',
        stderr: 'Error: assertion failed',
        durationMs: 100,
      },
    ];

    const output = formatGateShellVerifySection(results);
    expect(output).toContain('assertion failed');
    // Should NOT include stdout when stderr is available
    expect(output).not.toContain('Running tests...');
  });

  test('falls back to stdout when stderr is empty', () => {
    const results: GateShellVerifyResult[] = [
      {
        gateId: 'test',
        gateName: 'Tests',
        command: 'npm test',
        passed: false,
        exitCode: 1,
        stdout: 'FAIL: 2 tests failed',
        stderr: '',
        durationMs: 100,
      },
    ];

    const output = formatGateShellVerifySection(results);
    expect(output).toContain('FAIL: 2 tests failed');
  });
});

describe('runGateShellVerifications', () => {
  test('skips gates without shell_verify criteria', async () => {
    // Use dynamic import to get the function with mocked executor
    const { runGateShellVerifications } =
      await import('../../../../src/engine/gates/services/gate-shell-verify-runner.js');

    const gateProvider = {
      loadGates: jest.fn().mockResolvedValue([
        {
          id: 'code-quality',
          name: 'Code Quality',
          type: 'validation',
          description: 'LLM review',
          pass_criteria: [{ type: 'inline_guidance' }],
        },
      ]),
    } as any;

    const results = await runGateShellVerifications(
      ['code-quality'],
      gateProvider,
      undefined,
      createShellVerifyExecutor({})
    );
    expect(results).toHaveLength(0);
  });

  test('skips shell_verify criteria with empty command', async () => {
    const { runGateShellVerifications } =
      await import('../../../../src/engine/gates/services/gate-shell-verify-runner.js');

    const gateProvider = {
      loadGates: jest.fn().mockResolvedValue([
        {
          id: 'test',
          name: 'Test',
          type: 'validation',
          description: 'test',
          pass_criteria: [{ type: 'shell_verify', shell_command: [] }],
        },
      ]),
    } as any;

    const results = await runGateShellVerifications(
      ['test'],
      gateProvider,
      undefined,
      createShellVerifyExecutor({})
    );
    expect(results).toHaveLength(0);
  });

  test('returns empty when no gates are loaded', async () => {
    const { runGateShellVerifications } =
      await import('../../../../src/engine/gates/services/gate-shell-verify-runner.js');

    const gateProvider = {
      loadGates: jest.fn().mockResolvedValue([]),
    } as any;

    const results = await runGateShellVerifications(
      ['nonexistent'],
      gateProvider,
      undefined,
      createShellVerifyExecutor({})
    );
    expect(results).toHaveLength(0);
  });
});

describe('shell_response_env_var cannot smuggle a denied key (row 1.6)', () => {
  // `resolveResponseInjection` merges the agent response into the env under a key the
  // GATE AUTHOR names. Documented in docs/guides/gates.md as screened by the same rule
  // as shell_env — pinned here rather than left as a claim, because the mirror is built
  // in the runner while the screening happens in the executor, and nothing structural
  // ties the two together.
  test('refuses a gate that mirrors the response into PATH', async () => {
    const { runGateShellVerifications } =
      await import('../../../../src/engine/gates/services/gate-shell-verify-runner.js');

    const gateProvider = {
      loadGates: jest.fn().mockResolvedValue([
        {
          id: 'smuggle',
          name: 'Smuggle',
          type: 'validation',
          description: 'mirrors the response into PATH',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: ['true'],
              shell_stdin_source: 'agent_response',
              shell_response_env_var: 'PATH',
            },
          ],
        },
      ] as never),
    } as any;

    const results = await runGateShellVerifications(
      ['smuggle'],
      gateProvider,
      { agentResponse: '/attacker/bin' },
      createShellVerifyExecutor({
        allowlist: [SHELL_VERIFY_ALLOW_ALL],
        allowedDirs: [SHELL_VERIFY_ALLOW_ANY_DIR],
      })
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.stderr).toContain('PATH');
  });

  // POSITIVE CONTROL: the same shape with an ordinary key must still run, or the
  // assertion above would hold against a runner that refused every mirrored response.
  test('still mirrors the response into an ordinary key', async () => {
    const { runGateShellVerifications } =
      await import('../../../../src/engine/gates/services/gate-shell-verify-runner.js');

    const gateProvider = {
      loadGates: jest.fn().mockResolvedValue([
        {
          id: 'mirror',
          name: 'Mirror',
          type: 'validation',
          description: 'mirrors the response into an ordinary key',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: ['sh', '-c', 'test "$AGENT_RESPONSE" = "hello"'],
              shell_stdin_source: 'agent_response',
              shell_response_env_var: 'AGENT_RESPONSE',
            },
          ],
        },
      ] as never),
    } as any;

    const results = await runGateShellVerifications(
      ['mirror'],
      gateProvider,
      { agentResponse: 'hello' },
      createShellVerifyExecutor({
        allowlist: [SHELL_VERIFY_ALLOW_ALL],
        allowedDirs: [SHELL_VERIFY_ALLOW_ANY_DIR],
      })
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
  });
});

describe('a shell_verify script that ships inside the gate (P4.105)', () => {
  let gateRoot: string;

  beforeEach(async () => {
    gateRoot = await mkdtemp(path.join(tmpdir(), 'gate-shipped-script-'));
    await mkdir(path.join(gateRoot, 'evidence'), { recursive: true });
    await writeFile(path.join(gateRoot, 'evidence', 'check.js'), 'process.exit(0)\n', 'utf8');
  });

  afterEach(async () => {
    await rm(gateRoot, { recursive: true, force: true });
  });

  const gateWith = (extra: Record<string, unknown>): any => ({
    loadGates: jest.fn().mockResolvedValue([
      {
        id: 'evidence',
        name: 'Evidence',
        type: 'validation',
        description: 'runs a script that ships with it',
        pass_criteria: [{ type: 'shell_verify', shell_command: ['node', 'check.js'] }],
        ...extra,
      },
    ] as never),
  });

  const run = async (gateProvider: any): Promise<GateShellVerifyResult[]> => {
    const { runGateShellVerifications } =
      await import('../../../../src/engine/gates/services/gate-shell-verify-runner.js');
    return runGateShellVerifications(
      ['evidence'],
      gateProvider,
      undefined,
      createShellVerifyExecutor({
        allowlist: [SHELL_VERIFY_ALLOW_ALL],
        allowedDirs: [SHELL_VERIFY_ALLOW_ANY_DIR],
      })
    );
  };

  test('resolves against the root the gate was loaded from, not the working directory', async () => {
    const results = await run(gateWith({ sourceRoot: gateRoot }));

    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
    expect(results[0]!.command).toBe(`node ${path.join(gateRoot, 'evidence', 'check.js')}`);
  });

  // NEGATIVE CONTROL: the same gate with no provenance runs the command as authored, which
  // cannot find the script from the test process's working directory. Without this, the
  // assertion above would hold against a runner that resolved nothing and got lucky on cwd.
  test('a gate with no sourceRoot runs the command exactly as authored, and fails to find it', async () => {
    const results = await run(gateWith({}));

    expect(results).toHaveLength(1);
    expect(results[0]!.command).toBe('node check.js');
    expect(results[0]!.passed).toBe(false);
  });

  test('leaves an argument that names no file in the gate alone', async () => {
    const gateProvider = {
      loadGates: jest.fn().mockResolvedValue([
        {
          id: 'evidence',
          name: 'Evidence',
          type: 'validation',
          description: 'runs an ordinary command',
          sourceRoot: gateRoot,
          pass_criteria: [{ type: 'shell_verify', shell_command: ['sh', '-c', 'exit 0'] }],
        },
      ] as never),
    } as any;

    const results = await run(gateProvider);

    expect(results[0]!.command).toBe('sh -c exit 0');
    expect(results[0]!.passed).toBe(true);
  });
});
