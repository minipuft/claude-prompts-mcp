/**
 * Shutdown ordering and error posture at the composition root.
 *
 * `Application.shutdown()` tears subsystems down in an order that is a real contract and
 * that no type checker sees: telemetry flushes while the services it instruments are still
 * up, the transport stops before the stores it routes into, background services stop before
 * the tool surfaces that schedule work on them, and the database closes LAST because every
 * step above may still write on its way down.
 *
 * These tests exist as a before/after control for decomposing `shutdown()` (row P4.42). They
 * pin the SEQUENCE by recording it, not by describing it, so a step that moves during a
 * refactor turns the suite red rather than passing silently.
 *
 * Error posture pinned here matches the code as found: a per-subsystem failure is warned and
 * swallowed so the remaining steps still run, while an unguarded step (the service
 * orchestrator, the config watcher, the timer cleanup, the database close) propagates out of
 * the single outer boundary.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { Application } from '../../../src/runtime/application.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { RuntimeLaunchOptions } from '../../../src/runtime/options.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');
const TMP_ROOT = testScratchPath('shutdown-order');

/**
 * `PathResolver` reads the environment before its own options, so an operator shell that
 * exports these reaches in-process Jest and points this file at a live resource library.
 */
const PATH_ENV_KEYS = [
  'MCP_RESOURCES_PATH',
  'MCP_WORKSPACE',
  'MCP_RUNTIME_ROOT',
  'MCP_CONFIG_PATH',
] as const;
const savedEnv = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of PATH_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of PATH_ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

