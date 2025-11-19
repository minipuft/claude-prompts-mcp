// @lifecycle canonical - Formats responses prior to gate review.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { FormatterExecutionContext } from '../../../mcp-tools/prompt-engine/core/types.js';
import type { ResponseFormatter } from '../../../mcp-tools/prompt-engine/processors/response-formatter.js';
import type { ExecutionContext, SessionContext } from '../../context/execution-context.js';
import type { CustomCheck as RequestCustomCheck } from '../../../types/execution.js';

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
  readonly executionType: 'prompt';
}

/**
 * Template execution formatting context
 */
interface TemplateFormattingContext extends FormatterExecutionContext {
  readonly executionType: 'template';
}

/**
 * Discriminated union for formatting contexts
 */
type VariantFormattingContext = ChainFormattingContext | SinglePromptFormattingContext | TemplateFormattingContext;

/**
 * Type guard for chain formatting context
 */
function isChainFormattingContext(context: FormatterExecutionContext): context is ChainFormattingContext {
  return context.executionType === 'chain';
}

/**
 * Type guard for single prompt formatting context
 */
function isSinglePromptFormattingContext(context: FormatterExecutionContext): context is SinglePromptFormattingContext {
  return context.executionType === 'prompt';
}

/**
 * Type guard for template formatting context
 */
function isTemplateFormattingContext(context: FormatterExecutionContext): context is TemplateFormattingContext {
  return context.executionType === 'template';
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
      const executionType = context.executionPlan?.strategy ?? 'prompt';
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
      } else if (isTemplateFormattingContext(formatterContext)) {
        responseContent = this.formatTemplateResponse(context, formatterContext);
      } else if (isSinglePromptFormattingContext(formatterContext)) {
        responseContent = this.formatSinglePromptResponse(context, formatterContext);
      } else {
        // Fallback for unknown execution types
        responseContent = this.formatSinglePromptResponse(context, formatterContext as SinglePromptFormattingContext);
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
  private formatChainResponse(context: ExecutionContext, formatterContext: ChainFormattingContext): string {
    const sections: string[] = [];

    // Add base content
    const baseContent =
      typeof context.executionResults!.content === 'string'
        ? context.executionResults!.content
        : JSON.stringify(context.executionResults!.content, null, 2);
    sections.push(baseContent);

    const gateControls = this.buildGateControlsSection(context);
    if (gateControls) {
      sections.push(gateControls);
    }

    // Add gate instructions for chain execution
    if (context.gateInstructions) {
      sections.push(context.gateInstructions);
    }

    // Add chain-specific footer with session tracking
    const footer = this.buildChainFooter(context, formatterContext);
    if (footer) {
      sections.push('---');
      sections.push(footer);
    }

    return sections.join('\n\n');
  }

  /**
   * Formats response for template execution
   */
  private formatTemplateResponse(context: ExecutionContext, formatterContext: TemplateFormattingContext): string {
    const sections: string[] = [];

    // Add base content
    const baseContent =
      typeof context.executionResults!.content === 'string'
        ? context.executionResults!.content
        : JSON.stringify(context.executionResults!.content, null, 2);
    sections.push(baseContent);

    const gateControls = this.buildGateControlsSection(context);
    if (gateControls) {
      sections.push(gateControls);
    }

    // Add gate instructions if present
    if (context.gateInstructions) {
      sections.push(context.gateInstructions);
    }

    return sections.join('\n\n');
  }

  /**
   * Formats response for single prompt execution
   */
  private formatSinglePromptResponse(context: ExecutionContext, formatterContext: SinglePromptFormattingContext): string {
    const sections: string[] = [];

    // Add base content
    const baseContent =
      typeof context.executionResults!.content === 'string'
        ? context.executionResults!.content
        : JSON.stringify(context.executionResults!.content, null, 2);
    sections.push(baseContent);

    const gateControls = this.buildGateControlsSection(context);
    if (gateControls) {
      sections.push(gateControls);
    }

    // Add gate instructions if present (for inline gates via ::)
    if (context.gateInstructions) {
      sections.push(context.gateInstructions);
    }

    return sections.join('\n\n');
  }

  private buildGateControlsSection(context: ExecutionContext): string | null {
    const request = context.mcpRequest;
    const overrides = (context.metadata['requestedGateOverrides'] ?? {}) as Record<string, any>;

    const apiValidationEnabled = Boolean(
      request.api_validation ?? overrides['apiValidation']
    );
    const qualityGates: readonly string[] =
      request.quality_gates ?? overrides['qualityGates'] ?? [];
    const customChecks: readonly RequestCustomCheck[] =
      request.custom_checks ?? overrides['customChecks'] ?? [];
    const temporaryCount =
      request.temporary_gates?.length ?? overrides['temporaryGateCount'] ?? 0;
    const gateScope = request.gate_scope ?? overrides['gateScope'];

    const hasControls =
      apiValidationEnabled ||
      qualityGates.length > 0 ||
      customChecks.length > 0 ||
      temporaryCount > 0 ||
      gateScope;

    if (!hasControls) {
      return null;
    }

    const lines: string[] = [];
    lines.push('### Validation Inputs Provided');
    if (apiValidationEnabled) {
      lines.push('- API Validation: Enabled — send gate_verdict to resume after reviews');
    }

    if (qualityGates.length > 0) {
      lines.push(`- Requested Gates: ${qualityGates.join(', ')}`);
    }

    if (customChecks.length > 0) {
      lines.push('- Custom Checks:');
      customChecks.forEach((check) => {
        const label = check.name ? `${check.name}: ` : '';
        lines.push(`  - ${label}${check.description ?? 'No description provided.'}`);
      });
    }

    if (temporaryCount > 0) {
      lines.push(`- Temporary Gates Provided: ${temporaryCount}`);
    }

    if (gateScope) {
      lines.push(`- Gate Scope Override: ${gateScope}`);
    }

    return lines.join('\n');
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
      const progress = `${sessionContext.currentStep}/${sessionContext.totalSteps}`;
      const isComplete = sessionContext.currentStep >= sessionContext.totalSteps;
      lines.push(
        isComplete ? `✓ Chain complete (${progress})` : `→ Progress ${progress}`
      );
    }

    const gateResponseHint = context.hasPendingReview()
      ? 'gate_verdict:"GATE_REVIEW: PASS - <why it meets the gates>"'
      : 'user_response:"<latest step output>"';
    lines.push(
      `Resume Shortcut: \`${chainIdentifier} --> (optional input) --> ${gateResponseHint}\``
    );
    if (context.hasPendingReview()) {
      lines.push(
        `API Resume: call prompt_engine with \`chain_id: "${chainIdentifier}"\` and ${gateResponseHint}. Include a refreshed user_response only if you reran the prior step.`
      );
    } else {
      lines.push(
        `API Resume: call prompt_engine with \`chain_id: "${chainIdentifier}"\` plus your latest response — no need to resend the original command.`
      );
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
      if (
        sessionContext.chainId &&
        sessionContext.chainId !== sessionContext.sessionId
      ) {
        lines.push(`Chain: ${sessionContext.chainId}`);
      }

      // Chain progress
      if (sessionContext.currentStep && sessionContext.totalSteps) {
        const progress = `${sessionContext.currentStep}/${sessionContext.totalSteps}`;
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
