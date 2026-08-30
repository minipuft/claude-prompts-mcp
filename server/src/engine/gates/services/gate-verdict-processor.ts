// @lifecycle canonical - Processes gate verdicts, actions, and hook events for chain sessions.
import {
  isUnknownInterruptPending,
  resolveEnforcementMode,
} from '../../execution/pipeline/decisions/index.js';
import { parseGateVerdict } from '../core/gate-verdict-contract.js';

import type { Logger } from '#infra/logging/index.js';
import type {
  ChainSession,
  ChainSessionService,
  HookRegistryPort,
  McpNotificationEmitterPort,
  PipelineHookContext,
} from '#shared/types/index.js';
import type { ExecutionContext, SessionContext } from '../../execution/context/index.js';
import type {
  GateAction,
  InterruptResolutionAction,
} from '../../execution/pipeline/decisions/index.js';
import type { ParsedGateVerdict } from '../core/gate-verdict-contract.js';

import { nodeIdAt } from '#shared/utils/node-order.js';

/**
 * Outcome of a mid-chain interrupt resolution attempt (row 2.2).
 *
 * A named refusal carrying its own message, never a boolean: the plan requires every refusal to
 * tell the submitter WHY, and three different refusals collapsed into `false` is how a caller
 * ends up retrying the one thing that cannot work.
 */
export type InterruptResolution =
  { readonly kind: 'resolved' } | { readonly kind: 'refused'; readonly message: string };

/**
 * Result of processing gate verdicts for a request.
 */
export interface VerdictProcessingResult {
  /** Whether a PASS verdict advanced the step in this call */
  readonly passClearedThisCall: boolean;
  /** Whether the pipeline should exit early after verdict processing */
  readonly earlyExit: boolean;
  /** User response (may be unchanged or set to undefined if consumed by verdict) */
  readonly userResponse: string | undefined;
}

/**
 * Processes gate verdicts, handles gate actions (retry/skip/abort),
 * and emits gate lifecycle events via hooks and notifications.
 *
 * Extracted from StepResponseCaptureStage.
 */
export class GateVerdictProcessor {
  /**
   * Translate the position this stage was handed into the node id the store addresses by.
   *
   * Returns `''` when no node sits at that position — the store treats an unresolvable id as
   * already-passed and leaves the run untouched, which is what the previous `currentStep ?? 0`
   * guard achieved by arithmetic. Never invents a node.
   */
  private resolveNodeId(session: ChainSession, ordinal: number): string {
    return nodeIdAt(session.state.nodes, ordinal) ?? '';
  }

  constructor(
    private readonly chainSessionStore: ChainSessionService,
    private readonly logger: Logger,
    private readonly hookRegistry?: HookRegistryPort,
    private readonly notificationEmitter?: McpNotificationEmitterPort
  ) {}

