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
export declare class DiagnosticAccumulator {
    private readonly entries;
    private readonly logger;
    constructor(logger: Logger);
    /**
     * Add a diagnostic entry.
     */
    add(level: DiagnosticEntry['level'], stage: string, message: string, options?: {
        code?: string;
        context?: Record<string, unknown>;
    }): void;
    /**
     * Add a warning diagnostic.
     */
    warn(stage: string, message: string, context?: Record<string, unknown>): void;
    /**
     * Add an error diagnostic.
     */
    error(stage: string, message: string, code?: string, context?: Record<string, unknown>): void;
    /**
     * Add an info diagnostic.
     */
    info(stage: string, message: string, context?: Record<string, unknown>): void;
    /**
     * Add a debug diagnostic.
     */
    debug(stage: string, message: string, context?: Record<string, unknown>): void;
    /**
     * Get all diagnostics.
     */
    getAll(): readonly DiagnosticEntry[];
    /**
     * Get diagnostics filtered by level.
     */
    getByLevel(level: DiagnosticEntry['level']): readonly DiagnosticEntry[];
    /**
     * Get diagnostics filtered by stage.
     */
    getByStage(stage: string): readonly DiagnosticEntry[];
    /**
     * Check if there are any errors.
     */
    hasErrors(): boolean;
    /**
     * Check if there are any warnings.
     */
    hasWarnings(): boolean;
    /**
     * Get summary counts by level.
     */
    getSummary(): DiagnosticLevelCounts;
    /**
     * Clear all diagnostics.
     */
    clear(): void;
    /**
     * Get total count.
     */
    get size(): number;
}
