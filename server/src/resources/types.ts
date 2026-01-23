/**
 * MCP Resources Types
 *
 * Type definitions for MCP resource handlers, URI patterns, and metadata.
 * Resources provide token-efficient read-only access to prompts, gates, and observability data.
 */

import type { Logger } from '../logging/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Resource URI patterns for discovery and content retrieval.
 * Simple format: resource://type/[id][/subresource]
 */
export const RESOURCE_URI_PATTERNS = {
  // Prompt resources (full URI scheme required by MCP SDK ResourceTemplate)
  PROMPT_LIST: 'resource://prompt/',
  PROMPT_ITEM: 'resource://prompt/{id}',
  PROMPT_TEMPLATE: 'resource://prompt/{id}/template',

  // Gate resources
  GATE_LIST: 'resource://gate/',
  GATE_ITEM: 'resource://gate/{id}',
  GATE_GUIDANCE: 'resource://gate/{id}/guidance',

  // Methodology resources (Phase 2)
  METHODOLOGY_LIST: 'resource://methodology/',
  METHODOLOGY_ITEM: 'resource://methodology/{id}',
  METHODOLOGY_SYSTEM_PROMPT: 'resource://methodology/{id}/system-prompt',

  // Observability resources (Phase 2)
  SESSION_LIST: 'resource://session/',
  SESSION_ITEM: 'resource://session/{chainId}',
  METRICS_PIPELINE: 'resource://metrics/pipeline',
} as const;

/**
 * Resource metadata for list responses (minimal, token-efficient)
 */
export interface ResourceListItem {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

/**
 * Prompt resource metadata for list responses
 */
export interface PromptResourceMetadata extends ResourceListItem {
  type: 'single' | 'chain';
  argumentCount: number;
  category?: string;
}

/**
 * Gate resource metadata for list responses
 */
export interface GateResourceMetadata extends ResourceListItem {
  type: 'validation' | 'guidance';
  enabled: boolean;
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Methodology resource metadata for list responses
 */
export interface MethodologyResourceMetadata extends ResourceListItem {
  type: string;
  enabled: boolean;
  priority: number;
}

/**
 * Session resource metadata for list responses
 */
export interface SessionResourceMetadata extends ResourceListItem {
  chainId: string;
  currentStep: number;
  totalSteps: number;
  pendingReview: boolean;
  lastActivity: number;
}

/**
 * Dependencies required by resource handlers.
 * Passed by reference to ensure hot-reload compatibility.
 */
export interface ResourceDependencies {
  logger: Logger;
  // Prompt-related dependencies - uses ConvertedPrompt interface from execution/types
  promptManager?: {
    getConvertedPrompts(): Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      systemMessage?: string;
      userMessageTemplate: string;
      arguments: Array<{
        name: string;
        type?: string;
        description?: string;
        required?: boolean;
      }>;
      // ChainStep has promptId and stepName, not id
      chainSteps?: Array<{ promptId: string; stepName: string }>;
    }>;
  };
  // Gate-related dependencies - uses IGateGuide interface from gates/types
  // Uses BaseResourceManager public methods: list() and get()
  gateManager?: {
    list(enabledOnly?: boolean): Array<{
      gateId: string;
      name: string;
      description: string;
      type: 'validation' | 'guidance';
      severity: 'critical' | 'high' | 'medium' | 'low';
      getGuidance(): string;
    }>;
    get(id: string):
      | {
          gateId: string;
          name: string;
          description: string;
          type: 'validation' | 'guidance';
          severity: 'critical' | 'high' | 'medium' | 'low';
          getGuidance(): string;
        }
      | undefined;
  };
  // Methodology/framework dependencies (Phase 2)
  frameworkManager?: {
    listFrameworks(enabledOnly?: boolean): Array<{
      id: string;
      name: string;
      description: string;
      type: string;
      systemPromptTemplate: string;
      executionGuidelines: string[];
      priority: number;
      enabled: boolean;
    }>;
    getFramework(id: string):
      | {
          id: string;
          name: string;
          description: string;
          type: string;
          systemPromptTemplate: string;
          executionGuidelines: string[];
          priority: number;
          enabled: boolean;
        }
      | undefined;
  };
  // Session and metrics dependencies (Phase 2)
  chainSessionManager?: {
    listActiveSessions(limit?: number): Array<{
      sessionId: string;
      chainId: string;
      currentStep: number;
      totalSteps: number;
      pendingReview: boolean;
      lastActivity: number;
      startTime: number;
      promptName?: string;
      promptId?: string;
    }>;
    getSession(sessionId: string):
      | {
          sessionId: string;
          chainId: string;
          state: {
            currentStep: number;
            totalSteps: number;
            stepStates?: Map<number, unknown>;
          };
          startTime: number;
          lastActivity: number;
          originalArgs: Record<string, unknown>;
          pendingGateReview?: unknown;
        }
      | undefined;
    /** Lookup by user-facing chainId (e.g., chain-quick_decision#1) */
    getSessionByChainIdentifier(chainId: string):
      | {
          sessionId: string;
          chainId: string;
          state: {
            currentStep: number;
            totalSteps: number;
            stepStates?: Map<number, unknown>;
          };
          startTime: number;
          lastActivity: number;
          originalArgs: Record<string, unknown>;
          pendingGateReview?: unknown;
        }
      | undefined;
    getSessionStats(): {
      totalSessions: number;
      totalChains: number;
      averageStepsPerChain: number;
      oldestSessionAge: number;
    };
  };
  metricsCollector?: {
    getAnalyticsSummary(): {
      executionStats: {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        averageExecutionTime: number;
      };
      systemMetrics: {
        uptime: number;
        memoryUsage: { heapUsed: number; heapTotal: number };
        averageResponseTime: number;
        requestsPerMinute: number;
        errorRate: number;
        performanceTrends: unknown[]; // Excluded from resource output (token fodder)
      };
      frameworkUsage: {
        currentFramework: string;
        frameworkSwitches: number;
      };
      gateValidationStats: {
        totalValidations: number;
        validationSuccessRate: number;
        averageValidationTime: number;
        gateAdoptionRate: number;
      };
      recommendations: string[];
    };
  };
}

/**
 * Resource registration context passed to handler registration functions
 */
export interface ResourceRegistrationContext {
  server: McpServer;
  dependencies: ResourceDependencies;
}

/**
 * Result type for resource content
 */
export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

/**
 * Standard resource read result
 */
export interface ResourceReadResult {
  contents: ResourceContent[];
}

/**
 * Error thrown when a resource is not found
 */
export class ResourceNotFoundError extends Error {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string
  ) {
    super(`${resourceType} not found: ${resourceId}`);
    this.name = 'ResourceNotFoundError';
  }
}
