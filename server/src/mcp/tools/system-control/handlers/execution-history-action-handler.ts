// @lifecycle canonical - Handler for reading the append-only execution ledger.

import { ActionHandler } from '../core/action-handler-base.js';

import type { ExecutionRecord, GateVerdictSummary } from '#shared/types/chain-execution.js';
import type { ToolResponse } from '#shared/types/index.js';

import { resolveFrozenReviewDefinition } from '#engine/execution/pipeline/decisions/gates/frozen-review-definitions.js';

/**
 * Reader for `execution_records`, the append-only chain execution ledger.
 *
 * The ledger had a writer (pipeline stages 18 and 21) and no reader for its entire
 * existence: `queryBySession` and `queryByChain` had zero callers, and the one documented
 * consumer — the `v_execution_status` view — selects FROM `chain_sessions`, which is
 * deleted per-PID at cleanup, so it reported 0 rows against 64 stored records. This action
 * is that missing reader.
 */
export class ExecutionHistoryActionHandler extends ActionHandler {
  async execute(args: Record<string, unknown>): Promise<ToolResponse> {
    const store = this.context.executionRecordStore;

    if (store === undefined) {
      return this.createMinimalSystemResponse(
        '⚠️ **Execution Ledger Not Available**\n\n' +
          'The execution record store is not wired. This occurs when the server started without a database.',
        'execution_history_error'
      );
    }

    const operation = (args['operation'] as string | undefined) ?? 'list';

    switch (operation) {
      case 'list':
        return this.listRecent(args);
      case 'steps':
        return this.listLatestPerStep(args);
      default:
        throw new Error(
          `Unknown execution_history operation: ${operation}. Valid operations: list, steps`
        );
    }
  }

  /**
   * One run's steps, each at its LATEST record (P4.118).
   *
   * `list` renders the whole series, so a step answered on one call and graded on the next
   * shows `completed` above its verdict and a reader has to know which row wins. This resolves
   * it: one line per step, the newest row's status and gate verdicts.
   */
  private listLatestPerStep(args: Record<string, unknown>): ToolResponse {
    const store = this.context.executionRecordStore;
    if (store === undefined) {
      throw new Error('Execution record store not initialized');
    }
    const runId = args['session_id'];
    if (typeof runId !== 'string' || runId.trim() === '') {
      throw new Error(
        'execution_history operation "steps" needs session_id: the session id or chain id of one run'
      );
    }

    const records = store.queryLatestPerStep(runId, this.context.requestScope);
    if (records.length === 0) {
      return this.createMinimalSystemResponse(
        `📭 **No Step Records**\n\nNo step of \`${runId}\` has been recorded for this scope.`,
        'execution_history_steps'
      );
    }

    const lines = [`📜 **Steps of \`${runId}\`** (latest record per step)`, ''];
    const historical = [...new Set(records.map((record) => record.sessionId))].flatMap(
      (sessionId) => store.queryBySession(sessionId, this.context.requestScope)
    );
    const latestGates = latestGateFacts(historical);
    for (const record of records) {
      const step = record.stepNumber !== undefined ? `step ${record.stepNumber}` : 'step ?';
      const prompt = record.promptId !== undefined ? ` · ${record.promptId}` : '';
      lines.push(`- ${statusIcon(record.status)} \`${record.status}\` ${step}${prompt}`);
      lines.push(...formatLatestGateFacts(record, latestGates));
    }
    return this.createMinimalSystemResponse(lines.join('\n'), 'execution_history_steps');
  }

  /**
   * Most recent ledger entries for the caller's scope, newest first.
   *
   * `limit` is passed through to `queryRecent`, which clamps it — the ledger has no
   * retention policy yet, so an unbounded read is a real possibility to guard against.
   */
  private listRecent(args: Record<string, unknown>): ToolResponse {
    const store = this.context.executionRecordStore;
    if (store === undefined) {
      throw new Error('Execution record store not initialized');
    }

    const limit = typeof args['limit'] === 'number' ? args['limit'] : undefined;
    const records = store.queryRecent(limit, this.context.requestScope);

    if (records.length === 0) {
      return this.createMinimalSystemResponse(
        '📭 **No Execution History**\n\nNo chain executions have been recorded for this scope yet.',
        'execution_history_list'
      );
    }

    return this.createMinimalSystemResponse(formatRecords(records), 'execution_history_list');
  }
}

/** Terminal statuses, listed so the summary can separate finished runs from live ones. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** Render the ledger page as markdown, grouped by session, newest session first. */
function formatRecords(records: readonly ExecutionRecord[]): string {
  const bySession = new Map<string, ExecutionRecord[]>();
  for (const record of records) {
    const existing = bySession.get(record.sessionId);
    if (existing === undefined) {
      bySession.set(record.sessionId, [record]);
    } else {
      existing.push(record);
    }
  }

  const unterminated = records.filter((r) => !TERMINAL_STATUSES.has(r.status)).length;

  const lines: string[] = [
    `📜 **Execution History** (${records.length} record(s) across ${bySession.size} session(s))`,
    '',
  ];

  if (unterminated > 0) {
    lines.push(
      `_${unterminated} record(s) are not in a terminal state — these are either in flight or predate terminal-record emission._`,
      ''
    );
  }

  for (const [sessionId, sessionRecords] of bySession) {
    lines.push(...formatSessionRecords(sessionId, sessionRecords));
  }

  return lines.join('\n');
}

