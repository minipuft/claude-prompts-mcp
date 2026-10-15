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
import { ResourceTemplate } from '@modelcontextprotocol/server';

import { registerResources, notifyResourcesChanged } from '../../../src/modules/resources/index.js';
import type { ResourceDependencies } from '../../../src/modules/resources/types.js';
import { RESOURCE_URI_PATTERNS } from '../../../src/modules/resources/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import { GateManager, createGateManager } from '../../../src/engine/gates/gate-manager.js';

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
      readHandler: (uri: URL, variables: Record<string, string | string[]>) => Promise<unknown>;
    }
  >;
  let mockMcpServer: {
    registerResource: jest.Mock<
      (name: string, template: unknown, options: unknown, readHandler: unknown) => void
    >;
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
              variables: Record<string, string | string[]>
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

      // Compact format: "Gates (N):\nid: name [tier]" — the tier derives from pass_criteria
      const text = result.contents[0].text;
      expect(text).toMatch(/^Gates \(\d+\):/);
      // code-quality is authored `type: validation` but carries only inline_guidance
      expect(text).toContain('code-quality: Code Quality Standards [reminder]');
      expect(text).toContain('test-suite: ');
      expect(text).toMatch(/test-suite: .* \[check\]/);
      expect(text).not.toMatch(/\((validation|guidance)\)/);
    });

    test('gates list renders the derived tier for semantic and mixed gates, not the authored type', async () => {
      const gate = (gateId: string, passCriteria: Array<{ type: string }>) => ({
        gateId,
        name: gateId,
        description: '',
        type: 'validation' as const,
        severity: 'medium' as const,
        getGuidance: () => '',
        getDefinition: () => ({ pass_criteria: passCriteria }),
      });
      const guides = [
        gate('sem-only', [{ type: 'semantic_evaluation' }]),
        gate('sem-and-tool', [{ type: 'shell_verify' }, { type: 'semantic_evaluation' }]),
      ];
      registerResources(mockMcpServer as never, {
        logger: mockLogger,
        gateManager: { list: () => guides, get: () => undefined },
      });

      const result = (await registeredResources
        .get('gates')!
        .readHandler(new URL(`resource://${RESOURCE_URI_PATTERNS.GATE_LIST}`), {})) as {
        contents: Array<{ text: string }>;
      };

      expect(result.contents[0].text).toBe(
        'Gates (2):\nsem-only: sem-only [evaluation]\nsem-and-tool: sem-and-tool [check + evaluation]'
      );
    });

    test('gate detail renders the derived tier above the authored type for semantic and mixed gates', async () => {
      const gate = (gateId: string, passCriteria: Array<{ type: string }>) => ({
        gateId,
        name: gateId,
        description: '',
        type: 'validation' as const,
        severity: 'medium' as const,
        getGuidance: () => '',
        getDefinition: () => ({ pass_criteria: passCriteria }),
      });
      const guides = new Map([
        ['sem-only', gate('sem-only', [{ type: 'semantic_evaluation' }])],
        [
          'sem-and-tool',
          gate('sem-and-tool', [{ type: 'shell_verify' }, { type: 'semantic_evaluation' }]),
        ],
      ]);
      registerResources(mockMcpServer as never, {
        logger: mockLogger,
        gateManager: { list: () => [...guides.values()], get: (id: string) => guides.get(id) },
      });
      const read = async (id: string): Promise<string> => {
        const result = (await registeredResources
          .get('gate')!
          .readHandler(
            new URL(`resource://${RESOURCE_URI_PATTERNS.GATE_ITEM.replace('{id}', id)}`),
            {
              id,
            }
          )) as { contents: Array<{ text: string }> };
        return result.contents[0].text;
      };

      const semantic = await read('sem-only');
      expect(semantic).toContain('**Tier:** evaluation');
      expect(semantic).toContain('**Declared Type:** validation');
      expect(semantic).not.toContain('**Type:**');

      const mixed = await read('sem-and-tool');
      expect(mixed).toContain('**Tier:** check + evaluation');
      expect(mixed).toContain('**Declared Type:** validation');
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
      expect(content).toContain('**Tier:**');
      expect(content).toContain('**Declared Type:**');
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

  describe('Framework Resource Handlers', () => {
    const testFrameworks = [
      {
        id: 'CAGEERF',
        name: 'CAGEERF Framework',
        description: 'Context, Analysis, Goals, Execution, Evaluation, Refinement framework',
        type: 'CAGEERF',
        systemPromptTemplate: 'Apply the CAGEERF framework systematically...',
        executionGuidelines: ['Start with context', 'Analyze thoroughly', 'Set clear goals'],
        priority: 100,
        enabled: true,
      },
      {
        id: 'ReACT',
        name: 'ReACT Framework',
        description: 'Reason, Act, Observe loop for problem solving',
        type: 'ReACT',
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

    test('registers framework resources when frameworkManager is provided', () => {
      expect(registeredResources.has('frameworks')).toBe(true);
      expect(registeredResources.has('framework')).toBe(true);
      expect(registeredResources.has('framework-system-prompt')).toBe(true);
    });

    test('frameworks list handler returns all frameworks with metadata', async () => {
      const handler = registeredResources.get('frameworks')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(`resource://${RESOURCE_URI_PATTERNS.FRAMEWORK_LIST}`),
        {}
      )) as { contents: Array<{ text: string; mimeType: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('text/plain');

      // New compact format: "Frameworks (N):\nid: name [disabled]"
      const text = result.contents[0].text;
      expect(text).toContain('Frameworks (2):');
      expect(text).toContain('CAGEERF: CAGEERF Framework');
      expect(text).toContain('ReACT: ReACT Framework [disabled]');
    });

    test('individual framework handler returns full content', async () => {
      const handler = registeredResources.get('framework')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(`resource://${RESOURCE_URI_PATTERNS.FRAMEWORK_ITEM.replace('{id}', 'CAGEERF')}`),
        { id: 'CAGEERF' }
      )) as { contents: Array<{ text: string; mimeType: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('text/markdown');

      const content = result.contents[0].text;
      expect(content).toContain('# CAGEERF Framework');
      expect(content).toContain('**ID:** `CAGEERF`');
      // `type` is the framework's own identity, as shipped in resources/frameworks/*/framework.yaml
      // (`type: CAGEERF`, `type: SCAMPER`, …) — not a category word. The fixture said
      // 'methodology' and this assertion said 'framework'; neither matched the real data shape.
      expect(content).toContain('**Type:** CAGEERF');
      expect(content).toContain('**Priority:** 100');
      expect(content).toContain('**Enabled:** Yes');
      expect(content).toContain('## Execution Guidelines');
      expect(content).toContain('- Start with context');
      expect(content).toContain('## System Prompt Template');
    });

    test('framework system prompt handler returns raw template only', async () => {
      const handler = registeredResources.get('framework-system-prompt')?.readHandler;
      expect(handler).toBeDefined();

      const result = (await handler!(
        new URL(
          `resource://${RESOURCE_URI_PATTERNS.FRAMEWORK_SYSTEM_PROMPT.replace('{id}', 'CAGEERF')}`
        ),
        { id: 'CAGEERF' }
      )) as { contents: Array<{ text: string }> };

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toBe('Apply the CAGEERF framework systematically...');
    });

    test('framework handler throws for non-existent framework', async () => {
      const handler = registeredResources.get('framework')?.readHandler;

      await expect(
        handler!(
          new URL(
            `resource://${RESOURCE_URI_PATTERNS.FRAMEWORK_ITEM.replace('{id}', 'non-existent')}`
          ),
          { id: 'non-existent' }
        )
      ).rejects.toThrow('Framework not found: non-existent');
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
        // Node-keyed since P3 Tier 2; the resource still renders `currentStep 2 / totalSteps 5`,
        // derived from this list rather than stored, so the assertions below are unchanged.
        currentNodeId: 'n2',
        nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }, { id: 'n4' }, { id: 'n5' }],
        stepStates: new Map<string, unknown>([['n1', { status: 'completed' }]]),
      },
      startTime: Date.now() - 60000,
      lastActivity: Date.now() - 1000,
      originalArgs: { topic: 'testing' },
      // Two open reviews at once (row 3.4): a structural review of the step the run left, and a
      // detached node's review of its late report. The resource reports each by its node.
      reviews: {
        n1: {
          nodeId: 'n1',
          kind: 'structural',
          phase: 'awaiting-verdict',
          gateIds: ['__phase_guard__'],
          attemptCount: 0,
          maxAttempts: 3,
        },
        n4: {
          nodeId: 'n4',
          kind: 'detached',
          phase: 'awaiting-replacement',
          gateIds: ['dr-block'],
          attemptCount: 1,
          maxAttempts: 2,
        },
      },
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
        performanceTrends: [],
      },
      frameworkUsage: { currentFramework: 'CAGEERF', frameworkSwitches: 0 },
      gateValidationStats: {
        totalValidations: 0,
        validationSuccessRate: 0,
        averageValidationTime: 0,
        gateAdoptionRate: 0,
      },
      recommendations: [],
    };

    const testSessionStats = {
      totalActiveSessions: 2,
      totalCompletedSessions: 50,
      sessionsWithPendingReviews: 1,
      totalSessions: 2,
      totalChains: 2,
      averageStepsPerChain: 4,
      oldestSessionAge: 120000,
    };

    beforeEach(() => {
      const dependencies: ResourceDependencies = {
        logger: mockLogger,
        chainSessionStore: {
          listActiveSessions: (limit?: number) => testSessions.slice(0, limit),
          getSession: (sessionId: string) =>
            sessionId === 'session-123' ? testSessionDetails : undefined,
          // The session item resource resolves by chain identifier (the user-facing id), which is
          // what `observability-resources.ts` calls. Keyed on chainId, not sessionId.
          getSessionByChainIdentifier: (chainId: string) =>
            chainId === 'chain-abc' ? testSessionDetails : undefined,
          getSessionStats: () => testSessionStats,
        },
        metricsCollector: {
          getAnalyticsSummary: () => testMetrics,
        },
      };

      registerResources(mockMcpServer as never, dependencies);
    });

    test('registers session resources when chainSessionStore is provided', () => {
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
      expect(parsed[0].name).toBe('chain-abc');
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
          `resource://${RESOURCE_URI_PATTERNS.SESSION_ITEM.replace('{chainId}', 'chain-abc')}`
        ),
        { chainId: 'chain-abc' }
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
      expect(parsed.hasPendingReview).toBe(true);
      expect(parsed.reviews).toEqual([
        {
          nodeId: 'n1',
          kind: 'structural',
          phase: 'awaiting-verdict',
          gateIds: ['__phase_guard__'],
          attemptCount: 0,
          maxAttempts: 3,
        },
        {
          nodeId: 'n4',
          kind: 'detached',
          phase: 'awaiting-replacement',
          gateIds: ['dr-block'],
          attemptCount: 1,
          maxAttempts: 2,
        },
      ]);
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

    describe('Session URI component round trips', () => {
      const chainIds = [
        'chain-Root_Name-X#1',
        'chain-Root_Name-X#2',
        'chain-team/child',
        'chain-team/deep/flow#3',
        'chain-Legacy_NS/Child-X#0',
        'chain-Legacy_NS/Deep-Name/Flow_1#01',
      ];
      let sessions: Array<typeof testSessionDetails>;
      let lookup: jest.Mock<
        NonNullable<ResourceDependencies['chainSessionStore']>['getSessionByChainIdentifier']
      >;
      let getSession: jest.Mock<
        NonNullable<ResourceDependencies['chainSessionStore']>['getSession']
      >;

      beforeEach(() => {
        sessions = chainIds.map((chainId, index) => ({
          ...structuredClone(testSessionDetails),
          chainId,
          sessionId: `uri-session-${index}`,
        }));
        lookup = jest.fn((chainId) => sessions.find((session) => session.chainId === chainId));
        getSession = jest.fn(() => undefined);
        registerResources(mockMcpServer as never, {
          logger: mockLogger,
          chainSessionStore: {
            listActiveSessions: () =>
              sessions.map((session) => ({
                ...session,
                currentStep: 2,
                totalSteps: 5,
                pendingReview: true,
              })),
            getSession,
            getSessionByChainIdentifier: lookup,
            getSessionStats: () => testSessionStats,
          },
        });
      });

      test.each(chainIds)(
        'advertised SDK URI round trips exact %s and its SID',
        async (chainId) => {
          const before = structuredClone(sessions);
          const list = registeredResources.get('sessions')!;
          const item = registeredResources.get('session')!;
          if (
            !(list.template instanceof ResourceTemplate) ||
            !(item.template instanceof ResourceTemplate)
          ) {
            throw new Error('Session resources must register actual SDK templates');
          }
          const encodedUri = new URL(
            RESOURCE_URI_PATTERNS.SESSION_ITEM.replace('{chainId}', encodeURIComponent(chainId))
          );
          const encodedVariables = item.template.uriTemplate.match(encodedUri.toString());
          expect(encodedVariables).toEqual({ chainId: encodeURIComponent(chainId) });
          const direct = (await item.readHandler(encodedUri, encodedVariables!)) as {
            contents: Array<{ text: string }>;
          };
          expect(JSON.parse(direct.contents[0].text)).toMatchObject({
            chainId,
            sessionId: sessions[chainIds.indexOf(chainId)].sessionId,
          });
          const body = (await list.readHandler(
            new URL(RESOURCE_URI_PATTERNS.SESSION_LIST),
            {}
          )) as {
            contents: Array<{ uri: string; text: string }>;
          };
          expect(body.contents[0].uri).toBe(RESOURCE_URI_PATTERNS.SESSION_LIST);
          const listed = await list.template.listCallback!({} as never);
          const bodyList = JSON.parse(body.contents[0].text) as Array<{
            uri: string;
            chainId: string;
          }>;
          for (const resources of [listed.resources, bodyList]) {
            const resource = resources.find(
              (entry) =>
                entry.uri ===
                RESOURCE_URI_PATTERNS.SESSION_ITEM.replace('{chainId}', encodeURIComponent(chainId))
            );
            expect(resource).toBeDefined();
            const uri = new URL(resource!.uri);
            const variables = item.template.uriTemplate.match(uri.toString());
            expect(variables).toEqual({ chainId: encodeURIComponent(chainId) });
            const result = (await item.readHandler(uri, variables!)) as {
              contents: Array<{ uri: string; text: string }>;
            };
            expect(result.contents[0].uri).toBe(uri.toString());
            expect(JSON.parse(result.contents[0].text)).toMatchObject({
              chainId,
              sessionId: sessions[chainIds.indexOf(chainId)].sessionId,
            });
          }
          expect(bodyList.map((entry) => entry.chainId)).toEqual(chainIds);
          // Three item reads and two list rows look this run up; every lookup is non-promoting.
          expect(lookup.mock.calls.every(([, options]) => options?.promoteDormant === false)).toBe(
            true
          );
          expect(lookup.mock.calls.filter(([id]) => id === chainId)).toHaveLength(5);
          expect(getSession).not.toHaveBeenCalled();
          expect(sessions).toEqual(before);
        }
      );

      test.each([
        ['incomplete percent', 'chain-Root_Name-X%', undefined],
        ['invalid percent', 'chain-Root_Name-X%GG', undefined],
        ['double encoded root', encodeURIComponent(encodeURIComponent(chainIds[0])), undefined],
        [
          'double encoded qualified',
          encodeURIComponent(encodeURIComponent(chainIds[3])),
          undefined,
        ],
        ['invalid whole identifier', encodeURIComponent('chain-team/child#1\n'), undefined],
        ['stale numbered URI', encodeURIComponent('chain-Root_Name-X#99'), 'chain-Root_Name-X#99'],
      ])(
        'SDK URI refuses %s without state effects or alias lookup',
        async (_name, component, expectedLookup) => {
          const before = structuredClone(sessions);
          const item = registeredResources.get('session')!;
          if (!(item.template instanceof ResourceTemplate)) {
            throw new Error('Session resource must register an actual SDK template');
          }
          const uri = new URL(RESOURCE_URI_PATTERNS.SESSION_ITEM.replace('{chainId}', component!));
          const variables = item.template.uriTemplate.match(uri.toString());
          expect(variables).toEqual({ chainId: component });
          await expect(item.readHandler(uri, variables!)).rejects.toThrow();
          expect(lookup.mock.calls).toEqual(
            expectedLookup === undefined ? [] : [[expectedLookup, { promoteDormant: false }]]
          );
          expect(getSession).not.toHaveBeenCalled();
          expect(sessions).toEqual(before);
        }
      );
    });
  });

  describe('Conversation pause in session resources', () => {
    const run = (chainId: string, pause?: object, runStatus = 'working') => ({
      sessionId: `uuid-${chainId}`,
      chainId,
      state: { currentNodeId: 'n2', nodes: [{ id: 'n1' }, { id: 'n2' }] },
      startTime: 1000,
      lastActivity: 2000,
      originalArgs: {},
      continuityScopeId: 'ws-1',
      runStatus,
      handoffToken: 'tok-SECRET',
      ...(pause !== undefined && { conversationPause: pause }),
    });
    const pause = { kind: 'conversation', nodeId: 'n2', pausedAt: 1234 };
    const runs = [
      run('chain-paused', pause),
      run('chain-plain'),
      run('chain-ended', pause, 'cancelled'),
    ];
    const facts = ['conversationPause', 'runId', 'continuityScopeId', 'currentNodeId'];
    let before: typeof runs;
    let lookups: Array<unknown[]>;

    const read = async (name: string, uri: string, variables: Record<string, string> = {}) => {
      const result = (await registeredResources
        .get(name)!
        .readHandler(new URL(uri), variables)) as {
        contents: Array<{ text: string }>;
      };
      return result.contents[0].text;
    };

    beforeEach(() => {
      before = structuredClone(runs);
      lookups = [];
      registerResources(
        mockMcpServer as never,
        {
          logger: mockLogger,
          chainSessionStore: {
            listActiveSessions: () =>
              runs.map((r) => ({ ...r, currentStep: 2, totalSteps: 2, pendingReview: false })),
            getSession: () => undefined,
            getSessionByChainIdentifier: (chainId: string, ...rest: unknown[]) => {
              lookups.push([chainId, ...rest]);
              return runs.find((r) => r.chainId === chainId);
            },
            getSessionStats: () => ({
              totalSessions: 0,
              totalChains: 0,
              averageStepsPerChain: 0,
              oldestSessionAge: 0,
            }),
          },
        } as never
      );
    });

    test("list and item carry a paused run's pause, only its, and never the credential", async () => {
      const listText = await read('sessions', 'resource://session/');
      const itemText = await read('session', 'resource://session/chain-paused', {
        chainId: 'chain-paused',
      });
      const plainText = await read('session', 'resource://session/chain-plain', {
        chainId: 'chain-plain',
      });
      const rows = JSON.parse(listText) as Array<Record<string, unknown>>;
      const expected = {
        conversationPause: pause,
        runId: 'uuid-chain-paused',
        continuityScopeId: 'ws-1',
        currentNodeId: 'n2',
      };
      expect(rows[0]).toMatchObject(expected);
      expect(JSON.parse(itemText)).toMatchObject({ sessionId: 'uuid-chain-paused', ...expected });
      for (const unpaused of [rows[1], rows[2], JSON.parse(plainText)]) {
        for (const fact of facts) expect(unpaused).not.toHaveProperty(fact);
      }
      for (const text of [listText, itemText, plainText]) expect(text).not.toContain('tok-SECRET');
      // Reading touches no run and every lookup is non-promoting.
      expect(runs).toEqual(before);
      for (const [, options] of lookups) expect(options).toEqual({ promoteDormant: false });
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

    test('framework patterns include full URI scheme', () => {
      expect(RESOURCE_URI_PATTERNS.FRAMEWORK_LIST).toBe('resource://framework/');
      expect(RESOURCE_URI_PATTERNS.FRAMEWORK_ITEM).toBe('resource://framework/{id}');
      expect(RESOURCE_URI_PATTERNS.FRAMEWORK_SYSTEM_PROMPT).toBe(
        'resource://framework/{id}/system-prompt'
      );
    });

    test('observability patterns include full URI scheme', () => {
      expect(RESOURCE_URI_PATTERNS.SESSION_LIST).toBe('resource://session/');
      expect(RESOURCE_URI_PATTERNS.SESSION_ITEM).toBe('resource://session/{chainId}');
      expect(RESOURCE_URI_PATTERNS.METRICS_PIPELINE).toBe('resource://metrics/pipeline');
    });
  });
});
