// @lifecycle canonical - Exhaustive branch coverage for the P4 adaptive chain-mutation decision.
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  decideMutation,
  investigatedUnknownIds,
  MAX_INSERTIONS_PER_RUN,
} from '../../../../src/engine/execution/pipeline/decisions/mutation/index.js';

import { ChainSessionStore } from '../../../../src/modules/chains/manager.js';

import type {
  ChainMutation,
  DecideMutationInput,
} from '../../../../src/engine/execution/pipeline/decisions/mutation/index.js';
import type { ChainNode } from '../../../../src/shared/types/chain-execution.js';
import type {
  UnknownLedgerEntry,
  UnknownObservation,
} from '../../../../src/shared/types/chain-session.js';

/**
 * Every `ChainMutation.kind` and every `MutationNoneReason` gets its own named test, plus the
 * two caps (per-unknown vs per-run are separate rejection paths) and insert-vs-skip precedence
 * — 9 criteria total. Each test's comment names the guard in `mutation-policy.ts` it exercises,
 * so a future regression review can map a failing test straight back to the line that broke.
 */
const NODES = ['n1', 'n2', 'n3', 'n4'];

function discover(id: string, overrides: Partial<UnknownObservation> = {}): UnknownObservation {
  return {
    type: 'unknown_discovered',
    id,
    statement: `${id} is undecided`,
    ...overrides,
  };
}

function resolveIrrelevant(id: string): UnknownObservation {
  return {
    type: 'unknown_resolved',
    id,
    statement: `${id} turned out not to matter`,
    resolution: 'irrelevant',
  };
}

function ledgerEntry(overrides: Partial<UnknownLedgerEntry> & { id: string }): UnknownLedgerEntry {
  return {
    statement: `${overrides.id} statement`,
    state: 'active',
    blocking: false,
    discoveredAtStep: 1,
    ...overrides,
  };
}

function buildInput(overrides: Partial<DecideMutationInput> = {}): DecideMutationInput {
  return {
    delta: [],
    ledger: [],
    nodes: NODES,
    currentNodeId: 'n1',
    insertedCount: 0,
    insertedUnknownIds: [],
    ...overrides,
  };
}

/**
 * `expect(x).toEqual<T>(...)` generic call syntax is not supported by this repo's
 * `@jest/globals` type definitions (`tsc` rejects it with TS2558 — confirmed via
 * `typecheck:tests:ratchet`, D-T1-2). Routing every assertion through a helper typed on
 * `expected: ChainMutation` keeps the same compile-time shape-checking `toEqual<ChainMutation>`
 * would have given, without depending on generic-method support `expect()` doesn't have here.
 */
function expectMutation(actual: ChainMutation, expected: ChainMutation): void {
  expect(actual).toEqual(expected);
}

