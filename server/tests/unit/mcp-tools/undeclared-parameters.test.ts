/**
 * One refusal, three tools: an argument key no contract declares.
 *
 * The defect this pins is a SILENT SUCCESS. Measured on `f711401b` over both transports,
 * `prompt_engine {command, force_restrt:true}` and `system_control {action:"status", previw:true}`
 * both answered `isError:false` with a normal result, because zod strips an unknown key before the
 * registered callback runs. A caller that misspells a safety flag — `dry_run`, `preview`,
 * `confirm` — therefore gets a success reply while the server performed the unguarded action.
 *
 * Every assertion here names WHICH half answered (undeclared / declared-but-unavailable) rather
 * than checking for a non-null string, so a refusal whose cause moves cannot keep these green.
 *
 * The control is enumerated from the contract JSON, not from a hand-kept list: a refusal that
 * rejected a declared parameter would be the same defect pointed the other way, and a control
 * built from the same table the implementation reads could not see that.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, jest } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import { McpToolRouter } from '../../../src/mcp/tools/index.js';
import type { PromptExecutor } from '../../../src/mcp/tools/prompt-engine/core/prompt-executor.js';
import type { PromptEngineInput } from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';

import {
  DECLARED_PARAMETERS_BY_TOOL,
  GATE_PARAMETERS_UNAVAILABLE,
  describeUndeclaredParameterRefusal,
  type ContractToolName,
} from '../../../src/mcp/tools/shared/undeclared-parameters.js';
import {
  declaredKeysAt,
  describeNestedSchemaRefusal,
  formatKeyPath,
  nearestDeclaredParameter,
} from '../../../src/shared/utils/nested-key-refusal.js';
import {
  gateVerdictSubmissionSchema,
  buildPromptEngineSchema,
} from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';
import {
  gatePassCriteriaSchema,
  resourceManagerInputSchema,
} from '../../../src/mcp/tools/schemas/resource-manager.schema.js';

import type { SemanticEvaluationReport } from '../../../src/shared/types/gate-evaluation.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONTRACT_FILE: Readonly<Record<ContractToolName, string>> = {
  prompt_engine: 'prompt-engine.json',
  system_control: 'system-control.json',
  resource_manager: 'resource-manager.json',
};

/** Parameter names straight out of the contract JSON — the client-visible surface. */
function contractParameterNames(tool: ContractToolName): string[] {
  const raw = readFileSync(
    path.join(SERVER_ROOT, 'tooling', 'contracts', CONTRACT_FILE[tool]),
    'utf8'
  );
  const parsed = JSON.parse(raw) as { parameters?: { name: string }[] };
  return (parsed.parameters ?? []).map((parameter) => parameter.name);
}

const TOOLS = Object.keys(CONTRACT_FILE) as ContractToolName[];

