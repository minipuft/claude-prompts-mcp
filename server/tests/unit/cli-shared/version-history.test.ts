import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import {
  loadHistory,
  getVersion,
  compareVersions,
  saveVersion,
  recordEditResult,
  rollbackVersion,
  deleteVersionRows,
  renameHistoryResource,
  formatHistoryTable,
} from '../../../src/cli-shared/version-history.js';
import type { HistoryFile } from '../../../src/modules/versioning/types.js';
import type { HistoryResourceRef } from '../../../src/cli-shared/version-history.js';
import { seedStateDbSchema } from '../../helpers/test-database.js';

const SAMPLE_HISTORY: HistoryFile = {
  resource_type: 'prompt',
  resource_id: 'test-prompt',
  current_version: 3,
  versions: [
    {
      version: 3,
      date: '2025-06-15T10:30:00.000Z',
      snapshot: { id: 'test-prompt', name: 'Test', description: 'v3 description' },
      diff_summary: '+1/-0',
      description: 'Updated description',
    },
    {
      version: 2,
      date: '2025-06-14T09:00:00.000Z',
      snapshot: { id: 'test-prompt', name: 'Test', description: 'v2 description' },
      diff_summary: '+1/-1',
      description: 'Simplified',
    },
    {
      version: 1,
      date: '2025-06-13T08:00:00.000Z',
      snapshot: { id: 'test-prompt', name: 'Test', description: 'v1 description' },
      diff_summary: '',
      description: 'Initial',
    },
  ],
};

const PROMPT_REF: HistoryResourceRef = { resourceType: 'prompt', resourceId: 'test-prompt' };
const GATE_REF: HistoryResourceRef = { resourceType: 'gate', resourceId: 'my-gate' };

function seedPromptHistory(resourceDir: string): void {
  saveVersion(
    resourceDir,
    'prompt',
    'test-prompt',
    { id: 'test-prompt', description: 'v1 description' },
    {
      description: 'Initial',
      diff_summary: '',
    }
  );
  saveVersion(
    resourceDir,
    'prompt',
    'test-prompt',
    { id: 'test-prompt', description: 'v2 description' },
    {
      description: 'Simplified',
      diff_summary: '+1/-1',
    }
  );
  saveVersion(
    resourceDir,
    'prompt',
    'test-prompt',
    { id: 'test-prompt', description: 'v3 description' },
    {
      description: 'Updated description',
      diff_summary: '+1/-0',
    }
  );
}

