// @lifecycle canonical - Captures model responses and lifecycle decisions.
import { UnknownObservationValidationError } from '../../capture/unknown-observation-processor.js';
import { decideMutation } from '../decisions/index.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { ChainNode } from '#shared/types/chain-execution.js';
import type {
  SessionBlueprint,
  UnknownLedgerEntry,
  UnknownObservation,
} from '#shared/types/chain-session.js';
import type { ChainSessionService, ToolResponse } from '#shared/types/index.js';
import type { GateEnhancementService } from '../../../gates/services/gate-enhancement-service.js';
import type { GateVerdictProcessor } from '../../../gates/services/gate-verdict-processor.js';
import type { StepCaptureService } from '../../capture/step-capture-service.js';
import type { UnknownObservationProcessor } from '../../capture/unknown-observation-processor.js';
import type { ExecutionContext, SessionContext } from '../../context/index.js';
import type { ChainMutation } from '../decisions/index.js';

import { currentOrdinal, totalOf } from '#shared/utils/node-order.js';

/**
 * Prompt id of the bundled investigation step the mutation policy inserts (OQ-P4-1).
 *
 * A real registry resource rather than a synthetic promptId: node rendering resolves promptId
 * through the prompt registry, so a synthetic id would need a special case in the render path.
 * Lives under a BUNDLED category (`resources/prompts/workflow/`) — the user-prompt categories
 * are gitignored, so a prompt authored into one of those would exist only on the machine that
 * created it and every other install would insert a node pointing at nothing.
 */
const INVESTIGATION_PROMPT_ID = 'investigate_unknown';

/** Longest statement fragment carried into an inserted node's step name. */
const INSERTED_STEP_NAME_STATEMENT_LIMIT = 60;

/**
 * Outcome of handing this call's observation batch to the processor.
 *
 * Three states, not a boolean: the mutation policy fires ONLY on `applied` (D2 — the model
 * never emits graph edits, so the delta is the sole trigger), and `none` and `rejected` are
 * distinct non-firing reasons. A gate retry carries no observations and lands on `none`, which
 * is what makes double-firing structurally impossible rather than guarded against.
 */
type ObservationOutcome =
  | { readonly status: 'none' }
  | { readonly status: 'rejected' }
  | {
      readonly status: 'applied';
      readonly ledger: readonly UnknownLedgerEntry[];
      readonly delta: readonly UnknownObservation[];
    };

/**
 * Pipeline Stage 16: Step Response Capture
 *
 * Thin orchestrator that delegates verdict processing and step capture to domain services.
 *
 * Dependencies: context.sessionContext
 * Output: Captured step results in TextReferenceStore
 * Can Early Exit: No
 */
export class StepResponseCaptureStage extends BasePipelineStage {
  readonly name = 'StepResponseCapture';

  constructor(
    private readonly verdictProcessor: GateVerdictProcessor,
    private readonly stepCaptureService: StepCaptureService,
    private readonly chainSessionStore: ChainSessionService,
    private readonly unknownObservationProcessor: UnknownObservationProcessor,
    logger: Logger,
    /**
     * Owner of the post-advance review re-evaluation (P5-F6). Optional so an
     * ExecutionContext-less test harness need not construct the full gate stack — absent, this
     * stage falls back to the pre-existing behavior (no post-advance review).
     */
    private readonly gateEnhancementService?: GateEnhancementService
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.sessionContext === undefined) {
      this.logExit({ skipped: 'No session context available' });
      return;
    }

    const sessionContext = context.sessionContext;
    if (!sessionContext.isChainExecution) {
      this.logExit({ skipped: 'Not a chain execution' });
      return;
    }

    const sessionId = sessionContext.sessionId;
    if (sessionId.trim().length === 0) {
      this.logExit({ skipped: 'Missing session identifier' });
      return;
    }

    const scopeOptions = context.getScopeOptions();
    const session = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (session === undefined) {
      this.logExit({ skipped: 'Session not found' });
      return;
    }

    // The run's position is derived from its node list now; the node id it stands at is the
    // identity carried alongside it so downstream calls address the store without re-deriving.
    const currentStepAtStart = currentOrdinal(session.state.nodes, session.state.currentNodeId);
    const currentNodeIdAtStart = session.state.currentNodeId;

    // Align pipeline session context with manager state
    this.alignSessionContext(context, sessionContext, session, currentStepAtStart);

    // Declared unknowns are applied here — ahead of the chain-context refresh below, so
    // this call's rendering sees the ledger it just wrote, and ahead of gate-action and
    // verdict handling because every one of those paths can exit early. A resume that
    // carries a gate verdict is exactly where an unknown tends to surface, so dropping
    // the batch there would be silent loss. Entries stamp `currentStepAtStart` — the step
    // being reported on, not the one this call advances to. Re-submitting the same batch
    // on a gate retry is idempotent by construction (see `computeUnknownLedger`).
    const observationOutcome = await this.applyObservations(
      context,
      sessionId,
      currentNodeIdAtStart ?? ''
    );
    if (observationOutcome.status === 'rejected') {
      this.logExit({ observations: 'rejected' });
      return;
    }

