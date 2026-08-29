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

import { SHELL_VERIFY_DEFAULT_TIMEOUT, SHELL_VERIFY_MAX_TIMEOUT } from '../constants.js';
import { isCommandAllowed, loadShellVerifyAllowlist } from './shell-command-allowlist.js';
import { isWorkingDirAllowed, loadShellVerifyAllowedDirs } from './shell-working-dir-policy.js';
import { SHELL_OUTPUT_MAX_CHARS } from './types.js';

import type { ShellVerifyGate, ShellVerifyResult, ShellVerifyExecutorConfig } from './types.js';

import { executeProcess, findUnsafeEnvironmentKeys } from '#shared/utils/process.js';

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
  private readonly allowlist: readonly string[] | undefined;
  private readonly allowedDirs: readonly string[] | undefined;
  private readonly gateSystemEnabled: (() => boolean) | undefined;

  constructor(config: ShellVerifyExecutorConfig = {}) {
    this.defaultTimeout = config.defaultTimeout ?? SHELL_VERIFY_DEFAULT_TIMEOUT;
    this.maxTimeout = config.maxTimeout ?? SHELL_VERIFY_MAX_TIMEOUT;
    this.defaultWorkingDir = config.defaultWorkingDir ?? process.cwd();
    this.debug = config.debug ?? false;
    this.allowlist = config.allowlist;
    this.allowedDirs = config.allowedDirs;
    this.gateSystemEnabled = config.gateSystemEnabled;
  }

  /**
   * Resolve the allowlist for this call.
   *
   * Read per execution rather than cached at construction because the default
   * executor is a process-lifetime singleton, and a value captured once would
   * make the control untestable and unable to follow a re-read of the operator's
   * environment. An injected list (tests, embedders) always wins.
   */
  private resolveAllowlist(): readonly string[] {
    return this.allowlist ?? loadShellVerifyAllowlist();
  }

  /** Read the operator's additional working-directory roots, per execution, as above. */
  private resolveAllowedDirs(): readonly string[] {
    return this.allowedDirs ?? loadShellVerifyAllowedDirs();
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

    // The master switch is checked before the allowlist because the two answer
    // different questions: whether the gate subsystem runs at all, versus what a
    // running gate may execute. They compose with AND, and an operator who
    // disabled the system is entitled to have that mean it.
    if (this.gateSystemEnabled?.() === false) {
      return {
        passed: false,
        refused: true,
        exitCode: -1,
        stdout: '',
        stderr:
          'Shell verification refused: the gate system is disabled. ' +
          'Re-enable it with system_control action="gates", operation="enable".',
        durationMs: 0,
        command,
      };
    }

    // The gate is refused, not downgraded to advisory. A gate that reports as
    // passed while having verified nothing is the defect this repository already
    // records fixing; and one hostile gate must not take the server down, so the
    // refusal is scoped to this gate and execution continues.
    // The allowlist bounds the command STRING; these keys decide what that string
    // resolves to. An allowlisted `npm test` carrying an author-supplied PATH runs
    // the author's `npm`, so checking them after the allowlist would be checking
    // the wrong thing (row 1.6). Refused with no opt-out, per ruling R7.
    const unsafeEnvKeys = findUnsafeEnvironmentKeys(env);
    if (unsafeEnvKeys.length > 0) {
      return {
        passed: false,
        refused: true,
        exitCode: -1,
        stdout: '',
        stderr:
          `Shell verification refused: this gate's shell_env sets ` +
          `${unsafeEnvKeys.join(', ')}, which decide what an allowed command resolves ` +
          `to or loads. Remove them from the gate definition; no setting permits them.`,
        durationMs: 0,
        command,
      };
    }

    const decision = isCommandAllowed(command, this.resolveAllowlist());
    if (!decision.allowed) {
      return {
        passed: false,
        refused: true,
        exitCode: -1,
        stdout: '',
        stderr: `Shell verification refused: ${decision.reason ?? 'command not permitted'}`,
        durationMs: 0,
        command,
      };
    }

    // Checked after the command, because the message is more useful once the command
    // itself is known to be permitted. Contained rather than refused: the command is
    // still the operator's, and blocking a legitimate sibling checkout outright pushes
    // operators to UNSAFE_ALLOW_ALL, which is worse (ruling R7).
    const dirDecision = isWorkingDirAllowed(
      workingDir,
      this.defaultWorkingDir,
      this.resolveAllowedDirs()
    );
    if (!dirDecision.allowed) {
      return {
        passed: false,
        refused: true,
        exitCode: -1,
        stdout: '',
        stderr: `Shell verification refused: ${dirDecision.reason ?? 'working directory not permitted'}`,
        durationMs: 0,
        command,
      };
    }

    const result = await executeProcess({
      command,
      // The value the check approved, not the raw string it approved it from.
      cwd: dirDecision.resolvedDir ?? this.defaultWorkingDir,
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
