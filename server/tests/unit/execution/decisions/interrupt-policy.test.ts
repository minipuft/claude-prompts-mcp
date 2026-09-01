// @lifecycle test - Branch coverage for the mid-chain blocking-unknown interrupt decision.
import { describe, expect, test } from '@jest/globals';

import {
  decideInterrupt,
  UNKNOWN_INTERRUPT_GATE_ID,
} from '../../../../src/engine/execution/pipeline/decisions/mutation/index.js';

import type {
  ChainInterrupt,
  DecideInterruptInput,
  InterruptNodeSummary,
} from '../../../../src/engine/execution/pipeline/decisions/mutation/index.js';
import type { ChainNode } from '../../../../src/shared/types/chain-execution.js';
import type { UnknownLedgerEntry } from '../../../../src/shared/types/chain-session.js';

/**
 * The four criteria row 1.1 names, plus the two the derivation rule implies (a passed declared
 * target, and multi-unknown collection). Each test's comment names the guard in
 * `interrupt-policy.ts` it exercises.
 */
const NODES: ChainNode[] = [
  { id: 'n1', promptId: 'p1', stepName: 'Survey', origin: 'planned' },
  { id: 'n2', promptId: 'p2', stepName: 'Draft', origin: 'planned' },
  { id: 'n3', promptId: 'p3', stepName: 'Review n3', origin: 'planned' },
  { id: 'n4', promptId: 'p4', stepName: 'Ship', origin: 'planned' },
];

function entry(overrides: Partial<UnknownLedgerEntry> & { id: string }): UnknownLedgerEntry {
  return {
    statement: `${overrides.id} statement`,
    state: 'active',
    blocking: false,
    discoveredAtStep: 1,
    ...overrides,
  };
}

function buildInput(overrides: Partial<DecideInterruptInput> = {}): DecideInterruptInput {
  return {
    ledger: [],
    nodes: NODES,
    currentNodeId: 'n1',
    ...overrides,
  };
}

/**
 * `expect(x).toEqual<T>(...)` generic call syntax is not supported by this repo's `@jest/globals`
 * type definitions (TS2558 — the same constraint `mutation-policy.test.ts` documents). Routing
 * the two whole-shape assertions through helpers typed on the module's own exports keeps the
 * compile-time shape check those call sites would otherwise lose.
 */
function expectInterrupt(actual: ChainInterrupt | undefined, expected: ChainInterrupt): void {
  expect(actual).toEqual(expected);
}

function expectRemaining(
  actual: readonly InterruptNodeSummary[] | undefined,
  expected: readonly InterruptNodeSummary[]
): void {
  expect(actual).toEqual(expected);
}

