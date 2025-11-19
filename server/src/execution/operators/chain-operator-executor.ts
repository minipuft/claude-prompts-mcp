// @lifecycle canonical - Executes chain operator steps within the pipeline.
import { Logger } from '../../logging/index.js';
import { processTemplate } from '../../utils/jsonUtils.js';

import type { PendingGateReview } from '../../mcp-tools/prompt-engine/core/types.js';
import type { ConvertedPrompt } from '../../types/index.js';
import type { FrameworkExecutionContext } from '../../frameworks/types/index.js';
import type { ExecutionPlan } from '../context/execution-context.js';

export interface ChainStepPrompt {
  readonly stepNumber: number;
  readonly promptId: string;
  readonly args: Record<string, unknown>;
  readonly inlineGateCriteria?: readonly string[];
  inlineGateIds?: string[];
  convertedPrompt?: ConvertedPrompt; // Optional - looked up if not provided
  metadata?: Record<string, unknown>; // For storing step-specific data like gate instructions
  executionPlan?: ExecutionPlan;
  frameworkContext?: FrameworkExecutionContext;
}

/**
 * Base interface for all chain step execution inputs
 */
interface BaseChainStepExecutionInput {
  readonly stepPrompts: readonly ChainStepPrompt[];
  readonly chainContext?: Record<string, unknown>;
  readonly additionalGateIds?: readonly string[];
  readonly inlineGuidanceText?: string;
}

/**
 * Normal step execution (non-review)
 */
export interface NormalStepInput extends BaseChainStepExecutionInput {
  readonly executionType: 'normal';
  readonly currentStepIndex: number;
}

/**
 * Gate review step execution
 */
export interface GateReviewInput extends BaseChainStepExecutionInput {
  readonly executionType: 'gate_review';
  readonly pendingGateReview: PendingGateReview;
}

/**
 * Discriminated union for chain step execution inputs
 */
export type ChainStepExecutionInput = NormalStepInput | GateReviewInput;

