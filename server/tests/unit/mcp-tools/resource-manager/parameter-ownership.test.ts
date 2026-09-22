// A parameter accepted for a resource type that ignores it is a silent no-op: the class B.78 closed.
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createResourceManagerRouter } from '../../../../src/mcp/tools/resource-manager/core/router.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMMON_PARAMETERS,
  DECLARED_PARAMETERS,
  PARAMETER_ACTIONS,
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

/** The actions the contract says read `parameter` on `type` — P4.134's second dimension. */
const readersOf = (parameter: string, type: ResourceType): string[] => [
  ...(PARAMETER_ACTIONS.get(parameter)?.get(type) ?? []),
];

const firstReader = (parameter: string, type: ResourceType): string =>
  readersOf(parameter, type)[0] ?? 'update';

/** Actions a resource type accepts at all — the router refuses the rest before ownership. */
const ACTIONS_BY_TYPE: Readonly<Record<ResourceType, readonly string[]>> = {
  prompt: [
    'create',
    'validate',
    'update',
    'delete',
    'reload',
    'list',
    'inspect',
    'analyze_type',
    'analyze_gates',
    'guide',
    'history',
    'rollback',
    'compare',
  ],
  gate: [
    'create',
    'update',
    'delete',
    'reload',
    'list',
    'inspect',
    'history',
    'rollback',
    'compare',
  ],
  framework: [
    'create',
    'update',
    'delete',
    'reload',
    'list',
    'inspect',
    'switch',
    'history',
    'rollback',
    'compare',
  ],
  category: [
    'create',
    'update',
    'delete',
    'reload',
    'list',
    'inspect',
    'history',
    'rollback',
    'compare',
  ],
};

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
      // Sent on an action that READS it (P4.134), which is not always `update`.
      for (const owner of owners) {
        test(`dispatches '${parameter}' on ${owner}`, async () => {
          const result = await router.handleAction(
            {
              resource_type: owner,
              action: firstReader(parameter, owner),
              confirm: true,
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

  /**
   * P4.134 — ownership per ACTION, not only per type.
   *
   * Measured before the fix: `resource_type:"gate", action:"inspect", severity:"high"` was
   * forwarded to the gate handler, which read no `severity` on inspect, and answered success.
   * The readers come from the contract's `commands[].parameters`, so these tests drive the
   * whole (parameter × owning type × action) matrix from that one declaration.
   */
  describe('P4.134: a parameter the ACTION does not read', () => {
    test('every owned parameter is declared on at least one command of each owning type', () => {
      // The gate that keeps the contract honest: a parameter no command declares would be
      // refused on every action, so its absence here is a contract gap, not a refusal.
      const undeclared = Object.entries(PARAMETER_OWNERS).flatMap(([parameter, owners]) =>
        owners
          .filter((owner) => readersOf(parameter, owner).length === 0)
          .map((owner) => `${owner}:${parameter}`)
      );

      expect(undeclared).toEqual([]);
    });

    test('the row: severity on gate inspect is refused by name; on update it dispatches', async () => {
      const inspect = await router.handleAction(
        {
          resource_type: 'gate',
          action: 'inspect',
          id: 'g',
          severity: 'high',
        } as ResourceManagerInput,
        {}
      );
      expect(inspect.isError).toBe(true);
      expect(inspect.content[0]?.text).toContain(
        `'severity' is not read by resource_type:"gate" action:"inspect" — only by action:"create" and "update".`
      );
      expect(handlers.gate.handleAction).not.toHaveBeenCalled();

      // One identifier differs — the action — and the same key reaches the handler.
      const update = await router.handleAction(
        {
          resource_type: 'gate',
          action: 'update',
          id: 'g',
          severity: 'high',
        } as ResourceManagerInput,
        {}
      );
      expect(update.isError).toBe(false);
      expect(handlers.gate.handleAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update', severity: 'high' }),
        expect.anything()
      );
    });

    test('a preview reads what its target reads', async () => {
      const result = await router.handleAction(
        {
          resource_type: 'prompt',
          action: 'preview',
          preview_action: 'update',
          id: 'p',
          patch: [{ field: 'description', find: 'a', replace: 'b' }],
        } as unknown as ResourceManagerInput,
        {}
      );

      expect(result.isError).toBe(false);
      expect(handlers.prompt.handleAction).toHaveBeenCalled();
    });

    for (const [parameter, owners] of Object.entries(PARAMETER_OWNERS)) {
      for (const owner of owners) {
        const readers = readersOf(parameter, owner);
        const nonReaders = ACTIONS_BY_TYPE[owner].filter((action) => !readers.includes(action));

        for (const action of nonReaders) {
          test(`refuses '${parameter}' on ${owner} ${action}`, async () => {
            const result = await router.handleAction(
              {
                resource_type: owner,
                action,
                id: 'target',
                confirm: true,
                [parameter]: probeFor(parameter),
              } as unknown as ResourceManagerInput,
              {}
            );

            expect(result.isError).toBe(true);
            expect(result.content[0]?.text).toContain(
              `'${parameter}' is not read by resource_type:"${owner}" action:"${action}"`
            );
            expect(handlers[owner].handleAction).not.toHaveBeenCalled();
          });
        }

        for (const action of readers) {
          test(`dispatches '${parameter}' on ${owner} ${action}`, async () => {
            const result = await router.handleAction(
              {
                resource_type: owner,
                action,
                id: 'target',
                confirm: true,
                [parameter]: probeFor(parameter),
              } as unknown as ResourceManagerInput,
              {}
            );

            expect(result.isError).toBe(false);
            expect(handlers[owner].handleAction).toHaveBeenCalled();
          });
        }
      }
    }
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

  /**
   * R46 — the undeclared half of the same class.
   *
   * `resourceManagerInputSchema` is `.passthrough()`, so a key the contract never named arrives
   * intact, is read by nobody, and the call answers success. #337 closed the declared-but-unowned
   * half; this is the other one.
   */
  describe('R46: a key the contract does not declare', () => {
    for (const resource_type of RESOURCE_TYPES) {
      test(`refuses an undeclared key on ${resource_type} and never dispatches`, async () => {
        const result = await router.handleAction(
          {
            resource_type,
            action: 'update',
            id: 'target',
            not_a_parameter: 'probe-value',
          } as unknown as ResourceManagerInput,
          {}
        );

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain(
          "'not_a_parameter' is not a parameter of resource_manager"
        );
        // Names the key and nothing else: a correction, not a seventy-name dump.
        expect(result.content[0]?.text).not.toContain('user_message_template');
        expect(handlers[resource_type].handleAction).not.toHaveBeenCalled();
      });
    }

    test('a near-miss spelling of a real parameter is refused, not silently dropped', () => {
      // The shape the class actually takes in the wild. `chain_step` (no `s`) is one character
      // from a live parameter, so a check keyed on "looks unrelated" would wave it through.
      expect(describeParameterRefusal('prompt', { chain_step: [] })).toContain(
        "'chain_step' is not a parameter of resource_manager"
      );
    });

    /**
     * THE CONTROL, enumerated from the contract rather than a hand list.
     *
     * A refusal that fires on everything would satisfy every case above. This sends each declared
     * parameter to each type that owns it and asserts it still reaches the handler — so the two
     * refusals bound each other: nothing declared is refused, nothing undeclared passes.
     */
    describe('every declared parameter still reaches the handler that owns it', () => {
      const declaredWithOwners: Array<[string, readonly ResourceType[]]> = [
        ...[...COMMON_PARAMETERS]
          .filter((name) => name !== 'resource_type')
          .map((name): [string, readonly ResourceType[]] => [name, RESOURCE_TYPES]),
        ...Object.entries(PARAMETER_OWNERS),
      ];

      /**
       * Two declared parameters carry an ACTION-scoped refusal of their own, both documented and
       * both unrelated to this class. Paired with the action each is valid on rather than skipped:
       * a control that quietly drops the awkward members stops being a control.
       */
      const VALID_CALL: Readonly<Record<string, { action: string; probe?: unknown }>> = {
        // Honoured by `history` and `compare`; every other action refuses it by name.
        source_workspace: { action: 'history' },
        // Only meaningful with `action:"preview"`, and `delete` is previewable for all four types.
        preview_action: { action: 'preview', probe: 'delete' },
      };

      for (const [parameter, owners] of declaredWithOwners) {
        for (const owner of owners) {
          test(`${parameter} on ${owner}`, async () => {
            const valid = VALID_CALL[parameter];
            const result = await router.handleAction(
              {
                resource_type: owner,
                // An owned parameter is sent on an action that reads it (P4.134).
                action:
                  valid?.action ??
                  (PARAMETER_OWNERS[parameter] !== undefined
                    ? firstReader(parameter, owner)
                    : 'update'),
                id: 'target',
                [parameter]: valid?.probe ?? probeFor(parameter),
              } as unknown as ResourceManagerInput,
              {}
            );

            expect(result.isError).toBe(false);
            expect(handlers[owner].handleAction).toHaveBeenCalled();
          });
        }
      }
    });

    test('the contract declares exactly what the refusal lets through', () => {
      // `DECLARED_PARAMETERS` is what the scan accepts; the contract JSON is what the tool
      // publishes. Reading the contract from disk rather than the schema is deliberate — the
      // schema is already pinned to this table by the suite above, so comparing against it again
      // would close a loop instead of anchoring one end of it outside the code.
      const contract = JSON.parse(
        readFileSync(
          path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            '..',
            '..',
            '..',
            '..',
            'tooling',
            'contracts',
            'resource-manager.json'
          ),
          'utf8'
        )
      ) as { parameters: Array<{ name: string }> };
      const published = contract.parameters.map((entry) => entry.name).sort();

      expect([...DECLARED_PARAMETERS].sort()).toEqual(published);
    });
  });
});
