// @lifecycle canonical - P6.107: a caller-chosen temporary gate id belongs to the run that holds it. P6.113: a run resolves a declared id to the one it registered.
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
    expect(registry.getRunGates('run-1').map((gate) => gate.id)).toEqual(['def107']);
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

/**
 * P6.113 / R49. MEASURED 2026-09-26 on `936611fd` (driven, one server): run 1 held `rg`, run 2
 * registered `rg-2`, and every resume of run 2 re-sending `gates: [{ id: "rg" }]` registered
 * `rg-3`, then `rg-4`: the held `rg` was run 1's, and nothing mapped run 2's declared `rg` to the
 * `rg-2` it owned. The run's declared ids now resolve through the registry's run index.
 */
describe('a run holding a fresh id re-sends the declared one (P6.113)', () => {
  test('a request gate resolves to the id the run registered, and registers nothing', async () => {
    const registry = new TemporaryGateRegistry(logger());
    const registrar = new TemporaryGateRegistrar(registry, undefined, logger());
    const gate = (criterion: string) => [{ id: 'rg113', name: 'rg113', criteria: [criterion] }];

    const first = await registrar.registerTemporaryGates(callOf(undefined, gate('ONE')));
    registry.adoptIntoRun('run-1', first.temporaryGateIds);
    const second = await registrar.registerTemporaryGates(callOf(undefined, gate('TWO')));
    registry.adoptIntoRun('run-2', second.temporaryGateIds);
    const resumed = await registrar.registerTemporaryGates(callOf('run-2', gate('TWO')));

    expect(second.temporaryGateIds).toEqual(['rg113-2']);
    expect(resumed.temporaryGateIds).toEqual(['rg113-2']);
    expect(registry.getTemporaryGate('rg113-3')).toBeUndefined();
    expect(registry.getRunGates('run-2').map((held) => held.id)).toEqual(['rg113-2']);
  });

  test('an inline definition resolves to the id the run registered, with no warning', () => {
    const registry = new TemporaryGateRegistry(logger());
    const log = logger();
    const registrar = new TemporaryGateRegistrar(registry, undefined, log);

    registry.adoptIntoRun(
      'run-1',
      registrar.registerInlineGateDefinitions(callOf(undefined), [carrier('ONE')], true)
    );
    const second = registrar.registerInlineGateDefinitions(
      callOf(undefined),
      [carrier('TWO')],
      true
    );
    registry.adoptIntoRun('run-2', second);
    const resumed = registrar.registerInlineGateDefinitions(
      callOf('run-2'),
      [carrier('TWO')],
      true
    );

    expect(second).toEqual(['def107-2']);
    expect(resumed).toEqual(['def107-2']);
    expect(registry.getTemporaryGate('def107-3')).toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('control: a third live run declaring the id still gets its own', async () => {
    const registry = new TemporaryGateRegistry(logger());
    const registrar = new TemporaryGateRegistrar(registry, undefined, logger());
    const gate = [{ id: 'rg113c', name: 'rg113c', criteria: ['X'] }];
    for (const run of ['run-1', 'run-2']) {
      registry.adoptIntoRun(
        run,
        (await registrar.registerTemporaryGates(callOf(undefined, gate))).temporaryGateIds
      );
    }
    const third = await registrar.registerTemporaryGates(callOf(undefined, gate));
    expect(third.temporaryGateIds).toEqual(['rg113c-3']);
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

/**
 * P6.114 (ruling): an untargeted request gate on a chain is the run's gate for the step the client
 * sent it on. MEASURED 2026-09-26 on `83355182`: registration binds `apply_to_steps: [currentStep]`
 * once; the run's declared id (R49) is what makes a later re-send register nothing and leave that
 * binding alone. A gate sent WITHOUT an `id` has no declared id: re-sent on step 3 it registers a
 * second gate bound to step 3 (as of 2026-09-26 · flips when id-less request gates gain a
 * declared key, e.g. one derived from their body).
 */
describe('an untargeted chain request gate stays bound to its first step (P6.114)', () => {
  const NODE_IDS = ['n1', 'n2', 'n3'];

  /** A call of a three-step chain standing at `currentStep`; `sessionId` undefined starts the run. */
  const chainCallOf = (
    sessionId: string | undefined,
    currentStep: number,
    gates: unknown[]
  ): ExecutionContext => {
    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = { gates };
    context.parsedCommand = {
      commandType: 'chain',
      steps: NODE_IDS.map((nodeId, index) => ({
        stepNumber: index + 1,
        nodeId,
        promptId: nodeId,
        args: {},
      })),
    } as never;
    if (sessionId !== undefined) {
      context.sessionContext = { sessionId, isChainExecution: true, currentStep };
    }
    return context;
  };

  const startAndResume = async (gate: Record<string, unknown>) => {
    const registry = new TemporaryGateRegistry(logger());
    const create = jest.spyOn(registry, 'createTemporaryGate');
    const registrar = new TemporaryGateRegistrar(registry, undefined, logger());
    const started = await registrar.registerTemporaryGates(chainCallOf(undefined, 1, [gate]));
    registry.adoptIntoRun('run-114', started.temporaryGateIds);
    const resumed = await registrar.registerTemporaryGates(chainCallOf('run-114', 3, [gate]));
    return { registry, create, started, resumed };
  };

  test('re-sent on step 3: still bound to step 1, and nothing registers again', async () => {
    const { registry, create, started, resumed } = await startAndResume({
      id: 'ug114',
      criteria: ['UNTARGETED-114'],
    });

    expect(started.temporaryGateIds).toEqual(['ug114']);
    expect(resumed.temporaryGateIds).toEqual(['ug114']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(registry.getTemporaryGate('ug114')?.apply_to_steps).toEqual([1]);
    expect(registry.getTemporaryGate('ug114-2')).toBeUndefined();
    expect(registry.getRunGates('run-114').map((held) => held.id)).toEqual(['ug114']);
  });

  test('control: a targeted gate binds its target, re-sent or not', async () => {
    const { registry, create, resumed } = await startAndResume({
      id: 'tg114',
      criteria: ['TARGETED-114'],
      target_step_id: 'n2',
    });

    expect(resumed.temporaryGateIds).toEqual(['tg114']);
    expect(create).toHaveBeenCalledTimes(1);
    const held = registry.getTemporaryGate('tg114');
    expect(held?.target_step_id).toBe('n2');
    expect(held?.target_step_number).toBe(2);
    expect(held?.apply_to_steps).toBeUndefined();
  });
});
