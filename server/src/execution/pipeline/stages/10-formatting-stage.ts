// @lifecycle canonical - Formats responses prior to gate review.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { FormatterExecutionContext } from '../../../mcp-tools/prompt-engine/core/types.js';
import type { ResponseFormatter } from '../../../mcp-tools/prompt-engine/processors/response-formatter.js';
import type { ExecutionContext, SessionContext } from '../../context/execution-context.js';

/**
 * Chain execution formatting context
 */
interface ChainFormattingContext extends FormatterExecutionContext {
  readonly executionType: 'chain';
  readonly sessionContext: Required<SessionContext>;
}

/**
 * Single prompt execution formatting context
 */
interface SinglePromptFormattingContext extends FormatterExecutionContext {
  readonly executionType: 'single';
}

/**
 * Discriminated union for formatting contexts
 */
type VariantFormattingContext = ChainFormattingContext | SinglePromptFormattingContext;

/**
 * Type guard for chain formatting context
 */
function isChainFormattingContext(
  context: FormatterExecutionContext
): context is ChainFormattingContext {
  return context.executionType === 'chain';
}

/**
 * Type guard for single prompt formatting context
 */
function isSinglePromptFormattingContext(
  context: FormatterExecutionContext
): context is SinglePromptFormattingContext {
  return context.executionType === 'single';
}

/**
 * Pipeline Stage 10: Response Formatting
 *
 * Assembles final ToolResponse payloads with metadata, session information,
 * and progress tracking for different execution types (prompt/chain/template).
 *
 * Dependencies: context.executionPlan, rendered content from Stage 9
 * Output: context.response (final ToolResponse)
 * Can Early Exit: No (always runs last)
 */
export class ResponseFormattingStage extends BasePipelineStage {
  readonly name = 'ResponseFormatting';

  constructor(
    private readonly responseFormatter: ResponseFormatter,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.response) {
      this.logExit({ skipped: 'Response already set' });
      return;
    }

    if (!context.executionResults) {
      this.handleError(new Error('Execution results missing before formatting'));
    }

