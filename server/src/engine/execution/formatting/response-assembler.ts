// @lifecycle canonical - Assembles response content for pipeline formatting stage.
import { SHELL_VERIFY_DEFAULT_MAX_ITERATIONS } from '../../gates/shell/types.js';
import { DelegationRenderer } from '../delegation/renderer.js';
import { getHandoffFooterInstruction } from '../delegation/strategy.js';
import { PHASE_GUARD_GATE_ID } from '../pipeline/stages/19-phase-guard-verification-stage.js';

import type { DeclaredSection } from '#engine/frameworks/declared-sections.js';
import type { RunStepView, RunStepViewProvider } from '#engine/gates/services/run-step-view.js';
import type { GateReviewPrompt } from '#shared/types/chain-execution.js';
import type { RequestClientProfile } from '#shared/types/request-identity.js';
import type {
  ChainFormattingContext,
  SinglePromptFormattingContext,
} from './formatting-context.js';
import type { ExecutionContext } from '../context/index.js';
import type { DelegationPayload } from '../delegation/types.js';
import type { GateOperator } from '../parsers/types/operator-types.js';
import type { ConvertedPrompt, ExecutionModifiers } from '../types.js';

/** Max gates to list in the GATE_VERDICTS template */
const MAX_GATE_VERDICT_ENTRIES = 10;

/**
 * Assembles response content sections for different execution types.
 *
 * Handles chain responses (with footers, gate instructions, advisory warnings),
 * single prompt responses, blocked responses, script confirmations, validation
 * errors, gate validation info, and legacy footer building.
 *
 * Extracted from ResponseFormattingStage.
 */
export class ResponseAssembler {
  /**
   * @param runStepViewProvider The live run's node order and retired-node list (P6 Tier 2).
   *   Optional, and absent means "answer from the parse array alone" — the pre-P6 behavior,
   *   byte-identical. The same narrow-view + provider seam the gate layer uses
   *   (`GateEnhancementService`, `TemporaryGateRegistrar`): the assembler needs two facts about
   *   the run, not a session store, so the dependency stays a function type.
   * @param declaredSectionsProvider Phase-guard section headers a framework declares, from
   *   `declared-sections.ts` — the same source `19-phase-guard-verification-stage` grades the
   *   response against (Tier 2.5, OQ-1). A function type, matching the seam above: this
   *   assembler needs one derived fact, not framework-manager access. Absent means "declare
   *   nothing", the pre-Tier-2 behavior for single-prompt execution.
   */
  constructor(
    private readonly runStepViewProvider?: RunStepViewProvider,
    private readonly declaredSectionsProvider?: (frameworkId: string) => DeclaredSection[]
  ) {}

  /**
   * Formats response for chain execution with session tracking.
   */
  formatChainResponse(
    context: ExecutionContext,
    _formatterContext: ChainFormattingContext
  ): string {
    const sections: string[] = [];
    const gateActive = !this.isGateContentSuppressed(context);

    sections.push(this.extractBaseContent(context));

    const confirmationRequired = context.state.scripts?.confirmationRequired;
    if (confirmationRequired) {
      sections.push(this.formatConfirmationRequest(confirmationRequired));
    }

    const validationErrors = context.state.scripts?.validationErrors;
    if (validationErrors && validationErrors.length > 0) {
      sections.push(this.formatValidationErrors(validationErrors));
    }

    if (gateActive && this.isGateGuidanceInjectionEnabled(context) && context.gateInstructions) {
      sections.push(context.gateInstructions);
    }

    if (gateActive) {
      const advisoryWarnings = context.state.gates.advisoryWarnings;
      if (advisoryWarnings && advisoryWarnings.length > 0) {
        sections.push('\n---\n**Advisory Gate Warnings:**');
        advisoryWarnings.forEach((warning) => sections.push(`- ${warning}`));
      }
    }

    // Gate review CTA (only when gate content active) or final completion
    const gateReviewCTA = gateActive ? this.buildGateReviewCTA(context) : null;
    if (gateReviewCTA != null) {
      sections.push(gateReviewCTA);
    } else {
      const finalMessage = this.buildFinalStepMessage(context);
      if (finalMessage != null) {
        sections.push(finalMessage);
      }
    }

    // Operator layer: inject handoff CTA when next step is delegated.
    // Detects from StepExecutionStage metadata OR parsed steps (when pendingReview blocked StepExecutionStage).
    if (this.isNextStepDelegated(context)) {
      const handoffCTA = this.buildHandoffSection(context);
      if (handoffCTA != null) {
        sections.push(handoffCTA);
      }
    }

    const footer = this.buildChainFooter(context);
    if (footer) {
      sections.push(footer);
    }

    return sections.join('\n\n');
  }

  /**
   * Formats response for single prompt execution.
   */
  formatSinglePromptResponse(
    context: ExecutionContext,
    _formatterContext: SinglePromptFormattingContext
  ): string {
    const sections: string[] = [];
    const gateActive = !this.isGateContentSuppressed(context);

    sections.push(this.extractBaseContent(context));

    const confirmationRequired = context.state.scripts?.confirmationRequired;
    if (confirmationRequired) {
      sections.push(this.formatConfirmationRequest(confirmationRequired));
    }

    const validationErrors = context.state.scripts?.validationErrors;
    if (validationErrors && validationErrors.length > 0) {
      sections.push(this.formatValidationErrors(validationErrors));
    }

    if (gateActive && this.isGateGuidanceInjectionEnabled(context) && context.gateInstructions) {
      sections.push(context.gateInstructions);
    }

    if (gateActive) {
      const advisoryWarnings = context.state.gates.advisoryWarnings;
      if (advisoryWarnings && advisoryWarnings.length > 0) {
        sections.push('\n---\n**Advisory Gate Warnings:**');
        advisoryWarnings.forEach((warning) => sections.push(`- ${warning}`));
      }
    }

    // Declared section headers (Tier 2.5, OQ-1) — same block the chain path renders via
    // buildResponseFormatSection. A gated single prompt (explicit `gates`, a `gate` operator, or
    // `chainSteps`) gets a session and reaches stage 19 phase-guard verification
    // (`execution-planner.ts:427-450`), so it must be told the same header vocabulary the guard
    // grades it against — otherwise it is blocked on a contract it was never shown.
    const declaredSectionsBlock = this.buildDeclaredSectionsBlock(context);
    if (declaredSectionsBlock) {
      sections.push(declaredSectionsBlock);
    }

    const nextAction = this.buildNextActionCTA(context, gateActive);
    if (nextAction) {
      sections.push(nextAction);
    }

    return sections.join('\n\n');
  }