  /**
   * Resolve a mid-chain blocking-unknown interrupt with `resume` or `accept_alternative`
   * (OQ-4, row 2.2).
   *
   * Separate entry point from {@link handleGateAction}, not a fifth case inside it: that method
   * answers "the retry budget is spent, what now", and every branch of it addresses a gate the
   * run failed. This one addresses a hold NO gate produced — the run's steps all passed, and what
   * stopped it is a caller-declared unknown. Sharing an entry point would put a `resetRetryCount`
   * and a `cancelChain` in reach of a verb that means neither.
   *
   * BOTH verbs are refused, by name, in the two states where they could otherwise acquire an
   * unintended meaning:
   *
   * - **nothing pending** — the run is not holding, so there is nothing to resume. Answering
   *   silently would let a client "resume" a run that was already advancing and read the next
   *   step as confirmation the verb worked.
   * - **an ORDINARY pending review** — a real gate review is outstanding, and `resume` is not a
   *   verdict. Accepting it here would be a second, undocumented way to clear a gate hold
   *   without answering it, which is exactly what `gate_action: 'skip'` is for and is deliberately
   *   gated behind retry exhaustion.
   *
   * `accept_alternative` additionally requires that a `remainder` was accepted on this same call
   * (plan §Interrupt payload). `remainderAccepted` is passed in rather than re-read, because the
   * caller already applied it and the two facts must be the same fact — a check that re-derived
   * "was there a remainder" could say yes for a submission the store refused.
   *
   * @returns `resolved` when the review was cleared and the run may continue into its step;
   *   `refused` carrying the sentence the submitter reads. Never throws: an inadmissible verb is
   *   a client error with an explanation, the posture `WorkflowCommandBuilder` and
   *   `RemainderProcessor` both take.
   */
  async resolveUnknownInterrupt(
    context: ExecutionContext,
    sessionId: string,
    action: InterruptResolutionAction,
    sessionContext: SessionContext,
    remainderAccepted: boolean
  ): Promise<InterruptResolution> {
    const pending = this.chainSessionStore.getPendingGateReview(sessionId);

    if (pending === undefined) {
      return {
        kind: 'refused',
        message:
          `gate_action:"${action}" refused: this run is not holding on a blocking-unknown ` +
          'interrupt. It is only meaningful while the response reports ' +
          '`chain_interrupt.paused: true`.',
      };
    }

    if (!isUnknownInterruptPending(pending)) {
      return {
        kind: 'refused',
        message:
          `gate_action:"${action}" refused: this run is holding on a gate review ` +
          `(${(pending.gateIds ?? []).join(', ')}), not on a blocking-unknown interrupt. ` +
          'Answer it with `gate_verdict`.',
      };
    }

    if (action === 'accept_alternative' && !remainderAccepted) {
      return {
        kind: 'refused',
        message:
          'gate_action:"accept_alternative" refused: it accepts a plan, so it requires a ' +
          '`remainder` in the SAME call. Send `remainder:{mode:"replace", nodes:[…]}` alongside ' +
          'it, or use gate_action:"resume" to continue with the current plan.',
      };
    }

    await this.chainSessionStore.clearPendingGateReview(sessionId);

    // Stage 18 skips step execution while `sessionContext.pendingReview` is set, and it reads
    // context rather than the store — so clearing one without the other leaves the run resumed
    // in storage and still silent on the wire.
    const clearedContext = { ...sessionContext };
    delete clearedContext.pendingReview;
    context.sessionContext = clearedContext;

    context.diagnostics.info('GateVerdictProcessor', 'Blocking-unknown interrupt resolved', {
      sessionId,
      action,
      remainderAccepted,
    });

    return { kind: 'resolved' };
  }

