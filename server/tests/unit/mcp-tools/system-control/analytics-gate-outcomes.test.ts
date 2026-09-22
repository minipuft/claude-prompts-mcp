/**
 * P4.77: `system_control analytics` printed "Gate Validations: 0" and "Gate Adoption Rate: 0%"
 * on every server, forever. `SystemAnalytics.gateValidationCount` was initialized to `0` in the
 * router and in this handler's own reset, and read only by the report — no writer existed
 * anywhere in `src/`.
 *
 * It is now refreshed from `execution_records`, which since P4.76 carries the reviewer's
 * per-gate verdicts, and the report breaks the total down per gate.
 *
 * P4.87 extended that to the rest of the reply. Every per-workspace figure now comes from the
 * same scoped ledger read, so one reply describes one workspace; the four process-wide execution
 * counters that used to sit above this section were deleted, because nothing ever wrote them and
 * Gate Adoption Rate divided this scoped numerator by that constant zero.
 *
 * Classification: Unit. The handler with a stubbed record store — the formatter's inputs are
 * the records, and nothing else in this path touches I/O.
 */

import { describe, expect, jest, test } from '@jest/globals';

import { AnalyticsActionHandler } from '../../../../src/mcp/tools/system-control/handlers/analytics-action-handler.js';
import { describeUndeclaredParameterRefusal } from '../../../../src/mcp/tools/shared/undeclared-parameters.js';

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
    startTime: Date.now() - 1000,
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
    // 2 reviewed of the 2 records this workspace's ledger page holds — one population, not two.
    expect(text).toContain('**Gate Review Coverage**: 100% of recorded steps');
  });

  test('a reminder attestation is counted apart from the graded gates, never inside them', async () => {
    // A reminder has no evaluator. Folding it into the pass tally would report a self-declared
    // "yes" as a gate that passed, which is the whole reason `tier` exists (P4.78).
    const text = await render([
      record({
        gateVerdicts: [
          { gateId: 'test-coverage', verdict: 'FAIL', timestamp: 0 },
          { gateId: 'style-guide', verdict: 'PASS', timestamp: 0, tier: 'reminder' },
        ],
      }),
    ]);

    expect(text).toContain('- `test-coverage`: 0 passed / 1 failed');
    expect(text).not.toContain('`style-guide`: 1 passed');
    expect(text).toContain('**Reminder Attestations**: 1 (self-declared, not graded)');
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
      startTime: Date.now(),
      createMinimalSystemResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
    } as unknown as SystemControlContext;

    const response = await new AnalyticsActionHandler(context).execute({ operation: 'view' });

    expect(response.content[0]?.text).toContain('**Gate Validations**: 0');
  });
});

/**
 * P4.87 — one reply, one scope.
 *
 * The handler's only scope input is `context.requestScope`, which the router sets per request and
 * clears after. These drive the handler twice against ONE ledger, with two scopes, and assert
 * each reply carries only its own workspace's rows. The stub filters on the scope the handler
 * passes, so a handler that stopped passing it (or passed `undefined`) would hand back every row
 * and fail here.
 */
