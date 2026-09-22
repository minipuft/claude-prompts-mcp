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

    // Identity is read from token claims and request headers, both of which the SDK v2 puts
    // under `http` — a bare { organizationId, workspaceId } object carries no identity.
    await systemControl.handleAction(
      { action: 'framework', operation: 'switch', framework: 'react' },
      {
        http: {
          req: new Request('http://localhost/mcp', {
            headers: { 'x-workspace-id': 'workspace-a' },
          }),
        },
      }
    );

    // The scope argument is the point: without it every workspace's switch landed on
    // one shared row. Asserted explicitly so a regression cannot pass silently.
    //
    // `workspaceId` was added 2026-08-27 and is the half that actually works.
    // `FrameworkStateStore.resolveStateKey` keys on `resolveContinuityScopeId`, which reads
    // `workspaceId`/`organizationId` and has never read `continuityScopeId` — so the shape
    // this test previously pinned resolved to the literal `'default'` bucket, and
    // `framework-state-store.ts:356` SKIPS PERSISTENCE ENTIRELY on that key. The switch was
    // therefore not merely pooled across workspaces, it was never written. The test passed
    // throughout, pinning the defect its own comment describes preventing.
    expect(frameworkManager.switchFramework).toHaveBeenCalledWith(
      'react',
      expect.stringContaining('react'),
      { continuityScopeId: 'workspace-a', workspaceId: 'workspace-a' }
    );
  });

  test('framework list with no request identity reads the process-default scope', async () => {
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

    // `undefined` is the process default; the call still names its scope argument.
    expect(frameworkStateStore.getCurrentState).toHaveBeenCalledWith(undefined);
    expect(frameworkManager.listFrameworks).toHaveBeenCalledWith();
  });

  // `status` reported the process-default row whatever workspace asked: a switch under
  // `x-workspace-id: A` read back as the default framework under A. Every status operation
  // and the shared response footer must read the request's own row.
  test.each(['overview', 'health', 'diagnostics', 'framework_status'])(
    'status %s reads the requesting workspace, not the process default',
    async (operation) => {
      const health = {
        status: 'healthy',
        activeFramework: 'react',
        frameworkSystemEnabled: true,
        availableFrameworks: ['react'],
        lastSwitchTime: null,
        switchingMetrics: {
          totalSwitches: 0,
          successfulSwitches: 0,
          failedSwitches: 0,
          averageResponseTime: 0,
        },
        issues: [],
      };
      const frameworkStateStore = {
        getCurrentState: jest.fn().mockReturnValue({ activeFramework: 'react' }),
        getSystemHealth: jest.fn().mockReturnValue(health),
      };

      const systemControl = createConsolidatedSystemControl(createLogger(), () =>
        Promise.resolve()
      );
      systemControl.setFrameworkStateStore(frameworkStateStore as any);

      await systemControl.handleAction(
        { action: 'status', operation },
        {
          http: {
            req: new Request('http://localhost/mcp', {
              headers: { 'x-workspace-id': 'workspace-a' },
            }),
          },
        }
      );

      const scope = { continuityScopeId: 'workspace-a', workspaceId: 'workspace-a' };
      expect(frameworkStateStore.getSystemHealth.mock.calls.length).toBeGreaterThan(0);
      for (const call of frameworkStateStore.getSystemHealth.mock.calls) {
        expect(call).toEqual([scope]);
      }
      for (const call of frameworkStateStore.getCurrentState.mock.calls) {
        expect(call).toEqual([scope]);
      }
    }
  );
});
