import { describe, expect, jest, test } from '@jest/globals';

import { createConsolidatedSystemControl } from '../../../../src/mcp/tools/system-control/index.js';
import { GateActionHandler } from '../../../../src/mcp/tools/system-control/handlers/gate-action-handler.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { SystemControlContext } from '../../../../src/mcp/tools/system-control/core/types.js';
import type { ToolResponse } from '../../../../src/shared/types/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

function policyHandler(runtimeInitiallyEnabled: boolean, configuredEnabled?: boolean) {
  let runtimeEnabled = runtimeInitiallyEnabled;
  const gateStateStore = {
    getCurrentState: jest.fn(() => ({ enabled: runtimeEnabled })),
    getSystemHealth: jest.fn(() => ({
      status: runtimeEnabled ? 'healthy' : 'disabled',
      enabled: runtimeEnabled,
      totalValidations: 2,
      successRate: 100,
      averageValidationTime: 50,
      lastValidationTime: null,
      issues: [],
    })),
    enableGateSystem: jest.fn(async () => {
      runtimeEnabled = true;
    }),
    disableGateSystem: jest.fn(async () => {
      runtimeEnabled = false;
    }),
  };
  const configManager =
    configuredEnabled === undefined
      ? undefined
      : { getGatesConfig: jest.fn(() => ({ enabled: configuredEnabled })) };
  const context = {
    logger: createLogger(),
    startTime: 0,
    gateStateStore,
    configManager,
    persistGateConfig: jest.fn(async () => undefined),
    createMinimalSystemResponse: (text: string): ToolResponse => ({
      content: [{ type: 'text', text }],
      isError: false,
    }),
  } as unknown as SystemControlContext;
  const textOf = async (operation: string): Promise<string> => {
    const response = await new GateActionHandler(context).execute({ operation });
    return (response.content[0] as { text: string }).text;
  };
  return { textOf, gateStateStore, configManager };
}

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

    // requestScope is undefined because raw extra lacks the SDK `http` carrier (headers, authInfo)
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

    // requestScope is undefined because raw extra lacks the SDK `http` carrier (headers, authInfo)
    expect(gateStateStore.getCurrentState).toHaveBeenCalledWith(undefined);
    expect(gateStateStore.getSystemHealth).toHaveBeenCalledWith(undefined);
  });
});

describe('gate status and enable messaging', () => {
  test.each([
    { runtime: true, configured: true, effective: 'Active' },
    { runtime: true, configured: false, effective: 'Inactive' },
    { runtime: false, configured: true, effective: 'Inactive' },
    { runtime: false, configured: false, effective: 'Inactive' },
  ])(
    'reports runtime=$runtime and config=$configured as $effective',
    async ({ runtime, configured, effective }) => {
      const { textOf, configManager } = policyHandler(runtime, configured);
      const text = await textOf('status');
      expect(text).toContain(
        `**System State**: ${runtime ? 'Enabled' : 'Disabled'} (runtime switch)`
      );
      expect(text).toContain(`**Runtime Switch**: ${runtime ? 'Enabled' : 'Disabled'}`);
      expect(text).toContain(`**Configuration Enabled**: ${configured ? 'Enabled' : 'Disabled'}`);
      expect(text).toContain(`**Effective Review/Guidance**: ${effective}`);
      expect(text).toContain('**Runtime Performance Metrics**:');
      expect(configManager?.getGatesConfig).toHaveBeenCalledTimes(1);
    }
  );

  test('reports unavailable configuration without treating runtime enabled as effective', async () => {
    const { textOf } = policyHandler(true);
    const text = await textOf('status');
    expect(text).toContain('**Runtime Switch**: Enabled');
    expect(text).toContain('**Configuration Enabled**: Unknown (configuration unavailable)');
    expect(text).toContain('**Effective Review/Guidance**: Unknown');
    expect(text).toContain('An unspecified `gates.enabled` permits review/guidance');
  });

  test('runtime off remains inactive when configuration is unavailable', async () => {
    const { textOf } = policyHandler(false);
    const text = await textOf('status');
    expect(text).toContain('**Configuration Enabled**: Unknown (configuration unavailable)');
    expect(text).toContain('**Effective Review/Guidance**: Inactive');
  });

  test.each([true, false])(
    'enabling the runtime switch with configured=%s reports effective review/guidance',
    async (configured) => {
      const { textOf, gateStateStore } = policyHandler(false, configured);
      const text = await textOf('enable');
      expect(gateStateStore.enableGateSystem).toHaveBeenCalledTimes(1);
      expect(text).toContain('**Runtime Switch**: Enabled');
      expect(text).toContain(`**Configuration Enabled**: ${configured ? 'Enabled' : 'Disabled'}`);
      expect(text).toContain(
        `**Effective Review/Guidance**: ${configured ? 'Active' : 'Inactive'}`
      );
      expect(text).not.toContain(
        'All template and chain executions will now include gate validation'
      );
    }
  );

  test('already-enabled runtime switch still reports configuration blocking review/guidance', async () => {
    const { textOf, gateStateStore } = policyHandler(true, false);
    const text = await textOf('enable');
    expect(gateStateStore.enableGateSystem).not.toHaveBeenCalled();
    expect(text).toContain('already enabled');
    expect(text).toContain('**Effective Review/Guidance**: Inactive');
  });

  test('health metrics describe the runtime switch even when configuration disables review', async () => {
    const { textOf } = policyHandler(true, false);
    const text = await textOf('health');
    expect(text).toContain('**Overall Status**: ✅ HEALTHY (runtime switch)');
    expect(text).toContain('**Runtime Performance Metrics**:');
    expect(text).toContain('- Runtime Switch Enabled: Yes');
    expect(text).not.toContain('**Effective Review/Guidance**');
  });
});