  /**
   * Handle gate_action parameter (retry/skip/abort) when retry limit exceeded.
   * Delegates to GateEnforcementAuthority when available, falls back to direct session ops.
   *
   * @returns true if the pipeline should exit early (abort or action completed)
   */
  async handleGateAction(
    context: ExecutionContext,
    sessionId: string,
    gateAction: GateAction,
    sessionContext: SessionContext
  ): Promise<boolean> {
    const authority = context.gateEnforcement;

    if (authority !== undefined) {
      const result = await authority.resolveAction(sessionId, gateAction);

      if (result.handled) {
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;

        if (result.retryReset === true) {
          context.diagnostics.info('GateVerdictProcessor', 'User chose to retry after exhaustion', {
            sessionId,
          });
        } else if (result.reviewCleared === true) {
          const clearedContext = { ...sessionContext };
          delete clearedContext.pendingReview;
          context.sessionContext = clearedContext;
          context.diagnostics.warn('GateVerdictProcessor', 'User chose to skip failed gate', {
            sessionId,
            skippedGates: context.state.gates.retryExhaustedGateIds,
          });
        } else if (result.sessionAborted === true) {
          context.state.session.aborted = true;
          context.diagnostics.info(
            'GateVerdictProcessor',
            'User chose to abort chain after gate failure',
            {
              sessionId,
              failedGates: context.state.gates.retryExhaustedGateIds,
            }
          );
        }
      }
      return true;
    }

    // Fallback: Direct session manager interaction (legacy path)
    switch (gateAction) {
      case 'retry': {
        await this.chainSessionStore.resetRetryCount(sessionId);
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;
        context.diagnostics.info('GateVerdictProcessor', 'User chose to retry after exhaustion', {
          sessionId,
        });
        break;
      }

      case 'skip': {
        await this.chainSessionStore.clearPendingGateReview(sessionId);
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;
        const clearedContext = { ...sessionContext };
        delete clearedContext.pendingReview;
        context.sessionContext = clearedContext;
        context.diagnostics.warn('GateVerdictProcessor', 'User chose to skip failed gate', {
          sessionId,
          skippedGates: context.state.gates.retryExhaustedGateIds,
        });
        break;
      }

      case 'abort': {
        // Mirrors GateEnforcementAuthority.resolveAction — see the note there. The flag alone
        // only makes the abort visible in the ledger; cancelling the run is what makes it stick.
        const cancelled = await this.chainSessionStore.cancelChain(sessionId);
        if (!cancelled) {
          this.logger.warn(
            `[GateVerdictProcessor] Abort requested for session ${sessionId}, but the run could not be cancelled (already terminal or out of scope)`
          );
        }
        context.state.session.aborted = true;
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;
        context.diagnostics.info(
          'GateVerdictProcessor',
          'User chose to abort chain after gate failure',
          {
            sessionId,
            failedGates: context.state.gates.retryExhaustedGateIds,
          }
        );
        break;
      }
    }
    return true;
  }

  /**
   * Process a deferred verdict (verdict without existing pending review).
   * Uses GateEnforcementAuthority to create/clear reviews as needed.
   */
  async processDeferredVerdict(
    context: ExecutionContext,
    session: ChainSession,
    sessionId: string,
    currentStepAtStart: number,
    userResponse: string | undefined,
    sessionContext: SessionContext
  ): Promise<VerdictProcessingResult> {
    const authority = context.gateEnforcement;
    const gateVerdictInput = context.getGateVerdict();
    if (session.pendingGateReview !== undefined || gateVerdictInput === undefined || !authority) {
      return { passClearedThisCall: false, earlyExit: false, userResponse };
    }

    const verdictPayload = this.parseVerdict(context, gateVerdictInput, 'gate_verdict');
    if (verdictPayload === null) {
      return { passClearedThisCall: false, earlyExit: false, userResponse };
    }

    const enforcementMode = resolveEnforcementMode(context.state.gates.enforcementMode);
    const outcome = await authority.recordOutcome(sessionId, verdictPayload, enforcementMode);

    this.recordVerdictDetection(
      context,
      verdictPayload,
      outcome.status === 'cleared' ? 'cleared' : 'pending'
    );

    let passClearedThisCall = false;
    if (outcome.status === 'cleared') {
      const advanced = await this.chainSessionStore.advanceStep(
        sessionId,
        this.resolveNodeId(session, currentStepAtStart)
      );
      if (advanced !== false) {
        sessionContext.currentStep = advanced.ordinal;
        sessionContext.currentNodeId = advanced.nodeId;
      }
      context.sessionContext = { ...sessionContext };
      context.diagnostics.info(
        'GateVerdictProcessor',
        'Gate PASS (no prior review) - advanced step',
        {
          stepToAdvance: currentStepAtStart,
          advancedTo: advanced === false ? false : advanced.ordinal,
        }
      );
      passClearedThisCall = true;
    }

    // Sync newly created pending review (on FAIL) into session context
    const pending = this.chainSessionStore.getPendingGateReview(sessionId);
    if (pending !== undefined) {
      sessionContext.pendingReview = pending;
      context.sessionContext = { ...sessionContext };
    }

    const hasResponse = typeof userResponse === 'string' && userResponse.length > 0;
    if (!hasResponse) {
      return { passClearedThisCall, earlyExit: true, userResponse };
    }

    return { passClearedThisCall, earlyExit: false, userResponse };
  }

