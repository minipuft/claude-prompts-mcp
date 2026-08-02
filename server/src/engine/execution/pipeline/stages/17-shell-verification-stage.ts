// @lifecycle canonical - Shell verification gate execution for Ralph Wiggum loops.
/**
 * Pipeline Stage 17: Shell Verification
 *
 * Executes shell verification gates that enable "Ralph Wiggum" style autonomous loops
 * where Claude's work is validated by real shell command execution (ground truth)
 * rather than LLM self-evaluation.
 *
 * Position: After StepResponseCaptureStage, before StepExecutionStage
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
  type VerifyActiveStateStore,
  createBounceBackFeedback,
  createEscalationFeedback,
} from '../../../gates/shell/index.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { PendingShellVerificationSnapshot } from '#shared/types/chain-execution.js';
import type { ChainSessionService } from '#shared/types/chain-session.js';
import type { ExecutionContext } from '../../context/index.js';

/**
 * Shell Verification Stage - thin orchestration layer.
 *
 * Delegates to:
 * - ShellVerifyExecutor: Command execution
 * - VerifyActiveStateStore: State file for Stop hook
 * - createBounceBackFeedback/createEscalationFeedback: Message formatting
 *
 * Note: Checkpoint/rollback functionality is available via resource_manager.
 */
export class ShellVerificationStage extends BasePipelineStage {
  readonly name = 'ShellVerification';

