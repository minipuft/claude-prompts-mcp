/**
 * P4.77: `system_control analytics` printed "Gate Validations: 0" and "Gate Adoption Rate: 0%"
 * on every server, forever. `SystemAnalytics.gateValidationCount` was initialized to `0` in the
 * router and in this handler's own reset, and read only by the report — no writer existed
 * anywhere in `src/`.
 *
 * It is now refreshed from `execution_records`, which since P4.76 carries the reviewer's
 * per-gate verdicts, and the report breaks the total down per gate.
 *
 * Classification: Unit. The handler with a stubbed record store — the formatter's inputs are
 * the records, and nothing else in this path touches I/O.
 */

import { describe, expect, jest, test } from '@jest/globals';

import { AnalyticsActionHandler } from '../../../../src/mcp/tools/system-control/handlers/analytics-action-handler.js';

import type { SystemControlContext } from '../../../../src/mcp/tools/system-control/core/types.js';
import type { ExecutionRecord } from '../../../../src/shared/types/chain-execution.js';

const record = (overrides: Partial<ExecutionRecord>): ExecutionRecord =>
  ({
    executionId: 'x',
    sessionId: 'sess-1',
    status: 'completed',
    startedAt: 0,
    gateVerdicts: [],
    ...overrides,
  }) as ExecutionRecord;

function render(records: ExecutionRecord[]): Promise<string> {
  const context = {
    executionRecordStore: { queryRecent: jest.fn(() => records) },
    systemAnalytics: {
      totalExecutions: 4,
      successfulExecutions: 4,
      failedExecutions: 0,
      averageExecutionTime: 10,
      gateValidationCount: 0,
      uptime: 1000,
      performanceTrends: [],
    },
    createMinimalSystemResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
  } as unknown as SystemControlContext;

  return new AnalyticsActionHandler(context)
    .execute({ operation: 'view' })
    .then((response) => response.content[0]?.text ?? '');
}

describe('analytics reports gate outcomes from the ledger', () => {
  test('two reviewed records render both gate ids with their pass/fail tallies', async () => {
    const text = await render([
      record({
        gateVerdicts: [
          { gateId: 'api-documentation', verdict: 'PASS', timestamp: 0 },
          { gateId: 'test-coverage', verdict: 'FAIL', timestamp: 0 },
        ],
      }),
      record({
        executionId: 'y',
        gateVerdicts: [{ gateId: 'test-coverage', verdict: 'PASS', timestamp: 0 }],
      }),
    ]);

    expect(text).toContain('**Gate Validations**: 2');
    expect(text).toContain('- `api-documentation`: 1 passed / 0 failed');
    expect(text).toContain('- `test-coverage`: 1 passed / 1 failed');
    // 2 reviewed of 4 executions.
    expect(text).toContain('**Gate Adoption Rate**: 50%');
  });

  test('positive control: records with no verdicts keep the section absent and the count at 0', async () => {
    // The absence is evidence only because the same handler, over the same shape of record
    // WITH verdicts, does render the section — the case above.
    const text = await render([record({}), record({ executionId: 'y' })]);

    expect(text).toContain('**Gate Validations**: 0');
    expect(text).not.toContain('Per-Gate Outcomes');
  });

  test('no record store at all degrades to the previous output rather than throwing', async () => {
    const context = {
      systemAnalytics: {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        averageExecutionTime: 0,
        gateValidationCount: 0,
        uptime: 0,
        performanceTrends: [],
      },
      createMinimalSystemResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
    } as unknown as SystemControlContext;

    const response = await new AnalyticsActionHandler(context).execute({ operation: 'view' });

    expect(response.content[0]?.text).toContain('**Gate Validations**: 0');
  });
});
