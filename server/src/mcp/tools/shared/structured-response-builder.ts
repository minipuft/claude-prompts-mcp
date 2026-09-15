// @lifecycle canonical - Builds structured MCP responses for tools.
/**
 * Unified MCP Structured Response Builder
 *
 * Provides consistent structured response creation across all MCP tools
 * to ensure MCP protocol compliance when outputSchema is defined.
 *
 * This addresses the issue where tools must provide structuredContent
 * when they declare an outputSchema, as required by MCP protocol.
 */

import type { GateValidationInfo, McpErrorCode, ToolResponse } from '#shared/types/index.js';
import type { ErrorContext } from '../types/shared-types.js';

/**
 * Claude Code 2.1.272 passes a tool result's `structuredContent` to the model in place of
 * `content` whenever both are present (anthropics/claude-code#9962, #55677, #15412, #64316,
 * measured against this server). A result that puts its write receipt, preview notice, or
 * validation outcome only in `content` text is then invisible to the model the moment it also
 * carries `structuredContent` — which `resource_manager`'s `validate`/`create`/`preview`/
 * `update`/`inspect` do.
 *
 * `deriveStructuredMessage` closes that class at the one place every MCP tool result passes
 * through on its way to the transport (`McpToolRouter` in `../index.js`): whenever a response
 * carries both channels, it copies the same readable text — the `content` text parts, joined in
 * order — into `structuredContent.message`, so a client reading only the JSON half still gets it.
 * A `content`-only result is returned unchanged, and an existing `message` key is left alone
 * rather than overwritten, since that would mean some other construction site already owns the
 * name for a different purpose.
 */
export function deriveStructuredMessage(
  response: Pick<ToolResponse, 'content' | 'structuredContent'>
): Record<string, unknown> | undefined {
  const { content, structuredContent } = response;
  if (structuredContent == null) {
    return structuredContent;
  }
  if ('message' in structuredContent) {
    return structuredContent;
  }

  // Every `ToolResponse.content` part is `{ type: 'text'; text: string }` — there is no other
  // member of the union to filter out.
  const message = content.map((part) => part.text).join('\n\n');
  if (message === '') {
    return structuredContent;
  }

  return { ...structuredContent, message };
}

/**
 * Metadata for creating structured responses
 */
