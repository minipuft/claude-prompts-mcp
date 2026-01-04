import type { ConvertedPrompt } from '../../../execution/types.js';
/**
 * Configuration for diff generation
 */
export interface DiffConfig {
    /** Number of context lines around changes (default: 3) */
    context?: number;
    /** Maximum lines before truncation (default: 50) */
    maxLines?: number;
}
/**
 * Statistics about the diff
 */
export interface DiffStats {
    additions: number;
    deletions: number;
    hunks: number;
    truncated: boolean;
    totalLines?: number;
}
/**
 * Complete diff result with formatted output
 */
export interface DiffResult {
    /** Raw unified diff string */
    diff: string;
    /** Statistics about changes */
    stats: DiffStats;
    /** Whether any changes were detected */
    hasChanges: boolean;
    /** Formatted output ready for MCP response (includes markdown) */
    formatted: string;
}
/**
 * Service for generating unified text diffs between resource versions.
 *
 * Uses the `diff` package to create standard unified diffs that render
 * well in markdown with syntax highlighting.
 */
export declare class TextDiffService {
    private static readonly DEFAULT_CONTEXT;
    private static readonly DEFAULT_MAX_LINES;
    /**
     * Generate a unified diff between two generic objects (gates, methodologies, etc.).
     *
     * @param before - Previous state (null for new resources)
     * @param after - New state
     * @param filename - Filename to use in diff header (e.g., 'gate.yaml')
     * @param config - Optional diff configuration
     * @returns Complete diff result with stats and formatted output
     */
    generateObjectDiff(before: Record<string, unknown> | null, after: Record<string, unknown>, filename: string, config?: DiffConfig): DiffResult;
    /**
     * Generate a unified diff between two prompt versions.
     *
     * @param before - Previous prompt state (null for new prompts)
     * @param after - New prompt state
     * @param config - Optional diff configuration
     * @returns Complete diff result with stats and formatted output
     */
    generatePromptDiff(before: ConvertedPrompt | null, after: Partial<ConvertedPrompt>, config?: DiffConfig): DiffResult;
    /**
     * Serialize prompt content to canonical YAML for consistent diffing.
     */
    private serializePromptContent;
    /**
     * Calculate addition/deletion stats from diff hunks.
     */
    private calculateStats;
    /**
     * Truncate diff to maxLines, keeping first and last portions.
     */
    private truncateDiff;
    /**
     * Format diff for MCP response with markdown.
     */
    private formatForResponse;
}
