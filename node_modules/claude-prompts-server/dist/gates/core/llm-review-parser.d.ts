/**
 * LLM Review Parser
 *
 * Extracts explicit pass/fail confirmations from LLM self-review responses.
 * Supports both explicit "GATE_REVIEW: PASS/FAIL" markers and implicit phrasing.
 */
export type LLMReviewDecision = 'pass' | 'fail' | 'unknown';
export interface LLMReviewParseResult {
    decision: LLMReviewDecision;
    reasoning: string;
    confidence: number;
    matchType: 'explicit' | 'implicit' | 'unknown';
}
/**
 * Parse an LLM self-review response and extract decision/reasoning.
 */
export declare function parseLLMReview(response: string | null | undefined): LLMReviewParseResult;