    // P4: the adaptive mutation policy runs here and ONLY here — after the ledger write
    // succeeded, and before the chain-context refresh below so this call's rendering and CTA
    // already see the mutated node list. A rejected batch returned above, so no mutation can
    // ride on a ledger that was never written.
    if (observationOutcome.status === 'applied') {
      await this.applyMutation(context, sessionId, observationOutcome);
    }

    // Refresh chain variables for downstream template rendering
    context.state.session.chainContext = this.chainSessionStore.getChainContext(
      sessionId,
      scopeOptions
    );

    const lifecycleDecision = context.state.session.lifecycleDecision;
    if (lifecycleDecision === 'create-new' || lifecycleDecision === 'create-force-restart') {
      this.logExit({ skipped: 'New session, nothing to capture' });
      return;
    }

    // Handle gate_action parameter (retry/skip/abort) when retry limit exceeded
    const gateAction = context.mcpRequest.gate_action;
    const authority = context.gateEnforcement;
    const isRetryLimitExceeded =
      authority !== undefined
        ? authority.isRetryLimitExceeded(sessionId)
        : this.chainSessionStore.isRetryLimitExceeded(sessionId);

    if (gateAction !== undefined && isRetryLimitExceeded) {
      const earlyExit = await this.verdictProcessor.handleGateAction(
        context,
        sessionId,
        gateAction,
        sessionContext
      );
      if (earlyExit) {
        this.logExit({ gateAction, handled: true });
        return;
      }
    }

    // Process gate verdicts
    const userResponse = context.mcpRequest.user_response?.trim();

    const deferredResult = await this.verdictProcessor.processDeferredVerdict(
      context,
      session,
      sessionId,
      currentStepAtStart,
      userResponse,
      sessionContext
    );
    if (deferredResult.earlyExit) {
      await this.ensurePostAdvanceReview(context);
      this.logExit({ gateVerdict: 'deferred', handled: true });
      return;
    }

    // Re-fetch session in case deferred verdict changed state
    const sessionAfterDeferred =
      this.chainSessionStore.getSession(sessionId, scopeOptions) ?? session;
    const pendingResult = await this.verdictProcessor.processPendingReviewVerdict(
      context,
      sessionAfterDeferred,
      sessionId,
      currentStepAtStart,
      deferredResult.userResponse,
      sessionContext
    );
    if (pendingResult.earlyExit) {
      await this.ensurePostAdvanceReview(context);
      this.logExit({ gateVerdict: 'pending-review', handled: true });
      return;
    }

    // Capture step result (placeholder or real response)
    const sessionForCapture = this.chainSessionStore.getSession(sessionId, scopeOptions) ?? session;
    await this.stepCaptureService.captureStep(
      context,
      sessionId,
      sessionForCapture,
      sessionContext,
      currentStepAtStart,
      {
        userResponse: pendingResult.userResponse,
        passClearedThisCall:
          pendingResult.passClearedThisCall || deferredResult.passClearedThisCall,
      }
    );

    await this.ensurePostAdvanceReview(context);