export interface ChainStepRenderResult {
  stepNumber: number;
  totalSteps: number;
  promptId: string;
  promptName: string;
  content: string;
  callToAction: string;
}

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
    private readonly gateGuidanceRenderer?: any,
    private readonly getFrameworkContext?: (
      promptId: string
    ) => Promise<{
      selectedFramework?: { methodology: string; name: string };
      category?: string;
      systemPrompt?: string;
    } | null>
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
      return this.renderGateReviewStep(input, stepPrompts, chainContext, additionalGateIds, inlineGuidanceText);
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

    this.logger.debug(`[SymbolicChain] Rendering synthetic gate review step`);
    const totalSteps = stepPrompts.length + 1;
    const stepNumber = totalSteps;
    const gateIdsToRender =
      (pendingGateReview?.gateIds?.length ? pendingGateReview.gateIds : additionalGateIds) || [];
    const hasInlineGateFocus =
      gateIdsToRender.some((gateId) => this.isInlineGateId(gateId)) ||
      Boolean(inlineGuidanceText);
    const callToAction =
      'Use the resume shortcut below and respond via gate_verdict as `GATE_REVIEW: PASS` or `GATE_REVIEW: FAIL - reason` to resume the workflow.';

    // Get the last actual step that was executed
    const lastStepIndex = stepPrompts.length - 1;
    const lastStep = lastStepIndex >= 0 ? stepPrompts[lastStepIndex] : undefined;

    // Build concise PASS/FAIL warning at top
    const gateWarning = `---

## ⚠️ QUALITY GATE VALIDATION

You MUST **execute** the task below, then **validate** your output against the quality gates.

**Format:** Start response with \`GATE_REVIEW: PASS\` or \`GATE_REVIEW: FAIL\`, then explain why.

---
`;
    const reviewOrderNote = hasInlineGateFocus
      ? '\n**Review Order:** Start with inline criteria, then verify framework standards before responding.\n'
      : '';

    // Get original content from last step if available
    let originalContent = '';
    if (lastStep) {
      // Look up convertedPrompt if not already set
      const convertedPrompt =
        lastStep.convertedPrompt || this.convertedPrompts.find((p) => p.id === lastStep.promptId);

      if (convertedPrompt) {
        // Prioritize currentStepArgs from chainContext (pipeline integration)
        // Fall back to lastStep.args for backward compatibility
        const stepArgs = this.normalizeStepArgs((chainContext['currentStepArgs'] as Record<string, unknown> | undefined) ?? lastStep.args);
        const templateContext = { ...chainContext, ...stepArgs };

        const renderedTemplate = this.renderTemplate(
          convertedPrompt,
          templateContext,
          lastStep.promptId
        );

        originalContent = `## Original Task Instructions

${renderedTemplate}

---
`;
      }
    }

    // Build gate guidance using proper renderer for framework-aware, category-aware rendering
    let gateGuidance = '';
    if (gateIdsToRender.length > 0) {
      // Get framework and category context if available
      let frameworkMethodology = 'CAGEERF';
      let category = 'general';

      const lastStepContext = await this.resolveFrameworkContext(lastStep ?? undefined);
      if (lastStepContext) {
        frameworkMethodology = lastStepContext.selectedFramework?.methodology || 'CAGEERF';
        category = lastStepContext.category || 'general';
      }

      // Use GateGuidanceRenderer to properly render gates (handles temp gates, framework filtering, etc.)
      if (this.gateGuidanceRenderer) {
        try {
          gateGuidance = await this.gateGuidanceRenderer.renderGuidance(gateIdsToRender, {
            framework: frameworkMethodology,
            category,
            promptId: lastStep?.promptId,
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
    } else if (inlineGuidanceText) {
      gateGuidance = this.renderSimpleGateGuidance([], inlineGuidanceText);
    }

    // Build attempt tracking and streamlined retry hints
    const attemptCount = pendingGateReview?.attemptCount ?? 0;
    const maxAttempts = pendingGateReview?.maxAttempts ?? Math.max(1, attemptCount || 3);
    const attemptSummary = `**Review Attempts:** ${Math.min(
      attemptCount,
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

    // Assemble in proper order: Warning → Content → Gates → Metadata
    const contentParts = [
      gateWarning,
      reviewOrderNote,
      originalContent,
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
        content: `Execute the prompt "${step.promptId}"`,
        callToAction: 'Complete this step manually',
      };
    }

    const promptName = convertedPrompt.name || step.promptId;

    // Prioritize currentStepArgs from chainContext (pipeline integration)
    // Fall back to step-level args captured during parsing
    const stepArgs = this.normalizeStepArgs((chainContext['currentStepArgs'] as Record<string, unknown> | undefined) ?? step.args);

    const templateContext: Record<string, unknown> = {
      ...chainContext,
      ...stepArgs,
    };

    const totalSteps = stepPrompts.length;
    const previousStepIndex = currentStepIndex - 1;

    if (currentStepIndex === 0) {
      templateContext.previous_step_output =
        '**[CONTEXT INSTRUCTION]**: This is the first step. Begin the workflow here.';
      templateContext.previous_step_result = templateContext.previous_step_output;
    } else {
      const storedOutput = this.getStoredStepResult(
        chainContext,
        stepPrompts[previousStepIndex].stepNumber
      );

      if (storedOutput) {
        templateContext.previous_step_output = storedOutput;
        templateContext.previous_step_result = storedOutput;
      } else {
        const previousName = this.getPromptDisplayName(stepPrompts[previousStepIndex]);
        const instruction = `**[CONTEXT INSTRUCTION]**: Use the response you produced for Step ${currentStepIndex} (${previousName}) wherever {{previous_step_output}} is referenced.`;
        templateContext.previous_step_output = instruction;
        templateContext.previous_step_result = instruction;
      }
    }

    const renderedTemplate = this.renderTemplate(convertedPrompt, templateContext, step.promptId);

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

    if (!this.hasFrameworkGuidance(convertedPrompt?.systemMessage)) {
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
    if (step.metadata?.['gateInstructions'] && typeof step.metadata['gateInstructions'] === 'string') {
      lines.push(step.metadata['gateInstructions'] as string);
    }

    const callToAction = !isFinalStep
      ? `Use the resume shortcut below to rerun prompt_engine and paste your latest answer into user_response so Step ${stepNumber + 1} can begin.`
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

  private renderSimpleGateGuidance(gateIds: readonly string[], inlineGuidanceText?: string): string {
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
      sections.push('\n\n>  Start with inline criteria, then verify framework standards.\n');
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
      '\nReview your output against these quality standards before finalizing your response.'
    );
    sections.push('\n\n---\n');

    return sections.join('');
  }

  private async buildFrameworkGuidance(step: ChainStepPrompt): Promise<string | null> {
    const context = await this.resolveFrameworkContext(step);
    const systemPrompt = context?.systemPrompt?.trim();
    const frameworkName = context?.selectedFramework?.name?.trim();

    if (!systemPrompt || !frameworkName) {
      return null;
    }

    return `---

## 🎯 Framework Methodology Active

**${frameworkName}**

${systemPrompt}

---
`;
  }

  private async resolveFrameworkContext(
    step?: ChainStepPrompt
  ): Promise<{
    selectedFramework?: { methodology: string; name: string };
    category?: string;
    systemPrompt?: string;
  } | null> {
    if (!step) {
      return null;
    }

    if (step.frameworkContext) {
      return {
        selectedFramework: step.frameworkContext.selectedFramework,
        category: step.convertedPrompt?.category,
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
    const metadata = chainContext['chain_metadata'];
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }

    const chainMeta = metadata as Record<string, unknown>;
    const {
      chainId,
      name,
      description,
      category,
      framework,
      gates,
      inlineGateIds,
      chainRunId,
    } = chainMeta;

    const lines: string[] = ['## 📊 Chain Metadata'];
    lines.push(`**Chain**: ${name ?? chainId ?? 'unnamed'} (${chainId ?? 'n/a'})`);
    if (description && typeof description === 'string' && description.trim().length > 0) {
      lines.push(`**Description**: ${description.trim()}`);
    }
    if (category && typeof category === 'string') {
      lines.push(`**Category**: ${category}`);
    }
    const total =
      typeof chainMeta['totalSteps'] === 'number' ? (chainMeta['totalSteps'] as number) : totalSteps;
    lines.push(`**Total Steps**: ${total}`);
    if (framework && typeof framework === 'string') {
      lines.push(`**Framework**: ${framework}`);
    }
    if (chainRunId && typeof chainRunId === 'string') {
      lines.push(`**Archive Run ID**: ${chainRunId}`);
    }

    const gateSummaries: string[] = [];
    if (Array.isArray(gates) && gates.length > 0) {
      gateSummaries.push(`- Step Gates: ${gates.join(', ')}`);
    }
    if (Array.isArray(inlineGateIds) && inlineGateIds.length > 0) {
      gateSummaries.push(`- Inline Gates: ${inlineGateIds.join(', ')}`);
    }
    if (gateSummaries.length > 0) {
      lines.push('**Quality Gates**:');
      lines.push(...gateSummaries);
    }

    lines.push('**Execution Notes:** Execute steps sequentially, maintain shared context, and validate each output before proceeding.');
    return lines.join('\n');
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

  private normalizeStepArgs(argsInput?: Record<string, unknown>): Record<string, unknown> {
    if (!argsInput || typeof argsInput !== 'object') {
      return {};
    }

    return { ...argsInput };
  }

  private renderTemplate(
    convertedPrompt: ConvertedPrompt,
    templateContext: Record<string, unknown>,
    promptId: string
  ): string {
    try {
      const rendered = processTemplate(convertedPrompt.userMessageTemplate, templateContext, {});

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
}
