// @lifecycle test - Pins the tenant key each caller of resolveContinuityScopeId writes under
/**
 * Three callers answer "which tenant do these rows belong to?": the execution-record ledger, the
 * version-history service, and the CLI's guess in `cli-shared/version-history-scope.ts`. Each
 * once carried its own resolver (`resolveTenantId`) and its own fallback; all three now end in
 * `resolveContinuityScopeId`, so one input yields one key wherever it is written.
 *
 * Each case reads the key back out of the real table the caller wrote, so the assertion is on
 * what is stored, not on what a helper returned.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createTestDatabaseManager } from '../../helpers/test-database.js';
import { resolveTenantId as guessCliTenantId } from '../../../src/cli-shared/version-history-scope.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';

import type { TestDatabaseContext } from '../../helpers/test-database.js';
import type { StateStoreOptions } from '../../../src/shared/types/persistence.js';

const SCOPE_CASES: ReadonlyArray<{ label: string; scope: StateStoreOptions; expected: string }> = [
  {
    label: 'workspace set',
    scope: { workspaceId: 'ws-a', organizationId: 'org-a' },
    expected: 'ws-a',
  },
  { label: 'organization only', scope: { organizationId: 'org-a' }, expected: 'org-a' },
  { label: 'neither', scope: {}, expected: 'default' },
  {
    label: 'an already-resolved continuity scope wins',
    scope: { continuityScopeId: 'resolved-x', workspaceId: 'ws-a' },
    expected: 'resolved-x',
  },
  {
    label: 'a blank continuity scope falls through to the workspace',
    scope: { continuityScopeId: '   ', workspaceId: 'ws-a' },
    expected: 'ws-a',
  },
];

describe('tenant key per caller', () => {
  let dbCtx: TestDatabaseContext;

  beforeEach(async () => {
    dbCtx = await createTestDatabaseManager('tenant-scope-callers');
  });

  afterEach(async () => {
    await dbCtx.cleanup();
  });

  describe('execution-record ledger', () => {
    it.each(SCOPE_CASES)('$label -> $expected', ({ scope, expected }) => {
      const store = new ExecutionRecordStore(dbCtx.dbManager, dbCtx.logger);
      const executionId = store.append({
        sessionId: 'sess-tenant',
        status: 'working',
        startedAt: Date.now(),
        scope,
      });

      const row = dbCtx.dbManager.queryOne<{ tenant_id: string }>(
        'SELECT tenant_id FROM execution_records WHERE execution_id = ?',
        [executionId]
      );
      expect(row?.tenant_id).toBe(expected);
    });
  });

  describe('version-history service', () => {
    it.each(SCOPE_CASES)('$label -> $expected', async ({ scope, expected }) => {
      const service = new VersionHistoryService({
        logger: dbCtx.logger,
        configManager: {
          getVersioningConfig: () => ({ enabled: true, maxVersions: 5, autoVersion: true }),
          getServerRoot: () => dbCtx.testDir,
        },
        dbManager: dbCtx.dbManager,
        scope,
      });

      await service.saveVersion('prompt', 'tenant-probe', { a: 1 });

      const row = dbCtx.dbManager.queryOne<{ tenant_id: string }>(
        `SELECT tenant_id FROM version_history WHERE resource_type = 'prompt' AND resource_id = 'tenant-probe'`
      );
      expect(row?.tenant_id).toBe(expected);
    });
  });

  describe('cli guess (workspace id or launch directory only; it has no organization input)', () => {
    let workDir: string;
    let dbPath: string;
    let savedProjectDir: string | undefined;

    beforeEach(() => {
      workDir = mkdtempSync(path.join(tmpdir(), 'tenant-cli-guess-'));
      mkdirSync(path.join(workDir, 'runtime-state'));
      dbPath = path.join(workDir, 'runtime-state', 'state.db');
      savedProjectDir = process.env['CLAUDE_PROJECT_DIR'];
    });

    afterEach(() => {
      jest.restoreAllMocks();
      if (savedProjectDir === undefined) delete process.env['CLAUDE_PROJECT_DIR'];
      else process.env['CLAUDE_PROJECT_DIR'] = savedProjectDir;
      rmSync(workDir, { recursive: true, force: true });
    });

    it('a configured workspace id wins over the launch directory', () => {
      writeFileSync(
        path.join(workDir, 'config.json'),
        JSON.stringify({ identity: { launchDefaults: { workspaceId: 'ws-configured' } } })
      );
      process.env['CLAUDE_PROJECT_DIR'] = '/srv/launch-dir';

      expect(guessCliTenantId(dbPath)).toBe('ws-configured');
    });

    it('with no configured id, the launch directory names the tenant', () => {
      process.env['CLAUDE_PROJECT_DIR'] = '/srv/launch-dir';

      expect(guessCliTenantId(dbPath)).toBe('launch-dir');
    });

    it('with neither a configured id nor a launch directory name, the tenant is the shared default', () => {
      delete process.env['CLAUDE_PROJECT_DIR'];
      jest.spyOn(process, 'cwd').mockReturnValue('/');

      expect(guessCliTenantId(dbPath)).toBe('default');
    });
  });
});
