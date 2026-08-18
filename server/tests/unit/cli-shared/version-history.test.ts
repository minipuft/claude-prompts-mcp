import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadHistory,
  getVersion,
  compareVersions,
  saveVersion,
  recordEditResult,
  rollbackVersion,
  deleteVersionRows,
  formatHistoryTable,
} from '../../../src/cli-shared/version-history.js';
import type { HistoryFile } from '../../../src/modules/versioning/types.js';
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
      expect(loadHistory(promptDir)).toBeNull();
    });

    it('reads stored SQLite history', () => {
      seedPromptHistory(promptDir);
      const result = loadHistory(promptDir);
      expect(result).not.toBeNull();
      expect(result!.current_version).toBe(3);
      expect(result!.versions).toHaveLength(3);
      expect(result!.versions[0]?.description).toBe('Updated description');
    });
  });

  describe('getVersion', () => {
    it('returns specific version entry', () => {
      seedPromptHistory(promptDir);
      const entry = getVersion(promptDir, 2);
      expect(entry).not.toBeNull();
      expect(entry!.description).toBe('Simplified');
    });

    it('returns null for nonexistent version', () => {
      seedPromptHistory(promptDir);
      expect(getVersion(promptDir, 99)).toBeNull();
    });
  });

  describe('compareVersions', () => {
    beforeEach(() => {
      seedPromptHistory(promptDir);
    });

    it('returns both entries on success', () => {
      const result = compareVersions(promptDir, 1, 3);
      expect(result.success).toBe(true);
      expect(result.from!.version).toBe(1);
      expect(result.to!.version).toBe(3);
    });

    it('errors when from version is missing', () => {
      const result = compareVersions(promptDir, 99, 3);
      expect(result.success).toBe(false);
      expect(result.error).toContain('99');
    });
  });

  describe('saveVersion', () => {
    it('creates new history when none exists', () => {
      const result = saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt' });
      expect(result.success).toBe(true);
      expect(result.version).toBe(1);

      const history = loadHistory(promptDir);
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

      const history = loadHistory(promptDir);
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
      const history = loadHistory(gateDir);
      expect(history!.versions[0]?.description).toBe('Custom desc');
      expect(history!.versions[0]?.diff_summary).toBe('+2/-1');
    });

    it('prunes old versions beyond max', () => {
      for (let i = 0; i < 51; i += 1) {
        saveVersion(promptDir, 'prompt', 'test-prompt', { id: 'test-prompt', version: i + 1 });
      }
      const history = loadHistory(promptDir);
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

      const history = loadHistory(promptDir);
      expect(history!.current_version).toBe(5);
      const bridged = getVersion(promptDir, 4);
      expect(bridged!.snapshot).toEqual(currentSnapshot);
      expect(bridged!.description).toContain('Bridge');
      const restored = getVersion(promptDir, 5);
      expect(restored!.description).toBe('Rollback to v1');
    });

    it('records exactly one row when the live state is already the latest recorded snapshot', () => {
      // seedPromptHistory's v3 snapshot is exactly this — no bridge needed.
      const currentSnapshot = { id: 'test-prompt', description: 'v3 description' };
      const result = rollbackVersion(promptDir, 'prompt', 'test-prompt', 1, currentSnapshot);

      expect(result.saved_version).toBe(4);
      const restored = getVersion(promptDir, 4);
      expect(restored!.snapshot).toEqual({ id: 'test-prompt', description: 'v1 description' });
      expect(restored!.description).toBe('Rollback to v1');
    });

    it('errors when target version does not exist, and consumes no version number', () => {
      const before = loadHistory(promptDir)!.current_version;
      const result = rollbackVersion(promptDir, 'prompt', 'test-prompt', 99, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('99');
      expect(loadHistory(promptDir)!.current_version).toBe(before);
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

      const bridge = getVersion(promptDir, 1);
      expect(bridge!.snapshot).toEqual(priorLive);
      expect(bridge!.description).toContain('Bridge');

      const newest = getVersion(promptDir, 2);
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
      const newest = getVersion(promptDir, 3);
      expect(newest!.snapshot).toEqual(secondProduced);

      const history = loadHistory(promptDir);
      expect(history!.versions).toHaveLength(3);
    });
  });

  describe('deleteVersionRows', () => {
    it('returns true when history does not exist', () => {
      expect(deleteVersionRows(promptDir)).toBe(true);
    });

    it('deletes existing history rows', () => {
      seedPromptHistory(promptDir);
      expect(deleteVersionRows(promptDir)).toBe(true);
      expect(loadHistory(promptDir)).toBeNull();
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
});
