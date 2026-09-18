// @lifecycle test - Guards the SqliteEngine singleton's dbPath against construction order
/**
 * SqliteEngine dbPath ownership
 *
 * `getInstance` is a singleton accessor, so it drops the config of every call after the first.
 * Until B.62 `dbPath` was optional and fell back to `path.join(serverRoot, 'runtime-state', ...)`
 * — the PACKAGE directory — so whichever caller ran first decided where `state.db` lived. The
 * path is now required, and there is no package-relative default left to fall back to.
 *
 * These tests pin the three halves of that: the database lands exactly where the caller named it
 * and nowhere else, a later caller that disagrees is told so instead of being silently served
 * another file, and an empty path — which `node:sqlite` would open as an anonymous temporary
 * database — is refused.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

describe('SqliteEngine dbPath ownership', () => {
  const testDir = testScratchPath('sqlite-dbpath');
  const packageRoot = path.join(testDir, 'package-root');
  const runtimeRoot = path.join(testDir, 'runtime-root');
  const claimedDbPath = path.join(runtimeRoot, 'runtime-state', 'state.db');

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(path.join(runtimeRoot, 'runtime-state'), { recursive: true });
    await fs.mkdir(packageRoot, { recursive: true });
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('opens the database exactly where the caller named it, and nowhere else', async () => {
    const claimed = await SqliteEngine.getInstance(mockLogger as never, { dbPath: claimedDbPath });
    await claimed.initialize();

    await fs.access(claimedDbPath);
    // The package-relative location the removed fallback used is untouched.
    await expect(fs.access(path.join(packageRoot, 'runtime-state'))).rejects.toThrow();
  });

  it('throws when a later caller requests a different dbPath', async () => {
    const claimed = await SqliteEngine.getInstance(mockLogger as never, { dbPath: claimedDbPath });
    await claimed.initialize();

    const conflicting = path.join(packageRoot, 'runtime-state', 'state.db');
    await expect(
      SqliteEngine.getInstance(mockLogger as never, { dbPath: conflicting })
    ).rejects.toThrow(/already open at/);
  });

  it('accepts a later caller that requests the same dbPath', async () => {
    const claimed = await SqliteEngine.getInstance(mockLogger as never, { dbPath: claimedDbPath });
    await claimed.initialize();

    const same = await SqliteEngine.getInstance(mockLogger as never, { dbPath: claimedDbPath });
    expect(same).toBe(claimed);
  });

  it('refuses an empty dbPath rather than opening an anonymous database', async () => {
    await expect(SqliteEngine.getInstance(mockLogger as never, { dbPath: '  ' })).rejects.toThrow(
      /non-empty dbPath/
    );
  });
});
