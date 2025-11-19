// @lifecycle canonical - Manages chain session lifecycle actions in the pipeline.
import { randomUUID } from 'crypto';

import { BasePipelineStage } from '../stage.js';

import type { ChainSession, ChainSessionService, SessionBlueprint } from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type {
  ExecutionContext,
  ExecutionPlan,
  ParsedCommand,
  SessionContext,
} from '../../context/execution-context.js';

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
      const forceRestart = Boolean(
        context.mcpRequest.force_restart || context.metadata['forceRestart'] === true
      );
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
        const chainSession = this.chainSessionManager.getSessionByChainIdentifier(requestedChainId, {
          includeLegacy: explicitChainResume,
        });
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
          pendingReview: this.chainSessionManager.getPendingGateReview(resolvedSessionId),
        };
        context.metadata['resumeSessionId'] = resolvedSessionId;
        context.metadata['resumeChainId'] = existingSession.chainId;
        if (context.hasExplicitChainId()) {
          decision = 'resume-chain-id';
        } else {
          decision = 'resume-chain';
        }
      } else {
        const totalSteps = this.getTotalSteps(context);
        const chainId = this.buildChainId(baseChainId, isRestart);

        await this.chainSessionManager.createSession(
          resolvedSessionId,
          chainId,
          totalSteps,
          context.getPromptArgs(),
          { blueprint: this.buildSessionBlueprint(context) }
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
      context.metadata['sessionLifecycleDecision'] = decision;

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

  private createSessionId(context: ExecutionContext): string {
    if (context.executionPlan?.gates.length) {
      return `review-${context.parsedCommand?.promptId}-${Date.now()}`;
    }
    return randomUUID();
  }

  private getBaseChainId(context: ExecutionContext): string {
    const requestedChainId = context.mcpRequest.chain_id ?? (context.metadata['resumeChainId'] as string | undefined);
    if (requestedChainId) {
      return this.stripRunCounter(requestedChainId);
    }
    if (context.parsedCommand?.chainId) {
      return this.stripRunCounter(context.parsedCommand.chainId);
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
    if (!match) {
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

    return {
      parsedCommand: parsedClone,
      executionPlan: planClone,
      gateInstructions: context.gateInstructions,
    };
  }

  private cloneParsedCommand(parsed: ParsedCommand): ParsedCommand {
    return JSON.parse(JSON.stringify(parsed)) as ParsedCommand;
  }

  private cloneExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
    return JSON.parse(JSON.stringify(plan)) as ExecutionPlan;
  }
}
