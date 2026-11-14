// @lifecycle canonical - Runs a gate's shipped examples through the gate's own check and compares outcomes.
/**
 * Gate Example Runner
 *
 * A gate may ship example replies beside its `gate.yaml`, each with the outcome the gate is
 * expected to give it (`examples:` in the gate schema). For a gate checked by a command, this
 * hands each example's content to the SAME path a review hands a real reply to —
 * `runGateShellVerification`, so the same shipped-script resolution, the same
 * `shell_stdin_source` injection and truncation, and the same executor with its allowlist,
 * allowed directories and refused environment keys — and compares the exit-status verdict with
 * the expectation.
 *
 * Fails closed: a command the executor refuses (no `MCP_SHELL_VERIFY_ALLOWLIST`, a command outside
 * it) is reported `refused`, never `pass`, and counts as a mismatch. A gate judged by the client
 * model has nothing this runner can execute, so its examples are listed as `not_executed`.
 *
 * Reads the example files; writes nothing. Execution and its side effects belong to the executor.
 */

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { SHELL_STDIN_SOURCE_AGENT_RESPONSE } from '../constants.js';
import { gateDirectoryOf, runGateShellVerification } from './gate-shell-verify-runner.js';
import { toGateDefinition } from '../core/gate-definition-converter.js';
import { hasToolCheck } from '../core/gate-tier.js';

import type { StateStoreOptions } from '#shared/types/persistence.js';
import type { GateExample, LoadedGateDefinition } from '../core/gate-schema.js';
import type { ShellVerifyExecutor } from '../shell/shell-verify-executor.js';
import type { GateShellVerifyResult } from '../shell/shell-verify-message-formatter.js';
import type { LightweightGateDefinition } from '../types.js';

import { isPathInside } from '#shared/utils/path-containment.js';

/** Reason given for every gate whose verdict comes from the client model. */
export const GATE_EXAMPLES_MODEL_JUDGED_REASON =
  'judged by the client model; examples are not executed';

/** What running examples needs beyond the gate: the executor a review would use, and its scope. */
export interface GateExampleRunnerDeps {
  /** The review's executor. Absent, every example is refused, exactly as a review would be. */
  readonly executor: ShellVerifyExecutor | undefined;
  /** The caller's continuity scope, for the executor's gate master-switch read. */
  readonly scope?: StateStoreOptions;
}

/**
 * One example's result. `refused`: the check could not run (the executor refused it, or the file
 * could not be read). `not_executed`: this runner has no check to run for the gate.
 */
interface GateExampleResult {
  readonly file: string;
  readonly expect: GateExample['expect'];
  readonly outcome: 'pass' | 'fail' | 'refused' | 'not_executed';
  readonly detail: string;
}

export interface GateExampleReport {
  readonly gateId: string;
  /** True when at least one example ran to a pass/fail verdict. */
  readonly executed: boolean;
  readonly results: readonly GateExampleResult[];
  /**
   * Examples whose outcome is not their expectation. A `refused` outcome counts — a refusal never
   * confirms an expectation — while `not_executed` does not, because nothing was compared.
   */
  readonly mismatches: number;
  /** Why nothing ran; present exactly when `executed` is false. */
  readonly reason?: string;
}

/** Run every example a gate declares and compare each outcome with its expectation. */
export async function runGateExamples(
  gate: LoadedGateDefinition,
  deps: GateExampleRunnerDeps
): Promise<GateExampleReport> {
  const examples = gate.examples ?? [];

  if (!hasToolCheck(gate)) {
    return notExecuted(gate.id, examples, GATE_EXAMPLES_MODEL_JUDGED_REASON);
  }
  if (examples.length === 0) {
    return notExecuted(gate.id, examples, 'the gate declares no examples');
  }

  const definition = toGateDefinition(gate);
  const gateDir = gateDirectoryOf(definition);
  if (gateDir === undefined) {
    return notExecuted(
      gate.id,
      examples,
      'the gate was not loaded from a directory, so its example files cannot be read'
    );
  }

  const results: GateExampleResult[] = [];
  for (const example of examples) {
    const run = await runExample(definition, gateDir, example, deps);
    if (run === null) {
      // The gate's tool check is not a command (a `script_tool`); this runner executes commands.
      return notExecuted(
        gate.id,
        examples,
        'checked by a script tool, not a command; examples run only for shell_verify gates'
      );
    }
    results.push(run);
  }

  const executed = results.some((r) => r.outcome === 'pass' || r.outcome === 'fail');
  const mismatches = results.filter((r) => r.outcome !== r.expect).length;
  const firstRefusal = results.find((r) => r.outcome === 'refused');
  return {
    gateId: gate.id,
    executed,
    results,
    mismatches,
    ...(executed ? {} : { reason: firstRefusal?.detail ?? 'no example ran' }),
  };
}

/** One example through the gate's shell check; null when the gate has no runnable command. */
async function runExample(
  definition: LightweightGateDefinition,
  gateDir: string,
  example: GateExample,
  deps: GateExampleRunnerDeps
): Promise<GateExampleResult | null> {
  const examplePath = path.join(gateDir, example.file);
  if (!isPathInside(gateDir, examplePath)) {
    return refused(example, `example file '${example.file}' resolves outside the gate directory`);
  }

  let content: string;
  try {
    content = await readFile(examplePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return refused(example, `example file '${example.file}' could not be read: ${message}`);
  }

  const checks = await runGateShellVerification(
    definition,
    { agentResponse: content },
    deps.executor,
    deps.scope
  );
  if (checks.length === 0) return null;

  return { file: example.file, expect: example.expect, ...judge(checks, readsReply(definition)) };
}

/** The verdict the gate would give: refused if any check was, pass only if every check passed. */
function judge(
  checks: readonly GateShellVerifyResult[],
  readsTheReply: boolean
): Pick<GateExampleResult, 'outcome' | 'detail'> {
  const refusal = checks.find((check) => check.refused === true);
  if (refusal !== undefined) {
    return { outcome: 'refused', detail: refusal.stderr };
  }
  const failure = checks.find((check) => !check.passed);
  const verdict =
    failure === undefined
      ? `\`${checks.map((check) => check.command).join('`, `')}\` exited 0`
      : `\`${failure.command}\` ${failure.timedOut === true ? 'timed out' : `exited ${failure.exitCode}`}` +
        (failure.stderr.trim() !== '' ? `: ${failure.stderr.trim()}` : '');
  const caveat = readsTheReply
    ? ''
    : ' (the command does not read the reply — no shell_stdin_source: agent_response — so ' +
      'this outcome does not depend on the example)';
  return { outcome: failure === undefined ? 'pass' : 'fail', detail: verdict + caveat };
}

/** Whether any of the gate's commands is handed the reply, per the injection the runner applies. */
function readsReply(definition: LightweightGateDefinition): boolean {
  return (definition.pass_criteria ?? []).some(
    (criterion) =>
      criterion.type === 'shell_verify' &&
      criterion.shell_stdin_source === SHELL_STDIN_SOURCE_AGENT_RESPONSE
  );
}

function refused(example: GateExample, detail: string): GateExampleResult {
  return { file: example.file, expect: example.expect, outcome: 'refused', detail };
}

function notExecuted(
  gateId: string,
  examples: readonly GateExample[],
  reason: string
): GateExampleReport {
  return {
    gateId,
    executed: false,
    results: examples.map((example) => ({
      file: example.file,
      expect: example.expect,
      outcome: 'not_executed',
      detail: reason,
    })),
    mismatches: 0,
    reason,
  };
}