  /**
   * Formats a blocked response when gate failure suppresses content.
   */
  formatBlockedResponse(context: ExecutionContext): string {
    const blockedGateIds = context.state.gates.blockedGateIds ?? [];
    const gateInstructions = context.gateInstructions ?? '';

    const sections: string[] = [
      '## ⛔ Response Blocked',
      '',
      'Response content has been suppressed due to gate failure.',
      '',
      `**Blocking gates**: ${blockedGateIds.length > 0 ? blockedGateIds.join(', ') : 'unknown'}`,
      '',
    ];

    if (gateInstructions !== '') {
      sections.push('---');
      sections.push('');
      sections.push(gateInstructions);
    }

    sections.push('');
    sections.push('---');
    sections.push('');
    sections.push('**To proceed**: Address the gate criteria and resubmit with `gate_verdict`.');

    const chainId = context.sessionContext?.chainId;
    if (chainId !== undefined && chainId !== '') {
      sections.push('');
      sections.push(
        `Resume: \`chain_id="${chainId}", gate_verdict="GATE_REVIEW: PASS|FAIL - <reason>"\``
      );
    }

    return sections.join('\n');
  }

  /**
   * Builds GateValidationInfo for structured response contract.
   */
  buildGateValidationInfo(context: ExecutionContext):
    | {
        enabled: boolean;
        passed: boolean;
        totalGates: number;
        failedGates: Array<{ id: string; reason: string }>;
        executionTime: number;
        pendingGateIds: string[];
        requiresGateVerdict: boolean;
        responseBlocked: boolean;
        gateRetryInfo: { maxAttempts: number; currentAttempt: number; retryAllowed: boolean };
      }
    | undefined {
    const gateIds = context.gates.getAll();
    if (gateIds.length === 0) {
      return undefined;
    }

    if (this.isGateContentSuppressed(context)) {
      return undefined;
    }

    const hasPendingReview = context.hasPendingReview();
    const responseBlocked = context.state.gates.responseBlocked === true;
    const blockedGateIds = context.state.gates.blockedGateIds ?? [];
    const retryLimitExceeded = context.state.gates.retryLimitExceeded === true;

    const failedGates: Array<{ id: string; reason: string }> = blockedGateIds.map((id) => ({
      id,
      reason: 'Gate failed (blockResponseOnFail enabled)',
    }));

    const sessionRetryInfo = context.sessionContext?.pendingReview;
    const gateRetryInfo = {
      maxAttempts: sessionRetryInfo?.maxAttempts ?? 2,
      currentAttempt: sessionRetryInfo?.attemptCount ?? 0,
      retryAllowed: !retryLimitExceeded,
    };

    return {
      enabled: true,
      passed: failedGates.length === 0 && !hasPendingReview,
      totalGates: gateIds.length,
      failedGates,
      executionTime: 0,
      pendingGateIds: hasPendingReview ? [...blockedGateIds] : [],
      requiresGateVerdict: hasPendingReview,
      responseBlocked,
      gateRetryInfo,
    };
  }

  /**
   * The run-completion latch, as the pipeline recorded it.
   *
   * Single reader of `state.session.chainComplete` for footer purposes so the progress line and
   * the CTA line cannot disagree — they were two independent `currentStep >= totalSteps`
   * computations before.
   */
  private isRunLatchedComplete(context: ExecutionContext): boolean {
    return context.state.session.chainComplete === true;
  }