describe('decideInterrupt', () => {
  test('no interrupt when the ledger holds no OPEN BLOCKING unknown', () => {
    // Guard: selectTriggeringUnknown's `state !== 'active' || blocking !== true` continue.
    // All three near-misses in one ledger, so a regression that relaxes either half of the
    // predicate turns this red rather than passing on the remaining member.
    const ledger = [
      entry({ id: 'non-blocking', blocking: false }),
      entry({ id: 'resolved-blocking', blocking: true, state: 'resolved', resolution: 'answered' }),
      entry({
        id: 'resolved-irrelevant',
        blocking: true,
        state: 'resolved',
        resolution: 'irrelevant',
      }),
    ];

    expect(decideInterrupt(buildInput({ ledger }))).toBeUndefined();
  });

  test('an open blocking unknown raises an interrupt naming itself and the remaining plan', () => {
    // Guard: the happy path — selection, remainingNodes slice, reason literal.
    const ledger = [entry({ id: 'cache-ttl', blocking: true, statement: 'TTL is undecided' })];

    const interrupt = decideInterrupt(buildInput({ ledger, currentNodeId: 'n2' }));

    expectInterrupt(interrupt, {
      reason: 'blocking_unknown',
      unknownId: 'cache-ttl',
      statement: 'TTL is undecided',
      affectedStepIds: [],
      remainingNodes: [
        { id: 'n3', promptId: 'p3', stepName: 'Review n3' },
        { id: 'n4', promptId: 'p4', stepName: 'Ship' },
      ],
      paused: false,
    });
  });

  test('affectedStepIds comes from DECLARED target_step_id links only (OQ-2)', () => {
    // Guard: collectAffectedStepIds reads `entry.targetStepId` and nothing else.
    //
    // The fixture is the plan's old OQ-2 close condition: `mentions-n3` names node `n3` inside
    // its free-text statement — and `n3`'s own stepName is 'Review n3', so a scanner over either
    // string would find it — while declaring no link. `declares-n4` declares one. Only the
    // declared link may appear.
    const ledger = [
      entry({
        id: 'mentions-n3',
        blocking: true,
        statement: 'unclear whether n3 still applies once the cache is warm',
      }),
      entry({ id: 'declares-n4', blocking: true, targetStepId: 'n4', discoveredAtStep: 2 }),
    ];

    const interrupt = decideInterrupt(buildInput({ ledger, currentNodeId: 'n2' }));

    expect(interrupt?.affectedStepIds).toEqual(['n4']);
    expect(interrupt?.affectedStepIds).not.toContain('n3');
  });

  test('a declared link is dropped when it is unknown to the run or already passed', () => {
    // Guard: collectAffectedStepIds' `ordinal === -1 || ordinal <= here` filter. `n1` is behind
    // the current node and `ghost` is not in the run at all; neither is re-plannable.
    const ledger = [
      entry({ id: 'behind', blocking: true, targetStepId: 'n1' }),
      entry({ id: 'current', blocking: true, targetStepId: 'n2' }),
      entry({ id: 'absent', blocking: true, targetStepId: 'ghost' }),
      entry({ id: 'ahead', blocking: true, targetStepId: 'n3' }),
    ];

    const interrupt = decideInterrupt(buildInput({ ledger, currentNodeId: 'n2' }));

    expect(interrupt?.affectedStepIds).toEqual(['n3']);
  });

  test('links from every open blocking unknown are collected, deduplicated, in run order', () => {
    // Guard: the `byOrdinal` map + ordinal sort. Declared out of run order and with a duplicate,
    // so both the dedup and the sort are load-bearing for this assertion.
    const ledger = [
      entry({ id: 'later', blocking: true, targetStepId: 'n4' }),
      entry({ id: 'earlier', blocking: true, targetStepId: 'n3' }),
      entry({ id: 'duplicate', blocking: true, targetStepId: 'n4' }),
      entry({ id: 'not-blocking', blocking: false, targetStepId: 'n2' }),
    ];

    expect(decideInterrupt(buildInput({ ledger }))?.affectedStepIds).toEqual(['n3', 'n4']);
  });

  test('the most recently discovered open blocking unknown is the one reported', () => {
    // Guard: selectTriggeringUnknown's `>=` comparison on discoveredAtStep. Declared oldest-last
    // so ledger order and discovery order disagree.
    const ledger = [
      entry({ id: 'fresh', blocking: true, discoveredAtStep: 3 }),
      entry({ id: 'stale', blocking: true, discoveredAtStep: 1 }),
    ];

    expect(decideInterrupt(buildInput({ ledger }))?.unknownId).toBe('fresh');
  });

  test('paused mirrors the pauseOnBlocking knob in both directions', () => {
    // Guard: `input.pauseOnBlocking === true`. Absent and explicit-false are the same posture
    // here — unlike maxInsertions, this knob has no server default to narrow.
    const ledger = [entry({ id: 'blocked', blocking: true })];

    expect(decideInterrupt(buildInput({ ledger }))?.paused).toBe(false);
    expect(decideInterrupt(buildInput({ ledger, pauseOnBlocking: false }))?.paused).toBe(false);
    expect(decideInterrupt(buildInput({ ledger, pauseOnBlocking: true }))?.paused).toBe(true);
  });

  test('a run past its terminal node has nothing remaining and nothing affected', () => {
    // Guard: currentOrdinal folding `null` into nodes.length + 1, in both slice and filter.
    const ledger = [entry({ id: 'blocked', blocking: true, targetStepId: 'n4' })];

    const interrupt = decideInterrupt(buildInput({ ledger, currentNodeId: null }));

    expectRemaining(interrupt?.remainingNodes, []);
    expect(interrupt?.affectedStepIds).toEqual([]);
  });

  test('the reserved gate id is the double-underscore form no authored gate can take', () => {
    // The id is a contract with the Python hook side, which carries the literal rather than an
    // import — so the literal is pinned here.
    expect(UNKNOWN_INTERRUPT_GATE_ID).toBe('__unknown_interrupt__');
  });
});
