// @lifecycle test - Tier 4: the pure half of detached delegation — owed nodes, routing, held-run words.
/**
 * `delegation/detached.ts` decides what a resume means for a run's detached nodes, and
 * `unreportedDetachedNodeIds` / `isRunComplete` decide what the run is owed. Both are pure, so
 * every branch is asserted here directly; the pipeline half is
 * `tests/integration/chain/delegation-detached.integration.test.ts`.
 */

import { describe, expect, test } from '@jest/globals';

import {
  collectDetachedNodeFacts,
  describeHeldRun,
  resolveDetachedReport,
} from '../../../../src/engine/execution/delegation/detached.js';
import { unreportedDetachedNodeIds } from '../../../../src/shared/types/chain-execution.js';
import { isRunComplete, isRunHeldOpen } from '../../../../src/shared/types/chain-session.js';

import type { DetachedNodeFacts } from '../../../../src/engine/execution/delegation/detached.js';
import type { StepMetadata } from '../../../../src/shared/types/chain-execution.js';

const NODES = [{ id: 'n1' }, { id: 'rev' }, { id: 'n3' }];

const states = (entries: Array<[string, StepMetadata]>) => new Map(entries);
const spawned = (extra: Partial<StepMetadata> = {}): StepMetadata => ({
  state: 'working',
  isPlaceholder: false,
  spawnedAt: 1,
  ...extra,
});

describe('unreportedDetachedNodeIds', () => {
  test('owes a spawned node until it holds a real output', () => {
    expect(unreportedDetachedNodeIds(NODES, states([['rev', spawned()]]))).toEqual(['rev']);
    expect(
      unreportedDetachedNodeIds(
        NODES,
        states([['rev', spawned({ state: 'completed', isPlaceholder: true })]])
      )
    ).toEqual(['rev']);
    expect(
      unreportedDetachedNodeIds(
        NODES,
        states([['rev', spawned({ state: 'completed', isPlaceholder: false })]])
      )
    ).toEqual([]);
  });

  test('never owes a node that was not spawned, or that was retired', () => {
    // A detached node the run never reached — and a blocking node passed as a placeholder — are
    // owed nothing, so neither can hold a run open.
    expect(
      unreportedDetachedNodeIds(
        NODES,
        states([['rev', { state: 'completed', isPlaceholder: true }]])
      )
    ).toEqual([]);
    expect(
      unreportedDetachedNodeIds(NODES, states([['rev', spawned({ state: 'skipped' })]]))
    ).toEqual([]);
    expect(unreportedDetachedNodeIds(NODES, undefined)).toEqual([]);
  });
});

describe('isRunComplete / isRunHeldOpen', () => {
  const pastEnd = (stepStates?: Map<string, StepMetadata>) => ({
    currentNodeId: null,
    nodes: NODES,
    ...(stepStates ? { stepStates } : {}),
  });

  test('a run past its end that owes a detached report is held, not complete', () => {
    const state = pastEnd(states([['rev', spawned()]]));
    expect(isRunHeldOpen(state)).toBe(true);
    expect(isRunComplete({ state })).toBe(false);
  });

  test('a run past its end that owes nothing is complete (control)', () => {
    const state = pastEnd(states([['rev', spawned({ state: 'completed' })]]));
    expect(isRunHeldOpen(state)).toBe(false);
    expect(isRunComplete({ state })).toBe(true);
  });

  test('a terminal status is complete regardless of what is owed', () => {
    const state = pastEnd(states([['rev', spawned()]]));
    expect(isRunComplete({ runStatus: 'cancelled', state })).toBe(true);
  });
});

describe('collectDetachedNodeFacts', () => {
  test('reads the declaration off the steps and the lifecycle off the run', () => {
    const facts = collectDetachedNodeFacts(
      [
        { stepNumber: 1, nodeId: 'n1' },
        { stepNumber: 2, nodeId: 'rev', await: 'run' },
        { stepNumber: 3, await: 'run' },
      ],
      { nodes: NODES, stepStates: states([['rev', spawned({ state: 'completed' })]]) }
    );
    expect(facts).toEqual([
      { token: 'rev', nodeId: 'rev', stepNumber: 2, spawned: true, reported: true },
      // No node id on the step: resolved by position, token by the shared `n<ordinal>` fallback.
      { token: 'n3', nodeId: 'n3', stepNumber: 3, spawned: false, reported: false },
    ]);
  });
});