  /**
   * Builds chain footer with session and progress tracking.
   */
  buildChainFooter(context: ExecutionContext): string {
    const lines: string[] = [];
    const sessionContext = context.sessionContext!;
    const chainIdentifier = sessionContext.chainId ?? sessionContext.sessionId;
    lines.push(`Chain: ${chainIdentifier}`);

    const hasPendingReview = context.hasPendingReview();

    // Completion is the LATCHED run fact (StepExecutionStage sets it from the store's
    // runStatus), not `currentStep >= totalSteps`. Those two differ on exactly one state —
    // the run standing on its final step with work still owed — and reading the ordinal there
    // printed "✓ Chain complete (N/N) · No user_response needed" while the run was still
    // `working`, so a client that obeyed the banner never sent the call that finished it.
    const isComplete = this.isRunLatchedComplete(context);

    if (sessionContext.currentStep && sessionContext.totalSteps) {
      const normalizedStep = Math.min(sessionContext.currentStep, sessionContext.totalSteps);
      const progress = `${normalizedStep}/${sessionContext.totalSteps}`;
      const onFinalStep = normalizedStep === sessionContext.totalSteps;
      if (isComplete) {
        lines.push(`✓ Chain complete (${progress})`);
      } else if (onFinalStep && hasPendingReview) {
        // The one state whose text changes: still the final step, still owing a verdict.
        // "step N/N" keeps the downstream step-indicator regexes matching (hooks/lib
        // /session_state.py and the opencode mirror both key on step|progress + N/N).
        lines.push(`→ Final step ${progress} — awaiting gate verdict`);
      } else {
        lines.push(`→ Progress ${progress}`);
      }
    }

    // Handoff footer requires the CURRENT step's brief to be IN this response (S7) — a
    // `nextStepDelegated`-only response carries the one-line advisory, not a handoff, so it
    // falls through to the normal resume/gate-review lines below.
    const currentStepDelegated = this.isCurrentStepDelegated(context);

    if (currentStepDelegated) {
      // Handoff takes priority — gate enforcement passes to sub-agent
      lines.push(this.buildHandoffFooterLine(context, chainIdentifier));
    } else if (hasPendingReview) {
      // Gate review (only when not delegating)
      lines.push(
        `Next: chain_id="${chainIdentifier}", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"`
      );
    } else if (sessionContext.currentStep && sessionContext.totalSteps) {
      if (isComplete) {
        lines.push('Next: Chain complete. No user_response needed.');
      } else {
        lines.push(`Next: chain_id="${chainIdentifier}", user_response="<your step output>"`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Builds the NEXT-step delegation advisory via DelegationRenderer (S7). Used to render a full
   * envelope-bearing handoff here; that handoff was phase-shifted — it described the NEXT step
   * while pointing "content above" at the CURRENT step's response. The authoritative handoff
   * (brief + envelope) now renders in ChainOperatorExecutor, in the same response as the
   * delegated step's own content (`buildCurrentStepHandoff`). This method only builds the
   * payload identifying that next step and emits the one-line advisory pointing at it.
   *
   * Resolves the advisory's step identity from the parse-time step the run actually hands off
   * to (`findNextDelegatedStep`), falling back to StepExecutionStage metadata only when no
   * parse-time view exists. Metadata is the LAST resort, not the first (S10): on a gate-review
   * response the metadata names the SYNTHETIC review step (`promptId: '__gate_review__'`,
   * `stepNumber: totalSteps + 1`), so reading it first emitted "Step 4 ("Quality Gate
   * Validation") is delegated" for a 2-step chain — the synthetic step's coordinates must never
   * reach the advisory.
   */
  private buildHandoffSection(context: ExecutionContext): string | null {
    const metadata = context.executionResults?.metadata ?? {};

    const nextStep = this.findNextDelegatedStep(context);
    const parsedNext =
      nextStep !== undefined ? context.parsedCommand?.steps?.[nextStep.index] : undefined;

    // Real delegated-step identity when the parse-time view has it; metadata-derived offset
    // (`current + 1`) only when it does not (e.g. a normal render whose parsed steps are not
    // on the context — pinned by the metadata-path test).
    const fallbackStepNumber =
      ((metadata['stepNumber'] as number | undefined) ?? context.sessionContext?.currentStep ?? 0) +
      1;
    const stepNumber = parsedNext?.stepNumber ?? fallbackStepNumber;
    const totalSteps =
      parsedNext !== undefined
        ? (context.parsedCommand?.steps?.length ?? 0)
        : ((metadata['totalSteps'] as number | undefined) ??
          context.sessionContext?.totalSteps ??
          0);
    const parsedNextName = parsedNext?.convertedPrompt?.name;
    const promptName =
      parsedNext !== undefined
        ? parsedNextName != null && parsedNextName.trim().length > 0
          ? parsedNextName
          : parsedNext.promptId
        : String(metadata['promptName'] ?? this.resolveNextStepPromptName(context) ?? 'next-step');
    const agentType = nextStep?.agentType ?? 'chain-executor';
    const subagentModel = nextStep?.subagentModel;

    const gateCount = context.gates.getAll().length;
    const clientProfile = this.resolveClientProfile(context);
    const renderer = new DelegationRenderer();
    const payload: DelegationPayload = {
      stepNumber,
      totalSteps,
      promptName,
      agentType,
      ...(clientProfile != null ? { clientProfile } : {}),
      ...(subagentModel != null ? { subagentModel } : {}),
      gateCount,
      hasGates: gateCount > 0,
    };
    return renderer.renderNextStepAdvisory(payload);
  }

  private resolveClientProfile(context: ExecutionContext): RequestClientProfile | undefined {
    const identityContext = context.state.identity.context;
    return identityContext?.clientProfile ?? identityContext?.identity.clientProfile;
  }

  private buildHandoffFooterLine(context: ExecutionContext, chainIdentifier: string): string {
    const delegationProfile = this.resolveClientProfile(context)?.delegationProfile;
    const prefix = getHandoffFooterInstruction(delegationProfile);
    return `Next: ${prefix} (see instructions above), then: chain_id="${chainIdentifier}", user_response="<sub-agent result>"`;
  }

  /**
   * Formats script tool confirmation request for user approval.
   */
  formatConfirmationRequest(
    confirmation: NonNullable<
      typeof ExecutionContext.prototype.state.scripts
    >['confirmationRequired']
  ): string {
    if (!confirmation) return '';

    const sections: string[] = [];

    for (const tool of confirmation.tools) {
      const lines: string[] = [`⚠️ **Tool Confirmation**: \`${tool.toolId}\``];

      if (tool.message) {
        lines.push(`> ${tool.message}`);
      }

      if (tool.matchedParams && tool.matchedParams.length > 0) {
        lines.push(`**Detected parameters:** ${tool.matchedParams.join(', ')}`);
      }

      if (tool.extractedInputs && Object.keys(tool.extractedInputs).length > 0) {
        const summary = this.formatExtractedInputsSummary(tool.extractedInputs);
        lines.push(`**Values:** ${summary}`);
      }

      lines.push(`→ To proceed: \`${tool.resumeCommand}\``);
      sections.push(lines.join('\n'));
    }

    return sections.join('\n\n');
  }

  /**
   * Formats validation errors from script tool validation.
   */
  formatValidationErrors(errors: string[]): string {
    const lines: string[] = [
      '\n---',
      '## ❌ Validation Failed',
      '',
      'The following validation errors prevented auto-execution:',
      '',
    ];

    for (const error of errors) {
      lines.push(`- ${error}`);
    }

    lines.push('');
    lines.push('**Fix the issues above** and try again with updated parameters.');

    return lines.join('\n');
  }

  /**
   * Detects whether the next step is delegated.
   * Checks StepExecutionStage metadata first, falls back to parsed step `delegated` flag
   * (always available from CommandParsingStage, even when pendingReview blocked StepExecutionStage).
   */
  private isNextStepDelegated(context: ExecutionContext): boolean {
    const metadata = context.executionResults?.metadata ?? {};
    if (metadata['nextStepDelegated'] === true) {
      return true;
    }
    return this.findNextDelegatedStep(context) !== undefined;
  }

  /**
   * Detects whether the CURRENT step (the one whose content is in this response) is delegated
   * — i.e. whether ChainOperatorExecutor rendered it as a self-contained EXECUTION BRIEF (R-1).
   * No parsed-steps fallback: unlike `nextStepDelegated`, this flag only exists once
   * `renderStep` has actually run and stamped `currentStepDelegated` on the render result — there
   * is no earlier parse-time signal to fall back to.
   */
  private isCurrentStepDelegated(context: ExecutionContext): boolean {
    const metadata = context.executionResults?.metadata ?? {};
    return metadata['currentStepDelegated'] === true;
  }

  /**
   * Finds the parse-time step the run hands off to next, when that step is `delegated: true`.
   * Returns undefined if no delegation is found.
   */
  private findNextDelegatedStep(
    context: ExecutionContext
  ): { promptId: string; agentType?: string; subagentModel?: string; index: number } | undefined {
    const steps = context.parsedCommand?.steps;
    if (!steps || steps.length === 0) {
      return undefined;
    }
    const nextIndex = this.resolveNextStepIndex(context, steps);
    const nextStep = nextIndex === undefined ? undefined : steps[nextIndex];
    if (nextIndex !== undefined && nextStep?.delegated === true) {
      return {
        promptId: nextStep.promptId,
        agentType: nextStep.agentType,
        subagentModel: nextStep.subagentModel,
        // Carried so the P5 visibility decision for the handed-off step can be resolved from
        // the same lookup that found it — recomputing the index elsewhere would give the
        // node-id/ordinal fallback two implementations that could disagree.
        index: nextIndex,
      };
    }
    return undefined;
  }

  /**
   * Which parse-time step the run hands off to next (P6-F1).
   *
   * **Node address first, and asked of the RUN.** The previous implementation resolved the
   * current step by node id and then took `currentIndex + 1` — a node-addressed anchor followed
   * by a positional step. That offset is only correct while the parse array and the run's node
   * list are the same list, which stops being true the moment the P4 mutation policy inserts or
   * retires a node: after a skip the run's next node is two parse positions ahead, so the handoff
   * (and the visibility declarations resolved from it) resolved against a step that will never
   * execute; after an insertion the run's next node is the inserted one, and the handoff rendered
   * a planned step's CTA a step early. The run is the only thing that knows which node comes
   * next, so it is asked, and its answer is matched back into the parse array by identity.
   *
   * A node id with no parse step — the shape every inserted node has — yields `undefined`, i.e.
   * no delegation. That is correct rather than conservative: only planned steps carry `delegated`.
   *
   * The ordinal branch survives for the two cases that have no node address to use: a legacy
   * chain whose steps carry no `nodeId` (P3 D10 keeps it optional), and a call with no run view
   * to ask (no provider injected, or the request names no chain). Those keep the pre-P6 answer
   * exactly, which is what leaves an unmutated run byte-identical.
   */
  private resolveNextStepIndex(
    context: ExecutionContext,
    steps: readonly { nodeId?: string; stepNumber: number }[]
  ): number | undefined {
    const nodeAddressed = steps.some((step) => step.nodeId != null);

    if (nodeAddressed) {
      const nextNodeId = this.resolveNextRunNodeId(context);
      if (nextNodeId === null) {
        // The run is standing at its last live node: there is no next step to hand off to.
        return undefined;
      }
      if (nextNodeId !== undefined) {
        const index = steps.findIndex((step) => step.nodeId === nextNodeId);
        return index >= 0 ? index : undefined;
      }
      // `undefined` = no run view to ask. Fall through to the pre-P6 offset.
    }

    const currentNodeId = context.sessionContext?.currentNodeId;
    const currentStep = context.sessionContext?.currentStep ?? 1;
    const currentIndex =
      currentNodeId != null && nodeAddressed
        ? steps.findIndex((step) => step.nodeId === currentNodeId)
        : steps.findIndex((step) => step.stepNumber === currentStep);
    return currentIndex >= 0 ? currentIndex + 1 : undefined;
  }

  /**
   * The node the run stands at NEXT, read off the live run.
   *
   * Three distinct answers, deliberately not collapsed (the `filterGatesForTarget` split):
   * a **string** is the next live node; **null** is "resolved, and there is none" — the run is on
   * its last node or has walked off the end; **undefined** is "no run to ask", which is the only
   * one that licenses the ordinal fallback. Collapsing `null` into `undefined` would make a
   * finished run silently fall back to the positional offset and render a handoff for a step the
   * run already passed.
   *
   * Retired nodes are filtered out before the successor is taken, for the same reason
   * `filterGatesForTarget` refuses to fire a gate whose target was skipped: a step that will not
   * execute cannot be the step being handed off to.
   */
  private resolveNextRunNodeId(context: ExecutionContext): string | null | undefined {
    const view = this.resolveRunStepView(context);
    if (view === undefined) {
      return undefined;
    }

    const liveNodeIds = view.nodeIds.filter((nodeId) => !view.skippedNodeIds.includes(nodeId));
    const currentNodeId = view.currentNodeId ?? context.sessionContext?.currentNodeId;
    if (currentNodeId === null) {
      return null;
    }
    if (currentNodeId === undefined) {
      return undefined;
    }

    const currentIndex = liveNodeIds.indexOf(currentNodeId);
    if (currentIndex < 0) {
      // The run is standing somewhere this view cannot place — do not invent a successor.
      return undefined;
    }
    return liveNodeIds[currentIndex + 1] ?? null;
  }

  /**
   * The live run behind this request, or undefined when there is none to ask.
   *
   * Resolved per call rather than memoized: the assembler holds no per-request state, the answer
   * cannot change while one response is being assembled, and the provider reads already-loaded
   * session maps.
   */
  private resolveRunStepView(context: ExecutionContext): RunStepView | undefined {
    if (this.runStepViewProvider === undefined) {
      return undefined;
    }
    const chainId = context.getRequestedChainId();
    return chainId === undefined
      ? undefined
      : this.runStepViewProvider(chainId, context.getScopeOptions());
  }

  /**
   * Resolves the prompt name for the next delegated step from parsed steps.
   */
  private resolveNextStepPromptName(context: ExecutionContext): string | undefined {
    return this.findNextDelegatedStep(context)?.promptId;
  }

  /**
   * Builds gate review CTA with verdict template, attempt counter, and submit instructions.
   * Retry hints are NOT included here — they are SSOT in chain-operator-executor supplementalSections
   * (already present in base content).
   */
  private buildGateReviewCTA(context: ExecutionContext): string | null {
    const pendingReview = context.sessionContext?.pendingReview;
    if (!pendingReview) {
      return null;
    }

    const chainId = context.sessionContext?.chainId ?? '';
    const attemptInfo =
      pendingReview.maxAttempts > 1
        ? ` (attempt ${Math.min(pendingReview.attemptCount + 1, pendingReview.maxAttempts)}/${pendingReview.maxAttempts})`
        : '';

    const isPhaseGuardReview = pendingReview.gateIds?.includes(PHASE_GUARD_GATE_ID) === true;
    const hasOtherGates = pendingReview.gateIds?.some((id) => id !== PHASE_GUARD_GATE_ID) ?? false;

    let header: string;
    let gatesLine: string;

    if (isPhaseGuardReview && !hasOtherGates) {
      header = 'Structural Review Required';
      gatesLine = 'phase guards';
    } else if (isPhaseGuardReview && hasOtherGates) {
      header = 'Structural + Gate Review Required';
      gatesLine = '';
    } else {
      header = 'Gate Review Required';
      gatesLine = '';
    }

    const structuredTemplate = this.buildStructuredVerdictTemplate(
      pendingReview.gateIds ?? [],
      pendingReview.prompts
    );

    return `\n---\n\n**${header}**${attemptInfo}\n\n${gatesLine}\n\nReview your output above against the gates, then submit:\n\n\`\`\`\nchain_id="${chainId}"\ngate_verdict=${structuredTemplate}\n\`\`\`\n\nSet \`"overall": "FAIL"\` and say what needs improvement if the gates are not met. Rationales are single-line.\n\nA legacy string form is still accepted: \`gate_verdict="GATE_REVIEW: PASS - [assessment]"\`.`;
  }

  /**
   * Builds the completion message for a run that has actually finished.
   *
   * Gated on the latch rather than on `isFinalChainStep`, which is true from the moment the
   * final step is *rendered*. Under the old guard this printed "✅ Chain execution complete.
   * You may now respond to the user." on the call that handed the client its last step to do —
   * the same one-call-early claim the footer made, on a second surface. With the footer now
   * honest the two would have contradicted each other inside one payload.
   */
  private buildFinalStepMessage(context: ExecutionContext): string | null {
    if (!this.isFinalChainStep(context) || !this.isRunLatchedComplete(context)) {
      return null;
    }
    const completion = '\n\n✅ Chain execution complete. You may now respond to the user.';
    const cta = this.buildUsageCTA(context);
    return cta ? `${completion}\n\n${cta}` : completion;
  }

  /**
   * Checks whether the current step is the final step of a chain execution.
   */
  private isFinalChainStep(context: ExecutionContext): boolean {
    const session = context.sessionContext;
    if (!session?.isChainExecution) {
      return false;
    }
    // A single-prompt execution with a session (e.g., for gate tracking)
    // is NOT a chain completion — it should behave like a normal single prompt
    if (context.executionPlan?.strategy === 'single') {
      return false;
    }
    const { currentStep, totalSteps } = session;
    if (typeof currentStep !== 'number' || typeof totalSteps !== 'number' || totalSteps <= 0) {
      return false;
    }
    return currentStep >= totalSteps;
  }

  /**
   * Builds the structured `gate_verdict` template keyed to actual gate names.
   *
   * Offered ahead of the string template because a structured submission is
   * validated by the tool schema and cannot be malformed, whereas the string
   * form is a format the model has to reproduce and the server then reads back
   * with five fallback regexes. Advertising the fragile form first would keep
   * steering clients into the path that can fail.
   *
   * Rendered as JSON rather than prose so it can be copied into the call
   * directly. Rationale placeholders are single-line, which is what the
   * schema requires.
   */
  private buildStructuredVerdictTemplate(
    gateIds: readonly string[],
    prompts: readonly GateReviewPrompt[]
  ): string {
    const promptMap = this.buildPromptLookup(prompts);
    const entries = gateIds.slice(0, MAX_GATE_VERDICT_ENTRIES).map((gateId, index) => {
      const prompt = promptMap.get(gateId);
      const label = prompt?.gateName ?? gateId;
      // Criteria carry the reviewer's actual checklist; dropping them would
      // make the structured form less informative than the string form it
      // replaces. Quotes are escaped because this lands inside a JSON string.
      const criteria = prompt?.criteriaSummary;
      const suffix = criteria != null && criteria.length > 0 ? ` — ${criteria}` : '';
      const rationale = `${label}${suffix}: <why>`.replace(/"/g, '\\"');
      return `    {"index": ${index + 1}, "passed": true, "rationale": "${rationale}"}`;
    });

    const perGate = entries.length > 0 ? `,\n  "per_gate": [\n${entries.join(',\n')}\n  ]` : '';
    return `{\n  "overall": "PASS",\n  "rationale": "<overall assessment>"${perGate}\n}`;
  }

  /**
   * Builds a lookup map from gate ID to its review prompt.
   */
  private buildPromptLookup(prompts: readonly GateReviewPrompt[]): Map<string, GateReviewPrompt> {
    const map = new Map<string, GateReviewPrompt>();
    for (const prompt of prompts) {
      if (prompt.gateId != null && prompt.gateId.length > 0) {
        map.set(prompt.gateId, prompt);
      }
    }
    return map;
  }

  /**
   * Renders the declared-header vocabulary for the framework active on this single-prompt
   * execution, or `null` when there is nothing to declare — no provider wired, no session (an
   * ungated single prompt never reaches stage 19), no framework resolves, or the framework
   * declares no guarded phases. Mirrors `buildResponseFormatSection`'s "Required Sections" block
   * in `chain-operator-executor.ts` verbatim rather than reimplementing the format, so the two
   * declaration surfaces cannot drift from each other.
   */
  private buildDeclaredSectionsBlock(context: ExecutionContext): string | null {
    const declaredSections = this.resolveDeclaredSections(context);
    if (declaredSections.length === 0) {
      return null;
    }

    const lines: string[] = [
      '**Required Sections** — emit these headers verbatim; they are graded structurally:',
    ];
    for (const section of declaredSections) {
      const qualifier = section.required ? 'required' : 'optional';
      const criteria = section.criteria.length > 0 ? `; ${section.criteria.join('; ')}` : '';
      lines.push(`- \`${section.header}\` (${qualifier}${criteria})`);
    }
    return lines.join('\n');
  }

  /**
   * Declared phase-guard headers for the framework active on this single-prompt execution, or
   * `[]` when this execution will not be graded by stage 19 at all.
   *
   * Three independent skip conditions (Tier 2.6), each a separate reason to declare nothing:
   *
   * 1. No provider wired — pre-Tier-2 behavior, byte-identical.
   * 2. No session (`context.sessionContext?.sessionId` absent) — an UNGATED single prompt never
   *    gets a session (`execution-planner.ts:427-450` only sets `requiresSession` for explicit
   *    `gates`, a `gate` operator, or `chainSteps`), and stage 19 skips whenever the session is
   *    absent (`19-phase-guard-verification-stage.ts:73-78`). Declaring headers for a prompt that
   *    will never be graded against them would spend tokens for nothing.
   * 3. No framework resolves, or the resolved framework declares no guarded phases — `provider()`
   *    itself returns `[]` for both, so no separate check is needed.
   *
   * Reads through the provider on every call — no cache — so framework hot-reload keeps working,
   * matching the chain path's `resolveDeclaredSections`.
   */
  private resolveDeclaredSections(context: ExecutionContext): DeclaredSection[] {
    const provider = this.declaredSectionsProvider;
    if (!provider) {
      return [];
    }

    if (context.sessionContext?.sessionId === undefined) {
      return [];
    }

    // `.id`, never `.type` — `FrameworkManager.getFrameworkGuide` lowercases its argument, so
    // `.type` only resolves for CAGEERF by coincidence ('CAGEERF' → 'cageerf') and would silently
    // miss a framework whose discriminator is not simply its lowercased id (`5w1h`).
    // `19-phase-guard-verification-stage` resolves on `.id`; the declaration and the guard must
    // read the same field or the prompt names different headers than the guard grades (F2's own
    // shape, one layer over). Never branch on `context.sessionContext?.isChainExecution` here —
    // F2 records it returns true for gated single prompts too, so it cannot discriminate this
    // case; `context.executionPlan?.strategy` is the reliable signal this method already avoids
    // needing, because `formatSinglePromptResponse` is only invoked for non-chain formatting
    // contexts (`21-formatting-stage.ts:103-114`).
    const frameworkId = context.frameworkContext?.selectedFramework.id ?? '';
    if (frameworkId === '') {
      return [];
    }

    return provider(frameworkId);
  }

  /**
   * Central gate content suppression check.
   * Returns true when gate-related content (CTAs, validation info,
   * instructions, advisory warnings) should NOT appear in the response.
   *
   * Called once per format method as `gateActive = !isGateContentSuppressed()`,
   * then threaded to all gate-emitting sections. Sub-methods do NOT call this
   * directly — the orchestrator decides, sub-methods obey.
   *
   * Entry points: formatChainResponse, formatSinglePromptResponse (top-level),
   *               buildGateValidationInfo (external entry from ResponseFormattingStage)
   */
  private isGateContentSuppressed(context: ExecutionContext): boolean {
    return context.state.session.chainComplete === true;
  }

  /** Checks injection control setting for gate guidance (not suppression — caller handles that). */
  private isGateGuidanceInjectionEnabled(context: ExecutionContext): boolean {
    return context.state.injection?.gateGuidance?.inject !== false;
  }

  private extractBaseContent(context: ExecutionContext): string {
    return typeof context.executionResults!.content === 'string'
      ? context.executionResults!.content
      : JSON.stringify(context.executionResults!.content, null, 2);
  }

  /**
   * Builds a usage CTA with re-run and chain suggestions.
   * Shown for single prompt and chain completion scenarios.
   */
  private buildUsageCTA(context: ExecutionContext): string | null {
    const prompt = this.resolveCurrentPrompt(context);
    const promptId = this.resolvePromptIdForCTA(context, prompt);
    if (promptId == null) return null;

    const isChainCompletion = this.isFinalChainStep(context);
    const invocation = this.buildInvocationString(context, prompt, !isChainCompletion);

    const lines = ['---', `Re-run: \`${invocation}\``];
    if (!isChainCompletion && !this.isAutoChainPrompt(prompt)) {
      lines.push(`Chain: \`${invocation} --> >>next_step\``);
    }

    return lines.join('\n');
  }

  /**
   * Builds context-aware CTA from all active operators.
   * Composition: primary action (exclusive) + hints (additive) + re-run (always).
   * Gate action is only appended when gateActive is true (decided by caller).
   */
  private buildNextActionCTA(context: ExecutionContext, gateActive = true): string | null {
    const lines: string[] = ['---'];
    let hasPrimaryAction = false;

    if (gateActive && this.appendGateAction(lines, context)) {
      hasPrimaryAction = true;
    }

    this.appendVerifyHint(lines, context);
    this.appendVerifyBudget(lines, context);
    this.appendLoopHint(lines, context);

    if (!hasPrimaryAction) {
      this.appendSessionAction(lines, context);
    }

    this.appendRerunLine(lines, context);

    return lines.length > 1 ? lines.join('\n') : null;
  }

  /** Appends gate verdict CTA when gates are active and a session exists. */
  private appendGateAction(lines: string[], context: ExecutionContext): boolean {
    const chainId = context.sessionContext?.chainId;
    // Review is scoped to the step being rendered (P4-F3): a gate bound to another node has no
    // business in this step's verdict template. `accumulatedGateIds` is the fallback, not the
    // preference — the single-prompt path writes no `reviewGateIds`, and its output must stay
    // byte-identical.
    const gateIds =
      context.state.gates.reviewGateIds ?? context.state.gates.accumulatedGateIds ?? [];
    if (gateIds.length === 0 || chainId == null || chainId.length === 0) return false;

    const pendingReview = context.sessionContext?.pendingReview;
    const structuredTemplate = this.buildStructuredVerdictTemplate(
      gateIds,
      pendingReview?.prompts ?? []
    );

    lines.push('**Review Required**');
    lines.push('');
    lines.push(`**Gates**: ${gateIds.join(', ')}`);
    lines.push('');
    lines.push('Review your output against the gate criteria, then submit:');
    lines.push('');
    lines.push('```');
    lines.push(`chain_id="${chainId}"`);
    lines.push(`gate_verdict=${structuredTemplate}`);
    lines.push('```');
    return true;
  }

  /** Appends shell verification command hint when :: verify:"cmd" operators are present. */
  private appendVerifyHint(lines: string[], context: ExecutionContext): void {
    const namedGates = context.parsedCommand?.namedInlineGates;
    if (namedGates == null) return;

    const verifyCommands = namedGates
      .map((g) => g.shellVerify?.command)
      .filter((cmd): cmd is string => cmd != null && cmd.length > 0);
    if (verifyCommands.length === 0) return;

    const formatted = verifyCommands.map((cmd) => `\`${cmd}\``).join(', ');
    lines.push(`Verification: ${formatted} runs automatically on each attempt`);
  }

  /**
   * Publishes the RESOLVED attempt budget for a shell-verify gate.
   *
   * The preset table in the README claims `:fast` = 1 try/30s, `:full` = 5/5min, `:extended` =
   * 10/10min, and until this line existed none of it was observable: the presets expand inside
   * `InlineGateProcessor.setupShellVerification`, which logs the resolved values and stores them on
   * `state.gates.pendingShellVerification`, but nothing rendered them. `:fast` and `:extended`
   * therefore produced BYTE-IDENTICAL responses, so a conformance scenario for either could assert
   * nothing beyond "the syntax parsed" — three published numbers with no way to check them (plan
   * row 0.5.22).
   *
   * Read from the pending state rather than the parsed operator on purpose: the operator carries
   * what the USER typed, which for a bare `:fast` is `maxIterations: undefined`. That is exactly
   * how `appendLoopHint` came to print the global default for every preset.
   */
  private appendVerifyBudget(lines: string[], context: ExecutionContext): void {
    const budget = context.state?.gates?.shellVerifyBudget;
    if (budget == null) return;

    const { maxAttempts: attempts, timeoutMs, preset } = budget;

    const parts = [`${attempts} attempt${attempts === 1 ? '' : 's'}`];
    if (timeoutMs != null) parts.push(`${Math.round(timeoutMs / 1000)}s timeout`);
    const suffix = preset != null ? ` (preset: ${preset})` : '';
    lines.push(`Verify budget: ${parts.join(' / ')}${suffix}`);
  }

  /** Appends Ralph loop hint when :: verify:"cmd" loop:true is active. */
  private appendLoopHint(lines: string[], context: ExecutionContext): void {
    const operators = context.parsedCommand?.operators?.operators;
    if (operators == null) return;

    const loopGate = operators.find(
      (op): op is GateOperator => op.type === 'gate' && op.shellVerify?.loop === true
    );
    if (loopGate?.shellVerify == null) return;

    // Prefer the resolved budget over the typed one: a bare `:fast` leaves `maxIterations`
    // undefined on the operator, so reading it here printed the global default no matter which
    // preset was named. The pending state holds what the gate will actually enforce.
    const max =
      context.state?.gates?.shellVerifyBudget?.maxAttempts ??
      loopGate.shellVerify.maxIterations ??
      SHELL_VERIFY_DEFAULT_MAX_ITERATIONS;
    lines.push(`Loop mode: autonomous retry (max ${max} iterations)`);
  }

  /** Appends session resume CTA when session exists but no gates. */
  private appendSessionAction(lines: string[], context: ExecutionContext): void {
    const chainId = context.sessionContext?.chainId;
    if (chainId == null || chainId.length === 0) return;

    lines.push(`Continue: \`chain_id="${chainId}", user_response="<your output>"\``);
  }

  /** Appends re-run invocation line (always shown). */
  private appendRerunLine(lines: string[], context: ExecutionContext): void {
    const prompt = this.resolveCurrentPrompt(context);
    const promptId = this.resolvePromptIdForCTA(context, prompt);
    if (promptId == null) return;

    const invocation = this.buildInvocationString(context, prompt, true);
    lines.push(`Re-run: \`${invocation}\``);
  }

  /** Resolves the prompt ID for CTA display from prompt or execution metadata. */
  private resolvePromptIdForCTA(
    context: ExecutionContext,
    prompt?: ConvertedPrompt
  ): string | undefined {
    if (prompt?.id != null && prompt.id.length > 0) return prompt.id;
    const metaId = context.executionResults?.metadata?.['promptId'];
    return typeof metaId === 'string' && metaId.length > 0 ? metaId : undefined;
  }

  /** Checks whether a prompt defines built-in chain steps (auto-chain). */
  private isAutoChainPrompt(prompt?: ConvertedPrompt): boolean {
    return prompt != null && (prompt.chainSteps?.length ?? 0) > 0;
  }

  /**
   * Resolves the ConvertedPrompt for the current execution.
   * Single prompt: direct convertedPrompt. Chain completion: last step's prompt.
   */
  private resolveCurrentPrompt(context: ExecutionContext): ConvertedPrompt | undefined {
    if (context.parsedCommand?.convertedPrompt != null) {
      return context.parsedCommand.convertedPrompt;
    }

    const steps = context.parsedCommand?.steps;
    const currentStep = context.sessionContext?.currentStep;
    if (steps != null && currentStep != null && currentStep > 0) {
      // Node id first (P4 row 5.4): post-mutation the node ordinal in `currentStep` no longer
      // names parse step N. An inserted node has no parse step; fall back to the ordinal so the
      // pre-mutation behavior is preserved for legacy chains without node ids.
      const currentNodeId = context.sessionContext?.currentNodeId;
      const byNode =
        currentNodeId != null ? steps.find((s) => s.nodeId === currentNodeId) : undefined;
      const step = byNode ?? steps.find((s) => s.stepNumber === currentStep);
      return step?.convertedPrompt;
    }

    return undefined;
  }

  /**
   * Builds the full invocation string from parsed context data.
   * Includes user-specified operators when includeOperators is true.
   */
  private buildInvocationString(
    context: ExecutionContext,
    prompt?: ConvertedPrompt,
    includeOperators = true
  ): string {
    const parts: string[] = [];
    const promptId = prompt?.id ?? 'prompt';

    if (includeOperators) {
      this.appendOperatorPrefixes(parts, context);
    }

    const userArgs = context.parsedCommand?.promptArgs;
    const argString = this.buildArgString(prompt, userArgs);
    parts.push(`>>${promptId}${argString}`);

    if (includeOperators) {
      this.appendGateSuffixes(parts, context);
    }

    return parts.join(' ');
  }

  /** Appends modifier, framework, and style operator prefixes to parts. */
  private appendOperatorPrefixes(parts: string[], context: ExecutionContext): void {
    const modifierToken = this.resolveModifierToken(context.parsedCommand?.modifiers);
    if (modifierToken != null) {
      parts.push(modifierToken);
    }

    const frameworkToken = this.resolveFrameworkToken(context);
    if (frameworkToken != null) {
      parts.push(frameworkToken);
    }

    const style = context.parsedCommand?.styleSelection;
    if (style != null && style.length > 0) {
      parts.push(`#${style}`);
    }
  }

  /** Resolves the framework operator token for CTA display. */
  private resolveFrameworkToken(context: ExecutionContext): string | null {
    const fwDecision = context.frameworkAuthority.getCachedDecision();
    if (fwDecision?.source === 'operator' && fwDecision.frameworkId != null) {
      return `^${fwDecision.frameworkId}`;
    }
    // Fallback: show @FRAMEWORK from parser when user typed it,
    // even if decision authority disabled it (e.g., implicit %clean on script-tool prompts)
    const operatorOverride = context.parsedCommand?.executionPlan?.frameworkOverride;
    return operatorOverride ? `^${operatorOverride.toLowerCase()}` : null;
  }

  /** Resolves the modifier token from execution modifiers. */
  private resolveModifierToken(modifiers?: ExecutionModifiers): string | null {
    if (modifiers?.clean === true) return '%clean';
    if (modifiers?.lean === true) return '%lean';
    if (modifiers?.judge === true) return '%judge';
    return null;
  }

  /** Appends inline gate criteria and named gates as suffixes. */
  private appendGateSuffixes(parts: string[], context: ExecutionContext): void {
    const inlineCriteria = context.parsedCommand?.inlineGateCriteria;
    if (inlineCriteria != null && inlineCriteria.length > 0) {
      for (const criteria of inlineCriteria) {
        parts.push(`:: '${criteria}'`);
      }
    }

    const namedGates = context.parsedCommand?.namedInlineGates;
    if (namedGates != null && namedGates.length > 0) {
      for (const gate of namedGates) {
        const criteriaText = gate.criteria[0] ?? '';
        parts.push(`:: ${gate.gateId}:"${criteriaText}"`);
      }
    }
  }

  /**
   * Builds the argument portion of an invocation string from prompt schema + user values.
   */
  private buildArgString(prompt?: ConvertedPrompt, userArgs?: Record<string, unknown>): string {
    if (prompt?.arguments == null || prompt.arguments.length === 0) return '';

    const MAX_DISPLAY = 4;
    const args = prompt.arguments;
    const displayArgs =
      args.length > MAX_DISPLAY
        ? args.filter((a) => a.required || (userArgs != null && a.name in userArgs))
        : args;

    if (displayArgs.length === 0) return '';

    const parts = displayArgs
      .map((arg) => this.formatArgForCTA(arg, userArgs))
      .filter((part): part is string => part != null);

    return parts.length > 0 ? ' ' + parts.join(' ') : '';
  }

  /** Formats a single argument for CTA display. */
  private formatArgForCTA(
    arg: { name: string; required: boolean; defaultValue?: unknown },
    userArgs?: Record<string, unknown>
  ): string | null {
    if (userArgs != null && arg.name in userArgs) {
      return `${arg.name}:"${String(userArgs[arg.name])}"`;
    }
    if (arg.defaultValue !== undefined) {
      return `${arg.name}:"${String(arg.defaultValue)}"`;
    }
    if (arg.required) {
      return `${arg.name}:"<${arg.name}>"`;
    }
    return null;
  }

  private formatExtractedInputsSummary(inputs: Record<string, unknown>): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(inputs)) {
      if (value === undefined || value === null) continue;

      let display: string;
      if (Array.isArray(value)) {
        display = `[${value.length} items]`;
      } else if (typeof value === 'object') {
        const keys = Object.keys(value);
        display = `{${keys.length} fields}`;
      } else if (typeof value === 'string' && value.length > 30) {
        display = `"${value.substring(0, 27)}..."`;
      } else {
        display = JSON.stringify(value);
      }

      parts.push(`${key}=${display}`);
    }

    return parts.join(', ') || '(none)';
  }
}
