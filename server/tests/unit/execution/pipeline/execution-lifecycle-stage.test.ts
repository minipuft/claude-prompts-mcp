import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../dist/execution/context/execution-context.js';
import { ExecutionLifecycleStage } from '../../../../dist/execution/pipeline/stages/00-execution-lifecycle-stage.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

describe('ExecutionLifecycleStage', () => {
  test('assigns scope ids and registers cleanup hooks', async () => {
    const cleanupScope = jest.fn();
    const registry = { cleanupScope };
    const stage = new ExecutionLifecycleStage(registry as any, createLogger());
    const context = new ExecutionContext({ command: '>>demo' });

    await stage.execute(context);

    expect(context.state.session.executionScopeId).toBeDefined();
    const handlers = context.state.lifecycle.cleanupHandlers as Array<() => Promise<void>>;
    expect(Array.isArray(handlers)).toBe(true);
    expect(handlers.length).toBe(1);

    await handlers[0]();

    expect(cleanupScope).toHaveBeenCalledWith('execution', context.state.session.executionScopeId);
  });
});
