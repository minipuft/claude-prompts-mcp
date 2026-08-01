// @lifecycle canonical - State file management for Stop hook integration.
/**
 * Verify Active State Store
 *
 * Manages the verify-state.db SQLite database for Stop hook integration.
 * This enables autonomous loops where the Stop hook reads verification
 * config and blocks Claude from stopping until verification passes.
 *
 * Uses a standalone SQLite database (not the main state.db) so Python
 * hooks can read it independently without going through the Node.js process.
 *
 * Implementation: node:sqlite (DatabaseSync) — file-backed natively,
 * WAL mode for concurrent reader access, no WASM or manual persist().
 *
 * Extracted from ShellVerificationStage to maintain orchestration layer limits.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { SHELL_VERIFY_DEFAULT_MAX_ITERATIONS } from './types.js';

import type { Logger } from '#infra/logging/index.js';
import type { PendingShellVerification, VerifyActiveState } from './types.js';

/**
 * Configuration for the state store.
 */
export interface VerifyActiveStateStoreConfig {
  /** Directory for runtime state files (required - no default) */
  runtimeStateDir: string;
}

/**
 * Manages verify-state.db for Stop hook coordination.
 *
 * When loop mode is enabled (`:: verify:"cmd" loop:true`), this store
 * writes state that the Stop hook reads to determine if Claude should
 * be allowed to stop or must continue trying.
 */
export class VerifyActiveStateStore {
  private readonly runtimeStateDir: string;
  private readonly logger: Logger;

  constructor(logger: Logger, config: VerifyActiveStateStoreConfig) {
    this.logger = logger;
    this.runtimeStateDir = config.runtimeStateDir;
  }

  /**
   * Get the path to verify-state.db.
   */
  get stateDbPath(): string {
    return path.join(this.runtimeStateDir, 'verify-state.db');
  }

  /**
   * Write verify-active state for Stop hook integration.
   *
   * Called when loop mode is enabled. The Stop hook reads this state
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
      this.withDb((db) => {
        const stmt = db.prepare(
          `INSERT OR REPLACE INTO verify_active_state (session_id, state_json, updated_at)
           VALUES (?, ?, ?)`
        );
        stmt.run(sessionId, JSON.stringify(state), new Date().toISOString());
      });
      this.logger.debug('[VerifyActiveStateStore] Wrote verify-state.db row for Stop hook');
    } catch (error) {
      // Non-fatal - log warning but don't fail verification
      this.logger.warn('[VerifyActiveStateStore] Failed to write verify-state.db:', error);
    }
  }

  /**
   * Clear verify-active state after verification completes.
   *
   * Called when:
   * - Verification passes (exit 0)
   * - Max attempts reached (Stop hook shouldn't keep trying)
   * - User chooses skip/abort
   */
  async clearState(sessionId?: string): Promise<void> {
    try {
      this.withDb((db) => {
        if (sessionId !== undefined) {
          db.prepare('DELETE FROM verify_active_state WHERE session_id = ?').run(sessionId);
        } else {
          db.exec('DELETE FROM verify_active_state');
        }
      });
      this.logger.debug('[VerifyActiveStateStore] Cleared verify-state.db row');
    } catch (error) {
      this.logger.warn('[VerifyActiveStateStore] Failed to clear verify-state.db:', error);
    }
  }

  /**
   * Read current verify-active state (for Stop hook use).
   *
   * @returns The current state, or null if no active verification
   */
  async readState(sessionId?: string): Promise<VerifyActiveState | null> {
    try {
      return this.withDb((db) => {
        const row =
          sessionId !== undefined
            ? db
                .prepare('SELECT state_json FROM verify_active_state WHERE session_id = ?')
                .get(sessionId)
            : db.prepare('SELECT state_json FROM verify_active_state LIMIT 1').get();

        if (row === undefined) {
          return null;
        }

        const raw = (row as Record<string, unknown>)['state_json'];
        if (typeof raw !== 'string' || raw.trim() === '') {
          return null;
        }
        return JSON.parse(raw) as VerifyActiveState;
      });
    } catch (error) {
      this.logger.warn('[VerifyActiveStateStore] Failed to read verify-state.db:', error);
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

  // === Private: SQLite helpers ===

  /**
   * Open database, run operation, close. File-backed natively via DatabaseSync —
   * no export/persist step needed. WAL mode enables concurrent reader access
   * from Python hooks.
   */
  private withDb<T>(operation: (db: DatabaseSync) => T): T {
    fs.mkdirSync(this.runtimeStateDir, { recursive: true });

    const db = new DatabaseSync(this.stateDbPath);
    db.exec('PRAGMA journal_mode=WAL');
    this.ensureSchema(db);

    try {
      return operation(db);
    } finally {
      db.close();
    }
  }

  private ensureSchema(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS verify_active_state (
        session_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
}

/**
 * Factory function for creating the state store.
 */
export function createVerifyActiveStateStore(
  logger: Logger,
  config: VerifyActiveStateStoreConfig
): VerifyActiveStateStore {
  return new VerifyActiveStateStore(logger, config);
}
