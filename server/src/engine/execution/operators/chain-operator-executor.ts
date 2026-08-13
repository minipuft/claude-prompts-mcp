// @lifecycle canonical - Executes chain operator steps within the pipeline.
import { hasFrameworkGuidance } from '../../frameworks/utils/framework-detection.js';
import { DEFAULT_GATE_RETRY_CONFIG } from '../../gates/constants.js';
import { applyVisibilityToEnvelope } from '../delegation/envelope-visibility.js';
import { DelegationRenderer } from '../delegation/renderer.js';
import { decideVisibility } from '../pipeline/decisions/visibility/index.js';

import type { PendingGateReview, VisibilityItem } from '#shared/types/chain-execution.js';
import type { UnknownLedgerEntry } from '#shared/types/chain-session.js';
import type { RequestClientProfile } from '#shared/types/request-identity.js';
import type { ScriptReferenceResolverPort } from '#shared/utils/jsonUtils.js';
import type {
  ChainStepExecutionInput,
  ChainStepPrompt,
  ChainStepRenderResult,
  GateReviewInput,
  NormalStepInput,
} from './types.js';
import type { DelegationPayload, RenderingHints } from '../delegation/types.js';
import type { InjectionState } from '../pipeline/decisions/injection/types.js';
import type { VisibilityDecision } from '../pipeline/decisions/visibility/index.js';
import type { PromptReferenceResolver } from '../reference/index.js';
import type { ConvertedPrompt } from '../types.js';

import { Logger } from '#infra/logging/index.js';
import { DEFAULT_FRAMEWORK_ID, NAMED_OUTPUT_NAMESPACE } from '#shared/utils/constants.js';
import { processTemplate, processTemplateWithRefs } from '#shared/utils/jsonUtils.js';

/**
 * Type guard for gate review input
 */
function isGateReviewInput(input: ChainStepExecutionInput): input is GateReviewInput {
  return input.executionType === 'gate_review';
}

