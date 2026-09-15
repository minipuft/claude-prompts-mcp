// @lifecycle canonical - Runs post-execution gate review workflows.
import { deriveGateTier } from '../../../gates/core/gate-tier.js';
import { resolveJudgeGates, composeJudgeReviewPrompt } from '../../../gates/core/review-utils.js';
import {
  formatGateScriptToolSection,
  runGateScriptToolVerifications,
} from '../../../gates/services/gate-script-tool-runner.js';
import { runGateShellVerifications } from '../../../gates/services/gate-shell-verify-runner.js';
import { formatGateShellVerifySection } from '../../../gates/shell/shell-verify-message-formatter.js';
import { planNodeDrivenRender } from '../../operators/node-step-projection.js';
import { resolveGroundTruthCoverage } from '../decisions/gates/ground-truth-coverage.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { ExecutionRecordStore } from '#modules/chains/execution-record-store.js';
import type {
  GateCheckResult,
  PendingGateReview,
  PendingGateTier,
} from '#shared/types/chain-execution.js';
import type { GatesConfig } from '#shared/types/core-config.js';
import type { ChainSessionService } from '#shared/types/index.js';
import type { GateDefinitionProvider } from '../../../gates/core/gate-loader.js';
import type { GateScriptToolResult } from '../../../gates/services/gate-script-tool-runner.js';
import type { ScriptToolRuntimeProvider } from '../../../gates/services/script-tool-criterion-runner.js';
import type { ShellVerifyExecutor } from '../../../gates/shell/shell-verify-executor.js';
import type { GateShellVerifyResult } from '../../../gates/shell/shell-verify-message-formatter.js';
import type { ExecutionContext } from '../../context/index.js';
import type { ChainOperatorExecutor } from '../../operators/chain-operator-executor.js';

type GatesConfigProvider = () => GatesConfig | undefined;

/** One line, capped, so a recorded result stays readable in a refusal sentence. */
const CHECK_SUMMARY_MAX_CHARS = 200;

/** Collapse to a single line and cap — a summary is quoted back to the submitter verbatim. */
function toSummaryLine(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > CHECK_SUMMARY_MAX_CHARS
    ? `${oneLine.slice(0, CHECK_SUMMARY_MAX_CHARS - 1)}…`
    : oneLine;
}

/**
 * Flatten both runner result shapes into the one thing the verdict processor needs: which gate,
 * did it pass, and one line naming what ran.
 *
 * Mechanism-agnostic on purpose, exactly as `resolveGroundTruthCoverage` beside it is: the
 * processor's refusal does not care whether an exit code or a script verdict produced the
 * failure, only that the engine recorded one.
 */
function toCheckResults(
  shellResults: readonly GateShellVerifyResult[],
  scriptResults: readonly GateScriptToolResult[]
): GateCheckResult[] {
  return [
    ...shellResults.map((result) => ({
      gateId: result.gateId,
      passed: result.passed,
      summary: toSummaryLine(`${result.command} exit ${result.exitCode}`),
    })),
    ...scriptResults.map((result) => ({
      gateId: result.gateId,
      passed: result.passed,
      summary: toSummaryLine(`${result.toolId ?? 'script_tool'}: ${result.reason}`),
    })),
  ];
}

/** Optional collaborators for {@link GateReviewStage}. */
export interface GateReviewCollaborators {
  /**
   * Ledger writer for the one step this stage renders that StepExecutionStage never does.
   * Optional, matching stages 18 and 21: absent, the render still happens, just unledgered.
   */
  executionRecordStore?: ExecutionRecordStore | null;
  /**
   * Registry + executor for `script_tool` criteria. Read through a provider because the
   * workspace script loader is rebuilt on every prompt reload. Absent, `script_tool`
   * criteria fail closed and say so — never silently skip, which is the defect that left
   * this whole criteria type inert.
   */
  scriptToolRuntime?: ScriptToolRuntimeProvider;
  /**
   * Executor for `shell_verify` criteria. The SAME instance the inline
   * `:: verify:` path uses, so the gate master switch and the operator allowlist
   * it carries govern both. Absent, criteria FAIL CLOSED and say so — never
   * silently skip, which is the defect that left `script_tool` inert and which a
   * first cut of this wiring reintroduced here.
   */
  shellVerifyExecutor?: ShellVerifyExecutor;
}

/**
 * Name the mechanism(s) that cleared a review.
 *
 * Recorded in gate-review metadata, so a reader can tell an exit-code clearance from a
 * structured-verdict one without re-deriving it from the gate definitions.
 */