  constructor(
    private readonly shellVerifyExecutor: ShellVerifyExecutor,
    private readonly stateManager: VerifyActiveStateStore,
    private readonly chainSessionService: ChainSessionService,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    let pending = context.state.gates.pendingShellVerification;

    // Restore from session on response-only resume (InlineGateExtractionStage is skipped, so pending is undefined)
    if (pending === undefined) {
      pending = this.restoreFromSession(context);
    }

    if (pending === undefined) {
      this.logExit({ skipped: 'No pending shell verification' });
      return;
    }

    // Handle gate_action response (retry/skip/abort)
    const gateAction = context.mcpRequest.gate_action;
    if (gateAction !== undefined && pending.attemptCount >= pending.maxAttempts) {
      await this.handleGateAction(context, gateAction, pending);
      return;
    }

    // Require user_response before running verification (after first attempt)
    const userResponse = context.mcpRequest.user_response?.trim();
    if ((userResponse === undefined || userResponse === '') && pending.attemptCount > 0) {
      this.logExit({ skipped: 'Awaiting user response before verification' });
      return;
    }

    const { shellVerify } = pending;

    // LOOP MODE: Write verify-state.db for Stop hook integration
    if (shellVerify.loop === true) {
      await this.stateManager.writeState(this.resolveVerifyStateKey(context), pending);
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

    // Persist updated state to session for cross-request resume
    await this.saveToSession(context, pending);
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
    await this.clearFromSession(context);

    // LOOP MODE: Clear verify-state.db
    if (shellVerify.loop === true) {
      await this.stateManager.clearState(this.resolveVerifyStateKey(context));
    }

    // Signal which gates' shell criteria passed (for GateReviewStage auto-pass)
    if (pending.sourceGateIds && pending.sourceGateIds.length > 0) {
      context.state.gates.shellVerifyPassedForGates = pending.sourceGateIds;
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
      context.state.gates.escalationSource = 'shell-verify';
      context.state.gates.shellVerifyFeedback = createEscalationFeedback(result, pending);
      // NOTE: Don't clear session — user may choose 'retry' which needs the pending state.
      // Session is cleared in handleGateAction on skip/abort, or on next pass.

      // Clear verify-state.db (Stop hook shouldn't keep trying)
      if (shellVerify.loop === true) {
        await this.stateManager.clearState(this.resolveVerifyStateKey(context));
      }
    } else {
      // More attempts remain - bounce-back
      context.state.gates.shellVerifyFeedback = createBounceBackFeedback(result, pending);
    }

    // Short-circuit pipeline with feedback response.
    // Both branches above always set shellVerifyFeedback — use message directly.
    const feedbackMessage = context.state.gates.shellVerifyFeedback.message;

    // Include chain_id so the LLM can resume the chain after fixing (prefer human-readable ID)
    const chainId = context.getRequestedChainId() ?? context.state.session.resumeChainId;
    const resumeHint =
      chainId !== undefined
        ? `\n\n---\n**Resume with:** \`chain_id: "${chainId}"\` and \`user_response\` containing your fix.`
        : '';

    context.setResponse({
      content: [{ type: 'text', text: feedbackMessage + resumeHint }],
    });

    this.logExit({
      passed: false,
      attemptCount: pending.attemptCount,
      maxAttempts: pending.maxAttempts,
      escalated: pending.attemptCount >= pending.maxAttempts,
    });
  }

  /**
   * Resolve verify-state.db key: prefer chain ID (human-readable, Stop hook uses it),
   * fall back to session ID (guaranteed unique) to avoid 'unknown' key collisions.
   */
  private resolveVerifyStateKey(context: ExecutionContext): string {
    return (
      context.getRequestedChainId() ??
      context.state.session.resumeChainId ??
      context.getSessionId() ??
      'unknown'
    );
  }

  /**
   * Restore pendingShellVerification from the chain session (for response-only resume).
   * On resume, InlineGateExtractionStage is skipped so the ephemeral context has no pending state.
   */
  private restoreFromSession(context: ExecutionContext): PendingShellVerification | undefined {
    const sessionId = context.getSessionId();
    if (!sessionId) return undefined;

    const snapshot = this.chainSessionService.getPendingShellVerification(sessionId);
    if (!snapshot) return undefined;

    const restored: PendingShellVerification = {
      gateId: snapshot.gateId,
      shellVerify: snapshot.shellVerify,
      attemptCount: snapshot.attemptCount,
      maxAttempts: snapshot.maxAttempts,
      previousResults: snapshot.previousResults,
      originalGoal: snapshot.originalGoal,
      sourceGateIds: snapshot.sourceGateIds,
    };

    context.state.gates.pendingShellVerification = restored;
    this.logger.info?.(
      `[${this.name}] Restored pending shell verification from session (attempt ${restored.attemptCount}/${restored.maxAttempts})`
    );
    return restored;
  }

  /**
   * Save pending state to session for cross-request persistence.
   */
  private async saveToSession(
    context: ExecutionContext,
    pending: PendingShellVerification
  ): Promise<void> {
    const sessionId = context.getSessionId();
    if (!sessionId) return;

    const snapshot: PendingShellVerificationSnapshot = {
      gateId: pending.gateId,
      shellVerify: pending.shellVerify,
      attemptCount: pending.attemptCount,
      maxAttempts: pending.maxAttempts,
      previousResults: pending.previousResults,
      originalGoal: pending.originalGoal,
      sourceGateIds: pending.sourceGateIds,
    };

    await this.chainSessionService.setPendingShellVerification(sessionId, snapshot);
  }

  /**
   * Clear pending state from session (on pass, skip, abort, or escalation).
   */
  private async clearFromSession(context: ExecutionContext): Promise<void> {
    const sessionId = context.getSessionId();
    if (!sessionId) return;
    await this.chainSessionService.clearPendingShellVerification(sessionId);
  }

  /**
   * Handle gate_action user decision (retry/skip/abort).
   */
  private async handleGateAction(
    context: ExecutionContext,
    gateAction: string,
    pending: PendingShellVerification
  ): Promise<void> {
    const chainId = context.getRequestedChainId() ?? context.state.session.resumeChainId;

    switch (gateAction) {
      case 'retry': {
        pending.attemptCount = 0;
        pending.previousResults = [];
        context.state.gates.shellVerifyResults = [];
        await this.saveToSession(context, pending);
        context.diagnostics.info(this.name, 'User chose to retry shell verification', {
          gateId: pending.gateId,
        });

        const resumeHint =
          chainId !== undefined
            ? `\n\n---\n**Resume with:** \`chain_id: "${chainId}"\` and \`user_response\` containing your fix.`
            : '';
        context.setResponse({
          content: [
            {
              type: 'text',
              text: `## Shell Verification — Attempts Reset\n\n**Command:** \`${pending.shellVerify.command}\`\n**Attempts:** 0/${pending.maxAttempts}\n\nSubmit your fix to re-run verification.${resumeHint}`,
            },
          ],
        });

        this.logExit({ gateAction: 'retry', reset: true });
        break;
      }

      case 'skip':
        context.state.gates.pendingShellVerification = undefined;
        await this.clearFromSession(context);
        context.diagnostics.warn(this.name, 'User chose to skip shell verification', {
          gateId: pending.gateId,
        });
        this.logExit({ gateAction: 'skip' });
        break;

      case 'abort': {
        context.state.session.aborted = true;
        context.state.gates.pendingShellVerification = undefined;
        await this.clearFromSession(context);
        context.diagnostics.info(
          this.name,
          'User chose to abort after shell verification failure',
          {
            gateId: pending.gateId,
          }
        );

        context.setResponse({
          content: [
            {
              type: 'text',
              text: `## Shell Verification — Aborted\n\n**Command:** \`${pending.shellVerify.command}\`\n\nExecution stopped by user. No further verification will run.`,
            },
          ],
        });

        this.logExit({ gateAction: 'abort' });
        break;
      }

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
  stateManager: VerifyActiveStateStore,
  chainSessionService: ChainSessionService,
  logger: Logger
): ShellVerificationStage {
  return new ShellVerificationStage(shellVerifyExecutor, stateManager, chainSessionService, logger);
}
