import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../dist/execution/context/execution-context.js';
import { DependencyInjectionStage } from '../../../../dist/execution/pipeline/stages/00-dependency-injection-stage.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

describe('DependencyInjectionStage', () => {
  test('records dependency snapshot metadata', async () => {
    const registry = {};
    const analyticsService = { id: 'analytics-1' };
    const stage = new DependencyInjectionStage(
      registry as any,
      () => true,
      () => analyticsService as any,
      'canonical-stage-0',
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>demo' });
    await stage.execute(context);

    expect(context.metadata.pipelineDependencies).toMatchObject({
      frameworkEnabled: true,
      analyticsService,
      temporaryGateRegistry: registry,
      pipelineVersion: 'canonical-stage-0',
    });

    expect(context.metadata.executionOptions).toMatchObject({
      apiValidation: false,
    });
  });
});
