// @lifecycle canonical - Manages chain session lifecycle actions in the pipeline.
import { randomUUID } from 'crypto';

import { BasePipelineStage } from '../stage.js';

import type {
  ChainSession,
  ChainSessionService,
  SessionBlueprint,
} from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type {
  ExecutionContext,
  ParsedCommand,
  SessionContext,
} from '../../context/execution-context.js';
import type { ExecutionPlan } from '../../types.js';
import type { CreateReviewOptions } from '../decisions/gates/gate-enforcement-types.js';

/**
 * Pipeline Stage 7: Session Management
 *
 * Manages chain execution sessions, handling session creation, resumption,
 * and state persistence for multi-step workflows.
 *
 * Dependencies: context.executionPlan
 * Output: context.sessionContext (session ID, step tracking, state)
 * Can Early Exit: No
 */
export class SessionManagementStage extends BasePipelineStage {
  readonly name = 'SessionManagement';

  constructor(
    private readonly chainSessionManager: ChainSessionService,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (!context.executionPlan?.requiresSession) {
      this.logExit({ skipped: 'Session not required' });
      return;
    }

    try {
      const forceRestart = Boolean(context.mcpRequest.force_restart);
      const baseChainId = this.getBaseChainId(context);
      const explicitChainResume = context.hasExplicitChainId();
      const requestedChainId = explicitChainResume ? context.getRequestedChainId() : undefined;

      let resolvedSessionId = forceRestart ? undefined : context.getSessionId();
      let existingSession: ChainSession | undefined =
        !forceRestart &&
        resolvedSessionId &&
        this.chainSessionManager.hasActiveSession(resolvedSessionId)
          ? this.chainSessionManager.getSession(resolvedSessionId)
          : undefined;

      if (!existingSession && !forceRestart && requestedChainId) {
        const chainSession = this.chainSessionManager.getSessionByChainIdentifier(
          requestedChainId,
          {
            includeDormant: explicitChainResume,
          }
        );
        if (chainSession) {
          existingSession = chainSession;
          resolvedSessionId = chainSession.sessionId;
        }
      }

      const isChainComplete = this.isChainComplete(existingSession);
      const hasExplicitResumeTarget = context.hasExplicitChainId();
      const isRestart = forceRestart || (isChainComplete && !hasExplicitResumeTarget);

      if (isRestart) {
        existingSession = undefined;
        resolvedSessionId = undefined;
      }

      if (!resolvedSessionId) {
        resolvedSessionId = this.createSessionId(context);
      }

      let sessionContext: SessionContext;
      let decision: 'resume-chain' | 'resume-chain-id' | 'create-new' | 'create-force-restart';

      if (existingSession) {
        sessionContext = {
          sessionId: resolvedSessionId,
          chainId: existingSession.chainId,
          isChainExecution: true,
          currentStep: existingSession.state.currentStep,
          totalSteps: existingSession.state.totalSteps,
        };
        const pendingReview = this.chainSessionManager.getPendingGateReview(resolvedSessionId);
        if (pendingReview) {
          sessionContext.pendingReview = pendingReview;
        }
        context.state.session.resumeSessionId = resolvedSessionId;
        context.state.session.resumeChainId = existingSession.chainId;
        if (context.hasExplicitChainId()) {
          decision = 'resume-chain-id';
        } else {
          decision = 'resume-chain';
        }
      } else {
        const totalSteps = this.getTotalSteps(context);
        const chainId = this.buildChainId(baseChainId, isRestart);

        const blueprint = this.buildSessionBlueprint(context);
        const options = blueprint ? { blueprint } : undefined;

        await this.chainSessionManager.createSession(
          resolvedSessionId,
          chainId,
          totalSteps,
          context.getPromptArgs(),
          options
        );

        sessionContext = {
          sessionId: resolvedSessionId,
          chainId,
          isChainExecution: true,
          currentStep: 1,
          totalSteps,
        };
        decision = forceRestart ? 'create-force-restart' : 'create-new';
      }

      context.sessionContext = sessionContext;
      context.state.session.lifecycleDecision = decision;

      // Create PendingGateReview if gates are present and no pending review exists
      await this.createPendingGateReviewIfNeeded(context, sessionContext);

      this.logExit({
        sessionId: sessionContext.sessionId,
        chainId: sessionContext.chainId,
        pendingReview: Boolean(sessionContext.pendingReview),
        decision,
      });
    } catch (error) {
      this.handleError(error, 'Session management failed');
    }
  }

