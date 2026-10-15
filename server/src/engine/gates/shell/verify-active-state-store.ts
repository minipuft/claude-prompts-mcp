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

import { formatCommandForDisplay } from './shell-command-allowlist.js';
import { SHELL_VERIFY_DEFAULT_MAX_ITERATIONS } from './types.js';

import type { Logger } from '#infra/logging/index.js';
import type { PendingShellVerification, VerifyActiveState } from './types.js';

type RunBoundVerifyActiveState = VerifyActiveState & { runSessionId?: string };
type RunReleaseOutcome = 'released' | 'absent' | 'foreign' | 'unbound';

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
   * @param runSessionId - Exact internal run identity, separate from the active-state key
   */
  async writeState(
    sessionId: string,
    pending: PendingShellVerification,
    runSessionId?: string
  ): Promise<void> {
    const { shellVerify } = pending;

    const state: RunBoundVerifyActiveState = {
      sessionId,
      ...(runSessionId === undefined ? {} : { runSessionId }),
      config: {
        // Rendered, not raw: this file is read by the Python Stop hook, whose payload
        // contract declares a string. Widening it there would break a durable surface
        // for a value the hook only ever displays.
        command: formatCommandForDisplay(shellVerify.command),
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

    // Throws rather than swallowing: a write that silently failed here left the Stop hook
    // reading a stale or missing row while the pipeline reply claimed the loop was armed.
    // ShellVerificationStage does not catch this, so it reaches the pipeline's single error
    // boundary (PromptExecutionPipeline.executePipelineStages), which the prompt_engine tool
    // handler reports through the `:: verify` reply — matching the shape framework-state-store
    // (`enableFrameworkSystem`/`disableFrameworkSystem`) already applies to its own save.
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
      throw new Error(
        `Failed to arm verify-loop state for session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    }
  }

  /** Release only the active obligation bound to this exact internal run identity. */
  async releaseRunState(sessionId: string, runSessionId: string): Promise<RunReleaseOutcome> {
    if (sessionId.length === 0 || runSessionId.length === 0) {
      throw new Error('Verify-loop release requires a key and an internal run identity');
    }
    return this.withDb((db) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db
          .prepare('SELECT state_json FROM verify_active_state WHERE session_id = ?')
          .get(sessionId);
        const outcome =
          row === undefined ? 'absent' : this.classifyRunOwner(row['state_json'], runSessionId);
        if (outcome === 'released') {
          const result = db
            .prepare('DELETE FROM verify_active_state WHERE session_id = ? AND state_json = ?')
            .run(sessionId, row?.['state_json'] ?? null);
          if (result.changes !== 1) throw new Error('Verify-loop ownership changed during release');
        }
        db.exec('COMMIT');
        return outcome;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  private classifyRunOwner(stateJson: unknown, runSessionId: string): RunReleaseOutcome {
    if (typeof stateJson !== 'string') return 'unbound';
    let state: unknown;
    try {
      state = JSON.parse(stateJson);
    } catch {
      return 'unbound';
    }
    if (typeof state !== 'object' || state === null || !('runSessionId' in state)) {
      return 'unbound';
    }
    const owner = state.runSessionId;
    if (typeof owner !== 'string' || owner.length === 0) return 'unbound';
    return owner === runSessionId ? 'released' : 'foreign';
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
    // Throws for the same reason writeState above does: a clear that silently failed left
    // verify-state.db pointing at a stale iteration while the caller believed the loop had
    // ended (pass, escalation, or session teardown) — the Stop hook would keep blocking on a
    // verification the pipeline had already moved past.
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
      throw new Error(
        `Failed to clear verify-loop state${sessionId !== undefined ? ` for session ${sessionId}` : ''}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    }
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
