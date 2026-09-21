/**
 * Every object schema reachable from a registered tool schema refuses an unknown key (P4.97/R59).
 *
 * P4.93 closed the TOP-LEVEL class: a key no contract declares is refused by name. One level down
 * the same silent strip survived — zod's default for `z.object` is to drop an unknown key — so a
 * misspelling inside `gate_verdict`, `observations[]`, an inline gate, or `system_control.config`
 * was accepted, read by nobody, and the call answered success.
 *
 * `gate_verdict` is the sharpest instance and the reason this is not cosmetic. It is the SAFETY
 * REVIEW submission. With the strip default, `{passed: true}` misspelled as `{pased: true}` lost
 * the key AND left `passed` absent — and an absent boolean is not "unknown", it is the failure
 * reading. A gate review could report the opposite of what the client submitted, silently.
 *
 * The check below is the point of the file. It ENUMERATES rather than spot-checks: it walks every
 * schema reachable from the three registered tool schemas and fails on any object that neither
 * refuses unknown keys nor appears in {@link DELIBERATELY_OPEN} with a reason. A new nested object
 * added anywhere in that graph is therefore a failure until someone classifies it, which is the
 * difference between fixing the sites we found and closing the class.
 */

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod/v4';

import { buildPromptEngineSchema } from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';
import { resourceManagerInputSchema } from '../../../src/mcp/tools/schemas/resource-manager.schema.js';
import { buildSystemControlSchema } from '../../../src/mcp/tools/schemas/system-control.schema.js';

/**
 * Objects that stay OPEN on purpose, each with the reason.
 *
 * The test key is the dotted path at which the object is reached. An entry whose object is no
 * longer reachable, or is no longer open, fails too: a satisfied exemption reads as coverage.
 */
const DELIBERATELY_OPEN: Readonly<Record<string, string>> = {
  // The three registered roots. `.passthrough()` is load-bearing: an undeclared TOP-LEVEL key has
  // to arrive for `describeUndeclaredParameterRefusal` to name it and suggest a correction
  // (P4.93). They are the one place in the graph where an unknown key is answered better by our
  // refusal than by zod's.
  prompt_engine: 'registered root — P4.93 names the key itself',
  system_control: 'registered root — P4.93 names the key itself',
  resource_manager: 'registered root — P4.93 names the key itself',

  // A chain step is an OPAQUE object by decision, not by omission: `ChainStepSchema` is
  // `.strict()` at its own definition (`prompt-schema.ts`) and this surface deliberately relaxes
  // it — see the `arguments` comment in `resource-manager.schema.ts`, which contrasts the two
  // ("an argument is a typed contract" / "a step is an opaque object"). Flipping these would
  // narrow prompt authoring, which is a different decision from closing a silent strip.
  'resource_manager.chain_steps[]': 'ChainStepSchema.passthrough() — a step is an opaque object',
  'resource_manager.chain_step_data': 'ChainStepSchema.passthrough() — same decision, one step',
};

/** One reachable object: where it is, and whether an unknown key survives it. */
interface ReachableObject {
  path: string;
  open: boolean;
}

/**
 * Walk every schema reachable from `root`, reporting each object and its unknown-key posture.
 *
 * Posture is read from zod's own internals rather than guessed: a `catchall` of `never` is
 * `.strict()`, `unknown` is `.passthrough()`/loose, and an absent catchall is the STRIP default —
 * the silent one this row exists to remove. Verified against all three spellings before use.
 */
function walk(root: unknown, path: string, seen: Set<unknown>, out: ReachableObject[]): void {
  if (root == null || typeof root !== 'object') return;
  if (seen.has(root)) return;
  seen.add(root);

  const def = (root as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
  if (def == null) return;
  const type = def['type'] as string | undefined;

  switch (type) {
    case 'object': {
      const catchall = (def['catchall'] as { _zod?: { def?: { type?: string } } } | undefined)?._zod
        ?.def?.type;
      out.push({ path, open: catchall !== 'never' });
      for (const [key, child] of Object.entries(def['shape'] as Record<string, unknown>)) {
        walk(child, `${path}.${key}`, seen, out);
      }
      return;
    }
    case 'array':
      walk(def['element'], `${path}[]`, seen, out);
      return;
    case 'union':
      (def['options'] as unknown[]).forEach((option, index) =>
        walk(option, `${path}|${index}`, seen, out)
      );
      return;
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'nonoptional':
    case 'catch':
      walk(def['innerType'], path, seen, out);
      return;
    case 'pipe':
      walk(def['in'], path, seen, out);
      walk(def['out'], path, seen, out);
      return;
    case 'lazy':
      // A recursive schema: resolving it would not terminate, and none exists in this graph today.
      return;
    case 'record':
    case 'map':
      // A free-form key space by construction — there is no declared key to be unknown of.
      walk(def['valueType'], `${path}{}`, seen, out);
      return;
    default:
      return;
  }
}

function reachableObjects(): ReachableObject[] {
  const out: ReachableObject[] = [];
  const seen = new Set<unknown>();
  // The WIDEST prompt_engine shape: the narrowed one omits the gate parameters, so walking it
  // instead would silently drop `gate_verdict` — the very schema this row cares most about.
  walk(
    buildPromptEngineSchema(() => true, 'unused'),
    'prompt_engine',
    seen,
    out
  );
  walk(buildSystemControlSchema(), 'system_control', seen, out);
  walk(resourceManagerInputSchema, 'resource_manager', seen, out);
  return out;
}

describe('nested object schemas refuse an unknown key', () => {
  const objects = reachableObjects();

  it('reaches a non-trivial graph (anti-vacuity)', () => {
    // A walker that returned nothing — a renamed zod internal, say — would make every assertion
    // below pass while examining zero schemas.
    expect(objects.length).toBeGreaterThan(15);
    expect(objects.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        'prompt_engine.gate_verdict|0',
        'prompt_engine.gate_verdict|0.per_gate[]',
        'system_control.config',
      ])
    );
  });

  it('every reachable object is strict, or listed as deliberately open with a reason', () => {
    const unclassified = objects
      .filter((entry) => entry.open && DELIBERATELY_OPEN[entry.path] === undefined)
      .map((entry) => entry.path)
      .sort();

    expect(unclassified).toEqual([]);
  });

  it('every deliberately-open entry is still reachable and still open', () => {
    // The converse. An entry whose object was since made strict, or removed, suppresses a finding
    // that no longer occurs — which reads as coverage while covering nothing.
    const openPaths = new Set(objects.filter((entry) => entry.open).map((entry) => entry.path));
    const satisfied = Object.keys(DELIBERATELY_OPEN)
      .filter((path) => !openPaths.has(path))
      .sort();

    expect(satisfied).toEqual([]);
  });
});