describe('resolveDetachedReport', () => {
  const owed: DetachedNodeFacts = {
    token: 'rev',
    nodeId: 'rev',
    stepNumber: 2,
    spawned: true,
    reported: false,
  };
  const trailer = (token: string) => `the work\n\nHANDOFF RESULT\nnode: ${token}`;
  const plain = { token: 'n3', delegated: false, detached: false };
  const base = { mode: 'required' as const, detachedNodes: [owed] };

  test('a run with no detached node is never touched — blocking chains are unchanged', () => {
    expect(
      resolveDetachedReport({
        reply: trailer('zzz'),
        mode: 'required',
        current: plain,
        detachedNodes: [],
      })
    ).toEqual({ kind: 'not-detached' });
  });

  test('a trailer naming a spawned, unreported detached node routes there', () => {
    expect(resolveDetachedReport({ ...base, reply: trailer('rev'), current: plain })).toEqual({
      kind: 'report',
      node: owed,
    });
    expect(resolveDetachedReport({ ...base, reply: trailer('rev'), current: null })).toEqual({
      kind: 'report',
      node: owed,
    });
  });

  test('a trailer naming the CURRENT node is the ordinary capture', () => {
    const current = { token: 'rev', delegated: true, detached: true };
    expect(resolveDetachedReport({ ...base, reply: trailer('rev'), current })).toEqual({
      kind: 'not-detached',
    });
  });

  test('already-reported and never-spawned nodes are refused by name', () => {
    const reported = resolveDetachedReport({
      ...base,
      detachedNodes: [{ ...owed, reported: true }],
      reply: trailer('rev'),
      current: plain,
    });
    expect(reported).toMatchObject({ kind: 'refuse' });
    expect(reported.kind === 'refuse' && reported.message).toContain(
      'rev (step 2) already reported'
    );

    const unspawned = resolveDetachedReport({
      ...base,
      detachedNodes: [{ ...owed, spawned: false }],
      reply: trailer('rev'),
      current: plain,
    });
    expect(unspawned.kind === 'refuse' && unspawned.message).toContain('has not been spawned yet');
  });

  test('an unknown token is refused — unless the current node is delegated, whose own check names it', () => {
    const refused = resolveDetachedReport({ ...base, reply: trailer('zzz'), current: plain });
    expect(refused.kind === 'refuse' && refused.message).toContain('names node zzz');
    expect(refused.kind === 'refuse' && refused.message).toContain('waiting for a result: rev');

    const delegatedCurrent = { token: 'n3', delegated: true, detached: false };
    expect(
      resolveDetachedReport({ ...base, reply: trailer('zzz'), current: delegatedCurrent })
    ).toEqual({
      kind: 'not-detached',
    });
  });

  test('a held run refuses a reply that reports nothing, naming what it is owed', () => {
    const refused = resolveDetachedReport({ ...base, reply: '', current: null });
    expect(refused.kind === 'refuse' && refused.message).toContain('rev (step 2)');
    expect(refused.kind === 'refuse' && refused.message).toContain('node: rev');
  });

  test('standing on a spawned detached node: empty moves past, text is refused under required only', () => {
    const current = { token: 'rev', delegated: true, detached: true };
    expect(resolveDetachedReport({ ...base, reply: '', current })).toEqual({
      kind: 'continue-past',
      node: owed,
    });
    const refused = resolveDetachedReport({ ...base, reply: 'spawned it', current });
    expect(refused.kind === 'refuse' && refused.message).toContain('is detached');
    expect(
      resolveDetachedReport({ ...base, mode: 'advisory', reply: 'spawned it', current })
    ).toEqual({
      kind: 'not-detached',
    });
  });
});

describe('describeHeldRun', () => {
  test('names every owed node and never uses the completion wording hooks key on', () => {
    const text = describeHeldRun([
      { token: 'a', nodeId: 'a', stepNumber: 2, spawned: true, reported: false },
      { token: 'b', nodeId: 'b', stepNumber: 3, spawned: true, reported: false },
      { token: 'c', nodeId: 'c', stepNumber: 4, spawned: true, reported: true },
    ]);
    expect(text).toContain('a (step 2), b (step 3)');
    expect(text).not.toContain('c (step 4)');
    expect(text).toContain('cancel: true');
    expect(text).not.toMatch(/[Cc]hain complete|Execution complete/);
  });
});
