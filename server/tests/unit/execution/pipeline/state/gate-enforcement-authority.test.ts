import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateEnforcementAuthority } from '../../../../../src/engine/execution/pipeline/decisions/index.js';

import type {
  EnforcementMode,
  VerdictSource,
} from '../../../../../src/engine/execution/pipeline/decisions/index.js';

const createMockLogger = () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const createMockChainSessionStore = () => ({
  getSession: jest.fn(),
  hasActiveSession: jest.fn(),
  getPendingGateReview: jest.fn(),
  setPendingGateReview: jest.fn(),
  clearPendingGateReview: jest.fn(),
  isRetryLimitExceeded: jest.fn().mockReturnValue(false),
  resetRetryCount: jest.fn(),
  recordGateReviewOutcome: jest.fn().mockReturnValue('cleared'),
});

describe('GateEnforcementAuthority', () => {
  let authority: GateEnforcementAuthority;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockSessionManager: ReturnType<typeof createMockChainSessionStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    mockSessionManager = createMockChainSessionStore();
    authority = new GateEnforcementAuthority(mockSessionManager as any, mockLogger as any);
  });

  describe('parseVerdict', () => {
    describe('pattern 1: GATE_REVIEW: PASS|FAIL - rationale', () => {
      test('parses PASS verdict with hyphen separator', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS - Excellent work', 'gate_verdict');
        expect(result).toEqual({
          verdict: 'PASS',
          rationale: 'Excellent work',
          raw: 'GATE_REVIEW: PASS - Excellent work',
          source: 'gate_verdict',
          detectedPattern: 'primary',
        });
      });

      test('parses FAIL verdict with hyphen separator', () => {
        const result = authority.parseVerdict(
          'GATE_REVIEW: FAIL - Needs improvement',
          'gate_verdict'
        );
        expect(result).toEqual({
          verdict: 'FAIL',
          rationale: 'Needs improvement',
          raw: 'GATE_REVIEW: FAIL - Needs improvement',
          source: 'gate_verdict',
          detectedPattern: 'primary',
        });
      });

      test('is case insensitive', () => {
        const result = authority.parseVerdict('gate_review: pass - Good', 'gate_verdict');
        expect(result?.verdict).toBe('PASS');
      });
    });

    describe('pattern 2: GATE_REVIEW: PASS|FAIL : rationale', () => {
      test('parses with colon separator', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS : Nice', 'gate_verdict');
        expect(result).toEqual({
          verdict: 'PASS',
          rationale: 'Nice',
          raw: 'GATE_REVIEW: PASS : Nice',
          source: 'gate_verdict',
          detectedPattern: 'high',
        });
      });
    });

    describe('pattern 3: GATE PASS|FAIL - rationale', () => {
      test('parses simplified format with hyphen', () => {
        const result = authority.parseVerdict('GATE PASS - All checks passed', 'gate_verdict');
        expect(result).toEqual({
          verdict: 'PASS',
          rationale: 'All checks passed',
          raw: 'GATE PASS - All checks passed',
          source: 'gate_verdict',
          detectedPattern: 'high',
        });
      });
    });

    describe('pattern 4: GATE PASS|FAIL : rationale', () => {
      test('parses simplified format with colon', () => {
        const result = authority.parseVerdict('GATE FAIL : Missing tests', 'gate_verdict');
        expect(result).toEqual({
          verdict: 'FAIL',
          rationale: 'Missing tests',
          raw: 'GATE FAIL : Missing tests',
          source: 'gate_verdict',
          detectedPattern: 'medium',
        });
      });
    });

    describe('pattern 5: minimal format (PASS|FAIL - rationale)', () => {
      test('parses minimal format from gate_verdict source', () => {
        const result = authority.parseVerdict('PASS - OK', 'gate_verdict');
        expect(result).toEqual({
          verdict: 'PASS',
          rationale: 'OK',
          raw: 'PASS - OK',
          source: 'gate_verdict',
          detectedPattern: 'fallback',
        });
      });

      test('skips minimal pattern for user_response source (security)', () => {
        const result = authority.parseVerdict('PASS - This looks like a verdict', 'user_response');
        expect(result).toBeNull();
      });

      test('allows explicit format from user_response source', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS - Approved', 'user_response');
        expect(result?.verdict).toBe('PASS');
        expect(result?.detectedPattern).toBe('primary');
      });
    });

    describe('edge cases', () => {
      test('returns null for undefined input', () => {
        expect(authority.parseVerdict(undefined, 'gate_verdict')).toBeNull();
      });

      test('returns null for empty string', () => {
        expect(authority.parseVerdict('', 'gate_verdict')).toBeNull();
      });

      test('returns null for non-matching input', () => {
        expect(authority.parseVerdict('random text', 'gate_verdict')).toBeNull();
      });

      test('rejects verdict without rationale', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS - ', 'gate_verdict');
        expect(result).toBeNull();
        // Note: warn may not fire when trailing space is trimmed before regex match
      });

      test('trims whitespace from rationale', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS -   Spaced out  ', 'gate_verdict');
        expect(result?.rationale).toBe('Spaced out');
      });
    });
  });

  describe('parseGateVerdicts', () => {
    test('parses valid CRITERION_VERDICTS block', () => {
      const raw = `Some preamble text.

CRITERION_VERDICTS:
[1] PASS - All tests pass
[2] FAIL - Missing error handling
[3] PASS - Documentation complete

GATE_REVIEW: PASS - Overall good`;

      const result = authority.parseGateVerdicts(raw);

      expect(result).toEqual([
        { index: 1, passed: true, rationale: 'All tests pass' },
        { index: 2, passed: false, rationale: 'Missing error handling' },
        { index: 3, passed: true, rationale: 'Documentation complete' },
      ]);
    });

    test('returns empty array when no CRITERION_VERDICTS block', () => {
      const result = authority.parseGateVerdicts('GATE_REVIEW: PASS - Good work');
      expect(result).toEqual([]);
    });

    test('returns empty array for empty input', () => {
      expect(authority.parseGateVerdicts('')).toEqual([]);
    });

    test('handles verdicts without brackets', () => {
      const raw = `CRITERION_VERDICTS:
1 PASS - First criterion met
2 FAIL - Second criterion failed`;

      const result = authority.parseGateVerdicts(raw);

      expect(result).toEqual([
        { index: 1, passed: true, rationale: 'First criterion met' },
        { index: 2, passed: false, rationale: 'Second criterion failed' },
      ]);
    });

    test('handles em-dash and en-dash separators', () => {
      const raw = `CRITERION_VERDICTS:
[1] PASS \u2014 em-dash rationale
[2] FAIL \u2013 en-dash rationale`;

      const result = authority.parseGateVerdicts(raw);

      expect(result).toEqual([
        { index: 1, passed: true, rationale: 'em-dash rationale' },
        { index: 2, passed: false, rationale: 'en-dash rationale' },
      ]);
    });

    test('stops capturing at first non-matching line within block', () => {
      const raw = `CRITERION_VERDICTS:
[1] PASS - Good
not a verdict line
[3] FAIL - Bad`;

      const result = authority.parseGateVerdicts(raw);

      // Regex capture group stops at non-matching line
      expect(result).toEqual([{ index: 1, passed: true, rationale: 'Good' }]);
    });

    test('is case insensitive for verdict values', () => {
      const raw = `CRITERION_VERDICTS:
[1] pass - lowercase
[2] Pass - mixed case`;

      const result = authority.parseGateVerdicts(raw);

      expect(result).toHaveLength(2);
      expect(result[0]?.passed).toBe(true);
      expect(result[1]?.passed).toBe(true);
    });

    test('parses GATE_VERDICTS block (new format)', () => {
      const raw = `Some preamble text.

GATE_VERDICTS:
[1] PASS - Code quality met
[2] FAIL - Missing tests

GATE_REVIEW: FAIL - Tests missing`;

      const result = authority.parseGateVerdicts(raw);

      expect(result).toEqual([
        { index: 1, passed: true, rationale: 'Code quality met' },
        { index: 2, passed: false, rationale: 'Missing tests' },
      ]);
    });
  });

  describe('getRetryConfig', () => {
    test('returns default values when no pending review', () => {
      mockSessionManager.getPendingGateReview.mockReturnValue(undefined);

      const config = authority.getRetryConfig('session-1');

      expect(config.currentAttempt).toBe(0);
      expect(config.maxAttempts).toBe(2); // DEFAULT_RETRY_LIMIT
      expect(config.isExhausted).toBe(false);
    });

    test('returns values from pending review', () => {
      mockSessionManager.getPendingGateReview.mockReturnValue({
        attemptCount: 2,
        maxAttempts: 5,
      });

      const config = authority.getRetryConfig('session-1');

      expect(config.currentAttempt).toBe(2);
      expect(config.maxAttempts).toBe(5);
      expect(config.isExhausted).toBe(false);
    });

    test('marks exhausted when attempts meet max', () => {
      mockSessionManager.getPendingGateReview.mockReturnValue({
        attemptCount: 3,
        maxAttempts: 3,
      });

      const config = authority.getRetryConfig('session-1');

      expect(config.isExhausted).toBe(true);
    });
  });

  describe('isRetryLimitExceeded', () => {
    test('delegates to session manager', () => {
      mockSessionManager.isRetryLimitExceeded.mockReturnValue(true);

      const result = authority.isRetryLimitExceeded('session-1');

      expect(result).toBe(true);
      expect(mockSessionManager.isRetryLimitExceeded).toHaveBeenCalledWith('session-1');
    });
  });

  describe('getPendingReview', () => {
    test('delegates to session manager', () => {
      const mockReview = { combinedPrompt: 'test', gateIds: ['g1'] };
      mockSessionManager.getPendingGateReview.mockReturnValue(mockReview);

      const result = authority.getPendingReview('session-1');

      expect(result).toBe(mockReview);
      expect(mockSessionManager.getPendingGateReview).toHaveBeenCalledWith('session-1');
    });
  });

  describe('createPendingReview', () => {
    test('creates review with provided options', async () => {
      const review = await authority.createPendingReview({
        gateIds: ['gate-1', 'gate-2'],
        instructions: 'Please review carefully',
        maxAttempts: 5,
        metadata: { custom: 'data' },
      });

      expect(review.gateIds).toEqual(['gate-1', 'gate-2']);
      expect(review.combinedPrompt).toBe('Please review carefully');
      expect(review.maxAttempts).toBe(5);
      expect(review.metadata).toEqual({ custom: 'data' });
      expect(review.attemptCount).toBe(0);
      expect(review.createdAt).toBeGreaterThan(0);
    });

    test('uses default maxAttempts when not provided', async () => {
      const review = await authority.createPendingReview({
        gateIds: ['gate-1'],
        instructions: 'Review',
      });

      expect(review.maxAttempts).toBe(2); // DEFAULT_RETRY_LIMIT
    });

    test('returns empty prompts when no gateLoader provided', async () => {
      const review = await authority.createPendingReview({
        gateIds: ['gate-1'],
        instructions: 'Review',
      });

      expect(review.prompts).toEqual([]);
    });

    test('returns empty prompts when gateIds is empty', async () => {
      const mockGateLoader = { loadGates: jest.fn() } as any;
      const authorityWithLoader = new GateEnforcementAuthority(
        mockSessionManager as any,
        mockLogger as any,
        mockGateLoader
      );

      const review = await authorityWithLoader.createPendingReview({
        gateIds: [],
        instructions: 'Review',
      });

      expect(review.prompts).toEqual([]);
      expect(mockGateLoader.loadGates).not.toHaveBeenCalled();
    });

    test('populates prompts with gate criteria when gateLoader provided', async () => {
      const mockGateLoader = {
        loadGates: jest.fn().mockResolvedValue([
          {
            id: 'code-quality',
            name: 'Code Quality',
            description: 'Checks code quality',
            guidance: 'Ensure clean code with proper naming.\nSecond line of guidance.',
          },
          {
            id: 'test-coverage',
            name: 'Test Coverage',
            description: 'Validates test coverage',
            guidance: 'All public methods must have tests.',
          },
        ]),
      } as any;

      const authorityWithLoader = new GateEnforcementAuthority(
        mockSessionManager as any,
        mockLogger as any,
        mockGateLoader
      );

      const review = await authorityWithLoader.createPendingReview({
        gateIds: ['code-quality', 'test-coverage'],
        instructions: 'Review output',
      });

      expect(review.prompts).toHaveLength(2);
      expect(review.prompts[0]).toEqual({
        gateId: 'code-quality',
        gateName: 'Code Quality',
        criteriaSummary: 'Ensure clean code with proper naming.',
      });
      expect(review.prompts[1]).toEqual({
        gateId: 'test-coverage',
        gateName: 'Test Coverage',
        criteriaSummary: 'All public methods must have tests.',
      });
    });

    test('falls back to description when guidance is empty', async () => {
      const mockGateLoader = {
        loadGates: jest.fn().mockResolvedValue([
          {
            id: 'minimal-gate',
            name: 'Minimal',
            description: 'A minimal gate',
            guidance: '',
          },
        ]),
      } as any;

      const authorityWithLoader = new GateEnforcementAuthority(
        mockSessionManager as any,
        mockLogger as any,
        mockGateLoader
      );

      const review = await authorityWithLoader.createPendingReview({
        gateIds: ['minimal-gate'],
        instructions: 'Review',
      });

      expect(review.prompts[0]?.criteriaSummary).toBe('A minimal gate');
    });

    test('returns empty prompts when gate loading fails', async () => {
      const mockGateLoader = {
        loadGates: jest.fn().mockRejectedValue(new Error('Load failed')),
      } as any;

      const authorityWithLoader = new GateEnforcementAuthority(
        mockSessionManager as any,
        mockLogger as any,
        mockGateLoader
      );

      const review = await authorityWithLoader.createPendingReview({
        gateIds: ['broken-gate'],
        instructions: 'Review',
      });

      expect(review.prompts).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('recordOutcome', () => {
    describe('PASS verdict', () => {
      test('returns cleared status when session manager clears', async () => {
        mockSessionManager.recordGateReviewOutcome.mockReturnValue('cleared');

        const verdict = {
          verdict: 'PASS' as const,
          rationale: 'Good work',
          raw: 'GATE_REVIEW: PASS - Good work',
          source: 'gate_verdict' as VerdictSource,
        };

        const outcome = await authority.recordOutcome('session-1', verdict);

        expect(outcome.status).toBe('cleared');
        expect(outcome.nextAction).toBe('continue');
      });
    });

    describe('FAIL verdict in blocking mode', () => {
      test('returns exhausted when retry limit exceeded', async () => {
        mockSessionManager.recordGateReviewOutcome.mockReturnValue('pending');
        mockSessionManager.getPendingGateReview.mockReturnValue({
          attemptCount: 3,
          maxAttempts: 3,
        });

        const verdict = {
          verdict: 'FAIL' as const,
          rationale: 'Not good',
          raw: 'GATE_REVIEW: FAIL - Not good',
          source: 'gate_verdict' as VerdictSource,
        };

        const outcome = await authority.recordOutcome('session-1', verdict, 'blocking');

        expect(outcome.status).toBe('exhausted');
        expect(outcome.nextAction).toBe('await_user_choice');
        expect(outcome.attemptCount).toBe(3);
        expect(outcome.maxAttempts).toBe(3);
      });

      test('returns pending when retries remaining', async () => {
        mockSessionManager.recordGateReviewOutcome.mockReturnValue('pending');
        mockSessionManager.getPendingGateReview.mockReturnValue({
          attemptCount: 1,
          maxAttempts: 3,
        });

        const verdict = {
          verdict: 'FAIL' as const,
          rationale: 'Try again',
          raw: 'GATE_REVIEW: FAIL - Try again',
          source: 'gate_verdict' as VerdictSource,
        };

        const outcome = await authority.recordOutcome('session-1', verdict, 'blocking');

        expect(outcome.status).toBe('pending');
        expect(outcome.nextAction).toBe('await_verdict');
      });
    });

    describe('FAIL verdict in advisory mode', () => {
      test('logs warning and continues', async () => {
        mockSessionManager.recordGateReviewOutcome.mockReturnValue('pending');
        mockSessionManager.getPendingGateReview.mockReturnValue({
          attemptCount: 0,
          maxAttempts: 3,
        });

        const verdict = {
          verdict: 'FAIL' as const,
          rationale: 'Minor issue',
          raw: 'GATE_REVIEW: FAIL - Minor issue',
          source: 'gate_verdict' as VerdictSource,
        };

        const outcome = await authority.recordOutcome('session-1', verdict, 'advisory');

        expect(outcome.status).toBe('cleared');
        expect(outcome.nextAction).toBe('continue');
        expect(mockLogger.warn).toHaveBeenCalled();
        expect(mockSessionManager.clearPendingGateReview).toHaveBeenCalledWith('session-1');
      });
    });

    describe('FAIL verdict in informational mode', () => {
      test('logs debug and continues silently', async () => {
        mockSessionManager.recordGateReviewOutcome.mockReturnValue('pending');
        mockSessionManager.getPendingGateReview.mockReturnValue({
          attemptCount: 0,
          maxAttempts: 3,
        });

        const verdict = {
          verdict: 'FAIL' as const,
          rationale: 'Info only',
          raw: 'GATE_REVIEW: FAIL - Info only',
          source: 'gate_verdict' as VerdictSource,
        };

        const outcome = await authority.recordOutcome('session-1', verdict, 'informational');

        expect(outcome.status).toBe('cleared');
        expect(outcome.nextAction).toBe('continue');
        expect(mockLogger.debug).toHaveBeenCalled();
        expect(mockSessionManager.clearPendingGateReview).toHaveBeenCalledWith('session-1');
      });
    });
  });

  describe('resolveAction', () => {
    test('handles retry action', async () => {
      const result = await authority.resolveAction('session-1', 'retry');

      expect(result.handled).toBe(true);
      expect(result.retryReset).toBe(true);
      expect(mockSessionManager.resetRetryCount).toHaveBeenCalledWith('session-1');
    });

    test('handles skip action', async () => {
      const result = await authority.resolveAction('session-1', 'skip');

      expect(result.handled).toBe(true);
      expect(result.reviewCleared).toBe(true);
      expect(mockSessionManager.clearPendingGateReview).toHaveBeenCalledWith('session-1');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    test('handles abort action', async () => {
      const result = await authority.resolveAction('session-1', 'abort');

      expect(result.handled).toBe(true);
      expect(result.sessionAborted).toBe(true);
    });

    test('handles unknown action', async () => {
      const result = await authority.resolveAction('session-1', 'unknown' as any);

      expect(result.handled).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('setPendingReview', () => {
    test('delegates to session manager', async () => {
      const review = {
        combinedPrompt: 'test',
        gateIds: ['g1'],
        prompts: [],
        createdAt: Date.now(),
        attemptCount: 0,
        maxAttempts: 3,
        retryHints: [],
        history: [],
      };

      await authority.setPendingReview('session-1', review);

      expect(mockSessionManager.setPendingGateReview).toHaveBeenCalledWith('session-1', review);
    });
  });

  describe('clearPendingReview', () => {
    test('delegates to session manager', async () => {
      await authority.clearPendingReview('session-1');

      expect(mockSessionManager.clearPendingGateReview).toHaveBeenCalledWith('session-1');
    });
  });
});
