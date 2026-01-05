// Unit tests for ResourceManagerRouter
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  ResourceManagerRouter,
  createResourceManagerRouter,
} from '../../../../src/mcp-tools/resource-manager/core/router.js';
import { MockLogger } from '../../../helpers/test-helpers.js';

import type { ResourceManagerInput } from '../../../../src/mcp-tools/resource-manager/core/types.js';
import type { ToolResponse } from '../../../../src/types/index.js';

describe('ResourceManagerRouter', () => {
  let router: ResourceManagerRouter;
  let logger: MockLogger;
  let mockPromptManager: {
    handleAction: jest.MockedFunction<
      (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>
    >;
  };
  let mockGateManager: {
    handleAction: jest.MockedFunction<
      (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>
    >;
  };
  let mockFrameworkManager: {
    handleAction: jest.MockedFunction<
      (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>
    >;
  };

  const successResponse: ToolResponse = {
    content: [{ type: 'text', text: 'Success' }],
    isError: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new MockLogger();

    mockPromptManager = {
      handleAction: jest.fn<
        (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>
      >(() => Promise.resolve(successResponse)),
    };

    mockGateManager = {
      handleAction: jest.fn<
        (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>
      >(() => Promise.resolve(successResponse)),
    };

    mockFrameworkManager = {
      handleAction: jest.fn<
        (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>
      >(() => Promise.resolve(successResponse)),
    };

    router = createResourceManagerRouter({
      logger: logger as unknown as Parameters<typeof createResourceManagerRouter>[0]['logger'],
      promptManager: mockPromptManager as unknown as Parameters<
        typeof createResourceManagerRouter
      >[0]['promptManager'],
      gateManager: mockGateManager as unknown as Parameters<
        typeof createResourceManagerRouter
      >[0]['gateManager'],
      frameworkManager: mockFrameworkManager as unknown as Parameters<
        typeof createResourceManagerRouter
      >[0]['frameworkManager'],
    });
  });

  describe('routing', () => {
    test('routes prompt resources to prompt handler', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'prompt',
        action: 'list',
      };

      const result = await router.handleAction(args, {});

      expect(mockPromptManager.handleAction).toHaveBeenCalledTimes(1);
      expect(mockGateManager.handleAction).not.toHaveBeenCalled();
      expect(mockFrameworkManager.handleAction).not.toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
    });

    test('routes gate resources to gate handler', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'gate',
        action: 'list',
      };

      const result = await router.handleAction(args, {});

      expect(mockGateManager.handleAction).toHaveBeenCalledTimes(1);
      expect(mockPromptManager.handleAction).not.toHaveBeenCalled();
      expect(mockFrameworkManager.handleAction).not.toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
    });

    test('routes methodology resources to framework handler', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'methodology',
        action: 'list',
      };

      const result = await router.handleAction(args, {});

      expect(mockFrameworkManager.handleAction).toHaveBeenCalledTimes(1);
      expect(mockPromptManager.handleAction).not.toHaveBeenCalled();
      expect(mockGateManager.handleAction).not.toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
    });
  });

  describe('action validation', () => {
    test('rejects switch action for non-methodology resources', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'prompt',
        action: 'switch',
      };

      const result = await router.handleAction(args, {});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        'only valid for resource_type: "methodology"'
      );
      expect(mockPromptManager.handleAction).not.toHaveBeenCalled();
    });

    test('rejects analyze_type action for non-prompt resources', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'gate',
        action: 'analyze_type',
      };

      const result = await router.handleAction(args, {});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        'only valid for resource_type: "prompt"'
      );
      expect(mockGateManager.handleAction).not.toHaveBeenCalled();
    });

    test('rejects analyze_gates action for methodology resources', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'methodology',
        action: 'analyze_gates',
      };

      const result = await router.handleAction(args, {});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        'only valid for resource_type: "prompt"'
      );
      expect(mockFrameworkManager.handleAction).not.toHaveBeenCalled();
    });

    test('rejects guide action for gate resources', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'gate',
        action: 'guide',
      };

      const result = await router.handleAction(args, {});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        'only valid for resource_type: "prompt"'
      );
    });

    test('allows switch action for methodology resources', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'methodology',
        action: 'switch',
        id: 'cageerf',
      };

      const result = await router.handleAction(args, {});

      expect(result.isError).toBeFalsy();
      expect(mockFrameworkManager.handleAction).toHaveBeenCalledTimes(1);
    });

    test('allows analyze_type action for prompt resources', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'prompt',
        action: 'analyze_type',
        id: 'test-prompt',
      };

      const result = await router.handleAction(args, {});

      expect(result.isError).toBeFalsy();
      expect(mockPromptManager.handleAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('common actions', () => {
    test('allows create action for all resource types', async () => {
      const resourceTypes: ResourceManagerInput['resource_type'][] = [
        'prompt',
        'gate',
        'methodology',
      ];

      for (const resource_type of resourceTypes) {
        jest.clearAllMocks();

        const args: ResourceManagerInput = {
          resource_type,
          action: 'create',
          id: 'test-resource',
          name: 'Test Resource',
        };

        const result = await router.handleAction(args, {});

        expect(result.isError).toBeFalsy();
      }
    });

    test('allows list action for all resource types', async () => {
      const resourceTypes: ResourceManagerInput['resource_type'][] = [
        'prompt',
        'gate',
        'methodology',
      ];

      for (const resource_type of resourceTypes) {
        jest.clearAllMocks();

        const args: ResourceManagerInput = {
          resource_type,
          action: 'list',
        };

        const result = await router.handleAction(args, {});

        expect(result.isError).toBeFalsy();
      }
    });

    test('allows delete action for all resource types', async () => {
      const resourceTypes: ResourceManagerInput['resource_type'][] = [
        'prompt',
        'gate',
        'methodology',
      ];

      for (const resource_type of resourceTypes) {
        jest.clearAllMocks();

        const args: ResourceManagerInput = {
          resource_type,
          action: 'delete',
          id: 'test-resource',
          confirm: true,
        };

        const result = await router.handleAction(args, {});

        expect(result.isError).toBeFalsy();
      }
    });
  });

  describe('parameter transformation', () => {
    test('transforms prompt parameters correctly', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'prompt',
        action: 'create',
        id: 'test-prompt',
        name: 'Test Prompt',
        category: 'testing',
        user_message_template: 'Hello {{name}}',
        arguments: [{ name: 'name', required: true }],
      };

      await router.handleAction(args, {});

      expect(mockPromptManager.handleAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          id: 'test-prompt',
          name: 'Test Prompt',
          category: 'testing',
          user_message_template: 'Hello {{name}}',
          arguments: [{ name: 'name', required: true }],
        }),
        {}
      );
    });

    test('transforms gate_type to type for gate handler', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'gate',
        action: 'create',
        id: 'test-gate',
        gate_type: 'validation',
        guidance: 'Test guidance',
      };

      await router.handleAction(args, {});

      expect(mockGateManager.handleAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          id: 'test-gate',
          type: 'validation',
          guidance: 'Test guidance',
        }),
        {}
      );
    });

    test('transforms methodology parameters correctly', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'methodology',
        action: 'switch',
        id: 'react',
        persist: true,
        reason: 'Testing switch',
      };

      await router.handleAction(args, {});

      expect(mockFrameworkManager.handleAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'switch',
          id: 'react',
          persist: true,
          reason: 'Testing switch',
        }),
        {}
      );
    });
  });

  describe('error handling', () => {
    test('catches and formats handler errors', async () => {
      mockPromptManager.handleAction.mockRejectedValueOnce(new Error('Handler error'));

      const args: ResourceManagerInput = {
        resource_type: 'prompt',
        action: 'list',
      };

      const result = await router.handleAction(args, {});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('Handler error');
    });

    test('handles non-Error exceptions', async () => {
      mockGateManager.handleAction.mockRejectedValueOnce('String error');

      const args: ResourceManagerInput = {
        resource_type: 'gate',
        action: 'list',
      };

      const result = await router.handleAction(args, {});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('String error');
    });
  });

  describe('context passthrough', () => {
    test('passes context to handlers', async () => {
      const context = { user: 'test-user', session: 'abc123' };
      const args: ResourceManagerInput = {
        resource_type: 'prompt',
        action: 'list',
      };

      await router.handleAction(args, context);

      expect(mockPromptManager.handleAction).toHaveBeenCalledWith(expect.any(Object), context);
    });
  });
});