describe('undeclared parameter refusal', () => {
  describe.each(TOOLS)('%s', (tool) => {
    it('refuses a planted key BY NAME, and says it is not a parameter of this tool', () => {
      const message = describeUndeclaredParameterRefusal(tool, { totally_made_up_key: 1 });

      expect(message).toContain("'totally_made_up_key'");
      expect(message).toContain(`is not a parameter of ${tool}`);
    });

    it('CONTROL: every parameter the contract declares still passes', () => {
      // Enumerated from the JSON so a refusal narrower than the published surface fails here.
      const args = Object.fromEntries(contractParameterNames(tool).map((name) => [name, 'value']));

      expect(describeUndeclaredParameterRefusal(tool, args)).toBeNull();
    });

    it('CONTROL: the declared set is the contract, both directions', () => {
      const declared = [...DECLARED_PARAMETERS_BY_TOOL[tool]].sort();

      expect(declared).toEqual(contractParameterNames(tool).sort());
    });

    it('ignores a key that was never SENT (an in-process `undefined`)', () => {
      // JSON has no `undefined`, so nothing over MCP reaches here this way; an in-process caller
      // building its argument object with an unset optional field does, and refusing that would
      // refuse a key nobody sent. A JSON `null` IS a value, which the next case pins.
      expect(describeUndeclaredParameterRefusal(tool, { made_up: undefined })).toBeNull();
      expect(describeUndeclaredParameterRefusal(tool, { made_up: null })).toContain("'made_up'");
    });
  });

  it('names EVERY undeclared key in one message, in the order they were sent', () => {
    const message = describeUndeclaredParameterRefusal('system_control', {
      action: 'status',
      first_bogus: 1,
      second_bogus: 2,
    });

    expect(message).toContain(
      "'first_bogus' and 'second_bogus' are not parameters of system_control"
    );
  });

  describe('nearest declared name', () => {
    it('suggests the contract spelling of a camelCase key (enforcementMode)', () => {
      // The case R50 names. `gate_builder/script.py` already remaps this by hand, which is what a
      // silent strip cost the last time: the tool had to learn the correction out of band.
      expect(
        nearestDeclaredParameter('enforcementMode', DECLARED_PARAMETERS_BY_TOOL.resource_manager)
      ).toBe('enforcement_mode');
    });

    it('suggests across a one-character typo, inside the refusal message', () => {
      const message = describeUndeclaredParameterRefusal('prompt_engine', {
        command: '>>demo',
        force_restrt: true,
      });

      expect(message).toContain("Did you mean 'force_restart'?");
    });

    it('offers NOTHING when no declared name is close', () => {
      // A wrong guess sends the caller to re-send under a name they never wanted, so the
      // suggestion has to be able to decline.
      const message = describeUndeclaredParameterRefusal('prompt_engine', { zzzzzzzzzzzz: 1 });

      expect(message).not.toContain('Did you mean');
      expect(
        nearestDeclaredParameter('zzzzzzzzzzzz', DECLARED_PARAMETERS_BY_TOOL.prompt_engine)
      ).toBeUndefined();
    });
  });

  describe('declared but not advertised (the prompt_engine union)', () => {
    it('says the gate system is off — NOT "not a parameter"', () => {
      // `gate_verdict` IS in the contract (CLAUDE.md §Public API Contract: the tool surface is a
      // union, and gates/verdict are advertised only while gates are enabled). Telling its
      // sender it is not a parameter would be false, and would send them to fix a spelling that is
      // already right.
      const message = describeUndeclaredParameterRefusal(
        'prompt_engine',
        { command: '>>demo', gate_verdict: { overall: 'PASS', rationale: 'ok' } },
        GATE_PARAMETERS_UNAVAILABLE
      );

      expect(message).toContain("'gate_verdict' is a parameter of prompt_engine");
      expect(message).toContain('the gate system is disabled');
      expect(message).not.toContain('is not a parameter');
    });

    it('CONTROL: the same key passes once the state advertises it', () => {
      expect(
        describeUndeclaredParameterRefusal('prompt_engine', {
          command: '>>demo',
          gate_verdict: { overall: 'PASS', rationale: 'ok' },
        })
      ).toBeNull();
    });

    it('every unavailable name is a DECLARED one', () => {
      // An "unavailable" key the contract does not name would be a second undeclared class wearing
      // the wrong message.
      for (const name of GATE_PARAMETERS_UNAVAILABLE.keys()) {
        expect(DECLARED_PARAMETERS_BY_TOOL.prompt_engine.has(name)).toBe(true);
      }
    });
  });
});