describe('version-history', () => {
  let tempDir: string;
  let promptDir: string;
  let gateDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cpm-vh-'));
    // The engine owns this DDL. `version-history.ts` deliberately no longer creates it —
    // its old `ensure_schema` predated the scope columns and broke server startup.
    await seedStateDbSchema(tempDir);
    promptDir = join(tempDir, 'resources', 'prompts', 'general', 'test-prompt');
    gateDir = join(tempDir, 'resources', 'gates', 'my-gate');
    mkdirSync(promptDir, { recursive: true });
    mkdirSync(gateDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadHistory', () => {
    it('returns null when no history exists', () => {
      expect(loadHistory(promptDir, PROMPT_REF)).toBeNull();
    });

    it('reads stored SQLite history', () => {
      seedPromptHistory(promptDir);
      const result = loadHistory(promptDir, PROMPT_REF);
      expect(result).not.toBeNull();
      expect(result!.current_version).toBe(3);
      expect(result!.versions).toHaveLength(3);
      expect(result!.versions[0]?.description).toBe('Updated description');
    });
  });

  describe('getVersion', () => {
    it('returns specific version entry', () => {
      seedPromptHistory(promptDir);
      const entry = getVersion(promptDir, 2, PROMPT_REF);
      expect(entry).not.toBeNull();
      expect(entry!.description).toBe('Simplified');
    });

    it('returns null for nonexistent version', () => {
      seedPromptHistory(promptDir);
      expect(getVersion(promptDir, 99, PROMPT_REF)).toBeNull();
    });
  });

  describe('compareVersions', () => {
    beforeEach(() => {
      seedPromptHistory(promptDir);
    });

    it('returns both entries on success', () => {
      const result = compareVersions(promptDir, 1, 3, PROMPT_REF);
      expect(result.success).toBe(true);
      expect(result.from!.version).toBe(1);
      expect(result.to!.version).toBe(3);
    });

    it('errors when from version is missing', () => {
      const result = compareVersions(promptDir, 99, 3, PROMPT_REF);
      expect(result.success).toBe(false);
      expect(result.error).toContain('99');
    });
  });

  describe('saveVersion', () => {
    it('creates new history when none exists', () => {
      const result = saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt' });
      expect(result.success).toBe(true);
      expect(result.version).toBe(1);

      const history = loadHistory(promptDir, PROMPT_REF);
      expect(history).not.toBeNull();
      expect(history!.current_version).toBe(1);
      expect(history!.versions).toHaveLength(1);
    });

    it('appends to existing history', () => {
      seedPromptHistory(promptDir);
      const result = saveVersion(promptDir, 'prompt', 'test-prompt', {
        id: 'test-prompt',
        description: 'v4',
      });
      expect(result.success).toBe(true);
      expect(result.version).toBe(4);

      const history = loadHistory(promptDir, PROMPT_REF);
      expect(history!.current_version).toBe(4);
      expect(history!.versions).toHaveLength(4);
      expect(history!.versions[0]?.version).toBe(4);
    });

    it('respects custom description and diff_summary', () => {
      const result = saveVersion(
        gateDir,
        'gate',
        'my-gate',
        { id: 'g' },
        {
          description: 'Custom desc',
          diff_summary: '+2/-1',
        }
      );
      expect(result.success).toBe(true);
      const history = loadHistory(gateDir, GATE_REF);
      expect(history!.versions[0]?.description).toBe('Custom desc');
      expect(history!.versions[0]?.diff_summary).toBe('+2/-1');
    });

    it('prunes old versions beyond max', () => {
      for (let i = 0; i < 51; i += 1) {
        saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt', version: i + 1 });
      }
      const history = loadHistory(promptDir, PROMPT_REF);
      expect(history!.versions).toHaveLength(50);
      expect(history!.versions[0]?.version).toBe(51);
    });
  });

  describe('rollbackVersion', () => {
    beforeEach(() => {
      seedPromptHistory(promptDir);
    });

    // Go-forward semantics (P7-F10): the live state ({description: 'current'}) differs from
    // v3's recorded snapshot, so it is bridged as v4, and the RESTORED (target) content is
    // recorded as v5 — the newest version now holds what the rollback PRODUCED, not what
    // preceded it. Mirrors VersionHistoryService's rollback test exactly.
    it('bridges an unrecorded live state, then records the restored content as newest', () => {
      const currentSnapshot = { id: 'test-prompt', description: 'current' };
      const result = rollbackVersion(promptDir, 'prompt', 'test-prompt', 1, currentSnapshot);

      expect(result.success).toBe(true);
      expect(result.restored_version).toBe(1);
      expect(result.saved_version).toBe(5); // v4 = bridged live state, v5 = restored state
      expect(result.snapshot).toBeDefined();
      expect(result.snapshot!.description).toBe('v1 description');

      const history = loadHistory(promptDir, PROMPT_REF);
      expect(history!.current_version).toBe(5);
      const bridged = getVersion(promptDir, 4, PROMPT_REF);
      expect(bridged!.snapshot).toEqual(currentSnapshot);
      expect(bridged!.description).toContain('Bridge');
      const restored = getVersion(promptDir, 5, PROMPT_REF);
      expect(restored!.description).toBe('Rollback to v1');
    });

    it('records exactly one row when the live state is already the latest recorded snapshot', () => {
      // seedPromptHistory's v3 snapshot is exactly this — no bridge needed.
      const currentSnapshot = { id: 'test-prompt', description: 'v3 description' };
      const result = rollbackVersion(promptDir, 'prompt', 'test-prompt', 1, currentSnapshot);

      expect(result.saved_version).toBe(4);
      const restored = getVersion(promptDir, 4, PROMPT_REF);
      expect(restored!.snapshot).toEqual({ id: 'test-prompt', description: 'v1 description' });
      expect(restored!.description).toBe('Rollback to v1');
    });

    it('errors when target version does not exist, and consumes no version number', () => {
      const before = loadHistory(promptDir, PROMPT_REF)!.current_version;
      const result = rollbackVersion(promptDir, 'prompt', 'test-prompt', 99, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('99');
      expect(loadHistory(promptDir, PROMPT_REF)!.current_version).toBe(before);
    });
  });

  describe('recordEditResult', () => {
    // P7-F10: parity target — mirrors VersionHistoryService.recordEditResult row-for-row so the
    // two accepted writers of `version_history` never disagree on what a version number means.
    it('first update of a never-before-recorded resource lays a bridge v1 and records v2', () => {
      const priorLive = { id: 'test-prompt', description: 'out-of-band' };
      const produced = { id: 'test-prompt', description: 'edited' };

      const result = recordEditResult(promptDir, 'prompt', 'test-prompt', priorLive, produced, {
        description: 'Update via resource_manager',
      });

      expect(result.success).toBe(true);
      expect(result.bridged).toBe(true);
      expect(result.version).toBe(2);

      const bridge = getVersion(promptDir, 1, PROMPT_REF);
      expect(bridge!.snapshot).toEqual(priorLive);
      expect(bridge!.description).toContain('Bridge');

      const newest = getVersion(promptDir, 2, PROMPT_REF);
      expect(newest!.snapshot).toEqual(produced);
      expect(newest!.description).toBe('Update via resource_manager');
    });

    it('subsequent update with an already-recorded live state records v3, no bridge', () => {
      const priorLive = { id: 'test-prompt', description: 'out-of-band' };
      const firstProduced = { id: 'test-prompt', description: 'edited' };
      recordEditResult(promptDir, 'prompt', 'test-prompt', priorLive, firstProduced, {
        description: 'Update via resource_manager',
      });

      // Live state now equals what the first edit produced — no bridge on the second edit.
      const secondProduced = { id: 'test-prompt', description: 'edited again' };
      const result = recordEditResult(
        promptDir,
        'prompt',
        'test-prompt',
        firstProduced,
        secondProduced,
        { description: 'Update via resource_manager' }
      );

      expect(result.bridged).toBe(false);
      expect(result.version).toBe(3);
      const newest = getVersion(promptDir, 3, PROMPT_REF);
      expect(newest!.snapshot).toEqual(secondProduced);

      const history = loadHistory(promptDir, PROMPT_REF);
      expect(history!.versions).toHaveLength(3);
    });
  });

  describe('deleteVersionRows', () => {
    it('returns true when history does not exist', () => {
      expect(deleteVersionRows(promptDir, PROMPT_REF)).toBe(true);
    });

    it('deletes existing history rows', () => {
      seedPromptHistory(promptDir);
      expect(deleteVersionRows(promptDir, PROMPT_REF)).toBe(true);
      expect(loadHistory(promptDir, PROMPT_REF)).toBeNull();
    });
  });

  describe('a chain and its steps', () => {
    // Twins that differ in ONE identifier each: the step `c/s` and the top-level prompt `s`; the
    // chain `c` and `c_other`, which shares its first letter but is not below it; the prompt `c`
    // and the gate `c`.
    const prompt = (resourceId: string): HistoryResourceRef => ({
      resourceType: 'prompt',
      resourceId,
    });
    const versionsOf = (ref: HistoryResourceRef): number =>
      loadHistory(promptDir, ref)?.versions.length ?? 0;

    beforeEach(() => {
      const seed = (ref: HistoryResourceRef, count: number): void => {
        for (let v = 1; v <= count; v += 1) {
          saveVersion(promptDir, ref.resourceType, ref.resourceId, { v });
        }
      };
      seed(prompt('c'), 1);
      seed(prompt('c/s'), 2);
      seed(prompt('s'), 3);
      seed(prompt('c_other'), 4);
      seed({ resourceType: 'gate', resourceId: 'c' }, 5);
    });

    it('reads a step under its composite id, not its last segment', () => {
      expect(versionsOf(prompt('c/s'))).toBe(2);
      expect(versionsOf(prompt('s'))).toBe(3);
    });

    it('deletes a chain with its steps and nothing beside it', () => {
      expect(deleteVersionRows(promptDir, prompt('c'))).toBe(true);

      expect(versionsOf(prompt('c'))).toBe(0);
      expect(versionsOf(prompt('c/s'))).toBe(0);
      expect(versionsOf(prompt('s'))).toBe(3);
      expect(versionsOf(prompt('c_other'))).toBe(4);
      expect(versionsOf({ resourceType: 'gate', resourceId: 'c' })).toBe(5);
    });

    it('renames a chain with its steps and nothing beside it', () => {
      expect(renameHistoryResource(promptDir, prompt('c'), 'd')).toBe(true);

      expect(versionsOf(prompt('d'))).toBe(1);
      expect(versionsOf(prompt('d/s'))).toBe(2);
      expect(versionsOf(prompt('c'))).toBe(0);
      expect(versionsOf(prompt('c/s'))).toBe(0);
      expect(versionsOf(prompt('s'))).toBe(3);
      expect(versionsOf(prompt('c_other'))).toBe(4);
      expect(versionsOf({ resourceType: 'gate', resourceId: 'c' })).toBe(5);
    });

    it('renames a step alone, leaving its chain and its top-level twin', () => {
      expect(renameHistoryResource(promptDir, prompt('c/s'), 'c/t')).toBe(true);

      expect(versionsOf(prompt('c/t'))).toBe(2);
      expect(versionsOf(prompt('c'))).toBe(1);
      expect(versionsOf(prompt('s'))).toBe(3);
    });
  });

  describe('formatHistoryTable', () => {
    it('produces expected table format', () => {
      const table = formatHistoryTable(SAMPLE_HISTORY);
      expect(table).toContain('Version History: test-prompt (3 versions)');
      expect(table).toContain('| Version |');
      expect(table).toContain('| 3 (latest)');
      expect(table).toContain('Updated description');
    });

    it('respects limit', () => {
      const table = formatHistoryTable(SAMPLE_HISTORY, 1);
      expect(table).toContain('and 2 more versions');
    });
  });

  // B.70: resolveStateDbPath used to walk up from the resource directory looking for an
  // existing runtime-state/, ignoring MCP_RUNTIME_ROOT entirely. Under a server started with
  // MCP_RUNTIME_ROOT pointing somewhere other than the workspace (the Claude Code plugin's
  // ${CLAUDE_PLUGIN_DATA}, or any operator override), `cpm` history read a different database
  // from the one the server wrote — or found none at all. These tests seed TWO separate
  // state.db files (the workspace ancestor `tempDir` already seeded in the outer beforeEach,
  // plus a second directory standing in for MCP_RUNTIME_ROOT/MCP_WORKSPACE) and show which one
  // resolveStateDbPath actually reads, so a wrong precedence fails loudly instead of both
  // candidates looking equally plausible.
  describe('runtime root resolution honors MCP_RUNTIME_ROOT / MCP_WORKSPACE', () => {
    const envKeys = ['MCP_RUNTIME_ROOT', 'MCP_WORKSPACE'] as const;
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const key of envKeys) savedEnv[key] = process.env[key];
    });

    afterEach(() => {
      for (const key of envKeys) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
    });

    it('MCP_RUNTIME_ROOT wins over the workspace-ancestor ambient database', async () => {
      const runtimeRootDir = mkdtempSync(join(tmpdir(), 'cpm-vh-runtime-root-'));
      try {
        await seedStateDbSchema(runtimeRootDir);
        process.env['MCP_RUNTIME_ROOT'] = runtimeRootDir;

        const result = saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt' });
        expect(result.success).toBe(true);
        expect(loadHistory(promptDir, PROMPT_REF)?.current_version).toBe(1);

        // Positive control: the workspace ancestor (tempDir, seeded by the outer beforeEach)
        // received nothing — proving the write above actually went to runtimeRootDir and did
        // not merely also land where the old ancestor walk would have looked.
        delete process.env['MCP_RUNTIME_ROOT'];
        expect(loadHistory(promptDir, PROMPT_REF)).toBeNull();
      } finally {
        rmSync(runtimeRootDir, { recursive: true, force: true });
      }
    });

    it('MCP_WORKSPACE wins over the workspace-ancestor ambient database when MCP_RUNTIME_ROOT is unset', async () => {
      delete process.env['MCP_RUNTIME_ROOT'];
      const workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-vh-workspace-'));
      try {
        await seedStateDbSchema(workspaceDir);
        process.env['MCP_WORKSPACE'] = workspaceDir;

        const result = saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt' });
        expect(result.success).toBe(true);
        expect(loadHistory(promptDir, PROMPT_REF)?.current_version).toBe(1);

        delete process.env['MCP_WORKSPACE'];
        expect(loadHistory(promptDir, PROMPT_REF)).toBeNull();
      } finally {
        rmSync(workspaceDir, { recursive: true, force: true });
      }
    });

    it('MCP_RUNTIME_ROOT wins over MCP_WORKSPACE when both are set', async () => {
      const runtimeRootDir = mkdtempSync(join(tmpdir(), 'cpm-vh-runtime-root-'));
      const workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-vh-workspace-'));
      try {
        await seedStateDbSchema(runtimeRootDir);
        await seedStateDbSchema(workspaceDir);
        process.env['MCP_RUNTIME_ROOT'] = runtimeRootDir;
        process.env['MCP_WORKSPACE'] = workspaceDir;

        const result = saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt' });
        expect(result.success).toBe(true);

        // Read the runtime-root candidate directly (bypassing resolveStateDbPath) to confirm
        // the write landed there and not in the workspace candidate.
        delete process.env['MCP_WORKSPACE'];
        expect(loadHistory(promptDir, PROMPT_REF)?.current_version).toBe(1);

        delete process.env['MCP_RUNTIME_ROOT'];
        process.env['MCP_WORKSPACE'] = workspaceDir;
        expect(loadHistory(promptDir, PROMPT_REF)).toBeNull();
      } finally {
        rmSync(runtimeRootDir, { recursive: true, force: true });
        rmSync(workspaceDir, { recursive: true, force: true });
      }
    });

    it('falls back to the workspace-ancestor walk when neither variable is set (regression control)', () => {
      delete process.env['MCP_RUNTIME_ROOT'];
      delete process.env['MCP_WORKSPACE'];

      const result = saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt' });
      expect(result.success).toBe(true);
      expect(loadHistory(promptDir, PROMPT_REF)?.current_version).toBe(1);
    });
  });

  // The CLI scopes what it writes by the workspace id in the config file beside runtime-state.
  // That file may now be a config.jsonc, and a reader that still parsed it as strict JSON would
  // not fail — it would fall back to the environment-derived id and write this process's history
  // into a different scope from the server's, which reads as "the history is empty".
  describe('workspace id read from the config beside runtime-state', () => {
    /** Every tenant the version rows were written under. */
    function recordedTenants(): string[] {
      const db = new DatabaseSync(join(tempDir, 'runtime-state', 'state.db'));
      try {
        const rows = db.prepare('SELECT DISTINCT tenant_id FROM version_history').all() as Array<{
          tenant_id: string;
        }>;
        return rows.map((row) => row.tenant_id);
      } finally {
        db.close();
      }
    }

    it('takes the id out of a commented config.jsonc', () => {
      writeFileSync(
        join(tempDir, 'config.jsonc'),
        `// This box serves one project.
{
  "identity": {
    "launchDefaults": {
      "workspaceId": "hand-scoped-workspace", // must match the server's --workspace-id
    },
  },
}
`,
        'utf8'
      );

      expect(saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt' }).success).toBe(
        true
      );

      expect(recordedTenants()).toEqual(['hand-scoped-workspace']);
    });

    it('CONTROL: without that file the rows land under a different tenant', () => {
      expect(saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt' }).success).toBe(
        true
      );

      expect(recordedTenants()).not.toEqual(['hand-scoped-workspace']);
      expect(recordedTenants()).toHaveLength(1);
    });
  });

  // B.82: `resolveTenantId` only GUESSES the scope — it cannot see the server's own launch cwd,
  // only `CLAUDE_PROJECT_DIR` if this process happens to share it. When a server derives its scope
  // from a launch cwd this process never shares (the background-daemon shape: one fixed install
  // path serving many per-project MCP_WORKSPACE directories), the guess and the server's actual
  // resolution disagree, and `cpm history`/`cpm rollback` reported "no history" / "Version N not
  // found" against history that exists (measured: `cpm rollback -w <workspace>` run from an
  // unrelated cwd with no `CLAUDE_PROJECT_DIR` set). `resolveEffectiveTenantId` corrects the guess
  // against the db's own `tenant_id` column, which records what the writer actually used.
  describe('effective tenant correction when the guess disagrees with recorded history', () => {
    let savedProjectDir: string | undefined;

    beforeEach(() => {
      savedProjectDir = process.env['CLAUDE_PROJECT_DIR'];
    });

    afterEach(() => {
      if (savedProjectDir === undefined) delete process.env['CLAUDE_PROJECT_DIR'];
      else process.env['CLAUDE_PROJECT_DIR'] = savedProjectDir;
    });

    function tenantsFor(resourceType: string, resourceId: string): string[] {
      const db = new DatabaseSync(join(tempDir, 'runtime-state', 'state.db'));
      try {
        const rows = db
          .prepare(
            'SELECT DISTINCT tenant_id FROM version_history WHERE resource_type = ? AND resource_id = ?'
          )
          .all(resourceType, resourceId) as Array<{ tenant_id: string }>;
        return rows.map((row) => row.tenant_id);
      } finally {
        db.close();
      }
    }

    it('corrects a read when the guess has no rows but exactly one other tenant does', () => {
      // "The server" writes under a scope derived from ITS launch cwd.
      process.env['CLAUDE_PROJECT_DIR'] = '/srv/server-tenant';
      saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt', description: 'v1' });
      saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt', description: 'v2' });
      expect(tenantsFor('prompt', 'test-prompt')).toEqual(['server-tenant']);

      // "The CLI" runs later from an unrelated cwd.
      process.env['CLAUDE_PROJECT_DIR'] = '/home/user/cli-tenant';

      const history = loadHistory(promptDir, PROMPT_REF);
      expect(history).not.toBeNull();
      expect(history!.current_version).toBe(2);
      expect(history!.versions).toHaveLength(2);
    });

    it('rollback records the restored version under the corrected tenant, never a new one', () => {
      process.env['CLAUDE_PROJECT_DIR'] = '/srv/server-tenant';
      saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt', description: 'v1' });
      saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt', description: 'v2' });

      process.env['CLAUDE_PROJECT_DIR'] = '/home/user/cli-tenant';
      const result = rollbackVersion(promptDir, 'prompt', 'test-prompt', 1, {
        id: 'test-prompt',
        description: 'v2',
      });

      expect(result.success).toBe(true);
      expect(result.restored_version).toBe(1);
      // Still exactly one tenant for this resource — the rollback's own write (recordEditResult)
      // landed in the corrected tenant, not under the CLI's uncorrected guess.
      expect(tenantsFor('prompt', 'test-prompt')).toEqual(['server-tenant']);
    });

    it('does not correct, and REFUSES rather than reads as empty, when two other tenants both hold rows', () => {
      process.env['CLAUDE_PROJECT_DIR'] = '/srv/tenant-a';
      saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt', description: 'a' });

      process.env['CLAUDE_PROJECT_DIR'] = '/srv/tenant-b';
      saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt', description: 'b' });

      expect(tenantsFor('prompt', 'test-prompt').sort()).toEqual(['tenant-a', 'tenant-b']);

      // A third, unrelated guess: two real candidates exist, so correcting would have to pick one
      // and silently serve the wrong project's history. It must refuse instead — and refuse LOUDLY:
      // returning null here would be indistinguishable from a resource with no history anywhere,
      // which is the exact "nothing found" symptom this whole fix exists to remove, just one layer
      // further out. `null` stays reserved for the genuinely-empty case (control right below).
      process.env['CLAUDE_PROJECT_DIR'] = '/home/user/tenant-c';
      expect(() => loadHistory(promptDir, PROMPT_REF)).toThrow(/2 other scopes/);
    });

    it('CONTROL: a genuinely empty history (no tenant anywhere) still reads as empty, not a refusal', () => {
      // No saveVersion call for this resource under ANY tenant — nothing to be ambiguous between.
      process.env['CLAUDE_PROJECT_DIR'] = '/home/user/tenant-c';
      expect(tenantsFor('prompt', 'test-prompt')).toEqual([]);
      expect(loadHistory(promptDir, PROMPT_REF)).toBeNull();
    });

    it('CONTROL: a write starts its own tenant rather than joining an existing one it collides with', () => {
      process.env['CLAUDE_PROJECT_DIR'] = '/srv/tenant-a';
      saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt', description: 'a' });

      // A second, genuinely different, correctly-resolved tenant writes a resource under the SAME
      // resource_type/resource_id (a shared state.db serving two unrelated projects). Correcting
      // this write into tenant-a's history — the naive "one candidate exists" rule applied to
      // writes too — would silently merge two unrelated projects' resources.
      process.env['CLAUDE_PROJECT_DIR'] = '/srv/tenant-b';
      const result = saveVersion(promptDir, 'prompt', 'test-prompt', {
        id: 'test-prompt',
        description: 'b',
      });

      expect(result.success).toBe(true);
      expect(result.version).toBe(1); // its own v1, not appended after tenant-a's history
      expect(tenantsFor('prompt', 'test-prompt').sort()).toEqual(['tenant-a', 'tenant-b']);
    });

    it('corrects a delete too — cpm delete has the same shape as cpm rollback', () => {
      process.env['CLAUDE_PROJECT_DIR'] = '/srv/server-tenant';
      saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt', description: 'v1' });

      process.env['CLAUDE_PROJECT_DIR'] = '/home/user/cli-tenant';
      expect(deleteVersionRows(promptDir, PROMPT_REF)).toBe(true);

      // The rows are gone under the tenant that actually held them, not left behind as an orphan
      // nothing can reach because the guess never matched them.
      expect(tenantsFor('prompt', 'test-prompt')).toEqual([]);
    });
  });
});
