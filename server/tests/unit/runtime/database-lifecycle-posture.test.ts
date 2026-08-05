/**
 * Tier 5.2 / 5.3 — database lifecycle posture at the composition root.
 *
 * Two claims, both about the runtime layer rather than the engine:
 *
 *   5.2  `Application.shutdown()` closes the database, and closes it LAST — after every
 *        subsystem that may still write on its way down. Nothing called
 *        `SqliteEngine.shutdown()` at all before this tier, which is why the WAL grew
 *        unbounded across restarts.
 *
 *   5.3  A database that was configured and then failed to initialize FAILS startup.
 *        It used to be logged at `warn` and swallowed, so the server reported a clean
 *        start while running with no persistence at all.
 *
 * Both `SqliteEngine` and `initializeResourceChangeTracker` hold module-level
 * singletons, so this file relies on Jest giving each test file its own module registry.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, jest, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { createSimpleLogger } from '../../../src/infra/logging/index.js';
import { Application } from '../../../src/runtime/application.js';
import { initializeModules } from '../../../src/runtime/module-initializer.js';
import type { RuntimeLaunchOptions } from '../../../src/runtime/options.js';

const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');
const TMP_ROOT = path.join(process.cwd(), 'tests/tmp/db-lifecycle-posture');

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

function buildApp(): Application {
  const runtimeOptions: Partial<RuntimeLaunchOptions> = {
    serverRoot: SERVER_ROOT,
    args: [],
    verbose: false,
    quiet: true,
    startupTest: false,
    testEnvironment: true,
    paths: {},
  };
  return new Application(createSimpleLogger('stdio'), runtimeOptions as RuntimeLaunchOptions);
}

afterEach(async () => {
  await SqliteEngine.shutdownInstance();
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

describe('Application shutdown closes the database (5.2)', () => {
  it('closes an open engine', async () => {
    const dbDir = path.join(TMP_ROOT, 'closes');
    await fs.mkdir(dbDir, { recursive: true });
    const engine = await SqliteEngine.getInstance(dbDir, mockLogger as any);
    await engine.initialize();
    expect(engine.isInitialized()).toBe(true);

    const app = buildApp();
    await app.loadConfiguration();
    await app.shutdown();

    expect(engine.isInitialized()).toBe(false);
  });

  it('closes the database AFTER the subsystems that may still write', async () => {
    const dbDir = path.join(TMP_ROOT, 'ordering');
    await fs.mkdir(dbDir, { recursive: true });
    const engine = await SqliteEngine.getInstance(dbDir, mockLogger as any);
    await engine.initialize();

    const order: string[] = [];

    const app = buildApp();
    await app.loadConfiguration();

    // `configManager.stopWatching()` is the last teardown step before the database
    // close. If the close ever moves above the subsystem block, this ordering inverts.
    const configManager = (app as unknown as { configManager: { stopWatching: () => void } })
      .configManager;
    const realStopWatching = configManager.stopWatching.bind(configManager);
    configManager.stopWatching = (): void => {
      order.push('configManager.stopWatching');
      realStopWatching();
    };

    const realEngineShutdown = engine.shutdown.bind(engine);
    engine.shutdown = async (): Promise<void> => {
      order.push('database.shutdown');
      await realEngineShutdown();
    };

    await app.shutdown();

    // `stopWatching` fires more than once (shutdown proper, then `cleanup()`), so this
    // asserts the relative order rather than an exact sequence: the close must come
    // after the LAST subsystem teardown, and must be the final step.
    expect(order).toContain('configManager.stopWatching');
    expect(order[order.length - 1]).toBe('database.shutdown');
    expect(order.lastIndexOf('configManager.stopWatching')).toBeLessThan(
      order.indexOf('database.shutdown')
    );
  });
});

describe('Database init failure fails startup (5.3)', () => {
  it('rejects when the ResourceChangeTracker cannot open state.db', async () => {
    // A FILE where the runtime-state DIRECTORY belongs: `mkdirSync(dirname(dbPath))`
    // inside SqliteEngine.initialize() fails with ENOTDIR. This is portable in a way
    // chmod-based unwritability is not — a root-running CI container ignores mode bits.
    const brokenRoot = path.join(TMP_ROOT, 'broken');
    await fs.mkdir(brokenRoot, { recursive: true });
    await fs.writeFile(path.join(brokenRoot, 'runtime-state'), 'not a directory');

    const params = {
      logger: mockLogger,
      runtimeOptions: { verbose: false },
      configManager: { getConfig: () => ({}) },
      serverRoot: brokenRoot,
      pathResolver: { getRuntimeStatePath: () => path.join(brokenRoot, 'runtime-state') },
    };

    // Everything after the tracker — framework store, gate manager, MCP registration —
    // is unreachable here by construction: the tracker is wired first and this throws
    // before any of those params are read. That is why they are absent above rather
    // than stubbed.
    await expect(initializeModules(params as never)).rejects.toThrow(
      /Failed to initialize ResourceChangeTracker/
    );
  });
});
