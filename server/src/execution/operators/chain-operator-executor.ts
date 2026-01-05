// @lifecycle canonical - Executes chain operator steps within the pipeline.
import { DEFAULT_GATE_RETRY_CONFIG } from '../../gates/constants.js';
import { composeReviewPrompt } from '../../gates/core/review-utils.js';
import { Logger } from '../../logging/index.js';
import { safeJsonParse } from '../../utils/index.js';
import { processTemplate, processTemplateWithRefs } from '../../utils/jsonUtils.js';

import type {
  ChainStepExecutionInput,
  ChainStepPrompt,
  ChainStepRenderResult,
  GateReviewInput,
  NormalStepInput,
} from './types.js';
import type { PromptGuidanceService } from '../../frameworks/prompt-guidance/index.js';
import type { PendingGateReview } from '../../mcp-tools/prompt-engine/core/types.js';
import type { ConvertedPrompt } from '../../types/index.js';
import type { IScriptReferenceResolver } from '../../utils/jsonUtils.js';
import type { InjectionState } from '../pipeline/decisions/injection/types.js';
import type { PromptReferenceResolver } from '../reference/index.js';

/**
 * Type guard for gate review input
 */
function isGateReviewInput(input: ChainStepExecutionInput): input is GateReviewInput {
  return input.executionType === 'gate_review';
}

/**
 * Type guard for normal step input
 */
function isNormalStepInput(input: ChainStepExecutionInput): input is NormalStepInput {
  return input.executionType === 'normal';
}

