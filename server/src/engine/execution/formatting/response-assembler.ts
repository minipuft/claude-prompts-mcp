// @lifecycle canonical - Assembles response content for pipeline formatting stage.
import { SHELL_VERIFY_DEFAULT_MAX_ITERATIONS } from '../../gates/shell/types.js';
import { applyVisibilityToEnvelope } from '../delegation/envelope-visibility.js';
import { DelegationRenderer } from '../delegation/renderer.js';
import { getHandoffFooterInstruction } from '../delegation/strategy.js';
import { decideVisibility } from '../pipeline/decisions/visibility/index.js';
import { PHASE_GUARD_GATE_ID } from '../pipeline/stages/19-phase-guard-verification-stage.js';

import type { GateReviewPrompt } from '#shared/types/chain-execution.js';
import type { RequestClientProfile } from '#shared/types/request-identity.js';
import type {
  ChainFormattingContext,
  SinglePromptFormattingContext,
} from './formatting-context.js';
import type { ExecutionContext } from '../context/index.js';
import type { DelegationPayload, ExecutionEnvelope, RenderingHints } from '../delegation/types.js';
import type { GateOperator } from '../parsers/types/operator-types.js';
import type { VisibilityDecision } from '../pipeline/decisions/visibility/index.js';
import type { ConvertedPrompt, ExecutionModifiers } from '../types.js';

/** Max gates to list in the GATE_VERDICTS template */
const MAX_GATE_VERDICT_ENTRIES = 10;

/**
 * The decision for "no declarations anywhere". A shared frozen constant rather than a fresh
 * `{ withheld: [], exposed: [], manifest: [] }` per call: it is returned on the hot path every
 * chain without `visibility:` takes, and `applyVisibilityToEnvelope` only reads its lengths.
 */
