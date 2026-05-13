import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createFrameworkStateStore,
  type PersistedFrameworkState,
} from '../../../src/engine/frameworks/framework-state-store.js';
import {
  GateStateStore,
  type PersistedGateSystemState,
} from '../../../src/engine/gates/gate-state-store.js';
import { SqliteEngine, SqliteStateStore } from '../../../src/infra/database/index.js';
import { ChainSessionStore } from '../../../src/modules/chains/chain-session-store.js';
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
    const manager = await createFrameworkStateStore(logger, tmpDir, frameworkStore);

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
