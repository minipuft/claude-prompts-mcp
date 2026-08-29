/**
 * Integration tests for `script_tool` as a GatePassCriteria type (Tier 6).
 *
 * Sibling of `shell-verify-gate-criteria.test.ts`, and deliberately so: the two
 * criteria types share a validator and differ only in how the thing to run is
 * named. `shell_verify` names a command; `script_tool` names a REGISTERED TOOL.
 * Before Tier 6 that distinction did not exist in the code — both went to
 * `executeProcess({ command: <string> })`, which maps a string to `sh -c`, so a
 * `script_tool_id` was shelled rather than resolved (F10).
 *
 * The load-bearing assertion is negative: a gate naming `echo hi` must NOT
 * produce the output of a shell. A positive-only test cannot tell a resolved
 * tool from a lucky shell.
 *
 * Classification: Integration (real GateValidator, real ScriptExecutor, real
 * subprocess; the tool registry is a stub because gate criteria are the subject,
 * not tool discovery).
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { validateGateSchema } from '../../../src/engine/gates/core/gate-schema.js';
import { runGateScriptToolVerifications } from '../../../src/engine/gates/services/gate-script-tool-runner.js';
import { runScriptToolCriterion } from '../../../src/engine/gates/services/script-tool-criterion-runner.js';
import { resolveGroundTruthCoverage } from '../../../src/engine/execution/pipeline/decisions/gates/ground-truth-coverage.js';
import { createScriptExecutor } from '../../../src/modules/automation/execution/script-executor.js';

import type { ScriptLoader } from '../../../src/engine/execution/reference/script-reference-resolver.js';
import type { GateDefinitionProvider } from '../../../src/engine/gates/core/gate-loader.js';
import type {
  GatePassCriteria,
  LightweightGateDefinition,
} from '../../../src/engine/gates/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { LoadedScriptTool } from '../../../src/shared/types/index.js';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'fixtures'
);

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function verdictTool(overrides: Partial<LoadedScriptTool> = {}): LoadedScriptTool {
  return {
    id: 'verdict_tool',
    name: 'Verdict Tool',
    description: 'Emits a structured gate verdict',
    scriptPath: 'gate-verdict.cjs',
    runtime: 'node',
    inputSchema: { type: 'object', properties: { verdict: { type: 'string' } } },
    toolDir: FIXTURE_DIR,
    absoluteScriptPath: path.join(FIXTURE_DIR, 'gate-verdict.cjs'),
    promptId: 'gate_owner',
    descriptionContent: '',
    execution: { trigger: 'always', confirm: false },
    ...overrides,
  } as unknown as LoadedScriptTool;
}

/** Registry stub: knows exactly the tools it is handed, by id. */
function loaderFor(...tools: LoadedScriptTool[]): ScriptLoader {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  return {
    scriptExists: (id: string) => byId.has(id),
    loadScript: (id: string) => byId.get(id),
    getSearchedPaths: () => [FIXTURE_DIR],
  };
}

function gateWith(criteria: Record<string, unknown>): LightweightGateDefinition {
  return {
    id: 'script-tool-gate',
    name: 'Script Tool Gate',
    type: 'validation',
    description: 'Gate under test',
    pass_criteria: [criteria],
  } as unknown as LightweightGateDefinition;
}

function loaderProviderFor(gate: LightweightGateDefinition): GateDefinitionProvider {
  return {
    loadGate: async (id: string) => (id === gate.id ? gate : null),
    discoverGates: async () => [gate.id],
    getLoadedGates: () => [gate],
    reload: async () => {},
    isLoaded: (id: string) => id === gate.id,
    getCacheStats: () => ({ hits: 0, misses: 0, size: 1 }),
  } as unknown as GateDefinitionProvider;
}

