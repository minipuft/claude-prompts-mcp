import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import {
  computeUnknownLedger,
  UNKNOWN_LEDGER_MAX_ENTRIES,
  UnknownObservationProcessor,
  UnknownObservationValidationError,
} from '../../../../src/engine/execution/capture/unknown-observation-processor.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type {
  ChainSessionService,
  UnknownLedgerEntry,
  UnknownObservation,
} from '../../../../src/shared/types/chain-session.js';

const createLogger = (): Logger =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as Logger;

const discovered = (
  id: string,
  statement: string,
  blocking?: boolean,
  target_step_id?: string
): UnknownObservation => ({
  type: 'unknown_discovered',
  id,
  statement,
  ...(blocking === undefined ? {} : { blocking }),
  ...(target_step_id === undefined ? {} : { target_step_id }),
});

const resolved = (
  id: string,
  statement: string,
  resolution: 'answered' | 'irrelevant' = 'answered'
): UnknownObservation => ({
  type: 'unknown_resolved',
  id,
  statement,
  resolution,
});

const activeEntry = (
  id: string,
  overrides: Partial<UnknownLedgerEntry> = {}
): UnknownLedgerEntry => ({
  id,
  statement: `statement for ${id}`,
  state: 'active',
  blocking: false,
  discoveredAtStep: 1,
  ...overrides,
});

const resolvedEntry = (id: string): UnknownLedgerEntry => ({
  id,
  statement: `statement for ${id}`,
  state: 'resolved',
  resolution: 'answered',
  resolutionStatement: `closed ${id}`,
  blocking: false,
  discoveredAtStep: 1,
  resolvedAtStep: 2,
});