export class ChainOperatorExecutor {
  constructor(
    private readonly logger: Logger,
    private readonly convertedPrompts: ConvertedPrompt[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly gateGuidanceRenderer?: any,
    private readonly getFrameworkContext?: (promptId: string) => Promise<{
      selectedFramework?: { type: string; name: string };
      category?: string;
      systemPrompt?: string;
    } | null>,
    private readonly referenceResolver?: PromptReferenceResolver,
    private readonly scriptReferenceResolver?: ScriptReferenceResolverPort
  ) {}

  async renderStep(input: ChainStepExecutionInput): Promise<ChainStepRenderResult> {
    const { stepPrompts, chainContext = {}, additionalGateIds = [], inlineGuidanceText } = input;

    if (stepPrompts.length === 0) {
      return {
        stepNumber: 0,
        totalSteps: 0,
        promptId: '',
        promptName: '',
        content: 'No executable steps detected in symbolic chain.',
        callToAction: '',
      };
    }

    // Use discriminated union type guards for variant-specific logic
    if (isGateReviewInput(input)) {
      return this.renderGateReviewStep(
        input,
        stepPrompts,
        chainContext,
        additionalGateIds,
        inlineGuidanceText
      );
    }

    // Normal step execution
    return this.renderNormalStep(input, stepPrompts, chainContext);
  }

  /**
   * Renders a gate review step (synthetic validation step)
   */
  private async renderGateReviewStep(
    input: GateReviewInput,
    stepPrompts: readonly ChainStepPrompt[],
    chainContext: Record<string, unknown>,
    additionalGateIds: readonly string[],
    inlineGuidanceText?: string
  ): Promise<ChainStepRenderResult> {
    const { pendingGateReview } = input;
    const isRetry = pendingGateReview.attemptCount > 0;
    const gateGuidanceEnabled = this.isGateGuidanceEnabled(chainContext);
    const frameworkInjectionEnabled = this.isFrameworkInjectionEnabledForGates(chainContext);

    this.logger.debug(`[SymbolicChain] Rendering synthetic gate review step`, {
      gateGuidanceEnabled,
      frameworkInjectionEnabled,
    });
    const totalSteps = stepPrompts.length + 1;
    const stepNumber = totalSteps;
    const reviewStep = this.resolveReviewStep(stepPrompts, chainContext, pendingGateReview);
    const { gateIds: gateIdsToRender, explicitGateIds } = this.collectReviewGateIds(
      pendingGateReview,
      additionalGateIds,
      reviewStep
    );
    const hasInlineGateFocus =
      explicitGateIds.length > 0 ||
      gateIdsToRender.some((gateId) => this.isInlineGateId(gateId)) ||
      Boolean(inlineGuidanceText);
    const callToAction =
      'Use the resume shortcut below and include both your step output and a gate_verdict (e.g., `GATE_REVIEW: PASS - reason`) to resume the workflow.';

    // Get the last actual step that was executed
    const fallbackIndex = stepPrompts.length - 1;
    const lastStepIndex = reviewStep
      ? stepPrompts.findIndex((step) => step.stepNumber === reviewStep.stepNumber)
      : fallbackIndex;
    const targetStep =
      reviewStep ??
      (lastStepIndex >= 0 ? stepPrompts[lastStepIndex] : (stepPrompts[fallbackIndex] ?? undefined));

    // P5 visibility for the REVIEWED step (Tier 3.1/3.3). A review re-renders that step's own
    // template as "Original Task Instructions", so it must show exactly what the step itself
    // was allowed to see — otherwise the review path becomes a second, unwithheld copy of the
    // context the step was denied. Index tracks `targetStep`: `lastStepIndex` when the review
    // step was resolved, else the fallback (last) index.
    const targetIndex = lastStepIndex >= 0 ? lastStepIndex : fallbackIndex;
    const reviewWithheld = new Set<VisibilityItem>(
      this.resolveStepVisibility(stepPrompts, targetIndex).withheld
    );

    // Get original content from last step if available
    let originalContent = '';
    if (targetStep) {
      // Look up convertedPrompt if not already set
      const convertedPrompt =
        targetStep.convertedPrompt ||
        this.convertedPrompts.find((p) => p.id === targetStep.promptId);

      if (convertedPrompt) {
        // Prioritize currentStepArgs from chainContext (pipeline integration)
        // Fall back to targetStep.args for backward compatibility
        const stepArgs = this.normalizeStepArgs(
          (chainContext['currentStepArgs'] as Record<string, unknown> | undefined) ??
            targetStep?.args ??
            {},
          convertedPrompt
        );
        const templateContext: Record<string, unknown> = { ...chainContext, ...stepArgs };
        this.applyWithheldToTemplateContext(
          templateContext,
          reviewWithheld,
          stepPrompts,
          targetIndex
        );

        const renderedTemplate = await this.renderTemplate(
          convertedPrompt,
          templateContext,
          targetStep.promptId
        );

        const intentForReview = this.buildOriginalIntentSection(chainContext);
        // Second `buildUnknownsSection` call site (the other is the normal step render). Both
        // respect the decision — a withhold honoured on one render path and not the other is
        // not a withhold.
        const unknownsForReview = reviewWithheld.has('unknowns_ledger')
          ? null
          : this.buildUnknownsSection(chainContext);
        originalContent = [
          '## Original Task Instructions',
          '',
          ...(intentForReview ? [intentForReview, ''] : []),
          ...(unknownsForReview ? [unknownsForReview, ''] : []),
          renderedTemplate,
          '',
          '---',
          '',
        ].join('\n');
      }
    }

    // On retry, abbreviate task content — the LLM already has the full task above
    if (isRetry) {
      originalContent =
        '## Review Context\n\nReview the original task and your output above against the gate criteria.\n\n---\n';
    }

    // Build gate guidance using proper renderer for framework-aware, category-aware rendering
    let gateGuidance = '';
    if (gateGuidanceEnabled && gateIdsToRender.length > 0) {
      // Get framework and category context if available
      let frameworkType: string = DEFAULT_FRAMEWORK_ID;
      let category = 'general';

      const reviewStepContext = await this.resolveFrameworkContext(targetStep ?? undefined);
      if (reviewStepContext) {
        frameworkType = reviewStepContext.selectedFramework?.type || DEFAULT_FRAMEWORK_ID;
        category = reviewStepContext.category || 'general';
      }

      // Use GateGuidanceRenderer to properly render gates (handles temp gates, framework filtering, etc.)
      if (this.gateGuidanceRenderer) {
        try {
          gateGuidance = await this.gateGuidanceRenderer.renderGuidance(gateIdsToRender, {
            framework: frameworkType,
            category,
            promptId: targetStep?.promptId,
            explicitGateIds,
          });
        } catch (error) {
          this.logger.warn(
            '[SymbolicChain] Gate guidance rendering failed, using fallback:',
            error
          );
          gateGuidance = this.renderSimpleGateGuidance(gateIdsToRender, inlineGuidanceText);
        }
      } else {
        gateGuidance = this.renderSimpleGateGuidance(gateIdsToRender, inlineGuidanceText);
      }
    } else if (gateGuidanceEnabled && inlineGuidanceText) {
      gateGuidance = this.renderSimpleGateGuidance([], inlineGuidanceText);
    } else if (!gateGuidanceEnabled) {
      this.logger.debug('[SymbolicChain] Gate guidance injection suppressed by decision');
    }

    // Build streamlined retry hints and metadata
    // Attempt display is handled by ResponseAssembler.buildGateReviewCTA()
    const attemptCount = pendingGateReview?.attemptCount ?? 0;
    const maxAttempts = pendingGateReview?.maxAttempts ?? DEFAULT_GATE_RETRY_CONFIG.max_attempts;
    const supplementalSections: string[] = [];

    if (hasInlineGateFocus) {
      supplementalSections.push(
        '**Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.'
      );
    }

    // Add concise retry hints (limit to top 3 most important)
    if (pendingGateReview?.retryHints && pendingGateReview.retryHints.length > 0) {
      const hintHeading = hasInlineGateFocus
        ? '**Inline Fix Guidance:**'
        : '**Improvements Needed:**';
      supplementalSections.push(
        `${hintHeading}\n` +
          pendingGateReview.retryHints
            .slice(0, 3) // Limit to top 3 hints
            .map((hint) => `- ${hint}`)
            .join('\n')
      );
    }

    // Add latest feedback only if concise
    const latestHistory = pendingGateReview?.history?.length
      ? pendingGateReview.history[pendingGateReview.history.length - 1]
      : undefined;

    if (latestHistory?.reasoning && latestHistory.reasoning.length < 200) {
      supplementalSections.push(`**Last Review:** ${latestHistory.reasoning}`);
    }

    // Check if retry limit is exceeded and add user choice prompt
    const isLimitExceeded = attemptCount >= maxAttempts;
    if (isLimitExceeded) {
      const failedGates = pendingGateReview?.gateIds?.join(', ') ?? 'quality gates';
      supplementalSections.push(
        `\n## ⚠️ Retry Limit Reached\n\n` +
          `The following gates failed after ${maxAttempts} attempts: **${failedGates}**\n\n` +
          `### Choose an action:\n\n` +
          `| Action | Description |\n` +
          `|--------|-------------|\n` +
          `| \`gate_action: "retry"\` | Reset retry count and try again with improvements |\n` +
          `| \`gate_action: "skip"\` | Skip this gate check and continue the chain |\n` +
          `| \`gate_action: "abort"\` | Stop chain execution entirely |\n\n` +
          `**To continue**, include one of the above in your next call.`
      );
    }

    // Build framework guidance for gate reviews if enabled (skip on retry — already seen)
    let frameworkGuidance = '';
    if (!isRetry && frameworkInjectionEnabled && targetStep) {
      const guidance = await this.buildFrameworkGuidance(targetStep);
      if (guidance) {
        frameworkGuidance = guidance;
        this.logger.debug('[SymbolicChain] Added framework guidance to gate review step');
      }
    } else if (!frameworkInjectionEnabled) {
      this.logger.debug(
        '[SymbolicChain] Framework injection suppressed for gate review (target config)'
      );
    }

    // Assemble in proper order: Framework → Warning → Content → Gates → Metadata
    // Use original task template as the review body. Gate guidance comes from
    // GateGuidanceRenderer (gateGuidance variable) as the single source of truth.
    const reviewPrompt = originalContent;

    const contentParts = [
      frameworkGuidance,
      reviewPrompt,
      gateGuidance,
      supplementalSections.join('\n\n'),
    ].filter((part) => part && part.trim().length > 0);

    const reviewContent = contentParts.join('\n\n');

    return {
      stepNumber,
      totalSteps,
      promptId: '__gate_review__',
      promptName: 'Quality Gate Validation',
      content: reviewContent,
      callToAction,
    };
  }

  /**
   * Renders a normal step (non-review execution)
   */
  private async renderNormalStep(
    input: NormalStepInput,
    stepPrompts: readonly ChainStepPrompt[],
    chainContext: Record<string, unknown>
  ): Promise<ChainStepRenderResult> {
    const { currentStepIndex } = input;

    if (currentStepIndex < 0 || currentStepIndex >= stepPrompts.length) {
      throw new Error(
        `Invalid step index ${currentStepIndex} for chain of length ${stepPrompts.length}`
      );
    }

    const step = stepPrompts[currentStepIndex];
    if (!step) {
      throw new Error(
        `Step at index ${currentStepIndex} is undefined in chain of length ${stepPrompts.length}`
      );
    }
    this.logger.debug(`[SymbolicChain] Rendering step ${step.stepNumber}: ${step.promptId}`);

    // Look up convertedPrompt if not already set on the step
    const convertedPrompt =
      step.convertedPrompt || this.convertedPrompts.find((p) => p.id === step.promptId);

    if (!convertedPrompt) {
      this.logger.warn(`Prompt not found: ${step.promptId}`);
      // Return fallback content
      return {
        stepNumber: currentStepIndex + 1,
        totalSteps: stepPrompts.length,
        promptId: step.promptId,
        promptName: step.promptId,
        content: `Execute the prompt "${step.promptId}"`, // Corrected escaping for quotes
        callToAction: 'Complete this step manually',
      };
    }

    const promptName = convertedPrompt.name || step.promptId;

    // Prioritize currentStepArgs from chainContext (pipeline integration)
    // Fall back to step-level args captured during parsing
    const stepArgs = this.normalizeStepArgs(
      (chainContext['currentStepArgs'] as Record<string, unknown> | undefined) ?? step?.args ?? {},
      convertedPrompt
    );

    const templateContext: Record<string, unknown> = {
      ...chainContext,
      ...stepArgs,
    };

    // P5 visibility (Tier 3.1/3.3). Resolved once and applied to every context surface this
    // render produces: the template context below, the unknowns section, and the delegation
    // envelope for the next step. Empty when no step in the chain declares `visibility`.
    const visibility = this.resolveStepVisibility(stepPrompts, currentStepIndex);
    const withheld = new Set<VisibilityItem>(visibility.withheld);

    // Stripped BEFORE inputMapping: a mapping like `{ research: 'step1_result' }` — or
    // `{ research: 'outputs' }` — would otherwise re-publish a withheld history entry under a
    // name the filter never sees. inputMapping stays FLAT and is not namespaced: it renames
    // into this step's own context, which is the step's own business, whereas `outputMapping`
    // publishes chain-wide and is what the namespace exists to fence.
    if (withheld.has('chain_history')) {
      this.stripChainHistory(templateContext);
    }

    // Apply inputMapping to create semantic variable names
    // e.g., { "research": "step1_result" } allows template to use {{research}} instead of {{step1_result}}
    if (step.inputMapping) {
      for (const [semanticName, sourceVar] of Object.entries(step.inputMapping)) {
        if (templateContext[sourceVar] !== undefined) {
          templateContext[semanticName] = templateContext[sourceVar];
          this.logger.debug(
            `[SymbolicChain] Applied inputMapping: ${semanticName} <- ${sourceVar}`
          );
        }
      }
    }

    const totalSteps = stepPrompts.length;
    const previousStepIndex = currentStepIndex - 1;

    if (currentStepIndex === 0) {
      templateContext['previous_step_output'] =
        '**[CONTEXT INSTRUCTION]**: This is the first step. Begin the workflow here.';
      templateContext['previous_step_result'] = templateContext['previous_step_output'];
    } else if (withheld.has('previous_step_output')) {
      // A prior step withheld its output from this one. The stored result is never read, so it
      // never enters the template context — this is the withhold, not a formatting choice.
      const instruction = this.buildWithheldOutputInstruction(stepPrompts, currentStepIndex);
      templateContext['previous_step_output'] = instruction;
      templateContext['previous_step_result'] = instruction;
    } else {
      const previousStep = stepPrompts[previousStepIndex];
      const storedOutput = previousStep
        ? this.getStoredStepResult(chainContext, previousStep.stepNumber)
        : undefined;

      if (storedOutput) {
        templateContext['previous_step_output'] = storedOutput;
        templateContext['previous_step_result'] = storedOutput;
      } else {
        const previousName = previousStep
          ? this.getPromptDisplayName(previousStep)
          : `Step ${currentStepIndex}`;
        const instruction = `**[CONTEXT INSTRUCTION]**: Use the response you produced for Step ${currentStepIndex} (${previousName}) wherever {{previous_step_output}} is referenced.`;
        templateContext['previous_step_output'] = instruction;
        templateContext['previous_step_result'] = instruction;
      }
    }

    const renderedTemplate = await this.renderTemplateString(
      convertedPrompt.userMessageTemplate,
      templateContext,
      step.promptId
    );

    const lines: string[] = [];
    const stepNumber = currentStepIndex + 1;
    const isFinalStep = currentStepIndex === totalSteps - 1;

    // Original Request Intent — provides delivery context for every chain step
    const intentSection = this.buildOriginalIntentSection(chainContext);
    if (intentSection) {
      lines.push(intentSection);
    }

    // Unknowns Ledger — surfaces run-scoped unknowns declared by prior steps.
    // Suppressed entirely when a prior step withheld `unknowns_ledger` (Tier 3.3): the section
    // is not summarised or redacted, it is absent, which is what "withheld" means here.
    const unknownsSection = withheld.has('unknowns_ledger')
      ? null
      : this.buildUnknownsSection(chainContext);
    if (unknownsSection) {
      lines.push(unknownsSection);
    }

    // Use target-aware helper to determine if framework should be suppressed on steps
    const suppressFrameworkInjection = this.shouldSuppressFrameworkForSteps(chainContext);
    const gateGuidanceEnabled = this.isGateGuidanceEnabled(chainContext);

    if (!suppressFrameworkInjection && !hasFrameworkGuidance(convertedPrompt?.systemMessage)) {
      const frameworkGuidance = await this.buildFrameworkGuidance(step);
      if (frameworkGuidance) {
        lines.push(frameworkGuidance);
      }
    }

    if (convertedPrompt?.systemMessage) {
      lines.push(`> ${convertedPrompt.systemMessage}`);
    }

    lines.push(renderedTemplate.trim());

    // Add gate instructions if stored in step metadata (from GateEnhancementStage)
    if (
      gateGuidanceEnabled &&
      step.metadata?.['gateInstructions'] &&
      typeof step.metadata['gateInstructions'] === 'string'
    ) {
      lines.push(step.metadata['gateInstructions']);
    } else if (!gateGuidanceEnabled && step.metadata?.['gateInstructions']) {
      this.logger.debug(
        '[SymbolicChain] Skipped gate instructions (gate-guidance injection disabled)',
        {
          step: step.stepNumber,
        }
      );
    }

    // Required Response Format — guides structured output for delivery verification
    lines.push(this.buildResponseFormatSection(isFinalStep, gateGuidanceEnabled));

    // Check if the NEXT step is delegated — if so, render a delegation CTA instead
    const nextStep = !isFinalStep ? stepPrompts[currentStepIndex + 1] : undefined;
    const callToAction =
      nextStep?.delegated === true
        ? this.buildDelegationCTA(
            stepPrompts,
            currentStepIndex + 1,
            gateGuidanceEnabled,
            chainContext
          )
        : !isFinalStep
          ? `Use the resume shortcut below and include your step output in user_response${
              gateGuidanceEnabled ? ' (add gate_verdict if a gate asks you to self-review)' : ''
            } so Step ${stepNumber + 1} can begin.`
          : 'Deliver the final response to the user (no user_response needed once the chain completes).';

    const content = lines.filter(Boolean).join('\n\n').trimEnd();

    return {
      stepNumber,
      totalSteps,
      promptId: step.promptId,
      promptName,
      content,
      callToAction,
      nextStepDelegated: nextStep?.delegated === true || undefined,
    };
  }

  private renderSimpleGateGuidance(
    gateIds: readonly string[],
    inlineGuidanceText?: string
  ): string {
    const inlineGateIds = gateIds.filter((gateId) => this.isInlineGateId(gateId));
    const frameworkGateIds = gateIds.filter((gateId) => !this.isInlineGateId(gateId));
    const hasInlineGuidance =
      inlineGateIds.length > 0 ||
      Boolean(inlineGuidanceText && inlineGuidanceText.trim().length > 0);
    const filteredFrameworkGateIds = hasInlineGuidance
      ? frameworkGateIds.filter((id) => id === 'framework-compliance')
      : frameworkGateIds;
    const sections: string[] = ['\n\n---\n\n##  Quality Enhancement Gates'];

    if (inlineGateIds.length > 0 || (inlineGuidanceText && inlineGuidanceText.trim().length > 0)) {
      sections.push('\n\n###  Inline Gates (PRIMARY)\n');
      if (inlineGuidanceText && inlineGuidanceText.trim().length > 0) {
        sections.push(inlineGuidanceText.trim());
      }
      if (inlineGateIds.length > 0) {
        sections.push('\n\n' + inlineGateIds.map((id) => `- ${id}`).join('\n'));
      }
    }

    if (filteredFrameworkGateIds.length > 0) {
      sections.push('\n\n---\n\n###  Framework Standards');
      sections.push('\n\n' + filteredFrameworkGateIds.map((id) => `- ${id}`).join('\n'));
    }

    sections.push('\n\n**Post-Execution Review Guidelines:**');
    sections.push(
      'Review your output against these quality standards before finalizing your response.'
    );
    sections.push('---');

    return sections.join('');
  }

  /**
   * Determine whether gate guidance injection is enabled for the current chain context.
   */
  private isGateGuidanceEnabled(chainContext: Record<string, unknown>): boolean {
    const injectionState = chainContext['injectionState'] as
      { gateGuidance?: { inject?: boolean } } | undefined;

    return injectionState?.gateGuidance?.inject !== false;
  }

  /**
   * Determine whether framework injection is enabled for gate reviews.
   * Checks both the inject flag and the target configuration.
   */
  private isFrameworkInjectionEnabledForGates(chainContext: Record<string, unknown>): boolean {
    const injectionState = chainContext['injectionState'] as InjectionState | undefined;
    if (!injectionState?.systemPrompt) {
      return true; // Default to enabled if no decision exists
    }

    const decision = injectionState.systemPrompt;
    if (!decision.inject) {
      return false; // Explicitly disabled
    }

    // Check target - 'both' or 'gates' allows injection on gate reviews
    const target = decision.target ?? 'both';
    return target === 'both' || target === 'gates';
  }

  /**
   * Determine whether framework injection should be suppressed for normal steps.
   * Returns true if injection should be skipped (target is 'gates' only).
   */
  private shouldSuppressFrameworkForSteps(chainContext: Record<string, unknown>): boolean {
    const injectionState = chainContext['injectionState'] as InjectionState | undefined;
    if (!injectionState?.systemPrompt) {
      return false; // Default to not suppressing
    }

    const decision = injectionState.systemPrompt;
    if (!decision.inject) {
      return true; // Explicitly disabled
    }

    // Check target - 'gates' only means suppress on steps
    const target = decision.target ?? 'both';
    return target === 'gates';
  }

  private async buildFrameworkGuidance(step: ChainStepPrompt): Promise<string | null> {
    const context = await this.resolveFrameworkContext(step);
    const systemPrompt = context?.systemPrompt?.trim();
    const frameworkName = context?.selectedFramework?.name?.trim();

    if (!systemPrompt || !frameworkName) {
      return null;
    }

    // Framework display names are inconsistent about the word: "C.A.G.E.E.R.F Framework" and
    // "SCAMPER Framework" carry it, "LIQUESCENT Creative Flow" does not. Appending it
    // unconditionally reads "… Framework Framework Active"; the previous literal hardcoded that
    // doubling with no name at all.
    const heading = /\bframeworks?\b/i.test(frameworkName)
      ? `## 🎯 ${frameworkName} Active`
      : `## 🎯 ${frameworkName} Framework Active`;

    return ['---', '', heading, '', `**${frameworkName}**`, '', systemPrompt, '', '---', ''].join(
      '\n'
    );
  }

  private async resolveFrameworkContext(step?: ChainStepPrompt): Promise<{
    selectedFramework?: { type: string; name: string };
    category?: string;
    systemPrompt?: string;
  } | null> {
    if (!step) {
      return null;
    }

    if (step.frameworkContext) {
      const category = step.convertedPrompt?.category;
      return {
        selectedFramework: step.frameworkContext.selectedFramework,
        ...(category !== undefined && { category }),
        systemPrompt: step.frameworkContext.systemPrompt,
      };
    }

    if (!this.getFrameworkContext) {
      return null;
    }

    try {
      return await this.getFrameworkContext(step.promptId);
    } catch (error) {
      this.logger.debug('[ChainOperatorExecutor] Failed to resolve framework context', {
        promptId: step.promptId,
        error,
      });
      return null;
    }
  }

  /**
   * Build a delegation CTA using the existing DelegationRenderer infrastructure.
   * Produces a Task tool directive instructing the LLM to spawn a sub-agent.
   *
   * Takes the whole `stepPrompts` array plus the delegated step's index rather than the step
   * alone: the P5 manifest names what is withheld from the step being HANDED OFF, which is a
   * decision over that step's priors, not over the step currently rendering.
   */
  private buildDelegationCTA(
    stepPrompts: readonly ChainStepPrompt[],
    nextStepIndex: number,
    gateGuidanceEnabled: boolean,
    chainContext: Record<string, unknown>
  ): string {
    const nextStep = stepPrompts[nextStepIndex];
    if (nextStep === undefined) {
      return '';
    }
    const totalSteps = stepPrompts.length;
    const agentType = nextStep.agentType ?? nextStep.convertedPrompt?.agentType ?? 'chain-executor';
    const subagentModel = nextStep.subagentModel ?? nextStep.convertedPrompt?.subagentModel;
    const clientProfile = this.extractClientProfile(chainContext);

    const payload: DelegationPayload = {
      stepNumber: nextStep.stepNumber,
      totalSteps,
      promptName: this.getPromptDisplayName(nextStep),
      agentType,
      ...(clientProfile != null ? { clientProfile } : {}),
      ...(subagentModel != null ? { subagentModel } : {}),
      gateCount: 0,
      hasGates: gateGuidanceEnabled,
    };

    const hints: RenderingHints = {
      gateGuidanceEnabled,
      frameworkInjectionEnabled: true,
    };

    // Envelope is `null` on this path until something withholds: the CTA rendered here has
    // never carried chain history or gate text (ResponseAssembler owns the envelope-bearing
    // handoff). A manifest alone still produces one, so the sub-agent is told what it is
    // missing even when nothing else is handed across.
    const envelope = applyVisibilityToEnvelope(
      null,
      this.resolveStepVisibility(stepPrompts, nextStepIndex)
    );

    const renderer = new DelegationRenderer();
    return renderer.render(payload, envelope ?? undefined, hints);
  }

  private extractClientProfile(
    chainContext: Record<string, unknown>
  ): RequestClientProfile | undefined {
    const fromIdentityContext = this.asRequestClientProfile(
      (
        chainContext['requestIdentityContext'] as
          { clientProfile?: RequestClientProfile } | undefined
      )?.clientProfile ??
        (
          chainContext['requestIdentityContext'] as
            { identity?: { clientProfile?: RequestClientProfile } } | undefined
        )?.identity?.clientProfile
    );
    if (fromIdentityContext != null) {
      return fromIdentityContext;
    }

    return this.asRequestClientProfile(chainContext['clientProfile']);
  }

  private asRequestClientProfile(value: unknown): RequestClientProfile | undefined {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const candidate = value as Partial<RequestClientProfile>;
    if (
      typeof candidate.clientFamily !== 'string' ||
      typeof candidate.clientId !== 'string' ||
      typeof candidate.clientVersion !== 'string' ||
      typeof candidate.delegationProfile !== 'string'
    ) {
      return undefined;
    }
    return {
      clientFamily: candidate.clientFamily,
      clientId: candidate.clientId,
      clientVersion: candidate.clientVersion,
      delegationProfile: candidate.delegationProfile,
    };
  }

  /**
   * Resolve the P5 visibility decision for the step at `stepIndex`.
   *
   * The projection this builds is the whole of Tier 3's contract with the policy: prior
   * declarations are the steps BEFORE `stepIndex` in run order (their `withhold` reaches this
   * step), and `step` is the step itself (only its `expose` is read — its own `withhold` is
   * about LATER steps and must never reach its own call). `decideVisibility` trusts the slice
   * and does not re-derive order, so the slice is computed here and nowhere else.
   *
   * `stepPrompts` is the node-driven render plan (`planNodeDrivenRender().steps`), not the
   * parse-time array, so an inserted node (P4) counts as a prior step exactly as a planned one
   * does. An inserted node carries no `visibility` of its own, which reads as "declares
   * nothing" — correct: a mutation-inserted step never withheld anything.
   */
  private resolveStepVisibility(
    stepPrompts: readonly ChainStepPrompt[],
    stepIndex: number
  ): VisibilityDecision {
    const current = stepPrompts[stepIndex];
    return decideVisibility({
      step: current?.visibility != null ? { visibility: current.visibility } : {},
      priorDeclarations: stepPrompts
        .slice(0, Math.max(stepIndex, 0))
        .map((step) => (step.visibility != null ? { visibility: step.visibility } : {})),
    });
  }

  /**
   * Remove the accumulated chain-history surface from a render context.
   *
   * These are the keys `TextReferenceStore.buildChainVariables` and
   * `ChainSessionStore.getChainContext` publish for PRIOR steps' results. Deliberately NOT
   * including `previous_step_output` / `previous_step_result`: those are a separate
   * {@link VisibilityItem}, and a step that withholds history while leaving the immediately
   * preceding output in place is a declaration the vocabulary is designed to allow.
   *
   * Named outputs (`outputMapping`) go with the history, because they ARE the history: a named
   * output is a prior step's whole content under an author-chosen name. They used to be spread
   * flat and so could not be told apart from an ordinary argument — the P5-F2 leak. Publishing
   * them under the reserved {@link NAMED_OUTPUT_NAMESPACE} object makes the withhold one delete.
   *
   * Withheld with `chain_history` and NOT with `previous_step_output`, deliberately: a named
   * output is the same content `step{N}_result` publishes positionally, and `previous_step_output`
   * leaves `step{N}_result` in place by design (see the paragraph above). Stripping the named
   * view while the positional view of identical bytes survives would be a stricter rule for the
   * alias than for the thing it aliases — a withhold that depends on which name the author chose.
   */
  private stripChainHistory(templateContext: Record<string, unknown>): void {
    delete templateContext['step_results'];
    delete templateContext['previous_step_results'];
    delete templateContext[NAMED_OUTPUT_NAMESPACE];
    for (const key of Object.keys(templateContext)) {
      if (/^step\d+_result$/.test(key)) {
        delete templateContext[key];
      }
    }
  }

  /**
   * Neutral stand-in for a withheld previous-step output, mirroring the voice of the
   * `**[CONTEXT INSTRUCTION]**` fallback used when the output exists but was not stored.
   * The step is told the output is missing and why — silence would leave the template's
   * `{{previous_step_output}}` rendering as an empty string with no way to tell the two apart.
   */
  private buildWithheldOutputInstruction(
    stepPrompts: readonly ChainStepPrompt[],
    stepIndex: number
  ): string {
    const previousStep = stepPrompts[stepIndex - 1];
    const label = previousStep === undefined ? '' : ` (${this.getPromptDisplayName(previousStep)})`;
    return `**[CONTEXT WITHHELD]**: Step ${stepIndex}${label}'s output was withheld by its visibility declaration. Proceed without it.`;
  }

  /**
   * Apply a withheld set to a render context: strip chain history, and replace any
   * previous-step output already present with the neutral instruction.
   *
   * Used by the gate-review path, where the context is `{...chainContext, ...stepArgs}` and the
   * previous output arrives pre-seeded from `getChainContext` rather than being assigned by an
   * explicit branch as it is on the normal step path.
   */
  private applyWithheldToTemplateContext(
    templateContext: Record<string, unknown>,
    withheld: ReadonlySet<VisibilityItem>,
    stepPrompts: readonly ChainStepPrompt[],
    stepIndex: number
  ): void {
    if (withheld.has('chain_history')) {
      this.stripChainHistory(templateContext);
    }
    // `stepIndex > 0` cannot be false in practice — an item is only withheld when a PRIOR step
    // declared it, which requires at least one — but the instruction text names the preceding
    // ordinal, so it is guarded rather than allowed to render "Step 0".
    if (withheld.has('previous_step_output') && stepIndex > 0) {
      const instruction = this.buildWithheldOutputInstruction(stepPrompts, stepIndex);
      templateContext['previous_step_output'] = instruction;
      templateContext['previous_step_result'] = instruction;
    }
  }

  /**
   * Build Original Request Intent section from chainContext original_args.
   * Provides delivery context so each step knows what the chain was initiated for.
   */
  private buildOriginalIntentSection(chainContext: Record<string, unknown>): string | null {
    const originalArgs = chainContext['original_args'] as Record<string, unknown> | undefined;
    if (!originalArgs || Object.keys(originalArgs).length === 0) {
      return null;
    }

    const lines: string[] = [
      '### Original Request Intent',
      '',
      'This chain was initiated with the following request. Your work must satisfy this intent:',
      '',
    ];

    for (const [key, value] of Object.entries(originalArgs)) {
      const truncated =
        String(value).length > 200 ? String(value).substring(0, 200) + '...' : String(value);
      lines.push(`- **${key}**: ${truncated}`);
    }

    return lines.join('\n');
  }

  /**
   * Build Unknowns Ledger section from chainContext unknowns_ledger.
   * Surfaces run-scoped unknowns declared via the `observations` parameter so each
   * step sees what remains open. Absent entirely when the ledger is missing or empty —
   * `getChainContext` only sets `unknowns_ledger` on the context while non-empty.
   */
  private buildUnknownsSection(chainContext: Record<string, unknown>): string | null {
    const ledger = chainContext['unknowns_ledger'] as UnknownLedgerEntry[] | undefined;
    if (!ledger || ledger.length === 0) {
      return null;
    }

    const blocking = ledger.filter((entry) => entry.state === 'active' && entry.blocking);
    const active = ledger.filter((entry) => entry.state === 'active' && !entry.blocking);
    const resolved = ledger.filter((entry) => entry.state === 'resolved');

    const lines: string[] = [
      '### Unknowns Ledger',
      '',
      'Unknowns declared so far in this run. Resolve blocking unknowns before proceeding where possible:',
      '',
    ];

    for (const entry of [...blocking, ...active]) {
      const flag = entry.blocking ? ' **[BLOCKING]**' : '';
      lines.push(`- **${entry.id}**${flag}: ${this.truncateForLedger(entry.statement)}`);
    }

    for (const entry of resolved) {
      const resolution = entry.resolution ?? 'resolved';
      const resolutionText = entry.resolutionStatement ?? entry.statement;
      lines.push(`- ~~${entry.id}~~ (${resolution}): ${this.truncateForLedger(resolutionText)}`);
    }

    return lines.join('\n');
  }

  /** Matches buildOriginalIntentSection's 200-char truncation convention. */
  private truncateForLedger(value: string): string {
    return value.length > 200 ? value.substring(0, 200) + '...' : value;
  }

  /**
   * Build Required Response Format section for structured delivery verification.
   */
  private buildResponseFormatSection(isFinalStep: boolean, gateGuidanceEnabled: boolean): string {
    const lines: string[] = [
      '---',
      '',
      '### Required Response Format',
      '',
      '**Summary**: What was implemented (2-3 sentences)',
      '',
    ];

    if (gateGuidanceEnabled) {
      lines.push(
        '**Gate Coverage**:',
        '- [1] PASS|FAIL: rationale',
        '- [2] PASS|FAIL: rationale',
        ''
      );
    }

    if (isFinalStep) {
      lines.push('**GATE_REVIEW: PASS|FAIL - overall assessment**');
    }

    return lines.join('\n');
  }

  private isInlineGateId(gateId: string): boolean {
    if (!gateId) {
      return false;
    }
    return gateId.startsWith('temp_') || gateId.startsWith('inline_gate_');
  }

  private getStoredStepResult(
    chainContext: Record<string, unknown>,
    stepNumber: number
  ): string | undefined {
    if (!chainContext) {
      return undefined;
    }

    const stepResults = chainContext['step_results'] as Record<string, string> | undefined;
    if (stepResults) {
      const key = String(stepNumber);
      if (typeof stepResults[key] === 'string' && stepResults[key].trim().length > 0) {
        return stepResults[key];
      }
    }

    const previous = chainContext['previous_step_output'];
    if (typeof previous === 'string' && previous.trim().length > 0) {
      return previous;
    }

    const stepResultKey = `step${stepNumber}_result`;
    const alternate = chainContext[stepResultKey];
    if (typeof alternate === 'string' && alternate.trim().length > 0) {
      return alternate;
    }

    return undefined;
  }

  private normalizeStepArgs(
    argsInput?: Record<string, unknown>,
    prompt?: ConvertedPrompt
  ): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    if (prompt?.arguments) {
      for (const arg of prompt.arguments) {
        if (arg.defaultValue !== undefined) {
          defaults[arg.name] = arg.defaultValue;
        }
      }
    }

    const result =
      !argsInput || typeof argsInput !== 'object' ? defaults : { ...defaults, ...argsInput };

    if (prompt?.arguments) {
      for (const arg of prompt.arguments) {
        if (arg.required && (result[arg.name] === undefined || result[arg.name] === '')) {
          this.logger.warn(
            `[SymbolicChain] Required argument "${arg.name}" missing for prompt "${prompt.id}"`
          );
        }
      }
    }

    return result;
  }

