// @lifecycle canonical - Captures model responses and lifecycle decisions.
import { UnknownObservationValidationError } from '../../capture/unknown-observation-processor.js';
import {
  decideInterrupt,
  decideMutation,
  isInterruptResolutionAction,
  isUnknownInterruptPending,
  UNKNOWN_INTERRUPT_GATE_ID,
} from '../decisions/index.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { ChainNode, PendingGateReview } from '#shared/types/chain-execution.js';
import type {
  SessionBlueprint,
  UnknownLedgerEntry,
  UnknownObservation,
} from '#shared/types/chain-session.js';
import type { ChainSessionService, ToolResponse } from '#shared/types/index.js';
import type { GateEnhancementService } from '../../../gates/services/gate-enhancement-service.js';
import type { GateVerdictProcessor } from '../../../gates/services/gate-verdict-processor.js';
import type {
  RemainderApplication,
  RemainderProcessor,
} from '../../capture/remainder-processor.js';
import type { StepCaptureService } from '../../capture/step-capture-service.js';
import type { UnknownObservationProcessor } from '../../capture/unknown-observation-processor.js';
import type { ExecutionContext, SessionContext } from '../../context/index.js';
import type { ChainInterrupt, ChainMutation } from '../decisions/index.js';

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
     * The collaborators a lightweight harness may omit, as ONE bag rather than a growing tail of
     * optional positionals — `max-params` caps a constructor at 6, and a seventh positional would
     * also make every call site's `undefined` placeholder count as documentation.
     *
     * - `gateEnhancementService` — post-advance review re-evaluation (P5-F6). Absent, this stage
     *   falls back to the pre-existing behavior (no post-advance review).
     * - `remainderProcessor` — the `remainder` parameter (row 2.3). Absent, a submitted remainder
     *   is REFUSED rather than dropped (see `applyRemainder`).
     */
    private readonly collaborators: {
      readonly gateEnhancementService?: GateEnhancementService;
      readonly remainderProcessor?: RemainderProcessor;
    } = {}
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

    if (!(await this.runUnknownsPhase(context, sessionId, sessionContext, currentNodeIdAtStart))) {
      return;
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

    // `gate_action` carries two disjoint vocabularies (see `McpToolRequest.gate_action`). The
    // interrupt half was consumed above; only the retry-exhaustion half reaches the authority,
    // which has no branch for the other two and would answer `handled: true` to a verb it never
    // acted on.
    if (
      gateAction !== undefined &&
      !isInterruptResolutionAction(gateAction) &&
      isRetryLimitExceeded
    ) {
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
   * The unknowns half of this stage, in the one order that works (rows 2.1-2.3, P4).
   *
   * Extracted from `execute` as a unit because its five steps are sequenced by a single rule —
   * each one must see the state the previous one wrote — and because leaving them inline put
   * `execute` over the cognitive-complexity limit. Every step is itself a call-through; this
   * method owns the ORDER and nothing else, which is the one thing about this phase that is not
   * expressible anywhere but here:
   *
   * 1. **observations** — ahead of everything, so this call's rendering sees the ledger it just
   *    wrote, and because gate-action and verdict handling below can each exit early. A resume
   *    carrying a gate verdict is exactly where an unknown tends to surface, so applying the
   *    batch later would be silent loss. Entries stamp the step being REPORTED on, not the one
   *    this call advances to, and re-submitting a batch is idempotent (`computeUnknownLedger`).
   * 2. **mutation** — after the ledger write succeeded, so no mutation can ride on a ledger that
   *    was never written, and before the chain-context refresh so the CTA sees the new node list.
   * 3. **remainder** — before the verb that accepts it, so `accept_alternative` can be told
   *    whether the plan LANDED rather than merely arrived.
   * 4. **interrupt verb** — before the interrupt is re-decided, so a `resume` that just cleared
   *    the hold is not immediately re-held by the same still-open unknown. Reversed, the pause
   *    would be unanswerable.
   * 5. **interrupt** — last, so the payload describes the run as it stands after every mutation
   *    this call made.
   *
   * @returns `false` when a refusal response was set and the pipeline must stop.
   */
  private async runUnknownsPhase(
    context: ExecutionContext,
    sessionId: string,
    sessionContext: SessionContext,
    currentNodeIdAtStart: string | null
  ): Promise<boolean> {
    const observationOutcome = await this.applyObservations(
      context,
      sessionId,
      currentNodeIdAtStart ?? ''
    );
    if (observationOutcome.status === 'rejected') {
      this.logExit({ observations: 'rejected' });
      return false;
    }

    const insertedThisCall =
      observationOutcome.status === 'applied'
        ? await this.applyMutation(context, sessionId, observationOutcome)
        : false;

    const remainder = await this.applyRemainder(context, sessionId);
    if (remainder.kind === 'refused') {
      context.setResponse(this.buildErrorResponse(`❌ ${remainder.message}`));
      this.logExit({ remainder: 'refused' });
      return false;
    }

    if (!(await this.resolveInterrupt(context, sessionId, sessionContext, remainder))) {
      this.logExit({ interruptAction: 'refused' });
      return false;
    }

    await this.raiseInterrupt(context, sessionId, insertedThisCall);
    return true;
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
    const service = this.collaborators.gateEnhancementService;
    if (service === undefined || context.sessionContext === undefined) {
      return;
    }
    await service.ensurePostAdvanceReview(context, context.sessionContext);
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
  ): Promise<boolean> {
    const scopeOptions = context.getScopeOptions();
    const session = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (session === undefined) {
      return false;
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

    // Only an INSERTION is reported back, not any applied mutation: the caller uses this to
    // decide whether to raise the hard pause (D-2), and the pause point is the inserted
    // investigation node (OQ-1). A skip changes the plan without stopping it.
    return applied && decision.kind === 'insert_investigation';
  }

  /**
   * Hand this call's `remainder` to the processor, if it carried one (row 2.3).
   *
   * Thin: entitlement, IR validation and the store write all belong to {@link RemainderProcessor};
   * this method owns the session lookup and the absent-collaborator case. The processor is
   * optional so an `ExecutionContext`-less harness need not construct the Workflow IR port — and
   * absent, a submitted remainder is REFUSED rather than ignored. A silent drop here would be the
   * argument-allowlist failure again: typechecked at every layer, dead on the wire, and reported
   * as success.
   */
  private async applyRemainder(
    context: ExecutionContext,
    sessionId: string
  ): Promise<RemainderApplication> {
    const submission = context.mcpRequest.remainder;
    if (submission === undefined) {
      return { kind: 'none' };
    }
    const processor = this.collaborators.remainderProcessor;
    if (processor === undefined) {
      return {
        kind: 'refused',
        message: 'remainder refused: this server was built without remainder support.',
      };
    }
    const session = this.chainSessionStore.getSession(sessionId, context.getScopeOptions());
    if (session === undefined) {
      return { kind: 'refused', message: 'remainder refused: the run is no longer active.' };
    }
    return await processor.apply(sessionId, session, submission);
  }

  /**
   * Route an interrupt-resolution verb to the verdict processor and turn a refusal into the
   * tool-result error the submitter reads (row 2.2).
   *
   * @returns `false` when the pipeline must stop because a refusal response was set.
   */
  private async resolveInterrupt(
    context: ExecutionContext,
    sessionId: string,
    sessionContext: SessionContext,
    remainder: RemainderApplication
  ): Promise<boolean> {
    const action = context.mcpRequest.gate_action;
    if (!isInterruptResolutionAction(action)) {
      return true;
    }

    const resolution = await this.verdictProcessor.resolveUnknownInterrupt(
      context,
      sessionId,
      action,
      sessionContext,
      remainder.kind === 'applied'
    );

    if (resolution.kind === 'refused') {
      context.setResponse(this.buildErrorResponse(`❌ ${resolution.message}`));
      return false;
    }
    return true;
  }

  /**
   * Ask the interrupt policy what this run owes its caller, publish the answer on `context`,
   * and — when the run is holding — raise the synthetic review that stops it (row 2.1).
   *
   * Thin, like `applyMutation` beside it: the decision is `decideInterrupt`'s (pure, in
   * `decisions/mutation/`), the write is `ChainSessionStore`'s, the rendering is
   * `ResponseAssembler`'s. This method owns the translation and one judgement the pure module
   * cannot make — see `resolveEffectivePause`.
   *
   * The interrupt is put on `context.state.session` rather than mutated into any existing
   * structure, per the pipeline-state rule.
   */
  private async raiseInterrupt(
    context: ExecutionContext,
    sessionId: string,
    insertedThisCall: boolean
  ): Promise<void> {
    const scopeOptions = context.getScopeOptions();
    const session = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (session === undefined) {
      return;
    }

    const alreadyHolding = isUnknownInterruptPending(session.pendingGateReview);
    const interrupt = decideInterrupt({
      ledger: session.unknownsLedger ?? [],
      nodes: session.state.nodes,
      currentNodeId: session.state.currentNodeId,
      pauseOnBlocking: this.resolveEffectivePause(
        sessionId,
        scopeOptions,
        insertedThisCall,
        alreadyHolding
      ),
    });
    if (interrupt === undefined) {
      return;
    }

    context.state.session.chainInterrupt = interrupt;

    if (interrupt.paused && !alreadyHolding) {
      const review = buildUnknownInterruptReview(interrupt);
      await this.chainSessionStore.setPendingGateReview(sessionId, review);
      // Stage 18 skips step execution on a pending review, so the response is the interrupt
      // alone (D-2). It reads `sessionContext`, not the store, and `alignSessionContext` above
      // ran before this review existed — without this line the run holds in storage while this
      // call still renders the next step. Same two-write shape as the phase-guard stage.
      if (context.sessionContext !== undefined) {
        context.sessionContext = { ...context.sessionContext, pendingReview: review };
      }
    }

    context.diagnostics.info(this.name, 'Chain interrupt raised', {
      sessionId,
      unknownId: interrupt.unknownId,
      paused: interrupt.paused,
      affectedStepIds: interrupt.affectedStepIds.length,
    });
  }

  /**
   * Whether THIS call should leave the run holding on the synthetic review.
   *
   * `decideInterrupt` answers "is the run blocked", which is true on every step while an unknown
   * stays open. The PAUSE cannot follow that shape: re-raising it after the caller answered
   * would hold the run again on the next call, and the call after that, with no verb able to
   * clear it — a livelock, not a supervision knob.
   *
   * The pause is therefore bound to the two states where the run is genuinely stopped:
   *
   * - an insertion landed on THIS call — OQ-1's "the inserted investigation node IS the pause
   *   point". The insertion cap is one per unknown id, so this fires once per unknown, which is
   *   the granularity a supervised run wants;
   * - the synthetic review is ALREADY pending — the run is holding right now, so the payload
   *   must say `paused: true` rather than describing a soft interrupt.
   *
   * `gate_action: 'resume'` and `'accept_alternative'` carry no observations, so neither can
   * insert, and both clear the review before this runs (row 2.2) — which is precisely why
   * answering the interrupt lets the run continue while the unknown is still open.
   */
  private resolveEffectivePause(
    sessionId: string,
    scopeOptions: ReturnType<ExecutionContext['getScopeOptions']>,
    insertedThisCall: boolean,
    alreadyHolding: boolean
  ): boolean {
    if (!insertedThisCall && !alreadyHolding) {
      return false;
    }
    return resolveDeclaredPauseOnBlocking(
      this.chainSessionStore.getSessionBlueprint(sessionId, scopeOptions)
    );
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

/**
 * The synthetic review that holds a hard-paused run (D-2).
 *
 * Built here rather than in `decisions/` for the reason the phase-guard stage builds its own:
 * a `PendingGateReview` is a STORAGE record with a rendered `combinedPrompt`, and the pure
 * policy neither knows the run's identity nor renders text.
 *
 * `maxAttempts: 1` — this review is not a quality bar being retried; it is a hold with a fixed
 * set of exits, and an attempt counter would render "(attempt 1/3)" on a prompt that has no
 * second attempt. `prompts: []` for the same reason: there is no gate criterion to display, and
 * the resolution vocabulary is rendered by `ResponseAssembler` from the interrupt itself, which
 * is the one place it can name the affected steps and the remaining plan.
 */
function buildUnknownInterruptReview(interrupt: ChainInterrupt): PendingGateReview {
  return {
    combinedPrompt: `A blocking unknown stopped this run: ${interrupt.statement}`,
    gateIds: [UNKNOWN_INTERRUPT_GATE_ID],
    prompts: [],
    createdAt: Date.now(),
    attemptCount: 0,
    maxAttempts: 1,
    metadata: {
      source: 'unknown-interrupt',
      unknownId: interrupt.unknownId,
      affectedStepIds: interrupt.affectedStepIds,
    },
  };
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
