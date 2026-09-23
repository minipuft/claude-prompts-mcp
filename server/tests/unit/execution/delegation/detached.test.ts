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
  describeDetachedReview,
  describeDetachedReviewOutcome,
  describeHeldRun,
  resolveDetachedReport,
} from '../../../../src/engine/execution/delegation/detached.js';
import { unreportedDetachedNodeIds } from '../../../../src/shared/types/chain-execution.js';
import {
  detachedNodesHoldingRun,
  isRunComplete,
  isRunHeldOpen,
} from '../../../../src/shared/types/chain-session.js';

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
    expect(isRunHeldOpen({ state })).toBe(true);
    expect(isRunComplete({ state })).toBe(false);
  });

  test('a run past its end that owes nothing is complete (control)', () => {
    const state = pastEnd(states([['rev', spawned({ state: 'completed' })]]));
    expect(isRunHeldOpen({ state })).toBe(false);
    expect(isRunComplete({ state })).toBe(true);
  });

  test('a reported node whose gate review is open still holds the run (row 4.8)', () => {
    // Same run as the control above — reported, nothing owed — plus an open detached review.
    const state = pastEnd(states([['rev', spawned({ state: 'completed' })]]));
    const reviews = { rev: { kind: 'detached' as const } };
    expect(detachedNodesHoldingRun({ state, reviews })).toEqual(['rev']);
    expect(isRunHeldOpen({ state, reviews })).toBe(true);
    expect(isRunComplete({ state, reviews })).toBe(false);
    // A node both owed and under review is named once.
    const owedToo = pastEnd(states([['rev', spawned()]]));
    expect(detachedNodesHoldingRun({ state: owedToo, reviews })).toEqual(['rev']);
    // Only a DETACHED review holds the run: the store's current-step review is not a hold.
    expect(detachedNodesHoldingRun({ state, reviews: { rev: { kind: 'gate' as const } } })).toEqual(
      []
    );
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
      { state: { nodes: NODES, stepStates: states([['rev', spawned({ state: 'completed' })]]) } }
    );
    expect(facts).toEqual([
      { token: 'rev', nodeId: 'rev', stepNumber: 2, spawned: true, reported: true },
      // No node id on the step: resolved by position, token by the shared `n<ordinal>` fallback.
      { token: 'n3', nodeId: 'n3', stepNumber: 3, spawned: false, reported: false },
    ]);
  });

  test("reads an open review's phase off the node's review record, by node (row 4.8, 3.5)", () => {
    const run = (review?: Record<string, unknown>) => ({
      state: { nodes: NODES, stepStates: states([['rev', spawned({ state: 'completed' })]]) },
      ...(review !== undefined ? { reviews: { rev: review as never } } : {}),
    });
    const steps = [{ stepNumber: 2, nodeId: 'rev', await: 'run' as const }];
    const detached = (phase: string, metadata?: Record<string, unknown>) =>
      run({ kind: 'detached', phase, ...(metadata !== undefined ? { metadata } : {}) });

    expect(collectDetachedNodeFacts(steps, detached('awaiting-verdict'))[0]?.review).toBe(
      'awaiting-verdict'
    );
    expect(collectDetachedNodeFacts(steps, detached('awaiting-replacement'))[0]?.review).toBe(
      'awaiting-replacement'
    );
    expect(collectDetachedNodeFacts(steps, detached('exhausted'))[0]?.review).toBe('exhausted');
    // The record's phase decides; a `metadata.phase` that disagrees with it is never read.
    expect(
      collectDetachedNodeFacts(steps, detached('exhausted', { phase: 'awaiting-verdict' }))[0]
        ?.review
    ).toBe('exhausted');
    // No review, or a review that is not the node's detached one: no phase key at all.
    expect(collectDetachedNodeFacts(steps, run())[0]).not.toHaveProperty('review');
    expect(
      collectDetachedNodeFacts(steps, run({ kind: 'gate', phase: 'awaiting-verdict' }))[0]
    ).not.toHaveProperty('review');
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

  test('a trailer naming the CURRENT node: a detached one reports (row 4.8), any other is the ordinary capture', () => {
    // Early arrival: the detached node's result before the parent moved on lands like a late one,
    // so it is reviewed in the same place.
    const detachedCurrent = { token: 'rev', delegated: true, detached: true };
    expect(
      resolveDetachedReport({ ...base, reply: trailer('rev'), current: detachedCurrent })
    ).toEqual({ kind: 'report', node: owed });
    // Control: the same token on a delegated, NOT detached current node is its own capture.
    const blockingCurrent = { token: 'n3', delegated: true, detached: false };
    expect(
      resolveDetachedReport({
        ...base,
        detachedNodes: [{ ...owed, token: 'n3' }, owed],
        reply: trailer('n3'),
        current: blockingCurrent,
      })
    ).toEqual({ kind: 'not-detached' });
  });

  test('standing on a detached node that already reported: an empty resume passes it', () => {
    const current = { token: 'rev', delegated: true, detached: true };
    const reported = { ...owed, reported: true };
    expect(
      resolveDetachedReport({ ...base, detachedNodes: [reported], reply: '', current })
    ).toEqual({ kind: 'continue-past', node: reported });
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
    // A gate review holding the run owns the advance: nothing detached happens on this call.
    expect(resolveDetachedReport({ ...base, reply: '', current, reviewPending: true })).toEqual({
      kind: 'review-pending',
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

describe('resolveDetachedReport: a reported node under gate review (row 4.8)', () => {
  const trailer = (token: string) => `HANDOFF RESULT\nnode: ${token}`;
  const plain = { token: 'n3', delegated: false, detached: false };
  const underReview = (review?: DetachedNodeFacts['review']): DetachedNodeFacts => ({
    token: 'rev',
    nodeId: 'rev',
    stepNumber: 2,
    spawned: true,
    reported: true,
    ...(review !== undefined ? { review } : {}),
  });
  const route = (
    node: DetachedNodeFacts,
    submits: { verdict: boolean; action: boolean },
    reply = trailer('rev')
  ) =>
    resolveDetachedReport({
      reply,
      mode: 'required',
      current: plain,
      detachedNodes: [node],
      submits,
    });
  const none = { verdict: false, action: false };
  const verdict = { verdict: true, action: false };
  const action = { verdict: false, action: true };
  const message = (decision: ReturnType<typeof route>): string =>
    decision.kind === 'refuse' ? decision.message : `<${decision.kind}>`;

  test('each phase admits exactly the call it waits for', () => {
    expect(route(underReview('awaiting-verdict'), verdict)).toEqual({
      kind: 'review-verdict',
      node: underReview('awaiting-verdict'),
    });
    expect(route(underReview('awaiting-replacement'), none)).toEqual({
      kind: 'report',
      node: underReview('awaiting-replacement'),
      replaces: true,
    });
    expect(route(underReview('exhausted'), action)).toEqual({
      kind: 'review-action',
      node: underReview('exhausted'),
    });
  });

  test('anything else is refused by name, naming the call the phase waits for', () => {
    expect(message(route(underReview('awaiting-verdict'), none))).toContain(
      'waiting for a gate_verdict'
    );
    expect(message(route(underReview('awaiting-replacement'), verdict))).toContain(
      "worker's replacement result"
    );
    expect(message(route(underReview('exhausted'), verdict))).toContain('gate_action "retry"');
    expect(message(route(underReview('awaiting-verdict'), none))).toContain('node: rev');
  });

  test('"already reported" stands when no review is open; a verdict there is refused as reviewless', () => {
    expect(message(route(underReview(), none))).toContain('rev (step 2) already reported');
    expect(message(route(underReview(), verdict))).toContain('No gate review is open');
  });

  test('a verdict naming an unknown node gets the unknown-token refusal, never the current step', () => {
    expect(message(route(underReview('awaiting-verdict'), verdict, trailer('zzz')))).toContain(
      'names node zzz, which is no detached node of this run'
    );
  });

  test('a verdict with no trailer is not routed to a detached review', () => {
    // The current step's verdict: the detached router leaves it alone entirely.
    const current = { token: 'n3', delegated: false, detached: false };
    expect(
      resolveDetachedReport({
        reply: '',
        mode: 'required',
        current,
        detachedNodes: [underReview('awaiting-verdict')],
        submits: verdict,
      })
    ).toEqual({ kind: 'not-detached' });
  });
});

describe('describeHeldRun: reviews still open', () => {
  test('a held run with nothing owed but an open review names the review, not a report', () => {
    const text = describeHeldRun([
      {
        token: 'a',
        nodeId: 'a',
        stepNumber: 2,
        spawned: true,
        reported: true,
        review: 'awaiting-verdict',
      },
    ]);
    expect(text).toContain('until its detached review(s) are answered');
    expect(text).toContain('Gate review still open on reported detached node(s): a (step 2)');
    expect(text).not.toMatch(/[Cc]hain complete|Execution complete/);
  });
});

describe('the words a detached review says (row 3.8)', () => {
  const node: DetachedNodeFacts = {
    token: 'rev',
    nodeId: 'rev',
    stepNumber: 2,
    spawned: true,
    reported: true,
  };
  const outcome = (result: 'cleared' | 'passed') =>
    describeDetachedReviewOutcome(node, {
      result,
      attempt: 1,
      maxAttempts: 2,
      runCompleted: false,
      held: false,
      detachedNodes: [node],
    });

  test('an advisory FAIL is cleared: it says the gate failed, is not blocking, and the result stands', () => {
    const text = outcome('cleared');
    expect(text.split('\n\n')[0]).toBe(
      '⚠ Gate review of detached node rev (step 2) failed (attempt 1/2), but its gates are not ' +
        'blocking: its recorded result stands.'
    );
    expect(text).not.toContain('passed');
    // Twin: a PASS keeps its own head.
    expect(outcome('passed')).toContain('✓ Gate review of detached node rev (step 2) passed');
  });

  test('a review opened on a result missing sections names each one; a sectioned one names none', () => {
    const review = { chainId: 'c', attempt: 1, maxAttempts: 2, verdictTemplate: '{}' };
    const missing = describeDetachedReview(node, {
      ...review,
      structuralHints: ['Ensure your response includes the required "## Context" section'],
    });
    expect(missing).toContain('The reported result is missing required structure:');
    expect(missing).toContain('- Ensure your response includes the required "## Context" section');
    expect(describeDetachedReview(node, { ...review, structuralHints: [] })).not.toContain(
      'missing required structure'
    );
  });
});