describe('decideMutation', () => {
  test('insert_investigation: a blocking discovery with no cap issue inserts after currentNodeId', () => {
    // Guard: decideInsertion's `entry?.blocking !== true` continue + both cap checks passing.
    const observation = discover('cache-ttl', { blocking: true });
    const result = decideMutation(
      buildInput({
        delta: [observation],
        ledger: [ledgerEntry({ id: 'cache-ttl', blocking: true })],
        currentNodeId: 'n2',
      })
    );

    expectMutation(result, {
      kind: 'insert_investigation',
      afterNodeId: 'n2',
      unknownId: 'cache-ttl',
      statement: observation.statement,
    });
  });

  test('skip_node: an irrelevant resolution with a valid, strictly-ahead target skips it', () => {
    // Guard: decideSkip's targetOrdinal !== -1 and targetOrdinal > current branches.
    const result = decideMutation(
      buildInput({
        delta: [resolveIrrelevant('cache-ttl')],
        ledger: [
          ledgerEntry({
            id: 'cache-ttl',
            state: 'resolved',
            resolution: 'irrelevant',
            targetStepId: 'n3',
          }),
        ],
        currentNodeId: 'n1',
      })
    );

    expectMutation(result, {
      kind: 'skip_node',
      nodeId: 'n3',
      unknownId: 'cache-ttl',
    });
  });

  test('none/no-trigger: neither a blocking discovery nor an irrelevant resolution is present', () => {
    // Guard: decideInsertion returns undefined (no blocking entry match) AND decideSkip
    // returns undefined (no observation with resolution === 'irrelevant') — decideMutation
    // falls through to its own default.
    const nonBlocking = decideMutation(
      buildInput({
        delta: [discover('cache-ttl', { blocking: false })],
        ledger: [ledgerEntry({ id: 'cache-ttl', blocking: false })],
      })
    );
    const empty = decideMutation(buildInput({ delta: [] }));
    const answeredResolution = decideMutation(
      buildInput({
        delta: [
          { type: 'unknown_resolved', id: 'x', statement: 'answered', resolution: 'answered' },
        ],
        ledger: [ledgerEntry({ id: 'x', state: 'resolved', resolution: 'answered' })],
      })
    );

    expectMutation(nonBlocking, { kind: 'none', reason: 'no-trigger' });
    expectMutation(empty, { kind: 'none', reason: 'no-trigger' });
    expectMutation(answeredResolution, { kind: 'none', reason: 'no-trigger' });
  });

  test('none/cap-reached (per-unknown): an id already in insertedUnknownIds is rejected even under the run cap', () => {
    // Guard: decideInsertion's `insertedUnknownIds.includes(observation.id)` branch, checked
    // BEFORE the run-wide count so a dedup rejection cannot be confused with a run-cap one from
    // input alone — distinguished here by insertedCount being far under MAX_INSERTIONS_PER_RUN.
    const result = decideMutation(
      buildInput({
        delta: [discover('cache-ttl', { blocking: true })],
        ledger: [ledgerEntry({ id: 'cache-ttl', blocking: true })],
        insertedUnknownIds: ['cache-ttl'],
        insertedCount: 1,
      })
    );

    expectMutation(result, { kind: 'none', reason: 'cap-reached' });
  });

  test('none/cap-reached (3-per-run): a fresh, never-inserted unknown is still rejected once insertedCount hits the run cap', () => {
    // Guard: decideInsertion's `insertedCount >= MAX_INSERTIONS_PER_RUN` branch — this id is
    // NOT in insertedUnknownIds, isolating the run-wide cap from the per-unknown one above.
    expect(MAX_INSERTIONS_PER_RUN).toBe(3);

    const result = decideMutation(
      buildInput({
        delta: [discover('brand-new-unknown', { blocking: true })],
        ledger: [ledgerEntry({ id: 'brand-new-unknown', blocking: true })],
        insertedUnknownIds: ['unrelated-1', 'unrelated-2', 'unrelated-3'],
        insertedCount: MAX_INSERTIONS_PER_RUN,
      })
    );

    expectMutation(result, { kind: 'none', reason: 'cap-reached' });
  });

  describe('a submission-declared maxInsertions NARROWS the run cap, never widens it (P6 Tier 5)', () => {
    const blockingDiscovery = (): Partial<DecideMutationInput> => ({
      delta: [discover('cache-ttl', { blocking: true })],
      ledger: [ledgerEntry({ id: 'cache-ttl', blocking: true })],
    });

    test('a declared cap of 1 stops the SECOND insertion, which the server default would allow', () => {
      // Discriminating: insertedCount 1 is well under MAX_INSERTIONS_PER_RUN, so without the
      // declared cap this input inserts. The bound is seeded PAST the declared value and under
      // the server one — a fixture inside both bounds could not fail.
      expectMutation(
        decideMutation(buildInput({ ...blockingDiscovery(), insertedCount: 1, maxInsertions: 1 })),
        { kind: 'none', reason: 'cap-reached' }
      );
    });

    test('a declared cap of 0 opts the run out of insertion entirely', () => {
      expectMutation(
        decideMutation(buildInput({ ...blockingDiscovery(), insertedCount: 0, maxInsertions: 0 })),
        { kind: 'none', reason: 'cap-reached' }
      );
    });

    test('a declared cap ABOVE the server ceiling does not widen it', () => {
      // The validator rejects a widening budget at submit time, but this function is the last
      // place the ceiling is applied and must hold on its own.
      expectMutation(
        decideMutation(
          buildInput({
            ...blockingDiscovery(),
            insertedCount: MAX_INSERTIONS_PER_RUN,
            maxInsertions: MAX_INSERTIONS_PER_RUN + 50,
          })
        ),
        { kind: 'none', reason: 'cap-reached' }
      );
    });

    test('an undeclared cap leaves the server default in force', () => {
      // Bounds the narrowing: a cap that always applied would make every run refuse insertion.
      const result = decideMutation(buildInput({ ...blockingDiscovery(), insertedCount: 1 }));
      expect(result.kind).toBe('insert_investigation');
    });

    test('a declared cap still under-run allows the insertion', () => {
      const result = decideMutation(
        buildInput({ ...blockingDiscovery(), insertedCount: 1, maxInsertions: 2 })
      );
      expect(result.kind).toBe('insert_investigation');
    });
  });

  test('none/target-absent (no target declared): an irrelevant resolution whose ledger entry never named a target', () => {
    // Guard: decideSkip's `targetStepId === undefined` branch. This is the discriminating
    // probe: the entry WAS resolved irrelevant (a real candidate was found and processed), so a
    // 'no-trigger' or a crash here would mean the input was silently dropped rather than
    // evaluated and rejected.
    const result = decideMutation(
      buildInput({
        delta: [resolveIrrelevant('cache-ttl')],
        ledger: [ledgerEntry({ id: 'cache-ttl', state: 'resolved', resolution: 'irrelevant' })],
      })
    );

    expectMutation(result, { kind: 'none', reason: 'target-absent' });
  });

  test('none/target-absent (dangling target): a declared target that no longer exists among nodes', () => {
    // Guard: decideSkip's `ordinalOf(...) === -1` branch, distinct from the undefined-target
    // branch above — the entry DOES carry a targetStepId, it just does not resolve to a node.
    const result = decideMutation(
      buildInput({
        delta: [resolveIrrelevant('cache-ttl')],
        ledger: [
          ledgerEntry({
            id: 'cache-ttl',
            state: 'resolved',
            resolution: 'irrelevant',
            targetStepId: 'ghost-node',
          }),
        ],
      })
    );

    expectMutation(result, { kind: 'none', reason: 'target-absent' });
  });

  test('none/target-passed (OQ-P4-2): a target at-or-behind currentNodeId is rejected, including the current node itself', () => {
    // Guard: decideSkip's `targetOrdinal <= current` branch. Targeting currentNodeId itself
    // (ordinal equal, not just behind) is the specific case OQ-P4-2 rules out — the policy may
    // never skip the node the client is currently rendering.
    const targetsCurrentNode = decideMutation(
      buildInput({
        delta: [resolveIrrelevant('cache-ttl')],
        ledger: [
          ledgerEntry({
            id: 'cache-ttl',
            state: 'resolved',
            resolution: 'irrelevant',
            targetStepId: 'n2',
          }),
        ],
        currentNodeId: 'n2',
      })
    );
    const targetsPastNode = decideMutation(
      buildInput({
        delta: [resolveIrrelevant('cache-ttl')],
        ledger: [
          ledgerEntry({
            id: 'cache-ttl',
            state: 'resolved',
            resolution: 'irrelevant',
            targetStepId: 'n1',
          }),
        ],
        currentNodeId: 'n3',
      })
    );

    expectMutation(targetsCurrentNode, { kind: 'none', reason: 'target-passed' });
    expectMutation(targetsPastNode, { kind: 'none', reason: 'target-passed' });
  });

  test('insert-precedence: a delta qualifying for both insert and skip returns insert, never skip', () => {
    // Guard: decideMutation's early return on decideInsertion's result — decideSkip is never
    // even reached when a qualifying blocking discovery is present. Isolated from the
    // no-trigger/cap tests above by making BOTH candidates fully valid and uncapped.
    const discovery = discover('cache-ttl', { blocking: true });
    const result = decideMutation(
      buildInput({
        delta: [discovery, resolveIrrelevant('other-unknown')],
        ledger: [
          ledgerEntry({ id: 'cache-ttl', blocking: true }),
          ledgerEntry({
            id: 'other-unknown',
            state: 'resolved',
            resolution: 'irrelevant',
            targetStepId: 'n3',
          }),
        ],
        currentNodeId: 'n1',
      })
    );

    expectMutation(result, {
      kind: 'insert_investigation',
      afterNodeId: 'n1',
      unknownId: 'cache-ttl',
      statement: discovery.statement,
    });
  });
});