describe('computeUnknownLedger — transition matrix', () => {
  test('discover with a new id appends an active entry stamped at the current step', () => {
    const ledger = computeUnknownLedger([], [discovered('cache-ttl', 'TTL undecided')], 3);

    expect(ledger).toEqual([
      {
        id: 'cache-ttl',
        statement: 'TTL undecided',
        state: 'active',
        blocking: false,
        discoveredAtStep: 3,
      },
    ]);
  });

  test('blocking defaults to false and is refreshed on re-discovery', () => {
    const opened = computeUnknownLedger([], [discovered('cache-ttl', 'TTL undecided')], 1);
    expect(opened[0]?.blocking).toBe(false);

    const raised = computeUnknownLedger(
      opened,
      [discovered('cache-ttl', 'TTL undecided', true)],
      4
    );
    expect(raised[0]?.blocking).toBe(true);

    const lowered = computeUnknownLedger(raised, [discovered('cache-ttl', 'TTL undecided')], 5);
    expect(lowered[0]?.blocking).toBe(false);
  });

  // P4: target_step_id (wire) -> targetStepId (ledger) is the field the mutation policy reads
  // back at resolution time — confirm it survives the create path and the wire/internal rename.
  test('discover with target_step_id carries it onto the ledger entry as targetStepId', () => {
    const ledger = computeUnknownLedger(
      [],
      [discovered('cache-ttl', 'TTL undecided', true, 'draft-outline')],
      1
    );

    expect(ledger[0]).toMatchObject({ targetStepId: 'draft-outline' });
  });

  test('discover without target_step_id leaves targetStepId absent (not a crash, not a default)', () => {
    const ledger = computeUnknownLedger([], [discovered('cache-ttl', 'TTL undecided')], 1);

    expect(ledger[0]).not.toHaveProperty('targetStepId');
  });

  test('re-discovery refreshes targetStepId the same way it refreshes blocking, including clearing it on omission', () => {
    const opened = computeUnknownLedger(
      [],
      [discovered('cache-ttl', 'TTL undecided', true, 'draft-outline')],
      1
    );
    expect(opened[0]?.targetStepId).toBe('draft-outline');

    const retargeted = computeUnknownLedger(
      opened,
      [discovered('cache-ttl', 'TTL undecided', true, 'finish')],
      2
    );
    expect(retargeted[0]?.targetStepId).toBe('finish');

    const cleared = computeUnknownLedger(
      retargeted,
      [discovered('cache-ttl', 'TTL undecided', true)],
      3
    );
    expect(cleared[0]).not.toHaveProperty('targetStepId');
  });

  test('targetStepId is still readable after the unknown resolves — the mutation policy reads it at resolution time', () => {
    const opened = computeUnknownLedger(
      [],
      [discovered('cache-ttl', 'TTL undecided', true, 'draft-outline')],
      1
    );
    const resolvedLedger = computeUnknownLedger(
      opened,
      [resolved('cache-ttl', 'Turned out not to matter', 'irrelevant')],
      2
    );

    expect(resolvedLedger[0]).toMatchObject({ state: 'resolved', targetStepId: 'draft-outline' });
  });

  test('discover on an ACTIVE id updates the statement without re-stamping discoveredAtStep', () => {
    const ledger = computeUnknownLedger(
      [activeEntry('cache-ttl', { discoveredAtStep: 1 })],
      [discovered('cache-ttl', 'TTL still undecided, now scoped to the read path')],
      7
    );

    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      statement: 'TTL still undecided, now scoped to the read path',
      state: 'active',
      discoveredAtStep: 1,
    });
  });

  test('resolve on an ACTIVE id closes it with resolution, resolutionStatement and step', () => {
    const ledger = computeUnknownLedger(
      [activeEntry('cache-ttl')],
      [resolved('cache-ttl', 'Owner picked 30s', 'answered')],
      6
    );

    expect(ledger[0]).toEqual({
      id: 'cache-ttl',
      statement: 'statement for cache-ttl',
      state: 'resolved',
      resolution: 'answered',
      resolutionStatement: 'Owner picked 30s',
      blocking: false,
      discoveredAtStep: 1,
      resolvedAtStep: 6,
    });
  });

  test('resolve on a missing id is a validation error naming the id', () => {
    expect(() => computeUnknownLedger([], [resolved('never-seen', 'done')], 2)).toThrow(
      UnknownObservationValidationError
    );
    expect(() => computeUnknownLedger([], [resolved('never-seen', 'done')], 2)).toThrow(
      /never-seen/
    );
  });

  test('resolve without a resolution is a validation error', () => {
    const malformed = {
      type: 'unknown_resolved',
      id: 'cache-ttl',
      statement: 'done',
    } as UnknownObservation;

    expect(() => computeUnknownLedger([activeEntry('cache-ttl')], [malformed], 2)).toThrow(
      UnknownObservationValidationError
    );
  });

  // Delegated decision (a): resolve on an already-RESOLVED id is an idempotent refresh.
  test('resolve on a RESOLVED id refreshes resolution but keeps the first resolvedAtStep', () => {
    const ledger = computeUnknownLedger(
      [resolvedEntry('cache-ttl')],
      [resolved('cache-ttl', 'Reconfirmed: 30s', 'irrelevant')],
      9
    );

    expect(ledger[0]).toMatchObject({
      state: 'resolved',
      resolution: 'irrelevant',
      resolutionStatement: 'Reconfirmed: 30s',
      resolvedAtStep: 2,
    });
  });

  // Delegated decision (b): discover on a RESOLVED id re-opens it.
  test('discover on a RESOLVED id re-opens it, re-stamps the step and clears resolution fields', () => {
    const ledger = computeUnknownLedger(
      [resolvedEntry('cache-ttl')],
      [discovered('cache-ttl', 'TTL is undecided again after the load test', true)],
      8
    );

    expect(ledger[0]).toEqual({
      id: 'cache-ttl',
      statement: 'TTL is undecided again after the load test',
      state: 'active',
      blocking: true,
      discoveredAtStep: 8,
    });
    expect(ledger[0]).not.toHaveProperty('resolution');
    expect(ledger[0]).not.toHaveProperty('resolutionStatement');
    expect(ledger[0]).not.toHaveProperty('resolvedAtStep');
  });

  test('entries in one batch apply in order, so a later one sees the earlier effect', () => {
    const ledger = computeUnknownLedger(
      [],
      [
        discovered('cache-ttl', 'TTL undecided'),
        discovered('cache-ttl', 'TTL undecided (restated)', true),
        resolved('cache-ttl', 'Owner picked 30s'),
      ],
      4
    );

    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      statement: 'TTL undecided (restated)',
      state: 'resolved',
      resolutionStatement: 'Owner picked 30s',
      blocking: true,
      discoveredAtStep: 4,
      resolvedAtStep: 4,
    });
  });

  test('replaying the same batch (gate retry) produces an identical ledger', () => {
    const batch = [discovered('cache-ttl', 'TTL undecided'), resolved('cache-ttl', 'Picked 30s')];

    const first = computeUnknownLedger([], batch, 4);
    const second = computeUnknownLedger(first, batch, 4);

    expect(second).toEqual(first);
  });

  test('an invalid batch throws without mutating the input ledger', () => {
    const current = [activeEntry('cache-ttl')];
    const snapshot = JSON.parse(JSON.stringify(current)) as UnknownLedgerEntry[];

    expect(() =>
      computeUnknownLedger(
        current,
        [discovered('new-one', 'opened'), resolved('never-seen', 'closed')],
        3
      )
    ).toThrow(UnknownObservationValidationError);

    expect(current).toEqual(snapshot);
  });

  test('a valid batch does not mutate the input ledger entries', () => {
    const current = [activeEntry('cache-ttl')];
    const next = computeUnknownLedger(current, [resolved('cache-ttl', 'done')], 5);

    expect(current[0]?.state).toBe('active');
    expect(next[0]?.state).toBe('resolved');
    expect(next[0]).not.toBe(current[0]);
  });
});

