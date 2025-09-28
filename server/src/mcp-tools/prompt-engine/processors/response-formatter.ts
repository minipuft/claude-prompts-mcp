/**
 * Response Formatter - Handles response formatting and coordination
 *
 * Extracted from ConsolidatedPromptEngine to provide focused
 * response formatting capabilities with clear separation of concerns.
 */

import { createLogger } from "../../../logging/index.js";
import { createExecutionResponse } from "../../shared/structured-response-builder.js";
import { FormatterExecutionContext, SimpleResponseFormatter } from "../core/types.js";

const logger = createLogger({
  logFile: '/tmp/response-formatter.log',
  transport: 'stdio',
  enableDebug: false,
  configuredLevel: 'info'
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
export class ResponseFormatter implements SimpleResponseFormatter {
  private analyticsService?: any;

  /**
   * Set analytics service for tracking
   */
  public setAnalyticsService(service: any): void {
    this.analyticsService = service;
    logger.debug('📊 [ResponseFormatter] Analytics service set');
  }

  /**
   * Format general response content
   */
  public formatResponse(content: any): any {
    try {
      logger.debug('🔧 [ResponseFormatter] Formatting general response');
      return content;
    } catch (error) {
      logger.error('❌ [ResponseFormatter] General response formatting failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return content;
    }
  }

  /**
   * Format prompt engine response with execution context
   */
  public formatPromptEngineResponse(
    response: any,
    executionContext?: FormatterExecutionContext,
    options?: Record<string, any>
  ): any {
    try {
      logger.debug('🎯 [ResponseFormatter] Formatting prompt engine response', {
        executionType: executionContext?.executionType,
        frameworkUsed: executionContext?.frameworkUsed,
        stepsExecuted: executionContext?.stepsExecuted
      });

      // Track analytics if service is available
      if (this.analyticsService && executionContext) {
        this.trackExecution(executionContext);
      }

      // Create structured response using shared builder
      const structuredResponse = createExecutionResponse(
        String(response),
        "execute",
        {
          executionType: executionContext?.executionType || "prompt",
          executionTime: executionContext ? executionContext.endTime - executionContext.startTime : 0,
          frameworkUsed: executionContext?.frameworkUsed,
          stepsExecuted: executionContext?.stepsExecuted || 1,
          sessionId: executionContext?.sessionId,
          gateResults: options?.gateResults
        }
      );

      logger.debug('✅ [ResponseFormatter] Prompt engine response formatted successfully');
      return structuredResponse;
    } catch (error) {
      logger.error('❌ [ResponseFormatter] Prompt engine response formatting failed', {
        error: error instanceof Error ? error.message : String(error)
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
    options?: Record<string, any>
  ): any {
    try {
      logger.debug('🚨 [ResponseFormatter] Formatting error response', {
        errorType: error instanceof Error ? error.constructor.name : typeof error
      });

      // Track error analytics if service is available
      if (this.analyticsService && executionContext) {
        this.trackError(error, executionContext);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      const structuredResponse = createExecutionResponse(
        `Error: ${errorMessage}`,
        "error",
        {
          executionType: executionContext?.executionType || "prompt",
          executionTime: executionContext ? executionContext.endTime - executionContext.startTime : 0,
          frameworkUsed: executionContext?.frameworkUsed,
          stepsExecuted: 0,
          sessionId: executionContext?.sessionId,
          gateResults: { error: error instanceof Error ? error.constructor.name : 'Unknown' }
        }
      );

      logger.debug('✅ [ResponseFormatter] Error response formatted successfully');
      return structuredResponse;
    } catch (formattingError) {
      logger.error('❌ [ResponseFormatter] Error response formatting failed', {
        originalError: error instanceof Error ? error.message : String(error),
        formattingError: formattingError instanceof Error ? formattingError.message : String(formattingError)
      });

      // Fallback to minimal response
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true
      };
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
  ): any {
    try {
      logger.debug('🔗 [ResponseFormatter] Formatting chain response', {
        chainId,
        currentStep,
        totalSteps,
        executionType: executionContext?.executionType
      });

      const structuredResponse = createExecutionResponse(
        String(response),
        "chain_execute",
        {
          executionType: "chain",
          executionTime: executionContext ? executionContext.endTime - executionContext.startTime : 0,
          frameworkUsed: executionContext?.frameworkUsed,
          stepsExecuted: currentStep,
          sessionId: executionContext?.sessionId,
          gateResults: {
            chainId,
            currentStep,
            totalSteps,
            progress: Math.round((currentStep / totalSteps) * 100)
          }
        }
      );

      logger.debug('✅ [ResponseFormatter] Chain response formatted successfully');
      return structuredResponse;
    } catch (error) {
      logger.error('❌ [ResponseFormatter] Chain response formatting failed', {
        chainId,
        error: error instanceof Error ? error.message : String(error)
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
          sessionId: executionContext.sessionId
        });
      }
    } catch (error) {
      logger.warn('⚠️ [ResponseFormatter] Analytics tracking failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Track error for analytics
   */
  private trackError(error: any, executionContext: FormatterExecutionContext): void {
    try {
      if (this.analyticsService && this.analyticsService.trackError) {
        this.analyticsService.trackError({
          executionId: executionContext.executionId,
          executionType: executionContext.executionType,
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
          errorMessage: error instanceof Error ? error.message : String(error),
          sessionId: executionContext.sessionId
        });
      }
    } catch (trackingError) {
      logger.warn('⚠️ [ResponseFormatter] Error analytics tracking failed', {
        error: trackingError instanceof Error ? trackingError.message : String(trackingError)
      });
    }
  }
}