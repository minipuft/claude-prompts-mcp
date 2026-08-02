import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createFrameworkManager } from '../../../src/engine/frameworks/framework-manager.js';
import {
  createFrameworkStateStore,
  type PersistedFrameworkState,
} from '../../../src/engine/frameworks/framework-state-store.js';
import {
  GateStateStore,
  type PersistedGateSystemState,
} from '../../../src/engine/gates/gate-state-store.js';
import { SqliteEngine, SqliteStateStore } from '../../../src/infra/database/index.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { resolveContinuityScopeId } from '../../../src/shared/utils/request-identity-scope.js';

import type { Logger } from '../../../src/infra/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

type ClientIdentity = {
  client: 'codex-a' | 'codex-b' | 'claude-code' | 'other';
  organizationId: string;
  workspaceId: string;
};

const SHARED_WORKSPACE_CLIENTS: ClientIdentity[] = [
  {
    client: 'codex-a',
    organizationId: 'org-codex-a',
    workspaceId: 'workspace-shared',
  },
  {
    client: 'codex-b',
    organizationId: 'org-codex-b',
    workspaceId: 'workspace-shared',
  },
  {
    client: 'claude-code',
    organizationId: 'org-claude',
    workspaceId: 'workspace-shared',
  },
];

const OTHER_WORKSPACE_CLIENT: ClientIdentity = {
  client: 'other',
  organizationId: 'org-other',
  workspaceId: 'workspace-isolated',
};

