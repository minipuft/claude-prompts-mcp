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
