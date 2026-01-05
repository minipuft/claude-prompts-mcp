// @lifecycle canonical - Runs operator executors and orchestrates outputs.
import { hasFrameworkGuidance } from '../../../frameworks/utils/framework-detection.js';
import { processTemplateWithRefs } from '../../../utils/jsonUtils.js';
import { BasePipelineStage } from '../stage.js';

import type { ChainSessionService } from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type { IScriptReferenceResolver } from '../../../utils/jsonUtils.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ChainOperatorExecutor } from '../../operators/chain-operator-executor.js';
import type { ChainStepRenderResult } from '../../operators/types.js';
import type { PromptReferenceResolver } from '../../reference/prompt-reference-resolver.js';

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
    logger: Logger,
    private readonly referenceResolver?: PromptReferenceResolver,
    private readonly scriptReferenceResolver?: IScriptReferenceResolver
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

    const totalSteps = steps.length;
    const currentStepNumber = session.currentStep ?? 1;
    const isChainComplete = totalSteps > 0 && currentStepNumber > totalSteps;
    const normalizedStepNumber = totalSteps > 0 ? Math.min(currentStepNumber, totalSteps) : 1;
    const currentStepIndex = Math.max(0, normalizedStepNumber - 1);

    // Persist completion awareness for downstream stages/formatting
    if (isChainComplete) {
      context.state.session.chainComplete = true;
      context.executionResults = {
        content:
          'Chain already complete. No further user_response is required unless a gate review is pending.',
        metadata: {
          promptId: 'chain-complete',
          promptName: 'chain-complete',
          stepNumber: normalizedStepNumber,
          totalSteps,
          callToAction: 'Chain complete. Provide gate_verdict only if requested.',
        },
        generatedAt: Date.now(),
      };
      this.logExit({
        skipped: 'Chain already complete',
        currentStep: currentStepNumber,
        totalSteps,
      });
      return;
    }

    const currentStep = steps[currentStepIndex];
    if (!currentStep) {
      this.handleError(new Error('Current step not found during execution'));
      return;
    }
    const chainContextSnapshot = this.chainSessionManager.getChainContext(session.sessionId);

    const normalizedStepArgs = currentStep.args ?? {};

    // Use injection decision from InjectionControlStage (state.injection)
    // inject=true means INJECT, inject=false means SKIP
    const injectionDecision = context.state.injection?.systemPrompt;
    const suppressFrameworkInjection = injectionDecision?.inject === false;

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
        suppressFrameworkInjection, // Pass injection decision to chain executor
        injectionState: context.state.injection, // Also pass full injection state
      },
      additionalGateIds: executionPlan.gates,
    });

    context.executionResults = this.createExecutionResults(renderResult);

    // Record diagnostic for chain step execution
    context.diagnostics.info(this.name, 'Chain step executed', {
      stepNumber: renderResult.stepNumber,
      totalSteps: renderResult.totalSteps,
      promptId: renderResult.promptId,
      contentLength: renderResult.content.length,
      gateCount: executionPlan.gates?.length ?? 0,
    });

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

    // Build template args, enriched with script tool results if available
    const args = this.buildTemplateArgs(context);

    // Resolve {{ref:...}} and {{script:...}} references and render template
    const templateResult = await processTemplateWithRefs(
      prompt.userMessageTemplate,
      args,
      {},
      this.referenceResolver,
      {
        scriptResolver: this.scriptReferenceResolver,
        promptDir: prompt.promptDir, // Enables prompt-local script lookup
      }
    );
    const renderedTemplate = templateResult.content;
    const sections: string[] = [];

    // Use injection decision from InjectionControlStage (state.injection)
    // This is the authoritative source with 7-level hierarchical resolution
    const injectionDecision = context.state.injection?.systemPrompt;
    const injectionSuppressed = injectionDecision?.inject === false;

    // Deduplication: Skip frameworkContext.systemPrompt if prompt.systemMessage already contains framework guidance
    const systemMessageHasFramework = hasFrameworkGuidance(prompt.systemMessage);

    if (
      context.frameworkContext?.systemPrompt &&
      !systemMessageHasFramework &&
      !injectionSuppressed
    ) {
      sections.push(context.frameworkContext.systemPrompt.trim());
      this.logger.debug('StepExecution: Added framework system prompt from context');
    } else if (injectionSuppressed) {
      this.logger.debug(
        'StepExecution: Skipped framework injection (suppressed by injection decision)',
        {
          source: injectionDecision?.source,
        }
      );
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

    // Record diagnostic for single prompt execution
    context.diagnostics.info(this.name, 'Single prompt executed', {
      promptId: prompt.id,
      contentLength: combinedContent.length,
      hasFrameworkContext: Boolean(context.frameworkContext?.systemPrompt),
      injectionSuppressed,
      gateCount: executionPlan.gates?.length ?? 0,
    });

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
   * Build template arguments with script tool results and auto-execute results.
   *
   * Script results are exposed as {{tool_<id>}} in templates.
   * Auto-execute results are exposed as {{tool_<id>_result}} in templates.
   *
   * For example:
   * - A tool with id 'methodology_builder' would be available as {{tool_methodology_builder}}
   * - Its auto-execute result would be available as {{tool_methodology_builder_result}}
   */
  private buildTemplateArgs(context: ExecutionContext): Record<string, unknown> {
    const baseArgs = context.getPromptArgs();
    const scriptResults = context.state.scripts?.results;
    const autoExecuteResults = context.state.scripts?.autoExecuteResults;

    const hasScriptResults = scriptResults && scriptResults.size > 0;
    const hasAutoExecuteResults = autoExecuteResults && autoExecuteResults.size > 0;

    if (!hasScriptResults && !hasAutoExecuteResults) {
      return baseArgs;
    }

    // Merge script tool outputs into template context
    const scriptArgs: Record<string, unknown> = {};

    if (hasScriptResults) {
      for (const [toolId, result] of scriptResults) {
        // Only include successful tool outputs
        if (result.success && result.output !== null) {
          scriptArgs[`tool_${toolId}`] = result.output;
        }
      }
    }

    // Merge auto-execute results into template context
    if (hasAutoExecuteResults) {
      for (const [toolId, result] of autoExecuteResults) {
        // Extract text content from ToolResponse for template use
        const textContent = result.content?.find((c: { type: string }) => c.type === 'text');
        scriptArgs[`tool_${toolId}_result`] = {
          isError: result.isError,
          text: (textContent as { text?: string })?.text ?? '',
          content: result.content,
        };
      }
    }

    return {
      ...baseArgs,
      ...scriptArgs,
    };
  }
}
