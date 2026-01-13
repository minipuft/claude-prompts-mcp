// @lifecycle canonical - Shell verification gate execution for Ralph Wiggum loops.
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
 * @see plans/ralph-mode-shell-verification-gates.md for the implementation plan
 */

import {
  type ShellVerifyExecutor,
  type PendingShellVerification,
  type VerifyActiveStateManager,
  createBounceBackFeedback,
  createEscalationFeedback,
} from '../../../gates/shell/index.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';

/**
 * Shell Verification Stage - thin orchestration layer.
 *
 * Delegates to:
 * - ShellVerifyExecutor: Command execution
 * - VerifyActiveStateManager: State file for Stop hook
 * - createBounceBackFeedback/createEscalationFeedback: Message formatting
 *
 * Note: Checkpoint/rollback functionality is available via resource_manager.
 */
export class ShellVerificationStage extends BasePipelineStage {
  readonly name = 'ShellVerification';

  constructor(
    private readonly shellVerifyExecutor: ShellVerifyExecutor,
    private readonly stateManager: VerifyActiveStateManager,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const pending = context.state.gates.pendingShellVerification;
    if (pending === undefined) {
      this.logExit({ skipped: 'No pending shell verification' });
      return;
    }

    // Handle gate_action response (retry/skip/abort)
    const gateAction = context.mcpRequest.gate_action;
    if (gateAction !== undefined && pending.attemptCount >= pending.maxAttempts) {
      this.handleGateAction(context, gateAction, pending);
      return;
    }

    // Require user_response before running verification (after first attempt)
    const userResponse = context.mcpRequest.user_response?.trim();
    if ((userResponse === undefined || userResponse === '') && pending.attemptCount > 0) {
      this.logExit({ skipped: 'Awaiting user response before verification' });
      return;
    }

    const { shellVerify } = pending;
    const sessionId =
      context.getRequestedChainId() ?? context.state.session.resumeChainId ?? 'unknown';

    // LOOP MODE: Write verify-active.json for Stop hook integration
    if (shellVerify.loop === true) {
      await this.stateManager.writeState(sessionId, pending);
    }

    // Execute verification via ShellVerifyExecutor
    const result = await this.shellVerifyExecutor.execute(shellVerify);

    // Update attempt count and results in state
    pending.attemptCount += 1;
    pending.previousResults.push(result);
    context.state.gates.shellVerifyResults = [
      ...(context.state.gates.shellVerifyResults ?? []),
      result,
    ];

    if (result.passed) {
      await this.handleVerificationPassed(context, pending);
      return;
    }

    await this.handleVerificationFailed(context, result, pending);
  }

  /**
   * Handle verification success - clear state and proceed.
   */
  private async handleVerificationPassed(
    context: ExecutionContext,
    pending: PendingShellVerification
  ): Promise<void> {
    const { shellVerify } = pending;

    context.state.gates.pendingShellVerification = undefined;

    // LOOP MODE: Clear verify-active.json
    if (shellVerify.loop === true) {
      await this.stateManager.clearState();
    }

    context.diagnostics.info(this.name, 'Shell verification PASSED', {
      attemptCount: pending.attemptCount,
    });
    this.logExit({ passed: true, attemptCount: pending.attemptCount });
  }

  /**
   * Handle verification failure - bounce-back or escalate.
   */
  private async handleVerificationFailed(
    context: ExecutionContext,
    result: Awaited<ReturnType<ShellVerifyExecutor['execute']>>,
    pending: PendingShellVerification
  ): Promise<void> {
    const { shellVerify } = pending;

    context.diagnostics.warn(this.name, 'Shell verification FAILED', {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      attemptCount: pending.attemptCount,
      maxAttempts: pending.maxAttempts,
    });

    if (pending.attemptCount >= pending.maxAttempts) {
      // Max attempts - escalate to user
      context.state.gates.retryLimitExceeded = true;
      context.state.gates.awaitingUserChoice = true;
      context.state.gates.shellVerifyFeedback = createEscalationFeedback(result, pending);

      // Clear verify-active.json (Stop hook shouldn't keep trying)
      if (shellVerify.loop === true) {
        await this.stateManager.clearState();
      }
    } else {
      // More attempts remain - bounce-back
      context.state.gates.shellVerifyFeedback = createBounceBackFeedback(result, pending);
    }

    // Short-circuit pipeline with feedback response
    const feedback = context.state.gates.shellVerifyFeedback;
    if (feedback !== undefined) {
      context.setResponse({
        content: [{ type: 'text', text: feedback.message }],
      });
    }

    this.logExit({
      passed: false,
      attemptCount: pending.attemptCount,
      maxAttempts: pending.maxAttempts,
      escalated: pending.attemptCount >= pending.maxAttempts,
    });
  }

  /**
   * Handle gate_action user decision (retry/skip/abort).
   */
  private handleGateAction(
    context: ExecutionContext,
    gateAction: string,
    pending: PendingShellVerification
  ): void {
    switch (gateAction) {
      case 'retry':
        pending.attemptCount = 0;
        pending.previousResults = [];
        context.state.gates.shellVerifyResults = [];
        context.diagnostics.info(this.name, 'User chose to retry shell verification', {
          gateId: pending.gateId,
        });
        this.logExit({ gateAction: 'retry', reset: true });
        break;

      case 'skip':
        context.state.gates.pendingShellVerification = undefined;
        context.diagnostics.warn(this.name, 'User chose to skip shell verification', {
          gateId: pending.gateId,
        });
        this.logExit({ gateAction: 'skip' });
        break;

      case 'abort':
        context.state.session.aborted = true;
        context.state.gates.pendingShellVerification = undefined;
        context.diagnostics.info(
          this.name,
          'User chose to abort after shell verification failure',
          {
            gateId: pending.gateId,
          }
        );
        this.logExit({ gateAction: 'abort' });
        break;

      default:
        this.logger.warn(`[${this.name}] Unknown gate_action: ${gateAction}`);
    }
  }
}

/**
 * Factory function for creating the shell verification stage.
 */
export function createShellVerificationStage(
  shellVerifyExecutor: ShellVerifyExecutor,
  stateManager: VerifyActiveStateManager,
  logger: Logger
): ShellVerificationStage {
  return new ShellVerificationStage(shellVerifyExecutor, stateManager, logger);
}
