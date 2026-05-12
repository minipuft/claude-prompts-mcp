// @lifecycle canonical - Formats responses prior to gate review.
import {
  isChainFormattingContext,
  isSinglePromptFormattingContext,
} from '../../formatting/formatting-context.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../../infra/logging/index.js';
import type { ExecutionRecordStore } from '../../../../modules/chains/execution-record-store.js';
import type { FormatterExecutionContext } from '../../../../shared/types/chain-execution.js';
import type { ResponseFormatterPort } from '../../../../shared/types/index.js';
import type { ExecutionContext } from '../../context/index.js';
import type { SinglePromptFormattingContext } from '../../formatting/formatting-context.js';
import type { ResponseAssembler } from '../../formatting/response-assembler.js';

/**
 * Pipeline Stage 10: Response Formatting
 *
 * Assembles final ToolResponse payloads with metadata, session information,
 * and progress tracking for different execution types (prompt/chain/template).
 *
 * Domain logic delegated to:
 * - ResponseAssembler: section assembly, footer building, gate validation info
 * - formatting-context.ts: type guards for discriminated union
 *
 * Dependencies: context.executionPlan, rendered content from Stage 9
 * Output: context.response (final ToolResponse)
 */
export class ResponseFormattingStage extends BasePipelineStage {
  readonly name = 'ResponseFormatting';

  constructor(
    private readonly responseFormatter: ResponseFormatterPort,
    private readonly responseAssembler: ResponseAssembler,
    logger: Logger,
    private readonly executionRecordStore: ExecutionRecordStore | null = null
  ) {
    super(logger);
  }

  private emitChainTerminalRecord(context: ExecutionContext): void {
    if (this.executionRecordStore === null) return;
    const session = context.sessionContext;
    if (session === undefined || !context.state.session.chainComplete) return;
    const completedAt = Date.now();
    this.executionRecordStore.append({
      sessionId: session.sessionId,
      chainId: session.chainId,
      status: 'completed',
      startedAt: completedAt,
      completedAt,
      scope: context.getScopeOptions(),
    });
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.response) {
      this.logExit({ skipped: 'Response already set' });
      return;
    }

    if (context.state.gates.responseBlocked === true && context.hasPendingReview()) {
      const blockedResponse = this.responseAssembler.formatBlockedResponse(context);
      context.setResponse({
        content: [{ type: 'text', text: blockedResponse }],
        isError: false,
      });
      context.diagnostics.info(this.name, 'Response blocked - gate failure', {
        blockedGateIds: context.state.gates.blockedGateIds,
      });
      this.logExit({ blocked: true, reason: 'gate_failure' });
      return;
    }

    if (!context.executionResults) {
      this.handleError(new Error('Execution results missing before formatting'));
    }

    try {
      const formatterContext = this.buildFormatterContext(context);

      let responseContent: string;
      if (isChainFormattingContext(formatterContext) && context.sessionContext) {
        responseContent = this.responseAssembler.formatChainResponse(context, formatterContext);
      } else if (isSinglePromptFormattingContext(formatterContext)) {
        responseContent = this.responseAssembler.formatSinglePromptResponse(
          context,
          formatterContext
        );
      } else {
        responseContent = this.responseAssembler.formatSinglePromptResponse(
          context,
          formatterContext as SinglePromptFormattingContext
        );
      }

      const gateValidationInfo = this.responseAssembler.buildGateValidationInfo(context);

      const response = this.responseFormatter.formatPromptEngineResponse(
        responseContent,
        formatterContext,
        { includeStructuredContent: false },
        gateValidationInfo
      );

      context.setResponse(response);

      this.emitChainTerminalRecord(context);

      context.diagnostics.info(this.name, 'Response formatted', {
        executionType: formatterContext.executionType,
        hasGateInstructions: Boolean(context.gateInstructions),
        hasSession: Boolean(context.sessionContext),
        chainId: context.sessionContext?.chainId,
        contentLength: responseContent.length,
      });

      this.logExit({
        formatted: true,
        executionType: formatterContext.executionType,
      });
    } catch (error) {
      this.handleError(error, 'Response formatting failed');
    }
  }

  /**
   * Build the FormatterExecutionContext from pipeline state.
   * This is orchestration-level context wiring, not domain logic.
   */
  private buildFormatterContext(context: ExecutionContext): FormatterExecutionContext {
    const executionType = context.executionPlan?.strategy ?? 'single';
    const sessionContext = context.sessionContext;

    const formatterContext: FormatterExecutionContext = {
      executionId: `pipeline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      executionType,
      startTime: Date.now(),
      endTime: Date.now(),
      frameworkEnabled: Boolean(context.frameworkContext),
      success: true,
    };

    const frameworkUsed = context.frameworkContext?.selectedFramework?.name;
    if (frameworkUsed) {
      formatterContext.frameworkUsed = frameworkUsed;
    }

    if (sessionContext?.currentStep !== undefined) {
      formatterContext.stepsExecuted = sessionContext.currentStep;
    }

    if (sessionContext?.sessionId !== undefined) {
      formatterContext.sessionId = sessionContext.sessionId;
    }

    const chainId = sessionContext?.chainId ?? context.parsedCommand?.chainId;
    if (chainId !== undefined) {
      formatterContext.chainId = chainId;
    }

    if (sessionContext?.currentStep !== undefined && sessionContext.totalSteps !== undefined) {
      formatterContext.chainProgress = {
        currentStep: sessionContext.currentStep,
        totalSteps: sessionContext.totalSteps,
        status:
          sessionContext.totalSteps > 0 && sessionContext.currentStep >= sessionContext.totalSteps
            ? 'complete'
            : 'in_progress',
      };
    }

    return formatterContext;
  }
}
