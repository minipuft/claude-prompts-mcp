// @lifecycle canonical - Shell verification gate type definitions for Ralph Wiggum loops.
/**
 * Shell Verification Gate Types
 *
 * Type definitions for shell-based verification gates that enable
 * "Ralph Wiggum" style autonomous loops where Claude's work is validated
 * by real shell command execution (ground truth) rather than LLM self-evaluation.
 *
 * @see plans/ralph-style-loop.md for the implementation plan
 */

/**
 * Configuration for a shell verification gate.
 *
 * Defines the shell command to execute for validation along with
 * execution parameters like timeout and working directory.
 *
 * Extended options enable Ralph Wiggum-style autonomous loops:
 * - loop: Enable Stop hook integration for true autonomous loops
 * - maxIterations: Safety limit before force-stop
 * - checkpoint: Git stash before execution for safe rollback
 * - rollback: Automatically restore on verification failure
 */
export interface ShellVerifyGate {
  /** The shell command to execute for verification */
  command: string;
  /** Working directory for command execution (defaults to project root) */
  workingDir?: string;
  /** Timeout in milliseconds (defaults to SHELL_VERIFY_DEFAULT_TIMEOUT) */
  timeout?: number;
  /** Additional environment variables for the command */
  env?: Record<string, string>;

  // === Ralph Wiggum Loop Extensions ===

  /** Enable Stop hook integration for autonomous loops (default: false) */
  loop?: boolean;
  /** Maximum iterations before force-stop when loop:true (default: 10) */
  maxIterations?: number;
  /** Create git stash checkpoint before verification (default: false) */
  checkpoint?: boolean;
  /** Rollback to checkpoint on verification failure (default: false) */
  rollback?: boolean;
}

/**
 * Result of executing a shell verification command.
 *
 * Contains all information needed to determine pass/fail status
 * and provide diagnostic feedback to Claude.
 */
export interface ShellVerifyResult {
  /** Whether the verification passed (exit code 0) */
  passed: boolean;
  /** Process exit code (0 = pass, non-zero = fail) */
  exitCode: number;
  /** Standard output from the command */
  stdout: string;
  /** Standard error from the command */
  stderr: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** The command that was executed */
  command: string;
  /** Whether the command timed out */
  timedOut?: boolean;
}

/**
 * Pending shell verification state tracked during chain execution.
 *
 * Persisted across responses to track retry attempts and
 * accumulate results from multiple verification runs.
 */
export interface PendingShellVerification {
  /** The shell verification gate configuration */
  shellVerify: ShellVerifyGate;
  /** Results from previous verification attempts */
  previousResults: ShellVerifyResult[];
  /** Current attempt count (1-indexed) */
  attemptCount: number;
  /** Maximum attempts before escalation */
  maxAttempts: number;
  /** Unique identifier for this verification gate */
  gateId: string;
}

/**
 * Shell verification executor configuration.
 */
export interface ShellVerifyExecutorConfig {
  /** Default timeout in milliseconds */
  defaultTimeout?: number;
  /** Maximum allowed timeout in milliseconds */
  maxTimeout?: number;
  /** Default working directory for command execution */
  defaultWorkingDir?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Maximum characters to include from command output.
 * Large outputs are truncated to prevent context overflow.
 */
export const SHELL_OUTPUT_MAX_CHARS = 5000;

/**
 * Default max iterations for autonomous loops.
 */
export const SHELL_VERIFY_DEFAULT_MAX_ITERATIONS = 10;

/**
 * State persisted to runtime-state/verify-active.json for Stop hook integration.
 *
 * This enables the Stop hook to read verification config set by prompt_engine
 * and run verification when Claude tries to stop, creating autonomous loops.
 */
export interface VerifyActiveState {
  /** Chain session ID for tracking */
  sessionId: string;
  /** Configuration from :: verify:"cmd" syntax */
  config: {
    command: string;
    timeout: number;
    maxIterations: number;
    checkpoint: boolean;
    rollback: boolean;
    workingDir?: string;
  };
  /** Runtime state updated by Stop hook */
  state: {
    iteration: number;
    lastResult: ShellVerifyResult | null;
    checkpointRef: string | null;
    startedAt: string;
  };
}
