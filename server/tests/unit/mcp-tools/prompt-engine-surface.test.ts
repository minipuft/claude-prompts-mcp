import { describe, expect, test } from '@jest/globals';
import { z } from 'zod/v4';

import { buildPromptEngineSchema } from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';

import type { ToolSurfaceState } from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';

/**
 * `prompt_engine` advertises a parameter surface that is a function of runtime
 * state rather than a constant. Two properties carry the whole design and both
 * fail silently if broken, so both are asserted here rather than inferred:
 *
 * 1. It is *pure*. `createMcpHandler` builds a fresh server per HTTP request,
 *    so a surface that accumulated mutations instead of being recomputed would
 *    pass a STDIO test and no-op over HTTP.
 * 2. It narrows on the gate system master switch and on nothing else. The
 *    adjacent `enableFrameworkGates` switch withholds only server-loaded
 *    framework gates and must not withdraw a parameter clients still use.
 */

const GATE_PARAMS = ['gates', 'gate_verdict', 'gate_action'] as const;
const CORE_PARAMS = ['command', 'force_restart', 'chain_id', 'user_response', 'options'] as const;

const acceptAnyVerdict = (): boolean => true;

function build(state?: ToolSurfaceState) {
  return buildPromptEngineSchema(
    acceptAnyVerdict,
    'invalid verdict',
    state != null ? { state } : {}
  );
}

/** The JSON Schema a client actually sees on `tools/list`. */
function advertisedKeys(state?: ToolSurfaceState): string[] {
  const json = z.toJSONSchema(build(state), { io: 'input' }) as {
    properties?: Record<string, unknown>;
  };
  return Object.keys(json.properties ?? {}).sort();
}

