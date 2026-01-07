/**
 * E2E tests for shell verification gates.
 *
 * Tests real command execution through the shell verification system.
 * These tests use actual shell commands to verify the full flow works.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  ShellVerifyExecutor,
  createShellVerifyExecutor,
  resetDefaultShellVerifyExecutor,
} from '../../src/gates/shell/shell-verify-executor.js';
import { SymbolicCommandParser } from '../../src/execution/parsers/symbolic-operator-parser.js';
import type { Logger } from '../../src/logging/index.js';

describe('Shell Verify E2E', () => {
  let executor: ShellVerifyExecutor;
  let tempDir: string;

  beforeEach(async () => {
    resetDefaultShellVerifyExecutor();
    executor = createShellVerifyExecutor({
      defaultTimeout: 30000, // 30 seconds for E2E tests
      debug: false,
    });

    // Create temp directory for test files
    tempDir = await mkdtemp(join(tmpdir(), 'shell-verify-e2e-'));
  });

  afterEach(async () => {
    resetDefaultShellVerifyExecutor();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Real Shell Command Execution', () => {
    test('runs successful shell command', async () => {
      const result = await executor.execute({
        command: 'echo "Hello from E2E test"',
      });

      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from E2E test');
      expect(result.durationMs).toBeGreaterThan(0);
    });

    test('runs failing shell command', async () => {
      const result = await executor.execute({
        command: 'exit 1',
      });

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    test('runs command in specified working directory', async () => {
      const result = await executor.execute({
        command: 'pwd',
        workingDir: tempDir,
      });

      expect(result.passed).toBe(true);
      expect(result.stdout.trim()).toBe(tempDir);
    });

    test('captures multiline output', async () => {
      const result = await executor.execute({
        command: 'echo "line1" && echo "line2" && echo "line3"',
      });

      expect(result.passed).toBe(true);
      expect(result.stdout).toContain('line1');
      expect(result.stdout).toContain('line2');
      expect(result.stdout).toContain('line3');
    });
  });

  describe('Real Test Command Simulation', () => {
    test('simulates npm test passing output', async () => {
      const result = await executor.execute({
        command: `
          echo "PASS src/test.ts"
          echo "  ✓ should handle edge cases"
          echo "  ✓ should validate inputs"
          echo ""
          echo "Tests:  2 passed, 2 total"
          exit 0
        `,
      });

      expect(result.passed).toBe(true);
      expect(result.stdout).toContain('PASS');
      expect(result.stdout).toContain('2 passed');
    });

    test('simulates npm test failing output', async () => {
      const result = await executor.execute({
        command: `
          echo "FAIL src/test.ts"
          echo "  ✗ should handle edge cases"
          echo ""
          echo "Expected: 200"
          echo "Received: 500"
          echo ""
          echo "Tests:  1 failed, 1 total" >&2
          exit 1
        `,
      });

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('FAIL');
      expect(result.stderr).toContain('1 failed');
    });

    test('simulates lint command', async () => {
      const result = await executor.execute({
        command: 'echo "No ESLint issues found"',
      });

      expect(result.passed).toBe(true);
      expect(result.stdout).toContain('No ESLint issues');
    });
  });

  describe('File-Based Verification', () => {
    test('verifies file creation', async () => {
      // Create a test file
      const testFile = join(tempDir, 'output.txt');
      await writeFile(testFile, 'test content');

      const result = await executor.execute({
        command: `test -f "${testFile}" && echo "File exists"`,
        workingDir: tempDir,
      });

      expect(result.passed).toBe(true);
      expect(result.stdout).toContain('File exists');
    });

    test('verifies file content', async () => {
      const testFile = join(tempDir, 'config.json');
      await writeFile(testFile, '{"valid": true}');

      const result = await executor.execute({
        command: `cat "${testFile}" | grep -q "valid" && echo "Valid JSON"`,
        workingDir: tempDir,
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('Parser to Executor Flow', () => {
    const mockLogger: Logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    test('parses and extracts verify command for execution', async () => {
      const parser = new SymbolicCommandParser(mockLogger);
      const parsed = parser.detectOperators('>>implement :: verify:"echo SUCCESS"');

      // Find shell verify gate
      const verifyGate = parsed.operators.find(
        (op) => op.type === 'gate' && op.shellVerify
      );

      expect(verifyGate).toBeDefined();
      expect(verifyGate?.shellVerify?.command).toBe('echo SUCCESS');

      // Execute the parsed command
      const result = await executor.execute({
        command: verifyGate!.shellVerify!.command,
      });

      expect(result.passed).toBe(true);
      expect(result.stdout).toContain('SUCCESS');
    });

    test('handles verify with options', async () => {
      const parser = new SymbolicCommandParser(mockLogger);
      const parsed = parser.detectOperators(
        '>>fix :: verify:"echo DONE" timeout:60 loop:true'
      );

      const verifyGate = parsed.operators.find(
        (op) => op.type === 'gate' && op.shellVerify
      );

      expect(verifyGate?.shellVerify?.command).toBe('echo DONE');
      expect(verifyGate?.shellVerify?.timeout).toBe(60000); // Converted to ms
      expect(verifyGate?.shellVerify?.loop).toBe(true);
    });
  });

  describe('Timeout Behavior', () => {
    test('handles command timeout', async () => {
      const shortTimeoutExecutor = createShellVerifyExecutor({
        defaultTimeout: 500, // Very short - will be clamped to 1000ms
      });

      const result = await shortTimeoutExecutor.execute({
        command: 'sleep 10', // Should timeout
      });

      expect(result.passed).toBe(false);
      expect(result.timedOut).toBe(true);
    }, 15000); // Extended Jest timeout
  });

  describe('Environment Isolation', () => {
    test('blocks sensitive environment variables', async () => {
      // Set sensitive env var
      const originalSecret = process.env.MY_SECRET_KEY;
      process.env.MY_SECRET_KEY = 'super-secret-value';

      try {
        const result = await executor.execute({
          command: 'echo "SECRET=$MY_SECRET_KEY"',
        });

        // The secret should NOT be in the subprocess
        expect(result.stdout).not.toContain('super-secret-value');
        expect(result.stdout).toContain('SECRET='); // Empty value
      } finally {
        if (originalSecret) {
          process.env.MY_SECRET_KEY = originalSecret;
        } else {
          delete process.env.MY_SECRET_KEY;
        }
      }
    });

    test('allows custom env vars', async () => {
      const result = await executor.execute({
        command: 'echo "VAR=$CUSTOM_TEST_VAR"',
        env: { CUSTOM_TEST_VAR: 'custom-value' },
      });

      expect(result.passed).toBe(true);
      expect(result.stdout).toContain('VAR=custom-value');
    });
  });
});
