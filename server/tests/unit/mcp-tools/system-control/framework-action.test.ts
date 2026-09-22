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

/**
 * P4.114 — what a toggle SAYS about persistence, and whether `persist` reaches the writer.
 *
 * The framework handler dropped `persist` on the way in: the flag is declared on the tool, the
 * call was accepted, and the enable/disable methods were invoked without it — so a caller asking
 * for a persisted change got a plain success reply and an unchanged config file. The gate handler
 * forwarded it all along, which is why the gate arm below is the control: the two differ in
 * exactly the identifier under test.
 */
describe('a toggle reply states its persistence outcome', () => {
  const makeFrameworkControl = (): {
    systemControl: ReturnType<typeof createConsolidatedSystemControl>;
    persistFrameworkConfig: jest.Mock;
  } => {
    const frameworkStateStore = {
      getCurrentState: jest.fn().mockReturnValue({
        frameworkSystemEnabled: true,
        activeFramework: 'react',
      }),
      disableFrameworkSystem: jest.fn(async () => undefined),
      enableFrameworkSystem: jest.fn(async () => undefined),
    };
    const systemControl = createConsolidatedSystemControl(createLogger(), () => Promise.resolve());
    systemControl.setFrameworkStateStore(frameworkStateStore as any);
    const persistFrameworkConfig = jest.fn(
      async () =>
        '📁 Persisted framework toggles as config version 7 — rollback puts the previous file back.'
    );
    (systemControl as unknown as { persistFrameworkConfig: unknown }).persistFrameworkConfig =
      persistFrameworkConfig;
    return {
      systemControl,
      persistFrameworkConfig: persistFrameworkConfig as unknown as jest.Mock,
    };
  };

  const textOf = (response: unknown): string =>
    ((response as { content?: Array<{ text?: string }> }).content ?? [])
      .map((part) => part.text ?? '')
      .join('\n');

  test('without persist, it names the restart limit and writes nothing', async () => {
    const { systemControl, persistFrameworkConfig } = makeFrameworkControl();

    const response = await systemControl.handleAction(
      { action: 'framework', operation: 'disable', reason: 'unit' },
      {}
    );

    expect(textOf(response)).toContain('ends when the server restarts');
    expect(persistFrameworkConfig).not.toHaveBeenCalled();
  });

  test('with persist, the writer runs and the reply carries its version', async () => {
    const { systemControl, persistFrameworkConfig } = makeFrameworkControl();

    const response = await systemControl.handleAction(
      { action: 'framework', operation: 'disable', reason: 'unit', persist: true },
      {}
    );

    expect(persistFrameworkConfig).toHaveBeenCalledWith(false);
    expect(textOf(response)).toContain('config version 7');
    expect(textOf(response)).not.toContain('ends when the server restarts');
  });

  // A toggle asking for the state it is already in used to return early, before any persistence
  // ran — so `enable, persist: true` on an already-enabled system reported success and left the
  // config file alone. The early reply now carries the same clause, and the persisted form runs
  // the write (which records nothing when the file already says so, and says that).
  test('a toggle that changes nothing still says whether it was persisted', async () => {
    const frameworkStateStore = {
      getCurrentState: jest.fn().mockReturnValue({
        frameworkSystemEnabled: true,
        activeFramework: 'react',
      }),
      enableFrameworkSystem: jest.fn(async () => undefined),
    };
    const systemControl = createConsolidatedSystemControl(createLogger(), () => Promise.resolve());
    systemControl.setFrameworkStateStore(frameworkStateStore as any);
    const persistFrameworkConfig = jest.fn(
      async (_enabled: boolean) => '📁 Persisted framework toggles.'
    );
    (systemControl as unknown as { persistFrameworkConfig: unknown }).persistFrameworkConfig =
      persistFrameworkConfig;

    const plain = await systemControl.handleAction(
      { action: 'framework', operation: 'enable', reason: 'unit' },
      {}
    );
    expect(textOf(plain)).toContain('already enabled');
    expect(textOf(plain)).toContain('ends when the server restarts');
    expect(persistFrameworkConfig).not.toHaveBeenCalled();

    const persisted = await systemControl.handleAction(
      { action: 'framework', operation: 'enable', reason: 'unit', persist: true },
      {}
    );
    expect(textOf(persisted)).toContain('already enabled');
    expect(persistFrameworkConfig).toHaveBeenCalledWith(true);
    expect(frameworkStateStore.enableFrameworkSystem).not.toHaveBeenCalled();
  });

  // The control, one identifier over: the gate handler's own toggle, whose plumbing was already
  // correct, must report the same two ways.
  test('a gate toggle without persist names the restart limit too', async () => {
    const gateStateStore = {
      getCurrentState: jest.fn().mockReturnValue({ enabled: true }),
      disableGateSystem: jest.fn(async () => undefined),
    };
    const systemControl = createConsolidatedSystemControl(createLogger(), () => Promise.resolve());
    systemControl.setGateStateStore(gateStateStore as any);

    const response = await systemControl.handleAction(
      { action: 'gates', operation: 'disable', reason: 'unit' },
      {}
    );

    expect(textOf(response)).toContain('ends when the server restarts');
    expect(textOf(response)).toContain('`gates.enabled`');
  });
});
