import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ShellVerificationStage } from '../../../../src/engine/execution/pipeline/stages/17-shell-verification-stage.js';

import type {
  ShellVerifyExecutor,
  VerifyActiveStateStore,
} from '../../../../src/engine/gates/shell/index.js';
import type { ChainSessionService } from '../../../../src/shared/types/chain-session.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createMockExecutor = (passed = true): ShellVerifyExecutor =>
  ({
    execute: jest.fn().mockResolvedValue({
      passed,
      exitCode: passed ? 0 : 1,
      stdout: passed ? 'ok' : '',
      stderr: passed ? '' : 'FAIL',
      timedOut: false,
      durationMs: 100,
    }),
  }) as unknown as ShellVerifyExecutor;

const createMockStateManager = (): VerifyActiveStateStore =>
  ({
    writeState: jest.fn().mockResolvedValue(undefined),
    clearState: jest.fn().mockResolvedValue(undefined),
    readState: jest.fn().mockResolvedValue(null),
  }) as unknown as VerifyActiveStateStore;

const createMockSessionService = (): ChainSessionService =>
  ({
    setPendingShellVerification: jest.fn().mockResolvedValue(undefined),
    getPendingShellVerification: jest.fn().mockReturnValue(undefined),
    clearPendingShellVerification: jest.fn().mockResolvedValue(undefined),
    cancelChain: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
  }) as unknown as ChainSessionService;