  /**
   * Process a verdict against an existing pending review.
   * Handles blocking/advisory/informational enforcement modes.
   */
  async processPendingReviewVerdict(
    context: ExecutionContext,
    session: ChainSession,
    sessionId: string,
    currentStepAtStart: number,
    userResponse: string | undefined,
    sessionContext: SessionContext
  ): Promise<VerdictProcessingResult> {
    if (session.pendingGateReview === undefined) {
      return { passClearedThisCall: false, earlyExit: false, userResponse };
    }

    const gateVerdictInput = context.getGateVerdict();
    const verdictPayload = this.parseVerdict(context, gateVerdictInput, 'gate_verdict');
    const capturedGateIds = [...session.pendingGateReview.gateIds];

    if (verdictPayload === null) {
      return { passClearedThisCall: false, earlyExit: false, userResponse };
    }

    const outcome = await this.chainSessionStore.recordGateReviewOutcome(sessionId, {
      verdict: verdictPayload.verdict,
      rationale: verdictPayload.rationale,
      rawVerdict: verdictPayload.raw,
      reviewer: verdictPayload.source,
    });

    this.recordVerdictDetection(context, verdictPayload, outcome);

    let passClearedThisCall = false;

    if (outcome === 'cleared') {
      const advanced = await this.chainSessionStore.advanceStep(
        sessionId,
        this.resolveNodeId(session, currentStepAtStart)
      );
      if (advanced !== false) {
        sessionContext.currentStep = advanced.ordinal;
        sessionContext.currentNodeId = advanced.nodeId;
      }
      context.diagnostics.info('GateVerdictProcessor', 'Gate PASS - advanced step', {
        stepToAdvance: currentStepAtStart,
        advancedTo: advanced === false ? false : advanced.ordinal,
      });
      delete sessionContext.pendingReview;
      passClearedThisCall = true;

      if (capturedGateIds.includes('__phase_guard__')) {
        context.state.gates.phaseGuardReviewCleared = true;
      }

      await this.emitGateEvents(context, 'passed', capturedGateIds, verdictPayload.rationale);
    } else {
      this.handleFailedVerdict(
        context,
        session,
        sessionId,
        sessionContext,
        capturedGateIds,
        verdictPayload
      );
    }

    context.sessionContext = { ...sessionContext };

    const hasResponse = typeof userResponse === 'string' && userResponse.length > 0;
    if (!hasResponse) {
      return { passClearedThisCall, earlyExit: true, userResponse };
    }

    return { passClearedThisCall, earlyExit: false, userResponse };
  }

  /**
   * Handle a FAIL verdict based on enforcement mode.
   */
  private handleFailedVerdict(
    context: ExecutionContext,
    session: ChainSession,
    sessionId: string,
    sessionContext: SessionContext,
    capturedGateIds: string[],
    verdictPayload: ParsedGateVerdict
  ): void {
    const pending = this.chainSessionStore.getPendingGateReview(sessionId);
    if (pending !== undefined) {
      sessionContext.pendingReview = pending;
    } else {
      delete sessionContext.pendingReview;
    }

    const enforcementMode = resolveEnforcementMode(context.state.gates.enforcementMode);

    if (verdictPayload.verdict !== 'FAIL') return;

    switch (enforcementMode) {
      case 'blocking':
        this.handleBlockingFail(context, session, sessionId, capturedGateIds, verdictPayload);
        break;

      case 'advisory':
        this.handleAdvisoryFail(
          context,
          session,
          sessionId,
          sessionContext,
          capturedGateIds,
          verdictPayload
        );
        break;

      case 'informational':
        this.handleInformationalFail(
          context,
          session,
          sessionId,
          sessionContext,
          capturedGateIds,
          verdictPayload
        );
        break;
    }
  }