describe('script_tool gate criteria', () => {
  let scriptTools: () => {
    loader: ScriptLoader;
    executor: ReturnType<typeof createScriptExecutor>;
  };

  beforeEach(() => {
    const executor = createScriptExecutor({ debug: false });
    scriptTools = () => ({ loader: loaderFor(verdictTool()), executor });
  });

  // The rule itself, tested where it is defined. `runScriptToolCriterion` is the single
  // encoding of "what does a script_tool criterion mean"; the gate-review runner is one
  // projection of it. Testing the rule here and the projection below keeps a fix to one
  // from silently missing the other.
  describe('the criterion rule', () => {
    // 6.1 stated negatively, with a SIDE EFFECT as the observable.
    //
    // A verdict alone cannot distinguish "resolved nothing" from "shelled the string and
    // the shell failed": before Tier 6 an unparseable `sh -c` result already produced a
    // failure, so asserting the verdict passes for the wrong reason. The sentinel file
    // exists only if a shell actually ran the criteria value.
    test('an id that looks like a shell command does not run a shell', async () => {
      const sentinel = path.join(mkdtempSync(path.join(tmpdir(), 'script-tool-gate-')), 'shelled');

      const outcome = await runScriptToolCriterion(
        { type: 'script_tool', script_tool_id: `touch ${sentinel}` } as GatePassCriteria,
        scriptTools()
      );

      expect(existsSync(sentinel)).toBe(false);
      expect(outcome.passed).toBe(false);
      expect(outcome.unrunnable).toBe(true);
    }, 20000);

    test('a registered id runs THAT tool', async () => {
      const outcome = await runScriptToolCriterion(
        {
          type: 'script_tool',
          script_tool_id: 'verdict_tool',
          script_tool_input: { verdict: 'pass' },
        } as GatePassCriteria,
        scriptTools()
      );

      expect(outcome.passed).toBe(true);
      // The marker proves the verdict came from the fixture, not from a shell.
      expect(JSON.stringify(outcome.scriptOutput ?? {})).toContain('gate-verdict.cjs');
    }, 20000);

    test('a tool reporting failure fails the criterion without being unrunnable', async () => {
      const outcome = await runScriptToolCriterion(
        {
          type: 'script_tool',
          script_tool_id: 'verdict_tool',
          script_tool_input: { verdict: 'nope' },
        } as GatePassCriteria,
        scriptTools()
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.unrunnable).toBe(false);
    }, 20000);

    // 6.2 — an unrunnable verification is not a verification. The load gate refuses an
    // id-less criterion, so this covers the paths only reachable at run time.
    test('a missing id is unrunnable rather than passing', async () => {
      const outcome = await runScriptToolCriterion(
        { type: 'script_tool' } as GatePassCriteria,
        scriptTools()
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.unrunnable).toBe(true);
    });

    test('no wired runtime fails closed rather than passing', async () => {
      const outcome = await runScriptToolCriterion(
        { type: 'script_tool', script_tool_id: 'verdict_tool' } as GatePassCriteria,
        undefined
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.unrunnable).toBe(true);
    });

    // The control Tier 3 established, applied to gate criteria: a gate is not a caller and
    // has no channel through which a confirm-required tool could be approved.
    test('a confirm-required tool is refused rather than run', async () => {
      const guarded = verdictTool({
        id: 'guarded_verdict',
        execution: { trigger: 'always', confirm: true },
      } as Partial<LoadedScriptTool>);

      const outcome = await runScriptToolCriterion(
        { type: 'script_tool', script_tool_id: 'guarded_verdict' } as GatePassCriteria,
        { loader: loaderFor(guarded), executor: createScriptExecutor({ debug: false }) }
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.unrunnable).toBe(true);
      expect(outcome.reason).toContain('confirmation');
    });
  });

  // F11 — was a characterization of inertness; now the liveness assertion.
  //
  // Before 2026-08-19 Stage 20, the only live consumer of `pass_criteria`, filtered for
  // `shell_verify`, so a gate declaring `script_tool` cleared review having verified
  // nothing and said nothing about it. These tests pin the fix at the runner Stage 20
  // actually calls — the layer where the type was dead — rather than only at
  // GateValidator, whose entry chain still has no production caller.
  describe('F11 — the live gate-review path runs script_tool', () => {
    const providerFor = (gate: LightweightGateDefinition): GateDefinitionProvider =>
      ({
        ...loaderProviderFor(gate),
        loadGates: async (ids: string[]) => (ids.includes(gate.id) ? [gate] : []),
      }) as unknown as GateDefinitionProvider;

    test('runs the registered tool and reports its verdict', async () => {
      const gate = gateWith({
        type: 'script_tool',
        script_tool_id: 'verdict_tool',
        script_tool_input: { verdict: 'pass' },
      });

      const results = await runGateScriptToolVerifications(
        [gate.id],
        providerFor(gate),
        scriptTools()
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.passed).toBe(true);
      expect(results[0]?.toolId).toBe('verdict_tool');
      // The marker proves the verdict came from the fixture, not from a shell.
      expect(JSON.stringify(results[0]?.scriptOutput ?? {})).toContain('gate-verdict.cjs');
    }, 20000);

    test('a failing verdict produces a failing result, not an absent one', async () => {
      const gate = gateWith({
        type: 'script_tool',
        script_tool_id: 'verdict_tool',
        script_tool_input: { verdict: 'nope' },
      });

      const results = await runGateScriptToolVerifications(
        [gate.id],
        providerFor(gate),
        scriptTools()
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.passed).toBe(false);
      expect(results[0]?.unrunnable).toBe(false);
    }, 20000);

    // The load gate below refuses an id-less criterion, but a criterion naming an
    // unknown tool is only detectable at run time. It must produce a FAILING row rather
    // than no row: coverage clears a review when every required gate is covered by a
    // passing result, so a silently absent row is indistinguishable from success.
    test('an unrunnable criterion yields a failing row rather than silence', async () => {
      const gate = gateWith({ type: 'script_tool', script_tool_id: 'no_such_tool' });

      const results = await runGateScriptToolVerifications(
        [gate.id],
        providerFor(gate),
        scriptTools()
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.passed).toBe(false);
      expect(results[0]?.unrunnable).toBe(true);
      expect(results[0]?.reason).toContain('not a shell command');
    });

    test('a gate with no script_tool criteria contributes nothing', async () => {
      const gate = gateWith({ type: 'shell_verify', shell_command: ['true'] });

      const results = await runGateScriptToolVerifications(
        [gate.id],
        providerFor(gate),
        scriptTools()
      );

      expect(results).toEqual([]);
    });
  });

  // Ported from `shell-verify-gate-criteria.test.ts`, deleted with GateValidator.
  //
  // `llm_self_check` is reserved: no runner exists anywhere. It used to reach GateValidator's
  // auto-pass stub, which returned `passed: true` with a skip message — that stub is gone, so
  // the property worth protecting is the one that keeps a reserved type from CLEARING a
  // review: it contributes no ground-truth result, and coverage clears only gates covered by
  // a passing one. Silence must read as "not verified", never as "verified".
  describe('a reserved criteria type cannot clear a review', () => {
    test('contributes no ground-truth result, so coverage is not satisfied', async () => {
      const gate = gateWith({ type: 'llm_self_check', prompt_template: 'Assess depth' });
      const provider = {
        ...loaderProviderFor(gate),
        loadGates: async (ids: string[]) => (ids.includes(gate.id) ? [gate] : []),
      } as unknown as GateDefinitionProvider;

      const results = await runGateScriptToolVerifications([gate.id], provider, scriptTools());
      const coverage = resolveGroundTruthCoverage({
        requiredGateIds: [gate.id],
        results,
      });

      expect(results).toEqual([]);
      expect(coverage.satisfied).toBe(false);
    });

    test('the schema still accepts the type, so existing gate files keep loading', () => {
      const result = validateGateSchema(
        {
          id: 'probe',
          name: 'Probe',
          type: 'validation',
          description: 'load probe',
          pass_criteria: [{ type: 'llm_self_check', prompt_template: 'Assess depth' }],
        },
        'probe'
      );

      expect(result.valid).toBe(true);
    });
  });

  // "Refuse at load": a declared criterion that cannot be enforced is rejected where the
  // author is looking, instead of failing closed mid-review where they are not.
  describe('load-time refusal of unenforceable criteria', () => {
    const gateYaml = (criteria: Record<string, unknown>): Record<string, unknown> => ({
      id: 'probe',
      name: 'Probe',
      type: 'validation',
      description: 'load probe',
      pass_criteria: [criteria],
    });

    test('refuses script_tool with no script_tool_id', () => {
      const result = validateGateSchema(gateYaml({ type: 'script_tool' }), 'probe');

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('script_tool_id');
    });

    test('refuses script_tool whose id is blank', () => {
      const result = validateGateSchema(
        gateYaml({ type: 'script_tool', script_tool_id: '  ' }),
        'probe'
      );

      expect(result.valid).toBe(false);
    });

    test('refuses shell_verify with no shell_command', () => {
      const result = validateGateSchema(gateYaml({ type: 'shell_verify' }), 'probe');

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('shell_command');
    });

    // Row 1.8. The string form is not merely discouraged — a gate file carrying one
    // fails to load, which is the only place the author is looking.
    test('refuses a shell_command written as a bare string', () => {
      const result = validateGateSchema(
        gateYaml({ type: 'shell_verify', shell_command: 'npm test' }),
        'probe'
      );

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('argv');
    });

    test('refuses an empty argv array', () => {
      const result = validateGateSchema(
        gateYaml({ type: 'shell_verify', shell_command: [] }),
        'probe'
      );

      expect(result.valid).toBe(false);
    });

    // POSITIVE CONTROL: the three refusals above would all hold against a schema that
    // rejected every shell_verify criterion.
    test('accepts a well-formed argv shell_command', () => {
      const result = validateGateSchema(
        gateYaml({ type: 'shell_verify', shell_command: ['npm', 'test'] }),
        'probe'
      );

      expect(result.valid).toBe(true);
    });

    test('accepts a well-formed script_tool criterion', () => {
      const result = validateGateSchema(
        gateYaml({ type: 'script_tool', script_tool_id: 'verdict_tool' }),
        'probe'
      );

      expect(result.valid).toBe(true);
    });
  });
});
