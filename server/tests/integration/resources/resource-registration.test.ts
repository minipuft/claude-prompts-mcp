/**
 * Integration test for MCP Resources registration and handler behavior.
 *
 * Tests that:
 * 1. Prompt resources register correctly and return expected data
 * 2. Gate resources register correctly and return expected data
 * 3. Resource list changed notifications work
 * 4. Resources work with real prompt/gate data
 */

import { describe, test, expect, beforeAll, afterAll, jest, beforeEach } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerResources, notifyResourcesChanged } from '../../../src/resources/index.js';
import type { ResourceDependencies } from '../../../src/resources/types.js';
import { RESOURCE_URI_PATTERNS } from '../../../src/resources/types.js';
import type { Logger } from '../../../src/logging/index.js';
import { GateManager, createGateManager } from '../../../src/gates/gate-manager.js';

// Set up server root for gate loader to find resources
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../../..');

describe('MCP Resources Registration Integration', () => {
  let gateManager: GateManager;
  let mockLogger: Logger;
  let originalServerRoot: string | undefined;

  // Mock MCP server with captured registrations
  let registeredResources: Map<
    string,
    {
      template: unknown;
      options: unknown;
      readHandler: (uri: URL, variables: Record<string, string>) => Promise<unknown>;
    }
  >;
  let mockMcpServer: {
    registerResource: jest.Mock;
    sendResourceListChanged: jest.Mock;
  };

  beforeAll(async () => {
    // Save and set MCP_SERVER_ROOT for gate loader
    originalServerRoot = process.env.MCP_SERVER_ROOT;
    process.env.MCP_SERVER_ROOT = serverRoot;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    gateManager = await createGateManager(mockLogger, { debug: false });
  });

  beforeEach(() => {
    // Reset registered resources for each test
    registeredResources = new Map();

    // Create mock MCP server that captures registrations
    mockMcpServer = {
      registerResource: jest.fn(
        (name: string, template: unknown, options: unknown, readHandler: unknown) => {
          registeredResources.set(name, {
            template,
            options,
            readHandler: readHandler as (
              uri: URL,
              variables: Record<string, string>
            ) => Promise<unknown>,
          });
        }
      ),
      sendResourceListChanged: jest.fn(),
    };
  });

  afterAll(() => {
    // Restore original MCP_SERVER_ROOT
    if (originalServerRoot !== undefined) {
      process.env.MCP_SERVER_ROOT = originalServerRoot;
    } else {
      delete process.env.MCP_SERVER_ROOT;
    }
  });

  describe('registerResources()', () => {
    test('registers prompt resources when prompt assets are provided', () => {
      const mockPromptAssetManager = {
        getConvertedPrompts: () => [
          {
            id: 'test-prompt',
            name: 'Test Prompt',
            description: 'A test prompt',
            category: 'testing',
            userMessageTemplate: 'Hello {{name}}',
            arguments: [{ name: 'name', type: 'string', required: true }],
          },
        ],
      };

      const dependencies: ResourceDependencies = {
        logger: mockLogger,
        promptManager: mockPromptAssetManager,
      };

      registerResources(mockMcpServer as never, dependencies);

      expect(mockMcpServer.registerResource).toHaveBeenCalled();
      expect(registeredResources.has('prompts')).toBe(true);
      expect(registeredResources.has('prompt')).toBe(true);
      expect(registeredResources.has('prompt-template')).toBe(true);
    });

    test('registers gate resources when gateManager is provided', () => {
      const dependencies: ResourceDependencies = {
        logger: mockLogger,
        gateManager: {
          list: (enabledOnly?: boolean) => gateManager.list(enabledOnly),
          get: (id: string) => gateManager.get(id),
        },
      };

      registerResources(mockMcpServer as never, dependencies);

      expect(registeredResources.has('gates')).toBe(true);
      expect(registeredResources.has('gate')).toBe(true);
      expect(registeredResources.has('gate-guidance')).toBe(true);
    });

    test('skips prompt resources when prompt assets not provided', () => {
      const dependencies: ResourceDependencies = {
        logger: mockLogger,
        // No prompt assets
      };

      registerResources(mockMcpServer as never, dependencies);

      expect(registeredResources.has('prompts')).toBe(false);
      expect(registeredResources.has('prompt')).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    test('skips gate resources when gateManager not provided', () => {
      const dependencies: ResourceDependencies = {
        logger: mockLogger,
        // No gateManager
      };

      registerResources(mockMcpServer as never, dependencies);

      expect(registeredResources.has('gates')).toBe(false);
      expect(registeredResources.has('gate')).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('Prompt Resource Handlers', () => {
    const testPrompts = [
      {
        id: 'analysis-report',
        name: 'Analysis Report',
        description: 'Generate detailed analysis reports',
        category: 'analysis',
        userMessageTemplate: 'Analyze {{topic}} with focus on {{aspect}}',
        arguments: [
          { name: 'topic', type: 'string', required: true, description: 'Topic to analyze' },
          { name: 'aspect', type: 'string', required: false },
        ],
        chainSteps: [
          { promptId: 'gather-data', stepName: 'Gather Data' },
          { promptId: 'synthesize', stepName: 'Synthesize Results' },
        ],
      },
      {
        id: 'simple-greeting',
        name: 'Simple Greeting',
        description: 'A simple greeting prompt',
        category: 'greeting',
        userMessageTemplate: 'Hello, {{name}}!',
        arguments: [{ name: 'name', type: 'string', required: true }],
      },
    ];

    beforeEach(() => {
      const dependencies: ResourceDependencies = {
        logger: mockLogger,
        promptManager: {
          getConvertedPrompts: () => testPrompts,
        },
      };

      registerResources(mockMcpServer as never, dependencies);
    });

    test('prompts list handler returns all prompts with metadata', async () => {
      const handler = registeredResources.get('prompts')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(`resource://${RESOURCE_URI_PATTERNS.PROMPT_LIST}`),
        {}
      )) as { contents: Array<{ text: string; mimeType: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('text/plain');

      // New compact format: "Prompts (N):\nid: title - args"
      const text = result.contents[0].text;
      expect(text).toContain('Prompts (2):');
      expect(text).toContain('analysis-report: Analysis Report - topic, aspect');
      expect(text).toContain('simple-greeting: Simple Greeting - name');
    });

    test('individual prompt handler returns full content', async () => {
      const handler = registeredResources.get('prompt')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(
          `resource://${RESOURCE_URI_PATTERNS.PROMPT_ITEM.replace('{id}', 'analysis-report')}`
        ),
        { id: 'analysis-report' }
      )) as { contents: Array<{ text: string; mimeType: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('text/markdown');

      const content = result.contents[0].text;
      expect(content).toContain('# Analysis Report');
      expect(content).toContain('**ID:** `analysis-report`');
      expect(content).toContain('**Category:** analysis');
      expect(content).toContain('**Type:** chain');
      expect(content).toContain('## Arguments');
      expect(content).toContain('**topic** (required)');
      expect(content).toContain('## Chain Steps');
      expect(content).toContain('2 steps: Gather Data → Synthesize Results');
      expect(content).toContain('## Template');
    });

    test('prompt template handler returns raw template only', async () => {
      const handler = registeredResources.get('prompt-template')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(
          `resource://${RESOURCE_URI_PATTERNS.PROMPT_TEMPLATE.replace('{id}', 'simple-greeting')}`
        ),
        { id: 'simple-greeting' }
      )) as { contents: Array<{ text: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toBe('Hello, {{name}}!');
    });

    test('prompt handler throws for non-existent prompt', async () => {
      const handler = registeredResources.get('prompt')?.readHandler;

      await expect(
        handler!(
          new URL(
            `resource://${RESOURCE_URI_PATTERNS.PROMPT_ITEM.replace('{id}', 'non-existent')}`
          ),
          { id: 'non-existent' }
        )
      ).rejects.toThrow('Prompt not found: non-existent');
    });
  });

  describe('Gate Resource Handlers', () => {
    beforeEach(() => {
      const dependencies: ResourceDependencies = {
        logger: mockLogger,
        gateManager: {
          list: (enabledOnly?: boolean) => gateManager.list(enabledOnly),
          get: (id: string) => gateManager.get(id),
        },
      };

      registerResources(mockMcpServer as never, dependencies);
    });

    test('gates list handler returns all gates with metadata', async () => {
      const handler = registeredResources.get('gates')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(`resource://${RESOURCE_URI_PATTERNS.GATE_LIST}`),
        {}
      )) as { contents: Array<{ text: string; mimeType: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('text/plain');

      // New compact format: "Gates (N):\nid: name (type)"
      const text = result.contents[0].text;
      expect(text).toMatch(/^Gates \(\d+\):/);
      // Should have gates loaded from server/gates/
      expect(text).toContain('code-quality:');
      expect(text).toContain('(validation)');
    });

    test('individual gate handler returns full content', async () => {
      const handler = registeredResources.get('gate')?.readHandler;
      expect(handler).toBeDefined();

      // Use a known gate from the codebase
      const result = (await handler!(
        new URL(`resource://${RESOURCE_URI_PATTERNS.GATE_ITEM.replace('{id}', 'code-quality')}`),
        { id: 'code-quality' }
      )) as { contents: Array<{ text: string; mimeType: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('text/markdown');

      const content = result.contents[0].text;
      expect(content).toContain('**ID:** `code-quality`');
      expect(content).toContain('**Type:**');
      expect(content).toContain('**Severity:**');
    });

    test('gate guidance handler returns raw guidance content', async () => {
      const handler = registeredResources.get('gate-guidance')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(
          `resource://${RESOURCE_URI_PATTERNS.GATE_GUIDANCE.replace('{id}', 'code-quality')}`
        ),
        { id: 'code-quality' }
      )) as { contents: Array<{ text: string }> };

      expect(result.contents).toHaveLength(1);
      // Should have guidance content (or placeholder if none)
      expect(typeof result.contents[0].text).toBe('string');
    });

    test('gate handler throws for non-existent gate', async () => {
      const handler = registeredResources.get('gate')?.readHandler;

      await expect(
        handler!(
          new URL(
            `resource://${RESOURCE_URI_PATTERNS.GATE_ITEM.replace('{id}', 'non-existent-gate')}`
          ),
          { id: 'non-existent-gate' }
        )
      ).rejects.toThrow('Gate not found: non-existent-gate');
    });
  });

  describe('notifyResourcesChanged()', () => {
    test('sends resource list changed notification', () => {
      notifyResourcesChanged(mockMcpServer as never, mockLogger);

      expect(mockMcpServer.sendResourceListChanged).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    test('handles notification failure gracefully', () => {
      mockMcpServer.sendResourceListChanged.mockImplementation(() => {
        throw new Error('Connection closed');
      });

      // Should not throw
      expect(() => {
        notifyResourcesChanged(mockMcpServer as never, mockLogger);
      }).not.toThrow();

      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('Methodology Resource Handlers', () => {
    const testFrameworks = [
      {
        id: 'CAGEERF',
        name: 'CAGEERF Framework',
        description: 'Context, Analysis, Goals, Execution, Evaluation, Refinement methodology',
        type: 'methodology',
        systemPromptTemplate: 'Apply the CAGEERF methodology systematically...',
        executionGuidelines: ['Start with context', 'Analyze thoroughly', 'Set clear goals'],
        priority: 100,
        enabled: true,
      },
      {
        id: 'ReACT',
        name: 'ReACT Framework',
        description: 'Reason, Act, Observe loop for problem solving',
        type: 'methodology',
        systemPromptTemplate: 'Use the ReACT loop...',
        executionGuidelines: ['Reason first', 'Take action', 'Observe results'],
        priority: 90,
        enabled: false,
      },
    ];

    beforeEach(() => {
      const dependencies: ResourceDependencies = {
        logger: mockLogger,
        frameworkManager: {
          listFrameworks: (enabledOnly?: boolean) =>
            enabledOnly ? testFrameworks.filter((f) => f.enabled) : testFrameworks,
          getFramework: (id: string) => testFrameworks.find((f) => f.id === id),
        },
      };

      registerResources(mockMcpServer as never, dependencies);
    });

    test('registers methodology resources when frameworkManager is provided', () => {
      expect(registeredResources.has('methodologies')).toBe(true);
      expect(registeredResources.has('methodology')).toBe(true);
      expect(registeredResources.has('methodology-system-prompt')).toBe(true);
    });

    test('methodologies list handler returns all methodologies with metadata', async () => {
      const handler = registeredResources.get('methodologies')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(`resource://${RESOURCE_URI_PATTERNS.METHODOLOGY_LIST}`),
        {}
      )) as { contents: Array<{ text: string; mimeType: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('text/plain');

      // New compact format: "Methodologies (N):\nid: name [disabled]"
      const text = result.contents[0].text;
      expect(text).toContain('Methodologies (2):');
      expect(text).toContain('CAGEERF: CAGEERF Framework');
      expect(text).toContain('ReACT: ReACT Framework [disabled]');
    });

    test('individual methodology handler returns full content', async () => {
      const handler = registeredResources.get('methodology')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(`resource://${RESOURCE_URI_PATTERNS.METHODOLOGY_ITEM.replace('{id}', 'CAGEERF')}`),
        { id: 'CAGEERF' }
      )) as { contents: Array<{ text: string; mimeType: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('text/markdown');

      const content = result.contents[0].text;
      expect(content).toContain('# CAGEERF Framework');
      expect(content).toContain('**ID:** `CAGEERF`');
      expect(content).toContain('**Type:** methodology');
      expect(content).toContain('**Priority:** 100');
      expect(content).toContain('**Enabled:** Yes');
      expect(content).toContain('## Execution Guidelines');
      expect(content).toContain('- Start with context');
      expect(content).toContain('## System Prompt Template');
    });

    test('methodology system prompt handler returns raw template only', async () => {
      const handler = registeredResources.get('methodology-system-prompt')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(
          `resource://${RESOURCE_URI_PATTERNS.METHODOLOGY_SYSTEM_PROMPT.replace('{id}', 'CAGEERF')}`
        ),
        { id: 'CAGEERF' }
      )) as { contents: Array<{ text: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toBe('Apply the CAGEERF methodology systematically...');
    });

    test('methodology handler throws for non-existent methodology', async () => {
      const handler = registeredResources.get('methodology')?.readHandler;

      await expect(
        handler!(
          new URL(
            `resource://${RESOURCE_URI_PATTERNS.METHODOLOGY_ITEM.replace('{id}', 'non-existent')}`
          ),
          { id: 'non-existent' }
        )
      ).rejects.toThrow('Methodology not found: non-existent');
    });
  });

  describe('Observability Resource Handlers', () => {
    const testSessions = [
      {
        sessionId: 'session-123',
        chainId: 'chain-abc',
        currentStep: 2,
        totalSteps: 5,
        pendingReview: false,
        lastActivity: Date.now() - 1000,
        startTime: Date.now() - 60000,
        promptName: 'Analysis Chain',
        promptId: 'analysis-chain',
      },
      {
        sessionId: 'session-456',
        chainId: 'chain-def',
        currentStep: 1,
        totalSteps: 3,
        pendingReview: true,
        lastActivity: Date.now() - 5000,
        startTime: Date.now() - 120000,
        promptName: 'Review Chain',
      },
    ];

    const testSessionDetails = {
      sessionId: 'session-123',
      chainId: 'chain-abc',
      state: {
        currentStep: 2,
        totalSteps: 5,
        stepStates: new Map<number, unknown>([[1, { status: 'completed' }]]),
      },
      startTime: Date.now() - 60000,
      lastActivity: Date.now() - 1000,
      originalArgs: { topic: 'testing' },
      pendingGateReview: undefined,
    };

    const testMetrics = {
      executionStats: {
        totalExecutions: 100,
        successfulExecutions: 95,
        failedExecutions: 5,
        averageExecutionTime: 250,
      },
      systemMetrics: {
        uptime: 3600000,
        memoryUsage: { heapUsed: 50000000, heapTotal: 100000000 },
        averageResponseTime: 150,
        requestsPerMinute: 10,
        errorRate: 0.05,
      },
    };

    const testSessionStats = {
      totalActiveSessions: 2,
      totalCompletedSessions: 50,
      sessionsWithPendingReviews: 1,
    };

    beforeEach(() => {
      const dependencies: ResourceDependencies = {
        logger: mockLogger,
        chainSessionManager: {
          listActiveSessions: (limit?: number) => testSessions.slice(0, limit),
          getSession: (sessionId: string) =>
            sessionId === 'session-123' ? testSessionDetails : undefined,
          getSessionStats: () => testSessionStats,
        },
        metricsCollector: {
          getAnalyticsSummary: () => testMetrics,
        },
      };

      registerResources(mockMcpServer as never, dependencies);
    });

    test('registers session resources when chainSessionManager is provided', () => {
      expect(registeredResources.has('sessions')).toBe(true);
      expect(registeredResources.has('session')).toBe(true);
    });

    test('registers metrics resources when metricsCollector is provided', () => {
      expect(registeredResources.has('metrics-pipeline')).toBe(true);
    });

    test('sessions list handler returns active sessions with metadata', async () => {
      const handler = registeredResources.get('sessions')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(`resource://${RESOURCE_URI_PATTERNS.SESSION_LIST}`),
        {}
      )) as { contents: Array<{ text: string }> };

      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('session-123');
      expect(parsed[0].chainId).toBe('chain-abc');
      expect(parsed[0].currentStep).toBe(2);
      expect(parsed[0].totalSteps).toBe(5);
      expect(parsed[0].pendingReview).toBe(false);
      expect(parsed[1].pendingReview).toBe(true);
    });

    test('individual session handler returns full state', async () => {
      const handler = registeredResources.get('session')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(
          `resource://${RESOURCE_URI_PATTERNS.SESSION_ITEM.replace('{chainId}', 'session-123')}`
        ),
        { chainId: 'session-123' }
      )) as { contents: Array<{ text: string; mimeType: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.sessionId).toBe('session-123');
      expect(parsed.chainId).toBe('chain-abc');
      expect(parsed.progress.currentStep).toBe(2);
      expect(parsed.progress.totalSteps).toBe(5);
      expect(parsed.progress.percentComplete).toBe(40);
      expect(parsed.originalArgs.topic).toBe('testing');
      expect(parsed.hasPendingReview).toBe(false);
    });

    test('session handler throws for non-existent session', async () => {
      const handler = registeredResources.get('session')?.readHandler;

      await expect(
        handler!(
          new URL(
            `resource://${RESOURCE_URI_PATTERNS.SESSION_ITEM.replace('{chainId}', 'non-existent')}`
          ),
          { chainId: 'non-existent' }
        )
      ).rejects.toThrow('Session not found: non-existent');
    });

    test('metrics pipeline handler returns analytics summary', async () => {
      const handler = registeredResources.get('metrics-pipeline')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(`resource://${RESOURCE_URI_PATTERNS.METRICS_PIPELINE}`),
        {}
      )) as { contents: Array<{ text: string; mimeType: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.execution.totalExecutions).toBe(100);
      expect(parsed.execution.successfulExecutions).toBe(95);
      expect(parsed.system.uptime).toBe(3600000);
      expect(parsed.sessions.totalActiveSessions).toBe(2);
      expect(parsed.sessions.sessionsWithPendingReviews).toBe(1);
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('URI Pattern Constants', () => {
    test('prompt patterns include full URI scheme', () => {
      expect(RESOURCE_URI_PATTERNS.PROMPT_LIST).toBe('resource://prompt/');
      expect(RESOURCE_URI_PATTERNS.PROMPT_ITEM).toBe('resource://prompt/{id}');
      expect(RESOURCE_URI_PATTERNS.PROMPT_TEMPLATE).toBe('resource://prompt/{id}/template');
    });

    test('gate patterns include full URI scheme', () => {
      expect(RESOURCE_URI_PATTERNS.GATE_LIST).toBe('resource://gate/');
      expect(RESOURCE_URI_PATTERNS.GATE_ITEM).toBe('resource://gate/{id}');
      expect(RESOURCE_URI_PATTERNS.GATE_GUIDANCE).toBe('resource://gate/{id}/guidance');
    });

    test('methodology patterns include full URI scheme', () => {
      expect(RESOURCE_URI_PATTERNS.METHODOLOGY_LIST).toBe('resource://methodology/');
      expect(RESOURCE_URI_PATTERNS.METHODOLOGY_ITEM).toBe('resource://methodology/{id}');
      expect(RESOURCE_URI_PATTERNS.METHODOLOGY_SYSTEM_PROMPT).toBe(
        'resource://methodology/{id}/system-prompt'
      );
    });

    test('observability patterns include full URI scheme', () => {
      expect(RESOURCE_URI_PATTERNS.SESSION_LIST).toBe('resource://session/');
      expect(RESOURCE_URI_PATTERNS.SESSION_ITEM).toBe('resource://session/{chainId}');
      expect(RESOURCE_URI_PATTERNS.METRICS_PIPELINE).toBe('resource://metrics/pipeline');
    });
  });
});