  private handleBlockingFail(
    context: ExecutionContext,
    _session: ChainSession,
    sessionId: string,
    capturedGateIds: string[],
    verdictPayload: { rationale: string }
  ): void {
    const pendingReview = this.chainSessionStore.getPendingGateReview(sessionId);
    const isRetryExhausted =
      pendingReview !== undefined && this.chainSessionStore.isRetryLimitExceeded(sessionId);

    if (isRetryExhausted && pendingReview !== undefined) {
      context.state.gates.retryLimitExceeded = true;
      context.state.gates.escalationSource = 'gate-review';
      context.state.gates.retryExhaustedGateIds = [...pendingReview.gateIds];
      context.diagnostics.warn('GateVerdictProcessor', 'Gate retry limit exceeded', {
        attemptCount: pendingReview.attemptCount,
        maxAttempts: pendingReview.maxAttempts,
        gateIds: pendingReview.gateIds,
      });

      void this.emitGateEvents(
        context,
        'retryExhausted',
        pendingReview.gateIds,
        verdictPayload.rationale
      );
    }

    if (context.gates.hasBlockingGates()) {
      const blockedGateIds = [...context.gates.getBlockingGateIds()];
      context.state.gates.responseBlocked = true;
      context.state.gates.blockedGateIds = blockedGateIds;
      context.diagnostics.info('GateVerdictProcessor', 'Response content blocked by gate failure', {
        blockedGateIds,
      });
      void this.emitGateEvents(context, 'responseBlocked', blockedGateIds);
    }

    void this.emitGateEvents(context, 'failed', capturedGateIds, verdictPayload.rationale);
    context.diagnostics.info('GateVerdictProcessor', 'Gate FAIL - blocking mode, awaiting retry');
  }

  private async handleAdvisoryFail(
    context: ExecutionContext,
    session: ChainSession,
    sessionId: string,
    sessionContext: SessionContext,
    capturedGateIds: string[],
    verdictPayload: { rationale: string }
  ): Promise<void> {
    context.state.gates.advisoryWarnings.push(
      `Gate ${capturedGateIds.join(', ')} failed: ${verdictPayload.rationale}`
    );
    context.diagnostics.warn('GateVerdictProcessor', 'Gate FAIL - advisory mode, continuing', {
      rationale: verdictPayload.rationale,
    });

    await this.emitGateEvents(context, 'failed', capturedGateIds, verdictPayload.rationale);
    await this.chainSessionStore.clearPendingGateReview(sessionId);
    // `currentNodeId` when the context already carries it; otherwise translate the position.
    // A context with neither yields '' and the store no-ops, exactly as `?? 0` did before.
    const currentStep = context.sessionContext?.currentStep ?? 0;
    const nodeId =
      context.sessionContext?.currentNodeId ?? this.resolveNodeId(session, currentStep);
    const advanced = await this.chainSessionStore.advanceStep(sessionId, nodeId ?? '');
    if (advanced !== false) {
      sessionContext.currentStep = advanced.ordinal;
      sessionContext.currentNodeId = advanced.nodeId;
    }
    delete sessionContext.pendingReview;
  }

  private async handleInformationalFail(
    context: ExecutionContext,
    session: ChainSession,
    sessionId: string,
    sessionContext: SessionContext,
    _capturedGateIds: string[],
    verdictPayload: { rationale: string }
  ): Promise<void> {
    const infoGateIds = [...(session.pendingGateReview?.gateIds ?? [])];
    context.diagnostics.info(
      'GateVerdictProcessor',
      'Gate FAIL - informational mode, logged only',
      { rationale: verdictPayload.rationale }
    );

    await this.emitGateEvents(context, 'failed', infoGateIds, verdictPayload.rationale);
    await this.chainSessionStore.clearPendingGateReview(sessionId);
    // `currentNodeId` when the context already carries it; otherwise translate the position.
    // A context with neither yields '' and the store no-ops, exactly as `?? 0` did before.
    const currentStep = context.sessionContext?.currentStep ?? 0;
    const nodeId =
      context.sessionContext?.currentNodeId ?? this.resolveNodeId(session, currentStep);
    const advanced = await this.chainSessionStore.advanceStep(sessionId, nodeId ?? '');
    if (advanced !== false) {
      sessionContext.currentStep = advanced.ordinal;
      sessionContext.currentNodeId = advanced.nodeId;
    }
    delete sessionContext.pendingReview;
  }

