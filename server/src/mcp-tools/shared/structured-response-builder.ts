/**
 * Unified MCP Structured Response Builder
 *
 * Provides consistent structured response creation across all MCP tools
 * to ensure MCP protocol compliance when outputSchema is defined.
 *
 * This addresses the issue where tools must provide structuredContent
 * when they declare an outputSchema, as required by MCP protocol.
 */

import { ToolResponse } from "../../types/index.js";
import { ErrorContext } from "../types/shared-types.js";

/**
 * Metadata for creating structured responses
 */
export interface ResponseMetadata {
  /** Tool name (prompt_manager, prompt_engine, system_control) */
  tool: string;

  /** Operation being performed (create, update, delete, execute, etc.) */
  operation: string;

  /** Type of execution for this operation */
  executionType?: "prompt" | "template" | "chain";

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
export class StructuredResponseBuilder {
  /**
   * Create a structured tool response with consistent metadata
   */
  static createToolResponse(content: string, metadata: ResponseMetadata): ToolResponse {
    const startTime = Date.now();
    const executionId = `${metadata.tool.toLowerCase()}-${metadata.operation}-${startTime}`;

    const response: ToolResponse = {
      content: [{ type: "text", text: content }],
      isError: false,
      structuredContent: {
        executionMetadata: {
          executionId,
          executionType: metadata.executionType || "prompt",
          startTime,
          endTime: startTime + (metadata.executionTime || 0),
          executionTime: metadata.executionTime || 0,
          frameworkEnabled: metadata.frameworkEnabled || false,
          frameworkUsed: metadata.frameworkUsed,
          stepsExecuted: metadata.stepsExecuted,
          sessionId: metadata.sessionId
        }
      }
    };

    // Add optional structured content fields
    if (metadata.analytics) {
      response.structuredContent!.analytics = metadata.analytics as any;
    }

    if (metadata.gateValidation) {
      response.structuredContent!.gateValidation = metadata.gateValidation;
    }

    // Add tool-specific operation data
    if (metadata.operationData) {
      response.structuredContent = {
        ...response.structuredContent,
        operationData: {
          tool: metadata.tool,
          operation: metadata.operation,
          ...metadata.operationData
        }
      };
    }

    return response;
  }

  /**
   * Create a structured error response
   */
  static createErrorResponse(error: Error | string, context: ErrorContext): ToolResponse {
    const timestamp = Date.now();
    const toolName = context.tool || 'unknown';
    const executionId = `${toolName.toLowerCase()}-error-${timestamp}`;
    const errorMessage = error instanceof Error ? error.message : error;

    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
      structuredContent: {
        executionMetadata: {
          executionId,
          executionType: "prompt",
          startTime: timestamp,
          endTime: timestamp,
          executionTime: 0,
          frameworkEnabled: false
        },
        errorInfo: {
          errorCode: toolName.toUpperCase() + "_ERROR",
          errorType: context.errorType || "system",
          message: errorMessage,
          details: context.details,
          timestamp,
          severity: context.severity || "medium",
          suggestedActions: context.suggestedActions,
          relatedComponents: context.relatedComponents
        }
      }
    };
  }

  /**
   * Create a simple response with minimal metadata (for backward compatibility)
   */
  static createSimpleResponse(content: string, tool: string, operation: string): ToolResponse {
    return this.createToolResponse(content, {
      tool,
      operation,
      executionType: "prompt",
      frameworkEnabled: false
    });
  }

  /**
   * Create a response for prompt operations with analysis data
   */
  static createPromptResponse(
    content: string,
    operation: string,
    promptData?: {
      promptId?: string;
      category?: string;
      analysisResult?: any;
      affectedFiles?: string[];
    }
  ): ToolResponse {
    return this.createToolResponse(content, {
      tool: "prompt_manager",
      operation,
      executionType: "prompt",
      frameworkEnabled: false,
      operationData: {
        promptId: promptData?.promptId,
        category: promptData?.category,
        analysisResult: promptData?.analysisResult,
        affectedFiles: promptData?.affectedFiles
      }
    });
  }

  /**
   * Create a response for execution operations
   */
  static createExecutionResponse(
    content: string,
    operation: string,
    executionData?: {
      executionType?: "prompt" | "template" | "chain";
      executionTime?: number;
      frameworkUsed?: string;
      stepsExecuted?: number;
      sessionId?: string;
      gateResults?: any;
    }
  ): ToolResponse {
    return this.createToolResponse(content, {
      tool: "prompt_engine",
      operation,
      executionType: executionData?.executionType || "prompt",
      executionTime: executionData?.executionTime,
      frameworkEnabled: !!executionData?.frameworkUsed,
      frameworkUsed: executionData?.frameworkUsed,
      stepsExecuted: executionData?.stepsExecuted,
      sessionId: executionData?.sessionId,
      gateValidation: executionData?.gateResults
    });
  }

  /**
   * Create a response for system control operations
   */
  static createSystemResponse(
    content: string,
    operation: string,
    systemData?: {
      frameworkState?: any;
      systemHealth?: any;
      configChanges?: any;
      analytics?: any;
    }
  ): ToolResponse {
    return this.createToolResponse(content, {
      tool: "system_control",
      operation,
      executionType: "prompt",
      frameworkEnabled: true,
      analytics: systemData?.analytics,
      operationData: {
        frameworkState: systemData?.frameworkState,
        systemHealth: systemData?.systemHealth,
        configChanges: systemData?.configChanges
      }
    });
  }
}

// Export convenience functions for easier usage (using function wrappers to avoid class reference timing issues)
export function createToolResponse(content: string, metadata: ResponseMetadata): ToolResponse {
  return StructuredResponseBuilder.createToolResponse(content, metadata);
}

export function createErrorResponse(error: Error | string, context: ErrorContext): ToolResponse {
  return StructuredResponseBuilder.createErrorResponse(error, context);
}

export function createSimpleResponse(content: string, tool: string, operation: string): ToolResponse {
  return StructuredResponseBuilder.createSimpleResponse(content, tool, operation);
}

export function createPromptResponse(
  content: string,
  operation: string,
  promptData?: {
    promptId?: string;
    category?: string;
    analysisResult?: any;
    affectedFiles?: string[];
  }
): ToolResponse {
  return StructuredResponseBuilder.createPromptResponse(content, operation, promptData);
}

export function createExecutionResponse(
  content: string,
  operation: string,
  executionData?: {
    executionType?: "prompt" | "template" | "chain";
    executionTime?: number;
    frameworkUsed?: string;
    stepsExecuted?: number;
    sessionId?: string;
    gateResults?: any;
  }
): ToolResponse {
  return StructuredResponseBuilder.createExecutionResponse(content, operation, executionData);
}

export function createSystemResponse(
  content: string,
  operation: string,
  systemData?: {
    frameworkState?: any;
    systemHealth?: any;
    configChanges?: any;
    analytics?: any;
  }
): ToolResponse {
  return StructuredResponseBuilder.createSystemResponse(content, operation, systemData);
}