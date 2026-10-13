/**
 * The entrypoint's periodic health check must neither keep the process alive nor outlive
 * `gracefulShutdown()`. The interval handle used to be discarded, so nothing could stop it.
 *
 * The application and the launch-option resolver are replaced so `startServer()` runs its real
 * monitoring setup without starting a server: the subject is the timer `index.ts` creates, and
 * `testEnvironment: false` is what lets it create one (monitoring is suppressed under test).
 */

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

const HEALTH_INTERVAL_MS = 30000;

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const application = {
  getModules: () => ({ logger }),
  validateHealth: () => ({ healthy: true, issues: [] }),
  getStatus: () => ({
    running: true,
    transport: 'stdio',
    promptsLoaded: 0,
    categoriesLoaded: 0,
  }),
  getDiagnosticInfo: jest.fn(),
  getPerformanceMetrics: jest.fn(),
  shutdown: jest.fn(async () => undefined),
};

jest.unstable_mockModule('../../src/runtime/application.js', () => ({
  startApplication: jest.fn(async () => application),
}));
jest.unstable_mockModule('../../src/runtime/options.js', () => ({
  resolveRuntimeLaunchOptions: () => ({
    args: [],
    verbose: false,
    quiet: true,
    startupTest: false,
    testEnvironment: false,
    transport: 'stdio',
    paths: {},
  }),
}));

const SIGNAL_EVENTS = ['uncaughtException', 'unhandledRejection', 'SIGINT', 'SIGTERM'];
type AnyListener = (...args: unknown[]) => void;
const emitter = process as unknown as {
  listeners(event: string): AnyListener[];
  removeListener(event: string, listener: AnyListener): void;
};
const listenersBefore = new Map<string, AnyListener[]>();

beforeAll(() => {
  for (const event of SIGNAL_EVENTS) {
    listenersBefore.set(event, emitter.listeners(event));
  }
});

afterAll(() => {
  // `startServer()` registers process-wide handlers that would outlive this file.
  for (const event of SIGNAL_EVENTS) {
    const keep = listenersBefore.get(event) ?? [];
    for (const listener of emitter.listeners(event)) {
      if (!keep.includes(listener)) {
        emitter.removeListener(event, listener);
      }
    }
  }
});

describe('entrypoint health monitor lifecycle', () => {
  it('unrefs the health interval and clears it on graceful shutdown', async () => {
    const created: Array<{ handle: NodeJS.Timeout; delay: number | undefined }> = [];
    const realSetInterval = global.setInterval;
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(((
      handler: () => void,
      delay?: number
    ) => {
      const handle = realSetInterval(handler, delay);
      created.push({ handle, delay });
      return handle;
    }) as typeof setInterval);
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { startServer, gracefulShutdown } = await import('../../src/index.js');
    await startServer();

    const health = created.filter((entry) => entry.delay === HEALTH_INTERVAL_MS);
    // Positive control: the interval under test was observed being created.
    expect(health).toHaveLength(1);
    const handle = health[0]!.handle;

    try {
      expect(handle.hasRef()).toBe(false);

      await gracefulShutdown(0);

      expect(clearIntervalSpy).toHaveBeenCalledWith(handle);
      expect(application.shutdown).toHaveBeenCalledTimes(1);
    } finally {
      clearInterval(handle);
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