  /**
   * Parse a gate verdict using the authority (preferred) or contract fallback.
   */
  private parseVerdict(
    context: ExecutionContext,
    raw: string | undefined,
    source: 'gate_verdict' | 'user_response'
  ): ParsedGateVerdict | null {
    return context.gateEnforcement?.parseVerdict(raw, source) ?? parseGateVerdict(raw, source);
  }

  private recordVerdictDetection(
    context: ExecutionContext,
    verdictPayload: ParsedGateVerdict,
    outcome: string
  ): void {
    const verdictDetection: NonNullable<typeof context.state.gates.verdictDetection> = {
      verdict: verdictPayload.verdict,
      source: verdictPayload.source,
    };
    verdictDetection.rationale = verdictPayload.rationale;
    if (verdictPayload.detectedPattern !== undefined) {
      verdictDetection.pattern = verdictPayload.detectedPattern;
    }
    verdictDetection.outcome = outcome === 'cleared' ? 'cleared' : 'pending';
    context.state.gates.verdictDetection = verdictDetection;
  }

  /**
   * Create hook execution context from the current execution state.
   */
  private createHookContext(context: ExecutionContext): PipelineHookContext {
    const executionId =
      context.sessionContext?.sessionId ??
      context.state.session.executionScopeId ??
      `exec-${Date.now().toString(36)}`;

    const frameworkDecision = context.frameworkAuthority.getCachedDecision();

    return {
      executionId,
      executionType: context.sessionContext?.isChainExecution ? 'chain' : 'single',
      chainId: context.sessionContext?.sessionId,
      currentStep: context.sessionContext?.currentStep,
      frameworkEnabled: frameworkDecision?.shouldApply ?? false,
      frameworkId: frameworkDecision?.frameworkId,
    };
  }

  /**
   * Emit gate events via hooks and notifications.
   */
  private async emitGateEvents(
    context: ExecutionContext,
    event: 'passed' | 'failed' | 'retryExhausted' | 'responseBlocked',
    gateIds: string[],
    reason?: string
  ): Promise<void> {
    const hooks = this.hookRegistry;
    const notifications = this.notificationEmitter;

    if (!hooks && !notifications) return;

    const hookContext = this.createHookContext(context);
    const chainId = context.sessionContext?.sessionId;

    try {
      switch (event) {
        case 'passed':
          for (const gateId of gateIds) {
            await hooks?.emitGateEvaluated(
              { id: gateId } as any,
              { passed: true, reason: reason ?? 'Gate passed', blocksResponse: false },
              hookContext
            );
          }
          break;

        case 'failed':
          for (const gateId of gateIds) {
            await hooks?.emitGateFailed(
              { id: gateId } as any,
              reason ?? 'Gate failed',
              hookContext
            );
            notifications?.emitGateFailed({ gateId, reason: reason ?? 'Gate failed', chainId });
          }
          break;

        case 'retryExhausted': {
          const sessionId = context.sessionContext?.sessionId;
          const pendingReview = sessionId
            ? this.chainSessionStore.getPendingGateReview(sessionId)
            : undefined;
          const maxAttempts = pendingReview?.maxAttempts ?? 2;

          await hooks?.emitRetryExhausted(gateIds, chainId ?? '', hookContext);
          notifications?.emitRetryExhausted({
            gateIds,
            chainId: chainId ?? '',
            maxAttempts,
          });
          break;
        }

        case 'responseBlocked':
          await hooks?.emitResponseBlocked(gateIds, hookContext);
          notifications?.emitResponseBlocked({ gateIds, chainId });
          break;
      }
    } catch (error) {
      this.logger.warn('[GateVerdictProcessor] Failed to emit gate event', {
        event,
        gateIds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