    this.logExit({ captured: true });
  }

  /**
   * Thin call-through to `GateEnhancementService.ensurePostAdvanceReview` (P5-F6) — the decision
   * of whether a step-targeted gate needs a fresh review lives there, this stage only supplies
   * the post-advance `context`/`sessionContext` and the guard against a missing session context.
   *
   * Called from every mutually-exclusive exit branch that can follow an advance within this
   * request (deferred-verdict early exit, pending-review-verdict early exit, and the full capture
   * fall-through) — exactly one fires per call, so this never runs twice for the same request.
   */
  private async ensurePostAdvanceReview(context: ExecutionContext): Promise<void> {
    if (this.gateEnhancementService === undefined || context.sessionContext === undefined) {
      return;
    }
    await this.gateEnhancementService.ensurePostAdvanceReview(context, context.sessionContext);
  }

  /**
   * Hand any declared unknown observations to the processor.
   *
   * @returns `rejected` when the batch was rejected and a tool-result error was set, meaning
   *   the stage must stop; `applied` (carrying the delta and the resulting ledger) when the
   *   batch landed; `none` when this call declared nothing. Non-validation failures
   *   (persistence) propagate untouched.
   */
  private async applyObservations(
    context: ExecutionContext,
    sessionId: string,
    nodeId: string
  ): Promise<ObservationOutcome> {
    const observations = context.mcpRequest.observations;
    if (observations === undefined || observations.length === 0) {
      return { status: 'none' };
    }

    try {
      const ledger = await this.unknownObservationProcessor.applyObservations(
        context,
        sessionId,
        nodeId,
        observations
      );
      return { status: 'applied', ledger, delta: observations };
    } catch (error) {
      if (error instanceof UnknownObservationValidationError) {
        context.setResponse(this.buildErrorResponse(`❌ Error: ${error.message}`));
        return { status: 'rejected' };
      }
      throw error;
    }
  }

  /**
   * Ask the mutation policy what this call's observation delta should change about the run's
   * remaining node list, and apply its answer through the session store.
   *
   * Thin orchestration by construction: the decision is `decideMutation`'s (pure, in
   * `decisions/mutation/`), the write is `ChainSessionStore`'s, and this method owns only the
   * translation between them plus the log line. Both store operations report a refusal by
   * returning a falsy value rather than throwing — a refusal is a logged no-op here, never an
   * error surfaced to the client, because the mutation is advisory (D6): a run that could not
   * insert its investigation step is still a valid run.
   */
  private async applyMutation(
    context: ExecutionContext,
    sessionId: string,
    outcome: {
      readonly ledger: readonly UnknownLedgerEntry[];
      readonly delta: readonly UnknownObservation[];
    }
  ): Promise<void> {
    const scopeOptions = context.getScopeOptions();
    const session = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (session === undefined) {
      return;
    }

    const nodes = session.state.nodes;
    const insertedNodes = nodes.filter((node) => node.origin === 'inserted');
    const decision = decideMutation({
      delta: outcome.delta,
      ledger: outcome.ledger,
      nodes,
      currentNodeId: session.state.currentNodeId,
      // Both cap inputs are derived from the persisted node rows, never from in-memory
      // bookkeeping: `origin`/`origin_unknown_id` reconstruct on a cold load, so a resumed run
      // enforces the same caps as one that never dropped out of memory.
      insertedCount: insertedNodes.length,
      insertedUnknownIds: collectOriginUnknownIds(insertedNodes),
      // Read off the run's stored blueprint, not off `mcpRequest`: a Workflow IR is submitted on
      // the run's FIRST call and every later step is its own MCP call carrying only a chain_id.
      // The blueprint is the one run-scoped record of the submission that survives that gap, and
      // it survives a cold load with it.
      ...resolveDeclaredInsertionCap(
        this.chainSessionStore.getSessionBlueprint(sessionId, scopeOptions)
      ),
    });

    const applied = await this.performMutation(sessionId, decision);

    context.diagnostics.info(this.name, 'Adaptive mutation decision', {
      sessionId,
      kind: decision.kind,
      ...(decision.kind === 'none' ? { reason: decision.reason } : {}),
      applied,
    });
    this.logger.debug(
      `[ChainMutation] session ${sessionId}: ${describeMutation(decision)} (applied=${applied})`
    );

    if (applied) {
      this.refreshTotals(context, sessionId, scopeOptions);
    }
  }

  /**
   * Execute one decided mutation. Returns whether the run's node list actually changed —
   * `false` covers both `kind:'none'` and a store refusal, which the caller logs rather than
   * raises.
   */
  private async performMutation(sessionId: string, decision: ChainMutation): Promise<boolean> {
    if (decision.kind === 'insert_investigation') {
      // The node id is minted inside the store (`mintInsertionId` with base `inv-<unknownId>`),
      // not here: id minting is part of the never-renumber contract the node list owns.
      const inserted = await this.chainSessionStore.insertNodeAfter(
        sessionId,
        decision.afterNodeId,
        {
          stepName: buildInvestigationStepName(decision.statement),
          promptId: INVESTIGATION_PROMPT_ID,
          origin: 'inserted',
          unknownId: decision.unknownId,
        }
      );
      return inserted !== null;
    }

    if (decision.kind === 'skip_node') {
      return await this.chainSessionStore.markNodeSkipped(
        sessionId,
        decision.nodeId,
        decision.unknownId
      );
    }

    return false;
  }

  /**
   * Re-publish the run's totals after a mutation changed the node list.
   *
   * `alignSessionContext` above ran against the PRE-mutation list, and several paths out of
   * this stage (gate action, deferred verdict, pending review) return before
   * `StepCaptureService.syncSessionContext` would refresh it. Without this, the footer on an
   * insertion call renders "2/2" for a run that now has three nodes. The current ordinal is
   * deliberately re-derived too but cannot move: an insertion lands strictly after the current
   * node and a skip targets a strictly-ahead node, so both leave the run standing where it was.
   */
  private refreshTotals(
    context: ExecutionContext,
    sessionId: string,
    scopeOptions: ReturnType<ExecutionContext['getScopeOptions']>
  ): void {
    const session = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (session === undefined || context.sessionContext === undefined) {
      return;
    }
    context.sessionContext = {
      ...context.sessionContext,
      currentStep: currentOrdinal(session.state.nodes, session.state.currentNodeId),
      totalSteps: totalOf(session.state.nodes),
    };
  }

  private buildErrorResponse(message: string): ToolResponse {
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }

  /**
   * Align pipeline session context with manager state.
   * Important for gate reviews where session state may have changed.
   */
  private alignSessionContext(
    context: ExecutionContext,
    sessionContext: SessionContext,
    session: NonNullable<ReturnType<ChainSessionService['getSession']>>,
    currentStepAtStart: number
  ): void {
    const updatedSessionContext: SessionContext = {
      sessionId: sessionContext.sessionId,
      isChainExecution: sessionContext.isChainExecution,
    };
    if (sessionContext.chainId !== undefined) {
      updatedSessionContext.chainId = sessionContext.chainId;
    }
    updatedSessionContext.currentStep = currentStepAtStart;
    updatedSessionContext.currentNodeId = session.state.currentNodeId;
    updatedSessionContext.totalSteps = totalOf(session.state.nodes);
    const pendingReview = session.pendingGateReview ?? sessionContext.pendingReview;
    if (pendingReview !== undefined) {
      updatedSessionContext.pendingReview = pendingReview;
    }
    if (sessionContext.previousStepResult !== undefined) {
      updatedSessionContext.previousStepResult = sessionContext.previousStepResult;
    }
    if (sessionContext.previousStepQualityScore !== undefined) {
      updatedSessionContext.previousStepQualityScore = sessionContext.previousStepQualityScore;
    }

    context.sessionContext = updatedSessionContext;
  }
}

