// @lifecycle canonical - Generates unified text diffs for prompt updates.
import { createPatch, structuredPatch } from 'diff';
import { serializeYaml } from '../../../utils/yaml/yaml-parser.js';
/**
 * Service for generating unified text diffs between resource versions.
 *
 * Uses the `diff` package to create standard unified diffs that render
 * well in markdown with syntax highlighting.
 */
export class TextDiffService {
    /**
     * Generate a unified diff between two generic objects (gates, methodologies, etc.).
     *
     * @param before - Previous state (null for new resources)
     * @param after - New state
     * @param filename - Filename to use in diff header (e.g., 'gate.yaml')
     * @param config - Optional diff configuration
     * @returns Complete diff result with stats and formatted output
     */
    generateObjectDiff(before, after, filename, config) {
        const context = config?.context ?? TextDiffService.DEFAULT_CONTEXT;
        const maxLines = config?.maxLines ?? TextDiffService.DEFAULT_MAX_LINES;
        try {
            const beforeContent = before !== null ? serializeYaml(before, { sortKeys: false }) : '';
            const afterContent = serializeYaml(after, { sortKeys: false });
            const patch = structuredPatch(`a/${filename}`, `b/${filename}`, beforeContent, afterContent, 'before', 'after', { context });
            if (patch.hunks.length === 0) {
                return {
                    diff: '',
                    stats: { additions: 0, deletions: 0, hunks: 0, truncated: false },
                    hasChanges: false,
                    formatted: '',
                };
            }
            const stats = this.calculateStats(patch.hunks);
            const diffString = createPatch(filename, beforeContent, afterContent, 'before', 'after', {
                context,
            });
            const { result: truncatedDiff, truncated, totalLines, } = this.truncateDiff(diffString, maxLines);
            return {
                diff: truncatedDiff,
                stats: { ...stats, truncated, totalLines: truncated ? totalLines : undefined },
                hasChanges: true,
                formatted: this.formatForResponse(truncatedDiff, {
                    ...stats,
                    truncated,
                    totalLines: truncated ? totalLines : undefined,
                }),
            };
        }
        catch (_error) {
            // On serialization/diff errors, return empty result (update still succeeds)
            return {
                diff: '',
                stats: { additions: 0, deletions: 0, hunks: 0, truncated: false },
                hasChanges: false,
                formatted: '',
            };
        }
    }
    /**
     * Generate a unified diff between two prompt versions.
     *
     * @param before - Previous prompt state (null for new prompts)
     * @param after - New prompt state
     * @param config - Optional diff configuration
     * @returns Complete diff result with stats and formatted output
     */
    generatePromptDiff(before, after, config) {
        const context = config?.context ?? TextDiffService.DEFAULT_CONTEXT;
        const maxLines = config?.maxLines ?? TextDiffService.DEFAULT_MAX_LINES;
        try {
            const beforeContent = before !== null ? this.serializePromptContent(before) : '';
            const afterContent = this.serializePromptContent(after);
            const promptId = after.id ?? 'prompt';
            const patch = structuredPatch(`a/${promptId}.yaml`, `b/${promptId}.yaml`, beforeContent, afterContent, 'before', 'after', { context });
            if (patch.hunks.length === 0) {
                return {
                    diff: '',
                    stats: { additions: 0, deletions: 0, hunks: 0, truncated: false },
                    hasChanges: false,
                    formatted: '',
                };
            }
            const stats = this.calculateStats(patch.hunks);
            const diffString = createPatch(`${promptId}.yaml`, beforeContent, afterContent, 'before', 'after', { context });
            const { result: truncatedDiff, truncated, totalLines, } = this.truncateDiff(diffString, maxLines);
            return {
                diff: truncatedDiff,
                stats: { ...stats, truncated, totalLines: truncated ? totalLines : undefined },
                hasChanges: true,
                formatted: this.formatForResponse(truncatedDiff, {
                    ...stats,
                    truncated,
                    totalLines: truncated ? totalLines : undefined,
                }),
            };
        }
        catch (_error) {
            // On serialization/diff errors, return empty result (update still succeeds)
            return {
                diff: '',
                stats: { additions: 0, deletions: 0, hunks: 0, truncated: false },
                hasChanges: false,
                formatted: '',
            };
        }
    }
    /**
     * Serialize prompt content to canonical YAML for consistent diffing.
     */
    serializePromptContent(prompt) {
        const content = {};
        // Order fields consistently for readable diffs (bracket notation for index signature)
        // Use explicit checks per strict-boolean-expressions rule
        if (prompt.name !== undefined && prompt.name !== '')
            content['name'] = prompt.name;
        if (prompt.category !== undefined && prompt.category !== '')
            content['category'] = prompt.category;
        if (prompt.description !== undefined && prompt.description !== '')
            content['description'] = prompt.description;
        if (prompt.systemMessage !== undefined && prompt.systemMessage !== '')
            content['systemMessage'] = prompt.systemMessage;
        if (prompt.userMessageTemplate !== undefined && prompt.userMessageTemplate !== '')
            content['userMessageTemplate'] = prompt.userMessageTemplate;
        if (prompt.arguments !== undefined && prompt.arguments.length > 0)
            content['arguments'] = prompt.arguments;
        if (prompt.gateConfiguration !== undefined)
            content['gateConfiguration'] = prompt.gateConfiguration;
        if (prompt.chainSteps !== undefined && prompt.chainSteps.length > 0)
            content['chainSteps'] = prompt.chainSteps;
        return serializeYaml(content, { sortKeys: false, lineWidth: 100 });
    }
    /**
     * Calculate addition/deletion stats from diff hunks.
     */
    calculateStats(hunks) {
        let additions = 0;
        let deletions = 0;
        for (const hunk of hunks) {
            for (const line of hunk.lines) {
                if (line.startsWith('+') && !line.startsWith('+++'))
                    additions++;
                if (line.startsWith('-') && !line.startsWith('---'))
                    deletions++;
            }
        }
        return { additions, deletions, hunks: hunks.length };
    }
    /**
     * Truncate diff to maxLines, keeping first and last portions.
     */
    truncateDiff(diff, maxLines) {
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
    formatForResponse(diff, stats) {
        const parts = [];
        parts.push(`**Changes**: +${stats.additions} additions, -${stats.deletions} deletions`);
        if (stats.truncated && stats.totalLines !== undefined && stats.totalLines > 0) {
            parts.push(`*(Showing ${TextDiffService.DEFAULT_MAX_LINES} of ${stats.totalLines} lines)*`);
        }
        parts.push('');
        parts.push('```diff');
        parts.push(diff);
        parts.push('```');
        return parts.join('\n');
    }
}
TextDiffService.DEFAULT_CONTEXT = 3;
TextDiffService.DEFAULT_MAX_LINES = 50;
//# sourceMappingURL=text-diff-service.js.map