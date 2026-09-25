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
import { reviewHolding } from '../../capture/step-capture-service.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { PendingShellVerificationSnapshot } from '#shared/types/chain-execution.js';
import type { ChainSessionService } from '#shared/types/chain-session.js';
import type { GateVerdictProcessor } from '../../../gates/services/gate-verdict-processor.js';
import type { ExecutionContext } from '../../context/index.js';

/**
 * Shell Verification Stage - thin orchestration layer.
 *
 * Delegates to:
 * - ShellVerifyExecutor: Command execution
 * - VerifyActiveStateStore: State file for Stop hook
 * - createBounceBackFeedback/createEscalationFeedback: Message formatting
 *
 * Note: checkpoint/rollback is no longer available — the resource_type was removed in the 4.0
 * line; it wrapped `git stash` and its handler was never constructed.
 */
export class ShellVerificationStage extends BasePipelineStage {
  readonly name = 'ShellVerification';

  constructor(
    private readonly shellVerifyExecutor: ShellVerifyExecutor,
    private readonly stateManager: VerifyActiveStateStore,
    private readonly chainSessionService: ChainSessionService,
    /** The one advance owner (R25): a released hold moves the run and announces it there. */
    private readonly advanceOwner: Pick<GateVerdictProcessor, 'applyDeferredAdvance'>,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    let pending = context.state.gates.pendingShellVerification;
    // Armed by InlineGateExtractionStage on this call (the render), rather than restored on a resume
    const armedThisCall = pending !== undefined;

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
    if (gateAction === 'skip' && this.refusesSkip(context)) {
      await this.saveToSession(context, pending);
      return;
    }
    // A gate_action is acted on whenever a check is pending, at any attempt count (P6.32)
    if (gateAction !== undefined) {
      await this.handleGateAction(context, gateAction, pending);
      return;
    }

    // The command checks an answer, so it runs only on a call that has one to grade (P6.27,
    // P6.57). The render call runs nothing and spends no attempt, even when a `user_response`
    // rides along: the run captured nothing on it. It saves the check so the resume that
    // answers it finds it (and the step stays held), and arms the Stop hook's loop state.
    const userResponse = context.mcpRequest.user_response?.trim();
    if (userResponse === undefined || userResponse === '' || !this.hasAnswerToGrade(context)) {
      if (armedThisCall) await this.armOnRender(context, pending);
      this.logExit({ skipped: 'Awaiting user response before verification' });
      return;
    }

    // Spent: only a gate_action moves an exhausted check; an answer re-renders the escalation.
    const lastResult = pending.previousResults[pending.previousResults.length - 1];
    if (pending.attemptCount >= pending.maxAttempts && lastResult !== undefined) {
      // Nothing ran on this call: render the escalation again, but log no failure and leave the
      // loop state as the call that spent the last attempt left it (P6.59).
      this.renderFeedback(context, lastResult, pending);
      this.logExit({ passed: false, spent: true, attemptCount: pending.attemptCount });
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
   * The render call arms the check without running it: saved with `attemptCount 0` and no node
   * (no answer was captured yet), and the loop's Stop-hook state written.
   */
  private async armOnRender(
    context: ExecutionContext,
    pending: PendingShellVerification
  ): Promise<void> {
    if (pending.shellVerify.loop === true) {
      await this.stateManager.writeState(this.resolveVerifyStateKey(context), pending);
    }
    await this.saveToSession(context, pending);
  }

  /**
   * Handle verification success - clear state and proceed.
   */
  private async handleVerificationPassed(
    context: ExecutionContext,
    pending: PendingShellVerification
  ): Promise<void> {
    const { shellVerify } = pending;

    const heldNodeId = this.heldNodeId(context);
    context.state.gates.pendingShellVerification = undefined;
    await this.clearFromSession(context);
    const release = await this.releaseHeldStep(context, heldNodeId, 'captured');
    const rearmed = await this.rearmForNextStep(context, pending, heldNodeId, release);

    // LOOP MODE: Clear verify-state.db, unless the check stands again for the next step
    if (shellVerify.loop === true && !rearmed) {
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

    // Max attempts: clear verify-state.db (the Stop hook shouldn't keep trying). The session
    // keeps the check — `retry` needs it; skip/abort or the next pass clears it.
    if (pending.attemptCount >= pending.maxAttempts && shellVerify.loop === true) {
      await this.stateManager.clearState(this.resolveVerifyStateKey(context));
    }

    this.renderFeedback(context, result, pending);

    this.logExit({
      passed: false,
      attemptCount: pending.attemptCount,
      maxAttempts: pending.maxAttempts,
      escalated: pending.attemptCount >= pending.maxAttempts,
    });
  }

  /**
   * Short-circuit the pipeline with the bounce-back, or with the escalation once the attempts are
   * spent (flagging the call as awaiting the user's `gate_action`). Renders only: no log, no
   * loop state.
   */
  private renderFeedback(
    context: ExecutionContext,
    result: Awaited<ReturnType<ShellVerifyExecutor['execute']>>,
    pending: PendingShellVerification
  ): void {
    if (pending.attemptCount >= pending.maxAttempts) {
      context.state.gates.retryLimitExceeded = true;
      context.state.gates.awaitingUserChoice = true;
      context.state.gates.escalationSource = 'shell-verify';
      context.state.gates.shellVerifyFeedback = createEscalationFeedback(result, pending);
    } else {
      context.state.gates.shellVerifyFeedback = createBounceBackFeedback(result, pending);
    }
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
    // The node it holds open: the step captured on this call, else the node an earlier save
    // named — a failing re-run on a call that captured nothing must not release the hold.
    await this.writeSnapshot(context, pending, this.heldNodeId(context));
  }

  /** Persist the check as holding `nodeId`; `undefined` holds nothing until a capture names one. */
  private async writeSnapshot(
    context: ExecutionContext,
    pending: PendingShellVerification,
    nodeId: string | undefined
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
      nodeId,
    };

    await this.chainSessionService.setPendingShellVerification(sessionId, snapshot);
  }

  /**
   * On a run, the check grades a step's answer: the one captured on this call, or the held one an
   * earlier save named (a re-run). A call that captured nothing on a check holding no step — the
   * render, or a re-armed check before the next step is answered — has nothing to grade. A
   * single prompt with no run grades the answer the call carries.
   */
  private hasAnswerToGrade(context: ExecutionContext): boolean {
    return runSessionId(context) === undefined || this.heldNodeId(context) !== undefined;
  }

  /** The step this check holds: the one captured on this call, else the one an earlier save named. */
  private heldNodeId(context: ExecutionContext): string | undefined {
    const sessionId = runSessionId(context);
    return (
      context.state.session.capturedStep?.nodeId ??
      (sessionId === undefined
        ? undefined
        : this.chainSessionService.getPendingShellVerification(sessionId)?.nodeId)
    );
  }

  /**
   * Release the hold on a step once its check passes or is skipped (R29): advance past it through
   * the one advance owner, which announces its `step_complete` on this call. A step an open review
   * holds — its own, or an earlier node's (R14, `reviewHolding`, P6.53) — is left to that review.
   */
  private async releaseHeldStep(
    context: ExecutionContext,
    nodeId: string | undefined,
    reason: 'captured' | 'gate-skip'
  ): Promise<'released' | 'left-to-review' | 'none'> {
    const sessionId = runSessionId(context);
    if (nodeId === undefined || sessionId === undefined) return 'none';
    const session = this.chainSessionService.getSession(sessionId, context.getScopeOptions());
    if (session !== undefined && reviewHolding(session, nodeId) !== undefined) {
      return 'left-to-review';
    }
    await this.advanceOwner.applyDeferredAdvance(context, { sessionId, nodeId, reason });
    return 'released';
  }

  /**
   * A chain-level check grades every step's answer (R32). Once the release moved the run past the
   * held step onto a later node, the check stands again for that node: a fresh budget, no node
   * (the capture of the next answer names it, as on the render), and the loop's Stop-hook state
   * written again. A step left to a review is re-armed the same way, on the node the run stands
   * on: the review's verdict then moves the run (an armed check holds only a capture), and the
   * next answer is checked (P6.53). A release that completed the run, or moved nothing, leaves it
   * cleared.
   */
  private async rearmForNextStep(
    context: ExecutionContext,
    pending: PendingShellVerification,
    releasedNodeId: string | undefined,
    release: 'released' | 'left-to-review' | 'none'
  ): Promise<boolean> {
    const sessionId = runSessionId(context);
    if (sessionId === undefined || releasedNodeId === undefined) return false;
    const session = this.chainSessionService.getSession(sessionId, context.getScopeOptions());
    const standsOn = session?.state.currentNodeId;
    if (standsOn === undefined || standsOn === null) return false;
    if (standsOn === releasedNodeId && release !== 'left-to-review') return false;

    const rearmed: PendingShellVerification = { ...pending, attemptCount: 0, previousResults: [] };
    await this.writeSnapshot(context, rearmed, undefined);
    if (rearmed.shellVerify.loop === true) {
      await this.stateManager.writeState(this.resolveVerifyStateKey(context), rearmed);
    }
    context.diagnostics.info(this.name, 'Shell verification armed for the next step', {
      gateId: rearmed.gateId,
      nodeId: standsOn,
    });
    return true;
  }

  /**
   * `skip` accepts the step's captured answer (R24), so on a run with no captured answer it has
   * nothing to skip past and is refused by name. A single prompt has no run: skip there only
   * clears the check, as it always has.
   */
  private refusesSkip(context: ExecutionContext): boolean {
    if (runSessionId(context) === undefined || this.heldNodeId(context) !== undefined) return false;
    const step = context.sessionContext?.currentStep ?? 1;
    context.setResponse({
      content: [
        {
          type: 'text',
          text: `Shell verification skip refused: nothing to skip past on step ${step}; answer it first.`,
        },
      ],
      isError: true,
    });
    this.logExit({ gateAction: 'skip', refused: 'no captured answer' });
    return true;
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
   * Cancel the owning run, when there is one, so an abort is terminal rather than advisory.
   *
   * Shell verification also runs for single prompts, which have no run: no session id means
   * there is nothing to cancel, and a `false` return means the run was already terminal.
   * Neither is a defect, so neither warns.
   */
  private async cancelRunIfAny(context: ExecutionContext): Promise<void> {
    const sessionId = context.getSessionId();
    // Written strictly rather than as the `if (!sessionId)` its two neighbours use: the lint
    // ratchet measures direction, and a baseline with slack would have absorbed a new violation.
    if (sessionId === undefined || sessionId.length === 0) return;
    const cancelled = await this.chainSessionService.cancelChain(sessionId);
    if (!cancelled) {
      this.logger.debug(
        `[${this.name}] Abort requested for session ${sessionId}; no active run to cancel`
      );
    }
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

      case 'skip': {
        const heldNodeId = this.heldNodeId(context);
        context.state.gates.pendingShellVerification = undefined;
        await this.clearFromSession(context);
        const release = await this.releaseHeldStep(context, heldNodeId, 'gate-skip');
        await this.rearmForNextStep(context, pending, heldNodeId, release);
        context.diagnostics.warn(this.name, 'User chose to skip shell verification', {
          gateId: pending.gateId,
        });
        this.logExit({ gateAction: 'skip' });
        break;
      }

      case 'abort': {
        context.state.session.aborted = true;
        context.state.gates.pendingShellVerification = undefined;
        await this.clearFromSession(context);
        // The response below tells the user "Execution stopped". Cancel the run so that is
        // true — otherwise runStatus stays 'working' and the next call resumes the chain.
        // Guarded on sessionId because shell verification also runs for single prompts, which
        // have no run to cancel; that is not a failure worth warning about.
        await this.cancelRunIfAny(context);
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

/** The run's session id, or `undefined` for a single prompt, which has no run. */
function runSessionId(context: ExecutionContext): string | undefined {
  const sessionId = context.getSessionId();
  return sessionId === undefined || sessionId.length === 0 ? undefined : sessionId;
}

/**
 * Factory function for creating the shell verification stage.
 */
export function createShellVerificationStage(
  shellVerifyExecutor: ShellVerifyExecutor,
  stateManager: VerifyActiveStateStore,
  chainSessionService: ChainSessionService,
  advanceOwner: Pick<GateVerdictProcessor, 'applyDeferredAdvance'>,
  logger: Logger
): ShellVerificationStage {
  return new ShellVerificationStage(
    shellVerifyExecutor,
    stateManager,
    chainSessionService,
    advanceOwner,
    logger
  );
}
