// A parameter accepted for a resource type that ignores it is a silent no-op: the class B.78 closed.
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createResourceManagerRouter } from '../../../../src/mcp/tools/resource-manager/core/router.js';
import {
  COMMON_PARAMETERS,
  PARAMETER_OWNERS,
  describeParameterRefusal,
} from '../../../../src/mcp/tools/resource-manager/core/parameter-ownership.js';
import { resourceManagerInputSchema } from '../../../../src/mcp/tools/schemas/resource-manager.schema.js';
import { MockLogger } from '../../../helpers/test-helpers.js';

import type { ResourceManagerRouter } from '../../../../src/mcp/tools/resource-manager/core/router.js';
import type {
  ResourceManagerInput,
  ResourceType,
} from '../../../../src/mcp/tools/resource-manager/core/types.js';
import type { ToolResponse } from '../../../../src/shared/types/index.js';

const RESOURCE_TYPES: readonly ResourceType[] = ['prompt', 'gate', 'framework', 'category'];

/**
 * The refusal keys only on "was it sent", so any non-undefined value probes it. Two parameters
 * are normalized by their own router branch before dispatch and need their real shape to reach
 * the handler at all — the positive control would otherwise fail for an unrelated reason.
 */
const PROBE_VALUE: Readonly<Record<string, unknown>> = {
  pass_criteria: [{ type: 'content_length' }],
  phases: [{ id: 'p1', name: 'P1', description: 'only phase' }],
};

const probeFor = (parameter: string): unknown => PROBE_VALUE[parameter] ?? 'probe-value';

type MockHandler = {
  handleAction: jest.MockedFunction<
    (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>
  >;
};

describe('resource_manager parameter ownership', () => {
  let router: ResourceManagerRouter;
  let handlers: Record<ResourceType, MockHandler>;

  const successResponse: ToolResponse = {
    content: [{ type: 'text', text: 'Success' }],
    isError: false,
  };

  const makeHandler = (): MockHandler => ({
    handleAction: jest.fn<
      (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>
    >(() => Promise.resolve(successResponse)),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = {
      prompt: makeHandler(),
      gate: makeHandler(),
      framework: makeHandler(),
      category: makeHandler(),
    };

    type Deps = Parameters<typeof createResourceManagerRouter>[0];
    router = createResourceManagerRouter({
      logger: new MockLogger() as unknown as Deps['logger'],
      promptResourceHandler: handlers.prompt as unknown as Deps['promptResourceHandler'],
      gateManager: handlers.gate as unknown as Deps['gateManager'],
      frameworkManager: handlers.framework as unknown as Deps['frameworkManager'],
      categoryManager: handlers.category as unknown as Deps['categoryManager'],
    });
  });

  /**
   * The gate that fails when a NEW parameter joins the class.
   *
   * A parameter added to the published schema is accepted for all four resource types whether or
   * not any handler reads it. Until it is classified here — common, or owned by a named subset —
   * it is exactly the accepted-and-ignored shape this table exists to refuse.
   */
  describe('table covers the published schema', () => {
    const schemaParameters = Object.keys(resourceManagerInputSchema.shape);

    test('every published parameter is either common or owned', () => {
      const unclassified = schemaParameters.filter(
        (name) => !COMMON_PARAMETERS.has(name) && PARAMETER_OWNERS[name] === undefined
      );

      expect(unclassified).toEqual([]);
    });

    test('every classified parameter is still published', () => {
      // The other direction: a parameter removed from the schema leaves a table entry refusing a
      // name nobody can send, and the refusal message then documents a parameter that is gone.
      const published = new Set(schemaParameters);
      const stale = [...Object.keys(PARAMETER_OWNERS), ...COMMON_PARAMETERS].filter(
        (name) => !published.has(name)
      );

      expect(stale).toEqual([]);
    });

    test('no parameter is owned by every type or by none', () => {
      // An entry owned by all four belongs in COMMON_PARAMETERS; one owned by none is a parameter
      // no handler reads at all, which is the defect rather than a classification of it.
      const miscounted = Object.entries(PARAMETER_OWNERS)
        .filter(([, owners]) => owners.length === 0 || owners.length === RESOURCE_TYPES.length)
        .map(([name]) => name);

      expect(miscounted).toEqual([]);
    });
  });

  describe('router refuses a parameter the resource type does not read', () => {
    // The whole class, driven — every (parameter × non-owning type) pair, not just `unset`.
    for (const [parameter, owners] of Object.entries(PARAMETER_OWNERS)) {
      for (const resource_type of RESOURCE_TYPES) {
        if (owners.includes(resource_type)) continue;

        test(`refuses '${parameter}' on ${resource_type} and never dispatches`, async () => {
          const result = await router.handleAction(
            {
              resource_type,
              action: 'update',
              id: 'target',
              [parameter]: probeFor(parameter),
            } as unknown as ResourceManagerInput,
            {}
          );

          expect(result.isError).toBe(true);
          expect(result.content[0]?.text).toContain(`'${parameter}' is not a parameter`);
          // The owners must be NAMED: a refusal that only says "wrong" leaves the caller guessing
          // which of four types reads it.
          for (const owner of owners) {
            expect(result.content[0]?.text).toContain(`"${owner}"`);
          }
          // Ahead of dispatch, so no write and no version snapshot precede the refusal.
          expect(handlers[resource_type].handleAction).not.toHaveBeenCalled();
        });
      }

      // Positive control for the same parameter: the refusal keys on the TYPE, not on the
      // parameter's presence. Without this, a guard that refused everything would pass above.
      for (const owner of owners) {
        test(`dispatches '${parameter}' on ${owner}`, async () => {
          const result = await router.handleAction(
            {
              resource_type: owner,
              action: 'update',
              id: 'target',
              [parameter]: probeFor(parameter),
            } as unknown as ResourceManagerInput,
            {}
          );

          expect(result.isError).toBe(false);
          expect(handlers[owner].handleAction).toHaveBeenCalled();
        });
      }
    }

    test('leaves common parameters alone for every type', () => {
      for (const resource_type of RESOURCE_TYPES) {
        const args = Object.fromEntries(
          [...COMMON_PARAMETERS].map((name) => [name, 'probe-value'])
        );
        expect(describeParameterRefusal(resource_type, { ...args, resource_type })).toBeNull();
      }
    });
  });

  describe('B.78: `unset` on a type that cannot remove a field', () => {
    // The row's own case, measured on a running server before the fix: `update` with
    // `unset:["description"]` answered "updated successfully", saved version 2, and left the
    // file byte-identical, for gate, framework and category alike.
    for (const resource_type of ['gate', 'framework', 'category'] as const) {
      test(`refuses unset for ${resource_type} by name`, async () => {
        const result = await router.handleAction(
          {
            resource_type,
            action: 'update',
            id: 'target',
            unset: ['description'],
          } as unknown as ResourceManagerInput,
          {}
        );

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain("'unset' is not a parameter");
        expect(result.content[0]?.text).toContain('resource_type:"prompt"');
        expect(handlers[resource_type].handleAction).not.toHaveBeenCalled();
      });
    }

    test('still forwards unset for prompt', async () => {
      const result = await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'update',
          id: 'target',
          unset: ['system_message'],
        } as unknown as ResourceManagerInput,
        {}
      );

      expect(result.isError).toBe(false);
      expect(handlers.prompt.handleAction).toHaveBeenCalledWith(
        expect.objectContaining({ unset: ['system_message'] }),
        expect.anything()
      );
    });
  });
});
