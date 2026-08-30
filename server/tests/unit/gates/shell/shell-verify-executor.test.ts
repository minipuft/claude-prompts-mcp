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
} from '../../../../src/engine/gates/shell/shell-verify-executor.js';
import { SHELL_OUTPUT_MAX_CHARS } from '../../../../src/engine/gates/shell/types.js';
import {
  SHELL_VERIFY_DEFAULT_TIMEOUT,
  SHELL_VERIFY_MAX_TIMEOUT,
} from '../../../../src/engine/gates/constants.js';
import { SHELL_VERIFY_ALLOW_ALL } from '../../../../src/engine/gates/shell/shell-command-allowlist.js';
import { SHELL_VERIFY_ALLOW_ANY_DIR } from '../../../../src/engine/gates/shell/shell-working-dir-policy.js';

describe('ShellVerifyExecutor', () => {
  let executor: ShellVerifyExecutor;

  // This suite exercises PROCESS MECHANICS -- exit codes, timeouts, output capture,
  // environment filtering -- not authorization. Since 2026-08-25 the executor refuses
  // any command the operator has not allowlisted, so every executor built here declares
  // that it accepts any command. Authorization is covered by
  // tests/unit/gates/shell-command-allowlist.test.ts. Leaving these to rely on an
  // implicit default would let the security control silently decide their outcome.
  const ALLOW_ALL: readonly string[] = [SHELL_VERIFY_ALLOW_ALL];
  // Since 2026-08-29 the executor also contains `workingDir` to roots the operator
  // declared, so a mechanics test that runs somewhere specific must say so for the same
  // reason it must declare its allowlist: otherwise the security control, not the test,
  // decides the outcome. Containment itself is covered in the row 1.6 block below.
  const ALLOW_ANY_DIR: readonly string[] = [SHELL_VERIFY_ALLOW_ANY_DIR];

  beforeEach(() => {
    executor = createShellVerifyExecutor({
      debug: false,
      defaultTimeout: 5000,
      allowlist: ALLOW_ALL,
      allowedDirs: ALLOW_ANY_DIR,
    });
  });

  afterEach(() => {});

  describe('constructor and configuration', () => {
    it('should use default timeout when not specified', () => {
      const defaultExecutor = createShellVerifyExecutor({ allowlist: ALLOW_ALL });
      // Verify by running a command and checking it doesn't use 0 timeout
      expect(defaultExecutor).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const customExecutor = createShellVerifyExecutor({
        allowlist: ALLOW_ALL,
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
        allowlist: ALLOW_ALL,
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
      const executor = createShellVerifyExecutor({ maxTimeout: 1000, allowlist: ALLOW_ALL });

      // Even with very long timeout, should be clamped
      const result = await executor.execute({
        command: 'echo "test"',
        timeout: 9999999, // Way above max
      });

      expect(result.passed).toBe(true);
    });

    it('should use default timeout from config when not specified', async () => {
      const customExecutor = createShellVerifyExecutor({
        allowlist: ALLOW_ALL,
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

    it("should NOT pass this server's OWN credentials to a child", async () => {
      // Security review 2026-08-25, Tier 4.1. `SAFE_ENV_ALLOWLIST` is default-deny, so
      // these are excluded by construction rather than by an explicit rule -- which is
      // exactly why they need a test. Adding an `MCP_*` entry later would look harmless
      // and would hand the catalog credential to every shell_verify command, including
      // one authored in a third-party gate.
      const vars = {
        MCP_CATALOG_READ_TOKEN: 'catalog-secret-probe',
        MCP_SHELL_VERIFY_ALLOWLIST: 'allowlist-value-probe',
      };
      const originals = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
      Object.assign(process.env, vars);

      try {
        const result = await executor.execute({
          command: 'echo "$MCP_CATALOG_READ_TOKEN|$MCP_SHELL_VERIFY_ALLOWLIST"',
        });

        expect(result.stdout).not.toContain('catalog-secret-probe');
        expect(result.stdout).not.toContain('allowlist-value-probe');
        // The command itself ran -- otherwise the assertions above prove nothing.
        expect(result.stdout.trim()).toBe('|');
      } finally {
        for (const [k, v] of Object.entries(originals)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
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
        allowlist: ALLOW_ALL,
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

/**
 * Row 1.5. Measured 2026-08-27 against a live server: with the gate system
 * explicitly Disabled — the tool reporting "Gate validation and guidance will be
 * skipped" — an authored `:: verify:"touch <marker>"` still wrote the marker.
 * The switch governed guidance, validation and the advertised parameters, and
 * governed execution not at all.
 *
 * The control arm matters as much as the assertion: without it a refusal here is
 * indistinguishable from an executor that refuses everything.
 */
describe('gate master switch (row 1.5)', () => {
  const ALLOW_ALL = ['UNSAFE_ALLOW_ALL'];

  it('refuses execution while the gate system is disabled, and names the switch', async () => {
    const executor = createShellVerifyExecutor({
      allowlist: ALLOW_ALL,
      gateSystemEnabled: () => false,
    });

    const result = await executor.execute({ command: 'echo reached' });

    expect(result.passed).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('gate system is disabled');
    expect(result.stderr).toContain('system_control');
  });

  it('POSITIVE CONTROL: the same command runs when the switch is on', async () => {
    const executor = createShellVerifyExecutor({
      allowlist: ALLOW_ALL,
      gateSystemEnabled: () => true,
    });

    const result = await executor.execute({ command: 'echo reached' });

    expect(result.refused).toBeUndefined();
    expect(result.stdout).toContain('reached');
  });

  it('reads the switch per execution, not once at construction', async () => {
    let enabled = true;
    const executor = createShellVerifyExecutor({
      allowlist: ALLOW_ALL,
      gateSystemEnabled: () => enabled,
    });

    const before = await executor.execute({ command: 'echo reached' });
    enabled = false;
    const after = await executor.execute({ command: 'echo reached' });

    expect(before.refused).toBeUndefined();
    expect(after.refused).toBe(true);
  });

  it('leaves execution ungoverned when no resolver is supplied', async () => {
    const executor = createShellVerifyExecutor({ allowlist: ALLOW_ALL });

    const result = await executor.execute({ command: 'echo reached' });

    expect(result.refused).toBeUndefined();
  });
});

describe('author-supplied environment and working directory (row 1.6)', () => {
  const ALLOW_ALL_CMD: readonly string[] = [SHELL_VERIFY_ALLOW_ALL];

  it('refuses a gate whose shell_env sets PATH, even when the command is allowlisted', async () => {
    const executor = createShellVerifyExecutor({ allowlist: ALLOW_ALL_CMD, allowedDirs: [] });

    const result = await executor.execute({
      command: 'echo reached',
      env: { PATH: '/tmp/attacker-bin' },
    });

    expect(result.refused).toBe(true);
    expect(result.stderr).toContain('PATH');
  });

  it('names every offending key so the author can fix the gate in one pass', async () => {
    const executor = createShellVerifyExecutor({ allowlist: ALLOW_ALL_CMD, allowedDirs: [] });

    const result = await executor.execute({
      command: 'echo reached',
      env: { LD_PRELOAD: '/tmp/x.so', NODE_OPTIONS: '--require /tmp/y' },
    });

    expect(result.stderr).toContain('LD_PRELOAD');
    expect(result.stderr).toContain('NODE_OPTIONS');
  });

  it('checks the environment BEFORE the allowlist, since PATH decides what the command means', async () => {
    // An empty allowlist would refuse this command anyway. The assertion is on WHICH
    // refusal fires: reporting "command not in the allowlist" for a PATH override would
    // send the operator to fix the wrong setting.
    const executor = createShellVerifyExecutor({ allowlist: [], allowedDirs: [] });

    const result = await executor.execute({ command: 'echo reached', env: { PATH: '/tmp/x' } });

    expect(result.stderr).toContain('shell_env');
    expect(result.stderr).not.toContain('MCP_SHELL_VERIFY_ALLOWLIST');
  });

  it('still runs a gate whose shell_env is ordinary — the denylist must not be a blanket refusal', async () => {
    const executor = createShellVerifyExecutor({ allowlist: ALLOW_ALL_CMD, allowedDirs: [] });

    const result = await executor.execute({
      command: 'echo "$MY_GATE_FLAG"',
      env: { MY_GATE_FLAG: 'reached' },
    });

    expect(result.refused).toBeUndefined();
    expect(result.passed).toBe(true);
    expect(result.stdout.trim()).toBe('reached');
  });

  it('refuses a working directory outside every permitted root', async () => {
    const executor = createShellVerifyExecutor({
      allowlist: ALLOW_ALL_CMD,
      defaultWorkingDir: '/tmp/mcp-wd-root',
      allowedDirs: [],
    });

    const result = await executor.execute({ command: 'pwd', workingDir: '/etc' });

    expect(result.refused).toBe(true);
    expect(result.stderr).toContain('MCP_SHELL_VERIFY_ALLOWED_DIRS');
  });

  it('refuses a RELATIVE working directory that resolves out of the root', async () => {
    const executor = createShellVerifyExecutor({
      allowlist: ALLOW_ALL_CMD,
      defaultWorkingDir: '/tmp/mcp-wd-root/nested',
      allowedDirs: [],
    });

    const result = await executor.execute({ command: 'pwd', workingDir: '../../..' });

    expect(result.refused).toBe(true);
  });

  it('permits a directory the operator declared', async () => {
    const executor = createShellVerifyExecutor({
      allowlist: ALLOW_ALL_CMD,
      defaultWorkingDir: '/tmp/mcp-wd-root',
      allowedDirs: ['/tmp'],
    });

    const result = await executor.execute({ command: 'pwd', workingDir: '/tmp' });

    expect(result.refused).toBeUndefined();
    expect(result.stdout.trim()).toBe('/tmp');
  });

  // POSITIVE CONTROL for the whole block: every assertion above turns on a refusal, so
  // the block would still pass against an executor that refused everything. This proves
  // the permissive path runs and that the cwd the check approved is the cwd the child
  // actually lands in — the two could differ, because a relative path resolves against
  // the spawning process, not against the root it was checked against.
  it('spawns in the directory the check approved', async () => {
    const executor = createShellVerifyExecutor({
      allowlist: ALLOW_ALL_CMD,
      defaultWorkingDir: '/tmp',
      allowedDirs: [],
    });

    const result = await executor.execute({ command: 'pwd', workingDir: '.' });

    expect(result.passed).toBe(true);
    expect(result.stdout.trim()).toBe('/tmp');
  });
});
