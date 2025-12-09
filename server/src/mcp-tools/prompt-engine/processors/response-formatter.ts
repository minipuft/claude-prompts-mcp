// @lifecycle canonical - Formats prompt execution responses.
/**
 * Response Formatter - Handles response formatting and coordination
 *
 * Extracted from PromptExecutionService to provide focused
 * response formatting capabilities with clear separation of concerns.
 */

import { FormatterExecutionContext, SimpleResponseFormatter } from '../core/types.js';

import type { Logger } from '../../../logging/index.js';
import type { ToolResponse } from '../../../types/index.js';

const fallbackLogger: Logger = {
  info: () => {},
  debug: () => {},
  warn: (...args: any[]) => console.warn('[ResponseFormatter]', ...args),
  error: (...args: any[]) => console.error('[ResponseFormatter]', ...args),
};

/**
 * ResponseFormatter handles all response-related formatting and coordination
 *
 * This class provides:
 * - Response formatting for different execution types
 * - Error response handling and formatting
 * - Analytics integration and tracking
 * - Structured response building
 */
function normalizeToolResponse(payload: any, defaultIsError = false): ToolResponse {
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.content)) {
      const normalized: ToolResponse = {
        content: payload.content,
        isError: payload.isError ?? defaultIsError,
      };
      if (payload.structuredContent !== undefined) {
        normalized.structuredContent = payload.structuredContent;
      }
      if (payload.metadata !== undefined) {
        (normalized as any).metadata = payload.metadata;
      }
      return normalized;
    }

    if (typeof payload.content === 'string') {
      return {
        content: [{ type: 'text' as const, text: payload.content }],
        isError: payload.isError ?? defaultIsError,
        structuredContent: payload.structuredContent,
      };
    }

    if (typeof payload.text === 'string') {
      return {
        content: [{ type: 'text' as const, text: payload.text }],
        isError: payload.isError ?? defaultIsError,
        structuredContent: payload.structuredContent,
      };
    }

    if (typeof payload.message === 'string') {
      return {
        content: [{ type: 'text' as const, text: payload.message }],
        isError: payload.isError ?? defaultIsError,
        structuredContent: payload.structuredContent,
      };
    }
  }

  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);

  return {
    content: [{ type: 'text' as const, text }],
    isError: defaultIsError,
  };
}

export class ResponseFormatter implements SimpleResponseFormatter {
  private analyticsService?: any;
  private readonly logger: Logger;

  constructor(logger: Logger = fallbackLogger) {
    this.logger = logger;
  }

  /**
   * Set analytics service for tracking
   */
  public setAnalyticsService(service: any): void {
    this.analyticsService = service;
    this.logger.debug('📊 [ResponseFormatter] Analytics service set');
  }

