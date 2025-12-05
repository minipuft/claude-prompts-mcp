import { describe, expect, jest, test } from '@jest/globals';

import { createConsolidatedSystemControl } from '../../../../src/mcp-tools/system-control.js';

import type { Logger } from '../../../../src/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createSystemControl = () => {
  return createConsolidatedSystemControl(
    createLogger(),
    { sendNotification: jest.fn() } as any,
    () => Promise.resolve()
  );
};

describe('System Control guide action', () => {
  test('returns lifecycle overview for available operations', async () => {
    const systemControl = createSystemControl();
    const response = await systemControl.handleAction({ action: 'guide' }, {});
    const text = response.content?.[0]?.text ?? '';
    expect(text).toContain('System Control Guide');
    expect(text).toContain('`framework');
  });

  test('tells operators when filtered operations are planned only', async () => {
    const systemControl = createSystemControl();
    const response = await systemControl.handleAction(
      { action: 'guide', topic: 'analytics', include_planned: false },
      {}
    );
    const text = response.content?.[0]?.text ?? '';
    expect(text).toContain('Include planned operations');
  });
});
