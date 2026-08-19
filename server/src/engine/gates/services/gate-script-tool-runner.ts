// @lifecycle canonical - Runs script_tool criteria for gates during gate review.
/**
 * Gate Script Tool Runner
 *
 * Sibling of `gate-shell-verify-runner.ts`: loads gate definitions, filters for
 * `script_tool` criteria, and runs each one. Both feed the same coverage decision, which
 * reads only `gateId` and `passed` and is therefore mechanism-agnostic.
 *
 * The rule for what a `script_tool` criterion MEANS is not here — it lives in
 * `script-tool-criterion-runner.ts`, shared with `GateValidator`, so the two callers
 * cannot drift into enforcing different contracts for one criteria type.
 *
 * Why this exists at all: until 2026-08-19 no live path ran `script_tool`. Stage 20 is the
 * only consumer of `pass_criteria` during a run and it filtered for `shell_verify` alone,
 * so a gate declaring `script_tool` cleared review having verified nothing, silently.
 */

import { runScriptToolCriterion } from './script-tool-criterion-runner.js';

import type { ScriptToolRuntime } from './script-tool-criterion-runner.js';
import type { GateDefinitionProvider } from '../core/gate-loader.js';

/** One gate's `script_tool` verification result, shaped for review feedback. */
export interface GateScriptToolResult {
  gateId: string;
  gateName: string;
  toolId: string | undefined;
  passed: boolean;
  reason: string;
  /** The check could not run — distinct from running and returning a failing verdict. */
  unrunnable: boolean;
  durationMs: number;
  exitCode?: number;
  scriptOutput?: Record<string, unknown> | null;
  stderr?: string;
}

/**
 * Run every `script_tool` criterion declared by the given gates.
 *
 * Returns one result per criterion, including criteria that could not run: an unrunnable
 * check is reported as failed rather than skipped, so it cannot clear a review by
 * producing no row. Gates with no `script_tool` criteria contribute nothing.
 */
export async function runGateScriptToolVerifications(
  gateIds: string[],
  gateDefinitionProvider: GateDefinitionProvider,
  runtime: ScriptToolRuntime | undefined
): Promise<GateScriptToolResult[]> {
  const results: GateScriptToolResult[] = [];
  const gates = await gateDefinitionProvider.loadGates(gateIds);

  for (const gate of gates) {
    const criteria = gate.pass_criteria?.filter((c) => c.type === 'script_tool') ?? [];

    for (const criterion of criteria) {
      const outcome = await runScriptToolCriterion(criterion, runtime);
      results.push({
        gateId: gate.id,
        gateName: gate.name,
        toolId: outcome.toolId,
        passed: outcome.passed,
        reason: outcome.reason,
        unrunnable: outcome.unrunnable,
        durationMs: outcome.durationMs,
        ...(outcome.exitCode != null ? { exitCode: outcome.exitCode } : {}),
        ...(outcome.scriptOutput !== undefined ? { scriptOutput: outcome.scriptOutput } : {}),
        ...(outcome.stderr != null ? { stderr: outcome.stderr } : {}),
      });
    }
  }

  return results;
}

/** Display max for a script's structured payload in review feedback. */
const DETAILS_MAX_CHARS = 2000;

/**
 * Format a markdown section summarizing gate-level `script_tool` results.
 *
 * Mirrors `formatGateShellVerifySection`. The script's own `reason` leads, because the
 * point of a structured verdict over an exit code is that the script can say WHY.
 */
export function formatGateScriptToolSection(results: GateScriptToolResult[]): string {
  if (results.length === 0) return '';

  const lines = ['## Script Tool Verification Results', ''];

  for (const result of results) {
    const status = result.unrunnable ? 'COULD NOT RUN' : result.passed ? 'PASSED' : 'FAILED';
    lines.push(`### ${result.gateName} — ${status}`);
    lines.push('');
    lines.push(`**Tool:** \`${result.toolId ?? '(none declared)'}\``);
    lines.push(`**Reason:** ${result.reason}`);
    if (!result.unrunnable) {
      lines.push(`**Duration:** ${result.durationMs}ms`);
    }

    const details = result.scriptOutput?.['details'];
    if (!result.passed && details !== undefined) {
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(details, null, 2).slice(0, DETAILS_MAX_CHARS));
      lines.push('```');
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