  /**
   * Format general response content
   */
  public formatResponse(content: any): ToolResponse {
    try {
      this.logger.debug('🔧 [ResponseFormatter] Formatting general response');
      return normalizeToolResponse(content, false);
    } catch (error) {
      this.logger.error('❌ [ResponseFormatter] General response formatting failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return normalizeToolResponse(content, false);
    }
  }

  /**
   * Format prompt engine response with execution context
   */
  public formatPromptEngineResponse(
    response: any,
    executionContext: FormatterExecutionContext = {
      executionId: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      executionType: 'single',
      startTime: Date.now(),
      endTime: Date.now(),
      frameworkEnabled: false,
      success: true,
    },
    options: Record<string, any> = {},
    gateResults?: any
  ): ToolResponse {
    // IMPORTANT: keep the rendered template text inside `content`. Structured metadata is
    // optional and should never replace the main instructions, otherwise the LLM will only
    // see bookkeeping data. Only add structured blocks when a chain execution explicitly
    // needs them.
    try {
      this.logger.debug('🎯 [ResponseFormatter] Formatting prompt engine response', {
        executionType: executionContext?.executionType,
        frameworkUsed: executionContext?.frameworkUsed,
        stepsExecuted: executionContext?.stepsExecuted,
      });

      // Track analytics if service is available
      if (this.analyticsService && executionContext) {
        this.trackExecution(executionContext);
      }

      if (
        response &&
        typeof response === 'object' &&
        Array.isArray((response as ToolResponse).content)
      ) {
        return response as ToolResponse;
      }

      const toolResponse = normalizeToolResponse(response, false);

      // Only include structuredContent for chains (step tracking metadata)
      // Prompts and templates should return clean content without metadata clutter
      // Default to omitting structuredContent so model input stays lean unless explicitly requested.
      const includeStructuredContent =
        executionContext.executionType === 'chain' && options?.includeStructuredContent === true;

      if (includeStructuredContent) {
        const executionDuration = executionContext.endTime - executionContext.startTime;
        const structuredContent: Record<string, any> = {
          execution: {
            id: executionContext.executionId,
            type: executionContext.executionType,
            duration_ms: executionDuration,
            framework: executionContext.frameworkUsed ?? null,
            steps: executionContext.stepsExecuted ?? null,
          },
        };

        if (executionContext.chainId) {
          structuredContent.chain = {
            id: executionContext.chainId,
            status: executionContext.chainProgress?.status ?? 'in_progress',
            current_step: executionContext.chainProgress?.currentStep ?? null,
            total_steps: executionContext.chainProgress?.totalSteps ?? null,
          };
        }

        if (gateResults) {
          structuredContent.gates = {
            enabled: true,
            passed: gateResults.passed,
            total: gateResults.gateResults?.length ?? 0,
            failed: gateResults.gateResults?.filter((g: any) => !g.passed) ?? [],
            execution_ms: gateResults.executionTime ?? 0,
            retries: gateResults.retryRequired ? 1 : 0,
          };
        }

        toolResponse.structuredContent = structuredContent;
      }

      if (options?.includeMetadata || options?.metadata) {
        const defaultMetadata: Record<string, any> = {
          executionType: executionContext.executionType,
          frameworkUsed: executionContext.frameworkUsed,
        };
        if (executionContext.chainId) {
          defaultMetadata.chainId = executionContext.chainId;
        }
        if (executionContext.chainProgress) {
          if (typeof executionContext.chainProgress.currentStep === 'number') {
            defaultMetadata.currentStep = executionContext.chainProgress.currentStep;
          }
          if (typeof executionContext.chainProgress.totalSteps === 'number') {
            defaultMetadata.totalSteps = executionContext.chainProgress.totalSteps;
          }
        }
        (toolResponse as any).metadata = {
          ...defaultMetadata,
          ...(options?.metadata ?? {}),
        };
      }

      this.logger.debug('✅ [ResponseFormatter] Prompt engine response formatted successfully');
      return toolResponse;
    } catch (error) {
      this.logger.error('❌ [ResponseFormatter] Prompt engine response formatting failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return error response
      return this.formatErrorResponse(error, executionContext, options);
    }
  }

  /**
   * Format error response
   */
  public formatErrorResponse(
    error: any,
    executionContext?: FormatterExecutionContext,
    _options?: Record<string, any>
  ): ToolResponse {
    try {
      this.logger.debug('🚨 [ResponseFormatter] Formatting error response', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });

      // Track error analytics if service is available
      if (this.analyticsService && executionContext) {
        this.trackError(error, executionContext);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      const toolResponse = normalizeToolResponse(`Error: ${errorMessage}`, true);

      if (executionContext?.executionType === 'chain') {
        const executionDuration = executionContext.endTime - executionContext.startTime;
        toolResponse.structuredContent = {
          execution: {
            id: executionContext.executionId,
            type: executionContext.executionType,
            duration_ms: executionDuration,
            framework: executionContext.frameworkUsed ?? null,
            steps: executionContext.stepsExecuted ?? null,
          },
          chain: executionContext.chainId
            ? {
                id: executionContext.chainId,
                status: executionContext.chainProgress?.status ?? 'in_progress',
                current_step: executionContext.chainProgress?.currentStep ?? null,
                total_steps: executionContext.chainProgress?.totalSteps ?? null,
              }
            : undefined,
        };
      }

      this.logger.debug('✅ [ResponseFormatter] Error response formatted successfully');
      return toolResponse;
    } catch (formattingError) {
      this.logger.error('❌ [ResponseFormatter] Error response formatting failed', {
        originalError: error instanceof Error ? error.message : String(error),
        formattingError:
          formattingError instanceof Error ? formattingError.message : String(formattingError),
      });

      // Fallback to minimal response
      return normalizeToolResponse(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    }
  }

  /**
   * Format chain execution response
   */
  public formatChainResponse(
    response: any,
    chainId: string,
    currentStep: number,
    totalSteps: number,
    executionContext?: FormatterExecutionContext
  ): ToolResponse {
    try {
      this.logger.debug('🔗 [ResponseFormatter] Formatting chain response', {
        chainId,
        currentStep,
        totalSteps,
        executionType: executionContext?.executionType,
      });

      const toolResponse = normalizeToolResponse(response, false);

      this.logger.debug('✅ [ResponseFormatter] Chain response formatted successfully');
      return toolResponse;
    } catch (error) {
      this.logger.error('❌ [ResponseFormatter] Chain response formatting failed', {
        chainId,
        error: error instanceof Error ? error.message : String(error),
      });

      return this.formatErrorResponse(error, executionContext);
    }
  }

  /**
   * Track execution for analytics
   */
  private trackExecution(executionContext: FormatterExecutionContext): void {
    try {
      if (this.analyticsService?.trackExecution) {
        this.analyticsService.trackExecution({
          executionId: executionContext.executionId,
          executionType: executionContext.executionType,
          duration: executionContext.endTime - executionContext.startTime,
          frameworkUsed: executionContext.frameworkUsed,
          stepsExecuted: executionContext.stepsExecuted,
          success: executionContext.success,
          sessionId: executionContext.sessionId,
        });
      }
    } catch (error) {
      this.logger.warn('⚠️ [ResponseFormatter] Analytics tracking failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track error for analytics
   */
  private trackError(error: any, executionContext: FormatterExecutionContext): void {
    try {
      if (this.analyticsService?.trackError) {
        this.analyticsService.trackError({
          executionId: executionContext.executionId,
          executionType: executionContext.executionType,
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
          errorMessage: error instanceof Error ? error.message : String(error),
          sessionId: executionContext.sessionId,
        });
      }
    } catch (trackingError) {
      this.logger.warn('⚠️ [ResponseFormatter] Error analytics tracking failed', {
        error: trackingError instanceof Error ? trackingError.message : String(trackingError),
      });
    }
  }
}
