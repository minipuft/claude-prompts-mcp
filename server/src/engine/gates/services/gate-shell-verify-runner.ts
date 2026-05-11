// @lifecycle canonical - Runs shell_verify criteria for gates during gate review.
/**
 * Gate Shell Verify Runner
 *
 * Thin service that loads gate definitions, filters for `shell_verify` criteria,
 * executes each via ShellVerifyExecutor, and returns structured results.
 *
 * Used by GateReviewStage to surface actual command output (test failures,
 * lint errors) in the gate review feedback — instead of generic "review your work".
 */

import { getShellPreset } from '../config/shell-preset-loader.js';
import {
  SHELL_STDIN_SOURCE_AGENT_RESPONSE,
  SHELL_VERIFY_MAX_RESPONSE_BYTES,
} from '../constants.js';
import { getDefaultShellVerifyExecutor } from '../shell/shell-verify-executor.js';

import type { GateDefinitionProvider } from '../core/gate-loader.js';
import type { GateShellVerifyResult } from '../shell/shell-verify-message-formatter.js';
import type { ShellVerifyGate } from '../shell/types.js';

/** Optional context passed to gate shell verification — currently the agent response. */
export interface GateShellVerifyRunContext {
  /** Agent response text from the current execution. Forwarded to scripts that opt in. */
  agentResponse?: string;
}

/**
 * Truncate response text to a byte budget. When over the limit, keeps the head
 * and tail with a marker so scripts can detect truncation explicitly.
 */
function truncateResponse(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) return text;
  const halfBudget = Math.floor((maxBytes - 64) / 2);
  const head = buf.subarray(0, halfBudget).toString('utf8');
  const tail = buf.subarray(buf.byteLength - halfBudget).toString('utf8');
  return `${head}\n\n[...truncated ${buf.byteLength - maxBytes} bytes...]\n\n${tail}`;
}

/** Pass criterion type for shell_verify criteria — narrowed from the broader union. */
type ShellVerifyCriteria = {
  shell_command?: string;
  shell_timeout?: number;
  shell_working_dir?: string;
  shell_env?: Record<string, string>;
  shell_max_attempts?: number;
  shell_preset?: 'fast' | 'full' | 'extended';
  shell_stdin_source?: 'agent_response';
  shell_response_env_var?: string;
};

/** Build a ShellVerifyGate from a criterion, applying preset and response injection. */
function buildGateConfig(
  criteria: ShellVerifyCriteria,
  runContext: GateShellVerifyRunContext | undefined
): ShellVerifyGate | null {
  const command = criteria.shell_command;
  if (command == null || command.trim() === '') {
    return null;
  }

  const presetValues =
    criteria.shell_preset != null ? getShellPreset(criteria.shell_preset) : undefined;

  const { stdin, env } = resolveResponseInjection(criteria, runContext);

  return {
    command,
    timeout: criteria.shell_timeout ?? presetValues?.timeout,
    workingDir: criteria.shell_working_dir,
    env,
    stdin,
    maxIterations: criteria.shell_max_attempts ?? presetValues?.maxIterations,
    preset: criteria.shell_preset,
  };
}

/**
 * Resolve stdin + env for response injection.
 *
 * Opt-in via `shell_stdin_source: 'agent_response'`. Response is truncated to
 * SHELL_VERIFY_MAX_RESPONSE_BYTES before piping. If `shell_response_env_var` is
 * also set, the same (truncated) text is mirrored into the env for scripts that
 * need to re-read without buffering stdin.
 */
function resolveResponseInjection(
  criteria: ShellVerifyCriteria,
  runContext: GateShellVerifyRunContext | undefined
): { stdin: string | undefined; env: Record<string, string> | undefined } {
  const baseEnv = criteria.shell_env;
  if (
    criteria.shell_stdin_source !== SHELL_STDIN_SOURCE_AGENT_RESPONSE ||
    runContext?.agentResponse === undefined
  ) {
    return { stdin: undefined, env: baseEnv };
  }

  const stdin = truncateResponse(runContext.agentResponse, SHELL_VERIFY_MAX_RESPONSE_BYTES);
  const env =
    criteria.shell_response_env_var !== undefined
      ? { ...(baseEnv ?? {}), [criteria.shell_response_env_var]: stdin }
      : baseEnv;
  return { stdin, env };
}

/**
 * Run shell verification for all gates that have `shell_verify` pass criteria.
 *
 * @param gateIds - Gate IDs from the pending review
 * @param gateDefinitionProvider - Provider to load gate definitions
 * @param runContext - Optional context (e.g., agent response for stdin injection)
 * @returns Results for each gate that had shell_verify criteria (may be empty)
 */
export async function runGateShellVerifications(
  gateIds: string[],
  gateDefinitionProvider: GateDefinitionProvider,
  runContext?: GateShellVerifyRunContext
): Promise<GateShellVerifyResult[]> {
  const results: GateShellVerifyResult[] = [];
  const executor = getDefaultShellVerifyExecutor();

  const gates = await gateDefinitionProvider.loadGates(gateIds);

  for (const gate of gates) {
    const shellCriteria = gate.pass_criteria?.filter((c) => c.type === 'shell_verify');
    if (!shellCriteria || shellCriteria.length === 0) {
      continue;
    }

    for (const criteria of shellCriteria) {
      const gateConfig = buildGateConfig(criteria as ShellVerifyCriteria, runContext);
      if (gateConfig === null) {
        continue;
      }

      const result = await executor.execute(gateConfig);

      results.push({
        gateId: gate.id,
        gateName: gate.name,
        command: gateConfig.command,
        passed: result.passed,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
      });
    }
  }

  return results;
}
