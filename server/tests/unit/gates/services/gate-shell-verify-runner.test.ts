import { createShellVerifyExecutor } from '../../../../src/engine/gates/shell/shell-verify-executor.js';
import { describe, expect, jest, test, beforeEach } from '@jest/globals';

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
          pass_criteria: [{ type: 'llm_self_check' }],
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
          pass_criteria: [{ type: 'shell_verify', shell_command: '' }],
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
