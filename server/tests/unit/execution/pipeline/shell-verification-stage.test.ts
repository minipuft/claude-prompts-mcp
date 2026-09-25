import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ShellVerificationStage } from '../../../../src/engine/execution/pipeline/stages/17-shell-verification-stage.js';

import type {
  ShellVerifyExecutor,
  VerifyActiveStateStore,
} from '../../../../src/engine/gates/shell/index.js';
import type { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';
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

/**
 * `writeState`/`clearState` overrides take an already-configured mock (rather than a plain
 * return value) so a caller that needs `mockRejectedValue` can type it explicitly via
 * `jest.fn<VerifyActiveStateStore['writeState']>()` — the bare `jest.fn()` calls below infer
 * `never` for their argument in this Jest/TS combination (pre-existing, not fixed here).
 */
const createMockStateManager = (
  overrides: Partial<Pick<VerifyActiveStateStore, 'writeState' | 'clearState'>> = {}
): VerifyActiveStateStore =>
  ({
    writeState: overrides.writeState ?? jest.fn().mockResolvedValue(undefined),
    clearState: overrides.clearState ?? jest.fn().mockResolvedValue(undefined),
  }) as unknown as VerifyActiveStateStore;

const createMockSessionService = (): ChainSessionService =>
  ({
    setPendingShellVerification: jest.fn().mockResolvedValue(undefined),
    getPendingShellVerification: jest.fn().mockReturnValue(undefined),
    clearPendingShellVerification: jest.fn().mockResolvedValue(undefined),
    cancelChain: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    getSession: jest.fn().mockReturnValue(undefined),
  }) as unknown as ChainSessionService;

/** The advance owner a released hold moves the run through (`GateVerdictProcessor`). */
const createAdvanceOwner = () => ({
  applyDeferredAdvance: jest
    .fn<GateVerdictProcessor['applyDeferredAdvance']>()
    .mockResolvedValue(undefined),
});

describe('ShellVerificationStage', () => {
  test('sets shellVerifyPassedForGates when verification passes with sourceGateIds', async () => {
    const executor = createMockExecutor(true);
    const stateManager = createMockStateManager();
    const stage = new ShellVerificationStage(
      executor,
      stateManager,
      createMockSessionService(),
      createAdvanceOwner(),
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
      createAdvanceOwner(),
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
      createAdvanceOwner(),
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
      createAdvanceOwner(),
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>chain' });
    // No pendingShellVerification set

    await stage.execute(context);

    expect(executor.execute as jest.Mock).not.toHaveBeenCalled();
    expect(context.state.gates.shellVerifyPassedForGates).toBeUndefined();
  });

  // P6.27: the command checks an answer, so it never runs on the render call, which carries none.
  describe('the render call runs nothing (P6.27)', () => {
    const inlineCheck = () => ({
      gateId: 'shell-verify-inline',
      shellVerify: { command: 'npm test' },
      attemptCount: 0,
      maxAttempts: 5,
      previousResults: [],
    });

    test('the render call runs no command, spends no attempt, and saves the check with no node', async () => {
      const executor = createMockExecutor(false);
      const sessionService = createMockSessionService();
      const stage = new ShellVerificationStage(
        executor,
        createMockStateManager(),
        sessionService,
        createAdvanceOwner(),
        createLogger()
      );
      const context = new ExecutionContext({ command: '>>chain :: verify:"npm test"' });
      context.state.session.resumeSessionId = 'test-session';
      context.state.gates.pendingShellVerification = inlineCheck();

      await stage.execute(context);

      expect(executor.execute).not.toHaveBeenCalled();
      expect(context.response).toBeUndefined();
      expect(context.state.gates.pendingShellVerification?.attemptCount).toBe(0);
      expect(sessionService.setPendingShellVerification).toHaveBeenCalledTimes(1);
      const [sessionId, saved] = (sessionService.setPendingShellVerification as jest.Mock).mock
        .calls[0] as [string, { attemptCount: number; nodeId?: string }];
      expect(sessionId).toBe('test-session');
      expect(saved.attemptCount).toBe(0);
      // No answer captured yet: the node is named by the call that captures one (P6.44's refusal)
      expect(saved.nodeId).toBeUndefined();
    });

    test('control: the reply call restores the saved check and runs it once', async () => {
      const executor = createMockExecutor(false);
      const sessionService = createMockSessionService();
      (sessionService.getPendingShellVerification as jest.Mock).mockReturnValue(inlineCheck());
      const stage = new ShellVerificationStage(
        executor,
        createMockStateManager(),
        sessionService,
        createAdvanceOwner(),
        createLogger()
      );
      const context = new ExecutionContext({ chain_id: 'chain-test#1', user_response: 'done' });
      context.state.session.resumeSessionId = 'test-session';

      await stage.execute(context);

      expect(executor.execute).toHaveBeenCalledTimes(1);
      expect(context.state.gates.pendingShellVerification?.attemptCount).toBe(1);
      expect(JSON.stringify(context.response)).toContain('Attempt 1/5');
    });
  });

  // P6.32: only a gate_action moves a spent check, and a gate_action acts at any attempt count.
  describe('the attempt limit holds without gate_action (P6.32)', () => {
    const failed = {
      passed: false,
      exitCode: 1,
      stdout: '',
      stderr: 'FAIL',
      timedOut: false,
      durationMs: 50,
      command: 'npm test',
    };
    const replyCall = (args: Record<string, unknown>) => {
      const context = new ExecutionContext({ chain_id: 'chain-test#1', ...args });
      context.state.session.resumeSessionId = 'test-session';
      return context;
    };

    test('an answer after the attempts are spent re-renders the escalation and runs nothing', async () => {
      const executor = createMockExecutor(false);
      const sessionService = createMockSessionService();
      (sessionService.getPendingShellVerification as jest.Mock).mockReturnValue({
        gateId: 'shell-verify-inline',
        shellVerify: { command: 'npm test' },
        attemptCount: 2,
        maxAttempts: 2,
        previousResults: [failed, failed],
        nodeId: 'node-1',
      });
      const stage = new ShellVerificationStage(
        executor,
        createMockStateManager(),
        sessionService,
        createAdvanceOwner(),
        createLogger()
      );
      const context = replyCall({ user_response: 'one more try' });

      await stage.execute(context);

      expect(executor.execute).not.toHaveBeenCalled();
      const text = JSON.stringify(context.response);
      expect(text).toContain('Maximum Attempts Reached');
      expect(text).toContain('**Attempts:** 2/2');
      expect(context.state.gates.pendingShellVerification?.attemptCount).toBe(2);
      expect(context.state.gates.pendingShellVerification?.previousResults).toHaveLength(2);
    });

    test('control: retry resets to 0/N, and the next answer runs the check', async () => {
      const executor = createMockExecutor(false);
      const sessionService = createMockSessionService();
      (sessionService.getPendingShellVerification as jest.Mock).mockReturnValue({
        gateId: 'shell-verify-inline',
        shellVerify: { command: 'npm test' },
        attemptCount: 2,
        maxAttempts: 2,
        previousResults: [failed, failed],
        nodeId: 'node-1',
      });
      const stage = new ShellVerificationStage(
        executor,
        createMockStateManager(),
        sessionService,
        createAdvanceOwner(),
        createLogger()
      );

      const retried = replyCall({ gate_action: 'retry' });
      await stage.execute(retried);
      expect(JSON.stringify(retried.response)).toContain('0/2');
      const [, saved] = (sessionService.setPendingShellVerification as jest.Mock).mock.calls[0];
      (sessionService.getPendingShellVerification as jest.Mock).mockReturnValue(saved);

      const answered = replyCall({ user_response: 'fixed' });
      await stage.execute(answered);
      expect(executor.execute).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(answered.response)).toContain('Attempt 1/2');
    });

    test('skip sent with an answer before the attempts are spent acts on it and runs nothing', async () => {
      const executor = createMockExecutor(false);
      const sessionService = createMockSessionService();
      (sessionService.getPendingShellVerification as jest.Mock).mockReturnValue({
        gateId: 'shell-verify-inline',
        shellVerify: { command: 'npm test' },
        attemptCount: 1,
        maxAttempts: 3,
        previousResults: [failed],
        nodeId: 'node-1',
      });
      const advanceOwner = createAdvanceOwner();
      const stage = new ShellVerificationStage(
        executor,
        createMockStateManager(),
        sessionService,
        advanceOwner,
        createLogger()
      );
      const context = replyCall({ user_response: 'my answer', gate_action: 'skip' });

      await stage.execute(context);

      expect(executor.execute).not.toHaveBeenCalled();
      expect(sessionService.clearPendingShellVerification).toHaveBeenCalled();
      expect(advanceOwner.applyDeferredAdvance).toHaveBeenCalledWith(context, {
        sessionId: 'test-session',
        nodeId: 'node-1',
        reason: 'gate-skip',
      });
    });
  });

  // P6.52 / R32: a chain-level check grades every step's answer, not only the first held one.
  describe('the check stands again for the next step (P6.52)', () => {
    const passingRun = (standsOn: string | null) => {
      const sessionService = createMockSessionService();
      (sessionService.getPendingShellVerification as jest.Mock).mockReturnValue({
        nodeId: 'node-1',
      });
      (sessionService.getSession as jest.Mock).mockReturnValue({
        state: { currentNodeId: standsOn },
      });
      const stateManager = createMockStateManager();
      const stage = new ShellVerificationStage(
        createMockExecutor(true),
        stateManager,
        sessionService,
        createAdvanceOwner(),
        createLogger()
      );
      const context = new ExecutionContext({ chain_id: 'chain-test#1', user_response: 'fixed' });
      context.state.session.resumeSessionId = 'test-session';
      context.state.gates.pendingShellVerification = {
        gateId: 'shell-verify-inline',
        shellVerify: { command: 'npm test', loop: true },
        attemptCount: 2,
        maxAttempts: 5,
        previousResults: [],
        originalGoal: '>>chain',
      };
      return { stage, context, sessionService, stateManager };
    };

    test('a pass that moves the run to a later step re-arms it with a fresh budget and no node', async () => {
      const { stage, context, sessionService, stateManager } = passingRun('node-2');

      await stage.execute(context);

      const saves = (sessionService.setPendingShellVerification as jest.Mock).mock.calls;
      expect(saves).toHaveLength(1);
      const [, saved] = saves[0] as [string, Record<string, unknown>];
      expect(saved).toMatchObject({
        gateId: 'shell-verify-inline',
        attemptCount: 0,
        previousResults: [],
        maxAttempts: 5,
        originalGoal: '>>chain',
      });
      expect(saved['nodeId']).toBeUndefined();
      // The loop's Stop-hook state stands again rather than being cleared
      expect(stateManager.writeState).toHaveBeenLastCalledWith(
        'chain-test#1',
        expect.objectContaining({ attemptCount: 0 })
      );
      expect(stateManager.clearState).not.toHaveBeenCalled();
    });

    test('control: the pass that completes the run leaves the check cleared', async () => {
      const { stage, context, sessionService, stateManager } = passingRun(null);

      await stage.execute(context);

      expect(sessionService.clearPendingShellVerification).toHaveBeenCalled();
      expect(sessionService.setPendingShellVerification).not.toHaveBeenCalled();
      expect(stateManager.clearState).toHaveBeenCalledWith('chain-test#1');
    });
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
        createAdvanceOwner(),
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
        createAdvanceOwner(),
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

    test('gate_action: skip releases the held step through the advance owner (R24)', async () => {
      const executor = createMockExecutor(true);
      const sessionService = createMockSessionService();
      (sessionService.getPendingShellVerification as jest.Mock).mockReturnValue({
        nodeId: 'node-1',
      });
      const advanceOwner = createAdvanceOwner();
      const stage = new ShellVerificationStage(
        executor,
        createMockStateManager(),
        sessionService,
        advanceOwner,
        createLogger()
      );

      const context = createEscalatedContext('skip');
      await stage.execute(context);

      // No response: the pipeline continues and renders the step the run moved to
      expect(context.response).toBeUndefined();
      expect(context.state.gates.pendingShellVerification).toBeUndefined();
      expect(sessionService.clearPendingShellVerification).toHaveBeenCalled();
      expect(advanceOwner.applyDeferredAdvance).toHaveBeenCalledWith(context, {
        sessionId: 'test-session',
        nodeId: 'node-1',
        reason: 'gate-skip',
      });
      expect(executor.execute).not.toHaveBeenCalled();
    });

    test('gate_action: skip with no captured answer is refused by name and keeps the check', async () => {
      const executor = createMockExecutor(true);
      const sessionService = createMockSessionService();
      const advanceOwner = createAdvanceOwner();
      const stage = new ShellVerificationStage(
        executor,
        createMockStateManager(),
        sessionService,
        advanceOwner,
        createLogger()
      );

      const context = createEscalatedContext('skip');
      await stage.execute(context);

      expect(JSON.stringify(context.response)).toContain(
        'nothing to skip past on step 1; answer it first'
      );
      expect(sessionService.clearPendingShellVerification).not.toHaveBeenCalled();
      expect(sessionService.setPendingShellVerification).toHaveBeenCalled();
      expect(advanceOwner.applyDeferredAdvance).not.toHaveBeenCalled();
      expect(executor.execute).not.toHaveBeenCalled();
    });
  });

  // OQ-10: VerifyActiveStateStore.writeState/clearState now throw on a persistence failure
  // instead of logging and swallowing it. These tests prove the stage is not a second place
  // that catches — the failure must reach whatever awaits `stage.execute()` (in production,
  // the pipeline's single error boundary), not be absorbed here and reported as a pass.
  describe('verify-loop persistence failures propagate, not get swallowed', () => {
    test('a writeState failure while arming the loop propagates out of execute()', async () => {
      const executor = createMockExecutor(true);
      const stateManager = createMockStateManager({
        writeState: jest
          .fn<VerifyActiveStateStore['writeState']>()
          .mockRejectedValue(
            new Error('Failed to arm verify-loop state for session test-session: disk full')
          ),
      });
      const stage = new ShellVerificationStage(
        executor,
        stateManager,
        createMockSessionService(),
        createAdvanceOwner(),
        createLogger()
      );

      const context = new ExecutionContext({ command: '>>chain', user_response: 'fixed code' });
      context.state.gates.pendingShellVerification = {
        gateId: 'shell-verify-inline',
        shellVerify: { command: 'npm test', loop: true },
        attemptCount: 1,
        maxAttempts: 5,
        previousResults: [],
      };

      // The caller (here, the test itself standing in for the pipeline) receives the
      // failure as a rejection rather than the stage returning a normal (misleading) result.
      await expect(stage.execute(context)).rejects.toThrow(/could not be armed|Failed to arm/);

      // Not run: the write failure happens before the command executes.
      expect(executor.execute).not.toHaveBeenCalled();
    });

    test('a clearState failure on verification pass propagates out of execute()', async () => {
      const executor = createMockExecutor(true);
      const stateManager = createMockStateManager({
        clearState: jest
          .fn<VerifyActiveStateStore['clearState']>()
          .mockRejectedValue(
            new Error('Failed to clear verify-loop state for session test-session: disk full')
          ),
      });
      const stage = new ShellVerificationStage(
        executor,
        stateManager,
        createMockSessionService(),
        createAdvanceOwner(),
        createLogger()
      );

      const context = new ExecutionContext({ command: '>>chain', user_response: 'fixed code' });
      context.state.gates.pendingShellVerification = {
        gateId: 'shell-verify-inline',
        shellVerify: { command: 'npm test', loop: true },
        attemptCount: 1,
        maxAttempts: 5,
        previousResults: [],
      };

      // The stage must not report the pass while the loop record is left stale — the
      // rejection is what tells the caller the clear did not happen.
      await expect(stage.execute(context)).rejects.toThrow(/could not be cleared|Failed to clear/);
    });

    test('a clearState failure on escalation propagates instead of returning the escalation reply', async () => {
      const executor = createMockExecutor(false);
      const stateManager = createMockStateManager({
        clearState: jest
          .fn<VerifyActiveStateStore['clearState']>()
          .mockRejectedValue(
            new Error('Failed to clear verify-loop state for session test-session: disk full')
          ),
      });
      const stage = new ShellVerificationStage(
        executor,
        stateManager,
        createMockSessionService(),
        createAdvanceOwner(),
        createLogger()
      );

      const context = new ExecutionContext({ command: '>>chain', user_response: 'attempt fix' });
      context.state.gates.pendingShellVerification = {
        gateId: 'shell-verify-inline',
        shellVerify: { command: 'npm test', loop: true },
        attemptCount: 4, // next failure reaches maxAttempts → escalation path
        maxAttempts: 5,
        previousResults: [],
      };

      // Before this fix, the escalation reply below would have been returned to the
      // caller — claiming the loop was handled — while verify-state.db still said
      // otherwise. Now the reply never forms; the failure does instead.
      await expect(stage.execute(context)).rejects.toThrow(/could not be cleared|Failed to clear/);
      expect(context.response).toBeUndefined();
    });
  });
});
