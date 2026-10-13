// @lifecycle test - 0C1.19: the metrics collector's memory interval neither holds the process open nor outlives shutdown.
/**
 * `InMemoryMetricsCollector` samples memory on a 30-second interval. Two properties keep that
 * timer from being the thing a process waits on:
 *
 *  - it is `unref()`'d, so an in-process server (a test, an embedder) can exit without the
 *    owner remembering to stop it;
 *  - `shutdown()` clears it, and a second `shutdown()` is inert.
 *
 * `process.getActiveResourcesInfo()` lists live Timeout handles, but an unref'd one still
 * appears there, so the ref state is read from the handle itself through a `setInterval` spy.
 */

import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { createMetricsCollector } from '../../../../src/infra/observability/metrics/index.js';

import type { Logger } from '../../../../src/infra/logging/index.js';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('InMemoryMetricsCollector memory interval', () => {
  test('the 30s interval is unref()d so it cannot keep the process alive', () => {
    const spy = jest.spyOn(globalThis, 'setInterval');
    const collector = createMetricsCollector(logger);
    try {
      const handles = spy.mock.results.map((result) => result.value as NodeJS.Timeout);
      expect(handles).toHaveLength(1);
      expect(spy.mock.calls[0]?.[1]).toBe(30000);
      expect(handles[0]?.hasRef()).toBe(false);
    } finally {
      collector.shutdown();
    }
  });

  test('shutdown() clears the interval, and a second shutdown() is inert', () => {
    jest.useFakeTimers();
    const collector = createMetricsCollector(logger);
    expect(jest.getTimerCount()).toBe(1);

    collector.shutdown();
    expect(jest.getTimerCount()).toBe(0);

    expect(() => collector.shutdown()).not.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });
});
