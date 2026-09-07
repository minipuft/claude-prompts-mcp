// Unit tests for ResourceManagerRouter
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  ResourceManagerRouter,
  createResourceManagerRouter,
} from '../../../../src/mcp/tools/resource-manager/core/router.js';
import { MockLogger } from '../../../helpers/test-helpers.js';

import {
  DESTRUCTIVE_ACTIONS,
  HANDLER_OWNED_CONFIRMATION,
} from '../../../../src/mcp/tools/resource-manager/core/types.js';

import type { ResourceManagerInput } from '../../../../src/mcp/tools/resource-manager/core/types.js';
import type { ToolResponse } from '../../../../src/shared/types/index.js';

describe('ResourceManagerRouter', () => {
  let router: ResourceManagerRouter;
  let logger: MockLogger;
  let mockPromptResourceHandler: {
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

    mockPromptResourceHandler = {
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
      promptResourceHandler: mockPromptResourceHandler as unknown as Parameters<
        typeof createResourceManagerRouter
      >[0]['promptResourceHandler'],
      gateManager: mockGateManager as unknown as Parameters<
        typeof createResourceManagerRouter
      >[0]['gateManager'],
      frameworkManager: mockFrameworkManager as unknown as Parameters<
        typeof createResourceManagerRouter
      >[0]['frameworkManager'],
    });
  });

  describe('destructive-action guard', () => {
    const RESOURCE_TYPES = ['prompt', 'gate', 'framework'] as const;
    const handlerFor = (type: (typeof RESOURCE_TYPES)[number]) =>
      type === 'prompt'
        ? mockPromptResourceHandler
        : type === 'gate'
          ? mockGateManager
          : mockFrameworkManager;

    // Every member of DESTRUCTIVE_ACTIONS, on every resource type. A new destructive action added
    // to the registry without a guard shows up here rather than in production.
    for (const action of [...DESTRUCTIVE_ACTIONS]) {
      for (const resource_type of RESOURCE_TYPES) {
        // Pairs the handler guards itself because its refusal carries information the router does
        // not have. Driven from the same constant the router reads, so adding an entry there
        // moves this test with it rather than leaving a stale expectation behind.
        const handlerOwned = HANDLER_OWNED_CONFIRMATION.has(`${resource_type}:${action}`);

        (handlerOwned ? test.skip : test)(
          `refuses ${resource_type} ${action} without confirm and never dispatches`,
          async () => {
            const result = await router.handleAction(
              { resource_type, action, id: 'target' } as ResourceManagerInput,
              {}
            );

            expect(result.isError).toBe(true);
            expect(result.content[0]?.text).toContain('requires confirmation');
            // The guard must sit AHEAD of dispatch — a handler that is reached has already had
            // the chance to mutate, which is the whole failure this replaces.
            expect(handlerFor(resource_type).handleAction).not.toHaveBeenCalled();
          }
        );

        test(`dispatches ${resource_type} ${action} when confirm is true`, async () => {
          const result = await router.handleAction(
            { resource_type, action, id: 'target', confirm: true } as ResourceManagerInput,
            {}
          );

          expect(result.isError).toBe(false);
          expect(handlerFor(resource_type).handleAction).toHaveBeenCalled();
        });
      }
    }

    test('leaves non-destructive actions unguarded', async () => {
      // Guarding a read would be its own defect: `confirm` on `list` trains callers to send it
      // reflexively, which is how a confirmation stops meaning anything.
      for (const action of ['list', 'inspect', 'history', 'compare', 'reload'] as const) {
        jest.clearAllMocks();
        const result = await router.handleAction(
          { resource_type: 'gate', action, id: 'target' } as ResourceManagerInput,
          {}
        );
        expect(result.isError).toBe(false);
        expect(mockGateManager.handleAction).toHaveBeenCalled();
      }
    });

    test('stands down for handler-owned pairs so the richer refusal survives', async () => {
      // The exemption must be observable, not just declared. A HANDLER_OWNED_CONFIRMATION entry
      // whose handler quietly stopped guarding would otherwise look identical to a guarded pair.
      for (const pair of HANDLER_OWNED_CONFIRMATION) {
        const [resource_type, action] = pair.split(':') as [
          (typeof RESOURCE_TYPES)[number],
          ResourceManagerInput['action'],
        ];
        jest.clearAllMocks();

        await router.handleAction(
          { resource_type, action, id: 'target' } as ResourceManagerInput,
          {}
        );

        // Dispatched despite the missing `confirm` — the handler, not the router, decides.
        expect(handlerFor(resource_type).handleAction).toHaveBeenCalled();
      }
    });

    test('confirm: false is refused exactly as an omitted confirm is', async () => {
      const result = await router.handleAction(
        {
          resource_type: 'gate',
          action: 'delete',
          id: 'target',
          confirm: false,
        } as ResourceManagerInput,
        {}
      );
      expect(result.isError).toBe(true);
      expect(mockGateManager.handleAction).not.toHaveBeenCalled();
    });
  });

  describe('routing', () => {
    test('routes prompt resources to prompt handler', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'prompt',
        action: 'list',
      };

      const result = await router.handleAction(args, {});

      expect(mockPromptResourceHandler.handleAction).toHaveBeenCalledTimes(1);
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
      expect(mockPromptResourceHandler.handleAction).not.toHaveBeenCalled();
      expect(mockFrameworkManager.handleAction).not.toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
    });

    test('routes framework resources to framework handler', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'framework',
        action: 'list',
      };

      const result = await router.handleAction(args, {});

      expect(mockFrameworkManager.handleAction).toHaveBeenCalledTimes(1);
      expect(mockPromptResourceHandler.handleAction).not.toHaveBeenCalled();
      expect(mockGateManager.handleAction).not.toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
    });

    /**
     * OQ-P7-8. `routeToPromptResource` builds an explicit key whitelist, so a parameter left out of
     * it is dropped SILENTLY — the schema still accepts the call, the processor still runs, and the
     * field simply never arrives. Nothing downstream can detect that: every processor test calls
     * `updatePrompt` directly and never crosses this boundary. This is the only assertion in the
     * suite that would fail on a forgotten pass-through.
     */
    test('passes preserved-field parameters through to the prompt handler', async () => {
      const args = {
        resource_type: 'prompt',
        action: 'update',
        id: 'review_code',
        composer: { inputArgument: 'task' },
        injection: { 'system-prompt': { enabled: false } },
        register_with_mcp: false,
        mcp_prompt_mode: 'launch',
        subagent_model: 'heavy',
        agent_type: 'code-lifecycle-auditor',
      } as unknown as ResourceManagerInput;

      await router.handleAction(args, {});

      const forwarded = mockPromptResourceHandler.handleAction.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(forwarded['composer']).toEqual({ inputArgument: 'task' });
      expect(forwarded['injection']).toEqual({ 'system-prompt': { enabled: false } });
      expect(forwarded['register_with_mcp']).toBe(false);
      expect(forwarded['mcp_prompt_mode']).toBe('launch');
      expect(forwarded['subagent_model']).toBe('heavy');
      expect(forwarded['agent_type']).toBe('code-lifecycle-auditor');
    });

    test('passes prompt validation and concurrency parameters through without coercion', async () => {
      await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'validate',
          id: 'draft_prompt',
          name: 'Draft Prompt',
          description: 'Draft description',
          system_message: 'System-only prompt',
          expected_version: 12,
          full_restart: true,
          is_chain: false,
        } as ResourceManagerInput,
        {}
      );

      expect(mockPromptResourceHandler.handleAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'validate',
          expected_version: 12,
          full_restart: true,
          is_chain: false,
          system_message: 'System-only prompt',
        }),
        {}
      );
    });
  });

  describe('action validation', () => {
    test('rejects switch action for non-framework resources', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'prompt',
        action: 'switch',
      };

      const result = await router.handleAction(args, {});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        'only valid for resource_type: "framework"'
      );
      expect(mockPromptResourceHandler.handleAction).not.toHaveBeenCalled();
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

    test('rejects analyze_gates action for framework resources', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'framework',
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

    test('allows switch action for framework resources', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'framework',
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
      expect(mockPromptResourceHandler.handleAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('common actions', () => {
    test('allows create action for all resource types', async () => {
      const resourceTypes: ResourceManagerInput['resource_type'][] = [
        'prompt',
        'gate',
        'framework',
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
        'framework',
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
        'framework',
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

      expect(mockPromptResourceHandler.handleAction).toHaveBeenCalledWith(
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

    test('transforms framework parameters correctly', async () => {
      const args: ResourceManagerInput = {
        resource_type: 'framework',
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

    /**
     * `preview_action` reaches the gate and framework handlers.
     *
     * Both routes build their payload from an explicit allowlist rather than spreading the input,
     * so a parameter that exists in the schema, in the manager's input type, and in the handler
     * can still be structurally dead — that is exactly how `version_description` came to be typed,
     * read, and unreachable (F6), and how `dry_run` reached these same two routes before it was
     * removed. Typechecking cannot see it: every layer compiles fine while the router quietly
     * drops the field.
     */
    test.each([
      ['gate' as const, () => mockGateManager.handleAction],
      ['framework' as const, () => mockFrameworkManager.handleAction],
    ])('forwards preview_action to the %s handler', async (resourceType, handler) => {
      await router.handleAction(
        {
          resource_type: resourceType,
          action: 'preview',
          preview_action: 'rollback',
          id: `test-${resourceType}`,
          version: 1,
        } as ResourceManagerInput,
        {}
      );

      expect(handler()).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'preview', preview_action: 'rollback' }),
        {}
      );
    });

    /**
     * A preview needs no `confirm`, and that is the point of the whole change.
     *
     * The pre-dispatch guard keys on `action`, so while previewing was `dry_run: true` on
     * `action:"delete"` the guard saw `delete` and refused — an operator had to confirm the
     * deletion in order to be shown what it would cost. `preview` is simply not a member of
     * `DESTRUCTIVE_ACTIONS`, so there is no condition to get backwards.
     */
    test.each([
      ['gate' as const, () => mockGateManager.handleAction],
      ['framework' as const, () => mockFrameworkManager.handleAction],
    ])('a %s delete preview reaches dispatch with no confirm', async (resourceType, handler) => {
      const response = await router.handleAction(
        {
          resource_type: resourceType,
          action: 'preview',
          preview_action: 'delete',
          id: `test-${resourceType}`,
        } as ResourceManagerInput,
        {}
      );

      expect(response.isError).not.toBe(true);
      expect(handler()).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'preview', preview_action: 'delete' }),
        {}
      );
    });

    /**
     * Positive control for the two refusals below: without it, "the handler was not called" is
     * evidence about nothing, since a typo in the fixture produces the same silence.
     */
    test('a well-formed prompt update preview reaches the prompt handler', async () => {
      await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'preview',
          preview_action: 'update',
          id: 'test-prompt',
        } as ResourceManagerInput,
        {}
      );

      expect(mockPromptResourceHandler.handleAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'preview', preview_action: 'update' }),
        expect.anything()
      );
    });

    /**
     * The refusal that carries the real defect.
     *
     * `dry_run` was forwarded to every manager for every action, but only seven of the nine
     * (type × action) pairs read it — gate and framework `update` accepted the parameter and wrote
     * anyway, so a preview of those two performed the mutation and reported success. A flat
     * previewable-action list would have carried that into the new vocabulary under a better name.
     */
    test.each([['gate' as const], ['framework' as const]])(
      'refuses preview_action:"update" for %s, which has no update preview path',
      async (resourceType) => {
        const response = await router.handleAction(
          {
            resource_type: resourceType,
            action: 'preview',
            preview_action: 'update',
            id: `test-${resourceType}`,
          } as ResourceManagerInput,
          {}
        );

        expect(response.isError).toBe(true);
        expect(response.content[0]?.text).toContain('not supported for resource_type');
        expect(
          resourceType === 'gate' ? mockGateManager.handleAction : mockFrameworkManager.handleAction
        ).not.toHaveBeenCalled();
      }
    );

    test('refuses action:"preview" with no preview_action', async () => {
      const response = await router.handleAction(
        { resource_type: 'prompt', action: 'preview', id: 'test-prompt' } as ResourceManagerInput,
        {}
      );

      expect(response.isError).toBe(true);
      expect(response.content[0]?.text).toContain("requires 'preview_action'");
      expect(mockPromptResourceHandler.handleAction).not.toHaveBeenCalled();
    });

    /**
     * A parameter that silently does nothing reads as a preview that ran. Refused rather than
     * ignored — the same reason the cross-workspace guard below refuses `source_workspace`.
     */
    test('refuses preview_action without action:"preview"', async () => {
      const response = await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'update',
          preview_action: 'update',
          id: 'test-prompt',
        } as ResourceManagerInput,
        {}
      );

      expect(response.isError).toBe(true);
      expect(response.content[0]?.text).toContain('only meaningful with action:"preview"');
      expect(mockPromptResourceHandler.handleAction).not.toHaveBeenCalled();
    });

    test.each([
      ['gate' as const, () => mockGateManager.handleAction],
      ['framework' as const, () => mockFrameworkManager.handleAction],
    ])('forwards source_workspace to the %s handler on history', async (resourceType, handler) => {
      await router.handleAction(
        {
          resource_type: resourceType,
          action: 'history',
          id: `test-${resourceType}`,
          source_workspace: 'other-checkout',
        } as ResourceManagerInput,
        {}
      );

      expect(handler()).toHaveBeenCalledWith(
        expect.objectContaining({ source_workspace: 'other-checkout' }),
        {}
      );
    });
  });

  /**
   * `source_workspace` is read-only, and the refusal must be a refusal.
   *
   * Ignoring it and scoping back to local would be the worse failure: the caller would be told the
   * rollback succeeded and would believe they had restored the OTHER workspace's version, when they
   * had restored their own. Version numbering is per-workspace, so there is no coherent way to
   * write across the boundary either.
   */
  describe('cross-workspace read guard', () => {
    test.each(['rollback', 'update', 'delete', 'create'] as const)(
      'refuses source_workspace on %s',
      async (action) => {
        const response = await router.handleAction(
          {
            resource_type: 'gate',
            action,
            id: 'test-gate',
            confirm: true,
            source_workspace: 'other-checkout',
          } as ResourceManagerInput,
          {}
        );

        expect(response.isError).toBe(true);
        expect(response.content[0]!.text).toContain('source_workspace');
        expect(response.content[0]!.text).toContain('read-only');
        expect(mockGateManager.handleAction).not.toHaveBeenCalled();
      }
    );

    test('allows the action through when source_workspace is absent', async () => {
      const response = await router.handleAction(
        {
          resource_type: 'gate',
          action: 'rollback',
          id: 'test-gate',
          version: 1,
          confirm: true,
        } as ResourceManagerInput,
        {}
      );

      expect(response.isError).not.toBe(true);
      expect(mockGateManager.handleAction).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('catches and formats handler errors', async () => {
      mockPromptResourceHandler.handleAction.mockRejectedValueOnce(new Error('Handler error'));

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

      expect(mockPromptResourceHandler.handleAction).toHaveBeenCalledWith(
        expect.any(Object),
        context
      );
    });
  });
});
