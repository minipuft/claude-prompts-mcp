// @lifecycle canonical - Handler for reading the append-only execution ledger.

import { ActionHandler } from '../core/action-handler-base.js';

import type { ExecutionRecord } from '#shared/types/chain-execution.js';
import type { ToolResponse } from '#shared/types/index.js';

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
      default:
        throw new Error(
          `Unknown execution_history operation: ${operation}. Valid operations: list`
        );
    }
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
    const newest = sessionRecords[0];
    if (newest === undefined) continue;

    const chainLabel = newest.chainId !== undefined ? ` \`${newest.chainId}\`` : '';
    lines.push(`### ${statusIcon(newest.status)} ${sessionId}${chainLabel}`);

    for (const record of sessionRecords) {
      const step = record.stepNumber !== undefined ? `step ${record.stepNumber}` : 'chain';
      const prompt = record.promptId !== undefined ? ` · ${record.promptId}` : '';
      const elapsed =
        record.completedAt !== undefined ? ` · ${record.completedAt - record.startedAt}ms` : '';
      const error = record.errorMessage !== undefined ? ` · ⚠️ ${record.errorMessage}` : '';
      lines.push(
        `- \`${record.status}\` ${step}${prompt} · ${new Date(record.startedAt).toISOString()}${elapsed}${error}`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
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
