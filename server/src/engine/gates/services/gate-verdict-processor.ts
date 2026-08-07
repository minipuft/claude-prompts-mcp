// @lifecycle canonical - Processes gate verdicts, actions, and hook events for chain sessions.
import { resolveEnforcementMode } from '../../execution/pipeline/decisions/index.js';
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
import type { GateAction } from '../../execution/pipeline/decisions/index.js';
import type { ParsedGateVerdict } from '../core/gate-verdict-contract.js';

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
  constructor(
    private readonly chainSessionStore: ChainSessionService,
    private readonly logger: Logger,
    private readonly hookRegistry?: HookRegistryPort,
    private readonly notificationEmitter?: McpNotificationEmitterPort
  ) {}

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

    // Extract per-gate verdicts from gate_verdict (GATE_VERDICTS block)
    const gateVerdicts = authority.parseGateVerdicts(gateVerdictInput);
    if (gateVerdicts.length > 0) {
      context.state.gates.perGateVerdicts = gateVerdicts;
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
      const newStep = await this.chainSessionStore.advanceStep(sessionId, currentStepAtStart);
      if (newStep !== false) {
        sessionContext.currentStep = newStep;
      }
      context.sessionContext = { ...sessionContext };
      context.diagnostics.info(
        'GateVerdictProcessor',
        'Gate PASS (no prior review) - advanced step',
        {
          stepToAdvance: currentStepAtStart,
          advancedTo: newStep,
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

    // Extract per-gate verdicts from gate_verdict (GATE_VERDICTS block)
    const perGateVerdicts = context.gateEnforcement?.parseGateVerdicts(gateVerdictInput ?? '');
    if (perGateVerdicts != null && perGateVerdicts.length > 0) {
      context.state.gates.perGateVerdicts = perGateVerdicts;
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
      const newStep = await this.chainSessionStore.advanceStep(sessionId, currentStepAtStart);
      if (newStep !== false) {
        sessionContext.currentStep = newStep;
      }
      context.diagnostics.info('GateVerdictProcessor', 'Gate PASS - advanced step', {
        stepToAdvance: currentStepAtStart,
        advancedTo: newStep,
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
    const currentStep = context.sessionContext?.currentStep ?? 0;
    const newStep = await this.chainSessionStore.advanceStep(sessionId, currentStep);
    if (newStep !== false) {
      sessionContext.currentStep = newStep;
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
    const currentStep = context.sessionContext?.currentStep ?? 0;
    const newStep = await this.chainSessionStore.advanceStep(sessionId, currentStep);
    if (newStep !== false) {
      sessionContext.currentStep = newStep;
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
