// @lifecycle canonical - State file management for Stop hook integration.
/**
 * Verify Active State Manager
 *
 * Manages the verify-active.json state file used for Stop hook integration.
 * This file enables autonomous loops where the Stop hook reads verification
 * config and blocks Claude from stopping until verification passes.
 *
 * Extracted from ShellVerificationStage to maintain orchestration layer limits.
 */

import fs from 'fs/promises';
import path from 'path';

import { SHELL_VERIFY_DEFAULT_MAX_ITERATIONS } from './types.js';

import type { PendingShellVerification, VerifyActiveState } from './types.js';
import type { Logger } from '../../logging/index.js';

/**
 * Configuration for the state manager.
 */
export interface VerifyActiveStateManagerConfig {
  /** Directory for runtime state files (required - no default) */
  runtimeStateDir: string;
}

/**
 * Manages verify-active.json for Stop hook coordination.
 *
 * When loop mode is enabled (`:: verify:"cmd" loop:true`), this manager
 * writes state that the Stop hook reads to determine if Claude should
 * be allowed to stop or must continue trying.
 */
export class VerifyActiveStateManager {
  private readonly runtimeStateDir: string;
  private readonly logger: Logger;

  constructor(logger: Logger, config: VerifyActiveStateManagerConfig) {
    this.logger = logger;
    this.runtimeStateDir = config.runtimeStateDir;
  }

  /**
   * Get the path to verify-active.json.
   */
  get statePath(): string {
    return path.join(this.runtimeStateDir, 'verify-active.json');
  }

  /**
   * Write verify-active.json for Stop hook integration.
   *
   * Called when loop mode is enabled. The Stop hook reads this file
   * to determine if verification is pending and whether to block stop.
   *
   * @param sessionId - Chain session ID for tracking
   * @param pending - Current pending verification state
   */
  async writeState(sessionId: string, pending: PendingShellVerification): Promise<void> {
    const { shellVerify } = pending;

    const state: VerifyActiveState = {
      sessionId,
      config: {
        command: shellVerify.command,
        timeout: shellVerify.timeout ?? 300000,
        maxIterations: shellVerify.maxIterations ?? SHELL_VERIFY_DEFAULT_MAX_ITERATIONS,
        workingDir: shellVerify.workingDir,
        preset: shellVerify.preset,
        originalGoal: pending.originalGoal,
      },
      state: {
        iteration: pending.attemptCount,
        lastResult: pending.previousResults[pending.previousResults.length - 1] ?? null,
        startedAt: new Date().toISOString(),
      },
    };

    try {
      await fs.mkdir(this.runtimeStateDir, { recursive: true });
      await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
      this.logger.debug('[VerifyActiveStateManager] Wrote verify-active.json for Stop hook');
    } catch (error) {
      // Non-fatal - log warning but don't fail verification
      this.logger.warn('[VerifyActiveStateManager] Failed to write verify-active.json:', error);
    }
  }

  /**
   * Clear verify-active.json after verification completes.
   *
   * Called when:
   * - Verification passes (exit 0)
   * - Max attempts reached (Stop hook shouldn't keep trying)
   * - User chooses skip/abort
   */
  async clearState(): Promise<void> {
    try {
      await fs.unlink(this.statePath);
      this.logger.debug('[VerifyActiveStateManager] Cleared verify-active.json');
    } catch (error) {
      // File might not exist - that's fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('[VerifyActiveStateManager] Failed to clear verify-active.json:', error);
      }
    }
  }

  /**
   * Read current verify-active state (for Stop hook use).
   *
   * @returns The current state, or null if no active verification
   */
  async readState(): Promise<VerifyActiveState | null> {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(content) as VerifyActiveState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      this.logger.warn('[VerifyActiveStateManager] Failed to read verify-active.json:', error);
      return null;
    }
  }

  /**
   * Check if there's an active verification pending.
   */
  async hasActiveVerification(): Promise<boolean> {
    const state = await this.readState();
    return state !== null;
  }
}

/**
 * Factory function for creating the state manager.
 */
export function createVerifyActiveStateManager(
  logger: Logger,
  config: VerifyActiveStateManagerConfig
): VerifyActiveStateManager {
  return new VerifyActiveStateManager(logger, config);
}