  private async renderTemplate(
    convertedPrompt: ConvertedPrompt,
    templateContext: Record<string, unknown>,
    promptId: string
  ): Promise<string> {
    return this.renderTemplateString(
      convertedPrompt.userMessageTemplate,
      templateContext,
      promptId
    );
  }

  private async renderTemplateString(
    templateString: string,
    templateContext: Record<string, unknown>,
    promptId: string
  ): Promise<string> {
    try {
      // Use reference resolver if available, otherwise fall back to standard template processing
      if (this.referenceResolver || this.scriptReferenceResolver) {
        const result = await processTemplateWithRefs(
          templateString,
          templateContext,
          {},
          this.referenceResolver,
          { scriptResolver: this.scriptReferenceResolver }
        );
        return result.content;
      }

      // Fallback: standard synchronous template processing
      const rendered = processTemplate(templateString, templateContext, {});
      return rendered;
    } catch (error) {
      this.logger.error(`[SymbolicChain] Template rendering failed for ${promptId}:`, error);
      return `[ERROR] Template rendering failed for ${promptId}. Describe how you would proceed manually.`;
    }
  }

  private getPromptDisplayName(step: ChainStepPrompt): string {
    return step.convertedPrompt?.name || step.promptId;
  }

  private resolveReviewStep(
    stepPrompts: readonly ChainStepPrompt[],
    chainContext: Record<string, unknown>,
    pendingReview: PendingGateReview
  ): ChainStepPrompt | undefined {
    if (stepPrompts.length === 0) {
      return undefined;
    }

    const metadataIndex = this.extractStepIndexFromMetadata(pendingReview.metadata);
    if (typeof metadataIndex === 'number') {
      return stepPrompts[this.clampStepIndex(metadataIndex, stepPrompts.length)];
    }

    const promptMetadataIndex =
      pendingReview.prompts
        ?.map((prompt) => this.extractStepIndexFromMetadata(prompt.metadata))
        .find((idx) => typeof idx === 'number') ?? undefined;
    if (typeof promptMetadataIndex === 'number') {
      return stepPrompts[this.clampStepIndex(promptMetadataIndex, stepPrompts.length)];
    }

    const contextStep = this.extractStepIndexFromContext(chainContext);
    if (typeof contextStep === 'number') {
      return stepPrompts[this.clampStepIndex(contextStep, stepPrompts.length)];
    }

    return undefined;
  }