describe('ShellVerificationStage', () => {
  test('sets shellVerifyPassedForGates when verification passes with sourceGateIds', async () => {
    const executor = createMockExecutor(true);
    const stateManager = createMockStateManager();
    const stage = new ShellVerificationStage(
      executor,
      stateManager,
      createMockSessionService(),
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>chain', user_response: 'fixed code' });

    context.state.gates.pendingShellVerification = {
      gateId: 'gate-shell-test-suite',
      shellVerify: { command: 'npm test' },
      attemptCount: 1,
      maxAttempts: 5,
      previousResults: [],
      sourceGateIds: ['test-suite'],
    };

    await stage.execute(context);

    // Verification passed → shellVerifyPassedForGates should be set
    expect(context.state.gates.shellVerifyPassedForGates).toEqual(['test-suite']);
    // Pending verification should be cleared
    expect(context.state.gates.pendingShellVerification).toBeUndefined();
  });

  test('does NOT set shellVerifyPassedForGates for standalone :: verify (no sourceGateIds)', async () => {
    const executor = createMockExecutor(true);
    const stateManager = createMockStateManager();
    const stage = new ShellVerificationStage(
      executor,
      stateManager,
      createMockSessionService(),
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>chain', user_response: 'fixed code' });

    context.state.gates.pendingShellVerification = {
      gateId: 'shell-verify-inline',
      shellVerify: { command: 'echo ok' },
      attemptCount: 1,
      maxAttempts: 1,
      previousResults: [],
      // No sourceGateIds — standalone :: verify
    };

    await stage.execute(context);

    // No sourceGateIds → shellVerifyPassedForGates should NOT be set
    expect(context.state.gates.shellVerifyPassedForGates).toBeUndefined();
    expect(context.state.gates.pendingShellVerification).toBeUndefined();
  });

  test('does NOT set shellVerifyPassedForGates when verification fails', async () => {
    const executor = createMockExecutor(false);
    const stateManager = createMockStateManager();
    const stage = new ShellVerificationStage(
      executor,
      stateManager,
      createMockSessionService(),
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>chain', user_response: 'attempt fix' });

    context.state.gates.pendingShellVerification = {
      gateId: 'gate-shell-test-suite',
      shellVerify: { command: 'npm test' },
      attemptCount: 1,
      maxAttempts: 5,
      previousResults: [],
      sourceGateIds: ['test-suite'],
    };

    await stage.execute(context);

    // Failed → should NOT signal pass
    expect(context.state.gates.shellVerifyPassedForGates).toBeUndefined();
    // Pending verification should still exist (bounce-back)
    expect(context.state.gates.pendingShellVerification).toBeDefined();
  });

  test('skips when no pending shell verification exists', async () => {
    const executor = createMockExecutor(true);
    const stateManager = createMockStateManager();
    const stage = new ShellVerificationStage(
      executor,
      stateManager,
      createMockSessionService(),
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>chain' });
    // No pendingShellVerification set

    await stage.execute(context);

    expect(executor.execute as jest.Mock).not.toHaveBeenCalled();
    expect(context.state.gates.shellVerifyPassedForGates).toBeUndefined();
  });

  describe('gate_action handling', () => {
    const createEscalatedContext = (gateAction: 'retry' | 'skip' | 'abort') => {
      const context = new ExecutionContext({
        command: '>>chain',
        chain_id: 'chain-test#1',
        gate_action: gateAction,
      });

      // Set session ID so saveToSession/clearFromSession don't bail out
      context.state.session.resumeSessionId = 'test-session';

      context.state.gates.pendingShellVerification = {
        gateId: 'shell-verify-inline',
        shellVerify: { command: 'npm test' },
        attemptCount: 1,
        maxAttempts: 1, // Already at max
        previousResults: [
          {
            passed: false,
            exitCode: 1,
            stdout: '',
            stderr: 'FAIL',
            timedOut: false,
            durationMs: 50,
            command: 'npm test',
          },
        ],
      };

      return context;
    };

    test('gate_action: retry sets response with reset confirmation', async () => {
      const executor = createMockExecutor(true);
      const sessionService = createMockSessionService();
      const stage = new ShellVerificationStage(
        executor,
        createMockStateManager(),
        sessionService,
        createLogger()
      );

      const context = createEscalatedContext('retry');
      await stage.execute(context);

      // Should set a response (pipeline terminates)
      expect(context.response).toBeDefined();
      const text = context.response!.content[0].text;
      expect(text).toContain('Attempts Reset');
      expect(text).toContain('npm test');
      expect(text).toContain('0/1');

      // Should save reset state to session
      expect(sessionService.setPendingShellVerification).toHaveBeenCalled();

      // Should NOT execute the verification command
      expect(executor.execute).not.toHaveBeenCalled();
    });

    test('gate_action: abort sets response with abort confirmation', async () => {
      const executor = createMockExecutor(true);
      const sessionService = createMockSessionService();
      const stage = new ShellVerificationStage(
        executor,
        createMockStateManager(),
        sessionService,
        createLogger()
      );

      const context = createEscalatedContext('abort');
      await stage.execute(context);

      // Should set a response (pipeline terminates)
      expect(context.response).toBeDefined();
      const text = context.response!.content[0].text;
      expect(text).toContain('Aborted');
      expect(text).toContain('npm test');

      // Should clear from session
      expect(sessionService.clearPendingShellVerification).toHaveBeenCalled();

      // Should mark session as aborted
      expect(context.state.session.aborted).toBe(true);

      // ...and cancel the run, so "Execution stopped by user" above is true rather than
      // advisory. The flag alone left runStatus 'working' and the chain resumable.
      expect(sessionService.cancelChain).toHaveBeenCalled();

      // Should NOT execute the verification command
      expect(executor.execute).not.toHaveBeenCalled();
    });

    test('gate_action: skip does NOT set response (pipeline continues)', async () => {
      const executor = createMockExecutor(true);
      const sessionService = createMockSessionService();
      const stage = new ShellVerificationStage(
        executor,
        createMockStateManager(),
        sessionService,
        createLogger()
      );

      const context = createEscalatedContext('skip');
      await stage.execute(context);

      // Should NOT set a response (pipeline continues to next stages)
      expect(context.response).toBeUndefined();

      // Should clear pending state
      expect(context.state.gates.pendingShellVerification).toBeUndefined();
      expect(sessionService.clearPendingShellVerification).toHaveBeenCalled();

      // Should NOT execute the verification command
      expect(executor.execute).not.toHaveBeenCalled();
    });
  });
});