  /**
   * Creates a PendingGateReview for the current step if gates are present
   * and no review already exists. Delegates to GateEnforcementAuthority.
   */
  private async createPendingGateReviewIfNeeded(
    context: ExecutionContext,
    sessionContext: SessionContext
  ): Promise<void> {
    // Skip if no blocking gates or review already exists
    if (!context.state.gates.hasBlockingGates || sessionContext.pendingReview) {
      return;
    }

    const gateIds = context.state.gates.accumulatedGateIds ?? [];
    if (gateIds.length === 0) {
      return;
    }

    // Delegate to GateEnforcementAuthority for consistent review creation
    const authority = context.gateEnforcement;
    if (!authority) {
      this.logger.warn(
        '[SessionManagement] GateEnforcementAuthority not available - cannot create pending review'
      );
      return;
    }

    // Get step-level retry override if available
    const currentStepNumber = sessionContext.currentStep ?? 1;
    const steps = context.parsedCommand?.steps;
    const currentStep = steps?.find((s) => s.stepNumber === currentStepNumber);
    const stepRetries = currentStep?.retries;

    const reviewOptions: CreateReviewOptions = {
      gateIds,
      instructions: context.gateInstructions ?? '',
      ...(stepRetries !== undefined ? { maxAttempts: stepRetries } : {}),
      metadata: {
        sessionId: sessionContext.sessionId,
        stepNumber: currentStepNumber,
      },
    };

    const pendingReview = authority.createPendingReview(reviewOptions);

    // Persist to session manager and update context via authority
    await authority.setPendingReview(sessionContext.sessionId, pendingReview);
    sessionContext.pendingReview = pendingReview;

    context.diagnostics.info(this.name, 'Created PendingGateReview for step gates', {
      gateIds,
      maxAttempts: pendingReview.maxAttempts,
      enforcementMode: context.state.gates.enforcementMode,
    });
  }

  private createSessionId(context: ExecutionContext): string {
    if (context.executionPlan?.gates.length) {
      return `review-${context.parsedCommand?.promptId}-${Date.now()}`;
    }
    return randomUUID();
  }

  private getBaseChainId(context: ExecutionContext): string {
    const requestedChainId = context.mcpRequest.chain_id ?? context.state.session.resumeChainId;
    if (typeof requestedChainId === 'string' && requestedChainId.length > 0) {
      return this.stripRunCounter(requestedChainId);
    }

    const parsedChainId = context.parsedCommand?.chainId;
    if (typeof parsedChainId === 'string' && parsedChainId.length > 0) {
      return this.stripRunCounter(parsedChainId);
    }

    if (context.parsedCommand?.promptId) {
      return `chain-${context.parsedCommand.promptId}`;
    }
    return `chain-${Date.now().toString(36)}`;
  }

  private buildChainId(baseChainId: string, isRestart: boolean): string {
    const normalizedBase = this.stripRunCounter(baseChainId);
    const runNumber = this.getNextRunNumber(normalizedBase);
    const chainId = `${normalizedBase}#${runNumber}`;
    this.logger.debug(
      `[SessionManagement] ${isRestart ? 'Restarting' : 'Starting'} run ${chainId}`
    );
    return chainId;
  }

  private getTotalSteps(context: ExecutionContext): number {
    // Use type guard for type-safe access to chain steps
    if (context.hasChainCommand()) {
      return context.parsedCommand.steps.length;
    }
    if (context.parsedCommand?.convertedPrompt?.chainSteps?.length) {
      return context.parsedCommand.convertedPrompt.chainSteps.length;
    }
    return 1;
  }

  private getNextRunNumber(baseChainId: string): number {
    const normalized = this.stripRunCounter(baseChainId);
    const runHistory = this.chainSessionManager.getRunHistory(normalized);
    if (runHistory.length === 0) {
      return 1;
    }

    const lastRunId = runHistory[runHistory.length - 1];
    if (!lastRunId) {
      return runHistory.length + 1;
    }
    const lastRunNumber = this.extractRunNumber(lastRunId);
    if (typeof lastRunNumber === 'number') {
      return lastRunNumber + 1;
    }
    return runHistory.length + 1;
  }

  private stripRunCounter(chainId: string): string {
    return chainId.replace(/#\d+$/, '');
  }

  private extractRunNumber(chainId: string): number | undefined {
    const match = chainId.match(/#(\d+)$/);
    if (match?.[1] === undefined) {
      return undefined;
    }
    return Number.parseInt(match[1], 10);
  }

  private isChainComplete(session?: ChainSession): boolean {
    if (!session) {
      return false;
    }

    const { currentStep = 0, totalSteps = 0 } = session.state;
    return totalSteps > 0 && currentStep >= totalSteps;
  }

  private buildSessionBlueprint(context: ExecutionContext): SessionBlueprint | undefined {
    if (!context.parsedCommand || !context.executionPlan) {
      return undefined;
    }

    const parsedClone = this.cloneParsedCommand(context.parsedCommand);
    const planClone = this.cloneExecutionPlan(context.executionPlan);

    const blueprint: SessionBlueprint = {
      parsedCommand: parsedClone,
      executionPlan: planClone,
    };

    if (context.gateInstructions !== undefined) {
      blueprint.gateInstructions = context.gateInstructions;
    }

    return blueprint;
  }

  private cloneParsedCommand(parsed: ParsedCommand): ParsedCommand {
    return JSON.parse(JSON.stringify(parsed)) as ParsedCommand;
  }

  private cloneExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
    return JSON.parse(JSON.stringify(plan)) as ExecutionPlan;
  }
}
