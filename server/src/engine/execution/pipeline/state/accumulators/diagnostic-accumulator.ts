// @lifecycle canonical - Collects diagnostics from all pipeline stages.

import type { Logger } from '#infra/logging/index.js';
import type { DiagnosticEntry } from '../types.js';

/**
 * Collects diagnostics (warnings, errors, info) from all pipeline stages and forwards
 * each one to the system logger.
 *
 * The in-memory `entries` list has no reader in production (P4.52 deleted the read-side
 * query API — `getAll`/`getByStage`/`getSummary`/`hasErrors`/`hasWarnings`/`clear` — since
 * nothing consumed it); `add()`/`warn()`/`error()`/`info()`/`debug()` stay because the
 * logger call inside `add()` is a real production side effect. A future consumer that
 * needs to read diagnostics back writes the query it needs.
 *
 * @example
 * ```typescript
 * // In a pipeline stage
 * context.diagnostics.warn('GateEnhancement', 'No gates configured for prompt');
 * context.diagnostics.error('FrameworkStage', 'Invalid framework ID', 'INVALID_FW');
 * ```
 */
export class DiagnosticAccumulator {
  private readonly entries: DiagnosticEntry[] = [];
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Add a diagnostic entry.
   */
  add(
    level: DiagnosticEntry['level'],
    stage: string,
    message: string,
    options?: { code?: string; context?: Record<string, unknown> }
  ): void {
    const entry: DiagnosticEntry = {
      level,
      stage,
      message,
      timestamp: Date.now(),
      ...(options?.code !== undefined ? { code: options.code } : {}),
      ...(options?.context !== undefined ? { context: options.context } : {}),
    };

    this.entries.push(entry);

    // Also log to system logger for observability
    const logPayload = options?.context ?? {};
    switch (level) {
      case 'error':
        this.logger.error(`[${stage}] ${message}`, logPayload);
        break;
      case 'warning':
        this.logger.warn(`[${stage}] ${message}`, logPayload);
        break;
      case 'info':
        this.logger.info(`[${stage}] ${message}`, logPayload);
        break;
      default:
        this.logger.debug(`[${stage}] ${message}`, logPayload);
    }
  }

  /**
   * Add a warning diagnostic.
   */
  warn(stage: string, message: string, context?: Record<string, unknown>): void {
    const options = context !== undefined ? { context } : undefined;
    this.add('warning', stage, message, options);
  }

  /**
   * Add an error diagnostic.
   */
  error(stage: string, message: string, code?: string, context?: Record<string, unknown>): void {
    const options =
      code !== undefined || context !== undefined
        ? { ...(code !== undefined ? { code } : {}), ...(context !== undefined ? { context } : {}) }
        : undefined;
    this.add('error', stage, message, options);
  }

  /**
   * Add an info diagnostic.
   */
  info(stage: string, message: string, context?: Record<string, unknown>): void {
    const options = context !== undefined ? { context } : undefined;
    this.add('info', stage, message, options);
  }

  /**
   * Add a debug diagnostic.
   */
  debug(stage: string, message: string, context?: Record<string, unknown>): void {
    const options = context !== undefined ? { context } : undefined;
    this.add('debug', stage, message, options);
  }

  /**
   * Get total count.
   */
  get size(): number {
    return this.entries.length;
  }
}
