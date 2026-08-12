import { createLogger } from '../../../src/infra/logging/index.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';

const logger = createLogger({
  logFile: '/tmp/text-reference-manager.log',
  transport: 'stdio',
  enableDebug: false,
  configuredLevel: 'error',
});

describe('TextReferenceStore.buildChainVariables', () => {
  test('exposes step results and chain metadata', () => {
    const manager = new TextReferenceStore(logger);
    manager.storeChainStepResult('chain-1', 'n1', 'draft summary');
    manager.storeChainStepResult('chain-1', 'n2', 'final answer');

    const variables = manager.buildChainVariables('chain-1');

    expect(variables.step1_result).toBe('draft summary');
    expect(variables.step2_result).toBe('final answer');
    expect(variables.previous_step_result).toBe('final answer');
    expect(variables.chain_id).toBe('chain-1');
    expect(variables.step_results).toEqual({ 0: 'draft summary', 1: 'final answer' });
  });

  test('the supplied ordinal, not insertion order, names the step variables', () => {
    const manager = new TextReferenceStore(logger);
    // Results keyed by node id but stored out of run order — which is exactly what P4's
    // insertions and retries produce. The rendered names must follow the run's positions.
    manager.storeChainStepResult('chain-2', 'review', 'reviewed', undefined, 2);
    manager.storeChainStepResult('chain-2', 'draft', 'drafted', undefined, 1);

    const variables = manager.buildChainVariables('chain-2');

    // `step${ordinal + 1}_result` reproduces the pre-node-identity naming exactly, where the
    // container key WAS the 1-based ordinal. (That it starts at step2_result for step 1 is a
    // pre-existing quirk this deliberately preserves rather than silently renumbering.)
    expect(variables.step2_result).toBe('drafted');
    expect(variables.step3_result).toBe('reviewed');
    expect(variables.step_results).toEqual({ 1: 'drafted', 2: 'reviewed' });
  });

  test('a stored result is addressable by node id, not by position', () => {
    const manager = new TextReferenceStore(logger);
    manager.storeChainStepResult('chain-3', 'draft', 'drafted', { note: 'first' }, 1);

    expect(manager.getChainStepResult('chain-3', 'draft')).toBe('drafted');
    expect(manager.getChainStepMetadata('chain-3', 'draft')).toEqual({ note: 'first' });
    expect(manager.getChainStepResult('chain-3', 'nope')).toBeNull();
  });
});