describe('computeUnknownLedger — ledger cap', () => {
  const buildLedger = (size: number): UnknownLedgerEntry[] =>
    Array.from({ length: size }, (_, index) => activeEntry(`unknown-${index}`));

  test(`accepts a new entry when the ledger holds ${UNKNOWN_LEDGER_MAX_ENTRIES - 1}`, () => {
    const ledger = computeUnknownLedger(
      buildLedger(UNKNOWN_LEDGER_MAX_ENTRIES - 1),
      [discovered('one-more', 'the last slot')],
      2
    );

    expect(ledger).toHaveLength(UNKNOWN_LEDGER_MAX_ENTRIES);
  });

  test('rejects a new entry when the ledger is at the cap', () => {
    expect(() =>
      computeUnknownLedger(
        buildLedger(UNKNOWN_LEDGER_MAX_ENTRIES),
        [discovered('one-too-many', 'overflow')],
        2
      )
    ).toThrow(UnknownObservationValidationError);
    expect(() =>
      computeUnknownLedger(
        buildLedger(UNKNOWN_LEDGER_MAX_ENTRIES),
        [discovered('one-too-many', 'overflow')],
        2
      )
    ).toThrow(/one-too-many/);
  });

  test('updates to existing entries are unaffected by the cap', () => {
    const ledger = computeUnknownLedger(
      buildLedger(UNKNOWN_LEDGER_MAX_ENTRIES),
      [resolved('unknown-0', 'closed'), discovered('unknown-1', 'restated')],
      2
    );

    expect(ledger).toHaveLength(UNKNOWN_LEDGER_MAX_ENTRIES);
    expect(ledger[0]?.state).toBe('resolved');
  });

  test('the cap counts net new entries within a single batch', () => {
    expect(() =>
      computeUnknownLedger(
        buildLedger(UNKNOWN_LEDGER_MAX_ENTRIES - 1),
        [discovered('slot-a', 'first'), discovered('slot-b', 'second')],
        2
      )
    ).toThrow(/slot-b/);
  });
});

describe('UnknownObservationProcessor', () => {
  const createStore = () => {
    const applyUnknownObservations =
      jest.fn<
        (
          sessionId: string,
          nodeId: string,
          observations: UnknownObservation[]
        ) => Promise<UnknownLedgerEntry[]>
      >();
    return {
      applyUnknownObservations,
      store: { applyUnknownObservations } as unknown as ChainSessionService,
    };
  };

  test('skips the store entirely for an empty observation batch', async () => {
    const { store, applyUnknownObservations } = createStore();
    const processor = new UnknownObservationProcessor(store, createLogger());

    const ledger = await processor.applyObservations(
      new ExecutionContext({ command: '>>demo' }),
      'sess-1',
      'n2',
      []
    );

    expect(ledger).toEqual([]);
    expect(applyUnknownObservations).not.toHaveBeenCalled();
  });

  test('delegates to the session store and returns the updated ledger', async () => {
    const { store, applyUnknownObservations } = createStore();
    const updated = [activeEntry('cache-ttl', { discoveredAtStep: 2 })];
    applyUnknownObservations.mockResolvedValue(updated);
    const processor = new UnknownObservationProcessor(store, createLogger());

    const observations = [discovered('cache-ttl', 'TTL undecided')];
    const ledger = await processor.applyObservations(
      new ExecutionContext({ command: '>>demo' }),
      'sess-1',
      'n2',
      observations
    );

    expect(applyUnknownObservations).toHaveBeenCalledWith('sess-1', 'n2', observations);
    expect(ledger).toBe(updated);
  });

  test('propagates store failures rather than swallowing them', async () => {
    const { store, applyUnknownObservations } = createStore();
    applyUnknownObservations.mockRejectedValue(new Error('persist failed'));
    const processor = new UnknownObservationProcessor(store, createLogger());

    await expect(
      processor.applyObservations(new ExecutionContext({ command: '>>demo' }), 'sess-1', 'n2', [
        discovered('cache-ttl', 'TTL undecided'),
      ])
    ).rejects.toThrow('persist failed');
  });
});
