/**
 * Resource Manager Integration Test
 *
 * Tests the complete resource_manager workflow with real modules:
 * - ResourceManagerRouter (real routing logic)
 * - ConsolidatedPromptManager (real action handling)
 * - ConsolidatedGateManager (real action handling)
 * - ConsolidatedFrameworkManager (real action handling)
 *
 * Mocks:
 * - Filesystem operations (controlled fixtures)
 * - Registry operations (in-memory maps)
 *
 * Classification: Integration (multiple real modules, mock I/O only)
 */

import { describe, expect, test, jest, beforeEach } from '@jest/globals';

import {
  ResourceManagerRouter,
  createResourceManagerRouter,
} from '../../../src/mcp-tools/resource-manager/core/router.js';

import type { ResourceManagerInput } from '../../../src/mcp-tools/resource-manager/core/types.js';
import type { Logger } from '../../../src/logging/index.js';
import type { ConfigManager } from '../../../src/config/index.js';
import type { FrameworkManager } from '../../../src/frameworks/framework-manager.js';
import type { ToolResponse } from '../../../src/types/index.js';
import type { ConsolidatedPromptManager } from '../../../src/mcp-tools/prompt-manager/index.js';
import type { ConsolidatedGateManager } from '../../../src/mcp-tools/gate-manager/index.js';
import type { ConsolidatedFrameworkManager } from '../../../src/mcp-tools/framework-manager/index.js';

// Mock factories
const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

// Create mock prompt manager that tracks actions
const createMockPromptManager = () => {
  const prompts = new Map<string, { id: string; name: string; category: string }>();

  return {
    handleAction: jest.fn(async (args: Record<string, unknown>) => {
      const action = args['action'] as string;
      const id = args['id'] as string | undefined;

      switch (action) {
        case 'list':
          return {
            content: [
              {
                type: 'text',
                text: `Found ${prompts.size} prompts:\n${Array.from(prompts.values())
                  .map((p) => `- ${p.id}: ${p.name}`)
                  .join('\n')}`,
              },
            ],
            isError: false,
          } as ToolResponse;

        case 'create':
          if (id && prompts.has(id)) {
            return {
              content: [{ type: 'text', text: `Prompt ${id} already exists` }],
              isError: true,
            } as ToolResponse;
          }
          if (id) {
            prompts.set(id, {
              id,
              name: (args['name'] as string) ?? id,
              category: (args['category'] as string) ?? 'general',
            });
          }
          return {
            content: [{ type: 'text', text: `Created prompt: ${id}` }],
            isError: false,
          } as ToolResponse;

        case 'inspect':
          if (id && prompts.has(id)) {
            const prompt = prompts.get(id);
            return {
              content: [
                { type: 'text', text: `Prompt: ${prompt?.id}\nName: ${prompt?.name}` },
              ],
              isError: false,
            } as ToolResponse;
          }
          return {
            content: [{ type: 'text', text: `Prompt ${id} not found` }],
            isError: true,
          } as ToolResponse;

        case 'delete':
          if (id && prompts.has(id)) {
            prompts.delete(id);
            return {
              content: [{ type: 'text', text: `Deleted prompt: ${id}` }],
              isError: false,
            } as ToolResponse;
          }
          return {
            content: [{ type: 'text', text: `Prompt ${id} not found` }],
            isError: true,
          } as ToolResponse;

        case 'analyze_type':
          return {
            content: [{ type: 'text', text: `Analysis for ${id}: single prompt type` }],
            isError: false,
          } as ToolResponse;

        case 'guide':
          return {
            content: [{ type: 'text', text: 'Prompt creation guide: ...' }],
            isError: false,
          } as ToolResponse;

        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${action}` }],
            isError: true,
          } as ToolResponse;
      }
    }),
    _prompts: prompts, // Expose for test assertions
  } as unknown as ConsolidatedPromptManager & { _prompts: typeof prompts };
};

// Create mock gate manager that tracks actions
const createMockGateManager = () => {
  const gates = new Map<string, { id: string; name: string; type: string }>();

  return {
    handleAction: jest.fn(async (args: Record<string, unknown>) => {
      const action = args['action'] as string;
      const id = args['id'] as string | undefined;
      const type = args['type'] as string | undefined;

      switch (action) {
        case 'list':
          return {
            content: [
              {
                type: 'text',
                text: `Found ${gates.size} gates:\n${Array.from(gates.values())
                  .map((g) => `- ${g.id}: ${g.name}`)
                  .join('\n')}`,
              },
            ],
            isError: false,
          } as ToolResponse;

        case 'create':
          if (id && gates.has(id)) {
            return {
              content: [{ type: 'text', text: `Gate ${id} already exists` }],
              isError: true,
            } as ToolResponse;
          }
          if (id) {
            gates.set(id, {
              id,
              name: (args['name'] as string) ?? id,
              type: type ?? 'validation',
            });
          }
          return {
            content: [{ type: 'text', text: `Created gate: ${id}` }],
            isError: false,
          } as ToolResponse;

        case 'inspect':
          if (id && gates.has(id)) {
            const gate = gates.get(id);
            return {
              content: [{ type: 'text', text: `Gate: ${gate?.id}\nType: ${gate?.type}` }],
              isError: false,
            } as ToolResponse;
          }
          return {
            content: [{ type: 'text', text: `Gate ${id} not found` }],
            isError: true,
          } as ToolResponse;

        case 'delete':
          if (id && gates.has(id)) {
            gates.delete(id);
            return {
              content: [{ type: 'text', text: `Deleted gate: ${id}` }],
              isError: false,
            } as ToolResponse;
          }
          return {
            content: [{ type: 'text', text: `Gate ${id} not found` }],
            isError: true,
          } as ToolResponse;

        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${action}` }],
            isError: true,
          } as ToolResponse;
      }
    }),
    _gates: gates, // Expose for test assertions
  } as unknown as ConsolidatedGateManager & { _gates: typeof gates };
};

