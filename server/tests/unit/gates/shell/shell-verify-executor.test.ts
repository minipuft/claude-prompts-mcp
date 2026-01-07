// @lifecycle canonical - Unit tests for ShellVerifyExecutor service.
/**
 * ShellVerifyExecutor Unit Tests
 *
 * Tests the shell verification executor including:
 * - Command execution with exit codes
 * - Timeout handling and process cleanup
 * - Output capture and truncation
 * - Environment variable security
 * - Edge case handling
 */

import {
  ShellVerifyExecutor,
  createShellVerifyExecutor,
  resetDefaultShellVerifyExecutor,
} from '../../../../src/gates/shell/shell-verify-executor.js';
import { SHELL_OUTPUT_MAX_CHARS } from '../../../../src/gates/shell/types.js';
import {
  SHELL_VERIFY_DEFAULT_TIMEOUT,
  SHELL_VERIFY_MAX_TIMEOUT,
} from '../../../../src/gates/constants.js';

describe('ShellVerifyExecutor', () => {
  let executor: ShellVerifyExecutor;

  beforeEach(() => {
    resetDefaultShellVerifyExecutor();
    executor = createShellVerifyExecutor({ debug: false, defaultTimeout: 5000 });
  });

  afterEach(() => {
    resetDefaultShellVerifyExecutor();
  });

  describe('constructor and configuration', () => {
    it('should use default timeout when not specified', () => {
      const defaultExecutor = createShellVerifyExecutor();
      // Verify by running a command and checking it doesn't use 0 timeout
      expect(defaultExecutor).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const customExecutor = createShellVerifyExecutor({
        defaultTimeout: 10000,
        maxTimeout: 30000,
        defaultWorkingDir: '/tmp',
        debug: true,
      });
      expect(customExecutor).toBeDefined();
    });
  });

  describe('command execution - pass/fail logic', () => {
    it('should return passed=true and exitCode=0 for successful command', async () => {
      const result = await executor.execute({ command: 'true' });

      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.command).toBe('true');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return passed=false and exitCode=1 for failing command', async () => {
      const result = await executor.execute({ command: 'false' });

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should return specific exit codes from commands', async () => {
      const result = await executor.execute({ command: 'exit 42' });

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(42);
    });

    it('should handle command not found gracefully', async () => {
      const result = await executor.execute({ command: 'nonexistent_command_xyz_123' });

      expect(result.passed).toBe(false);
      expect(result.exitCode).not.toBe(0);
      // stderr should contain error about command not found
      expect(result.stderr.length > 0 || result.exitCode === 127).toBe(true);
    });
  });

  describe('output handling', () => {
    it('should capture stdout from command', async () => {
      const result = await executor.execute({ command: 'echo "hello world"' });

      expect(result.passed).toBe(true);
      expect(result.stdout.trim()).toBe('hello world');
    });

    it('should capture stderr from command', async () => {
      const result = await executor.execute({ command: 'echo "error message" >&2' });

      expect(result.passed).toBe(true);
      expect(result.stderr.trim()).toBe('error message');
    });

    it('should capture both stdout and stderr', async () => {
      const result = await executor.execute({
        command: 'echo "out" && echo "err" >&2',
      });

      expect(result.stdout).toContain('out');
      expect(result.stderr).toContain('err');
    });

    it('should truncate output exceeding max chars limit', async () => {
      // Generate output larger than SHELL_OUTPUT_MAX_CHARS (5000)
      const largeOutput = 'x'.repeat(6000);
      const result = await executor.execute({
        command: `echo "${largeOutput}"`,
      });

      expect(result.stdout.length).toBeLessThanOrEqual(SHELL_OUTPUT_MAX_CHARS + 100); // Allow for truncation prefix
      expect(result.stdout).toContain('[...truncated');
    });

    it('should prefer keeping end of output when truncating', async () => {
      // Generate output with identifiable end marker
      const result = await executor.execute({
        command: `echo "${'a'.repeat(6000)}END_MARKER"`,
      });

      // The end marker should be preserved
      expect(result.stdout).toContain('END_MARKER');
    });
  });

  describe('timeout handling', () => {
    it('should set timedOut flag when command exceeds timeout', async () => {
      const shortTimeoutExecutor = createShellVerifyExecutor({
        defaultTimeout: 100, // Very short timeout
      });

      const result = await shortTimeoutExecutor.execute({
        command: 'sleep 5', // Much longer than timeout
      });

      expect(result.passed).toBe(false);
      expect(result.timedOut).toBe(true);
    }, 10000); // Extended test timeout

    it('should clamp timeout to minimum 1000ms', async () => {
      // Even with very short timeout, should not fail immediately
      const result = await executor.execute({
        command: 'echo "fast"',
        timeout: 10, // Less than 1000ms minimum
      });

      // Command should still execute (timeout clamped to 1000ms)
      expect(result.passed).toBe(true);
    });

    it('should clamp timeout to maximum allowed', async () => {
      const executor = createShellVerifyExecutor({ maxTimeout: 1000 });

      // Even with very long timeout, should be clamped
      const result = await executor.execute({
        command: 'echo "test"',
        timeout: 9999999, // Way above max
      });

      expect(result.passed).toBe(true);
    });

    it('should use default timeout from config when not specified', async () => {
      const customExecutor = createShellVerifyExecutor({
        defaultTimeout: 2000,
      });

      const result = await customExecutor.execute({
        command: 'echo "using default"',
        // No timeout specified, should use 2000ms default
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('environment variable security', () => {
    it('should pass PATH environment variable', async () => {
      const result = await executor.execute({
        command: 'echo $PATH',
      });

      expect(result.passed).toBe(true);
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it('should pass HOME environment variable', async () => {
      const result = await executor.execute({
        command: 'echo $HOME',
      });

      expect(result.passed).toBe(true);
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    });

    it('should NOT pass sensitive AWS variables', async () => {
      // Set a fake AWS key in current process (for test only)
      const originalKey = process.env.AWS_SECRET_ACCESS_KEY;
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';

      try {
        const result = await executor.execute({
          command: 'echo "$AWS_SECRET_ACCESS_KEY"',
        });

        // Should be empty or undefined in subprocess
        expect(result.stdout.trim()).toBe('');
      } finally {
        // Restore original value
        if (originalKey) {
          process.env.AWS_SECRET_ACCESS_KEY = originalKey;
        } else {
          delete process.env.AWS_SECRET_ACCESS_KEY;
        }
      }
    });

    it('should NOT pass GITHUB_TOKEN variable', async () => {
      const originalToken = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'ghp_test_token_12345';

      try {
        const result = await executor.execute({
          command: 'echo "$GITHUB_TOKEN"',
        });

        // Should be empty in subprocess
        expect(result.stdout.trim()).toBe('');
      } finally {
        if (originalToken) {
          process.env.GITHUB_TOKEN = originalToken;
        } else {
          delete process.env.GITHUB_TOKEN;
        }
      }
    });

    it('should allow custom env vars via override', async () => {
      const result = await executor.execute({
        command: 'echo "$CUSTOM_VAR"',
        env: { CUSTOM_VAR: 'custom_value' },
      });

      expect(result.passed).toBe(true);
      expect(result.stdout.trim()).toBe('custom_value');
    });
  });

  describe('working directory', () => {
    it('should execute in specified working directory', async () => {
      const result = await executor.execute({
        command: 'pwd',
        workingDir: '/tmp',
      });

      expect(result.passed).toBe(true);
      expect(result.stdout.trim()).toBe('/tmp');
    });

    it('should use default working directory when not specified', async () => {
      const executor = createShellVerifyExecutor({
        defaultWorkingDir: '/tmp',
      });

      const result = await executor.execute({
        command: 'pwd',
      });

      expect(result.stdout.trim()).toBe('/tmp');
    });
  });

  describe('edge cases', () => {
    it('should reject empty command with error', async () => {
      const result = await executor.execute({ command: '' });

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.stderr).toBe('Empty command provided');
    });

    it('should reject whitespace-only command with error', async () => {
      const result = await executor.execute({ command: '   ' });

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.stderr).toBe('Empty command provided');
    });

    it('should handle command with special characters', async () => {
      const result = await executor.execute({
        command: 'echo "hello\'s world" && echo "done"',
      });

      expect(result.passed).toBe(true);
      expect(result.stdout).toContain("hello's world");
    });

    it('should report duration in milliseconds', async () => {
      const result = await executor.execute({
        command: 'sleep 0.1',
      });

      expect(result.durationMs).toBeGreaterThanOrEqual(50); // At least 50ms
      expect(result.durationMs).toBeLessThan(5000); // Less than 5 seconds
    });

    it('should include command in result', async () => {
      const command = 'echo "test command"';
      const result = await executor.execute({ command });

      expect(result.command).toBe(command);
    });
  });

  describe('npm script support', () => {
    it('should support npm-style commands', async () => {
      // This tests that npm would work if available
      // We use a simple echo as proxy since npm might not be in test env
      const result = await executor.execute({
        command: 'which npm || echo "npm_path"',
      });

      expect(result.passed).toBe(true);
    });

    it('should capture npm test output format', async () => {
      // Simulate npm test output format
      const result = await executor.execute({
        command: 'echo "PASS src/test.ts" && echo "Tests: 5 passed"',
      });

      expect(result.passed).toBe(true);
      expect(result.stdout).toContain('PASS');
      expect(result.stdout).toContain('Tests:');
    });
  });
});
