/**
 * `system_control analytics` operations other than the gate-outcome report: reset, history, the
 * default dispatch, and the uptime rendering the report prints.
 *
 * Until now these were pinned only by e2e (`system-control-input-fields.e2e.test.ts`,
 * `http-workspace-header-scope.e2e.test.ts`), so a unit-level regression in the refusal or the
 * scope pass-through surfaced a CI stage late.
 *
 * Classification: Unit. The handler runs for real through `execute`; the only stubs are the
 * framework state store (the persistence port) and the response factory.
 */

import { describe, expect, jest, test } from '@jest/globals';

import { AnalyticsActionHandler } from '../../../../src/mcp/tools/system-control/handlers/analytics-action-handler.js';

import type { SystemControlContext } from '../../../../src/mcp/tools/system-control/core/types.js';

interface SwitchEntry {
  from: string;
  to: string;
  timestamp: Date;
  reason: string;
}

function buildStore(history: SwitchEntry[] = [], activeFramework = 'CAGEERF') {
  return {
    resetMetrics: jest.fn(),
    getSwitchHistory: jest.fn((_limit?: number, _scope?: unknown) => history),
    getCurrentState: jest.fn((_scope?: unknown) => ({ activeFramework })),
  };
}

function buildHandler(overrides: Record<string, unknown> = {}) {
  const context = {
    startTime: Date.now() - 1000,
    createMinimalSystemResponse: (text: string, action: string) => ({
      content: [{ type: 'text', text }],
      action,
    }),
    ...overrides,
  } as unknown as SystemControlContext;
  return new AnalyticsActionHandler(context);
}

async function run(
  args: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): Promise<{ text: string; action: string }> {
  const response = (await buildHandler(overrides).execute(args)) as unknown as {
    content: Array<{ text?: string }>;
    action: string;
  };
  return { text: response.content[0]?.text ?? '', action: response.action };
}

describe('analytics reset', () => {
  test('without confirm it is refused with the instruction, and the store is untouched', async () => {
    const store = buildStore();

    const { text, action } = await run(
      { operation: 'reset' },
      { frameworkStateStore: store, requestScope: { workspaceId: 'wsA' } }
    );

    expect(text).toContain("Metrics reset cancelled. Set 'confirm: true'");
    expect(text).not.toContain('Metrics Reset Completed');
    expect(action).toBe('reset_metrics');
    expect(store.resetMetrics).not.toHaveBeenCalled();
  });

  test("with confirm it resets the CALLER's workspace and says what it did and did not clear", async () => {
    const store = buildStore();

    const { text, action } = await run(
      { operation: 'reset', confirm: true },
      { frameworkStateStore: store, requestScope: { workspaceId: 'wsA' } }
    );

    // Positive control for the refusal test above: same store, same operation, confirm flips it.
    expect(store.resetMetrics).toHaveBeenCalledTimes(1);
    expect(store.resetMetrics).toHaveBeenCalledWith({ workspaceId: 'wsA' });
    expect(text).toContain('# 🔄 Metrics Reset Completed');
    expect(text).toContain('**Framework switch metrics** (this workspace): cleared');
    expect(text).toContain('**Execution ledger**: untouched');
    expect(text).toContain('Framework switching monitoring will start fresh.');
    expect(action).toBe('reset_metrics');
  });

  test('confirm: false is a refusal, not a reset (twin differing only in the flag value)', async () => {
    const store = buildStore();

    const { text } = await run(
      { operation: 'reset', confirm: false },
      { frameworkStateStore: store }
    );

    expect(text).toContain('Metrics reset cancelled');
    expect(store.resetMetrics).not.toHaveBeenCalled();
  });

  test('confirmed with no framework state store still reports completion without throwing', async () => {
    const { text } = await run({ operation: 'reset', confirm: true });

    expect(text).toContain('# 🔄 Metrics Reset Completed');
    expect(text).toContain('## What Was Not Reset');
  });
});

