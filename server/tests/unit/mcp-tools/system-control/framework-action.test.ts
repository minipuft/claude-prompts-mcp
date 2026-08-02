import { describe, expect, jest, test } from '@jest/globals';

import { createConsolidatedSystemControl } from '../../../../src/mcp/tools/system-control/index.js';

import type { Logger } from '../../../../src/infra/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

describe('System Control framework action scope propagation', () => {
  test('delegates framework switch through framework manager', async () => {
    const frameworkManager = {
      switchFramework: jest.fn().mockResolvedValue({
        success: true,
        framework: {
          id: 'react',
          name: 'ReACT',
          description: 'Test',
          type: 'ReACT',
          executionGuidelines: ['g1'],
        },
      }),
      listFrameworks: jest.fn().mockReturnValue([]),
    };

    const systemControl = createConsolidatedSystemControl(createLogger(), () => Promise.resolve());
    systemControl.setFrameworkManager(frameworkManager as any);

    // Identity is read from token claims and request headers — a bare
    // { organizationId, workspaceId } object carries no identity and resolves to no scope.
    await systemControl.handleAction(
      { action: 'framework', operation: 'switch', framework: 'react' },
      { requestInfo: { headers: { 'x-workspace-id': 'workspace-a' } } }
    );

    // The scope argument is the point: without it every workspace's switch landed on
    // one shared row. Asserted explicitly so a regression cannot pass silently.
    expect(frameworkManager.switchFramework).toHaveBeenCalledWith(
      'react',
      expect.stringContaining('react'),
      { continuityScopeId: 'workspace-a' }
    );
  });

  test('framework list reads state store without identity-scoped args', async () => {
    const frameworkStateStore = {
      getCurrentState: jest.fn().mockReturnValue({
        activeFramework: 'react',
      }),
      getAvailableFrameworks: jest.fn().mockReturnValue([
        {
          id: 'react',
          name: 'ReACT',
          type: 'ReACT',
          description: 'Test',
          priority: 1,
          enabled: true,
          applicableTypes: [],
          executionGuidelines: [],
        },
      ]),
    };

    const frameworkManager = {
      listFrameworks: jest.fn().mockReturnValue([]),
    };

    const systemControl = createConsolidatedSystemControl(createLogger(), () => Promise.resolve());
    systemControl.setFrameworkManager(frameworkManager as any);
    systemControl.setFrameworkStateStore(frameworkStateStore as any);

    await systemControl.handleAction(
      { action: 'framework', operation: 'list', show_details: true },
      { organizationId: 'org-a', workspaceId: 'workspace-a' }
    );

    expect(frameworkStateStore.getCurrentState).toHaveBeenCalledWith();
    expect(frameworkManager.listFrameworks).toHaveBeenCalledWith();
  });
});
