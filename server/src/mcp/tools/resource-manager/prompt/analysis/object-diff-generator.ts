// @lifecycle canonical - Generates unified text diffs for resource writes and version comparisons.

import { createPatch, formatPatch, structuredPatch } from 'diff';

import { serializeYaml } from '#shared/utils/yaml/yaml-parser.js';

/** Hunk type inferred from structuredPatch return */
type Hunk = ReturnType<typeof structuredPatch>['hunks'][number];

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
 * One file a write changes, as its content before and after.
 *
 * Paths use `/` and are relative to the resources root on each side. `previousPath` differs from
 * `path` only when a write reads a resource from one place and lands it in another — a category
 * move, or a copy up from the bundled tree into the writable root.
 */
export interface FileContentChange {
  /** Where the write lands, relative to the root it writes into. */
  path: string;
  /** Where the current content is read from, relative to the root it lives in. */
  previousPath: string;
  /** Current content, or null when the file does not exist before the write. */
  before: string | null;
  /** Content the write leaves, or null when the write deletes the file. */
  after: string | null;
}

function noChanges(): DiffResult {
  return {
    diff: '',
    stats: { additions: 0, deletions: 0, hunks: 0, truncated: false },
    hasChanges: false,
    formatted: '',
  };
}

/**
 * Service for generating unified text diffs between resource versions.
 *
 * Uses the `diff` package to create standard unified diffs that render
 * well in markdown with syntax highlighting.
 */
export class ObjectDiffGenerator {
  private static readonly DEFAULT_CONTEXT = 3;
  private static readonly DEFAULT_MAX_LINES = 50;

  /**
   * Generate a unified diff between two generic objects (gates, frameworks, etc.).
   *
   * @param before - Previous state (null for new resources)
   * @param after - New state
   * @param filename - Filename to use in diff header (e.g., 'gate.yaml')
   * @param config - Optional diff configuration
   * @returns Complete diff result with stats and formatted output
   */
  generateObjectDiff(
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    filename: string,
    config?: DiffConfig
  ): DiffResult {
    const context = config?.context ?? ObjectDiffGenerator.DEFAULT_CONTEXT;
    const maxLines = config?.maxLines ?? ObjectDiffGenerator.DEFAULT_MAX_LINES;

    try {
      const beforeContent = before !== null ? serializeYaml(before, { sortKeys: false }) : '';
      const afterContent = serializeYaml(after, { sortKeys: false });

      const patch = structuredPatch(
        `a/${filename}`,
        `b/${filename}`,
        beforeContent,
        afterContent,
        'before',
        'after',
        { context }
      );

      if (patch.hunks.length === 0) {
        return noChanges();
      }

      const stats = this.calculateStats(patch.hunks);
      const diffString = createPatch(filename, beforeContent, afterContent, 'before', 'after', {
        context,
      });

      const {
        result: truncatedDiff,
        truncated,
        totalLines,
      } = this.truncateDiff(diffString, maxLines);

      const fullStats = { ...stats, truncated, totalLines: truncated ? totalLines : undefined };
      return {
        diff: truncatedDiff,
        stats: fullStats,
        hasChanges: true,
        formatted: this.formatForResponse(truncatedDiff, fullStats, maxLines),
      };
    } catch (_error) {
      // On serialization/diff errors, return empty result (update still succeeds)
      return noChanges();
    }
  }

  /**
   * Generate one unified diff across the files a write changes.
   *
   * Each file is diffed as the bytes it holds, so the result reads as the write itself: a created
   * file is diffed from `/dev/null`, a deleted one to it, and a file the write leaves
   * byte-identical is omitted. Nothing is re-serialized, which is what lets a reader apply the
   * diff to the files as they are and get the files as they will be.
   *
   * No catch: the inputs are strings, so a failure here is a defect, and a preview that swallowed
   * it would report "no changes" for a write that has some.
   */
  generateFileChangeDiff(changes: readonly FileContentChange[], config?: DiffConfig): DiffResult {
    const context = config?.context ?? ObjectDiffGenerator.DEFAULT_CONTEXT;
    const maxLines = config?.maxLines ?? ObjectDiffGenerator.DEFAULT_MAX_LINES;

    const patches: string[] = [];
    const totals = { additions: 0, deletions: 0, hunks: 0 };
    for (const change of changes) {
      const patch = structuredPatch(
        change.before === null ? '/dev/null' : `a/${change.previousPath}`,
        change.after === null ? '/dev/null' : `b/${change.path}`,
        change.before ?? '',
        change.after ?? '',
        undefined,
        undefined,
        { context }
      );
      if (patch.hunks.length === 0) continue;

      const stats = this.calculateStats(patch.hunks);
      totals.additions += stats.additions;
      totals.deletions += stats.deletions;
      totals.hunks += stats.hunks;
      patches.push(formatPatch(patch));
    }

    if (patches.length === 0) {
      return noChanges();
    }

    const { result: diff, truncated, totalLines } = this.truncateDiff(patches.join(''), maxLines);
    const stats: DiffStats = {
      ...totals,
      truncated,
      totalLines: truncated ? totalLines : undefined,
    };
    return {
      diff,
      stats,
      hasChanges: true,
      formatted: this.formatForResponse(diff, stats, maxLines),
    };
  }

  /**
   * Calculate addition/deletion stats from diff hunks.
   */
  private calculateStats(hunks: Hunk[]): Omit<DiffStats, 'truncated' | 'totalLines'> {
    let additions = 0;
    let deletions = 0;

    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
    }

    return { additions, deletions, hunks: hunks.length };
  }

  /**
   * Truncate diff to maxLines, keeping first and last portions.
   */
  private truncateDiff(
    diff: string,
    maxLines: number
  ): { result: string; truncated: boolean; totalLines: number } {
    const lines = diff.split('\n');
    if (lines.length <= maxLines) {
      return { result: diff, truncated: false, totalLines: lines.length };
    }

    const half = Math.floor(maxLines / 2);
    const firstPart = lines.slice(0, half);
    const lastPart = lines.slice(-half);
    const omitted = lines.length - maxLines;

    return {
      result: [...firstPart, `... (${omitted} lines omitted) ...`, ...lastPart].join('\n'),
      truncated: true,
      totalLines: lines.length,
    };
  }

  /**
   * Format diff for MCP response with markdown.
   */
  private formatForResponse(diff: string, stats: DiffStats, maxLines: number): string {
    const parts: string[] = [];

    parts.push(`**Changes**: +${stats.additions} additions, -${stats.deletions} deletions`);

    if (stats.truncated && stats.totalLines !== undefined && stats.totalLines > 0) {
      parts.push(`*(Showing ${maxLines} of ${stats.totalLines} lines)*`);
    }

    parts.push('');
    parts.push('```diff');
    parts.push(diff);
    parts.push('```');

    return parts.join('\n');
  }
}
