// @lifecycle canonical - Manages chain session lifecycle actions in the pipeline.
import { randomUUID } from 'crypto';

import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type {
  ChainNode,
  ChainSession,
  ChainSessionService,
  SessionBlueprint,
  ToolResponse,
} from '#shared/types/index.js';
import type { ExecutionContext, ParsedCommand, SessionContext } from '../../context/index.js';
import type { ExecutionPlan } from '../../types.js';

import { isRunComplete } from '#shared/types/chain-session.js';
import { formatChainId, nextRunNumber, stripRunNumber } from '#shared/utils/chain-id-codec.js';
import { currentOrdinal, mintSequentialIds, totalOf } from '#shared/utils/node-order.js';

/**
 * Pipeline Stage 13: Session Management
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
  readonly provides = ['sessionContext.currentStep'] as const;

  constructor(
    private readonly chainSessionStore: ChainSessionService,
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
      const scopeOptions = context.getScopeOptions();
      let existingSession: ChainSession | undefined =
        !forceRestart &&
        resolvedSessionId &&
        this.chainSessionStore.hasActiveSession(resolvedSessionId)
          ? this.chainSessionStore.getSession(resolvedSessionId, scopeOptions)
          : undefined;

      if (!existingSession && !forceRestart && requestedChainId) {
        const chainSession = this.chainSessionStore.getSessionByChainIdentifier(requestedChainId, {
          includeDormant: explicitChainResume,
          ...scopeOptions,
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

      // Earliest point that holds the resolved session. A `user_response`/`gate_verdict`
      // arriving for a run that has already finished used to fall straight through to
      // `createPendingGateReviewIfNeeded`, which opened a FRESH review (attempt 1/3) against a
      // completed run — the client was asked to re-review work the run had already accepted.
      // Answering here, before any session context is published, is what stops it: with no
      // `context.sessionContext` the capture stage skips, and with `context.response` set both
      // the execution and formatting stages skip too.
      if (existingSession !== undefined && !isRestart && isRunComplete(existingSession)) {
        context.setResponse(this.buildAlreadyCompleteResponse(existingSession));
        context.state.session.lifecycleDecision = 'resume-completed';
        this.logExit({
          skipped: 'Run already complete',
          chainId: existingSession.chainId,
          runStatus: existingSession.runStatus ?? 'working',
        });
        return;
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
          currentStep: currentOrdinal(
            existingSession.state.nodes,
            existingSession.state.currentNodeId
          ),
          currentNodeId: existingSession.state.currentNodeId,
          totalSteps: totalOf(existingSession.state.nodes),
        };
        const pendingReview = this.chainSessionStore.getPendingGateReview(resolvedSessionId);
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
        const options = { ...scopeOptions, ...(blueprint ? { blueprint } : {}) };

        // Carries the ids minted at parse time into the run — the only path by which an
        // authored `id:` (or a symbolic chain's frozen `nK`) becomes the run's identity.
        const nodes = this.buildChainNodes(context, chainId, totalSteps);
        await this.chainSessionStore.createSession(
          resolvedSessionId,
          chainId,
          totalSteps,
          context.getPromptArgs(),
          { ...options, nodes }
        );

        sessionContext = {
          sessionId: resolvedSessionId,
          chainId,
          isChainExecution: true,
          currentStep: 1,
          // Derived from the same node list handed to the store rather than read back off its
          // return value: a new run always stands at its first node, and depending on the
          // return would couple this stage to a store implementation detail.
          currentNodeId: nodes?.[0]?.id ?? (totalSteps > 0 ? 'n1' : null),
          totalSteps,
        };
        decision = forceRestart ? 'create-force-restart' : 'create-new';
      }

      context.sessionContext = sessionContext;
      context.state.session.lifecycleDecision = decision;

      // Create pending gate review for chain steps with blocking gates
      // This enables upfront enforcement: chains pause until gate_verdict is submitted
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
   * The answer a client gets when it resumes a run that already finished.
   *
   * Names the chain and the final status so a driver can tell "your run is done" apart from
   * "your chain_id was wrong" — the two were indistinguishable when the old path answered with
   * a fresh gate review.
   */
  private buildAlreadyCompleteResponse(session: ChainSession): ToolResponse {
    const totalSteps = totalOf(session.state.nodes);
    const status = session.runStatus ?? 'completed';
    const lines = [
      `✓ Chain run already complete.`,
      ``,
      `Chain: ${session.chainId}`,
      `Status: ${status}`,
      `Steps: ${totalSteps}/${totalSteps}`,
      ``,
      `No user_response or gate_verdict is needed. Start a fresh run with the chain command, or pass force_restart to re-run this chain.`,
    ];
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: false };
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

    // Scoped to the step this review is being opened FOR (P4-F3, DEV-T4-2). This is the review
    // feed that actually blocks a chain: `formatChainResponse` renders `buildGateReviewCTA` from
    // `pendingReview.gateIds`, which is this list. Reading the run-wide accumulator here is what
    // put a gate bound to node n2 into every step's review. `accumulatedGateIds` remains the
    // fallback for the single-prompt path, which writes no `reviewGateIds`.
    const gateIds =
      context.state.gates.reviewGateIds ?? context.state.gates.accumulatedGateIds ?? [];
    if (gateIds.length === 0) {
      return;
    }

    // Delegate to GateEnforcementAuthority for consistent review creation. The maxAttempts
    // resolution and review-shape logic live there now (P5-F6) — shared with the post-advance
    // call site in `GateEnhancementService.ensurePostAdvanceReview` — so this stage only decides
    // WHETHER to create (the guards above) and hands off WHAT (`gateIds`).
    const authority = context.gateEnforcement;
    if (!authority) {
      this.logger.warn(
        '[SessionManagement] GateEnforcementAuthority not available - cannot create pending review'
      );
      return;
    }

    const created = await authority.createReviewForStep(context, sessionContext, gateIds);

    context.diagnostics.info(this.name, 'Created PendingGateReview for step gates', {
      gateIds,
      maxAttempts: created?.maxAttempts,
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
      return stripRunNumber(requestedChainId);
    }

    const parsedChainId = context.parsedCommand?.chainId;
    if (typeof parsedChainId === 'string' && parsedChainId.length > 0) {
      return stripRunNumber(parsedChainId);
    }

    if (context.parsedCommand?.promptId) {
      return `chain-${context.parsedCommand.promptId}`;
    }
    return `chain-${Date.now().toString(36)}`;
  }

  private buildChainId(baseChainId: string, isRestart: boolean): string {
    const normalizedBase = stripRunNumber(baseChainId);
    const chainId = formatChainId(normalizedBase, this.getNextRunNumber(normalizedBase));
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

  /**
   * Build the run's frozen node list from the parsed chain.
   *
   * Returns undefined when the request carries no parsed chain steps (a gated single prompt,
   * for instance) — the store then synthesizes `n1..nK` from `totalSteps`, so the caller need
   * not invent identities it does not have. A parsed chain missing minted ids anywhere falls
   * back to sequential ids for the WHOLE list rather than mixing minted and synthetic ones,
   * which would make the resulting identities depend on which steps happened to be parsed by
   * which builder.
   */
  private buildChainNodes(
    context: ExecutionContext,
    chainId: string,
    totalSteps: number
  ): ChainNode[] | undefined {
    const steps = context.parsedCommand?.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      return undefined;
    }

    const chainSteps = context.parsedCommand?.convertedPrompt?.chainSteps;
    const allMinted = steps.every(
      (step) => typeof step.nodeId === 'string' && step.nodeId.length > 0
    );
    const fallbackIds = allMinted ? [] : mintSequentialIds(steps.length);

    if (!allMinted) {
      // The detector standing in for a required `nodeId` on ChainStepPrompt (D10): every
      // production parse path mints, so reaching here means a construction site was added
      // without one and the run's identities are synthetic.
      this.logger.warn(
        `[SessionManagement] Parsed chain ${chainId} reached session creation without minted node ids (${steps.length} steps, expected ${totalSteps}); falling back to sequential ids`
      );
    }

    return steps.map((step, index) => ({
      id: allMinted ? (step.nodeId as string) : (fallbackIds[index] as string),
      promptId: step.promptId,
      stepName: chainSteps?.[index]?.stepName ?? step.promptId,
    }));
  }

  private getNextRunNumber(baseChainId: string): number {
    return nextRunNumber(this.chainSessionStore.getRunHistory(stripRunNumber(baseChainId)));
  }

  /**
   * Whether a run has finished — the input to the auto-restart decision.
   *
   * Was `currentStep >= totalSteps`, which reads a run *standing on* its final step as
   * finished: resuming such a run without an explicit `chain_id` silently restarted it from
   * step 1 instead of continuing. The latch distinguishes the two.
   */
  private isChainComplete(session?: ChainSession): boolean {
    if (!session) {
      return false;
    }
    return isRunComplete(session);
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
