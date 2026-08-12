// @lifecycle test - Guards the SqliteEngine singleton's dbPath against construction order
/**
 * SqliteEngine dbPath ownership
 *
 * `getInstance` is a singleton accessor, so it drops the config of every call after the first.
 * Five of its six call sites pass no `dbPath` and fall back to `path.join(serverRoot, ...)` —
 * the PACKAGE directory — while the composition root passes the PathResolver-derived runtime
 * path. Whichever ran first therefore decided where `state.db` lived, and `MCP_WORKSPACE` was
 * honored only because ResourceChangeTracker happened to initialize early.
 *
 * These tests pin the two halves of the fix: a later no-dbPath caller inherits the claimed path
 * rather than relocating the database, and a later caller that genuinely disagrees is told so
 * instead of being silently ignored.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

describe('SqliteEngine dbPath ownership', () => {
  const testDir = path.join(process.cwd(), 'tests/tmp/sqlite-dbpath');
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

  it('keeps the claimed path when a later caller supplies no dbPath', async () => {
    const claimed = await SqliteEngine.getInstance(packageRoot, mockLogger as never, {
      dbPath: claimedDbPath,
    });
    await claimed.initialize();

    // This is the shape of the five bypassing call sites: serverRoot only, no dbPath.
    const later = await SqliteEngine.getInstance(packageRoot, mockLogger as never);

    expect(later).toBe(claimed);
    // The database exists where the composition root put it...
    await fs.access(claimedDbPath);
    // ...and the package-relative location the bypassing callers would have used is untouched.
    await expect(fs.access(path.join(packageRoot, 'runtime-state', 'state.db'))).rejects.toThrow();
  });

  it('throws when a later caller requests a different dbPath', async () => {
    const claimed = await SqliteEngine.getInstance(packageRoot, mockLogger as never, {
      dbPath: claimedDbPath,
    });
    await claimed.initialize();

    const conflicting = path.join(packageRoot, 'runtime-state', 'state.db');
    await expect(
      SqliteEngine.getInstance(packageRoot, mockLogger as never, { dbPath: conflicting })
    ).rejects.toThrow(/already open at/);
  });

  it('accepts a later caller that requests the same dbPath', async () => {
    const claimed = await SqliteEngine.getInstance(packageRoot, mockLogger as never, {
      dbPath: claimedDbPath,
    });
    await claimed.initialize();

    const same = await SqliteEngine.getInstance(packageRoot, mockLogger as never, {
      dbPath: claimedDbPath,
    });
    expect(same).toBe(claimed);
  });
});
