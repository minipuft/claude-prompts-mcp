// @lifecycle canonical - Shell verification executor for Ralph Wiggum loops.
/**
 * Shell Verification Executor
 *
 * Executes shell commands for verification gates, enabling "Ralph Wiggum"
 * style autonomous loops where Claude's work is validated by real command
 * execution (ground truth) rather than LLM self-evaluation.
 *
 * Reuses patterns from scripts/execution/script-executor.ts:
 * - spawn('sh', ['-c', command]) for shell execution
 * - Timeout enforcement via setTimeout + proc.kill()
 * - Capture stdout/stderr with truncation
 * - Exit code 0 = PASS, non-zero = FAIL
 *
 * @see plans/ralph-style-loop.md for the implementation plan
 */

import { spawn } from 'child_process';

import { SHELL_OUTPUT_MAX_CHARS } from './types.js';
import { SHELL_VERIFY_DEFAULT_TIMEOUT, SHELL_VERIFY_MAX_TIMEOUT } from '../constants.js';

import type { ShellVerifyGate, ShellVerifyResult, ShellVerifyExecutorConfig } from './types.js';

/**
 * Environment variables safe to inherit from parent process.
 * Mirrors the allowlist from ScriptExecutor to prevent credential leakage.
 */
const SAFE_ENV_ALLOWLIST: Set<string> = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',
  'NODE_ENV',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'CI',
  'GITHUB_ACTIONS',
]);

/**
 * Shell Verification Executor
 *
 * Handles execution of shell commands for verification gates with
 * timeout enforcement, output capture, and proper process cleanup.
 *
 * @example
 * ```typescript
 * const executor = new ShellVerifyExecutor();
 *
 * const result = await executor.execute({
 *   command: 'npm test',
 *   timeout: 60000,
 * });
 *
 * if (result.passed) {
 *   console.log('Tests passed!');
 * } else {
 *   console.log('Tests failed:', result.stderr);
 * }
 * ```
 */
export class ShellVerifyExecutor {
  private readonly defaultTimeout: number;
  private readonly maxTimeout: number;
  private readonly defaultWorkingDir: string;
  private readonly debug: boolean;

  constructor(config: ShellVerifyExecutorConfig = {}) {
    this.defaultTimeout = config.defaultTimeout ?? SHELL_VERIFY_DEFAULT_TIMEOUT;
    this.maxTimeout = config.maxTimeout ?? SHELL_VERIFY_MAX_TIMEOUT;
    this.defaultWorkingDir = config.defaultWorkingDir ?? process.cwd();
    this.debug = config.debug ?? false;

    if (this.debug) {
      console.error('[ShellVerifyExecutor] Initialized with config:', {
        defaultTimeout: this.defaultTimeout,
        maxTimeout: this.maxTimeout,
        defaultWorkingDir: this.defaultWorkingDir,
      });
    }
  }