describe('one analytics reply describes one workspace', () => {
  const ledger: Array<ExecutionRecord & { workspaceId: string }> = [
    { ...record({ executionId: 'a1' }), workspaceId: 'wsA' },
    { ...record({ executionId: 'a2' }), workspaceId: 'wsA' },
    { ...record({ executionId: 'a3', status: 'failed' }), workspaceId: 'wsA' },
    {
      ...record({
        executionId: 'b1',
        gateVerdicts: [{ gateId: 'test-coverage', verdict: 'PASS', timestamp: 0 }],
      }),
      workspaceId: 'wsB',
    },
  ];

  const queryRecent = jest.fn((_limit: unknown, scope: unknown) => {
    const workspaceId = (scope as { workspaceId?: string } | undefined)?.workspaceId;
    return ledger.filter((r) => r.workspaceId === workspaceId) as ExecutionRecord[];
  });

  function renderFor(workspaceId: string): Promise<string> {
    const context = {
      executionRecordStore: { queryRecent },
      requestScope: { workspaceId },
      startTime: Date.now() - 1000,
      createMinimalSystemResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
    } as unknown as SystemControlContext;

    return new AnalyticsActionHandler(context)
      .execute({ operation: 'view' })
      .then((response) => response.content[0]?.text ?? '');
  }

  test('each workspace is reported its own counts, not the process total', async () => {
    const a = await renderFor('wsA');
    const b = await renderFor('wsB');

    // Neither reply may report the four rows the process as a whole holds.
    expect(a).toContain('**Steps Recorded**: 3 (most recent page)');
    expect(a).toContain('**Completed**: 2');
    expect(a).toContain('**Failed**: 1');
    expect(b).toContain('**Steps Recorded**: 1 (most recent page)');
    expect(b).toContain('**Completed**: 1');
    expect(b).toContain('**Failed**: 0');

    // The gate section reads the same page, so the coverage ratio has one population on both
    // sides: wsA reviewed none of its 3, wsB reviewed its only one.
    expect(a).toContain('**Gate Review Coverage**: 0% of recorded steps');
    expect(b).toContain('**Gate Review Coverage**: 100% of recorded steps');
    expect(a).not.toContain('Per-Gate Outcomes');
    expect(b).toContain('- `test-coverage`: 1 passed / 0 failed');
  });

  test('positive control: the two replies differ, and the stub was asked with each scope', async () => {
    // Without this, both assertions above could be satisfied by a stub that ignored scope and
    // happened to return one workspace's rows for every call.
    queryRecent.mockClear();
    const a = await renderFor('wsA');
    const b = await renderFor('wsB');

    expect(a).not.toEqual(b);
    expect(queryRecent.mock.calls.map((c) => c[1])).toEqual([
      { workspaceId: 'wsA' },
      { workspaceId: 'wsB' },
    ]);
  });

  test('the process-wide section is labelled as such, never as the workspace', async () => {
    // Uptime and memory belong to the process and cannot be scoped. They stay in the reply
    // under a heading that says whose they are — a figure that cannot be scoped is not shown as
    // if it were.
    const a = await renderFor('wsA');

    expect(a).toContain('## 🖥️ This Server Process (all workspaces)');
    expect(a.indexOf('(this workspace)')).toBeLessThan(
      a.indexOf('## 🖥️ This Server Process (all workspaces)')
    );
  });
});

/**
 * P4.128 (R93) — `include_history` is gone, and the process facts are read, not cached.
 *
 * The flag rendered `performanceTrends`, which only a tool-description hot reload ever wrote, so
 * it showed one startup memory delta or nothing. The same cached object held `uptime` and
 * `memoryUsage`, which is why a server that never hot-reloaded reported `Uptime: 0s` forever.
 */
describe('analytics reads process facts when it answers, and has no history flag', () => {
  test('uptime is measured from startTime at request time, not from a cached copy', async () => {
    const context = {
      startTime: Date.now() - 2 * 60 * 60 * 1000,
      createMinimalSystemResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
    } as unknown as SystemControlContext;

    const response = await new AnalyticsActionHandler(context).execute({ operation: 'view' });
    const text = response.content[0]?.text ?? '';

    expect(text).toContain('**Uptime**: 2h 0m');
    expect(text).toContain('**Heap Used**:');
    expect(text).not.toContain('Performance Trends');
  });

  test('a sent include_history is refused by name; its declared twin is not', () => {
    // The twin differs in ONE key: `include_metrics` is still a parameter of system_control, so a
    // refusal that fired for any boolean flag would fail the second assertion.
    expect(
      describeUndeclaredParameterRefusal('system_control', {
        action: 'analytics',
        include_history: true,
      })
    ).toContain("'include_history' is not a parameter of system_control");
    expect(
      describeUndeclaredParameterRefusal('system_control', {
        action: 'status',
        include_metrics: true,
      })
    ).toBeNull();
  });
});
