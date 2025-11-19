// @lifecycle canonical - Runs operator executors and orchestrates outputs.
import { processTemplate } from '../../../utils/jsonUtils.js';
import { BasePipelineStage } from '../stage.js';

import type { ChainSessionService } from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type {
  ChainOperatorExecutor,
  ChainStepRenderResult,
} from '../../operators/chain-operator-executor.js';

/**
 * Pipeline Stage 9: Step Execution
 *
 * Executes prompts and chain steps with template rendering, framework injection,
 * and gate-enhanced content for quality validation.
 *
 * Dependencies: context.executionPlan, context.convertedPrompt or context.parsedCommand.steps
 * Output: Rendered prompt content ready for LLM execution
 * Can Early Exit: No
 */
export class StepExecutionStage extends BasePipelineStage {
  readonly name = 'StepExecution';

  constructor(
    private readonly chainOperatorExecutor: ChainOperatorExecutor,
    private readonly chainSessionManager: ChainSessionService,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.response) {
      this.logExit({ skipped: 'Response already prepared' });
      return;
    }

    if (context.sessionContext?.pendingReview) {
      this.logExit({ skipped: 'Pending gate review detected' });
      return;
    }

    if (!context.executionPlan) {
      this.handleError(new Error('Execution plan missing before step execution'));
    }

    // Execute the prompt/chain step regardless of pending review
    // The ResponseFormattingStage will handle appending gate instructions
    // Use type guard for type-safe chain detection
    if (context.executionPlan.strategy === 'chain' && context.hasChainCommand()) {
      await this.executeChainStep(context);
      return;
    }

    await this.executeSinglePrompt(context);
  }

  private async executeChainStep(context: ExecutionContext): Promise<void> {
    // Type-safe access using direct field access with proper null checks
    const session = context.sessionContext;
    const steps = context.parsedCommand?.steps;
    const executionPlan = context.executionPlan;

    if (!session) {
      throw new Error('Session context not available for chain execution');
    }

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      throw new Error('Chain steps not available for chain execution');
    }

    if (!executionPlan) {
      throw new Error('Execution plan not available for chain execution');
    }

    const currentStepIndex = Math.max(0, (session.currentStep ?? 1) - 1);
    const currentStep = steps[currentStepIndex];
    const chainContextSnapshot = this.chainSessionManager.getChainContext(session.sessionId);

    const normalizedStepArgs = currentStep.args ?? {};

    const renderResult = await this.chainOperatorExecutor.renderStep({
      executionType: 'normal',
      stepPrompts: steps,
      currentStepIndex,
      chainContext: {
        ...chainContextSnapshot,
        sessionId: session.sessionId,
        chainRunId: session.sessionId,
        chainId: session.chainId,
        chain_id: session.chainId,
        promptArgs: normalizedStepArgs,
        currentStepArgs: normalizedStepArgs,
      },
      additionalGateIds: executionPlan.gates,
    });

    context.executionResults = this.createExecutionResults(renderResult);
    this.logExit({ stepRendered: renderResult.stepNumber });
  }

  private async executeSinglePrompt(context: ExecutionContext): Promise<void> {
    // Type-safe access using direct field access with proper null checks
    const prompt = context.parsedCommand?.convertedPrompt;
    const executionPlan = context.executionPlan;

    if (!prompt) {
      throw new Error('Converted prompt not available for single prompt execution');
    }

    if (!executionPlan) {
      throw new Error('Execution plan not available for single prompt execution');
    }

    const args = context.getPromptArgs();
    const renderedTemplate = processTemplate(prompt.userMessageTemplate, args, {});
    const sections: string[] = [];

    // Deduplication: Skip frameworkContext.systemPrompt if prompt.systemMessage already contains framework guidance
    const systemMessageHasFramework = this.hasFrameworkGuidance(prompt.systemMessage);

    if (context.frameworkContext?.systemPrompt && !systemMessageHasFramework) {
      sections.push(context.frameworkContext.systemPrompt.trim());
      this.logger.debug('StepExecution: Added framework system prompt from context');
    } else if (systemMessageHasFramework) {
      this.logger.debug(
        'StepExecution: Skipped framework context injection (already in prompt.systemMessage)'
      );
    }

    if (prompt.systemMessage?.trim()) {
      sections.push(prompt.systemMessage.trim());
    }

    sections.push(renderedTemplate);

    const combinedContent = sections.filter(Boolean).join('\n\n');

    context.executionResults = {
      content: combinedContent,
      metadata: {
        promptId: prompt.id,
        executionMode: executionPlan.strategy,
        gateIds: executionPlan.gates,
      },
      generatedAt: Date.now(),
    };

    this.logExit({ promptId: prompt.id });
  }

  private createExecutionResults(renderResult: ChainStepRenderResult) {
    return {
      content: renderResult.content,
      metadata: {
        stepNumber: renderResult.stepNumber,
        totalSteps: renderResult.totalSteps,
        promptId: renderResult.promptId,
        promptName: renderResult.promptName,
        callToAction: renderResult.callToAction,
      },
      generatedAt: Date.now(),
    };
  }

  /**
   * Detects if a system message already contains framework methodology guidance.
   * Used to prevent duplicate framework injection.
   */
  private hasFrameworkGuidance(systemMessage?: string): boolean {
    if (!systemMessage) return false;

    // Check for any of these strong indicators that framework guidance is already present
    const frameworkIndicators = [
      'Apply the C.A.G.E.E.R.F methodology systematically',
      'Apply the ReACT methodology systematically',
      'Apply the 5W1H methodology systematically',
      'Apply the SCAMPER methodology systematically',
      'You are operating under the C.A.G.E.E.R.F',
      'You are operating under the ReACT',
      'You are operating under the 5W1H',
      'You are operating under the SCAMPER',
      '**Context**: Establish comprehensive situational awareness', // CAGEERF specific
      '**Reasoning**: Think through the problem', // ReACT specific
    ];

    // Any single match is enough to confirm framework guidance exists
    return frameworkIndicators.some((indicator) => systemMessage.includes(indicator));
  }
}