describe('Shared Workspace Continuity', () => {
  let tmpDir: string;
  let dbManager: SqliteEngine;
  let logger: Logger;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-continuity-'));
    logger = createLogger();
    dbManager = await SqliteEngine.getInstance(tmpDir, logger);
    await dbManager.initialize();
  });

  afterAll(async () => {
    await dbManager.shutdown();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // no-op
    }
  });

  beforeEach(() => {
    dbManager.run(`DELETE FROM kv_state WHERE key IN ('framework', 'gates')`);
    dbManager.run('DELETE FROM chain_sessions');
  });

  test('same workspace shares active framework across Codex and Claude clients', async () => {
    const frameworkStore = new SqliteStateStore<PersistedFrameworkState>(
      dbManager,
      {
        tableName: 'kv_state',
        key: 'framework',
        defaultState: () => ({
          version: '1.0.0',
          frameworkSystemEnabled: false,
          activeFramework: 'CAGEERF',
          lastSwitchedAt: new Date().toISOString(),
          switchReason: 'Initial framework selection',
        }),
      },
      logger
    );
    const manager = await createFrameworkStateStore(logger, tmpDir, {
      stateStore: frameworkStore,
    });

    const sharedScope = SHARED_WORKSPACE_CLIENTS[0];
    const sharedBefore = manager.getCurrentState(sharedScope).activeFramework.toLowerCase();
    const sharedTarget = sharedBefore === 'react' ? 'cageerf' : 'react';
    const isolatedTarget = sharedTarget === 'react' ? 'cageerf' : 'react';

    await manager.switchFramework(
      {
        targetFramework: sharedTarget,
        reason: `${sharedScope.client}-switch`,
      },
      sharedScope
    );
    await manager.switchFramework(
      {
        targetFramework: isolatedTarget,
        reason: `${OTHER_WORKSPACE_CLIENT.client}-switch`,
      },
      OTHER_WORKSPACE_CLIENT
    );

    for (const client of SHARED_WORKSPACE_CLIENTS) {
      const sharedState = manager.getCurrentState(client);
      expect(sharedState.activeFramework.toLowerCase()).toBe(sharedTarget);
    }

    const isolatedState = manager.getCurrentState(OTHER_WORKSPACE_CLIENT);
    expect(isolatedState.activeFramework.toLowerCase()).toBe(isolatedTarget);

    await manager.shutdown();
  });

  test('a process-scoped switch survives a restart of that project', async () => {
    const makeStore = (): SqliteStateStore<PersistedFrameworkState> =>
      new SqliteStateStore<PersistedFrameworkState>(
        dbManager,
        {
          tableName: 'kv_state',
          key: 'framework',
          defaultState: () => ({
            version: '1.0.0',
            frameworkSystemEnabled: false,
            activeFramework: 'CAGEERF',
            lastSwitchedAt: new Date().toISOString(),
            switchReason: 'Initial framework selection',
          }),
        },
        logger
      );

    const project = { workspaceId: 'project-restart' };

    // First process: switch with no explicit scope, so it lands on the process default.
    const first = await createFrameworkStateStore(logger, tmpDir, {
      stateStore: makeStore(),
      defaultScope: project,
    });
    await first.switchFramework({ targetFramework: 'react', reason: 'first-run' });
    await first.shutdown();

    // Second process, same project. Reading the unscoped row here instead of the project's own
    // would report the config default and silently discard the switch above.
    const second = await createFrameworkStateStore(logger, tmpDir, {
      stateStore: makeStore(),
      defaultFramework: 'cageerf',
      defaultScope: project,
    });
    expect(second.getCurrentState().activeFramework.toLowerCase()).toBe('react');

    await second.shutdown();
  });

  test('an unset workspace inherits the config floor, not another workspace switch', async () => {
    const frameworkStore = new SqliteStateStore<PersistedFrameworkState>(
      dbManager,
      {
        tableName: 'kv_state',
        key: 'framework',
        defaultState: () => ({
          version: '1.0.0',
          frameworkSystemEnabled: false,
          activeFramework: 'CAGEERF',
          lastSwitchedAt: new Date().toISOString(),
          switchReason: 'Initial framework selection',
        }),
      },
      logger
    );
    const stateStore = await createFrameworkStateStore(logger, tmpDir, {
      stateStore: frameworkStore,
      defaultFramework: 'radiant',
    });

    const busy = SHARED_WORKSPACE_CLIENTS[0]!;
    await stateStore.switchFramework({ targetFramework: 'react', reason: 'busy-switch' }, busy);

    // The distinction that matters: a workspace nobody has configured falls back to the
    // project's declared default, not to whatever another workspace happens to be on.
    const untouched = { workspaceId: 'workspace-never-seen' };
    expect(stateStore.getCurrentState(untouched).activeFramework.toLowerCase()).toBe('radiant');
    expect(stateStore.getCurrentState(busy).activeFramework.toLowerCase()).toBe('react');

    await stateStore.shutdown();
  });

  test('a scoped FrameworkManager switch persists to that workspace only', async () => {
    const frameworkStore = new SqliteStateStore<PersistedFrameworkState>(
      dbManager,
      {
        tableName: 'kv_state',
        key: 'framework',
        defaultState: () => ({
          version: '1.0.0',
          frameworkSystemEnabled: false,
          activeFramework: 'CAGEERF',
          lastSwitchedAt: new Date().toISOString(),
          switchReason: 'Initial framework selection',
        }),
      },
      logger
    );
    const stateStore = await createFrameworkStateStore(logger, tmpDir, {
      stateStore: frameworkStore,
    });

    // Exercises the manager → store chain, which is where scope used to be dropped.
    const manager = await createFrameworkManager(logger);
    manager.setFrameworkStateStore(stateStore);

    const target = SHARED_WORKSPACE_CLIENTS[0]!;
    const bystander = OTHER_WORKSPACE_CLIENT;
    const bystanderBefore = stateStore.getCurrentState(bystander).activeFramework.toLowerCase();

    const result = await manager.switchFramework('react', 'scoped-switch', target);
    expect(result.success).toBe(true);

    expect(stateStore.getCurrentState(target).activeFramework.toLowerCase()).toBe('react');
    // The other workspace must be untouched by a switch it did not request.
    expect(stateStore.getCurrentState(bystander).activeFramework.toLowerCase()).toBe(
      bystanderBefore
    );

    await stateStore.shutdown();
  });

  test('same workspace shares gate enabled state and metrics, different workspace is isolated', async () => {
    const gateStore = new SqliteStateStore<PersistedGateSystemState>(
      dbManager,
      {
        tableName: 'kv_state',
        key: 'gates',
        defaultState: () => ({
          enabled: true,
          enabledAt: new Date().toISOString(),
          enableReason: 'System initialization (default enabled)',
          validationMetrics: {
            totalValidations: 0,
            successfulValidations: 0,
            averageValidationTime: 0,
            lastValidationTime: null,
          },
        }),
      },
      logger
    );
    const manager = new GateStateStore(logger, gateStore);
    await manager.initialize();

    await manager.disableGateSystem('shared-disable', SHARED_WORKSPACE_CLIENTS[0]);
    manager.recordValidation(true, 120, SHARED_WORKSPACE_CLIENTS[1]);
    await manager.enableGateSystem('isolated-enable', OTHER_WORKSPACE_CLIENT);
    manager.recordValidation(false, 500, OTHER_WORKSPACE_CLIENT);

    for (const client of SHARED_WORKSPACE_CLIENTS) {
      expect(manager.isGateSystemEnabled(client)).toBe(false);
      const health = manager.getSystemHealth(client);
      expect(health.totalValidations).toBe(1);
      expect(health.averageValidationTime).toBe(120);
    }

    const isolatedHealth = manager.getSystemHealth(OTHER_WORKSPACE_CLIENT);
    expect(isolatedHealth.enabled).toBe(true);
    expect(isolatedHealth.totalValidations).toBe(1);
    expect(isolatedHealth.averageValidationTime).toBe(500);

    await manager.cleanup();
  });

  test('same workspace + chain_id resumes shared session, different workspace stays isolated', async () => {
    const textReferenceManagerStub = {
      storeChainStepResult: jest.fn(),
      buildChainVariables: jest.fn().mockReturnValue({}),
      getChainStepMetadata: jest.fn().mockReturnValue(null),
      clearChainStepResults: jest.fn(),
    };

    const chainSessionStore = new ChainSessionStore(
      logger,
      textReferenceManagerStub as any,
      {
        cleanupIntervalMs: 10_000,
      },
      dbManager
    );

    const codexScope = resolveContinuityScopeId(SHARED_WORKSPACE_CLIENTS[0]);
    const codexPeerScope = resolveContinuityScopeId(SHARED_WORKSPACE_CLIENTS[1]);
    const claudeScope = resolveContinuityScopeId(SHARED_WORKSPACE_CLIENTS[2]);
    const isolatedScope = resolveContinuityScopeId(OTHER_WORKSPACE_CLIENT);

    await chainSessionStore.createSession(
      'session-shared-1',
      'chain-shared#1',
      2,
      {},
      {
        continuityScopeId: codexScope,
        workspaceId: codexScope,
      }
    );

    const codexPeerSession = chainSessionStore.getSessionByChainIdentifier('chain-shared#1', {
      continuityScopeId: codexPeerScope,
      workspaceId: codexPeerScope,
    });
    const claudeSession = chainSessionStore.getSessionByChainIdentifier('chain-shared#1', {
      continuityScopeId: claudeScope,
      workspaceId: claudeScope,
    });
    const isolatedSession = chainSessionStore.getSessionByChainIdentifier('chain-shared#1', {
      continuityScopeId: isolatedScope,
      workspaceId: isolatedScope,
    });

    expect(codexPeerSession?.sessionId).toBe('session-shared-1');
    expect(claudeSession?.sessionId).toBe('session-shared-1');
    expect(isolatedSession).toBeUndefined();

    await chainSessionStore.createSession(
      'session-isolated-1',
      'chain-shared#1',
      2,
      {},
      {
        continuityScopeId: isolatedScope,
        workspaceId: isolatedScope,
      }
    );
    const isolatedAfterCreate = chainSessionStore.getSessionByChainIdentifier('chain-shared#1', {
      continuityScopeId: isolatedScope,
      workspaceId: isolatedScope,
    });
    expect(isolatedAfterCreate?.sessionId).toBe('session-isolated-1');

    await chainSessionStore.cleanup();
  });
});