// Create mock framework manager that tracks actions
const createMockFrameworkManager = () => {
  const frameworks = new Map<string, { id: string; name: string; enabled: boolean }>();

  // Pre-populate with existing frameworks
  frameworks.set('cageerf', { id: 'cageerf', name: 'CAGEERF', enabled: true });
  frameworks.set('react', { id: 'react', name: 'ReACT', enabled: true });

  let activeFramework: string | null = 'cageerf';

  return {
    handleAction: jest.fn(async (args: Record<string, unknown>) => {
      const action = args['action'] as string;
      const id = args['id'] as string | undefined;

      switch (action) {
        case 'list':
          return {
            content: [
              {
                type: 'text',
                text: `Found ${frameworks.size} methodologies:\n${Array.from(frameworks.values())
                  .map((f) => `- ${f.id}: ${f.name} (${f.enabled ? 'enabled' : 'disabled'})`)
                  .join('\n')}`,
              },
            ],
            isError: false,
          } as ToolResponse;

        case 'switch':
          if (id && frameworks.has(id)) {
            activeFramework = id;
            return {
              content: [{ type: 'text', text: `Switched to methodology: ${id}` }],
              isError: false,
            } as ToolResponse;
          }
          return {
            content: [{ type: 'text', text: `Methodology ${id} not found` }],
            isError: true,
          } as ToolResponse;

        case 'inspect':
          if (id && frameworks.has(id)) {
            const framework = frameworks.get(id);
            return {
              content: [
                {
                  type: 'text',
                  text: `Methodology: ${framework?.id}\nName: ${framework?.name}\nEnabled: ${framework?.enabled}`,
                },
              ],
              isError: false,
            } as ToolResponse;
          }
          return {
            content: [{ type: 'text', text: `Methodology ${id} not found` }],
            isError: true,
          } as ToolResponse;

        case 'create':
          if (id && frameworks.has(id)) {
            return {
              content: [{ type: 'text', text: `Methodology ${id} already exists` }],
              isError: true,
            } as ToolResponse;
          }
          if (id) {
            frameworks.set(id, {
              id,
              name: (args['name'] as string) ?? id,
              enabled: true,
            });
          }
          return {
            content: [{ type: 'text', text: `Created methodology: ${id}` }],
            isError: false,
          } as ToolResponse;

        case 'delete':
          if (id && frameworks.has(id)) {
            frameworks.delete(id);
            return {
              content: [{ type: 'text', text: `Deleted methodology: ${id}` }],
              isError: false,
            } as ToolResponse;
          }
          return {
            content: [{ type: 'text', text: `Methodology ${id} not found` }],
            isError: true,
          } as ToolResponse;

        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${action}` }],
            isError: true,
          } as ToolResponse;
      }
    }),
    _frameworks: frameworks,
    _getActive: () => activeFramework,
  } as unknown as ConsolidatedFrameworkManager & {
    _frameworks: typeof frameworks;
    _getActive: () => string | null;
  };
};

describe('Resource Manager Workflow Integration', () => {
  let router: ResourceManagerRouter;
  let logger: Logger;
  let promptManager: ReturnType<typeof createMockPromptManager>;
  let gateManager: ReturnType<typeof createMockGateManager>;
  let frameworkManager: ReturnType<typeof createMockFrameworkManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createLogger();
    promptManager = createMockPromptManager();
    gateManager = createMockGateManager();
    frameworkManager = createMockFrameworkManager();

    router = createResourceManagerRouter({
      logger,
      promptManager: promptManager as unknown as ConsolidatedPromptManager,
      gateManager: gateManager as unknown as ConsolidatedGateManager,
      frameworkManager: frameworkManager as unknown as ConsolidatedFrameworkManager,
    });
  });

  describe('Cross-Resource CRUD Workflow', () => {
    test('complete prompt lifecycle: create → inspect → delete', async () => {
      // Create
      const createResult = await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'create',
          id: 'test-prompt',
          name: 'Test Prompt',
          category: 'testing',
          user_message_template: 'Hello {{name}}',
        },
        {}
      );
      expect(createResult.isError).toBe(false);
      expect((createResult.content[0] as { text: string }).text).toContain('Created prompt');

      // Verify prompt exists
      expect(promptManager._prompts.has('test-prompt')).toBe(true);

      // Inspect
      const inspectResult = await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'inspect',
          id: 'test-prompt',
        },
        {}
      );
      expect(inspectResult.isError).toBe(false);
      expect((inspectResult.content[0] as { text: string }).text).toContain('Test Prompt');

      // Delete
      const deleteResult = await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'delete',
          id: 'test-prompt',
          confirm: true,
        },
        {}
      );
      expect(deleteResult.isError).toBe(false);
      expect(promptManager._prompts.has('test-prompt')).toBe(false);
    });

    test('complete gate lifecycle: create → inspect → delete', async () => {
      // Create
      const createResult = await router.handleAction(
        {
          resource_type: 'gate',
          action: 'create',
          id: 'test-gate',
          name: 'Test Gate',
          gate_type: 'validation',
          guidance: 'Test validation guidance',
        },
        {}
      );
      expect(createResult.isError).toBe(false);
      expect((createResult.content[0] as { text: string }).text).toContain('Created gate');

      // Verify gate_type was transformed to type
      expect(gateManager.handleAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'validation' }),
        expect.any(Object)
      );

      // Inspect
      const inspectResult = await router.handleAction(
        {
          resource_type: 'gate',
          action: 'inspect',
          id: 'test-gate',
        },
        {}
      );
      expect(inspectResult.isError).toBe(false);
      expect((inspectResult.content[0] as { text: string }).text).toContain('validation');

      // Delete
      const deleteResult = await router.handleAction(
        {
          resource_type: 'gate',
          action: 'delete',
          id: 'test-gate',
          confirm: true,
        },
        {}
      );
      expect(deleteResult.isError).toBe(false);
    });

    test('methodology switch workflow', async () => {
      // List available methodologies
      const listResult = await router.handleAction(
        {
          resource_type: 'methodology',
          action: 'list',
        },
        {}
      );
      expect(listResult.isError).toBe(false);
      expect((listResult.content[0] as { text: string }).text).toContain('cageerf');
      expect((listResult.content[0] as { text: string }).text).toContain('react');

      // Switch to ReACT
      const switchResult = await router.handleAction(
        {
          resource_type: 'methodology',
          action: 'switch',
          id: 'react',
        },
        {}
      );
      expect(switchResult.isError).toBe(false);
      expect((switchResult.content[0] as { text: string }).text).toContain('Switched to');
      expect(frameworkManager._getActive()).toBe('react');
    });
  });

  describe('Action Validation Integration', () => {
    test('switch action only routes to methodology handler', async () => {
      // Switch on prompt should fail validation before reaching handler
      const promptSwitch = await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'switch',
          id: 'test',
        },
        {}
      );
      expect(promptSwitch.isError).toBe(true);
      expect((promptSwitch.content[0] as { text: string }).text).toContain(
        'only valid for resource_type: "methodology"'
      );
      expect(promptManager.handleAction).not.toHaveBeenCalled();

      // Switch on gate should fail validation
      const gateSwitch = await router.handleAction(
        {
          resource_type: 'gate',
          action: 'switch',
          id: 'test',
        },
        {}
      );
      expect(gateSwitch.isError).toBe(true);
      expect(gateManager.handleAction).not.toHaveBeenCalled();

      // Switch on methodology should succeed
      const methodologySwitch = await router.handleAction(
        {
          resource_type: 'methodology',
          action: 'switch',
          id: 'cageerf',
        },
        {}
      );
      expect(methodologySwitch.isError).toBe(false);
      expect(frameworkManager.handleAction).toHaveBeenCalled();
    });

    test('analyze_type action only routes to prompt handler', async () => {
      // analyze_type on gate should fail validation
      const gateAnalyze = await router.handleAction(
        {
          resource_type: 'gate',
          action: 'analyze_type',
          id: 'test',
        },
        {}
      );
      expect(gateAnalyze.isError).toBe(true);
      expect((gateAnalyze.content[0] as { text: string }).text).toContain(
        'only valid for resource_type: "prompt"'
      );

      // analyze_type on prompt should succeed
      const promptAnalyze = await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'analyze_type',
          id: 'test',
        },
        {}
      );
      expect(promptAnalyze.isError).toBe(false);
    });
  });

  describe('Parameter Transformation Integration', () => {
    test('gate_type transforms to type for gate manager', async () => {
      await router.handleAction(
        {
          resource_type: 'gate',
          action: 'create',
          id: 'transform-test',
          gate_type: 'guidance',
          guidance: 'Test guidance',
        },
        {}
      );

      // Verify the transformation happened
      expect(gateManager.handleAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          id: 'transform-test',
          type: 'guidance', // Transformed from gate_type
          guidance: 'Test guidance',
        }),
        expect.any(Object)
      );
    });

    test('methodology parameters pass through correctly', async () => {
      await router.handleAction(
        {
          resource_type: 'methodology',
          action: 'create',
          id: 'new-method',
          name: 'New Methodology',
          system_prompt_guidance: 'Apply this methodology',
          persist: true,
          reason: 'Testing creation',
        },
        {}
      );

      expect(frameworkManager.handleAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          id: 'new-method',
          name: 'New Methodology',
          system_prompt_guidance: 'Apply this methodology',
          persist: true,
          reason: 'Testing creation',
        }),
        expect.any(Object)
      );
    });
  });

  describe('Context Passthrough', () => {
    test('context is passed to all handlers', async () => {
      const context = {
        user: 'test-user',
        session: 'session-123',
        customData: { key: 'value' },
      };

      // Prompt
      await router.handleAction(
        { resource_type: 'prompt', action: 'list' },
        context
      );
      expect(promptManager.handleAction).toHaveBeenCalledWith(
        expect.any(Object),
        context
      );

      // Gate
      await router.handleAction(
        { resource_type: 'gate', action: 'list' },
        context
      );
      expect(gateManager.handleAction).toHaveBeenCalledWith(
        expect.any(Object),
        context
      );

      // Methodology
      await router.handleAction(
        { resource_type: 'methodology', action: 'list' },
        context
      );
      expect(frameworkManager.handleAction).toHaveBeenCalledWith(
        expect.any(Object),
        context
      );
    });
  });

  describe('Error Propagation', () => {
    test('handler errors are caught and formatted', async () => {
      // Make prompt manager throw an error
      promptManager.handleAction.mockRejectedValueOnce(new Error('Database connection failed'));

      const result = await router.handleAction(
        { resource_type: 'prompt', action: 'list' },
        {}
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('Database connection failed');
      expect(logger.error).toHaveBeenCalled();
    });

    test('non-Error exceptions are handled', async () => {
      gateManager.handleAction.mockRejectedValueOnce('String error thrown');

      const result = await router.handleAction(
        { resource_type: 'gate', action: 'list' },
        {}
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('String error thrown');
    });
  });

  describe('Multi-Resource Operations', () => {
    test('can manage resources of different types in sequence', async () => {
      // Create a prompt
      await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'create',
          id: 'analysis-prompt',
          name: 'Analysis Prompt',
        },
        {}
      );

      // Create a gate
      await router.handleAction(
        {
          resource_type: 'gate',
          action: 'create',
          id: 'quality-gate',
          gate_type: 'validation',
        },
        {}
      );

      // Switch methodology
      await router.handleAction(
        {
          resource_type: 'methodology',
          action: 'switch',
          id: 'react',
        },
        {}
      );

      // Verify all resources exist
      expect(promptManager._prompts.has('analysis-prompt')).toBe(true);
      expect(gateManager._gates.has('quality-gate')).toBe(true);
      expect(frameworkManager._getActive()).toBe('react');

      // List all resource types
      const promptList = await router.handleAction(
        { resource_type: 'prompt', action: 'list' },
        {}
      );
      const gateList = await router.handleAction(
        { resource_type: 'gate', action: 'list' },
        {}
      );
      const methodList = await router.handleAction(
        { resource_type: 'methodology', action: 'list' },
        {}
      );

      expect(promptList.isError).toBe(false);
      expect(gateList.isError).toBe(false);
      expect(methodList.isError).toBe(false);
    });
  });
});
