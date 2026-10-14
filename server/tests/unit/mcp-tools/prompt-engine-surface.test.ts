import { describe, expect, test } from '@jest/globals';
import { z } from 'zod/v4';

import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { McpToolRequestValidator } from '../../../src/engine/execution/validation/request-validator.js';
import { isChainId } from '../../../src/shared/utils/chain-id-codec.js';
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

const GATE_PARAMS = ['gates', 'gate_verdict'] as const;
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

describe('chain reference formatter and admission boundaries', () => {
  test.each([
    'chain-analysis#1',
    'chain-implementation_plan/plan_table#1',
    'chain-Team-Legacy/Child_Name/9deep#01',
    'chain-9legacy#0',
  ])('admits the exact formatter-emitted identity %s in every surface state', (raw) => {
    const context = new ExecutionContext({ chain_id: raw });
    context.sessionContext = {
      sessionId: 'session-reference-boundary',
      chainId: raw,
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
    };
    const footer = new ResponseAssembler().buildChainFooter(context);
    const emitted = footer.match(/Next: chain_id="([^"]+)"/)?.[1];
    expect(emitted).toBe(raw);
    expect(isChainId(emitted)).toBe(true);
    expect(McpToolRequestValidator.validateChainId(emitted)).toBe(raw);

    for (const enabled of [true, false, undefined]) {
      const schema = build(enabled === undefined ? undefined : { gateSystemEnabled: enabled });
      expect(schema.parse({ chain_id: emitted }).chain_id).toBe(raw);
      const json = z.toJSONSchema(schema, { io: 'input' });
      const chainId = json.properties?.chain_id;
      if (chainId === null || typeof chainId !== 'object' || typeof chainId.pattern !== 'string') {
        throw new Error('chain_id pattern missing from published schema');
      }
      expect(new RegExp(chainId.pattern).exec(raw)?.[0]).toBe(raw);
    }
  });

  test.each([
    'chain-/child#1',
    'chain-parent/#1',
    'chain-parent//child#1',
    'chain-parent/./child#1',
    'chain-parent/../child#1',
    'chain-parent/%63hild#1',
    'chain-parent\\child#1',
    'chain-parent/child name#1',
    'chain-parent/child#1\n',
    'chain-parent/child#1\r\n',
    'chain-parent/child#latest',
    'chain-parent/child#1#2',
    'chain-parent/child#1 extra',
  ])('rejects malformed full identity %j at runtime and advertised-pattern boundaries', (raw) => {
    for (const enabled of [true, false, undefined]) {
      const schema = build(enabled === undefined ? undefined : { gateSystemEnabled: enabled });
      expect(schema.safeParse({ chain_id: raw }).success).toBe(false);
      const json = z.toJSONSchema(schema, { io: 'input' });
      const chainId = json.properties?.chain_id;
      if (chainId === null || typeof chainId !== 'object' || typeof chainId.pattern !== 'string') {
        throw new Error('chain_id pattern missing from published schema');
      }
      expect(new RegExp(chainId.pattern).test(raw)).toBe(false);
    }
  });
});

describe('prompt_engine parameter surface', () => {
  test.each([true, false, undefined])('keeps the widest action enum with gates=%s', (enabled) => {
    const schema = build(enabled === undefined ? undefined : { gateSystemEnabled: enabled });
    const json = z.toJSONSchema(schema, { io: 'input' }) as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(json.properties['gate_action']?.enum).toEqual([
      'retry',
      'skip',
      'abort',
      'resume',
      'accept_alternative',
    ]);
    for (const gate_action of ['retry', 'skip', 'abort', 'resume', 'accept_alternative']) {
      expect(schema.parse({ chain_id: 'chain-demo#1', gate_action })).toHaveProperty(
        'gate_action',
        gate_action
      );
    }
    expect(schema.safeParse({ chain_id: 'chain-demo#1', gate_action: 'pause' }).success).toBe(
      false
    );
  });

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

  test('lets a gate parameter the current state does not advertise REACH the handler', () => {
    // Withdrawal is structural at the advertised surface, and this pins what
    // that does and does not mean at the wire.
    //
    // Until P4.93 the schema kept zod's strip default, so a stale client that
    // still sent `gates` had it dropped and got a success reply describing a
    // run that ignored it. The schema is now `.passthrough()`: the key SURVIVES
    // validation so the registered callback can answer "declared, but not
    // advertised right now — enable the gate system" by name
    // (`shared/undeclared-parameters.ts`). `.strict()` would reject one layer
    // earlier with a zod message naming neither the tool nor the correction.
    const narrowed = build({ gateSystemEnabled: false });

    const result = narrowed.safeParse({ command: '>>demo', gates: ['some-gate'] });

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('gates', ['some-gate']);
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

  /**
   * The APPEND lift (row A.3).
   *
   * `chain_id` + `command` is the one pair the exclusivity rule now admits, and only when the
   * command's first non-whitespace token is `-->`. Everything else about the rule is unchanged,
   * which is why the rejected cases below are asserted alongside the accepted one: a lift that
   * quietly admitted `chain_id` + `>>x` would make two different runs out of one call, which is
   * the failure the rule exists for.
   */
  describe('the `-->` append pair (row A.3)', () => {
    const schema = () => build({ gateSystemEnabled: true });

    test('accepts chain_id + a command whose first token is "-->"', () => {
      expect(
        schema().safeParse({ chain_id: 'chain-demo#1', command: '--> >>write_summary' }).success
      ).toBe(true);
    });

    test('accepts it with leading whitespace — the FIRST token decides, not position 0', () => {
      expect(
        schema().safeParse({ chain_id: 'chain-demo#1', command: '   --> >>write_summary' }).success
      ).toBe(true);
    });

    test.each([
      ['a plain prompt command', '>>write_summary'],
      ['a new symbolic chain that merely CONTAINS -->', '>>a --> >>b'],
      ['an empty command', ''],
    ])('still rejects chain_id + %s', (_label, command) => {
      const result = schema().safeParse({ chain_id: 'chain-demo#1', command });
      // The empty string is rejected by `command`'s own min-length rule rather than by
      // exclusivity; either way the pair does not become an append.
      expect(result.success).toBe(false);
    });

    test('does NOT lift the rule for the other sources', () => {
      expect(
        schema().safeParse({
          chain_id: 'chain-demo#1',
          command: '--> >>x',
          workflow: { version: 1, nodes: [{ id: 'gather', promptId: 'p' }] },
        }).success
      ).toBe(false);
      expect(schema().safeParse({ command: '--> >>x', claim_token: 'hnd_abc' }).success).toBe(
        false
      );
    });
  });
});
