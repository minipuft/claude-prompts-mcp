// @lifecycle canonical - Collects diagnostics from all pipeline stages.

import type { Logger } from '../../../../logging/index.js';
import type { DiagnosticEntry, DiagnosticLevelCounts } from '../types.js';

/**
 * Collects diagnostics (warnings, errors, info) from all pipeline stages.
 * Useful for debugging, auditing, and user feedback.
 *
 * @example
 * ```typescript
 * // In a pipeline stage
 * context.diagnostics.warn('GateEnhancement', 'No gates configured for prompt');
 * context.diagnostics.error('FrameworkStage', 'Invalid framework ID', 'INVALID_FW');
 *
 * // Check for issues
 * if (context.diagnostics.hasErrors()) {
 *   // handle errors
 * }
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
   * Get all diagnostics.
   */
  getAll(): readonly DiagnosticEntry[] {
    return [...this.entries];
  }

  /**
   * Get diagnostics filtered by level.
   */
  getByLevel(level: DiagnosticEntry['level']): readonly DiagnosticEntry[] {
    return this.entries.filter((e) => e.level === level);
  }

  /**
   * Get diagnostics filtered by stage.
   */
  getByStage(stage: string): readonly DiagnosticEntry[] {
    return this.entries.filter((e) => e.stage === stage);
  }

  /**
   * Check if there are any errors.
   */
  hasErrors(): boolean {
    return this.entries.some((e) => e.level === 'error');
  }

  /**
   * Check if there are any warnings.
   */
  hasWarnings(): boolean {
    return this.entries.some((e) => e.level === 'warning');
  }

  /**
   * Get summary counts by level.
   */
  getSummary(): DiagnosticLevelCounts {
    return {
      error: this.getByLevel('error').length,
      warning: this.getByLevel('warning').length,
      info: this.getByLevel('info').length,
      debug: this.getByLevel('debug').length,
    };
  }

  /**
   * Clear all diagnostics.
   */
  clear(): void {
    this.entries.length = 0;
  }

  /**
   * Get total count.
   */
  get size(): number {
    return this.entries.length;
  }
}
