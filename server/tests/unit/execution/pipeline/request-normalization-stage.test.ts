import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../dist/execution/context/execution-context.js';
import { RequestNormalizationStage } from '../../../../dist/execution/pipeline/stages/00-request-normalization-stage.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createResponse = () => ({
  content: [{ type: 'text' as const, text: 'handled' }],
  isError: false,
});

describe('RequestNormalizationStage', () => {
  test('returns error when command and resume identifiers are missing', async () => {
    const stage = new RequestNormalizationStage(null, null, createLogger());
    const context = new ExecutionContext({});

    await stage.execute(context);

    expect(context.response).toBeDefined();
    expect(context.response?.isError).toBe(true);
  });

  test('flags conflicting force_restart and chain_id options', async () => {
    const stage = new RequestNormalizationStage(null, null, createLogger());
    const context = new ExecutionContext({ command: '>>demo', chain_id: 'chain-demo', force_restart: true });

    await stage.execute(context);

    expect(context.response).toBeDefined();
    expect(context.response?.isError).toBe(true);
  });

  test('routes chain management commands before parsing', async () => {
    const chainResponse = createResponse();
    const handler = {
      tryHandleCommand: jest.fn().mockResolvedValue(chainResponse),
    };
    const stage = new RequestNormalizationStage(handler as any, null, createLogger());
    const context = new ExecutionContext({ command: 'validate chain research' });

    await stage.execute(context);

    expect(handler.tryHandleCommand).toHaveBeenCalledTimes(1);
    expect(context.response).toBe(chainResponse);
  });

  test('delegates help routing to configured tool router', async () => {
    const routedResponse = createResponse();
    const router = jest.fn().mockResolvedValue(routedResponse);
    const stage = new RequestNormalizationStage(null, router, createLogger());
    const context = new ExecutionContext({ command: 'help' });

    await stage.execute(context);

    expect(router).toHaveBeenCalledWith('system_control', { action: 'guide' }, 'help');
    expect(context.response).toBe(routedResponse);
  });

  test('captures gate override metadata for downstream formatting', async () => {
    const stage = new RequestNormalizationStage(null, null, createLogger());
    const context = new ExecutionContext({
      command: '>>demo',
      api_validation: true,
      quality_gates: ['code-quality', 'technical-accuracy'],
      custom_checks: [{ name: 'Docs', description: 'Ensure documentation' }],
      temporary_gates: [{ id: 'temp-gate', criteria: ['Ensure doc references'] }],
      gate_scope: 'chain',
    });

    await stage.execute(context);

    expect(context.metadata.requestedGateOverrides).toMatchObject({
      apiValidation: true,
      qualityGates: ['code-quality', 'technical-accuracy'],
      customChecks: [{ name: 'Docs', description: 'Ensure documentation' }],
      temporaryGateCount: 1,
      gateScope: 'chain',
    });
    expect(context.response).toBeUndefined();
  });

  test('allows chain_id without command for resume-only mode', async () => {
    const stage = new RequestNormalizationStage(null, null, createLogger());
    const context = new ExecutionContext({
      chain_id: 'chain-demo#1',
      user_response: 'Step 1 result',
    });

    await stage.execute(context);

    expect(context.response).toBeUndefined(); // Should NOT error
    expect(context.metadata.requestNormalizationComplete).toBe(true);
  });

  test('allows chain_id with gate review response', async () => {
    const stage = new RequestNormalizationStage(null, null, createLogger());
    const context = new ExecutionContext({
      chain_id: 'chain-demo#1',
      user_response: 'GATE_REVIEW: PASS - All criteria met',
    });

    await stage.execute(context);

    expect(context.response).toBeUndefined(); // Should NOT error
    expect(context.metadata.requestNormalizationComplete).toBe(true);
  });

  test('error message explains both execution and resume modes clearly', async () => {
    const stage = new RequestNormalizationStage(null, null, createLogger());
    const context = new ExecutionContext({});

    await stage.execute(context);

    expect(context.response).toBeDefined();
    expect(context.response?.isError).toBe(true);
    const errorText = context.response?.content[0]?.type === 'text' ? context.response.content[0].text : '';

    // Should explain both modes
    expect(errorText).toContain('To execute a new prompt');
    expect(errorText).toContain('To continue an existing chain');
    expect(errorText).toContain('chain_id');
    expect(errorText).toContain('user_response');
  });
});