describe('registered prompt_engine action admission', () => {
  async function registered(enabled: boolean) {
    const server = new McpServer({ name: 'action-admission-test', version: '1' });
    const registrations = jest.spyOn(server, 'registerTool');
    const execute = jest.fn<PromptExecutor['executePromptCommand']>().mockResolvedValue({
      content: [{ type: 'text', text: 'executor reached' }],
      isError: false,
    });
    let current = enabled;
    // Skip initialize's persistence/I/O; keep the real router registration, schema and admission.
    const router = Object.create(McpToolRouter.prototype) as McpToolRouter;
    Object.assign(router, {
      logger: { info() {}, warn() {}, debug() {}, error() {} },
      mcpServer: server,
      promptExecutor: { executePromptCommand: execute },
      gateStateStore: { isGateSystemEnabled: () => current },
    });
    await router.registerAllTools(server);
    const registration = registrations.mock.calls.find(([name]) => name === 'prompt_engine');
    if (registration === undefined) throw new Error('prompt_engine was not registered');
    const schema = registration[1].inputSchema;
    if (!(schema instanceof z.ZodObject))
      throw new Error('prompt_engine schema is not a ZodObject');
    const callback = registration[2] as (
      args: PromptEngineInput,
      extra: unknown
    ) => ReturnType<PromptExecutor['executePromptCommand']>;
    return {
      execute,
      server,
      call: (args: object) => callback(schema.parse(args), {}),
      setEnabled: (value: boolean) => {
        current = value;
      },
    };
  }

  it.each(['retry', 'skip'])(
    'refuses gates-off %s by name before the executor',
    async (gate_action) => {
      const fixture = await registered(false);
      try {
        const result = await fixture.call({ chain_id: 'chain-demo#1', gate_action });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
          expect.objectContaining({
            text: expect.stringContaining(`gate_action:"${gate_action}"`),
          }),
        ]);
        expect(JSON.stringify(result.content)).toContain(
          'unavailable while the gate system is disabled'
        );
        expect(fixture.execute).not.toHaveBeenCalled();
      } finally {
        await fixture.server.close();
      }
    }
  );

  it.each(['abort', 'resume', 'accept_alternative'] as const)(
    'admits gates-off %s to the executor unchanged',
    async (gate_action) => {
      const fixture = await registered(false);
      try {
        const result = await fixture.call({ chain_id: 'chain-demo#1', gate_action });
        expect(result.isError).toBe(false);
        expect(fixture.execute).toHaveBeenCalledWith(
          { chain_id: 'chain-demo#1', gate_action },
          expect.anything()
        );
      } finally {
        await fixture.server.close();
      }
    }
  );

  it.each(['gates', 'gate_verdict'])(
    'still refuses unavailable %s from cached input',
    async (key) => {
      const fixture = await registered(true);
      fixture.setEnabled(false);
      try {
        const value = key === 'gates' ? ['some-gate'] : { overall: 'PASS', rationale: 'ok' };
        const result = await fixture.call({ chain_id: 'chain-demo#1', [key]: value });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain(
          `'${key}' is a parameter of prompt_engine`
        );
        expect(fixture.execute).not.toHaveBeenCalled();
      } finally {
        await fixture.server.close();
      }
    }
  );

  it('checks current gate state on a cached schema in both toggle directions', async () => {
    const fixture = await registered(true);
    try {
      fixture.setEnabled(false);
      expect((await fixture.call({ chain_id: 'chain-demo#1', gate_action: 'retry' })).isError).toBe(
        true
      );
      expect(fixture.execute).not.toHaveBeenCalled();
      fixture.setEnabled(true);
      expect((await fixture.call({ chain_id: 'chain-demo#1', gate_action: 'retry' })).isError).toBe(
        false
      );
      expect(fixture.execute).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.server.close();
    }
  });
});

/**
 * The same class one level down: a key a NESTED object does not declare (P4.103).
 *
 * The top-level refusal names a key because the key ARRIVES. Inside a parameter, zod does the
 * refusing, and its default message names neither the key's full path nor a correction.
 * `gate_verdict` is the object that matters: it is the safety-review submission, and
 * `{pased: true}` also leaves `passed` absent, which reads as FAIL.
 */