describe('analytics history', () => {
  test('an empty history says so and still names the active framework', async () => {
    const store = buildStore([], 'ReACT');

    const { text, action } = await run(
      { operation: 'history' },
      { frameworkStateStore: store, requestScope: { workspaceId: 'wsA' } }
    );

    expect(text).toContain('# 📈 Framework Switch History');
    expect(text).toContain('**Current Framework**: ReACT');
    expect(text).toContain('**History Entries**: 0');
    expect(text).toContain('No framework switches recorded yet.');
    expect(text).not.toContain('## Recent Switches');
    expect(action).toBe('switch_history');
  });

  test('entries are numbered with direction, timestamp and reason; limit and scope are passed to the store', async () => {
    const store = buildStore(
      [
        {
          from: 'CAGEERF',
          to: 'ReACT',
          timestamp: new Date('2026-10-01T12:00:00.000Z'),
          reason: 'needs tool use',
        },
        {
          from: 'ReACT',
          to: '5W1H',
          timestamp: new Date('2026-10-02T08:30:00.000Z'),
          reason: 'user request',
        },
      ],
      '5W1H'
    );

    const { text } = await run(
      { operation: 'history', limit: 5 },
      { frameworkStateStore: store, requestScope: { workspaceId: 'wsA' } }
    );

    expect(store.getSwitchHistory).toHaveBeenCalledWith(5, { workspaceId: 'wsA' });
    expect(store.getCurrentState).toHaveBeenCalledWith({ workspaceId: 'wsA' });
    expect(text).toContain('**History Entries**: 2');
    expect(text).toContain('## Recent Switches');
    expect(text).toContain('### 1. CAGEERF → ReACT');
    expect(text).toContain('**Timestamp**: 2026-10-01T12:00:00.000Z');
    expect(text).toContain('**Reason**: needs tool use');
    expect(text).toContain('### 2. ReACT → 5W1H');
    expect(text).toContain('**Reason**: user request');
    expect(text).not.toContain('No framework switches recorded yet.');
  });

  test('with no limit given the store is asked for 20 entries', async () => {
    const store = buildStore();

    await run({ operation: 'history' }, { frameworkStateStore: store });

    expect(store.getSwitchHistory).toHaveBeenCalledWith(20, undefined);
  });

  test('with no framework state store it throws rather than reporting an empty history', async () => {
    await expect(buildHandler().execute({ operation: 'history' })).rejects.toThrow(
      'Framework state manager not initialized'
    );
  });
});

describe('analytics dispatch', () => {
  test('no operation, "default" and "view" all produce the analytics report', async () => {
    const none = await run({});
    const dflt = await run({ operation: 'default' });
    const view = await run({ operation: 'view' });

    for (const reply of [none, dflt, view]) {
      expect(reply.text).toContain('# 📊 System Analytics Report');
      expect(reply.action).toBe('analytics');
    }
  });

  test('an unrecognised operation falls through to the report, not to reset or history', async () => {
    const store = buildStore();

    const { text } = await run(
      { operation: 'bogus', confirm: true },
      { frameworkStateStore: store }
    );

    expect(text).toContain('# 📊 System Analytics Report');
    expect(store.resetMetrics).not.toHaveBeenCalled();
    expect(store.getSwitchHistory).not.toHaveBeenCalled();
  });
});

describe('analytics report uptime rendering', () => {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  test.each([
    ['seconds', 45 * SECOND, '**Uptime**: 45s'],
    ['minutes and seconds', 5 * MINUTE + 7 * SECOND, '**Uptime**: 5m 7s'],
    ['hours and minutes', 3 * HOUR + 12 * MINUTE, '**Uptime**: 3h 12m'],
    ['days, hours and minutes', 2 * DAY + 5 * HOUR + 9 * MINUTE, '**Uptime**: 2d 5h 9m'],
  ])('%s', async (_label, elapsedMs, expected) => {
    const { text } = await run({ operation: 'view' }, { startTime: Date.now() - elapsedMs });

    expect(text).toContain(expected);
  });
});

describe('analytics report with an empty ledger', () => {
  test('says no steps were recorded and reports 0% coverage rather than dividing by zero', async () => {
    const { text } = await run(
      { operation: 'view' },
      { executionRecordStore: { queryRecent: jest.fn(() => []) } }
    );

    expect(text).toContain('No steps recorded for this workspace yet.');
    expect(text).not.toContain('**Steps Recorded**');
    expect(text).toContain('**Gate Entry Coverage**: 0% of records on the recent page');
  });

  test('positive control: one completed record replaces the empty-ledger text with figures', async () => {
    const { text } = await run(
      { operation: 'view' },
      {
        executionRecordStore: {
          queryRecent: jest.fn(() => [
            {
              executionId: 'x',
              sessionId: 's',
              status: 'completed',
              startedAt: 100,
              completedAt: 350,
              gateVerdicts: [],
            },
          ]),
        },
      }
    );

    expect(text).not.toContain('No steps recorded for this workspace yet.');
    expect(text).toContain('**Steps Recorded**: 1 (most recent page)');
    expect(text).toContain('**Average Step Duration**: 250ms');
  });
});
