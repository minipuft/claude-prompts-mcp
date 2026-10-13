// @lifecycle canonical - Pins which sources decide GateEnhancementService's active framework.
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { GateEnhancementService } from '../../../../src/engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../../src/engine/gates/services/gate-metrics-recorder.js';

/**
 * `buildDecisionInput` reads `context.frameworkContext` between a run's recorded framework and
 * the active-framework provider. That term looks dead from stage 11 (stage 12 writes the key
 * later) but is not: `inheritedReviewGateIdsNow` is called from stage 16, after stage 12, and
 * resolves the framework through the same method. These cases fix the precedence so a deletion of
 * the term fails here instead of changing which gates a stage-16 re-derivation selects.
 */

const createLogger = () =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) as never;

const activeFrameworkIdOf = (context: ExecutionContext, provider: string): string | undefined => {
  const service = new GateEnhancementService(
    {} as never,
    undefined,
    () => provider,
    () => undefined as never,
    undefined,
    new GateMetricsRecorder(() => undefined),
    createLogger()
  );
  return (
    service as unknown as { getActiveFrameworkId(c: ExecutionContext): string | undefined }
  ).getActiveFrameworkId(context);
};

const createContext = (plan: Record<string, unknown>, frameworkId?: string): ExecutionContext => {
  const context = new ExecutionContext({ command: '>>demo' } as never);
  context.executionPlan = { strategy: 'single', requiresFramework: true, ...plan } as never;
  if (frameworkId !== undefined) {
    context.frameworkContext = { selectedFramework: { id: frameworkId } } as never;
  }
  return context;
};

describe('active framework precedence in gate enhancement', () => {
  test('control: with no framework context the provider decides', () => {
    expect(activeFrameworkIdOf(createContext({}), 'cageerf')).toBe('cageerf');
  });

  test('a framework context written by stage 12 wins over the provider (stage-16 read)', () => {
    expect(activeFrameworkIdOf(createContext({}, 'react'), 'cageerf')).toBe('react');
  });

  test('the run-recorded framework wins over both', () => {
    const context = createContext({ runFrameworkId: 'scamper' }, 'react');
    expect(activeFrameworkIdOf(context, 'cageerf')).toBe('scamper');
  });
});
