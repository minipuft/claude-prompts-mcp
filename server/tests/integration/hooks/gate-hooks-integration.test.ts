// @lifecycle canonical - Integration tests for gate hook emission.
/**
 * Gate Hooks Integration Tests
 *
 * Verifies that gate events are properly emitted through the pipeline:
 * - HookRegistry receives gate evaluation events
 * - McpNotificationEmitter sends MCP notifications
 * - Events are emitted at correct points in ResponseCaptureStage
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { HookRegistry, type GateHooks, type HookExecutionContext } from '../../../src/hooks/index.js';
import { McpNotificationEmitter, type McpNotificationServer } from '../../../src/notifications/index.js';
import { noopLogger } from '../../../src/logging/index.js';

describe('Gate Hooks Integration', () => {
  let hookRegistry: HookRegistry;
  let notificationEmitter: McpNotificationEmitter;
  let mockServer: jest.Mocked<McpNotificationServer>;

  beforeEach(() => {
    hookRegistry = new HookRegistry(noopLogger);
    notificationEmitter = new McpNotificationEmitter(noopLogger);

    // Create mock MCP server
    mockServer = {
      notification: jest.fn(),
    };
    notificationEmitter.setServer(mockServer);
  });

  afterEach(() => {
    hookRegistry.clearAll();
  });

  describe('HookRegistry Gate Events', () => {
    test('emits gate:evaluated event when gate passes', async () => {
      const events: Array<{ gateId: string; passed: boolean }> = [];
      hookRegistry.on('gate:evaluated', (event) => events.push(event));

      const context: HookExecutionContext = {
        executionId: 'test-exec-1',
        executionType: 'chain',
        chainId: 'test-chain-1',
        currentStep: 1,
        frameworkEnabled: false,
      };

      await hookRegistry.emitGateEvaluated(
        { id: 'code-quality' } as any,
        { passed: true, reason: 'All criteria met', blocksResponse: false },
        context
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ gateId: 'code-quality', passed: true });
    });

    test('emits gate:failed event when gate fails', async () => {
      const events: Array<{ gateId: string; reason: string }> = [];
      hookRegistry.on('gate:failed', (event) => events.push(event));

      const context: HookExecutionContext = {
        executionId: 'test-exec-2',
        executionType: 'chain',
        chainId: 'test-chain-1',
        currentStep: 1,
        frameworkEnabled: false,
      };

      await hookRegistry.emitGateFailed(
        { id: 'code-quality' } as any,
        'Missing required documentation',
        context
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        gateId: 'code-quality',
        reason: 'Missing required documentation',
      });
    });

    test('emits gate:retryExhausted event when retries exhausted', async () => {
      const events: Array<{ gateIds: string[]; chainId: string }> = [];
      hookRegistry.on('gate:retryExhausted', (event) => events.push(event));

      const context: HookExecutionContext = {
        executionId: 'test-exec-3',
        executionType: 'chain',
        chainId: 'test-chain-1',
        currentStep: 2,
        frameworkEnabled: true,
        frameworkId: 'CAGEERF',
      };

      await hookRegistry.emitRetryExhausted(['code-quality', 'research-quality'], 'test-chain-1', context);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        gateIds: ['code-quality', 'research-quality'],
        chainId: 'test-chain-1',
      });
    });

    test('emits gate:responseBlocked event when response blocked', async () => {
      const events: Array<{ gateIds: string[] }> = [];
      hookRegistry.on('gate:responseBlocked', (event) => events.push(event));

      const context: HookExecutionContext = {
        executionId: 'test-exec-4',
        executionType: 'single',
        frameworkEnabled: false,
      };

      await hookRegistry.emitResponseBlocked(['critical-gate'], context);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ gateIds: ['critical-gate'] });
    });

    test('calls registered hook callbacks', async () => {
      const onGateEvaluated = jest.fn();
      const onGateFailed = jest.fn();
      const onRetryExhausted = jest.fn();
      const onResponseBlocked = jest.fn();

      const hooks: GateHooks = {
        onGateEvaluated,
        onGateFailed,
        onRetryExhausted,
        onResponseBlocked,
      };

      hookRegistry.registerGateHooks(hooks);

      const context: HookExecutionContext = {
        executionId: 'test-exec-5',
        executionType: 'chain',
        chainId: 'chain-1',
        currentStep: 1,
        frameworkEnabled: true,
        frameworkId: 'CAGEERF',
      };

      // Test each hook type
      await hookRegistry.emitGateEvaluated(
        { id: 'gate-1' } as any,
        { passed: true, reason: 'passed', blocksResponse: false },
        context
      );
      expect(onGateEvaluated).toHaveBeenCalledTimes(1);
      expect(onGateEvaluated).toHaveBeenCalledWith(
        { id: 'gate-1' },
        { passed: true, reason: 'passed', blocksResponse: false },
        context
      );

      await hookRegistry.emitGateFailed({ id: 'gate-2' } as any, 'failed reason', context);
      expect(onGateFailed).toHaveBeenCalledWith({ id: 'gate-2' }, 'failed reason', context);

      await hookRegistry.emitRetryExhausted(['gate-3'], 'chain-1', context);
      expect(onRetryExhausted).toHaveBeenCalledWith(['gate-3'], 'chain-1', context);

      await hookRegistry.emitResponseBlocked(['gate-4'], context);
      expect(onResponseBlocked).toHaveBeenCalledWith(['gate-4'], context);
    });

    test('continues executing other hooks if one throws', async () => {
      const hook1 = jest.fn().mockRejectedValue(new Error('Hook 1 error'));
      const hook2 = jest.fn();

      hookRegistry.registerGateHooks({ onGateFailed: hook1 });
      hookRegistry.registerGateHooks({ onGateFailed: hook2 });

      const context: HookExecutionContext = {
        executionId: 'test-exec-6',
        executionType: 'single',
        frameworkEnabled: false,
      };

      // Should not throw, and should call both hooks
      await hookRegistry.emitGateFailed({ id: 'gate' } as any, 'reason', context);

      expect(hook1).toHaveBeenCalledTimes(1);
      expect(hook2).toHaveBeenCalledTimes(1);
    });
  });

  describe('McpNotificationEmitter', () => {
    test('sends gate failed notification', () => {
      notificationEmitter.emitGateFailed({
        gateId: 'code-quality',
        reason: 'Missing tests',
        chainId: 'chain-1',
      });

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/gate/failed',
        params: {
          gateId: 'code-quality',
          reason: 'Missing tests',
          chainId: 'chain-1',
        },
      });
    });

    test('sends response blocked notification', () => {
      notificationEmitter.emitResponseBlocked({
        gateIds: ['critical-gate-1', 'critical-gate-2'],
        chainId: 'chain-1',
      });

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/gate/response_blocked',
        params: {
          gateIds: ['critical-gate-1', 'critical-gate-2'],
          chainId: 'chain-1',
        },
      });
    });

    test('sends retry exhausted notification', () => {
      notificationEmitter.emitRetryExhausted({
        gateIds: ['gate-1'],
        chainId: 'chain-1',
        maxAttempts: 3,
      });

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/gate/retry_exhausted',
        params: {
          gateIds: ['gate-1'],
          chainId: 'chain-1',
          maxAttempts: 3,
        },
      });
    });

    test('gracefully handles missing server', () => {
      const emitterWithoutServer = new McpNotificationEmitter(noopLogger);

      // Should not throw
      expect(() => {
        emitterWithoutServer.emitGateFailed({
          gateId: 'gate',
          reason: 'reason',
        });
      }).not.toThrow();
    });

    test('gracefully handles notification error', () => {
      mockServer.notification.mockImplementation(() => {
        throw new Error('Connection lost');
      });

      // Should not throw
      expect(() => {
        notificationEmitter.emitGateFailed({
          gateId: 'gate',
          reason: 'reason',
        });
      }).not.toThrow();
    });
  });

  describe('Combined Hook and Notification Flow', () => {
    test('supports both hooks and notifications for same event', async () => {
      const hookCallback = jest.fn();
      hookRegistry.registerGateHooks({ onGateFailed: hookCallback });

      const context: HookExecutionContext = {
        executionId: 'combined-test',
        executionType: 'chain',
        chainId: 'chain-1',
        currentStep: 1,
        frameworkEnabled: false,
      };

      // Emit via HookRegistry
      await hookRegistry.emitGateFailed({ id: 'gate-1' } as any, 'Gate criteria not met', context);

      // Also emit via NotificationEmitter
      notificationEmitter.emitGateFailed({
        gateId: 'gate-1',
        reason: 'Gate criteria not met',
        chainId: 'chain-1',
      });

      // Verify both were called
      expect(hookCallback).toHaveBeenCalledTimes(1);
      expect(mockServer.notification).toHaveBeenCalledTimes(1);
    });
  });
});
