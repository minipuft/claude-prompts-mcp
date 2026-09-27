// @lifecycle test - Stage 02 ends a call's temporary gates; a run keeps the ones it adopted (R47).
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ExecutionLifecycleStage } from '../../../../src/engine/execution/pipeline/stages/02-execution-lifecycle-stage.js';
import { TemporaryGateRegistry } from '../../../../src/engine/gates/core/temporary-gate-registry.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const gate = (id: string) => ({
  id,
  name: id,
  type: 'validation' as const,
  scope: 'execution' as const,
  description: id,
  guidance: id,
  source: 'manual' as const,
});

describe('ExecutionLifecycleStage', () => {
  test("the cleanup hook releases the call's gates no run adopted, and only those", async () => {
    const registry = new TemporaryGateRegistry(createLogger() as never);
    const stage = new ExecutionLifecycleStage(registry, createLogger() as never);
    const context = new ExecutionContext({ command: '>>demo' });

    await stage.execute(context);
    expect(context.state.session.executionScopeId).toBeDefined();

    const callOnly = registry.createTemporaryGate(gate('call-only'));
    const adopted = registry.createTemporaryGate(gate('adopted'));
    const otherCall = registry.createTemporaryGate(gate('other-call'));
    context.state.gates.temporaryGateIds = [callOnly, adopted];
    registry.adoptIntoRun('session-1', [adopted]);

    const handlers = context.state.lifecycle.cleanupHandlers as Array<() => Promise<void>>;
    expect(handlers).toHaveLength(1);
    await handlers[0]!();

    expect(registry.getTemporaryGate(callOnly)).toBeUndefined();
    expect(registry.getTemporaryGate(adopted)?.id).toBe('adopted');
    // A gate another call registered is not this call's to release.
    expect(registry.getTemporaryGate(otherCall)?.id).toBe('other-call');

    // The run releases what it adopted when it ends, and nothing else.
    expect(registry.releaseRun('session-1')).toBe(1);
    expect(registry.getTemporaryGate(adopted)).toBeUndefined();
    expect(registry.getTemporaryGate(otherCall)?.id).toBe('other-call');
  });

  test('an adopted gate drops its expiry: it ends with its run, not with a timer', () => {
    const registry = new TemporaryGateRegistry(createLogger() as never);
    const id = registry.createTemporaryGate(gate('timed'));
    expect(registry.getTemporaryGate(id)?.expires_at).toBeDefined();

    registry.adoptIntoRun('session-2', [id]);
    // A second run cannot take a gate the first owns.
    registry.adoptIntoRun('session-3', [id]);

    expect(registry.getTemporaryGate(id)?.expires_at).toBeUndefined();
    expect(registry.releaseRun('session-3')).toBe(0);
    expect(registry.releaseRun('session-2')).toBe(1);
  });
});
