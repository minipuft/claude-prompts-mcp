// @lifecycle test - pins which SDK object McpNotificationEmitter must be bound to.
/**
 * `McpNotificationEmitter.canSend()` reads `typeof server.notification === 'function'`, and
 * `McpNotificationServer` is a HAND-WRITTEN structural interface — nothing cross-checks it
 * against the installed SDK. When SDK v2 moved `notification()` from `McpServer` onto the inner
 * `Server`, `application.ts` kept binding the wrapper through an `as unknown as` cast, so the
 * capability check went permanently false and every notification became a debug-level skip.
 * Measured 2026-09-20 by driving both transports: five refusals, zero sends, on STDIO and HTTP
 * alike, while the suite stayed green.
 *
 * This is the control that differs in ONE identifier: the same probe against `McpServer` and
 * against `McpServer.server`. It fails on the next SDK major that moves the method again, which
 * is the event the old cast made invisible.
 *
 * Classification: Unit (constructs an SDK object, no I/O, no transport).
 */

import { describe, expect, jest, test } from '@jest/globals';

import { McpServer } from '@modelcontextprotocol/server';

import { McpNotificationEmitter } from '../../../src/infra/observability/notifications/index.js';
import { noopLogger } from '../../../src/infra/logging/index.js';

const buildMcpServer = (): McpServer =>
  new McpServer({ name: 'notification-binding-probe', version: '0.0.0' });

describe('the object McpNotificationEmitter must be bound to', () => {
  test('the inner Server carries notification() — this is what application.ts binds', () => {
    const server = buildMcpServer();

    expect(typeof server.server.notification).toBe('function');
  });

  test('CONTROL: the McpServer wrapper does not — binding it makes canSend() false forever', () => {
    const server = buildMcpServer();

    expect(typeof (server as unknown as { notification?: unknown }).notification).not.toBe(
      'function'
    );
  });

  test('an emitter bound to the inner Server reports it can send', () => {
    const emitter = new McpNotificationEmitter(noopLogger);
    emitter.setServer(buildMcpServer().server);

    expect(emitter.canSend()).toBe(true);
  });

  test('CONTROL: an emitter bound to the wrapper reports it cannot', () => {
    const emitter = new McpNotificationEmitter(noopLogger);
    emitter.setServer(
      buildMcpServer() as unknown as Parameters<McpNotificationEmitter['setServer']>[0]
    );

    expect(emitter.canSend()).toBe(false);
  });

  test('a server whose notification() REJECTS is reported, not left unhandled', async () => {
    // The SDK's `notification()` is async and rejects with `Not connected` whenever the bound
    // instance has no transport — always, under Streamable HTTP. An unhandled rejection reaches
    // `process.on('unhandledRejection')` in index.ts, which shuts the server down: measured
    // 2026-09-20, the first chain step of the first HTTP run killed the process one tick after
    // that request had answered isError:false. A synchronous try/catch cannot see it.
    const logger = { ...noopLogger, warn: jest.fn(), debug: jest.fn() };
    const emitter = new McpNotificationEmitter(logger);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      emitter.setServer({ notification: async () => Promise.reject(new Error('Not connected')) });
      emitter.emitChainStepComplete({ chainId: 'c#1', stepIndex: 1, status: 'passed' });

      // Two turns of the microtask queue plus a macrotask: an unhandled rejection is reported
      // at the end of the turn in which it went unhandled.
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        '[McpNotificationEmitter] Failed to send notification',
        expect.objectContaining({
          method: 'notifications/chain/step_complete',
          error: 'Not connected',
        })
      );
      // The success line must not claim a send that rejected.
      expect(logger.debug).not.toHaveBeenCalledWith(
        '[McpNotificationEmitter] Notification sent',
        expect.anything()
      );
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('CONTROL: a resolving server logs the send, and only after it resolves', async () => {
    const logger = { ...noopLogger, warn: jest.fn(), debug: jest.fn() };
    const emitter = new McpNotificationEmitter(logger);
    emitter.setServer({ notification: async () => undefined });

    logger.debug.mockClear();
    emitter.emitChainStepComplete({ chainId: 'c#1', stepIndex: 1, status: 'passed' });
    // Synchronously after the call the send has not resolved, so nothing may claim success.
    expect(logger.debug).not.toHaveBeenCalled();

    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.debug).toHaveBeenCalledWith('[McpNotificationEmitter] Notification sent', {
      method: 'notifications/chain/step_complete',
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('a dropped notification says WHICH conjunct failed, not just "no server"', () => {
    const logger = { ...noopLogger, warn: jest.fn() };
    const emitter = new McpNotificationEmitter(logger);
    emitter.setServer(
      buildMcpServer() as unknown as Parameters<McpNotificationEmitter['setServer']>[0]
    );

    emitter.emitChainComplete({ chainId: 'c#1', totalSteps: 1, status: 'completed' });

    expect(logger.warn).toHaveBeenCalledWith(
      '[McpNotificationEmitter] Notification dropped',
      expect.objectContaining({
        method: 'notifications/chain/complete',
        reason: expect.stringContaining('no notification()'),
      })
    );
  });
});
