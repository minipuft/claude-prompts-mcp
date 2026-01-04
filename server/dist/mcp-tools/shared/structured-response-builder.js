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
    static createToolResponse(content, metadata) {
        const startTime = Date.now();
        const executionId = `${metadata.tool.toLowerCase()}-${metadata.operation}-${startTime}`;
        const response = {
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
                },
            },
        };
        if (metadata.analytics) {
            response.structuredContent['analytics'] = metadata.analytics;
        }
        if (metadata.gateValidation) {
            response.structuredContent['gateValidation'] = metadata.gateValidation;
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
    static createErrorResponse(error, context) {
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
    static createSimpleResponse(content, tool, operation) {
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
    static createPromptResponse(content, operation, promptData, includeStructuredContent = false) {
        if (!includeStructuredContent) {
            return {
                content: [{ type: 'text', text: content }],
                isError: false,
            };
        }
        return this.createToolResponse(content, {
            tool: 'prompt_manager',
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
    static createExecutionResponse(content, operation, executionData, includeStructuredContent = true) {
        if (!includeStructuredContent) {
            return {
                content: [{ type: 'text', text: content }],
                isError: false,
            };
        }
        const responseMetadata = {
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
    static createSystemResponse(content, operation, systemData, includeStructuredContent = false) {
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
export function createToolResponse(content, metadata) {
    return StructuredResponseBuilder.createToolResponse(content, metadata);
}
export function createErrorResponse(error, context) {
    return StructuredResponseBuilder.createErrorResponse(error, context);
}
export function createSimpleResponse(content, tool, operation) {
    return StructuredResponseBuilder.createSimpleResponse(content, tool, operation);
}
export function createPromptResponse(content, operation, promptData, includeStructuredContent = false) {
    return StructuredResponseBuilder.createPromptResponse(content, operation, promptData, includeStructuredContent);
}
export function createExecutionResponse(content, operation, executionData, includeStructuredContent = true) {
    return StructuredResponseBuilder.createExecutionResponse(content, operation, executionData, includeStructuredContent);
}
export function createSystemResponse(content, operation, systemData, includeStructuredContent = false) {
    return StructuredResponseBuilder.createSystemResponse(content, operation, systemData, includeStructuredContent);
}
//# sourceMappingURL=structured-response-builder.js.map