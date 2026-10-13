// @lifecycle canonical - R11.8 / R11.13: a full temporary gate registry evicts only expired gates, and otherwise refuses.
/**
 * MEASURED 2026-10-12 on `ca0df3bf`: at capacity (`maxMemoryGates`, 100 in `prompt-executor.ts`)
 * `performCleanup` removed the oldest gates by `created_at` whoever held them, so a long-lived run's
 * request gate — the oldest in the registry by construction — was the first to go, and the run's
 * next review went on without it, unannounced.
 *
 * R11.13: a gate that has not expired is never force-evicted. A gate no run owns belongs to a call
 * still in flight (the pipeline adopts or releases every call's gates in `finally`), so evicting
 * one could drop a concurrent call's gate. At capacity the registry drops expired gates only; if it
 * is still full, the registration is refused with a message saying why.
 */
import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { TemporaryGateRegistry } from '../../../../src/engine/gates/core/temporary-gate-registry.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const gate = (id: string, expires_at?: number) => ({
  id,
  name: id,
  type: 'validation' as const,
  scope: 'execution' as const,
  description: id,
  guidance: id,
  source: 'manual' as const,
  ...(expires_at !== undefined ? { expires_at } : {}),
});

const MAX = 10;
const START = 1_000_000;

/** A registry whose clock the test sets. */
const clockedRegistry = (): { registry: TemporaryGateRegistry; setNow: (ms: number) => void } => {
  let now = START;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  return {
    registry: new TemporaryGateRegistry(createLogger() as never, {
      maxMemoryGates: MAX,
      isCanonicalGateId: () => false,
    }),
    setNow: (ms) => {
      now = ms;
    },
  };
};

describe('TemporaryGateRegistry at capacity', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a full registry of unexpired gates refuses the new one and removes nothing', () => {
    const { registry } = clockedRegistry();
    registry.createTemporaryGate(gate('live'), 'run-1');
    registry.adoptIntoRun('run-1', ['live']);
    for (let i = 1; i < MAX; i += 1) registry.createTemporaryGate(gate(`u${i}`), 'call');

    expect(() => registry.createTemporaryGate(gate('new'), 'call')).toThrow(
      /registry is full \(10 gates, none expired\).*'new' was not registered/s
    );
    expect(registry.getRunGates('run-1').map((g) => g.id)).toEqual(['live']);
    for (let i = 1; i < MAX; i += 1) expect(registry.getTemporaryGate(`u${i}`)).toBeDefined();
    expect(registry.getTemporaryGate('new')).toBeUndefined();
  });

  test("expired gates make room; a live run's gate, older than all of them, stays", () => {
    const { registry, setNow } = clockedRegistry();
    registry.createTemporaryGate(gate('live', START + 1_000), 'run-1');
    registry.adoptIntoRun('run-1', ['live']); // a run's gate loses its expiry
    registry.createTemporaryGate(gate('expiring', START + 1_000), 'call');
    for (let i = 2; i < MAX; i += 1)
      registry.createTemporaryGate(gate(`u${i}`, START + 60_000), 'call');
    setNow(START + 2_000);

    expect(registry.createTemporaryGate(gate('new'), 'call')).toBe('new');
    expect(registry.getTemporaryGate('expiring')).toBeUndefined();
    expect(registry.getTemporaryGate('live')).toBeDefined();
    expect(registry.getTemporaryGate('u2')).toBeDefined();
  });

  test("a resumed run's request gate survives a full registry and still reaches its review set", async () => {
    const { registry } = clockedRegistry();
    const registrar = new TemporaryGateRegistrar(registry, undefined, createLogger() as never);
    const start = new ExecutionContext({ command: '>>demo' });
    start.state.gates.requestedOverrides = {
      gates: [{ id: 'cites', criteria: ['Cites a source'] }],
    };
    const started = await registrar.registerTemporaryGates(start);
    registry.adoptIntoRun('run-1', started.temporaryGateIds);
    for (let i = 1; i < MAX; i += 1) registry.createTemporaryGate(gate(`u${i}`), 'other-call');

    const resume = new ExecutionContext({ command: '>>demo' });
    resume.state.session.resumeSessionId = 'run-1';
    resume.state.gates.requestedOverrides = { gates: [{ id: 'tone', criteria: ['Neutral'] }] };

    await expect(registrar.registerTemporaryGates(resume)).rejects.toThrow(/registry is full/);
    // The refusal fails the call; the run's own gate is untouched and still answers its review.
    const next = new ExecutionContext({ command: '>>demo' });
    next.state.session.resumeSessionId = 'run-1';
    expect((await registrar.registerTemporaryGates(next)).temporaryGateIds).toEqual(['cites']);
    expect(registry.getTemporaryGate('cites')?.pass_criteria).toEqual(['Cites a source']);
  });
});

