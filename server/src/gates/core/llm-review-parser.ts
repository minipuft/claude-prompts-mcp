// @lifecycle canonical - Parses LLM self-review responses for gate decisions.
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

const EXPLICIT_REVIEW_REGEX = /GATE[_\s-]REVIEW\s*[:\-]\s*(PASS|FAIL)/i;

const IMPLICIT_PASS_PATTERNS: RegExp[] = [
  /\b(meets|satisfies|fulfills|addresses|covers)\b[^.]\b(criteria|requirements|gate)\b/i,
  /\b(confirm|confident)\b[^.]\b(criteria|requirements)\b[^.]\bmet\b/i,
  /\bpasses?\b[^.]\b(gate|review)\b/i,
];

const IMPLICIT_FAIL_PATTERNS: RegExp[] = [
  /\bdoes\s+not\b[^.]\b(meet|satisfy|address|cover)\b[^.]\b(criteria|requirements|gate)\b/i,
  /\bfails?\b[^.]\b(criteria|requirements|gate)\b/i,
  /\bmissing\b[^.]\b(criteria|requirements)\b/i,
  /\b(insufficient|incomplete)\b[^.]\b(detail|coverage|evidence)\b/i,
];

/**
 * Parse an LLM self-review response and extract decision/reasoning.
 */
export function parseLLMReview(response: string | null | undefined): LLMReviewParseResult {
  const normalized = (response ?? '').trim();

  if (!normalized) {
    return {
      decision: 'unknown',
      reasoning: '',
      confidence: 0,
      matchType: 'unknown',
    };
  }

  const explicitMatch = normalized.match(EXPLICIT_REVIEW_REGEX);
  if (explicitMatch?.index !== undefined && explicitMatch[1] !== undefined) {
    const [, decisionToken] = explicitMatch;
    const decision = decisionToken.toLowerCase() === 'pass' ? 'pass' : 'fail';
    const remainder = normalized.slice(explicitMatch.index + explicitMatch[0].length).trim();
    const reasoning = extractReasoningSnippet(remainder || normalized);

    return {
      decision,
      reasoning,
      confidence: 0.95,
      matchType: 'explicit',
    };
  }

  for (const pattern of IMPLICIT_FAIL_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.index !== undefined) {
      return {
        decision: 'fail',
        reasoning: extractReasoningSnippet(normalized, match.index),
        confidence: 0.65,
        matchType: 'implicit',
      };
    }
  }

  for (const pattern of IMPLICIT_PASS_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.index !== undefined) {
      return {
        decision: 'pass',
        reasoning: extractReasoningSnippet(normalized, match.index),
        confidence: 0.6,
        matchType: 'implicit',
      };
    }
  }

  return {
    decision: 'unknown',
    reasoning: extractReasoningSnippet(normalized),
    confidence: 0.4,
    matchType: 'unknown',
  };
}

function extractReasoningSnippet(text: string, startIndex = 0): string {
  const boundaries = findSentenceBoundaries(text, startIndex);
  const snippet = text.slice(boundaries.start, boundaries.end).trim();
  return snippet.length > 0 ? snippet : text.trim().slice(0, 200);
}

function findSentenceBoundaries(text: string, index: number): { start: number; end: number } {
  const normalizedIndex = Math.max(0, Math.min(index, text.length - 1));

  let start = text.lastIndexOf('.', normalizedIndex);
  start = start === -1 ? 0 : start + 1;

  let end = text.indexOf('.', normalizedIndex);
  end = end === -1 ? text.length : end + 1;

  return { start, end };
}
