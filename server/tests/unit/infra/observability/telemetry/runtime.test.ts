import { describe, expect, jest, test, beforeEach } from '@jest/globals';

import {
  TelemetryRuntimeImpl,
  createTelemetryRuntime,
} from '../../../../../src/infra/observability/telemetry/runtime.js';
import type { TelemetryConfig, Logger } from '../../../../../src/shared/types/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const disabledConfig: TelemetryConfig = {
  enabled: false,
  mode: 'off',
  exporterEndpoint: 'http://localhost:4318',
  samplingRate: 1.0,
  attributePolicy: {
    businessContext: true,
    rawCommands: false,
    rawResponses: false,
  },
};

const enabledConfig: TelemetryConfig = {
  ...disabledConfig,
  enabled: true,
  mode: 'traces',
};

describe('TelemetryRuntimeImpl', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createLogger();
  });

  describe('disabled mode', () => {
    test('start() is a no-op when disabled', async () => {
      const runtime = new TelemetryRuntimeImpl(disabledConfig, logger, 'test', '1.0.0');
      await runtime.start();
      expect(runtime.isEnabled()).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('disabled by config'));
    });

    test('start() is a no-op when mode is off', async () => {
      const config = { ...enabledConfig, mode: 'off' as const };
      const runtime = new TelemetryRuntimeImpl(config, logger, 'test', '1.0.0');
      await runtime.start();
      expect(runtime.isEnabled()).toBe(false);
    });

    test('shutdown() is safe when not started', async () => {
      const runtime = new TelemetryRuntimeImpl(disabledConfig, logger, 'test', '1.0.0');
      await runtime.shutdown(); // Should not throw
    });

    test('getTracer() returns a tracer even when disabled (no-op tracer)', () => {
      const runtime = new TelemetryRuntimeImpl(disabledConfig, logger, 'test', '1.0.0');
      const tracer = runtime.getTracer('test-module');
      expect(tracer).toBeDefined();
      // No-op tracer creates non-recording spans
      const span = tracer.startSpan('test');
      expect(span).toBeDefined();
      span.end();
    });
  });

  describe('enabled mode', () => {
    test('start() enables the runtime when config is enabled + traces mode', async () => {
      const runtime = new TelemetryRuntimeImpl(enabledConfig, logger, 'test', '1.0.0');
      await runtime.start();
      expect(runtime.isEnabled()).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Started'),
        expect.objectContaining({ mode: 'traces' })
      );
      await runtime.shutdown();
    });

    test('start() is idempotent (second call skips)', async () => {
      const runtime = new TelemetryRuntimeImpl(enabledConfig, logger, 'test', '1.0.0');
      await runtime.start();
      await runtime.start(); // Second call
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Already started'));
      await runtime.shutdown();
    });

    test('shutdown() disables the runtime and logs', async () => {
      const runtime = new TelemetryRuntimeImpl(enabledConfig, logger, 'test', '1.0.0');
      await runtime.start();
      expect(runtime.isEnabled()).toBe(true);
      await runtime.shutdown();
      expect(runtime.isEnabled()).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Shutdown complete'));
    });

    test('shutdown() is safe to call multiple times', async () => {
      const runtime = new TelemetryRuntimeImpl(enabledConfig, logger, 'test', '1.0.0');
      await runtime.start();
      await runtime.shutdown();
      await runtime.shutdown(); // Second call — should not throw
    });
  });

  describe('getStatus()', () => {
    test('returns status snapshot with disabled config', () => {
      const runtime = new TelemetryRuntimeImpl(disabledConfig, logger, 'test', '1.0.0');
      const status = runtime.getStatus();
      expect(status).toEqual({
        enabled: false,
        mode: 'off',
        exporterEndpoint: 'http://localhost:4318',
        samplingRate: 1.0,
        startedAt: undefined,
      });
    });

    test('returns status with startedAt after start()', async () => {
      const runtime = new TelemetryRuntimeImpl(enabledConfig, logger, 'test', '1.0.0');
      await runtime.start();
      const status = runtime.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.mode).toBe('traces');
      expect(status.startedAt).toBeDefined();
      expect(typeof status.startedAt).toBe('number');
      await runtime.shutdown();
    });
  });

  describe('getTracer()', () => {
    test('returns a functioning tracer when enabled', async () => {
      const runtime = new TelemetryRuntimeImpl(enabledConfig, logger, 'test', '1.0.0');
      await runtime.start();
      const tracer = runtime.getTracer('pipeline', '1.0.0');
      expect(tracer).toBeDefined();
      const span = tracer.startSpan('test-span');
      expect(span).toBeDefined();
      span.end();
      await runtime.shutdown();
    });
  });
});

describe('createTelemetryRuntime factory', () => {
  test('creates a runtime instance without starting', () => {
    const logger = createLogger();
    const runtime = createTelemetryRuntime(disabledConfig, logger, 'test', '1.0.0');
    expect(runtime).toBeInstanceOf(TelemetryRuntimeImpl);
    expect(runtime.isEnabled()).toBe(false);
  });
});