describe('gate_verdict: a misspelled key cannot read as a missing verdict', () => {
  const schema = buildPromptEngineSchema(() => true, 'unused');

  const submission = (perGateEntry: Record<string, unknown>): Record<string, unknown> => ({
    command: '>>demo',
    gate_verdict: { overall: 'PASS', rationale: 'ok', per_gate: [perGateEntry] },
  });

  /** The union member that matched the object — zod nests a union's sub-issues under `errors`. */
  function objectBranchIssues(result: z.ZodSafeParseResult<unknown>): z.core.$ZodIssue[] {
    const union = (result.error?.issues ?? []).find((issue) => issue.code === 'invalid_union');
    const branches = (union as { errors?: z.core.$ZodIssue[][] } | undefined)?.errors ?? [];
    // Branch 0 is the structured object, branch 1 the legacy string — the union's declared order.
    return branches[0] ?? [];
  }

  it('REJECTS the submission rather than accepting it with the verdict absent', () => {
    // The assertion this whole row exists for. Under zod's strip default `pased` vanished and
    // `passed` was simply ABSENT — and an absent boolean is not "unknown", it is the FAIL
    // reading. A misspelling could therefore invert a gate review silently. It cannot now.
    expect(schema.safeParse(submission({ index: 1, pased: true, rationale: 'r' })).success).toBe(
      false
    );
  });

  it('names the path and the key in the issue graph', () => {
    const issues = objectBranchIssues(
      schema.safeParse(submission({ index: 1, pased: true, rationale: 'r' }))
    );
    const unrecognized = issues.find((issue) => issue.code === 'unrecognized_keys');

    expect(unrecognized?.path).toEqual(['per_gate', 0]);
    expect((unrecognized as { keys?: string[] } | undefined)?.keys).toEqual(['pased']);
  });

  it('ALSO reports the required key the typo left absent — the safety half', () => {
    const issues = objectBranchIssues(
      schema.safeParse(submission({ index: 1, pased: true, rationale: 'r' }))
    );

    expect(
      issues.filter(
        (issue) => issue.code === 'invalid_type' && issue.path.join('.') === 'per_gate.0.passed'
      )
    ).toHaveLength(1);
  });

  it('KNOWN LIMIT (as of 2026-09-21): the union flattens the path out of the client message', () => {
    // Stamped, not prose. `gate_verdict` is a union of the structured object and the legacy
    // string, and zod reports a union failure as ONE `invalid_union` issue whose sub-issues live
    // under `errors`. The MCP SDK's `formatIssue` renders only top-level issues, so a client sees
    // `gate_verdict: Invalid input` — correct and safe, but not the path.
    //
    // FLIPS WHEN: `gate_verdict` dispatches on the value's JS type instead of unioning, which was
    // measured to yield `gate_verdict.per_gate.0: Unrecognized key: "pased"` verbatim. Not done
    // here because every mechanism for it either drops the published object shape out of
    // `tools/list` (`z.custom`) or adds a second validation pass — a published-contract call, not
    // a worker's. Returned under concerns.
    const result = schema.safeParse(submission({ index: 1, pased: true, rationale: 'r' }));
    const topLevel = (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

    expect(topLevel).toEqual(['gate_verdict']);
  });

  it('CONTROL: the correctly spelled submission still parses', () => {
    const result = schema.safeParse({
      command: '>>demo',
      gate_verdict: {
        overall: 'PASS',
        rationale: 'ok',
        per_gate: [{ index: 1, passed: true, rationale: 'looks right' }],
        reminders: { satisfied: ['a-gate'], not_applicable: [{ id: 'b-gate', reason: 'n/a' }] },
      },
    });

    expect(result.success).toBe(true);
  });

  it('CONTROL: the legacy STRING verdict shape is untouched', () => {
    // The union's other member. This row narrows the structured object only; the string form is
    // read back by regex and is on its own retirement clock (CLAUDE.md §Public API Contract).
    const result = schema.safeParse({
      command: '>>demo',
      gate_verdict: 'GATE_REVIEW: PASS - looks right',
    });

    expect(result.success).toBe(true);
  });
});

/** A schema-shaped sanity check on the posture detection itself, independent of this repo. */
describe('posture detection', () => {
  it('tells strip, strict and loose apart', () => {
    const probe = (schema: z.ZodType): boolean => {
      const out: ReachableObject[] = [];
      walk(schema, 'x', new Set(), out);
      return out[0]?.open ?? true;
    };

    expect(probe(z.object({ a: z.string() }))).toBe(true); // strip — the silent default
    expect(probe(z.object({ a: z.string() }).passthrough())).toBe(true);
    expect(probe(z.object({ a: z.string() }).strict())).toBe(false);
  });
});
