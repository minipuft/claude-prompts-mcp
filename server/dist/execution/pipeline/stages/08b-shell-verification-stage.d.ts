import { type ShellVerifyExecutor } from '../../../gates/shell/index.js';
import { BasePipelineStage } from '../stage.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Pipeline Stage 8b: Shell Verification
 *
 * Executes shell verification gates that enable "Ralph Wiggum" style autonomous loops
 * where Claude's work is validated by real shell command execution (ground truth)
 * rather than LLM self-evaluation.
 *
 * Position: After StepResponseCaptureStage (08), before ExecutionStage (09)
 *
 * Flow:
 * 1. Check for pendingShellVerification in state
 * 2. Execute shell command via ShellVerifyExecutor
 * 3. If PASS (exit 0): Clear verification, proceed
 * 4. If FAIL (exit != 0):
 *    - If attempts < 5: Return formatted error to chat (bounce-back)
 *    - If attempts >= 5: Return escalation with gate_action options
 *
 * Dependencies: context.state.gates.pendingShellVerification
 * Output: Updated state with verification results
 * Can Early Exit: Yes (on verification failure)
 *
 * @see plans/ralph-style-loop.md for the implementation plan
 */
export declare class ShellVerificationStage extends BasePipelineStage {
    private readonly shellVerifyExecutor;
    readonly name = "ShellVerification";
    private readonly runtimeStateDir;
    private currentCheckpointRef;
    constructor(shellVerifyExecutor: ShellVerifyExecutor, logger: Logger, runtimeStateDir?: string);
    /**
     * Get the path to verify-active.json
     */
    private get verifyActiveStatePath();
    execute(context: ExecutionContext): Promise<void>;
    /**
     * Handle gate_action user decision (retry/skip/abort).
     */
    private handleGateAction;
    /**
     * Set bounce-back response for retry attempts.
     * Uses state.gates.shellVerifyFeedback for downstream formatting.
     */
    private setBounceBackResponse;
    /**
     * Set escalation response after max attempts.
     * Uses state.gates for downstream handling.
     */
    private setEscalationResponse;
    /**
     * Format bounce-back message for retry.
     */
    private formatBounceBackMessage;
    /**
     * Format escalation message after max attempts.
     */
    private formatEscalationMessage;
    /**
     * Truncate output for display.
     */
    private truncateForDisplay;
    /**
     * Write verify-active.json for Stop hook integration.
     *
     * This file enables the Stop hook to read verification config
     * and block Claude from stopping until verification passes.
     */
    private writeVerifyActiveState;
    /**
     * Clear verify-active.json after verification passes or max attempts reached.
     */
    private clearVerifyActiveState;
}
/**
 * Factory function for creating the shell verification stage.
 */
export declare function createShellVerificationStage(shellVerifyExecutor: ShellVerifyExecutor, logger: Logger, runtimeStateDir?: string): ShellVerificationStage;
