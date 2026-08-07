import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadHistory,
  getVersion,
  compareVersions,
  saveVersion,
  rollbackVersion,
  deleteHistoryFile,
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

    it('saves current state and returns target snapshot', () => {
      const currentSnapshot = { id: 'test-prompt', description: 'current' };
      const result = rollbackVersion(promptDir, 'prompt', 'test-prompt', 1, currentSnapshot);

      expect(result.success).toBe(true);
      expect(result.saved_version).toBe(4);
      expect(result.restored_version).toBe(1);
      expect(result.snapshot).toBeDefined();
      expect(result.snapshot!.description).toBe('v1 description');
    });

    it('errors when target version does not exist', () => {
      const result = rollbackVersion(promptDir, 'prompt', 'test-prompt', 99, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('99');
    });
  });

  describe('deleteHistoryFile', () => {
    it('returns true when history does not exist', () => {
      expect(deleteHistoryFile(promptDir)).toBe(true);
    });

    it('deletes existing history rows', () => {
      seedPromptHistory(promptDir);
      expect(deleteHistoryFile(promptDir)).toBe(true);
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