describe('nested key refusal (P4.103)', () => {
  const parse = (value: unknown): { ok: boolean; message: string } => {
    const schema = buildPromptEngineSchema();
    const result = schema.safeParse({ command: '>>demo', gate_verdict: value });
    return {
      ok: result.success,
      // The SDK prefixes each top-level issue with its path.
      message: result.success
        ? ''
        : result.error.issues
            .map((issue) => {
              const path = issue.path.filter(
                (segment): segment is string | number =>
                  typeof segment === 'string' || typeof segment === 'number'
              );
              return `${formatKeyPath(path)}: ${issue.message}`;
            })
            .join('\n'),
    };
  };

  describe('formatKeyPath', () => {
    it('writes a path the way a caller would write it', () => {
      expect(formatKeyPath(['gate_verdict', 'per_gate', 0, 'pased'])).toBe(
        'gate_verdict.per_gate[0].pased'
      );
    });

    it('differs from the SDK rendering it replaces', () => {
      // `formatIssue` joins every segment with '.', which turns an index into `per_gate.0` — a
      // readable string that is not a path anyone can paste back into their JSON. Pinning the
      // difference is what stops someone "simplifying" this back to a join.
      expect(formatKeyPath(['per_gate', 0])).not.toBe(['per_gate', 0].join('.'));
    });
  });

  describe('declaredKeysAt', () => {
    it('resolves the key space of an object nested under an array', () => {
      expect(declaredKeysAt(gateVerdictSubmissionSchema, ['per_gate', 0])).toEqual([
        'index',
        'passed',
        'rationale',
        'evaluation',
      ]);
    });

    it('sees through optional wrappers', () => {
      expect(declaredKeysAt(gateVerdictSubmissionSchema, ['reminders'])).toEqual([
        'satisfied',
        'not_applicable',
      ]);
    });

    it('answers undefined where the position is not an object', () => {
      // A suggestion needs a declared key space. Where there is none, a refusal with no
      // suggestion is the correct answer — a guessed one sends the caller to a name they never
      // wanted.
      expect(declaredKeysAt(gateVerdictSubmissionSchema, ['rationale'])).toBeUndefined();
      expect(declaredKeysAt(gateVerdictSubmissionSchema, ['per_gate', 0, 'index'])).toBeUndefined();
    });

    it('CONTROL: the root itself resolves, so the walker is not answering undefined always', () => {
      expect(declaredKeysAt(gateVerdictSubmissionSchema, [])).toEqual([
        'overall',
        'rationale',
        'per_gate',
        'reminders',
      ]);
    });
  });

  describe('describeNestedSchemaRefusal', () => {
    it('names the full path and the nearest declared key', () => {
      const message = describeNestedSchemaRefusal(
        ['gate_verdict'],
        [
          {
            code: 'unrecognized_keys',
            path: ['per_gate', 0],
            keys: ['pased'],
            message: 'Unrecognized key: "pased"',
          },
        ],
        gateVerdictSubmissionSchema
      );

      expect(message).toContain("'gate_verdict.per_gate[0].pased' is not a declared key");
      expect(message).toContain("did you mean 'passed'?");
    });

    it('says only what is true of a non-key failure', () => {
      // "It was dropped and ignored before" is true of a stripped key and of nothing else. A
      // wrong enum member was always reported.
      const message = describeNestedSchemaRefusal(
        ['gate_verdict'],
        [{ code: 'invalid_value', path: ['overall'], message: 'Invalid option' }],
        gateVerdictSubmissionSchema
      );

      expect(message).toContain("'gate_verdict.overall': Invalid option");
      expect(message).not.toContain('dropped and ignored');
    });
  });

  describe('through the registered schema', () => {
    it('CONTROL: a well-formed structured verdict is accepted', () => {
      // Without this every rejection below could be a schema that rejects everything.
      expect(parse({ overall: 'PASS', rationale: 'all good' }).ok).toBe(true);
    });

    it('a misspelled nested key reaches the client with its path and a suggestion', () => {
      const { ok, message } = parse({
        overall: 'FAIL',
        rationale: 'not good',
        per_gate: [{ index: 1, pased: false, rationale: 'nope' }],
      });

      expect(ok).toBe(false);
      // The whole point: before this, the message was the string 'Invalid input'.
      expect(message).toContain("'gate_verdict.per_gate[0].pased' is not a declared key");
      expect(message).toContain("did you mean 'passed'?");
      expect(message).not.toBe('Invalid input');
    });

    it('a misspelled key two levels down resolves its own key space', () => {
      const { ok, message } = parse({
        overall: 'PASS',
        rationale: 'ok',
        reminders: { satisfeid: ['g'] },
      });

      expect(ok).toBe(false);
      expect(message).toContain("'gate_verdict.reminders.satisfeid' is not a declared key");
      expect(message).toContain("did you mean 'satisfied'?");
    });

    it('a string is refused with the object to resend, not zod\'s bare "expected object"', () => {
      const { ok, message } = parse('GATE_REVIEW: PASS - fine');

      expect(ok).toBe(false);
      expect(message).toContain('gate_verdict takes the structured object, not a string.');
      expect(message).toContain('"overall": "PASS"|"FAIL"');
      expect(message).toContain('"per_gate"');
      expect(message).not.toContain('expected object');
      expect(message).not.toContain('is not a declared key');
    });

    it('any other non-object kind is named the same way', () => {
      expect(parse(42).message).toContain(
        'gate_verdict takes the structured object, not a number.'
      );
      expect(parse([]).message).toContain('not an array.');
      expect(parse(null).message).toContain('not null.');
    });

    it('pass_criteria carries no `description` — the fork is SURPLUS, not a missing declaration', () => {
      // P4.103's three-fork question. Two fixtures sent it and believed they had written a
      // criterion description. Nothing reads one: zero reader sites under `engine/gates/` against
      // 18 for `shell_command`, no bundled gate.yaml declares it, and the skills-sync manifest's
      // `description` is the per-GATE field. Declaring it would publish a key that goes nowhere.
      const declared = declaredKeysAt(gatePassCriteriaSchema, []);
      // Positive control on the same schema: it DOES declare the keys a criterion is made of, so
      // the absence below is a statement about `description` rather than about the probe.
      expect(declared).toContain('type');
      expect(declared).toContain('shell_command');
      expect(declared).not.toContain('description');
    });
  });

  describe('semantic reports through the registered schema', () => {
    const evaluation: SemanticEvaluationReport = {
      binding: {
        gate_id: 'semantic-gate',
        node_id: 'node-1',
        attempt_id: 'attempt-1',
        definition_digest: 'definition-digest',
        target_digest: 'target-digest',
      },
      observations: [
        {
          criterion_id: 'preserves-contract',
          state: 'met',
          value: true,
          evidence: [{ target_digest: 'target-digest', start: 0, end: 3, quote: 'The' }],
          rationale: 'Evidence supports the result.\nReport rationale may span lines.',
        },
      ],
    };
    const verdict = (report: unknown) => ({
      overall: 'PASS',
      rationale: 'Reviewed',
      per_gate: [{ index: 1, passed: true, rationale: 'Criterion met', evaluation: report }],
    });

    it.each([
      undefined,
      { provenance: 'unknown' as const },
      { provenance: 'client_reported' as const },
      {
        provenance: 'client_reported' as const,
        provider: ' claimed-provider ',
        model: 'claimed-model',
        revision: 'claimed-revision',
        context: 'isolated_judge' as const,
      },
      ...(['self', 'separate_pass', 'unknown'] as const).map((context) => ({
        provenance: 'unknown' as const,
        context,
      })),
    ])('retains the rich report with optional reviewer %j', (reviewer) => {
      const report = { ...evaluation, ...(reviewer === undefined ? {} : { reviewer }) };
      const schema = buildPromptEngineSchema();
      const parsed = schema.parse({ command: '>>demo', gate_verdict: verdict(report) });
      expect(parsed['gate_verdict']).toEqual(verdict(report));
      if (reviewer === undefined)
        expect(parsed).not.toHaveProperty('gate_verdict.per_gate.0.evaluation.reviewer');
    });

    it('rejects submitted host_verified reviewer provenance with its addressed path', () => {
      const result = parse(verdict({ ...evaluation, reviewer: { provenance: 'host_verified' } }));

      expect(result.ok).toBe(false);
      expect(result.message).toContain('gate_verdict.per_gate[0].evaluation.reviewer.provenance');
    });

    it.each([
      null,
      [],
      'unknown',
      {},
      { provenance: 'other' },
      { provenance: 'client_reported', provider: ' \t\n' },
      { provenance: 'client_reported', model: '' },
      { provenance: 'unknown', revision: ' ' },
      { provenance: 'client_reported', provider: 42 },
      { provenance: 'client_reported', model: null },
      { provenance: 'unknown', revision: [] },
      { provenance: 'client_reported', context: 'host' },
      { provenance: 'client_reported', extra: 'authority' },
    ])('rejects malformed reviewer shape %j', (reviewer) => {
      const result = parse(verdict({ ...evaluation, reviewer }));

      expect(result.ok).toBe(false);
      expect(result.message).toContain('gate_verdict.per_gate[0].evaluation.reviewer');
    });

    it.each([
      ['report', { ...evaluation, extra: true }, 'extra'],
      [
        'binding',
        { ...evaluation, binding: { ...evaluation.binding, extra: true } },
        'binding.extra',
      ],
      [
        'observation',
        { ...evaluation, observations: [{ ...evaluation.observations[0], extra: true }] },
        'observations[0].extra',
      ],
      [
        'evidence',
        {
          ...evaluation,
          observations: [
            {
              ...evaluation.observations[0],
              evidence: [{ target_digest: 'target-digest', start: 0, end: 3, extra: true }],
            },
          ],
        },
        'observations[0].evidence[0].extra',
      ],
      [
        'reviewer',
        { ...evaluation, reviewer: { provenance: 'unknown', extra: true } },
        'reviewer.extra',
      ],
    ])('strictly rejects an undeclared %s key with its addressed path', (_name, report, path) => {
      const result = parse(verdict(report));

      expect(result.ok).toBe(false);
      expect(result.message).toContain(
        `'gate_verdict.per_gate[0].evaluation.${path}' is not a declared key`
      );
    });

    it.each([
      null,
      {},
      { ...evaluation, binding: { ...evaluation.binding, attempt_id: ' ' } },
      { ...evaluation, observations: [{ ...evaluation.observations[0], state: 'PASS' }] },
      ...[NaN, Infinity, -Infinity, null].map((value) => ({
        ...evaluation,
        observations: [{ ...evaluation.observations[0], value }],
      })),
      ...[
        { start: -1, end: 3 },
        { start: 0.5, end: 3 },
        { start: 0, end: -1 },
        { start: 0, end: Infinity },
        { start: 0, end: 3, quote: 5 },
      ].map((span) => ({
        ...evaluation,
        observations: [
          {
            ...evaluation.observations[0],
            evidence: [{ target_digest: 'target-digest', ...span }],
          },
        ],
      })),
    ])('rejects malformed semantic report %j', (report) => {
      expect(parse(verdict(report)).ok).toBe(false);
    });

    it.each([
      { state: 'met', value: true },
      { state: 'unmet', value: 'poor' },
      { state: 'met', value: 3.5 },
      { state: 'insufficient_evidence' },
      { state: 'not_applicable' },
    ])('accepts the declared observation vocabulary %j without adjudicating it', (fields) => {
      const { value: _value, ...withoutValue } = evaluation.observations[0] ?? {};
      expect(
        parse(verdict({ ...evaluation, observations: [{ ...withoutValue, ...fields }] })).ok
      ).toBe(true);
    });
  });
});

