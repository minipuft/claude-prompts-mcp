/**
 * Response Formatter - Handles response formatting and coordination
 *
 * Extracted from PromptExecutionService to provide focused
 * response formatting capabilities with clear separation of concerns.
 */
import { FormatterExecutionContext, SimpleResponseFormatter } from '../core/types.js';
import type { Logger } from '../../../logging/index.js';
import type { ToolResponse } from '../../../types/index.js';
/**
 * Analytics service interface for execution tracking
 */
interface AnalyticsService {
    trackExecution?(data: {
        executionId: string;
        executionType: string;
        duration: number;
        frameworkUsed?: string;
        stepsExecuted?: number;
        success: boolean;
        sessionId?: string;
    }): void;
    trackError?(data: {
        executionId: string;
        executionType: string;
        errorType: string;
        errorMessage: string;
        sessionId?: string;
    }): void;
}
/**
 * Gate validation result interface
 */
interface GateValidationResult {
    passed: boolean;
    gateResults?: Array<{
        passed: boolean;
        name?: string;
        message?: string;
    }>;
    executionTime?: number;
    retryRequired?: boolean;
}
/**
 * Response format options
 */
interface ResponseFormatOptions {
    includeStructuredContent?: boolean;
    includeMetadata?: boolean;
    metadata?: Record<string, unknown>;
}
export declare class ResponseFormatter implements SimpleResponseFormatter {
    private analyticsService?;
    private readonly logger;
    constructor(logger?: Logger);
    /**
     * Set analytics service for tracking
     */
    setAnalyticsService(service: AnalyticsService): void;
    /**
     * Format general response content
     */
    formatResponse(content: unknown): ToolResponse;
    /**
     * Format prompt engine response with execution context
     */
    formatPromptEngineResponse(response: unknown, executionContext?: FormatterExecutionContext, options?: ResponseFormatOptions, gateResults?: GateValidationResult): ToolResponse;
    /**
     * Format error response
     */
    formatErrorResponse(error: unknown, executionContext?: FormatterExecutionContext, _options?: ResponseFormatOptions): ToolResponse;
    /**
     * Format chain execution response
     */
    formatChainResponse(response: unknown, chainId: string, currentStep: number, totalSteps: number, executionContext?: FormatterExecutionContext): ToolResponse;
    /**
     * Track execution for analytics
     */
    private trackExecution;
    /**
     * Track error for analytics
     */
    private trackError;
}
export {};
