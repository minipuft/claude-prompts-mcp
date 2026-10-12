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
import {
  formatGateScriptToolSection,
  runGateScriptToolVerifications,
} from '../../../src/engine/gates/services/gate-script-tool-runner.js';
import { runScriptToolCriterion } from '../../../src/engine/gates/services/script-tool-criterion-runner.js';
import { resolveGroundTruthCoverage } from '../../../src/engine/execution/pipeline/decisions/gates/ground-truth-coverage.js';
import { createScriptExecutor } from '../../../src/modules/automation/execution/script-executor.js';

import type { ScriptToolRuntime } from '../../../src/engine/gates/services/script-tool-criterion-runner.js';
import type { ScriptLoader } from '../../../src/engine/execution/reference/script-reference-resolver.js';
import type { GateDefinitionProvider } from '../../../src/engine/gates/core/gate-loader.js';
import type {
  GatePassCriteria,
  LightweightGateDefinition,
} from '../../../src/engine/gates/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type {
  LoadedScriptTool,
  ScriptExecutionRequest,
  ScriptExecutionResult,
  ScriptExecutorPort,
} from '../../../src/shared/types/index.js';
import type { GateScriptToolResult } from '../../../src/engine/gates/services/gate-script-tool-runner.js';

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

/** A registered tool backed by another fixture script (same shape as `verdictTool`). */
function fixtureTool(
  id: string,
  file: string,
  overrides: Partial<LoadedScriptTool> = {}
): LoadedScriptTool {
  return verdictTool({
    id,
    scriptPath: file,
    absoluteScriptPath: path.join(FIXTURE_DIR, file),
    ...overrides,
  } as Partial<LoadedScriptTool>);
}

/** Forwards to the real executor and records what the criterion runner handed it. */
function recordingExecutor(inner: ScriptExecutorPort): ScriptExecutorPort & {
  calls: Array<{ request: ScriptExecutionRequest; tool: LoadedScriptTool }>;
} {
  const calls: Array<{ request: ScriptExecutionRequest; tool: LoadedScriptTool }> = [];
  return {
    calls,
    execute: async (request, tool) => {
      calls.push({ request, tool });
      return inner.execute(request, tool);
    },
  };
}

/** The process boundary replaced: an executor that returns (or throws) exactly what is handed in. */
function stubExecutor(
  outcome: Partial<ScriptExecutionResult> | Error | string
): ScriptExecutorPort {
  return {
    execute: async () => {
      if (outcome instanceof Error) throw outcome;
      if (typeof outcome === 'string') throw outcome;
      return {
        success: true,
        output: null,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 7,
        ...outcome,
      };
    },
  };
}

function runtimeWith(
  executor: ScriptExecutorPort,
  ...tools: LoadedScriptTool[]
): ScriptToolRuntime {
  return { loader: loaderFor(...tools), executor };
}

