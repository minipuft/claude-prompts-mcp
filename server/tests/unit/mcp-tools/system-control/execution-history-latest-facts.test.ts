/**
 * `execution_history steps` shows, under each step, the latest-known fact per gate from the run's
 * whole ledger. "Latest" is creation order (the ULID `executionId`), not the order the store
 * returns rows in and not a summary's own timestamp.
 *
 * Classification: Unit. The handler with a stubbed record store — the formatter's inputs are the
 * records, and nothing else on this path touches I/O.
 */

import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionHistoryActionHandler } from '../../../../src/mcp/tools/system-control/handlers/execution-history-action-handler.js';

import type { SystemControlContext } from '../../../../src/mcp/tools/system-control/core/types.js';
import type { ExecutionRecord } from '../../../../src/shared/types/chain-execution.js';

const record = (overrides: Partial<ExecutionRecord>): ExecutionRecord =>
  ({
    executionId: 'x',
    sessionId: 'sess-1',
    nodeId: 'n1',
    stepNumber: 1,
    status: 'completed',
    startedAt: 0,
    gateVerdicts: [],
    ...overrides,
  }) as ExecutionRecord;

async function steps(latest: ExecutionRecord[], history: ExecutionRecord[]): Promise<string> {
  const context = {
    executionRecordStore: {
      queryLatestPerStep: jest.fn(() => latest),
      queryBySession: jest.fn(() => history),
    },
    startTime: Date.now(),
    createMinimalSystemResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
  } as unknown as SystemControlContext;
  const response = await new ExecutionHistoryActionHandler(context).execute({
    operation: 'steps',
    session_id: 'sess-1',
  });
  return response.content[0]?.text ?? '';
}

describe('execution_history steps selects the latest gate fact by creation order', () => {
  test('the newest record wins even when the store returns it between older ones', async () => {
    const latestRow = record({ executionId: '01J0000000000000000000003' });
    // The FAIL is older but carries the LATER timestamp, and sits last in store order: neither
    // the summary's timestamp nor iteration order may decide which fact is latest.
    const passed = record({
      executionId: '01J0000000000000000000002',
      gateVerdicts: [{ gateId: 'g', verdict: 'PASS', timestamp: 1000, attempt: 2 }],
    });
    const failed = record({
      executionId: '01J0000000000000000000001',
      gateVerdicts: [{ gateId: 'g', verdict: 'FAIL', timestamp: 9000, attempt: 1 }],
    });

    const text = await steps([latestRow], [passed, latestRow, failed]);

    expect(text).toContain('Latest-known gate facts');
    expect(text).toContain('`g` PASS (attempt 3)');
    expect(text).toContain(`record \`${passed.executionId}\``);
    expect(text).not.toContain('`g` FAIL');
  });
});
