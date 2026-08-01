// @lifecycle canonical - Assembles response content for pipeline formatting stage.
import { SHELL_VERIFY_DEFAULT_MAX_ITERATIONS } from '../../gates/shell/types.js';
import { DelegationRenderer } from '../delegation/renderer.js';
import { getHandoffFooterInstruction } from '../delegation/strategy.js';
import { PHASE_GUARD_GATE_ID } from '../pipeline/stages/09b-phase-guard-verification-stage.js';

import type { GateReviewPrompt } from '#shared/types/chain-execution.js';
import type { RequestClientProfile } from '#shared/types/request-identity.js';
import type {
  ChainFormattingContext,
  SinglePromptFormattingContext,
} from './formatting-context.js';
import type { ExecutionContext } from '../context/index.js';
import type { DelegationPayload, ExecutionEnvelope, RenderingHints } from '../delegation/types.js';
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
 * Extracted from ResponseFormattingStage (pipeline stage 10).
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
    // Detects from Stage 09 metadata OR parsed steps (when pendingReview blocked Stage 09).
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
   * Builds chain footer with session and progress tracking.
   */
  buildChainFooter(context: ExecutionContext): string {
    const lines: string[] = [];
    const sessionContext = context.sessionContext!;
    const chainIdentifier = sessionContext.chainId ?? sessionContext.sessionId;
    lines.push(`Chain: ${chainIdentifier}`);

    if (sessionContext.currentStep && sessionContext.totalSteps) {
      const normalizedStep = Math.min(sessionContext.currentStep, sessionContext.totalSteps);
      const progress = `${normalizedStep}/${sessionContext.totalSteps}`;
      const isComplete = sessionContext.currentStep >= sessionContext.totalSteps;
      lines.push(isComplete ? `✓ Chain complete (${progress})` : `→ Progress ${progress}`);
    }

    const hasPendingReview = context.hasPendingReview();
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
      const isComplete = sessionContext.currentStep >= sessionContext.totalSteps;
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
   * Reads from Stage 09 metadata when available, falls back to parsed step metadata
   * when pendingReview blocked Stage 09 execution.
   */
  private buildHandoffSection(context: ExecutionContext): string | null {
    const metadata = context.executionResults?.metadata ?? {};
    const envelope = this.buildHandoffEnvelope(context);

    // Read step info from metadata (Stage 09) or fall back to parsed steps
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
   * Returns null when neither source has content.
   */
  private buildHandoffEnvelope(context: ExecutionContext): ExecutionEnvelope | null {
    const gateInstructions =
      context.gateInstructions != null && context.gateInstructions.length > 0
        ? context.gateInstructions
        : undefined;
    const frameworkGuidance =
      context.frameworkContext?.systemPrompt != null &&
      context.frameworkContext.systemPrompt.length > 0
        ? context.frameworkContext.systemPrompt
        : undefined;

    if (gateInstructions === undefined && frameworkGuidance === undefined) {
      return null;
    }

    return { gateInstructions, frameworkGuidance };
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
   * Checks Stage 09 metadata first, falls back to parsed step `delegated` flag
   * (always available from Stage 01, even when pendingReview blocked Stage 09).
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
  ): { promptId: string; agentType?: string; subagentModel?: string } | undefined {
    const steps = context.parsedCommand?.steps;
    if (!steps || steps.length === 0) {
      return undefined;
    }
    const currentStep = context.sessionContext?.currentStep ?? 1;
    const currentIndex = steps.findIndex((s) => s.stepNumber === currentStep);
    const nextStep = currentIndex >= 0 ? steps[currentIndex + 1] : undefined;
    if (nextStep?.delegated === true) {
      return {
        promptId: nextStep.promptId,
        agentType: nextStep.agentType,
        subagentModel: nextStep.subagentModel,
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

    const verdictTemplate = this.buildGateVerdictTemplate(
      pendingReview.gateIds ?? [],
      pendingReview.prompts
    );

    return `\n---\n\n**${header}**${attemptInfo}\n\n${gatesLine}\n\nReview your output above against the gates, then submit:\n\n\`\`\`\nchain_id="${chainId}"\ngate_verdict="GATE_REVIEW: PASS - [your assessment]"\n\`\`\`\n\nOr if gates are not met:\n\n\`\`\`\ngate_verdict="GATE_REVIEW: FAIL - [what needs improvement]"\n\`\`\`\n\nInclude per-gate delivery assessment:\n\n\`\`\`\n${verdictTemplate}\n\`\`\``;
  }

  /**
   * Builds completion message for the final chain step when no gate review is pending.
   */
  private buildFinalStepMessage(context: ExecutionContext): string | null {
    if (!this.isFinalChainStep(context)) {
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
   * Builds a dynamic GATE_VERDICTS template keyed to actual gate names.
   */
  private buildGateVerdictTemplate(
    gateIds: readonly string[],
    prompts: readonly GateReviewPrompt[]
  ): string {
    if (gateIds.length === 0) {
      return 'GATE_VERDICTS:\n[1] PASS|FAIL - rationale';
    }

    const promptMap = this.buildPromptLookup(prompts);
    const entries = gateIds.slice(0, MAX_GATE_VERDICT_ENTRIES).map((gateId, index) => {
      const prompt = promptMap.get(gateId);
      const label = prompt?.gateName ?? gateId;
      const criteria = prompt?.criteriaSummary;
      const suffix = criteria ? ` — ${criteria}` : '';
      return `[${index + 1}] PASS|FAIL - ${label}${suffix}: rationale`;
    });

    return `GATE_VERDICTS:\n${entries.join('\n')}`;
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
   *               buildGateValidationInfo (external entry from Stage 10)
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
    const gateIds = context.state.gates.accumulatedGateIds ?? [];
    if (gateIds.length === 0 || chainId == null || chainId.length === 0) return false;

    const pendingReview = context.sessionContext?.pendingReview;
    const verdictTemplate = this.buildGateVerdictTemplate(gateIds, pendingReview?.prompts ?? []);

    lines.push('**Review Required**');
    lines.push('');
    lines.push(`**Gates**: ${gateIds.join(', ')}`);
    lines.push('');
    lines.push('Review your output against the gate criteria, then submit:');
    lines.push('');
    lines.push('```');
    lines.push(`chain_id="${chainId}"`);
    lines.push(`gate_verdict="GATE_REVIEW: PASS|FAIL - <reason>\\n\\n${verdictTemplate}"`);
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

  /** Appends Ralph loop hint when :: verify:"cmd" loop:true is active. */
  private appendLoopHint(lines: string[], context: ExecutionContext): void {
    const operators = context.parsedCommand?.operators?.operators;
    if (operators == null) return;

    const loopGate = operators.find(
      (op): op is GateOperator => op.type === 'gate' && op.shellVerify?.loop === true
    );
    if (loopGate?.shellVerify == null) return;

    const max = loopGate.shellVerify.maxIterations ?? SHELL_VERIFY_DEFAULT_MAX_ITERATIONS;
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
      const step = steps.find((s) => s.stepNumber === currentStep);
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
      return `@${fwDecision.frameworkId}`;
    }
    // Fallback: show @FRAMEWORK from parser when user typed it,
    // even if decision authority disabled it (e.g., implicit %clean on script-tool prompts)
    const operatorOverride = context.parsedCommand?.executionPlan?.frameworkOverride;
    return operatorOverride ? `@${operatorOverride.toLowerCase()}` : null;
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