/**
 * P6.241 (R127): the per-unknown-id cap counts steps inserted since the unknown's CURRENT
 * discovery. A re-open is a new declaration, so a step inserted before the unknown was resolved
 * no longer answers it.
 */
describe('investigatedUnknownIds (R127)', () => {
  const planned = (id: string): ChainNode => ({
    id,
    promptId: id,
    stepName: id,
    origin: 'planned',
  });
  const inserted = (id: string, unknownId: string): ChainNode => ({
    id,
    promptId: 'investigate_unknown',
    stepName: 'Investigate',
    origin: 'inserted',
    originUnknownId: unknownId,
  });
  // Declared at n1 (ordinal 1) and investigated at ordinal 2; resolved; re-opened at n2
  // (ordinal 3) beside a new unknown declared there, whose step sits at ordinal 4.
  const nodes = [
    planned('n1'),
    inserted('inv-old', 'old'),
    planned('n2'),
    inserted('inv-new', 'new'),
    planned('n3'),
  ];
  const ledger = [
    ledgerEntry({ id: 'old', blocking: true, discoveredAtStep: 3 }),
    ledgerEntry({ id: 'new', blocking: true, discoveredAtStep: 3 }),
  ];

  test('(a) a re-opened unknown whose only step predates the re-open gets a new step', () => {
    expect([...investigatedUnknownIds(ledger, nodes, 'inserted')]).toEqual(['new']);
    expectMutation(
      decideMutation(
        buildInput({
          delta: [discover('old', { blocking: true })],
          ledger,
          nodes,
          currentNodeId: 'inv-new',
          insertedCount: 2,
          insertedUnknownIds: [...investigatedUnknownIds(ledger, nodes, 'inserted')],
        })
      ),
      {
        kind: 'insert_investigation',
        afterNodeId: 'inv-new',
        unknownId: 'old',
        statement: 'old is undecided',
      }
    );
  });

  test('(b) control: an unknown with a step since its discovery keeps the per-id cap', () => {
    expectMutation(
      decideMutation(
        buildInput({
          delta: [discover('new', { blocking: true })],
          ledger,
          nodes,
          currentNodeId: 'inv-new',
          insertedCount: 2,
          insertedUnknownIds: [...investigatedUnknownIds(ledger, nodes, 'inserted')],
        })
      ),
      { kind: 'none', reason: 'cap-reached' }
    );
    // And once the re-opened one has its new step, it is investigated again.
    const withNew = [...nodes.slice(0, 4), inserted('inv-old-2', 'old'), planned('n3')];
    expect([...investigatedUnknownIds(ledger, withNew, 'inserted')].sort()).toEqual(['new', 'old']);
  });
});

