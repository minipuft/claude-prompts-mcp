import { describe, expect, jest, test } from '@jest/globals';

import { createConsolidatedSystemControl } from '../../../../src/mcp/tools/system-control/index.js';

import type { Logger } from '../../../../src/infra/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

describe('System Control gate action scope propagation', () => {
  test('delegates gate enable using current gate state store contract', async () => {
    const gateStateStore = {
      getCurrentState: jest.fn().mockReturnValue({
        enabled: false,
      }),
      enableGateSystem: jest.fn().mockResolvedValue(undefined),
    };

    const systemControl = createConsolidatedSystemControl(createLogger(), () => Promise.resolve());
    systemControl.setGateStateStore(gateStateStore as any);

    await systemControl.handleAction(
      { action: 'gates', operation: 'enable', reason: 'tenant-enable' },
      { organizationId: 'org-a', workspaceId: 'workspace-a' }
    );

    // requestScope is undefined because raw extra lacks MCP SDK authInfo structure
    expect(gateStateStore.getCurrentState).toHaveBeenCalledWith(undefined);
    expect(gateStateStore.enableGateSystem).toHaveBeenCalledWith('tenant-enable', undefined);
  });

  test('gate status and health lookups use no identity-scoped arguments', async () => {
    const gateStateStore = {
      getCurrentState: jest.fn().mockReturnValue({
        enabled: true,
      }),
      getSystemHealth: jest.fn().mockReturnValue({
        status: 'healthy',
        enabled: true,
        totalValidations: 2,
        successRate: 100,
        averageValidationTime: 50,
        lastValidationTime: null,
        issues: [],
      }),
    };

    const systemControl = createConsolidatedSystemControl(createLogger(), () => Promise.resolve());
    systemControl.setGateStateStore(gateStateStore as any);

    await systemControl.handleAction(
      { action: 'gates', operation: 'status' },
      { organizationId: 'org-a', workspaceId: 'workspace-a' }
    );

    // requestScope is undefined because raw extra lacks MCP SDK authInfo structure
    expect(gateStateStore.getCurrentState).toHaveBeenCalledWith(undefined);
    expect(gateStateStore.getSystemHealth).toHaveBeenCalledWith(undefined);
  });
});