function verifiedByLabel(ranShell: boolean, ranScriptTool: boolean): string {
  if (ranShell && ranScriptTool) return 'shell_verify+script_tool';
  return ranScriptTool ? 'script_tool' : 'shell_verify';
}

/**
 * Pipeline Stage 20: Gate Review Rendering
 *
 * Renders synthetic gate review steps when a session has a pending review.
 * When gates declare ground-truth criteria — `shell_verify` (exit codes) or `script_tool`
 * (a registered tool returning a structured verdict) — runs them and enriches the review
 * feedback with real output instead of generic "review your work".
 *
 * This stage is the ONLY live consumer of `pass_criteria`. A criteria type it does not
 * handle is not merely unenforced, it is silently unenforced, which is why the two
 * runners are called unconditionally and report an unrunnable check as failed.
 */
export class GateReviewStage extends BasePipelineStage {
  readonly name = 'GateReview';

  constructor(
    private readonly chainOperatorExecutor: ChainOperatorExecutor,
    private readonly chainSessionStore: ChainSessionService,
    private readonly gateDefinitionProvider: GateDefinitionProvider | null,
    logger: Logger,
    private readonly gatesConfigProvider?: GatesConfigProvider,
    /**
     * Optional collaborators, grouped rather than appended. The stage carries the four it
     * cannot work without plus the config provider; every further positional argument makes
     * each call site harder to read than the one before, and a `null` in slot six tells a
     * reader nothing about which collaborator it is. Matches `ChainOperatorCollaborators`.
     */
    private readonly collaborators: GateReviewCollaborators = {}
  ) {
    super(logger);
  }

  /**
   * Ledger the first step of a run that this stage — not StepExecutionStage — rendered.
   *
   * OQ6 trace result. On a gated chain the start call creates the pending review in
   * SessionManagementStage, so StepExecutionStage takes its `pendingReview` early exit and its
   * `working` append never runs; THIS stage renders step 1 instead, and appended nothing. Every
   * later step is rendered by stage 18 on the call that clears the previous review, so exactly
   * one row was missing per run — the measured `planned 3 / executed 2`.
   *
   * Scoped to the run-creating call for that reason: on any resume the current step already has
   * a row from stage 18, and appending again would add a duplicate `working` row per gate retry.
   */
  private ledgerFirstRenderedStep(context: ExecutionContext): void {
    if (this.collaborators.executionRecordStore == null) return;

    const decision = context.state.session.lifecycleDecision;
    if (decision !== 'create-new' && decision !== 'create-force-restart') return;

    const session = context.sessionContext;
    if (session === undefined) return;

    const steps = context.parsedCommand?.steps;
    const currentNodeId = session.currentNodeId ?? undefined;
    const stepNumber = session.currentStep ?? 1;
    const step =
      (currentNodeId !== undefined ? steps?.find((s) => s.nodeId === currentNodeId) : undefined) ??
      steps?.find((s) => s.stepNumber === stepNumber);

    const renderedAt = Date.now();
    this.collaborators.executionRecordStore.append({
      sessionId: session.sessionId,
      ...(session.chainId !== undefined ? { chainId: session.chainId } : {}),
      stepNumber,
      // Prefer the id on the resolved step over the session's, for the same reason stage 18
      // does: the step object is what this stage rendered. Falls back to the session's node id,
      // then to nothing — this stage resolves its step by either key already.
      ...(step?.nodeId !== undefined
        ? { nodeId: step.nodeId }
        : currentNodeId !== undefined
          ? { nodeId: currentNodeId }
          : {}),
      ...(step?.promptId !== undefined ? { promptId: step.promptId } : {}),
      status: 'working',
      substate: { renderedAt },
      startedAt: renderedAt,
      scope: context.getScopeOptions(),
    });
  }

  /**
   * Write this call's ground-truth evidence onto the pending review and return the stored shape.
   *
   * Two fields, one write:
   *
   * - `checkResults` — what the runners just produced. Omitted entirely when nothing ran, so a
   *   review whose gates are all reminders records nothing and the processor has nothing to
   *   refuse on, which is the intended reading of ruling B4.
   * - `gateTiers` — each gate's tier by `deriveGateTier`. The formatting layer needs it and has
   *   no synchronous reach to gate definitions (`ResponseAssembler` takes no gate provider), and
   *   this stage is already the one holding the provider. Recorded even when NO check ran,
   *   because that is precisely the all-reminder review whose verdict template must carry no
   *   `per_gate` block at all.
   *
   * Everything else on the review is carried through untouched: the store persists what it is
   * handed, so a field dropped here is a field deleted from the session.
   */
  private async recordReviewEvidence(
    sessionId: string,
    review: PendingGateReview,
    checkResults: GateCheckResult[]
  ): Promise<PendingGateReview> {
    const gateTiers = await this.deriveGateTiers(review.gateIds);

    if (checkResults.length === 0 && Object.keys(gateTiers).length === 0) {
      return review;
    }

    const enriched: PendingGateReview = {
      ...review,
      ...(checkResults.length > 0 ? { checkResults } : {}),
      ...(Object.keys(gateTiers).length > 0 ? { gateTiers } : {}),
    };
    await this.chainSessionStore.setPendingGateReview(sessionId, enriched);
    return enriched;
  }