export interface ResponseMetadata {
  /** Tool name (resource_manager, prompt_engine, system_control) */
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
  /** Chain ID for chain execution tracking */
  chainId?: string;
  /** Tool-specific operation data */
  operationData?: Record<string, any>;
  /** Analytics data to include */
  analytics?:
    | {
        totalExecutions: number;
        successRate: number;
        averageExecutionTime: number;
        frameworkSwitches?: number;
        gateValidationCount?: number;
        errorCount?: number;
        uptime: number;
      }
    | Record<string, any>;
  /**
   * Gate validation results.
   * Use the full GateValidationInfo type for complete structured response contract.
   */
  gateValidation?:
    | Partial<GateValidationInfo>
    | {
        enabled: boolean;
        passed: boolean;
        totalGates: number;
        failedGates: Array<any>;
        passedGates?: Array<any>;
        executionTime: number;
        retryCount?: number;
      };
  /**
   * Error code for programmatic error handling by client hooks.
   * When set, clients can route errors without parsing text.
   */
  errorCode?: McpErrorCode;
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
      content: [{ type: 'text', text: content }],
      isError: false,
      structuredContent: {
        executionMetadata: {
          executionId,
          executionType: metadata.executionType || 'single',
          startTime,
          endTime: startTime + (metadata.executionTime || 0),
          executionTime: metadata.executionTime || 0,
          frameworkEnabled: metadata.frameworkEnabled || false,
          frameworkUsed: metadata.frameworkUsed,
          stepsExecuted: metadata.stepsExecuted,
          sessionId: metadata.sessionId,
          chainId: metadata.chainId,
        },
      },
    };

    // Add error code for programmatic client routing
    if (metadata.errorCode !== undefined) {
      response.structuredContent!['errorCode'] = metadata.errorCode;
    }

    if (metadata.analytics) {
      response.structuredContent!['analytics'] = metadata.analytics;
    }

    if (metadata.gateValidation) {
      response.structuredContent!['gateValidation'] = metadata.gateValidation;
    }

    if (metadata.operationData) {
      response.structuredContent = {
        ...response.structuredContent,
        operationData: {
          tool: metadata.tool,
          operation: metadata.operation,
          ...metadata.operationData,
        },
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
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
      isError: true,
      structuredContent: {
        executionMetadata: {
          executionId,
          executionType: 'single',
          startTime: timestamp,
          endTime: timestamp,
          executionTime: 0,
          frameworkEnabled: false,
        },
        errorInfo: {
          errorCode: `${toolName.toUpperCase()}_ERROR`,
          errorType: context.errorType || 'system',
          message: errorMessage,
          details: context.details,
          timestamp,
          severity: context.severity || 'medium',
          suggestedActions: context.suggestedActions,
          relatedComponents: context.relatedComponents,
        },
      },
    };
  }

  /**
   * Create a simple response with minimal metadata (for backward compatibility)
   */
  static createSimpleResponse(content: string, tool: string, operation: string): ToolResponse {
    return this.createToolResponse(content, {
      tool,
      operation,
      executionType: 'single',
      frameworkEnabled: false,
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
    },
    includeStructuredContent: boolean = false
  ): ToolResponse {
    if (!includeStructuredContent) {
      return {
        content: [{ type: 'text', text: content }],
        isError: false,
      };
    }

    return this.createToolResponse(content, {
      tool: 'resource_manager',
      operation,
      executionType: 'single',
      frameworkEnabled: false,
      operationData: {
        promptId: promptData?.promptId,
        category: promptData?.category,
        analysisResult: promptData?.analysisResult,
        affectedFiles: promptData?.affectedFiles,
      },
    });
  }

  /**
   * Create a response for execution operations
   */
  static createExecutionResponse(
    content: string,
    operation: string,
    executionData?: {
      executionType?: 'single' | 'chain';
      executionTime?: number;
      frameworkUsed?: string;
      stepsExecuted?: number;
      sessionId?: string;
      gateResults?: any;
    },
    includeStructuredContent: boolean = true
  ): ToolResponse {
    if (!includeStructuredContent) {
      return {
        content: [{ type: 'text', text: content }],
        isError: false,
      };
    }

    const responseMetadata: ResponseMetadata = {
      tool: 'prompt_engine',
      operation,
      executionType: executionData?.executionType || 'single',
      frameworkEnabled: !!executionData?.frameworkUsed,
    };

    if (executionData?.executionTime !== undefined) {
      responseMetadata.executionTime = executionData.executionTime;
    }
    if (executionData?.frameworkUsed !== undefined) {
      responseMetadata.frameworkUsed = executionData.frameworkUsed;
    }
    if (executionData?.stepsExecuted !== undefined) {
      responseMetadata.stepsExecuted = executionData.stepsExecuted;
    }
    if (executionData?.sessionId !== undefined) {
      responseMetadata.sessionId = executionData.sessionId;
    }
    if (executionData?.gateResults !== undefined) {
      responseMetadata.gateValidation = executionData.gateResults;
    }

    return this.createToolResponse(content, responseMetadata);
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
    },
    includeStructuredContent: boolean = false
  ): ToolResponse {
    if (!includeStructuredContent) {
      return {
        content: [{ type: 'text', text: content }],
        isError: false,
      };
    }

    return this.createToolResponse(content, {
      tool: 'system_control',
      operation,
      executionType: 'single',
      frameworkEnabled: true,
      analytics: systemData?.analytics,
      operationData: {
        frameworkState: systemData?.frameworkState,
        systemHealth: systemData?.systemHealth,
        configChanges: systemData?.configChanges,
      },
    });
  }
}

// Export convenience functions for easier usage (using wrappers to avoid class reference timing issues)
export function createToolResponse(content: string, metadata: ResponseMetadata): ToolResponse {
  return StructuredResponseBuilder.createToolResponse(content, metadata);
}

export function createErrorResponse(error: Error | string, context: ErrorContext): ToolResponse {
  return StructuredResponseBuilder.createErrorResponse(error, context);
}

export function createSimpleResponse(
  content: string,
  tool: string,
  operation: string
): ToolResponse {
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
  },
  includeStructuredContent: boolean = false
): ToolResponse {
  return StructuredResponseBuilder.createPromptResponse(
    content,
    operation,
    promptData,
    includeStructuredContent
  );
}

export function createExecutionResponse(
  content: string,
  operation: string,
  executionData?: {
    executionType?: 'single' | 'chain';
    executionTime?: number;
    frameworkUsed?: string;
    stepsExecuted?: number;
    sessionId?: string;
    gateResults?: any;
  },
  includeStructuredContent: boolean = true
): ToolResponse {
  return StructuredResponseBuilder.createExecutionResponse(
    content,
    operation,
    executionData,
    includeStructuredContent
  );
}

export function createSystemResponse(
  content: string,
  operation: string,
  systemData?: {
    frameworkState?: any;
    systemHealth?: any;
    configChanges?: any;
    analytics?: any;
  },
  includeStructuredContent: boolean = false
): ToolResponse {
  return StructuredResponseBuilder.createSystemResponse(
    content,
    operation,
    systemData,
    includeStructuredContent
  );
}