  private extractStepIndexFromContext(chainContext: Record<string, unknown>): number | undefined {
    const raw = chainContext['current_step'];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw > 0 ? raw - 1 : 0;
    }
    if (typeof raw === 'string') {
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isNaN(parsed)) {
        return parsed > 0 ? parsed - 1 : 0;
      }
    }
    return undefined;
  }

  private extractStepIndexFromMetadata(metadata?: Record<string, unknown>): number | undefined {
    if (!metadata || typeof metadata !== 'object') {
      return undefined;
    }

    const directIndex = metadata['stepIndex'] ?? metadata['step_index'];
    if (typeof directIndex === 'number' && Number.isFinite(directIndex)) {
      return directIndex;
    }

    const stepNumber = metadata['stepNumber'] ?? metadata['step_number'];
    if (typeof stepNumber === 'number' && Number.isFinite(stepNumber)) {
      return stepNumber > 0 ? stepNumber - 1 : 0;
    }

    return undefined;
  }

  private clampStepIndex(index: number, totalSteps: number): number {
    const normalizedIndex = Number.isFinite(index) ? Math.floor(index) : totalSteps - 1;
    if (normalizedIndex < 0) {
      return 0;
    }
    if (normalizedIndex >= totalSteps) {
      return totalSteps - 1;
    }
    return normalizedIndex;
  }

  private collectReviewGateIds(
    pendingReview: PendingGateReview,
    additionalGateIds: readonly string[],
    reviewStep?: ChainStepPrompt
  ): { gateIds: string[]; explicitGateIds: string[] } {
    const gateSet = new Set<string>();
    const explicitSet = new Set<string>();
    const addGate = (gateId: unknown, explicit = false) => {
      if (typeof gateId !== 'string' || gateId.trim().length === 0) {
        return;
      }
      gateSet.add(gateId);
      if (explicit) {
        explicitSet.add(gateId);
      }
    };

    pendingReview.gateIds?.forEach((gateId) => addGate(gateId));
    additionalGateIds?.forEach((gateId) => addGate(gateId));
    reviewStep?.inlineGateIds?.forEach((gateId) => addGate(gateId, true));

    pendingReview.prompts?.forEach((prompt) => {
      addGate(prompt.gateId, true);
      const inlineMetadata = this.extractInlineGateIdsFromMetadata(prompt.metadata);
      inlineMetadata.forEach((gateId) => addGate(gateId, true));
    });

    if (pendingReview.metadata) {
      const inlineMetadata = this.extractInlineGateIdsFromMetadata(pendingReview.metadata);
      inlineMetadata.forEach((gateId) => addGate(gateId, true));
    }

    return {
      gateIds: Array.from(gateSet),
      explicitGateIds: Array.from(explicitSet),
    };
  }

  private extractInlineGateIdsFromMetadata(metadata?: Record<string, unknown>): string[] {
    if (!metadata || typeof metadata !== 'object') {
      return [];
    }
    const value = metadata['inlineGateIds'] ?? metadata['inline_gate_ids'];
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
    );
  }
}
