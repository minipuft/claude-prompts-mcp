// @lifecycle canonical - Validates {{ref:prompt_id}} references during prompt creation/update.
/**
 * Prompt Reference Validator
 *
 * Validates {{ref:prompt_id}} template references at creation time to prevent:
 * - Self-references (prompt referencing itself)
 * - Missing references (referencing non-existent prompts)
 * - Circular reference chains (A → B → A)
 *
 * This is a strict validator - all referenced prompts must exist.
 */
/**
 * Regex pattern to match {{ref:prompt_id}} references.
 * Matches alphanumeric IDs with underscores and hyphens.
 */
const REFERENCE_PATTERN = /\{\{ref:([a-zA-Z0-9_-]+)\}\}/g;
/**
 * Validates prompt references before creation/update.
 *
 * Used by ConsolidatedPromptManager to ensure prompts don't contain
 * invalid references before writing to disk.
 */
export class PromptReferenceValidator {
    constructor(existingPrompts) {
        this.existingPrompts = existingPrompts;
    }
    /**
     * Validate a prompt's template for reference errors.
     *
     * @param promptId - ID of the prompt being created/updated
     * @param template - The user message template content
     * @param systemMessage - Optional system message to also validate
     * @returns Validation result with any errors
     */
    validate(promptId, template, systemMessage) {
        const errors = [];
        // Combine templates for validation
        const fullContent = systemMessage !== undefined && systemMessage !== ''
            ? `${template}\n${systemMessage}`
            : template;
        // 1. Detect all references in the template
        const references = this.detectReferences(fullContent);
        if (references.length === 0) {
            return { valid: true, errors: [] };
        }
        // 2. Check for self-reference
        if (references.includes(promptId)) {
            errors.push({
                type: 'self_reference',
                promptId,
                details: `Prompt '${promptId}' contains {{ref:${promptId}}} which references itself`,
            });
        }
        // 3. Check for missing references (strict mode)
        for (const refId of references) {
            if (refId !== promptId && !this.promptExists(refId)) {
                errors.push({
                    type: 'missing_reference',
                    promptId: refId,
                    details: `Referenced prompt '${refId}' does not exist`,
                });
            }
        }
        // 4. Check for circular reference chains (only if no missing or self references)
        // Skip cycle detection if references are missing or self-referencing - they would fail anyway
        const hasSelfRef = errors.some((e) => e.type === 'self_reference');
        const hasMissingRefs = errors.some((e) => e.type === 'missing_reference');
        if (!hasSelfRef && !hasMissingRefs) {
            const cycle = this.detectCircularChain(promptId, references);
            if (cycle !== null) {
                errors.push({
                    type: 'circular_reference',
                    promptId,
                    details: `Circular reference detected: ${cycle.join(' → ')}`,
                    chain: cycle,
                });
            }
        }
        return {
            valid: errors.length === 0,
            errors,
        };
    }
    /**
     * Detect all {{ref:...}} patterns in a template.
     * Returns unique prompt IDs found.
     */
    detectReferences(template) {
        const refs = [];
        let match;
        // Reset regex state
        REFERENCE_PATTERN.lastIndex = 0;
        while ((match = REFERENCE_PATTERN.exec(template)) !== null) {
            const promptId = match[1];
            if (promptId !== undefined && promptId !== '' && !refs.includes(promptId)) {
                refs.push(promptId);
            }
        }
        return refs;
    }
    /**
     * Check if a prompt exists in the registry.
     */
    promptExists(id) {
        return this.existingPrompts.some((p) => p.id === id);
    }
    /**
     * Get a prompt's template references (for cycle detection).
     */
    getPromptReferences(id) {
        const prompt = this.existingPrompts.find((p) => p.id === id);
        if (prompt === undefined)
            return [];
        // Check both user message and system message
        let content = prompt.userMessageTemplate;
        if (prompt.systemMessage !== undefined && prompt.systemMessage !== '') {
            content += '\n' + prompt.systemMessage;
        }
        return this.detectReferences(content);
    }
    /**
     * Detect circular reference chains using DFS.
     *
     * Builds a reference graph starting from the new prompt and checks
     * if adding it would create a cycle.
     *
     * @param startId - ID of the prompt being created
     * @param newRefs - References found in the new prompt's template
     * @returns The cycle path if found, null otherwise
     */
    detectCircularChain(startId, newRefs) {
        // Use DFS with path tracking
        const visited = new Set();
        const path = [startId];
        const dfs = (currentId) => {
            // Get references for current prompt
            // For the start prompt, use the new references; for others, look up existing
            const refs = currentId === startId ? newRefs : this.getPromptReferences(currentId);
            for (const refId of refs) {
                // Check if this creates a cycle back to start
                if (refId === startId) {
                    return [...path, refId];
                }
                // Check if we've seen this in current path (shouldn't happen with existing prompts)
                if (path.includes(refId)) {
                    return [...path, refId];
                }
                // Skip if already fully visited (no cycle through this node)
                if (visited.has(refId)) {
                    continue;
                }
                // Recurse
                path.push(refId);
                const cycle = dfs(refId);
                if (cycle !== null) {
                    return cycle;
                }
                path.pop();
            }
            visited.add(currentId);
            return null;
        };
        return dfs(startId);
    }
}
//# sourceMappingURL=prompt-reference-validator.js.map