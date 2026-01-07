// @lifecycle canonical - Shell verification gate execution for Ralph Wiggum loops.
import fs from 'fs/promises';
import path from 'path';

import { createGitCheckpoint } from '../../../gates/shell/git-checkpoint.js';
import {
  type ShellVerifyExecutor,
  type ShellVerifyResult,
  type PendingShellVerification,
  type VerifyActiveState,
  SHELL_VERIFY_DEFAULT_MAX_ITERATIONS,
} from '../../../gates/shell/index.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';

/**
 * Pipeline Stage 8b: Shell Verification
 *
 * Executes shell verification gates that enable "Ralph Wiggum" style autonomous loops
 * where Claude's work is validated by real shell command execution (ground truth)
 * rather than LLM self-evaluation.
 *
 * Position: After StepResponseCaptureStage (08), before ExecutionStage (09)
 *
 * Flow:
 * 1. Check for pendingShellVerification in state
 * 2. Execute shell command via ShellVerifyExecutor
 * 3. If PASS (exit 0): Clear verification, proceed
 * 4. If FAIL (exit != 0):
 *    - If attempts < 5: Return formatted error to chat (bounce-back)
 *    - If attempts >= 5: Return escalation with gate_action options
 *
 * Dependencies: context.state.gates.pendingShellVerification
 * Output: Updated state with verification results
 * Can Early Exit: Yes (on verification failure)
 *
 * @see plans/ralph-style-loop.md for the implementation plan
 */
export class ShellVerificationStage extends BasePipelineStage {
  readonly name = 'ShellVerification';
  private readonly runtimeStateDir: string;
  private currentCheckpointRef: string | null = null;

  constructor(
    private readonly shellVerifyExecutor: ShellVerifyExecutor,
    logger: Logger,
    runtimeStateDir?: string
  ) {
    super(logger);
    // Default to server/runtime-state relative to cwd, or accept override
    this.runtimeStateDir = runtimeStateDir ?? path.join(process.cwd(), 'runtime-state');
  }

  /**
   * Get the path to verify-active.json
   */
  private get verifyActiveStatePath(): string {
    return path.join(this.runtimeStateDir, 'verify-active.json');
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    // DEBUG: Trace shell verification state
    this.logger.info('[ShellVerificationStage] Checking for pending verification:', {
      hasPending: Boolean(context.state.gates.pendingShellVerification),
      pendingGateId: context.state.gates.pendingShellVerification?.gateId,
      pendingCommand: context.state.gates.pendingShellVerification?.shellVerify?.command,
    });

    const pending = context.state.gates.pendingShellVerification;
    if (pending === undefined) {
      this.logExit({ skipped: 'No pending shell verification' });
      return;
    }

    const { shellVerify } = pending;

    // Check if this is a gate_action response (retry/skip/abort)
    const gateAction = context.mcpRequest.gate_action;
    if (gateAction !== undefined && pending.attemptCount >= pending.maxAttempts) {
      await this.handleGateAction(context, gateAction, pending);
      return;
    }

    // Require user_response before running verification
    const userResponse = context.mcpRequest.user_response?.trim();
    if ((userResponse === undefined || userResponse === '') && pending.attemptCount > 0) {
      this.logExit({ skipped: 'Awaiting user response before verification' });
      return;
    }

    // === LOOP MODE: Write verify-active.json for Stop hook integration ===
    if (shellVerify.loop === true) {
      await this.writeVerifyActiveState(context, pending);
    }

    // === CHECKPOINT MODE: Create git stash before verification ===
    if (shellVerify.checkpoint === true && pending.attemptCount === 0) {
      const workingDir = shellVerify.workingDir ?? process.cwd();
      const gitCheckpoint = createGitCheckpoint(this.logger, workingDir);
      const checkpointResult = await gitCheckpoint.createCheckpoint();
      if (checkpointResult.success && checkpointResult.ref) {
        this.currentCheckpointRef = checkpointResult.ref;
        this.logger.info(`[${this.name}] Created git checkpoint: ${checkpointResult.ref}`);
      }
    }

    // Execute verification
    const result = await this.shellVerifyExecutor.execute(shellVerify);

    // Update attempt count and results
    pending.attemptCount += 1;
    pending.previousResults.push(result);
    context.state.gates.shellVerifyResults = [
      ...(context.state.gates.shellVerifyResults ?? []),
      result,
    ];

    if (result.passed) {
      // Verification passed - clear pending and proceed
      context.state.gates.pendingShellVerification = undefined;

      // === LOOP MODE: Clear verify-active.json ===
      if (shellVerify.loop === true) {
        await this.clearVerifyActiveState();
      }

      // === CHECKPOINT MODE: Clear checkpoint (don't rollback) ===
      if (this.currentCheckpointRef !== null) {
        const workingDir = shellVerify.workingDir ?? process.cwd();
        const gitCheckpoint = createGitCheckpoint(this.logger, workingDir);
        await gitCheckpoint.clearCheckpoint(this.currentCheckpointRef);
        this.currentCheckpointRef = null;
      }

      context.diagnostics.info(this.name, 'Shell verification PASSED', {
        command: result.command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        attemptCount: pending.attemptCount,
      });
      this.logExit({ passed: true, attemptCount: pending.attemptCount });
      return;
    }

    // Verification failed
    context.diagnostics.warn(this.name, 'Shell verification FAILED', {
      command: result.command,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      attemptCount: pending.attemptCount,
      maxAttempts: pending.maxAttempts,
    });

    // === ROLLBACK MODE: Restore git checkpoint on failure ===
    if (shellVerify.rollback === true && this.currentCheckpointRef !== null) {
      const workingDir = shellVerify.workingDir ?? process.cwd();
      const gitCheckpoint = createGitCheckpoint(this.logger, workingDir);
      await gitCheckpoint.rollbackToCheckpoint(this.currentCheckpointRef);
      this.currentCheckpointRef = null;
      this.logger.info(`[${this.name}] Rolled back to git checkpoint`);
    }

    if (pending.attemptCount >= pending.maxAttempts) {
      // Max attempts reached - request user decision
      this.setEscalationResponse(context, result, pending);

      // Clear verify-active.json on max attempts (Stop hook shouldn't keep trying)
      if (shellVerify.loop === true) {
        await this.clearVerifyActiveState();
      }
    } else {
      // Bounce back with error for retry
      this.setBounceBackResponse(context, result, pending);
    }

    // Short-circuit the pipeline by setting response directly
    // This causes the pipeline to return the feedback immediately
    const feedback = context.state.gates.shellVerifyFeedback;
    if (feedback !== undefined) {
      context.setResponse({
        content: [{ type: 'text', text: feedback.message }],
      });
    }

    this.logExit({
      passed: false,
      attemptCount: pending.attemptCount,
      maxAttempts: pending.maxAttempts,
      escalated: pending.attemptCount >= pending.maxAttempts,
    });
  }

