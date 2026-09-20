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
