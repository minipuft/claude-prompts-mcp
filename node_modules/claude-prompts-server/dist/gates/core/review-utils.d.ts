import { parseLLMReview } from './llm-review-parser.js';
import type { GateReviewPrompt } from '../../execution/types.js';
export interface ReviewPromptTimestamps {
    createdAt?: number;
    updatedAt?: number;
    previousResponseAt?: number;
}
export interface ComposedReviewPrompt {
    combinedPrompt: string;
    gateIds: string[];
    instructions: string[];
    prompts: GateReviewPrompt[];
    createdAt: number;
    metadata: {
        previousResponse?: string;
        retryHints: string[];
        timestamps?: ReviewPromptTimestamps;
    };
}
/**
 * Build a deduplicated list of explicit review instructions pulled from gate prompts.
 * Falls back to the default instruction set when gates omit their own directives.
 */
export declare function buildReviewInstructions(prompts: GateReviewPrompt[]): string[];
/**
 * Compose a unified markdown prompt covering every gate review request.
 */
export declare function composeReviewPrompt(prompts: GateReviewPrompt[], previousResponse?: string, retryHints?: string[], timestamps?: ReviewPromptTimestamps): ComposedReviewPrompt;
export { parseLLMReview };