/**
 * P6.248 (R133): the per-unknown-id REMAINDER cap reads the same comparison, over
 * `origin: 'remainder'` nodes. Driven end to end in `chain-prompt-sources.e2e.test.ts` (P6.248).
 * Since P6.253 (R136) a remainder is read by its acceptance stamp, not its ordinal (P6.253 there).
 */
describe('investigatedUnknownIds over remainders (R133)', () => {
  const node = (
    id: string,
    origin: ChainNode['origin'],
    unknownId?: string,
    acceptedAtStep?: number
  ): ChainNode => ({
    id,
    promptId: id,
    stepName: id,
    origin,
    ...(unknownId === undefined ? {} : { originUnknownId: unknownId }),
    ...(acceptedAtStep === undefined ? {} : { acceptedAtStep }),
  });
  // `u` declared at n1, investigated at 2, rewritten as [r1, r2] while standing on inv-u (2),
  // resolved, re-opened at r2 (4).
  const nodes = [
    node('n1', 'planned'),
    node('inv-u', 'inserted', 'u'),
    node('r1', 'remainder', 'u', 2),
    node('r2', 'remainder', 'u', 2),
    node('inv-u-2', 'inserted', 'u'),
  ];

  test('(a) a remainder at or before the current discovery does not spend the re-opened one', () => {
    const ledger = [ledgerEntry({ id: 'u', blocking: true, discoveredAtStep: 4 })];
    expect([...investigatedUnknownIds(ledger, nodes, 'remainder')]).toEqual([]);
    // The origin is part of the question: the insertion at ordinal 5 answers `u`, for insertions.
    expect([...investigatedUnknownIds(ledger, nodes, 'inserted')]).toEqual(['u']);
  });

  test('(b) control: a remainder past the current discovery keeps the per-id cap', () => {
    const ledger = [ledgerEntry({ id: 'u', blocking: true, discoveredAtStep: 1 })];
    expect([...investigatedUnknownIds(ledger, nodes, 'remainder')]).toEqual(['u']);
    // And an id the ledger no longer holds still counts its remainder.
    expect([...investigatedUnknownIds([], nodes, 'remainder')]).toEqual(['u']);
  });

  /**
   * P6.253 (R136), the P6.248 limit pin inverted. The ordinal is an exact stamp for an insertion,
   * not for an `append`: an appended remainder stands at the end of the run. Until 2026-09-28 one
   * accepted before the re-open still counted while the run had not walked past it; the persisted
   * acceptance stamp (`accepted_at_step`) is what the comparator reads for a remainder now.
   */
  test('(c) an earlier remainder still ahead of the run does not count against the re-opened unknown', () => {
    // Appended while standing on n1 (1); `u` re-opened on n2 (2); r1 still ahead at ordinal 3.
    const ahead = [node('n1', 'planned'), node('n2', 'planned'), node('r1', 'remainder', 'u', 1)];
    const ledger = [ledgerEntry({ id: 'u', blocking: true, discoveredAtStep: 2 })];
    expect([...investigatedUnknownIds(ledger, ahead, 'remainder')]).toEqual([]);
    // Control: the same remainder accepted standing on n2 answers the current declaration.
    const current = [node('n1', 'planned'), node('n2', 'planned'), node('r1', 'remainder', 'u', 2)];
    expect([...investigatedUnknownIds(ledger, current, 'remainder')]).toEqual(['u']);
  });

  test('(d) a remainder with no acceptance stamp keeps counting, so the cap stays shut', () => {
    const unstamped = [node('n1', 'planned'), node('n2', 'planned'), node('r1', 'remainder', 'u')];
    const ledger = [ledgerEntry({ id: 'u', blocking: true, discoveredAtStep: 2 })];
    expect([...investigatedUnknownIds(ledger, unstamped, 'remainder')]).toEqual(['u']);
  });
});

