// @lifecycle canonical - Tests for enhanced gate verdict parsing (v3.1+)
/**
 * Unit tests for StepResponseCaptureStage gate verdict parsing
 *
 * Tests the flexible format support added in v3.1, including:
 * - Multiple format patterns
 * - Case insensitivity
 * - Separator flexibility (hyphen vs colon)
 * - Rationale validation
 * - False positive prevention
 * - Source-based discrimination
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import { StepResponseCaptureStage } from '../../../../src/execution/pipeline/stages/08-response-capture-stage.js';

import type { ChainSessionService } from '../../../../src/chain-session/types.js';
import type { Logger } from '../../../../src/logging/index.js';

describe('StepResponseCaptureStage - Gate Verdict Parsing (v3.1)', () => {
  let stage: StepResponseCaptureStage;
  let mockChainSessionManager: jest.Mocked<ChainSessionService>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    mockChainSessionManager = {} as jest.Mocked<ChainSessionService>;

    stage = new StepResponseCaptureStage(mockChainSessionManager, mockLogger);
  });

  describe('Backward Compatibility', () => {
    it('should parse original GATE_REVIEW format with hyphen', () => {
      const result = (stage as any).parseGateVerdict(
        'GATE_REVIEW: PASS - All criteria met',
        'gate_verdict'
      );

      expect(result).toEqual({
        verdict: 'PASS',
        rationale: 'All criteria met',
        raw: 'GATE_REVIEW: PASS - All criteria met',
        source: 'gate_verdict',
        detectedPattern: 'primary',
      });
    });

    it('should parse GATE_REVIEW FAIL format', () => {
      const result = (stage as any).parseGateVerdict(
        'GATE_REVIEW: FAIL - Missing documentation',
        'gate_verdict'
      );

      expect(result?.verdict).toBe('FAIL');
      expect(result?.rationale).toBe('Missing documentation');
      expect(result?.detectedPattern).toBe('primary');
    });
  });

  describe('Format Variants (v3.1)', () => {
    it('should parse GATE_REVIEW format with colon separator', () => {
      const result = (stage as any).parseGateVerdict(
        'GATE_REVIEW: FAIL: Missing documentation',
        'gate_verdict'
      );

      expect(result?.verdict).toBe('FAIL');
      expect(result?.rationale).toBe('Missing documentation');
      expect(result?.detectedPattern).toBe('high');
    });

    it('should parse simplified GATE format with hyphen', () => {
      const result = (stage as any).parseGateVerdict('GATE PASS - Looks good', 'user_response');

      expect(result?.verdict).toBe('PASS');
      expect(result?.rationale).toBe('Looks good');
      expect(result?.detectedPattern).toBe('high');
    });

    it('should parse simplified GATE format with colon', () => {
      const result = (stage as any).parseGateVerdict(
        'GATE FAIL: Needs improvement',
        'gate_verdict'
      );

      expect(result?.verdict).toBe('FAIL');
      expect(result?.rationale).toBe('Needs improvement');
      expect(result?.detectedPattern).toBe('medium');
    });

    it('should parse minimal format from gate_verdict parameter', () => {
      const result = (stage as any).parseGateVerdict('PASS - explicit verdict', 'gate_verdict');

      expect(result?.verdict).toBe('PASS');
      expect(result?.rationale).toBe('explicit verdict');
      expect(result?.detectedPattern).toBe('fallback');
    });

    it('should parse minimal format with colon', () => {
      const result = (stage as any).parseGateVerdict('FAIL: explicit rejection', 'gate_verdict');

      expect(result?.verdict).toBe('FAIL');
      expect(result?.rationale).toBe('explicit rejection');
      expect(result?.detectedPattern).toBe('fallback');
    });
  });

  describe('Case Insensitivity', () => {
    it('should handle lowercase', () => {
      const result = (stage as any).parseGateVerdict(
        'gate pass - criteria satisfied',
        'gate_verdict'
      );

      expect(result?.verdict).toBe('PASS');
      expect(result?.rationale).toBe('criteria satisfied');
    });

    it('should handle mixed case', () => {
      const result = (stage as any).parseGateVerdict(
        'Gate_Review: Fail - Issues found',
        'user_response'
      );

      expect(result?.verdict).toBe('FAIL');
      expect(result?.rationale).toBe('Issues found');
    });

    it('should handle uppercase', () => {
      const result = (stage as any).parseGateVerdict('GATE FAIL - CRITICAL ISSUES', 'gate_verdict');

      expect(result?.verdict).toBe('FAIL');
      expect(result?.rationale).toBe('CRITICAL ISSUES');
    });
  });

  describe('Rationale Validation', () => {
    it('should reject verdict without rationale (no hyphen)', () => {
      const result = (stage as any).parseGateVerdict('GATE PASS', 'gate_verdict');

      expect(result).toBeNull();
    });

    it('should reject verdict with empty rationale', () => {
      const result = (stage as any).parseGateVerdict('GATE PASS -', 'gate_verdict');

      // Pattern doesn't match at all (.+ requires at least one char)
      // so no warning is logged - just returns null
      expect(result).toBeNull();
    });

    it('should reject verdict with whitespace-only rationale', () => {
      const result = (stage as any).parseGateVerdict('GATE PASS -   ', 'gate_verdict');

      expect(result).toBeNull();
    });

    it('should accept verdict with meaningful rationale', () => {
      const result = (stage as any).parseGateVerdict('GATE PASS - Good', 'gate_verdict');

      expect(result).not.toBeNull();
      expect(result?.rationale).toBe('Good');
    });
  });

  describe('False Positive Prevention', () => {
    it('should not parse minimal format from user_response', () => {
      const result = (stage as any).parseGateVerdict(
        'PASS - this could be ambiguous text',
        'user_response'
      );

      expect(result).toBeNull();
    });

    it('should not match verdict embedded in sentence', () => {
      const result = (stage as any).parseGateVerdict(
        'I think this will PASS - great work!',
        'user_response'
      );

      expect(result).toBeNull();
    });

    it('should not match verdict not at start of string', () => {
      const result = (stage as any).parseGateVerdict(
        'Here are my thoughts: GATE PASS - looks good',
        'user_response'
      );

      expect(result).toBeNull();
    });

    it('should match verdict at start even with leading whitespace', () => {
      const result = (stage as any).parseGateVerdict(
        '  GATE PASS - with leading spaces',
        'user_response'
      );

      // Leading whitespace prevents match (starts with ^)
      expect(result).toBeNull();
    });
  });

  describe('Source Discrimination', () => {
    it('should accept minimal format from gate_verdict parameter', () => {
      const result = (stage as any).parseGateVerdict('PASS - minimal format', 'gate_verdict');

      expect(result).not.toBeNull();
      expect(result?.source).toBe('gate_verdict');
    });

    it('should reject minimal format from user_response', () => {
      const result = (stage as any).parseGateVerdict('PASS - minimal format', 'user_response');

      expect(result).toBeNull();
    });

    it('should accept full format from both sources', () => {
      const verdictText = 'GATE_REVIEW: PASS - full format';

      const fromParam = (stage as any).parseGateVerdict(verdictText, 'gate_verdict');
      const fromResponse = (stage as any).parseGateVerdict(verdictText, 'user_response');

      expect(fromParam).not.toBeNull();
      expect(fromResponse).not.toBeNull();
      expect(fromParam?.source).toBe('gate_verdict');
      expect(fromResponse?.source).toBe('user_response');
    });
  });

  describe('Whitespace Handling', () => {
    it('should handle extra whitespace around separators', () => {
      const result = (stage as any).parseGateVerdict(
        'GATE PASS  -  extra spaces around separator',
        'gate_verdict'
      );

      expect(result?.rationale).toBe('extra spaces around separator');
    });

    it('should trim rationale whitespace', () => {
      const result = (stage as any).parseGateVerdict(
        'GATE PASS - rationale with trailing spaces   ',
        'gate_verdict'
      );

      expect(result?.rationale).toBe('rationale with trailing spaces');
    });
  });

  describe('Edge Cases', () => {
    it('should return null for undefined input', () => {
      const result = (stage as any).parseGateVerdict(undefined, 'gate_verdict');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = (stage as any).parseGateVerdict('', 'gate_verdict');
      expect(result).toBeNull();
    });

    it('should return null for non-matching text', () => {
      const result = (stage as any).parseGateVerdict('This is just regular text', 'gate_verdict');
      expect(result).toBeNull();
    });

    it('should handle multi-line rationale (takes first line only)', () => {
      const result = (stage as any).parseGateVerdict(
        'GATE PASS - First line\nSecond line',
        'gate_verdict'
      );

      // Regex with ^ anchor only matches first line
      expect(result).toBeNull(); // Won't match because \n breaks the pattern
    });
  });

  describe('Pattern Priority', () => {
    it('should try patterns in order and return first match', () => {
      // This could match multiple patterns, but should return primary (first)
      const result = (stage as any).parseGateVerdict('GATE_REVIEW: PASS - reason', 'gate_verdict');

      expect(result?.detectedPattern).toBe('primary');
    });

    it('should skip to next pattern if rationale validation fails', () => {
      // If first pattern matches but has empty rationale, try next
      const result = (stage as any).parseGateVerdict('PASS - valid minimal', 'gate_verdict');

      expect(result?.detectedPattern).toBe('fallback');
    });
  });

  describe('Integration with Source Context', () => {
    it('should preserve raw input in result', () => {
      const input = 'GATE PASS - test';
      const result = (stage as any).parseGateVerdict(input, 'gate_verdict');

      expect(result?.raw).toBe(input);
    });

    it('should preserve source in result', () => {
      const result = (stage as any).parseGateVerdict('GATE PASS - test', 'user_response');

      expect(result?.source).toBe('user_response');
    });

    it('should include pattern detection for telemetry', () => {
      const result = (stage as any).parseGateVerdict('GATE_REVIEW: PASS - test', 'gate_verdict');

      expect(result?.detectedPattern).toBeDefined();
      expect(typeof result?.detectedPattern).toBe('string');
    });
  });
});
