// @lifecycle canonical - Shell verification executor for Ralph Wiggum loops.
/**
 * Shell Verification Executor
 *
 * Handles gate verification by running shell commands and interpreting
 * exit codes. Delegates subprocess lifecycle to the stateless `executeProcess`
 * utility in shared/utils/process.ts.
 *
 * Shell-specific options applied per call:
 * - processGroup: true (shell commands may spawn child processes)
 * - truncateOutput: SHELL_OUTPUT_MAX_CHARS (prevent context overflow)
 * - parseJson: false (raw command output)
 *
 * @see shared/utils/process.ts for the shared execution utility
 * @see plans/ralph-style-loop.md for the implementation plan
 */

import { executeProcess } from '../../../shared/utils/process.js';
import { SHELL_VERIFY_DEFAULT_TIMEOUT, SHELL_VERIFY_MAX_TIMEOUT } from '../constants.js';
import { SHELL_OUTPUT_MAX_CHARS } from './types.js';

import type { ShellVerifyGate, ShellVerifyResult, ShellVerifyExecutorConfig } from './types.js';

/**
 * Shell Verification Executor
 *
 * Class wrapper preserves the existing public API (consumer code uses
 * `executor.execute(gate)`). Internally it just maps domain types to
 * `executeProcess` options.
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
  }

  /**
   * Execute a shell verification command.
   *
   * @param gate - Shell verification gate configuration
   * @returns Verification result with pass/fail status and output
   */
  async execute(gate: ShellVerifyGate): Promise<ShellVerifyResult> {
    const { command, workingDir, timeout, env, stdin } = gate;

    if (!command || command.trim() === '') {
      return {
        passed: false,
        exitCode: -1,
        stdout: '',
        stderr: 'Empty command provided',
        durationMs: 0,
        command: command ?? '',
      };
    }

    const result = await executeProcess({
      command,
      cwd: workingDir ?? this.defaultWorkingDir,
      env,
      stdin,
      timeout: timeout ?? this.defaultTimeout,
      minTimeout: 1000,
      maxTimeout: this.maxTimeout,
      processGroup: true,
      truncateOutput: SHELL_OUTPUT_MAX_CHARS,
      parseJson: false,
      debug: this.debug,
    });

    const shellResult: ShellVerifyResult = {
      passed: result.timedOut !== true && result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      command,
    };

    if (result.timedOut === true) {
      shellResult.timedOut = true;
    }

    return shellResult;
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