  /**
   * Handle gate_action user decision (retry/skip/abort).
   */
  private async handleGateAction(
    context: ExecutionContext,
    gateAction: string,
    pending: PendingShellVerification
  ): Promise<void> {
    switch (gateAction) {
      case 'retry':
        // Reset attempt count and continue
        pending.attemptCount = 0;
        pending.previousResults = [];
        context.state.gates.shellVerifyResults = [];
        context.diagnostics.info(this.name, 'User chose to retry shell verification', {
          gateId: pending.gateId,
        });
        this.logExit({ gateAction: 'retry', reset: true });
        break;

      case 'skip':
        // Clear verification and proceed
        context.state.gates.pendingShellVerification = undefined;
        context.diagnostics.warn(this.name, 'User chose to skip shell verification', {
          gateId: pending.gateId,
          attemptCount: pending.attemptCount,
        });
        this.logExit({ gateAction: 'skip' });
        break;

      case 'abort':
        // Abort the chain
        context.state.session.aborted = true;
        context.state.gates.pendingShellVerification = undefined;
        context.diagnostics.info(
          this.name,
          'User chose to abort after shell verification failure',
          {
            gateId: pending.gateId,
            attemptCount: pending.attemptCount,
          }
        );
        this.logExit({ gateAction: 'abort' });
        break;

      default:
        this.logger.warn(`[${this.name}] Unknown gate_action: ${gateAction}`);
    }
  }

  /**
   * Set bounce-back response for retry attempts.
   * Uses state.gates.shellVerifyFeedback for downstream formatting.
   */
  private setBounceBackResponse(
    context: ExecutionContext,
    result: ShellVerifyResult,
    pending: PendingShellVerification
  ): void {
    const errorOutput =
      (result.stderr !== '' ? result.stderr : null) ??
      (result.stdout !== '' ? result.stdout : null) ??
      'No output captured';
    const truncatedOutput = this.truncateForDisplay(errorOutput, 2000);

    // Store formatted feedback for downstream stages to include in response
    context.state.gates.shellVerifyFeedback = {
      type: 'bounce_back',
      message: this.formatBounceBackMessage(result, pending, truncatedOutput),
    };
  }

  /**
   * Set escalation response after max attempts.
   * Uses state.gates for downstream handling.
   */
  private setEscalationResponse(
    context: ExecutionContext,
    result: ShellVerifyResult,
    pending: PendingShellVerification
  ): void {
    context.state.gates.retryLimitExceeded = true;
    context.state.gates.awaitingUserChoice = true;

    const errorOutput =
      (result.stderr !== '' ? result.stderr : null) ??
      (result.stdout !== '' ? result.stdout : null) ??
      'No output captured';
    const truncatedOutput = this.truncateForDisplay(errorOutput, 2000);

    // Store formatted feedback for downstream stages to include in response
    context.state.gates.shellVerifyFeedback = {
      type: 'escalation',
      message: this.formatEscalationMessage(result, pending, truncatedOutput),
    };
  }

