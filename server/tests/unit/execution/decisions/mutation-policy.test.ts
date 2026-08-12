// @lifecycle canonical - Exhaustive branch coverage for the P4 adaptive chain-mutation decision.
import { describe, expect, test } from '@jest/globals';

import {
  decideMutation,
  MAX_INSERTIONS_PER_RUN,
} from '../../../../src/engine/execution/pipeline/decisions/mutation/index.js';

import type {
  ChainMutation,
  DecideMutationInput,
} from '../../../../src/engine/execution/pipeline/decisions/mutation/index.js';
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
