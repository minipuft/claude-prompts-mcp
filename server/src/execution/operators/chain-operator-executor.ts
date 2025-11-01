import { Logger } from "../../logging/index.js";
import type { PromptData, ConvertedPrompt } from "../../types/index.js";
import { processTemplate } from "../../utils/jsonUtils.js";

export interface ChainStepPrompt {
  stepNumber: number;
  promptId: string;
  args: string;
  promptData?: PromptData;
  convertedPrompt?: ConvertedPrompt;
}

export interface ChainStepExecutionInput {
  stepPrompts: ChainStepPrompt[];
  currentStepIndex: number;
  chainContext?: Record<string, any>;
}

export interface ChainStepRenderResult {
  stepNumber: number;
  totalSteps: number;
  promptId: string;
  promptName: string;
  content: string;
  callToAction: string;
}

export class ChainOperatorExecutor {
  constructor(
    private readonly logger: Logger,
    private readonly promptsData: PromptData[],
    private readonly convertedPrompts: ConvertedPrompt[],
    private readonly enhanceContent: (
      content: string,
      prompt: ConvertedPrompt,
      context?: { scopeId?: string; scope?: 'execution' | 'session' | 'chain' | 'step' }
    ) => Promise<string>
  ) {}

  async renderStep(input: ChainStepExecutionInput): Promise<ChainStepRenderResult> {
    const { stepPrompts, currentStepIndex, chainContext = {} } = input;

    if (stepPrompts.length === 0) {
      return {
        stepNumber: 0,
        totalSteps: 0,
        promptId: "",
        promptName: "",
        content: "No executable steps detected in symbolic chain.",
        callToAction: "",
      };
    }

    if (currentStepIndex < 0 || currentStepIndex >= stepPrompts.length) {
      throw new Error(`Invalid step index ${currentStepIndex} for chain of length ${stepPrompts.length}`);
    }

    const step = stepPrompts[currentStepIndex];
    this.logger.debug(`[SymbolicChain] Rendering step ${step.stepNumber}: ${step.promptId}`);

    const promptData = this.resolvePromptData(step);
    const convertedPrompt = this.resolveConvertedPrompt(step, promptData);
    const promptName = promptData?.name || convertedPrompt?.name || step.promptId;

    const stepArgs = this.parseStepArguments(step.args);

    const templateContext: Record<string, any> = {
      ...chainContext,
      ...stepArgs,
    };

    const totalSteps = stepPrompts.length;
    const previousStepIndex = currentStepIndex - 1;

    if (currentStepIndex === 0) {
      templateContext.previous_step_output = "**[CONTEXT INSTRUCTION]**: This is the first step. Begin the workflow here.";
      templateContext.previous_step_result = templateContext.previous_step_output;
    } else {
      const previousName = this.getPromptDisplayName(stepPrompts[previousStepIndex]);
      const instruction = `**[CONTEXT INSTRUCTION]**: Use the response you produced for Step ${currentStepIndex} (${previousName}) wherever {{previous_step_output}} is referenced.`;
      templateContext.previous_step_output = instruction;
      templateContext.previous_step_result = instruction;
    }

    let renderedTemplate = this.renderTemplate(convertedPrompt, templateContext, step.promptId);

    // Apply framework guidance and quality gates using shared enhancement method
    if (convertedPrompt) {
      renderedTemplate = await this.enhanceContent(
        renderedTemplate,
        convertedPrompt,
        { scopeId: undefined, scope: 'step' as const }
      );
    }

    const lines: string[] = [];
    const stepNumber = currentStepIndex + 1;
    const isFirstStep = currentStepIndex === 0;
    const isFinalStep = currentStepIndex === totalSteps - 1;

    if (convertedPrompt?.systemMessage) {
      lines.push(`> ${convertedPrompt.systemMessage}`);
    }

    lines.push(renderedTemplate.trim());

    const callToAction = !isFinalStep
      ? `Run the same command to continue with Step ${stepNumber + 1}.`
      : "Deliver the final response to the user.";

    const content = lines.filter(Boolean).join("\n\n").trimEnd();

    return {
      stepNumber,
      totalSteps,
      promptId: step.promptId,
      promptName,
      content,
      callToAction,
    };
  }

  /**
   * Parse step arguments from string format
   * Supports: key="value" key2="value2" or simple JSON
   */
  private parseStepArguments(argsString: string): Record<string, any> {
    if (!argsString || argsString.trim() === '') {
      return {};
    }

    const trimmed = argsString.trim();

    // Try JSON parse first
    if (trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        this.logger.debug('[SymbolicChain] Failed to parse as JSON, trying key=value format');
      }
    }

    // Parse key="value" format
    const args: Record<string, any> = {};
    const regex = /(\w+)=["']([^"']+)["']|(\w+)=(\S+)/g;
    let match;

    while ((match = regex.exec(trimmed)) !== null) {
      const key = match[1] || match[3];
      const value = match[2] || match[4];
      args[key] = value;
    }

    // If no matches, treat entire string as single argument
    if (Object.keys(args).length === 0) {
      args.input = trimmed;
    }

    return args;
  }

  private resolvePromptData(step: ChainStepPrompt): PromptData | undefined {
    if (step.promptData) {
      return step.promptData;
    }

    const prompt = this.promptsData.find(
      (p) =>
        p.id.toLowerCase() === step.promptId.toLowerCase() ||
        (p.name && p.name.toLowerCase() === step.promptId.toLowerCase())
    );

    if (!prompt) {
      this.logger.warn(`[SymbolicChain] Prompt not found: ${step.promptId}`);
    }

    return prompt;
  }

  private resolveConvertedPrompt(step: ChainStepPrompt, promptData?: PromptData): ConvertedPrompt | undefined {
    if (step.convertedPrompt) {
      return step.convertedPrompt;
    }

    if (!promptData) {
      return undefined;
    }

    const converted = this.convertedPrompts.find((p) => p.id === promptData.id);

    if (!converted) {
      this.logger.warn(`[SymbolicChain] Converted prompt not found for: ${step.promptId}`);
    }

    return converted;
  }

  private renderTemplate(
    convertedPrompt: ConvertedPrompt | undefined,
    templateContext: Record<string, any>,
    promptId: string
  ): string {
    if (!convertedPrompt) {
      return `Execute the prompt "${promptId}" with the provided arguments.`;
    }

    try {
      const rendered = processTemplate(
        convertedPrompt.userMessageTemplate,
        templateContext,
        {}
      );

      return rendered;
    } catch (error) {
      this.logger.error(`[SymbolicChain] Template rendering failed for ${promptId}:`, error);
      return `[ERROR] Template rendering failed for ${promptId}. Describe how you would proceed manually.`;
    }
  }

  private getPromptDisplayName(step: ChainStepPrompt): string {
    const promptData = step.promptData || this.resolvePromptData(step);
    return promptData?.name || step.promptId;
  }

  private buildChainSummary(stepPrompts: ChainStepPrompt[]): string {
    if (stepPrompts.length === 0) {
      return "(no steps)";
    }

    return stepPrompts
      .map((step) => this.getPromptDisplayName(step))
      .join(" → ");
  }

}
