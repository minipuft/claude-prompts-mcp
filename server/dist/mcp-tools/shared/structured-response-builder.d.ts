/**
 * Unified MCP Structured Response Builder
 *
 * Provides consistent structured response creation across all MCP tools
 * to ensure MCP protocol compliance when outputSchema is defined.
 *
 * This addresses the issue where tools must provide structuredContent
 * when they declare an outputSchema, as required by MCP protocol.
 */
import type { ToolResponse } from '../../types/index.js';
import type { ErrorContext } from '../types/shared-types.js';
/**
 * Metadata for creating structured responses
 */
export interface ResponseMetadata {
    /** Tool name (prompt_manager, prompt_engine, system_control) */
    tool: string;
    /** Operation being performed (create, update, delete, execute, etc.) */
    operation: string;
    /** Type of execution for this operation */
    executionType?: 'single' | 'chain';
    /** Execution time in milliseconds */
    executionTime?: number;
    /** Whether framework processing was enabled */
    frameworkEnabled?: boolean;
    /** Framework that was used (if any) */
    frameworkUsed?: string;
    /** Number of steps executed (for chain operations) */
    stepsExecuted?: number;
    /** Session ID for tracking related operations */
    sessionId?: string;
    /** Tool-specific operation data */
    operationData?: Record<string, any>;
    /** Analytics data to include */
    analytics?: {
        totalExecutions: number;
        successRate: number;
        averageExecutionTime: number;
        frameworkSwitches?: number;
        gateValidationCount?: number;
        errorCount?: number;
        uptime: number;
    } | Record<string, any>;
    /** Gate validation results */
    gateValidation?: {
        enabled: boolean;
        passed: boolean;
        totalGates: number;
        failedGates: Array<any>;
        passedGates?: Array<any>;
        executionTime: number;
        retryCount?: number;
    };
}
/**
 * Context for error responses
 */
/**
 * Unified structured response builder for MCP tools
 */
export declare class StructuredResponseBuilder {
    /**
     * Create a structured tool response with consistent metadata
     */
    static createToolResponse(content: string, metadata: ResponseMetadata): ToolResponse;
    /**
     * Create a structured error response
     */
    static createErrorResponse(error: Error | string, context: ErrorContext): ToolResponse;
    /**
     * Create a simple response with minimal metadata (for backward compatibility)
     */
    static createSimpleResponse(content: string, tool: string, operation: string): ToolResponse;
    /**
     * Create a response for prompt operations with analysis data
     */
    static createPromptResponse(content: string, operation: string, promptData?: {
        promptId?: string;
        category?: string;
        analysisResult?: any;
        affectedFiles?: string[];
    }, includeStructuredContent?: boolean): ToolResponse;
    /**
     * Create a response for execution operations
     */
    static createExecutionResponse(content: string, operation: string, executionData?: {
        executionType?: 'single' | 'chain';
        executionTime?: number;
        frameworkUsed?: string;
        stepsExecuted?: number;
        sessionId?: string;
        gateResults?: any;
    }, includeStructuredContent?: boolean): ToolResponse;
    /**
     * Create a response for system control operations
     */
    static createSystemResponse(content: string, operation: string, systemData?: {
        frameworkState?: any;
        systemHealth?: any;
        configChanges?: any;
        analytics?: any;
    }, includeStructuredContent?: boolean): ToolResponse;
}
export declare function createToolResponse(content: string, metadata: ResponseMetadata): ToolResponse;
export declare function createErrorResponse(error: Error | string, context: ErrorContext): ToolResponse;
export declare function createSimpleResponse(content: string, tool: string, operation: string): ToolResponse;
export declare function createPromptResponse(content: string, operation: string, promptData?: {
    promptId?: string;
    category?: string;
    analysisResult?: any;
    affectedFiles?: string[];
}, includeStructuredContent?: boolean): ToolResponse;
export declare function createExecutionResponse(content: string, operation: string, executionData?: {
    executionType?: 'single' | 'chain';
    executionTime?: number;
    frameworkUsed?: string;
    stepsExecuted?: number;
    sessionId?: string;
    gateResults?: any;
}, includeStructuredContent?: boolean): ToolResponse;
export declare function createSystemResponse(content: string, operation: string, systemData?: {
    frameworkState?: any;
    systemHealth?: any;
    configChanges?: any;
    analytics?: any;
}, includeStructuredContent?: boolean): ToolResponse;
