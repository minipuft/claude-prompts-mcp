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
import type { ShellVerifyGate, ShellVerifyResult, ShellVerifyExecutorConfig } from './types.js';
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
export declare class ShellVerifyExecutor {
    private readonly defaultTimeout;
    private readonly maxTimeout;
    private readonly defaultWorkingDir;
    private readonly debug;
    constructor(config?: ShellVerifyExecutorConfig);
    /**
     * Execute a shell verification command.
     *
     * @param gate - Shell verification gate configuration
     * @returns Verification result with pass/fail status and output
     */
    execute(gate: ShellVerifyGate): Promise<ShellVerifyResult>;
    /**
     * Resolve and clamp timeout value.
     */
    private resolveTimeout;
    /**
     * Build environment variables for command execution.
     * Uses allowlist to prevent credential leakage.
     */
    private buildEnvironment;
    /**
     * Spawn a shell process and capture output.
     */
    private spawnShell;
    /**
     * Truncate output to prevent context overflow.
     */
    private truncateOutput;
    /**
     * Create a verification result with timing.
     */
    private createResult;
}
/**
 * Factory function with default configuration.
 */
export declare function createShellVerifyExecutor(config?: ShellVerifyExecutorConfig): ShellVerifyExecutor;
/**
 * Get the default ShellVerifyExecutor instance.
 * Creates one if it doesn't exist.
 */
export declare function getDefaultShellVerifyExecutor(): ShellVerifyExecutor;
/**
 * Reset the default executor (useful for testing).
 */
export declare function resetDefaultShellVerifyExecutor(): void;