function formatSessionRecords(sessionId: string, records: readonly ExecutionRecord[]): string[] {
  const newest = records[0];
  if (newest === undefined) return [];
  const chainLabel = newest.chainId !== undefined ? ` \`${newest.chainId}\`` : '';
  const lines = [`### ${statusIcon(newest.status)} ${sessionId}${chainLabel}`];
  const telemetry = formatTelemetryLine(newest, records);
  if (telemetry !== undefined) lines.push(telemetry);
  for (const record of records) lines.push(...formatRecordLines(record));
  lines.push('');
  return lines;
}

function formatRecordLines(record: ExecutionRecord): string[] {
  const step = record.stepNumber !== undefined ? `step ${record.stepNumber}` : 'chain';
  const prompt = record.promptId !== undefined ? ` · ${record.promptId}` : '';
  const elapsed =
    record.completedAt !== undefined ? ` · ${record.completedAt - record.startedAt}ms` : '';
  const error = record.errorMessage !== undefined ? ` · ⚠️ ${record.errorMessage}` : '';
  return [
    `- \`${record.status}\` ${step}${prompt} · ${new Date(record.startedAt).toISOString()}${elapsed}${error}`,
    ...formatGateVerdictLines(record),
  ];
}

interface RecordedGateFact {
  readonly record: ExecutionRecord;
  readonly summary: GateVerdictSummary;
}

function gateFactKey(record: ExecutionRecord, gateId: string): string {
  return JSON.stringify([record.sessionId, record.nodeId ?? record.stepNumber, gateId]);
}

/** Creation order, not an old target's timestamp, selects the latest known gate fact. */
function latestGateFacts(
  records: readonly ExecutionRecord[]
): ReadonlyMap<string, RecordedGateFact> {
  const latest = new Map<string, RecordedGateFact>();
  for (const record of records) {
    for (const summary of record.gateVerdicts) {
      const key = gateFactKey(record, summary.gateId);
      const previous = latest.get(key);
      if (previous === undefined || previous.record.executionId < record.executionId)
        latest.set(key, { record, summary });
    }
  }
  return latest;
}

function formatLatestGateFacts(
  record: ExecutionRecord,
  latest: ReadonlyMap<string, RecordedGateFact>
): string[] {
  const facts = [...latest.values()].filter(
    (fact) =>
      fact.record.sessionId === record.sessionId &&
      (fact.record.nodeId ?? fact.record.stepNumber) === (record.nodeId ?? record.stepNumber)
  );
  if (facts.length === 0) return [];
  const lines = [
    '  Latest-known gate facts (historical; not a grade of a newer empty row or target):',
  ];
  for (const fact of facts) {
    lines.push(...formatGateSummaryLines(fact.summary));
    lines.push(
      `    Recorded at ${new Date(fact.summary.timestamp).toISOString()} · record \`${fact.record.executionId}\``
    );
  }
  return lines;
}

/**
 * One indented line per gate the reviewer graded on this record, or nothing at all.
 *
 * Empty for every record whose `gateVerdicts` is `[]` — which until P4.76 was every record
 * ever written, so an existing ledger reads byte-identical and a new one gains the detail.
 * The gate id is what makes a row actionable: `gates fired 3 (retries 1)` on the summary line
 * says a review happened, never which gate held the run up.
 */
function formatGateVerdictLines(record: ExecutionRecord): string[] {
  return record.gateVerdicts.flatMap(formatGateSummaryLines);
}

function formatGateSummaryLines(summary: GateVerdictSummary): string[] {
  const bypass = summary.verdict === 'BYPASS' || summary.disposition === 'bypassed';
  const icon = bypass
    ? '↪'
    : summary.tier === 'reminder'
      ? '≡'
      : summary.verdict === 'PASS'
        ? '✓'
        : '✗';
  const attempt = summary.attempt !== undefined ? ` (attempt ${summary.attempt})` : '';
  const rationale =
    summary.rationale !== undefined && summary.rationale.length > 0
      ? ` — ${summary.rationale}`
      : '';
  return [
    `  - ${icon} \`${summary.gateId}\` ${bypass ? 'BYPASS' : summary.verdict}${attempt}${rationale}`,
    ...formatAcceptanceFacts(summary),
    ...formatReviewClaims(summary),
  ];
}