export class ChainOperatorExecutor {
  constructor(
    private readonly logger: Logger,
    private readonly convertedPrompts: ConvertedPrompt[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly gateGuidanceRenderer?: any,
    private readonly getFrameworkContext?: (promptId: string) => Promise<{
      selectedFramework?: { methodology: string; name: string };
      category?: string;
      systemPrompt?: string;
    } | null>,
    private readonly promptGuidanceService?: PromptGuidanceService,
    private readonly referenceResolver?: PromptReferenceResolver,
    private readonly scriptReferenceResolver?: IScriptReferenceResolver
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
      'Use the resume shortcut below and respond via gate_verdict as `GATE_REVIEW: PASS` or `GATE_REVIEW: FAIL - reason` to resume the workflow.';

    // Get the last actual step that was executed
    const fallbackIndex = stepPrompts.length - 1;
    const lastStepIndex = reviewStep
      ? stepPrompts.findIndex((step) => step.stepNumber === reviewStep.stepNumber)
      : fallbackIndex;
    const targetStep =
      reviewStep ??
      (lastStepIndex >= 0 ? stepPrompts[lastStepIndex] : (stepPrompts[fallbackIndex] ?? undefined));

    // Build concise PASS/FAIL warning at top
    const gateWarning = [
      '---',
      '',
      '## ⚠️ QUALITY GATE VALIDATION',
      '',
      'You MUST **execute** the task below, then **validate** your output against the quality gates.',
      '',
      '**Format:** Start response with `GATE_REVIEW: PASS` or `GATE_REVIEW: FAIL`, then explain why.',
      '',
      '---',
      '',
    ].join('\n');

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
            {}
        );
        const templateContext = { ...chainContext, ...stepArgs };

        const renderedTemplate = await this.renderTemplate(
          convertedPrompt,
          templateContext,
          targetStep.promptId
        );

        originalContent = [
          '## Original Task Instructions',
          '',
          renderedTemplate,
          '',
          '---',
          '',
        ].join('\n');
      }
    }

    // Build gate guidance using proper renderer for framework-aware, category-aware rendering
    let gateGuidance = '';
    if (gateGuidanceEnabled && gateIdsToRender.length > 0) {
      // Get framework and category context if available
      let frameworkMethodology = 'CAGEERF';
      let category = 'general';

      const reviewStepContext = await this.resolveFrameworkContext(targetStep ?? undefined);
      if (reviewStepContext) {
        frameworkMethodology = reviewStepContext.selectedFramework?.methodology || 'CAGEERF';
        category = reviewStepContext.category || 'general';
      }

      // Use GateGuidanceRenderer to properly render gates (handles temp gates, framework filtering, etc.)
      if (this.gateGuidanceRenderer) {
        try {
          gateGuidance = await this.gateGuidanceRenderer.renderGuidance(gateIdsToRender, {
            framework: frameworkMethodology,
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

    // Build attempt tracking and streamlined retry hints
    // Use default from constants when not specified in pending review
    const attemptCount = pendingGateReview?.attemptCount ?? 0;
    const maxAttempts = pendingGateReview?.maxAttempts ?? DEFAULT_GATE_RETRY_CONFIG.max_attempts;
    const attemptSummary = `**Review Attempts:** ${Math.min(
      attemptCount + 1, // Display as 1-indexed (Attempt 1 of 2, not 0 of 2)
      maxAttempts
    )}/${maxAttempts}`;

    const supplementalSections: string[] = [attemptSummary];

    if (hasInlineGateFocus) {
      supplementalSections.push(
        '**Inline Gate Priority:** These inline criteria triggered the review. Fix them before checking framework standards.'
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

    // Build framework guidance for gate reviews if enabled
    let frameworkGuidance = '';
    if (frameworkInjectionEnabled && targetStep) {
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
    const reviewPrompt = this.buildManualReviewBody(pendingGateReview) ?? originalContent;

    const contentParts = [
      frameworkGuidance,
      gateWarning,
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
      (chainContext['currentStepArgs'] as Record<string, unknown> | undefined) ?? step?.args ?? {}
    );

    const templateContext: Record<string, unknown> = {
      ...chainContext,
      ...stepArgs,
    };

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

    // Runtime Semantic Enhancement (Self-Loop)
    let templateToRender = convertedPrompt.userMessageTemplate;

    if (this.promptGuidanceService && templateContext['previous_step_output']) {
      const previousOutputStr = String(templateContext['previous_step_output']);
      // Simple check to see if it looks like JSON
      if (previousOutputStr.trim().startsWith('{')) {
        const parseResult = safeJsonParse(previousOutputStr);
        if (
          parseResult.success &&
          parseResult.data &&
          (parseResult.data.complexity ||
            parseResult.data.intent ||
            parseResult.data.selected_resources)
        ) {
          this.logger.info(
            `[SymbolicChain] Applying runtime enhancement based on Judge result for step ${step.stepNumber}`
          );
          try {
            templateToRender = await this.promptGuidanceService.applyRuntimeEnhancement(
              templateToRender,
              parseResult.data,
              this.convertedPrompts
            );
          } catch (error) {
            this.logger.warn('[SymbolicChain] Runtime enhancement failed', error);
          }
        }
      }
    }

    const renderedTemplate = await this.renderTemplateString(
      templateToRender,
      templateContext,
      step.promptId
    );

    const lines: string[] = [];
    const stepNumber = currentStepIndex + 1;
    const isFirstStep = currentStepIndex === 0;
    const isFinalStep = currentStepIndex === totalSteps - 1;

    if (isFirstStep) {
      const metadataSection = this.renderChainMetadataSection(chainContext, totalSteps);
      if (metadataSection) {
        lines.push(metadataSection);
      }
    }

    // Use target-aware helper to determine if framework should be suppressed on steps
    const suppressFrameworkInjection = this.shouldSuppressFrameworkForSteps(chainContext);
    const gateGuidanceEnabled = this.isGateGuidanceEnabled(chainContext);

    if (!suppressFrameworkInjection && !this.hasFrameworkGuidance(convertedPrompt?.systemMessage)) {
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

    const callToAction = !isFinalStep
      ? `Use the resume shortcut below to rerun prompt_engine and paste your latest answer into user_response so Step ${
          stepNumber + 1
        } can begin.`
      : 'Deliver the final response to the user (no user_response needed once the chain completes).';

    const content = lines.filter(Boolean).join('\n\n').trimEnd();

    return {
      stepNumber,
      totalSteps,
      promptId: step.promptId,
      promptName,
      content,
      callToAction,
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
      sections.push('\n\n###  Inline Quality Criteria (PRIMARY)\n');
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
      | { gateGuidance?: { inject?: boolean } }
      | undefined;

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

    return [
      '---',
      '',
      '## 🎯 Framework Methodology Active',
      '',
      `**${frameworkName}**`,
      '',
      systemPrompt,
      '',
      '---',
      '',
    ].join('\n');
  }

  private async resolveFrameworkContext(step?: ChainStepPrompt): Promise<{
    selectedFramework?: { methodology: string; name: string };
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

  private renderChainMetadataSection(
    chainContext: Record<string, unknown>,
    totalSteps: number
  ): string | null {
    // Chain metadata banner removed to reduce redundant instructions.
    return null;
  }

  private isInlineGateId(gateId: string): boolean {
    if (!gateId) {
      return false;
    }
    return gateId.startsWith('temp_') || gateId.startsWith('inline_gate_');
  }

  private hasFrameworkGuidance(systemMessage?: string): boolean {
    if (!systemMessage) {
      return false;
    }

    const frameworkIndicators = [
      'Apply the C.A.G.E.E.R.F methodology systematically',
      'Apply the ReACT methodology systematically',
      'Apply the 5W1H methodology systematically',
      'Apply the SCAMPER methodology systematically',
      'You are operating under the C.A.G.E.E.R.F',
      'You are operating under the ReACT',
      'You are operating under the 5W1H',
      'You are operating under the SCAMPER',
      '**Context**: Establish comprehensive situational awareness',
      '**Reasoning**: Think through the problem',
    ];

    return frameworkIndicators.some((indicator) => systemMessage.includes(indicator));
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

  private buildManualReviewBody(pendingReview?: PendingGateReview): string | null {
    if (!pendingReview) {
      return null;
    }

    if (pendingReview.combinedPrompt && pendingReview.combinedPrompt.trim().length > 0) {
      return pendingReview.combinedPrompt;
    }

    if (pendingReview.prompts && pendingReview.prompts.length > 0) {
      const composed = composeReviewPrompt(
        pendingReview.prompts,
        pendingReview.previousResponse,
        pendingReview.retryHints ?? []
      );
      return composed.combinedPrompt;
    }

    return null;
  }

  private normalizeStepArgs(argsInput?: Record<string, unknown>): Record<string, unknown> {
    if (!argsInput || typeof argsInput !== 'object') {
      return {};
    }

    return { ...argsInput };
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

  private buildChainSummary(stepPrompts: ChainStepPrompt[]): string {
    if (stepPrompts.length === 0) {
      return '(no steps)';
    }

    return stepPrompts.map((step) => this.getPromptDisplayName(step)).join(' → ');
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