/**
 * P6.252 (R134): the two ordering rules R127's and R133's comparison stands on, pinned on the store
 * that enforces them — `ChainSessionStore.insertNodeAfter` and `replaceRemainder`. Each pin drives
 * the real store and then asks the comparator about the node it produced.
 *
 * as of 2026-09-28 · the flip condition ARRIVED with P6.253 (R136): a remainder now carries a
 * persisted acceptance stamp (`accepted_at_step`), and the comparator reads that for remainders.
 * What still holds: (a) an INSERTED node's ordinal is its stamp, which is true only while nothing
 * lands at or before the node the run stands on; (b) a remainder never displaces the node the run
 * stands on, so the ordinal its stamp records keeps naming the node it was accepted on. Flips when
 * an inserted node carries a persisted stamp of its own (then rule (a) stops being load-bearing).
 */
describe('the ordering rules the ordinal stamp relies on (R134)', () => {
  let store: ChainSessionStore | undefined;
  const spies: Array<{ mockRestore(): void }> = [];

  beforeEach(() => {
    // No database: persistence is spied out, the node list is the store's own in-memory state.
    const proto = ChainSessionStore.prototype as unknown as Record<string, () => unknown>;
    spies.push(
      jest.spyOn(proto, 'saveSessions').mockResolvedValue(undefined as never),
      jest.spyOn(proto, 'persistSessionsOrThrow').mockResolvedValue(undefined as never),
      jest.spyOn(proto, 'loadSessions').mockResolvedValue(undefined as never),
      jest.spyOn(proto, 'startCleanupScheduler').mockImplementation(() => undefined)
    );
  });

  afterEach(async () => {
    await store?.cleanup();
    store = undefined;
    spies.splice(0).forEach((spy) => spy.mockRestore());
  });

  /** A three-step run standing on `n2` (ordinal 2), with `u` declared there. */
  async function standingOnN2(): Promise<ChainSessionStore> {
    store = new ChainSessionStore(
      { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { storeChainStepResult: jest.fn(), clearChainStepResults: jest.fn() } as never,
      { cleanupIntervalMs: 60_000 }
    );
    await store.createSession('s-r134', 'chain-r134', 3);
    await store.advanceStep('s-r134', 'n1');
    return store;
  }
  const ids = (s: ChainSessionStore) =>
    (s.getSession('s-r134')?.state.nodes ?? []).map((node) => node.id);
  const nodesOf = (s: ChainSessionStore) => s.getSession('s-r134')?.state.nodes ?? [];
  const declaredHere = [ledgerEntry({ id: 'u', blocking: true, discoveredAtStep: 2 })];

  test('(a) insertNodeAfter refuses an insertion at or before the current node', async () => {
    const s = await standingOnN2();
    // Anchored at n1, the node would land at ordinal 2: at the current node, behind the stamp.
    expect(
      await s.insertNodeAfter('s-r134', 'n1', { stepName: 'Late', promptId: 'p', unknownId: 'u' })
    ).toBeNull();
    expect(ids(s)).toEqual(['n1', 'n2', 'n3']);
    // Control: anchored at the current node it lands strictly after it, so the comparator
    // reads it as added since `u`'s discovery at ordinal 2.
    const placed = await s.insertNodeAfter('s-r134', 'n2', {
      stepName: 'Investigate',
      promptId: 'p',
      unknownId: 'u',
    });
    expect(ids(s)).toEqual(['n1', 'n2', placed?.id, 'n3']);
    expect([...investigatedUnknownIds(declaredHere, nodesOf(s), 'inserted')]).toEqual(['u']);
  });

  test('(b) a remainder replaces only the nodes strictly after the current one', async () => {
    const s = await standingOnN2();
    const outcome = await s.replaceRemainder(
      's-r134',
      [{ promptId: 'p-alt', stepName: 'Alternative' }],
      'u',
      'replace'
    );
    expect(outcome.kind).toBe('applied');
    // n1 (behind) and n2 (current) survive; only n3 was replaced, at ordinal 3, stamped with n2's.
    expect(ids(s)).toEqual(['n1', 'n2', 'alternative']);
    expect(nodesOf(s)[2]?.acceptedAtStep).toBe(2);
    expect([...investigatedUnknownIds(declaredHere, nodesOf(s), 'remainder')]).toEqual(['u']);
  });
});
