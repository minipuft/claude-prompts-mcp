/**
 * Response Formatter - Handles response formatting and coordination
 *
 * Extracted from ConsolidatedPromptEngine to provide focused
 * response formatting capabilities with clear separation of concerns.
 */

import { createLogger } from "../../../logging/index.js";
import {
  FormatterExecutionContext,
  SimpleResponseFormatter,
} from "../core/types.js";
import type { ToolResponse } from "../../../types/index.js";

const logger = createLogger({
  logFile: "/tmp/response-formatter.log",
  transport: "stdio",
  enableDebug: false,
  configuredLevel: "info",
});

/**
 * ResponseFormatter handles all response-related formatting and coordination
 *
 * This class provides:
 * - Response formatting for different execution types
 * - Error response handling and formatting
 * - Analytics integration and tracking
 * - Structured response building
 */
function normalizeToolResponse(
  payload: any,
  defaultIsError = false
): ToolResponse {
  if (payload && typeof payload === "object") {
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

    if (typeof payload.content === "string") {
      return {
        content: [{ type: "text" as const, text: payload.content }],
        isError: payload.isError ?? defaultIsError,
        structuredContent: payload.structuredContent,
      };
    }

    if (typeof payload.text === "string") {
      return {
        content: [{ type: "text" as const, text: payload.text }],
        isError: payload.isError ?? defaultIsError,
        structuredContent: payload.structuredContent,
      };
    }

    if (typeof payload.message === "string") {
      return {
        content: [{ type: "text" as const, text: payload.message }],
        isError: payload.isError ?? defaultIsError,
        structuredContent: payload.structuredContent,
      };
    }
  }

  const text =
    typeof payload === "string"
      ? payload
      : JSON.stringify(payload, null, 2);

  return {
    content: [{ type: "text" as const, text }],
    isError: defaultIsError,
  };
}

export class ResponseFormatter implements SimpleResponseFormatter {
  private analyticsService?: any;

  /**
   * Set analytics service for tracking
   */
  public setAnalyticsService(service: any): void {
    this.analyticsService = service;
    logger.debug("📊 [ResponseFormatter] Analytics service set");
  }

  /**
   * Format general response content
   */
  public formatResponse(content: any): ToolResponse {
    try {
      logger.debug("🔧 [ResponseFormatter] Formatting general response");
      return normalizeToolResponse(content, false);
    } catch (error) {
      logger.error(
        "❌ [ResponseFormatter] General response formatting failed",
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
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
      executionType: "prompt",
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
      logger.debug("🎯 [ResponseFormatter] Formatting prompt engine response", {
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
        typeof response === "object" &&
        Array.isArray((response as ToolResponse).content)
      ) {
        return response as ToolResponse;
      }

      const toolResponse = normalizeToolResponse(response, false);

      // Only include structuredContent for chains (step tracking metadata)
      // Prompts and templates should return clean content without metadata clutter
      const includeStructuredContent =
        executionContext.executionType === "chain" &&
        options?.includeStructuredContent !== false;

      if (includeStructuredContent) {
        toolResponse.structuredContent = {
          executionMetadata: {
            executionId: executionContext.executionId,
            executionType: executionContext.executionType,
            startTime: executionContext.startTime,
            endTime: executionContext.endTime,
            executionTime:
              executionContext.endTime - executionContext.startTime,
            frameworkEnabled: executionContext.frameworkEnabled,
            frameworkUsed: executionContext.frameworkUsed,
            stepsExecuted: executionContext.stepsExecuted,
            sessionId: executionContext.sessionId,
          },
        };

        if (gateResults) {
          (toolResponse.structuredContent as any).gateValidation = {
            enabled: true,
            passed: gateResults.passed,
            totalGates: gateResults.gateResults?.length ?? 0,
            failedGates: gateResults.gateResults?.filter((g: any) => !g.passed) ?? [],
            passedGates: gateResults.gateResults?.filter((g: any) => g.passed) ?? [],
            executionTime: gateResults.executionTime ?? 0,
            retryCount: gateResults.retryRequired ? 1 : 0,
          };
        }
      }

      if (options?.includeMetadata) {
        (toolResponse as any).metadata = {
          executionType: executionContext.executionType,
          frameworkUsed: executionContext.frameworkUsed,
          stepsExecuted: executionContext.stepsExecuted,
          sessionId: executionContext.sessionId,
        };
      }

      logger.debug(
        "✅ [ResponseFormatter] Prompt engine response formatted successfully"
      );
      return toolResponse;
    } catch (error) {
      logger.error(
        "❌ [ResponseFormatter] Prompt engine response formatting failed",
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );

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
      logger.debug("🚨 [ResponseFormatter] Formatting error response", {
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      });

      // Track error analytics if service is available
      if (this.analyticsService && executionContext) {
        this.trackError(error, executionContext);
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const toolResponse = normalizeToolResponse(`Error: ${errorMessage}`, true);

      if (executionContext && executionContext.executionType === "chain") {
        toolResponse.structuredContent = {
          executionMetadata: {
            executionId: executionContext.executionId,
            executionType: executionContext.executionType,
            startTime: executionContext.startTime,
            endTime: executionContext.endTime,
            executionTime:
              executionContext.endTime - executionContext.startTime,
            frameworkEnabled: executionContext.frameworkEnabled,
            frameworkUsed: executionContext.frameworkUsed,
            stepsExecuted: executionContext.stepsExecuted,
            sessionId: executionContext.sessionId,
          },
        };
      }

      logger.debug(
        "✅ [ResponseFormatter] Error response formatted successfully"
      );
      return toolResponse;
    } catch (formattingError) {
      logger.error("❌ [ResponseFormatter] Error response formatting failed", {
        originalError: error instanceof Error ? error.message : String(error),
        formattingError:
          formattingError instanceof Error
            ? formattingError.message
            : String(formattingError),
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
      logger.debug("🔗 [ResponseFormatter] Formatting chain response", {
        chainId,
        currentStep,
        totalSteps,
        executionType: executionContext?.executionType,
      });

      const toolResponse = normalizeToolResponse(response, false);

      logger.debug(
        "✅ [ResponseFormatter] Chain response formatted successfully"
      );
      return toolResponse;
    } catch (error) {
      logger.error("❌ [ResponseFormatter] Chain response formatting failed", {
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
      if (this.analyticsService && this.analyticsService.trackExecution) {
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
      logger.warn("⚠️ [ResponseFormatter] Analytics tracking failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track error for analytics
   */
  private trackError(
    error: any,
    executionContext: FormatterExecutionContext
  ): void {
    try {
      if (this.analyticsService && this.analyticsService.trackError) {
        this.analyticsService.trackError({
          executionId: executionContext.executionId,
          executionType: executionContext.executionType,
          errorType:
            error instanceof Error ? error.constructor.name : "Unknown",
          errorMessage: error instanceof Error ? error.message : String(error),
          sessionId: executionContext.sessionId,
        });
      }
    } catch (trackingError) {
      logger.warn("⚠️ [ResponseFormatter] Error analytics tracking failed", {
        error:
          trackingError instanceof Error
            ? trackingError.message
            : String(trackingError),
      });
    }
  }
}