    try {
      const executionType = context.executionPlan?.strategy ?? 'single';
      const sessionContext = context.sessionContext;
      const formatterContext: FormatterExecutionContext = {
        executionId: `pipeline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        executionType,
        startTime: Date.now(),
        endTime: Date.now(),
        frameworkEnabled: Boolean(context.frameworkContext),
        frameworkUsed: context.frameworkContext?.selectedFramework?.name,
        stepsExecuted: sessionContext?.currentStep,
        sessionId: sessionContext?.sessionId,
        chainId: sessionContext?.chainId ?? context.parsedCommand?.chainId,
        chainProgress: sessionContext
          ? {
              currentStep: sessionContext.currentStep,
              totalSteps: sessionContext.totalSteps,
              status:
                typeof sessionContext.totalSteps === 'number' &&
                typeof sessionContext.currentStep === 'number' &&
                sessionContext.totalSteps > 0 &&
                sessionContext.currentStep >= sessionContext.totalSteps
                  ? 'complete'
                  : 'in_progress',
            }
          : undefined,
        success: true,
      };

      // Use variant-specific formatting logic
      let responseContent: string;
      if (isChainFormattingContext(formatterContext) && context.sessionContext) {
        responseContent = this.formatChainResponse(context, formatterContext);
      } else if (isSinglePromptFormattingContext(formatterContext)) {
        responseContent = this.formatSinglePromptResponse(context, formatterContext);
      } else {
        // Fallback for unknown execution types
        responseContent = this.formatSinglePromptResponse(
          context,
          formatterContext as SinglePromptFormattingContext
        );
      }

      // Format with ResponseFormatter (adds structured metadata)
      const response = this.responseFormatter.formatPromptEngineResponse(
        responseContent,
        formatterContext,
        {
          includeStructuredContent: executionType === 'chain',
        }
      );

      context.setResponse(response);

      // Record diagnostic for response formatting
      context.diagnostics.info(this.name, 'Response formatted', {
        executionType,
        hasGateInstructions: Boolean(context.gateInstructions),
        hasSession: Boolean(sessionContext),
        chainId: sessionContext?.chainId,
        contentLength: responseContent.length,
      });

      this.logExit({
        formatted: true,
        executionType,
      });
    } catch (error) {
      this.handleError(error, 'Response formatting failed');
    }
  }

  /**
   * Formats response for chain execution with session tracking
   */
  private formatChainResponse(
    context: ExecutionContext,
    formatterContext: ChainFormattingContext
  ): string {
    const sections: string[] = [];
    const gateGuidanceEnabled = this.shouldInjectGateGuidance(context);

    // Add base content
    const baseContent =
      typeof context.executionResults!.content === 'string'
        ? context.executionResults!.content
        : JSON.stringify(context.executionResults!.content, null, 2);
    sections.push(baseContent);

    // Add gate instructions for chain execution
    if (gateGuidanceEnabled && context.gateInstructions) {
      sections.push(context.gateInstructions);
    }

    // Add advisory warnings from non-blocking gate failures
    const advisoryWarnings = context.state.gates.advisoryWarnings;
    if (advisoryWarnings && advisoryWarnings.length > 0) {
      sections.push('\n---\n**Advisory Gate Warnings:**');
      advisoryWarnings.forEach((warning) => sections.push(`- ${warning}`));
    }

    // Add chain-specific footer with session tracking
    const footer = this.buildChainFooter(context, formatterContext);
    if (footer) {
      sections.push(footer);
    }

    return sections.join('\n\n');
  }

  /**
   * Formats response for single prompt execution
   */
  private formatSinglePromptResponse(
    context: ExecutionContext,
    _formatterContext: SinglePromptFormattingContext
  ): string {
    const sections: string[] = [];
    const gateGuidanceEnabled = this.shouldInjectGateGuidance(context);

    // Add base content
    const baseContent =
      typeof context.executionResults!.content === 'string'
        ? context.executionResults!.content
        : JSON.stringify(context.executionResults!.content, null, 2);
    sections.push(baseContent);

    // Add gate instructions if present (for inline gates via ::)
    if (gateGuidanceEnabled && context.gateInstructions) {
      sections.push(context.gateInstructions);
    }

    // Add advisory warnings from non-blocking gate failures
    const advisoryWarnings = context.state.gates.advisoryWarnings;
    if (advisoryWarnings && advisoryWarnings.length > 0) {
      sections.push('\n---\n**Advisory Gate Warnings:**');
      advisoryWarnings.forEach((warning) => sections.push(`- ${warning}`));
    }

    return sections.join('\n\n');
  }

  /**
   * Whether gate guidance injection is enabled for the current execution.
   * Defaults to true when no decision exists.
   */
  private shouldInjectGateGuidance(context: ExecutionContext): boolean {
    return context.state.injection?.gateGuidance?.inject !== false;
  }

  /**
   * Builds footer for chain execution with session and progress tracking
   */
  private buildChainFooter(
    context: ExecutionContext,
    formatterContext: ChainFormattingContext
  ): string {
    const lines: string[] = [];
    const sessionContext = context.sessionContext!;
    const chainIdentifier = sessionContext.chainId ?? sessionContext.sessionId;
    lines.push(`Chain: ${chainIdentifier}`);

    // Chain progress
    if (sessionContext.currentStep && sessionContext.totalSteps) {
      const normalizedStep = Math.min(sessionContext.currentStep, sessionContext.totalSteps);
      const progress = `${normalizedStep}/${sessionContext.totalSteps}`;
      const isComplete = sessionContext.currentStep >= sessionContext.totalSteps;
      lines.push(isComplete ? `✓ Chain complete (${progress})` : `→ Progress ${progress}`);
    }

    const hasPendingReview = context.hasPendingReview();
    if (hasPendingReview) {
      lines.push(`Next: chain_id="${chainIdentifier}", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"`);
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
   * Builds footer with session and execution metadata (legacy method for compatibility)
   * Shows only essential information needed to continue execution
   */
  private buildFooter(
    context: ExecutionContext,
    formatterContext: FormatterExecutionContext
  ): string {
    const lines: string[] = [];

    // Use type-safe access for session-related properties
    if (context.sessionContext) {
      const sessionContext = context.sessionContext;

      // Session ID (for chain/gate executions - needed to resume)
      lines.push(`Session: ${sessionContext.sessionId}`);

      // Chain ID (if different from session ID)
      if (sessionContext.chainId && sessionContext.chainId !== sessionContext.sessionId) {
        lines.push(`Chain: ${sessionContext.chainId}`);
      }

      // Chain progress
      if (sessionContext.currentStep && sessionContext.totalSteps) {
        const normalizedStep = Math.min(sessionContext.currentStep, sessionContext.totalSteps);
        const progress = `${normalizedStep}/${sessionContext.totalSteps}`;
        const isComplete = sessionContext.currentStep >= sessionContext.totalSteps;
        lines.push(
          isComplete ? `✓ Chain complete (${progress})` : `→ Continue with next step (${progress})`
        );
      }
    }

    // Return empty string if no footer content (simple prompts)
    return lines.length > 0 ? lines.join('\n') : '';
  }
}