/**
 * The unknown ids that already own an inserted node, for the per-unknown insertion cap.
 *
 * Reads `originUnknownId` off the node rather than parsing it back out of the node id:
 * `mintInsertionId` slugifies and collision-suffixes, so the id has no decodable inverse.
 */
function collectOriginUnknownIds(insertedNodes: readonly ChainNode[]): string[] {
  return insertedNodes
    .map((node) => node.originUnknownId)
    .filter((unknownId): unknownId is string => unknownId !== undefined);
}

/**
 * The submission-declared insertion cap, as a spreadable fragment of `DecideMutationInput`.
 *
 * Returns `{}` rather than `{ maxInsertions: undefined }` when nothing was declared, because
 * `exactOptionalPropertyTypes` distinguishes the two and only the first means "server default".
 */
function resolveDeclaredInsertionCap(blueprint: SessionBlueprint | undefined): {
  maxInsertions?: number;
} {
  const declared = blueprint?.parsedCommand.budget?.maxInsertions;
  return declared !== undefined ? { maxInsertions: declared } : {};
}

/**
 * The submission-declared `budget.pauseOnBlocking`, read back off the run's blueprint (D-2).
 *
 * Same source and same reason as {@link resolveDeclaredInsertionCap}: a Workflow IR or a YAML
 * chain declares the knob on the run's FIRST call, and every later step is its own MCP call
 * carrying only a `chain_id` — the blueprint is the one run-scoped record of the submission that
 * survives that gap, and it survives a cold load with it.
 *
 * Returns a plain `boolean`, not the `{}`-or-`{key}` fragment its sibling returns. The cap has to
 * keep "declared 0" distinguishable from "declared nothing" because 0 and the server default
 * differ; this knob has no server default to narrow, so absent and explicit-`false` are the same
 * posture and collapsing them here is the honest projection rather than a lost distinction.
 *
 * Exported for the unit test that pins the two directions. Its production consumer is the
 * interrupt call in row 2.1 — until that lands, this readback is exercised by the test alone.
 */
export function resolveDeclaredPauseOnBlocking(blueprint: SessionBlueprint | undefined): boolean {
  return blueprint?.parsedCommand.budget?.pauseOnBlocking === true;
}

/** Human-legible step name for an inserted investigation node, statement truncated. */
function buildInvestigationStepName(statement: string): string {
  const trimmed = statement.trim();
  const fragment =
    trimmed.length > INSERTED_STEP_NAME_STATEMENT_LIMIT
      ? `${trimmed.slice(0, INSERTED_STEP_NAME_STATEMENT_LIMIT - 1)}…`
      : trimmed;
  return `Investigate: ${fragment}`;
}

/** One-line description of a decision, including the named reason when nothing fired. */
function describeMutation(decision: ChainMutation): string {
  if (decision.kind === 'insert_investigation') {
    return `insert_investigation after ${decision.afterNodeId} for unknown ${decision.unknownId}`;
  }
  if (decision.kind === 'skip_node') {
    return `skip_node ${decision.nodeId} for unknown ${decision.unknownId}`;
  }
  return `none (${decision.reason})`;
}
