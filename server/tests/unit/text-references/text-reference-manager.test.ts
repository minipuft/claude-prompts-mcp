import { createLogger } from '../../../dist/logging/index.js';
import { TextReferenceManager } from '../../../dist/text-references/index.js';

const logger = createLogger({
  logFile: '/tmp/text-reference-manager.log',
  transport: 'stdio',
  enableDebug: false,
  configuredLevel: 'error',
});

describe('TextReferenceManager.buildChainVariables', () => {
  test('exposes canonical and alias keys without requiring step+ naming', () => {
    const manager = new TextReferenceManager(logger);
    manager.storeChainStepResult('chain-1', 0, 'draft summary');
    manager.storeChainStepResult('chain-1', 1, 'final answer');

    const variables = manager.buildChainVariables('chain-1');

    expect(variables.step1_result).toBe('draft summary');
    expect(variables.previous_step_result).toBe('final answer');
    expect(variables.previous_step_result).toBe('final answer');
    expect(variables.input).toBe('final answer');
  });
});
