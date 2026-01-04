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
import type { ConvertedPrompt } from '../../types/index.js';
/**
 * Result of validating prompt references.
 */
export interface ReferenceValidationResult {
    /** Whether all references are valid */
    valid: boolean;
    /** Validation errors that block creation */
    errors: ReferenceValidationError[];
}
/**
 * A validation error that blocks prompt creation.
 */
export interface ReferenceValidationError {
    /** Type of validation failure */
    type: 'self_reference' | 'circular_reference' | 'missing_reference';
    /** The prompt ID involved in the error */
    promptId: string;
    /** Human-readable error description */
    details: string;
    /** For circular references: the full cycle path */
    chain?: string[];
}
/**
 * Validates prompt references before creation/update.
 *
 * Used by ConsolidatedPromptManager to ensure prompts don't contain
 * invalid references before writing to disk.
 */
export declare class PromptReferenceValidator {
    private readonly existingPrompts;
    constructor(existingPrompts: ConvertedPrompt[]);
    /**
     * Validate a prompt's template for reference errors.
     *
     * @param promptId - ID of the prompt being created/updated
     * @param template - The user message template content
     * @param systemMessage - Optional system message to also validate
     * @returns Validation result with any errors
     */
    validate(promptId: string, template: string, systemMessage?: string): ReferenceValidationResult;
    /**
     * Detect all {{ref:...}} patterns in a template.
     * Returns unique prompt IDs found.
     */
    private detectReferences;
    /**
     * Check if a prompt exists in the registry.
     */
    private promptExists;
    /**
     * Get a prompt's template references (for cycle detection).
     */
    private getPromptReferences;
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
    private detectCircularChain;
}