describe('prompt_engine parameter surface', () => {
  test('advertises the gate parameters while the gate system is enabled', () => {
    const keys = advertisedKeys({ gateSystemEnabled: true });

    for (const param of GATE_PARAMS) {
      expect(keys).toContain(param);
    }
  });

  test('withdraws the gate parameters while the gate system is disabled', () => {
    const keys = advertisedKeys({ gateSystemEnabled: false });

    for (const param of GATE_PARAMS) {
      expect(keys).not.toContain(param);
    }
  });

  test('keeps every non-gate parameter in both states', () => {
    const enabled = advertisedKeys({ gateSystemEnabled: true });
    const disabled = advertisedKeys({ gateSystemEnabled: false });

    for (const param of CORE_PARAMS) {
      expect(enabled).toContain(param);
      expect(disabled).toContain(param);
    }
  });

  test('the two states differ in shape, not merely in description text', () => {
    // This is the tier's own gate criterion. A surface that only rewrote
    // `description` strings would satisfy a naive "the schema changed" check
    // while delivering none of the capability.
    expect(advertisedKeys({ gateSystemEnabled: true })).not.toEqual(
      advertisedKeys({ gateSystemEnabled: false })
    );
  });

  test('omitted state resolves to the widest surface', () => {
    // `isGateSystemEnabled()` defaults to enabled when no gate state store is
    // wired; the schema default has to agree or an unconfigured server would
    // advertise less than it accepts.
    expect(advertisedKeys()).toEqual(advertisedKeys({ gateSystemEnabled: true }));
  });

  test.each([true, false])(
    'is a pure function of state — gateSystemEnabled=%s builds identically twice',
    (gateSystemEnabled) => {
      // Purity is what makes the HTTP path work at all: every request rebuilds
      // from current state, so two builds of the same state must agree.
      const first = z.toJSONSchema(build({ gateSystemEnabled }), { io: 'input' });
      const second = z.toJSONSchema(build({ gateSystemEnabled }), { io: 'input' });

      expect(first).toEqual(second);
    }
  );

  test('drops a gate parameter that the current state does not advertise', () => {
    // Withdrawal is structural at the advertised surface, and this pins what
    // that does and does not mean at the wire.
    //
    // Zod objects strip unknown keys rather than rejecting them, and this
    // schema deliberately keeps that default: a stale client that still sends
    // `gates` gets it dropped, not an error. Turning on strict mode here would
    // make a narrowed state reject calls that a wide state accepts, which
    // punishes exactly the clients a `tools/list` cache makes stale.
    //
    // Dropping matches the runtime, which already ignores gate ids from every
    // source while the system is disabled. What changes is that the parameter
    // is no longer advertised, so a current client never constructs the call.
    const narrowed = build({ gateSystemEnabled: false });

    const result = narrowed.safeParse({ command: '>>demo', gates: ['some-gate'] });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('gates');
  });

  test('accepts the gate parameters when they are advertised', () => {
    const wide = build({ gateSystemEnabled: true });

    const result = wide.safeParse({
      command: '>>demo',
      gates: ['some-gate'],
      gate_action: 'retry',
    });

    expect(result.success).toBe(true);
  });

  describe('observations[].target_step_id (P4)', () => {
    // unknownDiscoveredSchema.target_step_id shares its regex with
    // temporaryGateObjectSchema.target_step_id: kebab-case node id, or an nK symbolic id.
    function parseObservations(target_step_id: string) {
      return build().safeParse({
        command: '>>demo',
        observations: [
          {
            type: 'unknown_discovered',
            id: 'cache-ttl-unknown',
            statement: 'TTL for the new cache layer is undecided',
            target_step_id,
          },
        ],
      });
    }

    test('accepts a kebab-case node id', () => {
      expect(parseObservations('draft-outline').success).toBe(true);
    });

    test('accepts an nK symbolic id', () => {
      expect(parseObservations('n2').success).toBe(true);
    });

    test('rejects an uppercase target', () => {
      expect(parseObservations('Draft-Outline').success).toBe(false);
    });

    test('rejects an underscore-separated target', () => {
      expect(parseObservations('draft_outline').success).toBe(false);
    });

    test('remains optional — an entry omitting it still parses', () => {
      const result = build().safeParse({
        command: '>>demo',
        observations: [
          {
            type: 'unknown_discovered',
            id: 'cache-ttl-unknown',
            statement: 'TTL for the new cache layer is undecided',
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  test('description overlays change text without changing shape', () => {
    // The two halves of the resolver are independent by design: an overlay that
    // silently reshaped the surface would make every framework switch a
    // breaking change under the semver ruling.
    const overlaid = buildPromptEngineSchema(acceptAnyVerdict, 'invalid verdict', {
      describe: (name, fallback) => `[OVERLAY ${name}] ${fallback}`,
      state: { gateSystemEnabled: true },
    });

    const overlaidJson = z.toJSONSchema(overlaid, { io: 'input' }) as {
      properties?: Record<string, { description?: string }>;
    };

    expect(Object.keys(overlaidJson.properties ?? {}).sort()).toEqual(
      advertisedKeys({ gateSystemEnabled: true })
    );
    expect(overlaidJson.properties?.['command']?.description).toContain('[OVERLAY command]');
  });

  describe('the `workflow` command source (P6 Tier 5)', () => {
    const IR = {
      version: 1 as const,
      nodes: [{ id: 'gather', promptId: 'research_docs' }],
    };

    test('is advertised in BOTH states — it is never narrowed', () => {
      // Deliberate, and the reason it is a core field: narrowing withdraws a parameter without
      // rejecting it (Zod's strip default is kept), so a client holding a stale tools/list would
      // get a success with its whole workflow discarded (P6-F6). A shape that never narrows
      // cannot express that failure.
      expect(advertisedKeys({ gateSystemEnabled: true })).toContain('workflow');
      expect(advertisedKeys({ gateSystemEnabled: false })).toContain('workflow');
    });

    test('accepts a workflow submitted on its own', () => {
      expect(build({ gateSystemEnabled: true }).safeParse({ workflow: IR }).success).toBe(true);
    });

    test.each([
      ['command', { command: '>>demo', workflow: IR }],
      ['chain_id', { chain_id: 'chain-demo#1', workflow: IR }],
      ['all three', { command: '>>demo', chain_id: 'chain-demo#1', workflow: IR }],
    ])('rejects a workflow combined with %s', (_label, payload) => {
      const result = build({ gateSystemEnabled: true }).safeParse(payload);
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain('exactly one of');
    });

    test('applies the exclusivity rule in the narrowed state too', () => {
      // Exclusivity has nothing to do with gates. A rule applied to one reachable shape and not
      // the other is a rule with a hole in it.
      expect(
        build({ gateSystemEnabled: false }).safeParse({ command: '>>demo', workflow: IR }).success
      ).toBe(false);
    });

    test('still accepts each command source on its own', () => {
      // Bounds the guard: a refinement that rejected every call would pass all four assertions
      // above.
      const schema = build({ gateSystemEnabled: true });
      expect(schema.safeParse({ command: '>>demo' }).success).toBe(true);
      expect(schema.safeParse({ chain_id: 'chain-demo#1' }).success).toBe(true);
    });

    test('rejects an unknown key inside a node — the IR schema is strict all the way down', () => {
      const result = build({ gateSystemEnabled: true }).safeParse({
        workflow: { version: 1, nodes: [{ id: 'gather', promptId: 'p', notAField: true }] },
      });
      expect(result.success).toBe(false);
    });
  });
});