/**
 * P4.121 — the same refusal for a strict object with no union around it: `resource_manager`'s
 * `evaluation`. Zod hands the object's own `error` callback the `unrecognized_keys` issue with an
 * absolute path, so `refuseUndeclaredNestedKeys` reuses `describeNestedSchemaRefusal` rather than
 * adding a second message. Parsed through the REGISTERED root, so the path is the one a client
 * sees, not one this test assembled.
 */
describe('nested key refusal on a strict object (P4.121)', () => {
  const parseGate = (evaluation: unknown): { ok: boolean; messages: string[] } => {
    const result = resourceManagerInputSchema.safeParse({
      resource_type: 'gate',
      action: 'update',
      id: 'g',
      evaluation,
    });
    return {
      ok: result.success,
      messages: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  };

  it('CONTROL: a well-formed block is accepted', () => {
    expect(parseGate({ mode: 'judge', model: 'haiku', strict: true }).ok).toBe(true);
  });

  it('a misspelled key names its full path and the nearest declared key', () => {
    const { ok, messages } = parseGate({ mode: 'judge', stirct: true });

    expect(ok).toBe(false);
    // No "dropped and ignored before" line: `evaluation` was strict from its first release, so
    // that sentence was never true of it (P4.135 — the adapter now serves every strict object).
    expect(messages).toEqual([
      "'evaluation.stirct' is not a declared key — did you mean 'strict'?",
    ]);
  });

  it("a wrong-typed value keeps zod's own path message — the override answers dropped keys only", () => {
    const { ok, messages } = parseGate({ mode: 'judge', strict: 'yes' });

    expect(ok).toBe(false);
    expect(messages).toEqual(['Invalid input: expected boolean, received string']);
  });

  it('a block without mode is refused, because it would not load', () => {
    expect(parseGate({ model: 'haiku' }).ok).toBe(false);
  });
});
