// @lifecycle canonical - Runs a review's ground-truth checks (shell_verify + script_tool) once, for every review kind.
/**
 * The ground truth of a gate review: every `shell_verify` and `script_tool` criterion its gates
 * declare, run and flattened into what the verdict processor and the review render need.
 *
 * One implementation, two callers. `GateReviewStage` runs it for the current step's review with
 * this call's reply; a detached node's review (row 4.8) runs it when its verdict arrives, with
 * the node's RECORDED output (`PendingGateReview.reviewedOutput`), never the text of the call
 * that answers it (R10.3). Both runners report an unrunnable check as failed — never a skip.
 */
import {
  formatGateScriptToolSection,
  runGateScriptToolVerifications,
} from './gate-script-tool-runner.js';
import { runGateShellVerifications } from './gate-shell-verify-runner.js';
import { formatGateShellVerifySection } from '../shell/shell-verify-message-formatter.js';

import type { GateCheckResult, GateReviewSemanticContext } from '#shared/types/chain-execution.js';
import type { StateStoreOptions } from '#shared/types/persistence.js';
import type { GateScriptToolResult } from './gate-script-tool-runner.js';
import type { ScriptToolRuntimeProvider } from './script-tool-criterion-runner.js';
import type { GateDefinitionProvider } from '../core/gate-loader.js';
import type { ShellVerifyExecutor } from '../shell/shell-verify-executor.js';
import type { GateShellVerifyResult } from '../shell/shell-verify-message-formatter.js';
import type { LightweightGateDefinition } from '../types.js';

import { canonicalJson, hashCanonical } from '#shared/utils/hash.js';

/** One line, capped, so a recorded result stays readable in a refusal sentence. */
const CHECK_SUMMARY_MAX_CHARS = 200;

/** The executors a review's checks run through; absent, a criterion of that kind fails closed. */
export interface GateReviewCheckRunners {
  readonly shellVerifyExecutor?: ShellVerifyExecutor;
  readonly scriptToolRuntime?: ScriptToolRuntimeProvider;
}

/** What one run of a review's ground truth produced. */
export interface GateReviewEvidence {
  readonly shellResults: readonly GateShellVerifyResult[];
  readonly scriptResults: readonly GateScriptToolResult[];
  /** The rendered sections for the review reply; '' when nothing ran. */
  readonly section: string;
  /** Both result kinds flattened for the verdict processor (`PendingGateReview.checkResults`). */
  readonly checkResults: GateCheckResult[];
}

/**
 * Run every check-tier criterion `gateIds` declare against `agentResponse` (read only by gates
 * that opt in via `shell_stdin_source: 'agent_response'`).
 *
 * `script_tool` criteria run beside `shell_verify` rather than instead of it: a gate may declare
 * both, and the two answer different questions — an exit code versus a structured verdict the
 * script can explain.
 *
 * `scope` is the request's: the shell executor reads the gate master switch for it, so a
 * workspace that disabled gates runs none of their commands.
 */
export async function runGateReviewEvidence(
  gateIds: string[],
  provider: GateDefinitionProvider,
  agentResponse: string | undefined,
  runners: GateReviewCheckRunners,
  scope?: StateStoreOptions,
  issuedDefinitions?: GateReviewSemanticContext['definitions']
): Promise<GateReviewEvidence> {
  const checked = await loadCheckedDefinitions(gateIds, provider, issuedDefinitions);
  const shellResults = await runGateShellVerifications(
    gateIds,
    provider,
    agentResponse !== undefined ? { agentResponse } : undefined,
    runners.shellVerifyExecutor,
    scope,
    checked.gates
  );
  const scriptResults = await runGateScriptToolVerifications(
    gateIds,
    provider,
    runners.scriptToolRuntime?.(),
    checked.gates
  );
  const section = [
    formatGateShellVerifySection(shellResults),
    formatGateScriptToolSection(scriptResults),
    ...checked.refusals.map(
      (refusal) => `Tool verification refused for ${refusal.gateId}: ${refusal.summary}`
    ),
  ]
    .filter((part) => part !== '')
    .join('\n\n');
  return {
    shellResults,
    scriptResults,
    section,
    checkResults: [...checked.refusals, ...toCheckResults(shellResults, scriptResults)],
  };
}

