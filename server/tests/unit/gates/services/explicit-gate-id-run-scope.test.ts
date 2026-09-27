// @lifecycle canonical - P6.107: a caller-chosen temporary gate id belongs to the run that holds it.
/**
 * MEASURED 2026-09-26 on `9f833361` (driven, one server): a prompt's `inline_gate_definitions`
 * entry with a declared `id` logged "Failed to register inline gate definition … Temporary gate ID
 * already exists" on every call after the first, and the step that declared it (the chain's third)
 * then rendered no gate and refused its FAIL as gateless. A request `gates: [{ id }]` reused by a
 * second live run was skipped as "already registered", so that run rendered and reviewed the first
 * run's criteria.
 *
 * Now an id this run already holds is the same gate (a no-op, or a merge when the body differs,
 * ADR 0001 (b)); an id another run holds registers under a fresh `<id>-N`.
 */
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { TemporaryGateRegistry } from '../../../../src/engine/gates/core/temporary-gate-registry.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';

import type { Logger } from '../../../../src/infra/logging/index.js';

const logger = (): Logger & { warn: jest.Mock } =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as never;

/** A call of the run `sessionId` (undefined: the call that starts a run). */
const callOf = (sessionId: string | undefined, gates: unknown[] = []): ExecutionContext => {
  const context = new ExecutionContext({ command: '>>demo' });
  context.state.gates.requestedOverrides = { gates };
  if (sessionId !== undefined) context.state.session.resumeSessionId = sessionId;
  return context;
};

const carrier = (guidance: string) => ({
  id: 'demo',
  gateConfiguration: {
    inline_gate_definitions: [
      { id: 'def107', name: 'def107', type: 'validation', scope: 'execution', guidance },
    ],
  },
});

describe('an inline definition with a declared id (P6.107)', () => {
  test('re-registered by its own run is the same gate, with no warning', () => {
    const registry = new TemporaryGateRegistry(logger());
    const log = logger();
    const registrar = new TemporaryGateRegistrar(registry, undefined, log);

    const started = registrar.registerInlineGateDefinitions(
      callOf(undefined),
      [carrier('G')],
      true
    );
    registry.adoptIntoRun('run-1', started);
    const resumed = registrar.registerInlineGateDefinitions(callOf('run-1'), [carrier('G')], true);

    expect(started).toEqual(['def107']);
    expect(resumed).toEqual(['def107']);
    expect(log.warn).not.toHaveBeenCalled();
    expect(registry.ownerOf('def107')).toBe('run-1');
  });

  test('a differing body on the same run merges over the held one', () => {
    const registry = new TemporaryGateRegistry(logger());
    const registrar = new TemporaryGateRegistrar(registry, undefined, logger());
    const context = callOf(undefined);

    registrar.registerInlineGateDefinitions(context, [carrier('FIRST'), carrier('SECOND')], true);

    expect(registry.getTemporaryGate('def107')?.guidance).toBe('SECOND');
    expect(registry.getTemporaryGate('def107-2')).toBeUndefined();
  });

  test("another run's held id registers fresh and leaves that run's body alone", () => {
    const registry = new TemporaryGateRegistry(logger());
    const registrar = new TemporaryGateRegistrar(registry, undefined, logger());

    registry.adoptIntoRun(
      'run-1',
      registrar.registerInlineGateDefinitions(callOf(undefined), [carrier('ONE')], true)
    );
    const second = registrar.registerInlineGateDefinitions(
      callOf(undefined),
      [carrier('TWO')],
      true
    );

    expect(second).toEqual(['def107-2']);
    expect(registry.getTemporaryGate('def107')?.guidance).toBe('ONE');
    expect(registry.getTemporaryGate('def107-2')?.guidance).toBe('TWO');
  });
});

describe('a request gate with an id (P6.107)', () => {
  const gate = (criterion: string) => [{ id: 'rq107', name: 'rq107', criteria: [criterion] }];

  test('a second run declaring a held id grades its own criteria; its own resume reuses the gate', async () => {
    const registry = new TemporaryGateRegistry(logger());
    const registrar = new TemporaryGateRegistrar(registry, undefined, logger());

    const first = await registrar.registerTemporaryGates(callOf(undefined, gate('ONE')));
    registry.adoptIntoRun('run-1', first.temporaryGateIds);
    const second = await registrar.registerTemporaryGates(callOf(undefined, gate('TWO')));
    registry.adoptIntoRun('run-2', second.temporaryGateIds);
    const resumed = await registrar.registerTemporaryGates(callOf('run-1', gate('ONE')));

    expect(first.temporaryGateIds).toEqual(['rq107']);
    expect(second.temporaryGateIds).toEqual(['rq107-2']);
    expect(registry.getTemporaryGate('rq107-2')?.pass_criteria).toEqual(['TWO']);
    expect(resumed.temporaryGateIds).toEqual(['rq107']);
    expect(registry.getTemporaryGate('rq107-3')).toBeUndefined();
  });

  test('control: a fresh id registers under itself', async () => {
    const registry = new TemporaryGateRegistry(logger());
    const registrar = new TemporaryGateRegistrar(registry, undefined, logger());
    const result = await registrar.registerTemporaryGates(callOf(undefined, gate('FRESH')));
    expect(result.temporaryGateIds).toEqual(['rq107']);
  });
});