const scriptCriterion = (extra: Record<string, unknown>): GatePassCriteria =>
  ({ type: 'script_tool', ...extra }) as GatePassCriteria;

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

  // Failure paths of the criterion rule. Real ScriptExecutor and real subprocesses wherever
  // the executor can produce the case; the process boundary is stubbed only for results a
  // real executor cannot emit (a non-object payload, a throw from spawn itself).
  describe('the criterion rule — failure paths', () => {
    test('a criterion of another type is unrunnable and names no tool', async () => {
      const outcome = await runScriptToolCriterion(
        { type: 'shell_verify', shell_command: ['true'] } as unknown as GatePassCriteria,
        scriptTools()
      );

      expect(outcome).toMatchObject({
        toolId: undefined,
        passed: false,
        unrunnable: true,
        reason: 'criterion is not a script_tool check',
        durationMs: 0,
      });
    });

    // Positive control for the two id-less cases below: the same runtime runs a named id.
    test('a whitespace-only id is unrunnable with the no-id reason', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: '   ' }),
        scriptTools()
      );

      expect(outcome.unrunnable).toBe(true);
      expect(outcome.toolId).toBeUndefined();
      expect(outcome.reason).toContain('no script_tool_id specified');
    });

    test('an unknown id is unrunnable and echoes the id it could not resolve', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'no_such_tool' }),
        scriptTools()
      );

      expect(outcome.toolId).toBe('no_such_tool');
      expect(outcome.unrunnable).toBe(true);
      expect(outcome.reason).toContain('names a tool, not a shell command');
    });

    // A tool that leaves `confirm` unset means true — the default must not be read as
    // "no confirmation needed".
    test('a tool with no execution block at all is refused as confirm-required', async () => {
      const bare = verdictTool({ execution: undefined } as unknown as Partial<LoadedScriptTool>);

      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'verdict_tool' }),
        {
          loader: loaderFor(bare),
          executor: createScriptExecutor({ debug: false }),
        }
      );

      expect(outcome.unrunnable).toBe(true);
      expect(outcome.reason).toContain('confirmation');
    });

    test('script_tool_timeout is forwarded and a script outliving it fails with the timeout reason', async () => {
      const executor = recordingExecutor(createScriptExecutor({ debug: false }));
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'sleeper', script_tool_timeout: 300 }),
        runtimeWith(executor, fixtureTool('sleeper', 'sleep-long.cjs'))
      );

      expect(executor.calls[0]?.request.timeout).toBe(300);
      expect(outcome.passed).toBe(false);
      expect(outcome.unrunnable).toBe(false);
      expect(outcome.reason).toBe('Script timed out after 300ms');
      expect(outcome.scriptOutput).toBeNull();
    }, 20000);

    // Control for the timeout case: no declared timeout means the key is absent from the
    // request, not present as undefined, so the executor's own default applies.
    test('no script_tool_timeout leaves the request without a timeout key; inputs default to {}', async () => {
      const executor = recordingExecutor(createScriptExecutor({ debug: false }));
      await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'verdict_tool' }),
        runtimeWith(executor, verdictTool())
      );

      const request = executor.calls[0]?.request;
      expect(request).toBeDefined();
      expect('timeout' in (request as ScriptExecutionRequest)).toBe(false);
      expect(request?.inputs).toEqual({});
      expect(request?.promptId).toBe('gate_owner');
    }, 20000);

    test('declared script_tool_input reaches the script verbatim', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'verdict_tool', script_tool_input: { verdict: 'pass' } }),
        scriptTools()
      );

      expect(outcome.passed).toBe(true);
      expect(outcome.reason).toBe('verdict fixture saw "pass"');
      expect(outcome.exitCode).toBe(0);
    }, 20000);

    test('a non-zero exit fails with the stderr as reason and carries exit code and stderr', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'crasher' }),
        runtimeWith(
          createScriptExecutor({ debug: false }),
          fixtureTool('crasher', 'exit-nonzero.cjs')
        )
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.unrunnable).toBe(false);
      expect(outcome.exitCode).toBe(3);
      expect(outcome.reason).toBe('fixture failed on purpose');
      expect(outcome.stderr).toBe('fixture failed on purpose');
    }, 20000);

    // Control for the stderr spread: a clean run has no stderr key at all.
    test('a clean run carries no stderr key', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'verdict_tool', script_tool_input: { verdict: 'pass' } }),
        scriptTools()
      );

      expect('stderr' in outcome).toBe(false);
    }, 20000);

    test('stdout that is not JSON fails with the executor error, not a pass', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'prose' }),
        runtimeWith(
          createScriptExecutor({ debug: false }),
          fixtureTool('prose', 'print-non-json.cjs')
        )
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.unrunnable).toBe(false);
      expect(outcome.scriptOutput).toBeNull();
      expect(outcome.reason).toContain('wrote output that is not JSON');
    }, 20000);

    test('a payload without passed:true fails with the did-not-report reason', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'echo' }),
        runtimeWith(createScriptExecutor({ debug: false }), fixtureTool('echo', 'echo-inputs.cjs'))
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.unrunnable).toBe(false);
      expect(outcome.reason).toBe('Script tool did not report passed: true');
      expect(outcome.scriptOutput).toEqual({ received: {}, ok: true });
    }, 20000);

    test('a non-object output fails closed even when the executor reports success', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'verdict_tool' }),
        runtimeWith(stubExecutor({ success: true, output: 'passed' }), verdictTool())
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.scriptOutput).toBeNull();
      expect(outcome.reason).toBe('Script tool did not report passed: true');
    });

    test('passed:true without a reason reports the default pass reason', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'verdict_tool' }),
        runtimeWith(stubExecutor({ output: { passed: true } }), verdictTool())
      );

      expect(outcome.passed).toBe(true);
      expect(outcome.reason).toBe('Script tool passed');
      expect(outcome.durationMs).toBe(7);
    });

    // passed:true from a script is not enough when the process itself failed.
    test('passed:true does not override an executor failure', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'verdict_tool' }),
        runtimeWith(
          stubExecutor({
            success: false,
            output: { passed: true },
            error: 'killed',
            exitCode: 137,
          }),
          verdictTool()
        )
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.reason).toBe('killed');
      expect(outcome.exitCode).toBe(137);
    });

    test('an executor that throws becomes a failing, runnable outcome naming the error', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'verdict_tool' }),
        runtimeWith(stubExecutor(new Error('spawn exploded')), verdictTool())
      );

      expect(outcome).toMatchObject({
        toolId: 'verdict_tool',
        passed: false,
        unrunnable: false,
        reason: 'Script tool error: spawn exploded',
      });
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('a thrown non-Error is stringified into the reason', async () => {
      const outcome = await runScriptToolCriterion(
        scriptCriterion({ script_tool_id: 'verdict_tool' }),
        runtimeWith(stubExecutor('plain string'), verdictTool())
      );

      expect(outcome.passed).toBe(false);
      expect(outcome.reason).toBe('Script tool error: plain string');
    });

    describe('script_tool_working_dir', () => {
      test('is applied to the tool handed to the executor, leaving the registry entry untouched', async () => {
        const registered = verdictTool();
        const executor = recordingExecutor(createScriptExecutor({ debug: false }));

        const outcome = await runScriptToolCriterion(
          scriptCriterion({
            script_tool_id: 'verdict_tool',
            script_tool_input: { verdict: 'pass' },
            script_tool_working_dir: '.',
          }),
          runtimeWith(executor, registered)
        );

        expect(executor.calls[0]?.tool.workingDir).toBe('.');
        expect(executor.calls[0]?.tool).not.toBe(registered);
        expect(registered.workingDir).toBeUndefined();
        expect(outcome.passed).toBe(true);
      }, 20000);

      // Control for the above: with no declared dir the registered tool is passed as is.
      test('absent, the registered tool is passed through unchanged', async () => {
        const registered = verdictTool();
        const executor = recordingExecutor(createScriptExecutor({ debug: false }));

        await runScriptToolCriterion(
          scriptCriterion({ script_tool_id: 'verdict_tool' }),
          runtimeWith(executor, registered)
        );

        expect(executor.calls[0]?.tool).toBe(registered);
      }, 20000);

      test('a directory escaping the tool directory is refused by the executor, not run', async () => {
        const outcome = await runScriptToolCriterion(
          scriptCriterion({
            script_tool_id: 'verdict_tool',
            script_tool_input: { verdict: 'pass' },
            script_tool_working_dir: '../../..',
          }),
          scriptTools()
        );

        expect(outcome.passed).toBe(false);
        expect(outcome.unrunnable).toBe(false);
        expect(outcome.reason).toContain("outside the tool's own directory");
      }, 20000);
    });
  });

  // The review-feedback projection. Results come from real runs through
  // `runGateScriptToolVerifications`, so the text asserted is what a reviewer is shown.
  describe('formatGateScriptToolSection', () => {
    const providerFor = (gate: LightweightGateDefinition): GateDefinitionProvider =>
      ({
        ...loaderProviderFor(gate),
        loadGates: async (ids: string[]) => (ids.includes(gate.id) ? [gate] : []),
      }) as unknown as GateDefinitionProvider;

    const section = async (
      criteria: Record<string, unknown>,
      runtime: ScriptToolRuntime | undefined = scriptTools()
    ): Promise<string> => {
      const gate = gateWith(criteria);
      return formatGateScriptToolSection(
        await runGateScriptToolVerifications([gate.id], providerFor(gate), runtime)
      );
    };

    test('no results render as an empty string', () => {
      expect(formatGateScriptToolSection([])).toBe('');
    });

    test('a failing verdict renders FAILED, the script reason, duration and its details as JSON', async () => {
      const text = await section({
        type: 'script_tool',
        script_tool_id: 'verdict_tool',
        script_tool_input: { verdict: 'nope' },
      });

      expect(text).toContain('## Script Tool Verification Results');
      expect(text).toContain('### Script Tool Gate — FAILED');
      expect(text).toContain('**Tool:** `verdict_tool`');
      expect(text).toContain('**Reason:** verdict fixture saw "nope"');
      expect(text).toMatch(/\*\*Duration:\*\* \d+ms/);
      expect(text).toContain('```json');
      expect(text).toContain('"marker": "gate-verdict.cjs"');
    }, 20000);

    // Positive control for the FAILED case: same tool, passing verdict, no status leak and
    // no details block.
    test('a passing verdict renders PASSED with no details block', async () => {
      const text = await section({
        type: 'script_tool',
        script_tool_id: 'verdict_tool',
        script_tool_input: { verdict: 'pass' },
      });

      expect(text).toContain('### Script Tool Gate — PASSED');
      expect(text).not.toContain('FAILED');
      expect(text).not.toContain('```json');
    }, 20000);

    test('an unrunnable criterion renders COULD NOT RUN with no duration line', async () => {
      const text = await section({ type: 'script_tool', script_tool_id: 'no_such_tool' });

      expect(text).toContain('### Script Tool Gate — COULD NOT RUN');
      expect(text).toContain('**Tool:** `no_such_tool`');
      expect(text).toContain('**Reason:** no registered script tool has that id');
      expect(text).not.toContain('**Duration:**');
      expect(text).not.toContain('```json');
    });

    test('a criterion naming no tool renders the none-declared placeholder', async () => {
      const text = await section({ type: 'script_tool' });

      expect(text).toContain('### Script Tool Gate — COULD NOT RUN');
      expect(text).toContain('**Tool:** `(none declared)`');
    });

    test('a failure with no details renders no JSON block', async () => {
      const text = await section(
        { type: 'script_tool', script_tool_id: 'crasher' },
        runtimeWith(
          createScriptExecutor({ debug: false }),
          fixtureTool('crasher', 'exit-nonzero.cjs')
        )
      );

      expect(text).toContain('### Script Tool Gate — FAILED');
      expect(text).toContain('**Reason:** fixture failed on purpose');
      expect(text).not.toContain('```json');
    }, 20000);

    test('results are rendered in order, one block per criterion, separated by a blank line', () => {
      const base: GateScriptToolResult = {
        gateId: 'g',
        gateName: 'First',
        toolId: 't1',
        passed: true,
        reason: 'ok',
        unrunnable: false,
        durationMs: 5,
      };
      const text = formatGateScriptToolSection([
        base,
        { ...base, gateName: 'Second', toolId: 't2', passed: false },
      ]);

      expect(text.indexOf('### First — PASSED')).toBeGreaterThan(-1);
      expect(text.indexOf('### Second — FAILED')).toBeGreaterThan(
        text.indexOf('### First — PASSED')
      );
      expect(text).toContain('**Duration:** 5ms\n\n### Second');
      expect(text.endsWith('\n')).toBe(false);
    });

    test('details are capped at 2000 characters', () => {
      const text = formatGateScriptToolSection([
        {
          gateId: 'g',
          gateName: 'Big',
          toolId: 't',
          passed: false,
          reason: 'too much',
          unrunnable: false,
          durationMs: 1,
          scriptOutput: { details: { blob: 'x'.repeat(5000) } },
        },
      ]);

      const body = text.split('```json\n')[1]?.split('\n```')[0] ?? '';
      expect(body).toHaveLength(2000);
    });
  });

  // Inputs of `runGateScriptToolVerifications` the live path does not exercise above.
  describe('runGateScriptToolVerifications — inputs', () => {
    test('checkedDefinitions bypass the provider entirely', async () => {
      const gate = gateWith({
        type: 'script_tool',
        script_tool_id: 'verdict_tool',
        script_tool_input: { verdict: 'pass' },
      });
      const provider = {
        loadGates: async () => {
          throw new Error('provider must not be consulted');
        },
      } as unknown as GateDefinitionProvider;

      const results = await runGateScriptToolVerifications([gate.id], provider, scriptTools(), [
        gate,
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]?.passed).toBe(true);
      expect(results[0]).toMatchObject({
        gateId: 'script-tool-gate',
        gateName: 'Script Tool Gate',
        exitCode: 0,
      });
    }, 20000);

    test('a gate with no pass_criteria contributes nothing', async () => {
      const bare = {
        id: 'bare',
        name: 'Bare',
        type: 'validation',
        description: 'no criteria',
      } as unknown as LightweightGateDefinition;

      const results = await runGateScriptToolVerifications(
        [bare.id],
        {} as unknown as GateDefinitionProvider,
        scriptTools(),
        [bare]
      );

      expect(results).toEqual([]);
    });

    test('a thrown executor error still yields a row without exit code or output fields', async () => {
      const gate = gateWith({ type: 'script_tool', script_tool_id: 'verdict_tool' });

      const results = await runGateScriptToolVerifications(
        [gate.id],
        {} as unknown as GateDefinitionProvider,
        runtimeWith(stubExecutor(new Error('boom')), verdictTool()),
        [gate]
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.reason).toBe('Script tool error: boom');
      expect('exitCode' in (results[0] as object)).toBe(false);
      expect('scriptOutput' in (results[0] as object)).toBe(false);
      expect('stderr' in (results[0] as object)).toBe(false);
    });

    test('exit code, script output and stderr are carried onto the row', async () => {
      const gate = gateWith({ type: 'script_tool', script_tool_id: 'crasher' });

      const results = await runGateScriptToolVerifications(
        [gate.id],
        {} as unknown as GateDefinitionProvider,
        runtimeWith(
          createScriptExecutor({ debug: false }),
          fixtureTool('crasher', 'exit-nonzero.cjs')
        ),
        [gate]
      );

      expect(results[0]).toMatchObject({
        exitCode: 3,
        stderr: 'fixture failed on purpose',
        scriptOutput: null,
      });
    }, 20000);
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
  // `llm_self_check` never had a runner anywhere and is now removed from the schema's `type`
  // enum entirely (registry count 0 — no gate file ever used it). It used to reach
  // GateValidator's auto-pass stub, which returned `passed: true` with a skip message — that
  // stub is gone. Two properties are worth protecting now: the schema refuses the removed
  // value at load with a message naming the fix, and — for a raw provider value that bypasses
  // schema validation entirely (e.g. stale on-disk data from before the removal) — the runtime
  // path still cannot be tricked into treating it as a ground-truth result. Silence must read
  // as "not verified", never as "verified".
  describe('a removed criteria type cannot clear a review', () => {
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

    test('the schema rejects the type, naming the replacement types', () => {
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

      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('never had a runner');
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