  /**
   * Tier per gate id, from the same derivation the gate index prints (`deriveGateTier`).
   *
   * A gate the provider cannot load contributes no entry rather than a guessed one — readers
   * treat a missing id as `check`, which keeps an unloadable gate attestable instead of
   * silently demoting it to a reminder nobody grades.
   */
  private async deriveGateTiers(gateIds: string[]): Promise<Record<string, PendingGateTier>> {
    if (!this.gateDefinitionProvider || gateIds.length === 0) return {};

    try {
      const definitions = await this.gateDefinitionProvider.loadGates(gateIds);
      const tiers: Record<string, PendingGateTier> = {};
      for (const definition of definitions) {
        tiers[definition.id] = deriveGateTier(definition);
      }
      return tiers;
    } catch (error) {
      this.logger.warn('[GateReview] Failed to derive gate tiers for pending review', {
        gateIds,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const sessionId = context.sessionContext?.sessionId;
    if (!sessionId || !context.sessionContext?.pendingReview) {
      this.logExit({ skipped: 'No pending gate review' });
      return;
    }

    const steps = context.parsedCommand?.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      this.logExit({ skipped: 'No chain steps available for gate review rendering' });
      return;
    }

    const pendingReview = this.chainSessionStore.getPendingGateReview(sessionId);
    if (!pendingReview) {
      this.logExit({ skipped: 'Pending gate review missing from session manager' });
      return;
    }

    context.sessionContext = context.sessionContext
      ? {
          ...context.sessionContext,
          pendingReview,
        }
      : context.sessionContext;

    // The review handed to the renderer below. Reassigned once, when this stage records check
    // results onto it (ruling B4) — the store copy and the context copy must be the same object
    // or the assembler renders a template built from stale evidence in the very same call.
    let reviewForRender: PendingGateReview = pendingReview;

    try {
      // Run shell_verify criteria from gates to enrich review with real command output.
      // The agent's response is forwarded so gates that opt in via
      // `shell_stdin_source: 'agent_response'` can verify response-content claims
      // (file paths, line numbers, symbols) against ground truth.
      let shellSection = '';
      if (this.gateDefinitionProvider && pendingReview.gateIds.length > 0) {
        const agentResponse = context.mcpRequest?.user_response;
        const shellResults = await runGateShellVerifications(
          pendingReview.gateIds,
          this.gateDefinitionProvider,
          agentResponse !== undefined ? { agentResponse } : undefined,
          this.collaborators.shellVerifyExecutor
        );
        // `script_tool` criteria run beside `shell_verify` rather than instead of it: a gate
        // may declare both, and the two answer different questions — an exit code versus a
        // structured verdict the script can explain. Neither substitutes for the other, so a
        // failing check of either kind blocks, and coverage requires every required gate to
        // have been verified by SOMETHING.
        const scriptResults = await runGateScriptToolVerifications(
          pendingReview.gateIds,
          this.gateDefinitionProvider,
          this.collaborators.scriptToolRuntime?.()
        );
        shellSection = [
          formatGateShellVerifySection(shellResults),
          formatGateScriptToolSection(scriptResults),
        ]
          .filter((section) => section !== '')
          .join('\n\n');

        // Whether ground truth clears the review is a gate-enforcement decision, so the
        // authority makes it. The stage keeps what only it can do: running the commands
        // above, writing the result, and returning early.
        //
        // The decision reads only `gateId` and `passed`, so it is mechanism-agnostic and
        // both result kinds feed it unchanged.
        const coverage = resolveGroundTruthCoverage({
          requiredGateIds: pendingReview.gateIds,
          results: [...shellResults, ...scriptResults],
          priorVerifiedGateIds: context.state.gates.shellVerifyPassedForGates ?? [],
        });

        if (coverage.satisfied) {
          await this.chainSessionStore.clearPendingGateReview(sessionId);

          context.executionResults = {
            content: shellSection,
            metadata: {
              gateReview: {
                gateIds: pendingReview.gateIds,
                attemptCount: pendingReview.attemptCount,
                maxAttempts: pendingReview.maxAttempts,
                autoCleared: true,
                verifiedBy: verifiedByLabel(shellResults.length > 0, scriptResults.length > 0),
              },
            },
            generatedAt: Date.now(),
          };

          // Same gap on the early-exit path: this call still consumed the run's first step
          // without stage 18 ever rendering it, so the row is owed here too.
          this.ledgerFirstRenderedStep(context);

          context.diagnostics.info(this.name, 'Gate review auto-cleared by shell verification', {
            sessionId,
            verifiedGates: coverage.verifiedGateIds,
          });
          this.logExit({ autoCleared: true, verifiedGates: coverage.verifiedGateIds });
          return;
        }

        context.diagnostics.info(this.name, 'Gate review not cleared by shell verification', {
          sessionId,
          reason: coverage.reason,
        });

        // Coverage did NOT clear the review, so the model gets a verdict to submit — and from
        // here on the engine's own results are the only thing that can outrank it. Recorded on
        // the review rather than left in this call's context: the verdict arrives on a LATER
        // request, where this context no longer exists (ruling B4).
        reviewForRender = await this.recordReviewEvidence(
          sessionId,
          pendingReview,
          toCheckResults(shellResults, scriptResults)
        );
        if (context.sessionContext !== undefined) {
          context.sessionContext = { ...context.sessionContext, pendingReview: reviewForRender };
        }
      }

      const chainContext = this.chainSessionStore.getChainContext(
        sessionId,
        context.getScopeOptions()
      );
      // Node-driven, for the same reason stage 18 is (P4 row 3.4 / DEV-T3-7). The review body is
      // the reviewed step's own template, and `resolveReviewStep` locates it with the ordinal
      // `getChainContext` publishes — which counts the RUN's nodes. Handing it the parse-time
      // array put the two on different scales the moment a node was inserted, so a review opened
      // on a step after an insertion quoted the NEXT step's task back to the client.
      const run = this.chainSessionStore.getSession(sessionId, context.getScopeOptions());
      const reviewSteps = planNodeDrivenRender({
        nodes: run?.state.nodes ?? [],
        parseSteps: steps,
        currentNodeId: run?.state.currentNodeId ?? context.sessionContext.currentNodeId,
        fallbackOrdinal: context.sessionContext.currentStep ?? 1,
        ledger: run?.unknownsLedger,
      }).steps;
      const renderResult = await this.chainOperatorExecutor.renderStep({
        executionType: 'gate_review',
        stepPrompts: reviewSteps,
        chainContext,
        pendingGateReview: reviewForRender,
        additionalGateIds: reviewForRender.gateIds,
      });

      // Resolve judge gates and compose context-isolated prompt if any gates use judge mode
      let judgeMetadata: Record<string, unknown> | undefined;
      if (this.gateDefinitionProvider && pendingReview.gateIds.length > 0) {
        const gatesConfig = this.gatesConfigProvider?.();
        const { judgeGates } = await resolveJudgeGates(
          pendingReview.gateIds,
          this.gateDefinitionProvider,
          gatesConfig?.evaluation
        );
        if (judgeGates.length > 0) {
          const output = renderResult.content;
          const judgeResult = composeJudgeReviewPrompt(judgeGates, output);
          judgeMetadata = {
            judgePrompt: judgeResult.judgePrompt,
            judgeGateIds: judgeResult.judgeGateIds,
            modelHint: judgeResult.modelHint,
          };
        }
      }

      context.executionResults = {
        content: shellSection ? `${renderResult.content}\n\n${shellSection}` : renderResult.content,
        metadata: {
          stepNumber: renderResult.stepNumber,
          totalSteps: renderResult.totalSteps,
          promptId: renderResult.promptId,
          promptName: renderResult.promptName,
          callToAction: renderResult.callToAction,
          gateReview: {
            gateIds: pendingReview.gateIds,
            attemptCount: pendingReview.attemptCount,
            maxAttempts: pendingReview.maxAttempts,
          },
          ...(judgeMetadata ? { judge: judgeMetadata } : {}),
        },
        generatedAt: Date.now(),
      };

      this.ledgerFirstRenderedStep(context);

      // Record diagnostic for gate review rendering
      context.diagnostics.info(this.name, 'Gate review step rendered', {
        sessionId,
        gateIds: pendingReview.gateIds,
        attemptCount: pendingReview.attemptCount,
        maxAttempts: pendingReview.maxAttempts,
        contentLength: renderResult.content.length,
      });

      this.logExit({
        renderedGateReview: true,
        gateCount: pendingReview.gateIds.length,
        attemptCount: pendingReview.attemptCount,
      });
    } catch (error) {
      this.handleError(error, 'Failed to render gate review step');
    }
  }
}