/**
 * A run's gates have no expiry, so runs nobody resumes could hold the registry full until the
 * stale-session sweep prunes them a day later. At capacity the registry therefore releases the
 * gates of runs whose last use is older than `idleRunReleaseMs`, oldest first, until there is
 * room. A run used within the threshold is never released, and a released run's next call
 * re-registers its gates (stage 05's restore).
 */
describe('TemporaryGateRegistry at capacity, with runs gone idle', () => {
  const IDLE_MS = 60 * 60 * 1000;
  const idleRegistry = (): { registry: TemporaryGateRegistry; setNow: (ms: number) => void } => {
    let now = START;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    return {
      registry: new TemporaryGateRegistry(createLogger() as never, {
        maxMemoryGates: MAX,
        idleRunReleaseMs: IDLE_MS,
        isCanonicalGateId: () => false,
      }),
      setNow: (ms) => {
        now = ms;
      },
    };
  };
  /** `count` gates registered and adopted by `runId`, at whatever the clock reads. */
  const ownedBy = (registry: TemporaryGateRegistry, runId: string, count: number): string[] => {
    const ids = Array.from({ length: count }, (_, i) =>
      registry.createTemporaryGate(gate(`${runId}-g${i}`), 'call')
    );
    registry.adoptIntoRun(runId, ids);
    return ids;
  };
  const heldIds = (registry: TemporaryGateRegistry, runId: string): string[] =>
    registry.getRunGates(runId).map((held) => held.id);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a registry full of idle runs' gates admits the new one, releasing the oldest-idle run only", () => {
    const { registry, setNow } = idleRegistry();
    ownedBy(registry, 'run-old', 5);
    setNow(START + 10 * 60 * 1000);
    const newer = ownedBy(registry, 'run-newer', 5);
    setNow(START + 3 * IDLE_MS);

    expect(registry.createTemporaryGate(gate('new'), 'call')).toBe('new');
    expect(heldIds(registry, 'run-old')).toEqual([]);
    expect(registry.getTemporaryGate('run-old-g0')).toBeUndefined();
    expect(heldIds(registry, 'run-newer')).toEqual(newer);
  });

  test('a registry full of runs used within the threshold refuses, and releases nothing', () => {
    const { registry, setNow } = idleRegistry();
    const first = ownedBy(registry, 'run-1', 5);
    const second = ownedBy(registry, 'run-2', 5);
    setNow(START + IDLE_MS - 1);

    expect(() => registry.createTemporaryGate(gate('new'), 'call')).toThrow(
      /registry is full \(10 gates, none expired\).*'new' was not registered/s
    );
    expect(heldIds(registry, 'run-1')).toEqual(first);
    expect(heldIds(registry, 'run-2')).toEqual(second);
  });

  test('mixed: only the idle run is released; once it is gone the registry refuses again', () => {
    const { registry, setNow } = idleRegistry();
    ownedBy(registry, 'run-idle', 3);
    setNow(START + 2 * IDLE_MS);
    const recent = ownedBy(registry, 'run-recent', 3);
    for (let i = 0; i < 4; i += 1) registry.createTemporaryGate(gate(`call-${i}`), 'call');
    setNow(START + 2 * IDLE_MS + 10 * 60 * 1000);

    for (let i = 0; i < 3; i += 1) registry.createTemporaryGate(gate(`new-${i}`), 'call');
    expect(heldIds(registry, 'run-idle')).toEqual([]);
    expect(() => registry.createTemporaryGate(gate('one-more'), 'call')).toThrow(
      /registry is full/
    );
    expect(heldIds(registry, 'run-recent')).toEqual(recent);
    for (let i = 0; i < 4; i += 1) expect(registry.getTemporaryGate(`call-${i}`)).toBeDefined();
  });

  test('a run marked used at the start of its call is not idle, whenever it adopted its gates', () => {
    const { registry, setNow } = idleRegistry();
    const owned = ownedBy(registry, 'run-resuming', 5);
    ownedBy(registry, 'run-other', 5);
    setNow(START + 2 * IDLE_MS);
    registry.markRunUsed('run-resuming');

    expect(registry.createTemporaryGate(gate('new'), 'call')).toBe('new');
    expect(heldIds(registry, 'run-other')).toEqual([]);
    expect(heldIds(registry, 'run-resuming')).toEqual(owned);
  });

  test('a released run that adopts its gates again is protected by that use', () => {
    const { registry, setNow } = idleRegistry();
    ownedBy(registry, 'run-back', 5);
    ownedBy(registry, 'run-other', 4);
    setNow(START + 2 * IDLE_MS);
    registry.createTemporaryGate(gate('call-a'), 'call');
    registry.createTemporaryGate(gate('call-b'), 'call');
    expect(heldIds(registry, 'run-back')).toEqual([]);

    const back = ownedBy(registry, 'run-back', 1);
    registry.releaseUnowned(['call-a', 'call-b']);
    for (let i = 0; i < 6; i += 1) registry.createTemporaryGate(gate(`fill-${i}`), 'call');
    expect(heldIds(registry, 'run-other')).toEqual([]);
    expect(heldIds(registry, 'run-back')).toEqual(back);
  });
});