function formatAcceptanceFacts(summary: GateVerdictSummary): string[] {
  const lines: string[] = [];
  if (summary.disposition !== undefined) lines.push(`    Disposition: ${summary.disposition}`);
  if (summary.verdict === 'BYPASS' || summary.disposition === 'bypassed') return lines;
  if (summary.tier === 'reminder')
    lines.push('    Reminder attestation: self-declared, not graded.');
  else if (summary.semanticResult === undefined && (summary.toolChecks?.length ?? 0) === 0) {
    lines.push('    Legacy unverified acceptance: no recorded semantic or tool component.');
  }
  const semantic = summary.semanticResult;
  if (semantic !== undefined) {
    const acceptance = !semantic.valid ? 'invalid' : semantic.passed ? 'accepted' : 'rejected';
    lines.push(`    Semantic report contract: ${acceptance} (not model accuracy)`);
    lines.push(
      `    Criterion states: ${semantic.criteria.map((criterion) => `${criterion.criterion_id}: ${criterion.state}`).join('; ')}`
    );
  }
  if (summary.toolChecks !== undefined) {
    lines.push(
      `    Recorded tool checks: ${summary.toolChecks.map((check) => `${check.passed ? 'passed' : 'not passed'} — ${check.summary}`).join('; ')}`
    );
    lines.push(
      '    Attempted execution and exit status: unavailable; not-passed may include did-not-run.'
    );
  }
  return lines;
}

function formatReviewClaims(summary: GateVerdictSummary): string[] {
  const lines: string[] = [];
  if (summary.reportedVerdict !== undefined)
    lines.push(
      `    Reported verdict: ${summary.reportedVerdict} — ${summary.reportedRationale ?? ''}`
    );
  if (summary.reportedReview !== undefined)
    lines.push(
      `    Reported group: ${summary.reportedReview.overall} — ${summary.reportedReview.rationale}`
    );
  if (summary.reviewBinding !== undefined)
    lines.push(`    Server review binding: ${JSON.stringify(summary.reviewBinding)}`);
  if (summary.evaluation !== undefined)
    lines.push(`    Reported binding: ${JSON.stringify(summary.evaluation.binding)}`);
  const requested =
    summary.requestedEvaluation ??
    (summary.bypassReview?.semanticContext === undefined
      ? undefined
      : resolveFrozenReviewDefinition(summary.bypassReview.semanticContext, summary.gateId)
          ?.definition['evaluation']);
  if (requested !== undefined) lines.push(`    Requested evaluation: ${JSON.stringify(requested)}`);
  if (
    summary.semanticResult !== undefined ||
    summary.evaluation !== undefined ||
    requested !== undefined
  ) {
    lines.push(
      `    Client reviewer claim: ${JSON.stringify(summary.evaluation?.reviewer ?? { provenance: 'unknown' })}`
    );
    lines.push('    Host-observed reviewer: unknown; human verification: unknown.');
  }
  return lines;
}

/**
 * Render the run's record-only telemetry for one session group, or `undefined` when the
 * newest record carries none — non-terminal runs and rows written before these columns
 * existed both land there, and both should degrade to the previous output rather than to a
 * line of zeroes.
 *
 * `executed` is counted here rather than read from a column or from `v_execution_history`:
 * it is fully reconstructible from the rows already returned, and that view has no code
 * readers, so a column on it would be a second implementation nothing consumes. The count is
 * over the page `queryRecent` returned, so a truncated page reports what it can see.
 *
 * Display formatting only — no weighting, no score, nothing downstream branches on
 * these numbers (master decision D4).
 */
function formatTelemetryLine(
  newest: ExecutionRecord,
  sessionRecords: readonly ExecutionRecord[]
): string | undefined {
  const { stepsPlanned, gatesFired, gateRetries, unknownsOpened, unknownsClosed } = newest;
  if (
    stepsPlanned === undefined &&
    gatesFired === undefined &&
    gateRetries === undefined &&
    unknownsOpened === undefined &&
    unknownsClosed === undefined
  ) {
    return undefined;
  }

  const stepsExecuted = new Set(
    sessionRecords
      .filter((record) => record.stepNumber !== undefined)
      .map((record) => record.stepNumber)
  ).size;

  // Mutation counters render only when a mutation happened: an unmutated run's line stays
  // byte-identical to its pre-P4 shape, and zeroes are not reported as if they were news.
  const mutations =
    (newest.nodesInserted ?? 0) > 0 || (newest.nodesSkipped ?? 0) > 0
      ? ` · nodes inserted ${newest.nodesInserted ?? 0} / skipped ${newest.nodesSkipped ?? 0}`
      : '';

  // Same conditional shape as the line above, and for the same reason: an uninterrupted run's
  // summary stays byte-identical to its pre-D-8 form rather than gaining two zeroes.
  const interrupts =
    (newest.interruptsRaised ?? 0) > 0 || (newest.remaindersAccepted ?? 0) > 0
      ? ` · interrupts ${newest.interruptsRaised ?? 0} / remainders ${newest.remaindersAccepted ?? 0}`
      : '';

  return (
    `_planned ${stepsPlanned ?? 0} / executed ${stepsExecuted}` +
    ` · gates fired ${gatesFired ?? 0} (retries ${gateRetries ?? 0})` +
    ` · unknowns opened ${unknownsOpened ?? 0} / closed ${unknownsClosed ?? 0}` +
    `${mutations}${interrupts}_`
  );
}

function statusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'cancelled':
      return '🚫';
    case 'input_required':
      return '⏸️';
    default:
      return '⏳';
  }
}