afterEach(async () => {
  await SqliteEngine.shutdownInstance();
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

function silentLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function buildApp(logger: Logger): Application {
  const runtimeOptions: Partial<RuntimeLaunchOptions> = {
    serverRoot: SERVER_ROOT,
    args: [],
    verbose: false,
    quiet: true,
    startupTest: false,
    testEnvironment: true,
    paths: {},
  };
  return new Application(logger, runtimeOptions as RuntimeLaunchOptions);
}

interface Wiring {
  app: Application;
  order: string[];
  logger: Logger;
}

/**
 * Stand every teardown collaborator up as a recorder. The fields are private, so this reaches
 * them through one cast rather than driving a full `startup()`: the subject under test is the
 * ORDER `shutdown()` calls them in, and a real startup would make most of them optional and
 * the sequence partial.
 */
function wireRecorders(options: { failing?: string; throwFrom?: string } = {}): Wiring {
  const order: string[] = [];
  const logger = silentLogger();
  const app = buildApp(logger);

  const stub = (name: string): { shutdown: () => Promise<void> } => ({
    shutdown: async (): Promise<void> => {
      order.push(name);
      if (options.failing === name) {
        throw new Error(`${name} failed`);
      }
    },
  });

  const fields: Record<string, unknown> = {
    logger,
    telemetryLifecycle: stub('telemetry'),
    serverLifecycle: {
      shutdown: (): void => {
        order.push('serverLifecycle');
      },
    },
    transportRouter: stub('transportRouter'),
    frameworkStateStore: stub('frameworkStateStore'),
    promptManager: stub('promptManager'),
    serviceOrchestrator: {
      stopAll: async (): Promise<void> => {
        order.push('serviceOrchestrator.stopAll');
        if (options.throwFrom === 'serviceOrchestrator') {
          throw new Error('serviceOrchestrator failed');
        }
      },
    },
    apiRouter: stub('apiRouter'),
    mcpToolsManager: stub('mcpToolsManager'),
    conversationStore: stub('conversationStore'),
    textReferenceStore: stub('textReferenceStore'),
    frameworksConfigListener: (): void => undefined,
    configManager: {
      removeListener: (event: string): void => {
        order.push(`configManager.removeListener:${event}`);
      },
      stopWatching: (): void => {
        order.push('configManager.stopWatching');
      },
    },
  };

  const target = app as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    target[key] = value;
  }
  target.cleanup = (): void => {
    order.push('cleanup');
  };

  return { app, order, logger };
}

const EXPECTED_ORDER = [
  'telemetry',
  'serverLifecycle',
  'transportRouter',
  'frameworkStateStore',
  'promptManager',
  'serviceOrchestrator.stopAll',
  'apiRouter',
  'mcpToolsManager',
  'conversationStore',
  'textReferenceStore',
  'configManager.removeListener:frameworksConfigChanged',
  'configManager.stopWatching',
  'cleanup',
  'database',
];

describe('Application.shutdown() teardown order', () => {
  it('tears every subsystem down in the recorded sequence, database last', async () => {
    const dbDir = path.join(TMP_ROOT, 'order');
    await fs.mkdir(dbDir, { recursive: true });
    const engine = await SqliteEngine.getInstance(dbDir, silentLogger() as never);
    await engine.initialize();

    const { app, order } = wireRecorders();

    const realEngineShutdown = engine.shutdown.bind(engine);
    engine.shutdown = async (): Promise<void> => {
      order.push('database');
      await realEngineShutdown();
    };

    await app.shutdown();

    expect(order).toEqual(EXPECTED_ORDER);
  });

  it('clears the config listener so a second shutdown does not detach it twice', async () => {
    const { app, order } = wireRecorders();

    await app.shutdown();
    order.length = 0;
    await app.shutdown();

    expect(order).not.toContain('configManager.removeListener:frameworksConfigChanged');
    expect(order).toContain('configManager.stopWatching');
  });
});

describe('Application.shutdown() error posture', () => {
  it('warns and continues when an individual subsystem fails to stop', async () => {
    const { app, order, logger } = wireRecorders({ failing: 'frameworkStateStore' });

    await expect(app.shutdown()).resolves.toBeUndefined();

    // Every step after the failure still ran.
    expect(order.slice(order.indexOf('frameworkStateStore') + 1)).toEqual([
      'promptManager',
      'serviceOrchestrator.stopAll',
      'apiRouter',
      'mcpToolsManager',
      'conversationStore',
      'textReferenceStore',
      'configManager.removeListener:frameworksConfigChanged',
      'configManager.stopWatching',
      'cleanup',
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Error shutting down framework state manager:',
      expect.any(Error)
    );
  });

  it('propagates a failure from an unguarded step out of the single outer boundary', async () => {
    const { app, order, logger } = wireRecorders({ throwFrom: 'serviceOrchestrator' });

    await expect(app.shutdown()).rejects.toThrow('serviceOrchestrator failed');

    // Nothing after the unguarded failure runs: the outer boundary owns the response.
    expect(order[order.length - 1]).toBe('serviceOrchestrator.stopAll');
    expect(logger.error).toHaveBeenCalledWith('Error during shutdown:', expect.any(Error));
  });
});

/**
 * Wire a real `SqliteEngine` instance into `order`, the same way the teardown-order test
 * above does, so a full run can be compared against `EXPECTED_ORDER` as one value instead of
 * a slice -- P4.44 (`plans/technical-debt/resource-surface-consolidation-2026-08-27.md`)
 * asks specifically for the database close to stay reached, not just for the failing step to
 * be skipped over.
 */
async function mountRealDatabase(subdir: string, order: string[]): Promise<void> {
  const dbDir = path.join(TMP_ROOT, subdir);
  await fs.mkdir(dbDir, { recursive: true });
  const engine = await SqliteEngine.getInstance(dbDir, silentLogger() as never);
  await engine.initialize();

  const realEngineShutdown = engine.shutdown.bind(engine);
  engine.shutdown = async (): Promise<void> => {
    order.push('database');
    await realEngineShutdown();
  };
}

/**
 * P4.44 (ruling R28): the inner catch in `shutdownIfSupported`/`shutdownTelemetry` stays --
 * it is what guarantees the database close is always reached -- but each teardown failure
 * must ALSO reach stderr directly, on the channel `runtime/paths.ts` and `runtime/startup.ts`
 * already use for operator messages that do not depend on the logger. `Application` calls
 * `process.stderr.write` directly rather than through `logger.warn` for this, so the spy
 * below targets the `process.stderr` object's `write` property -- not a builtin module
 * namespace, which Jest's ESM runner cannot intercept ([[feedback_jest_esm_builtin_mocking]]).
 */
describe('Application.shutdown() teardown visibility (P4.44)', () => {
  it('is observed by a spy on process.stderr.write (positive control)', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      process.stderr.write('__p4_44_positive_control__\n');
      expect(stderrSpy).toHaveBeenCalledWith('__p4_44_positive_control__\n');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('writes a stderr line naming the failing subsystem, and the database close is still reached', async () => {
    const { app, order } = wireRecorders({ failing: 'frameworkStateStore' });
    await mountRealDatabase('visibility-failing', order);

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await app.shutdown();

      // (b) the full sequence, compared as one value -- the failing step did not strand the
      // database close.
      expect(order).toEqual(EXPECTED_ORDER);

      // (a) stderr names the failing subsystem.
      const teardownLines = stderrSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith('[Application] Failed to shut down'));
      expect(teardownLines).toEqual([
        '[Application] Failed to shut down framework state manager: frameworkStateStore failed\n',
      ]);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('control: writes no teardown-failure line when nothing throws', async () => {
    const { app, order } = wireRecorders();
    await mountRealDatabase('visibility-control', order);

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await app.shutdown();

      expect(order).toEqual(EXPECTED_ORDER);

      const teardownLines = stderrSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith('[Application] Failed to shut down'));
      expect(teardownLines).toEqual([]);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