  /**
   * Format bounce-back message for retry.
   */
  private formatBounceBackMessage(
    result: ShellVerifyResult,
    pending: PendingShellVerification,
    errorOutput: string
  ): string {
    const lines = [
      `## Shell Verification FAILED (Attempt ${pending.attemptCount}/${pending.maxAttempts})`,
      '',
      `**Command:** \`${result.command}\``,
      `**Exit Code:** ${result.exitCode}`,
    ];

    if (result.timedOut === true) {
      lines.push(`**Status:** Timed out after ${result.durationMs}ms`);
    }

    lines.push(
      '',
      '### Error Output',
      '```',
      errorOutput,
      '```',
      '',
      'Please fix the issues and submit again.'
    );

    return lines.join('\n');
  }

  /**
   * Format escalation message after max attempts.
   */
  private formatEscalationMessage(
    result: ShellVerifyResult,
    pending: PendingShellVerification,
    errorOutput: string
  ): string {
    const lines = [
      '## Shell Verification FAILED - Maximum Attempts Reached',
      '',
      `**Command:** \`${result.command}\``,
      `**Attempts:** ${pending.attemptCount}/${pending.maxAttempts}`,
      `**Exit Code:** ${result.exitCode}`,
    ];

    if (result.timedOut === true) {
      lines.push(`**Status:** Timed out`);
    }

    lines.push(
      '',
      '### Recent Error Output',
      '```',
      errorOutput,
      '```',
      '',
      'Use `gate_action` parameter to decide:',
      '',
      '- **retry**: Reset attempt count and try again',
      '- **skip**: Bypass verification and continue',
      '- **abort**: Stop execution'
    );

    return lines.join('\n');
  }

  /**
   * Truncate output for display.
   */
  private truncateForDisplay(output: string, maxLength: number): string {
    if (output.length <= maxLength) {
      return output.trim();
    }
    const truncated = output.slice(-maxLength);
    return `[...truncated...]\n${truncated}`.trim();
  }

  /**
   * Write verify-active.json for Stop hook integration.
   *
   * This file enables the Stop hook to read verification config
   * and block Claude from stopping until verification passes.
   */
  private async writeVerifyActiveState(
    context: ExecutionContext,
    pending: PendingShellVerification
  ): Promise<void> {
    const { shellVerify } = pending;

    const state: VerifyActiveState = {
      sessionId: context.getRequestedChainId() ?? context.state.session.resumeChainId ?? 'unknown',
      config: {
        command: shellVerify.command,
        timeout: shellVerify.timeout ?? 300000,
        maxIterations: shellVerify.maxIterations ?? SHELL_VERIFY_DEFAULT_MAX_ITERATIONS,
        checkpoint: shellVerify.checkpoint ?? false,
        rollback: shellVerify.rollback ?? false,
        workingDir: shellVerify.workingDir,
      },
      state: {
        iteration: pending.attemptCount,
        lastResult: pending.previousResults[pending.previousResults.length - 1] ?? null,
        checkpointRef: this.currentCheckpointRef,
        startedAt: new Date().toISOString(),
      },
    };

    try {
      // Ensure directory exists
      await fs.mkdir(this.runtimeStateDir, { recursive: true });

      // Write state file
      await fs.writeFile(this.verifyActiveStatePath, JSON.stringify(state, null, 2), 'utf-8');

      this.logger.debug(`[${this.name}] Wrote verify-active.json for Stop hook`);
    } catch (error) {
      // Non-fatal - log warning but don't fail verification
      this.logger.warn(`[${this.name}] Failed to write verify-active.json:`, error);
    }
  }

  /**
   * Clear verify-active.json after verification passes or max attempts reached.
   */
  private async clearVerifyActiveState(): Promise<void> {
    try {
      await fs.unlink(this.verifyActiveStatePath);
      this.logger.debug(`[${this.name}] Cleared verify-active.json`);
    } catch (error) {
      // File might not exist - that's fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`[${this.name}] Failed to clear verify-active.json:`, error);
      }
    }
  }
}

/**
 * Factory function for creating the shell verification stage.
 */
export function createShellVerificationStage(
  shellVerifyExecutor: ShellVerifyExecutor,
  logger: Logger,
  runtimeStateDir?: string
): ShellVerificationStage {
  return new ShellVerificationStage(shellVerifyExecutor, logger, runtimeStateDir);
}