interface CheckedGateDefinitions {
  readonly gates: readonly LightweightGateDefinition[];
  readonly refusals: readonly GateCheckResult[];
}

/** Compare declared criteria, not resolved binaries, script contents or sourceRoot. */
function declaredToolCriteria(criteria: unknown): readonly unknown[] {
  if (criteria === undefined) return [];
  if (!Array.isArray(criteria)) throw new TypeError('Declared tool criteria are unavailable');
  return criteria.filter(
    (criterion: unknown) =>
      typeof criterion === 'object' &&
      criterion !== null &&
      'type' in criterion &&
      (criterion.type === 'shell_verify' || criterion.type === 'script_tool')
  );
}

function checkedDefinitions(
  gateIds: readonly string[],
  observed: readonly LightweightGateDefinition[],
  issued: GateReviewSemanticContext['definitions'] | undefined
): CheckedGateDefinitions {
  const gates: LightweightGateDefinition[] = [];
  const refusals: GateCheckResult[] = [];
  for (const gateId of gateIds) {
    const gate = observed.find((candidate) => candidate.id === gateId);
    const snapshot = issued?.[gateId];
    try {
      const expected = declaredToolCriteria(snapshot?.definition['pass_criteria']);
      const actual = declaredToolCriteria(gate?.pass_criteria);
      if (
        gate === undefined &&
        expected.length === 0 &&
        (issued === undefined || snapshot !== undefined)
      )
        continue;
      const unavailable = gate === undefined || (issued !== undefined && snapshot === undefined);
      const changed = issued !== undefined && hashCanonical(expected) !== hashCanonical(actual);
      if (unavailable || changed) {
        refusals.push({
          gateId,
          passed: false,
          summary:
            'Declared tool criteria changed or are unavailable; verification did not run. Open a fresh server-issued review.',
        });
      } else {
        gates.push(gate);
      }
    } catch {
      refusals.push({
        gateId,
        passed: false,
        summary: 'Declared tool criteria could not be compared; verification did not run.',
      });
    }
  }
  return { gates, refusals };
}

/** One provider read and a local clone; both runners receive these exact checked DTOs. */
async function loadCheckedDefinitions(
  gateIds: string[],
  provider: GateDefinitionProvider,
  issued: GateReviewSemanticContext['definitions'] | undefined
): Promise<CheckedGateDefinitions> {
  try {
    // The provider supplies JSON DTOs; canonical cloning preserves their typed public shape
    // and sourceRoot while sharing the snapshot's normalization of undefined optional keys.
    const observed = JSON.parse(
      canonicalJson(await provider.loadGates(gateIds))
    ) as LightweightGateDefinition[];
    return checkedDefinitions(gateIds, observed, issued);
  } catch {
    return {
      gates: [],
      refusals: gateIds.map((gateId): GateCheckResult => ({
        gateId,
        passed: false,
        summary: 'Observed gate definitions are unavailable; verification did not run.',
      })),
    };
  }
}

/** Collapse to a single line and cap — a summary is quoted back to the submitter verbatim. */
function toSummaryLine(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > CHECK_SUMMARY_MAX_CHARS
    ? `${oneLine.slice(0, CHECK_SUMMARY_MAX_CHARS - 1)}…`
    : oneLine;
}

/**
 * Flatten both runner result shapes into the one thing the verdict processor needs: which gate,
 * did it pass, and one line naming what ran. Mechanism-agnostic on purpose: the processor's
 * refusal does not care whether an exit code or a script verdict produced the failure.
 */
function toCheckResults(
  shellResults: readonly GateShellVerifyResult[],
  scriptResults: readonly GateScriptToolResult[]
): GateCheckResult[] {
  return [
    ...shellResults.map((result) => ({
      gateId: result.gateId,
      passed: result.passed,
      summary: toSummaryLine(`${result.command} exit ${result.exitCode}`),
    })),
    ...scriptResults.map((result) => ({
      gateId: result.gateId,
      passed: result.passed,
      summary: toSummaryLine(`${result.toolId ?? 'script_tool'}: ${result.reason}`),
    })),
  ];
}
