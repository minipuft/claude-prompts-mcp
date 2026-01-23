/**
 * Observability Resources Handler
 *
 * Registers MCP resources for token-efficient access to session state and metrics.
 * These provide read-only observability into the runtime system.
 *
 * URI Patterns:
 * - resource://session/              → List active chain sessions
 * - resource://session/{chainId}     → Individual session state
 * - resource://metrics/pipeline      → Pipeline execution metrics and analytics
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ResourceNotFoundError, RESOURCE_URI_PATTERNS } from '../types.js';

import type { SessionResourceMetadata, ResourceDependencies } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Build resource URI from pattern and optional ID
 * Patterns already include the full URI scheme (resource://...)
 */
function buildUri(pattern: string, id?: string): string {
  if (id !== undefined && id !== '') {
    return pattern.replace('{chainId}', id);
  }
  return pattern;
}

/**
 * Register observability-related MCP resources (sessions and metrics).
 *
 * Resources read from managers at request time to ensure
 * hot-reload compatibility and real-time data.
 */
export function registerObservabilityResources(
  server: McpServer,
  dependencies: ResourceDependencies
): void {
  const { logger, chainSessionManager, metricsCollector } = dependencies;

  // Register session resources if ChainSessionManager is available
  if (chainSessionManager !== undefined) {
    registerSessionResources(server, dependencies);
    logger.debug('[ObservabilityResources] Session resources registered');
  } else {
    logger.warn(
      '[ObservabilityResources] ChainSessionManager not available, skipping session resources'
    );
  }

  // Register metrics resources if MetricsCollector is available
  if (metricsCollector !== undefined) {
    registerMetricsResources(server, dependencies);
    logger.debug('[ObservabilityResources] Metrics resources registered');
  } else {
    logger.warn(
      '[ObservabilityResources] MetricsCollector not available, skipping metrics resources'
    );
  }

  logger.info('[ObservabilityResources] Registered observability resources');
}

/**
 * Register session-related resources
 */
function registerSessionResources(server: McpServer, dependencies: ResourceDependencies): void {
  const { logger, chainSessionManager } = dependencies;

  if (chainSessionManager === undefined) {
    return;
  }

  // Resource: List active sessions (minimal metadata for token efficiency)
  server.registerResource(
    'sessions',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.SESSION_LIST, {
      list: async () => {
        const sessions = chainSessionManager.listActiveSessions(50);
        logger.debug(`[ObservabilityResources] Listing ${sessions.length} active sessions`);

        // Use chainId (user-facing) in URIs, not internal sessionId
        const resources: SessionResourceMetadata[] = sessions.map((s) => ({
          uri: buildUri(RESOURCE_URI_PATTERNS.SESSION_ITEM, s.chainId),
          name: s.chainId,
          title: s.promptName ?? s.chainId,
          description: `Step ${s.currentStep}/${s.totalSteps}${s.pendingReview ? ' (pending review)' : ''}`,
          mimeType: 'application/json',
          chainId: s.chainId,
          currentStep: s.currentStep,
          totalSteps: s.totalSteps,
          pendingReview: s.pendingReview,
          lastActivity: s.lastActivity,
        }));

        return { resources };
      },
    }),
    {
      description: 'List of active chain sessions with status',
      mimeType: 'application/json',
    },
    async (): Promise<ReadResourceResult> => {
      const sessions = chainSessionManager.listActiveSessions(50);
      // Use chainId (user-facing) in URIs, not internal sessionId
      const list: SessionResourceMetadata[] = sessions.map((s) => ({
        uri: buildUri(RESOURCE_URI_PATTERNS.SESSION_ITEM, s.chainId),
        name: s.chainId,
        title: s.promptName ?? s.chainId,
        description: `Step ${s.currentStep}/${s.totalSteps}${s.pendingReview ? ' (pending review)' : ''}`,
        mimeType: 'application/json',
        chainId: s.chainId,
        currentStep: s.currentStep,
        totalSteps: s.totalSteps,
        pendingReview: s.pendingReview,
        lastActivity: s.lastActivity,
      }));

      return {
        contents: [
          {
            uri: buildUri(RESOURCE_URI_PATTERNS.SESSION_LIST),
            mimeType: 'application/json',
            text: JSON.stringify(list, null, 2),
          },
        ],
      };
    }
  );

  // Resource: Individual session state
  server.registerResource(
    'session',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.SESSION_ITEM, {
      list: undefined, // Individual items discovered via list resource
    }),
    {
      description: 'Individual chain session state and progress',
      mimeType: 'application/json',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const chainId = variables['chainId'] as string;

      // Use chainId lookup (user-facing identifier like chain-quick_decision#1)
      const session = chainSessionManager.getSessionByChainIdentifier(chainId);

      if (session === undefined) {
        throw new ResourceNotFoundError('Session', chainId);
      }

      logger.debug(`[ObservabilityResources] Reading session: ${chainId}`);

      // Build session content (JSON format for structured data)
      const content = buildSessionContent(session);

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: content,
          },
        ],
      };
    }
  );
}

/**
 * Register metrics-related resources
 */
function registerMetricsResources(server: McpServer, dependencies: ResourceDependencies): void {
  const { logger, metricsCollector, chainSessionManager } = dependencies;

  if (metricsCollector === undefined) {
    return;
  }

  // Resource: Pipeline metrics and analytics
  server.registerResource(
    'metrics-pipeline',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.METRICS_PIPELINE, {
      list: undefined, // Single resource, no list needed
    }),
    {
      description: 'Pipeline execution metrics and analytics summary',
      mimeType: 'application/json',
    },
    async (uri): Promise<ReadResourceResult> => {
      logger.debug('[ObservabilityResources] Reading pipeline metrics');

      const analytics = metricsCollector.getAnalyticsSummary();
      const sessionStats = chainSessionManager?.getSessionStats();

      // Lean metrics: exclude performanceTrends (token fodder), include useful aggregates
      const { performanceTrends: _trends, ...leanSystemMetrics } = analytics.systemMetrics;

      const metrics = {
        execution: analytics.executionStats,
        system: leanSystemMetrics,
        framework: analytics.frameworkUsage,
        gates: analytics.gateValidationStats,
        recommendations: analytics.recommendations,
        sessions: sessionStats ?? {
          totalSessions: 0,
          totalChains: 0,
          averageStepsPerChain: 0,
          oldestSessionAge: 0,
        },
        timestamp: Date.now(),
      };

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(metrics, null, 2),
          },
        ],
      };
    }
  );
}

/**
 * Build formatted session content as JSON
 */
function buildSessionContent(session: {
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
}): string {
  // Convert step states Map to object if present
  const stepStates: Record<string, unknown> = {};
  if (session.state.stepStates !== undefined) {
    for (const [step, state] of session.state.stepStates) {
      stepStates[String(step)] = state;
    }
  }

  const content = {
    sessionId: session.sessionId,
    chainId: session.chainId,
    progress: {
      currentStep: session.state.currentStep,
      totalSteps: session.state.totalSteps,
      percentComplete: Math.round((session.state.currentStep / session.state.totalSteps) * 100),
    },
    timing: {
      startTime: session.startTime,
      lastActivity: session.lastActivity,
      durationMs: session.lastActivity - session.startTime,
      startTimeISO: new Date(session.startTime).toISOString(),
      lastActivityISO: new Date(session.lastActivity).toISOString(),
    },
    originalArgs: session.originalArgs,
    stepStates: Object.keys(stepStates).length > 0 ? stepStates : undefined,
    hasPendingReview: session.pendingGateReview !== undefined,
  };

  return JSON.stringify(content, null, 2);
}
