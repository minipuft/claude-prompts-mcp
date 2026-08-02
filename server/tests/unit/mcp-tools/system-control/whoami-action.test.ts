import { describe, expect, jest, test } from '@jest/globals';

import { createConsolidatedSystemControl } from '../../../../src/mcp/tools/system-control/index.js';

import type { Logger } from '../../../../src/infra/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

describe('System Control legacy whoami action', () => {
  test('rejects deprecated whoami action with current action list', async () => {
    const systemControl = createConsolidatedSystemControl(createLogger(), () => Promise.resolve());

    await expect(systemControl.handleAction({ action: 'whoami' }, {})).rejects.toThrow(
      /Unknown action: whoami/
    );
  });

  test('guide action remains canonical for discoverability', async () => {
    const systemControl = createConsolidatedSystemControl(createLogger(), () => Promise.resolve());

    const response = await systemControl.handleAction({ action: 'guide' }, {});
    const text = response.content?.[0]?.text ?? '';

    expect(text).toContain('System Control Guide');
    expect(text).toContain('framework');
    expect(text).toContain('gates');
  });
});