  /**
   * Execute a shell verification command.
   *
   * @param gate - Shell verification gate configuration
   * @returns Verification result with pass/fail status and output
   */
  async execute(gate: ShellVerifyGate): Promise<ShellVerifyResult> {
    const startTime = Date.now();
    const { command, workingDir, timeout, env } = gate;

    if (!command || command.trim() === '') {
      return this.createResult({
        startTime,
        command: command ?? '',
        passed: false,
        exitCode: -1,
        stdout: '',
        stderr: 'Empty command provided',
      });
    }

    const resolvedTimeout = this.resolveTimeout(timeout);
    const resolvedWorkingDir = workingDir ?? this.defaultWorkingDir;
    const resolvedEnv = this.buildEnvironment(env);

    if (this.debug) {
      console.error(`[ShellVerifyExecutor] Executing: ${command}`);
      console.error(`[ShellVerifyExecutor] Working directory: ${resolvedWorkingDir}`);
      console.error(`[ShellVerifyExecutor] Timeout: ${resolvedTimeout}ms`);
    }

    try {
      return await this.spawnShell({
        command,
        cwd: resolvedWorkingDir,
        env: resolvedEnv,
        timeout: resolvedTimeout,
        startTime,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createResult({
        startTime,
        command,
        passed: false,
        exitCode: -1,
        stdout: '',
        stderr: `Execution error: ${errorMessage}`,
      });
    }
  }

  /**
   * Resolve and clamp timeout value.
   */
  private resolveTimeout(timeout?: number): number {
    const resolved = timeout ?? this.defaultTimeout;
    return Math.min(Math.max(resolved, 1000), this.maxTimeout);
  }

  /**
   * Build environment variables for command execution.
   * Uses allowlist to prevent credential leakage.
   */
  private buildEnvironment(additionalEnv?: Record<string, string>): NodeJS.ProcessEnv {
    const safeEnv: Record<string, string> = {};

    for (const key of SAFE_ENV_ALLOWLIST) {
      if (process.env[key] !== undefined) {
        safeEnv[key] = process.env[key]!;
      }
    }

    return {
      ...safeEnv,
      ...(additionalEnv ?? {}),
    };
  }

  /**
   * Spawn a shell process and capture output.
   */
  private spawnShell(options: {
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    startTime: number;
  }): Promise<ShellVerifyResult> {
    return new Promise((resolve) => {
      const { command, cwd, env, timeout, startTime } = options;

      const proc = spawn('sh', ['-c', command], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 1000);
      }, timeout);

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > SHELL_OUTPUT_MAX_CHARS * 2) {
          stdout = stdout.slice(-SHELL_OUTPUT_MAX_CHARS * 2);
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > SHELL_OUTPUT_MAX_CHARS * 2) {
          stderr = stderr.slice(-SHELL_OUTPUT_MAX_CHARS * 2);
        }
      });

      proc.stdin?.end();

      proc.on('close', (code) => {
        clearTimeout(timeoutId);

        const exitCode = code ?? (timedOut ? -1 : 0);
        const passed = !timedOut && exitCode === 0;

        resolve(
          this.createResult({
            startTime,
            command,
            passed,
            exitCode,
            stdout: this.truncateOutput(stdout),
            stderr: this.truncateOutput(stderr),
            timedOut: timedOut || undefined,
          })
        );
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve(
          this.createResult({
            startTime,
            command,
            passed: false,
            exitCode: -1,
            stdout: this.truncateOutput(stdout),
            stderr: `Spawn error: ${error.message}`,
          })
        );
      });
    });
  }

  /**
   * Truncate output to prevent context overflow.
   */
  private truncateOutput(output: string): string {
    if (output.length <= SHELL_OUTPUT_MAX_CHARS) {
      return output;
    }

    const truncated = output.slice(-SHELL_OUTPUT_MAX_CHARS);
    return `[...truncated ${output.length - SHELL_OUTPUT_MAX_CHARS} chars...]\n${truncated}`;
  }

  /**
   * Create a verification result with timing.
   */
  private createResult(params: {
    startTime: number;
    command: string;
    passed: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut?: boolean;
  }): ShellVerifyResult {
    const { startTime, command, passed, exitCode, stdout, stderr, timedOut } = params;

    const result: ShellVerifyResult = {
      passed,
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startTime,
      command,
    };

    if (timedOut) {
      result.timedOut = true;
    }

    return result;
  }
}

/**
 * Factory function with default configuration.
 */
export function createShellVerifyExecutor(config?: ShellVerifyExecutorConfig): ShellVerifyExecutor {
  return new ShellVerifyExecutor(config);
}

// ============================================================================
// Default Instance Management (singleton pattern)
// ============================================================================

let defaultExecutor: ShellVerifyExecutor | null = null;

/**
 * Get the default ShellVerifyExecutor instance.
 * Creates one if it doesn't exist.
 */
export function getDefaultShellVerifyExecutor(): ShellVerifyExecutor {
  if (!defaultExecutor) {
    defaultExecutor = new ShellVerifyExecutor();
  }
  return defaultExecutor;
}

/**
 * Reset the default executor (useful for testing).
 */
export function resetDefaultShellVerifyExecutor(): void {
  defaultExecutor = null;
}