const EMPTY_VISIBILITY_DECISION: VisibilityDecision = Object.freeze({
  withheld: [],
  exposed: [],
  manifest: [],
});

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
  constructor() {}

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

    const nextStepDelegated = this.isNextStepDelegated(context);

    if (nextStepDelegated) {
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
   * Builds a handoff section using DelegationRenderer with an ExecutionEnvelope
   * containing gate instructions and framework context for sub-agent isolation.
   *
   * Reads from StepExecutionStage metadata when available, falls back to parsed step metadata
   * when pendingReview blocked StepExecutionStage execution.
   */
  private buildHandoffSection(context: ExecutionContext): string | null {
    const metadata = context.executionResults?.metadata ?? {};

    // Read step info from metadata (StepExecutionStage) or fall back to parsed steps
    const stepNumber =
      (metadata['stepNumber'] as number | undefined) ?? context.sessionContext?.currentStep ?? 0;
    const totalSteps =
      (metadata['totalSteps'] as number | undefined) ?? context.sessionContext?.totalSteps ?? 0;
    const promptName = String(
      metadata['promptName'] ?? this.resolveNextStepPromptName(context) ?? 'next-step'
    );
    const nextStep = this.findNextDelegatedStep(context);
    const agentType = nextStep?.agentType ?? 'chain-executor';
    const subagentModel = nextStep?.subagentModel;
    const envelope = this.buildHandoffEnvelope(context, nextStep?.index);

    const gateCount = context.gates.getAll().length;
    const clientProfile = this.resolveClientProfile(context);
    const renderer = new DelegationRenderer();
    const payload: DelegationPayload = {
      stepNumber: stepNumber + 1, // handoff targets NEXT step
      totalSteps,
      promptName,
      agentType,
      ...(clientProfile != null ? { clientProfile } : {}),
      ...(subagentModel != null ? { subagentModel } : {}),
      gateCount,
      hasGates: gateCount > 0,
    };
    const hints: RenderingHints = {
      gateGuidanceEnabled: this.isGateGuidanceInjectionEnabled(context),
      frameworkInjectionEnabled: Boolean(context.frameworkContext),
    };
    return renderer.render(payload, envelope ?? undefined, hints);
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
   * Builds an ExecutionEnvelope from gate instructions and framework context.
   * Returns null when no source has content and nothing is withheld.
   *
   * `nextStepIndex` is the index of the step being handed off within
   * `context.parsedCommand.steps`; when present, the P5 visibility decision for that step
   * filters the envelope and supplies its withheld manifest (Tier 3.2). Absent index (no
   * delegated step located) leaves the envelope exactly as it was before P5.
   */
  private buildHandoffEnvelope(
    context: ExecutionContext,
    nextStepIndex?: number
  ): ExecutionEnvelope | null {
    const gateInstructions =
      context.gateInstructions != null && context.gateInstructions.length > 0
        ? context.gateInstructions
        : undefined;
    const frameworkGuidance =
      context.frameworkContext?.systemPrompt != null &&
      context.frameworkContext.systemPrompt.length > 0
        ? context.frameworkContext.systemPrompt
        : undefined;

    const base =
      gateInstructions === undefined && frameworkGuidance === undefined
        ? null
        : { gateInstructions, frameworkGuidance };

    return applyVisibilityToEnvelope(base, this.resolveHandoffVisibility(context, nextStepIndex));
  }

  /**
   * Resolve the P5 visibility decision for the handed-off step.
   *
   * Reads declarations off `context.parsedCommand.steps` — the parse-time blueprint, which is
   * where visibility lives (OQ-P5-5: definition-time facts, re-derived rather than persisted as
   * run state). Returns an empty decision when there is no delegated step or no parsed steps,
   * which keeps the envelope byte-identical for every chain that declares nothing.
   */
  private resolveHandoffVisibility(
    context: ExecutionContext,
    nextStepIndex?: number
  ): VisibilityDecision {
    const steps = context.parsedCommand?.steps;
    if (steps === undefined || nextStepIndex === undefined || nextStepIndex < 0) {
      return EMPTY_VISIBILITY_DECISION;
    }
    const target = steps[nextStepIndex];
    return decideVisibility({
      step: target?.visibility != null ? { visibility: target.visibility } : {},
      priorDeclarations: steps
        .slice(0, nextStepIndex)
        .map((step) => (step.visibility != null ? { visibility: step.visibility } : {})),
    });
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
   * Finds the next step in parsed command steps that has `delegated: true`.
   * Returns undefined if no delegation is found.
   */
  private findNextDelegatedStep(
    context: ExecutionContext
  ): { promptId: string; agentType?: string; subagentModel?: string; index: number } | undefined {
    const steps = context.parsedCommand?.steps;
    if (!steps || steps.length === 0) {
      return undefined;
    }
    // Node id first: after a mutation the run's ordinal no longer names parse step N, so an
    // ordinal lookup points one step early (P4 row 5.4). An inserted node has no parse step —
    // findIndex misses and this conservatively reports no delegation, which is correct: only
    // planned steps can carry `delegated`.
    const currentNodeId = context.sessionContext?.currentNodeId;
    const currentStep = context.sessionContext?.currentStep ?? 1;
    const currentIndex =
      currentNodeId != null && steps.some((s) => s.nodeId != null)
        ? steps.findIndex((s) => s.nodeId === currentNodeId)
        : steps.findIndex((s) => s.stepNumber === currentStep);
    const nextStep = currentIndex >= 0 ? steps[currentIndex + 1] : undefined;
    if (nextStep?.delegated === true) {
      return {
        promptId: nextStep.promptId,
        agentType: nextStep.agentType,
        subagentModel: nextStep.subagentModel,
        // Carried so the P5 visibility decision for the handed-off step can be resolved from
        // the same lookup that found it — recomputing the index elsewhere would give the
        // node-id/ordinal fallback above two implementations that could disagree.
        index: currentIndex + 1,
      };
    }
    return undefined;
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
