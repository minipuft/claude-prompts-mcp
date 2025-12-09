import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateEnforcementAuthority } from '../../../../../src/execution/pipeline/decisions/index.js';

import type {
  GateEnforcementInput,
  EnforcementMode,
  VerdictSource,
} from '../../../../../src/execution/pipeline/decisions/index.js';

const createMockLogger = () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const createMockChainSessionManager = () => ({
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
  let mockSessionManager: ReturnType<typeof createMockChainSessionManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    mockSessionManager = createMockChainSessionManager();
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
        expect(mockLogger.warn).toHaveBeenCalled();
      });

      test('trims whitespace from rationale', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS -   Spaced out  ', 'gate_verdict');
        expect(result?.rationale).toBe('Spaced out');
      });
    });
  });

  describe('resolveEnforcementMode', () => {
    test('returns configured mode when provided', () => {
      expect(authority.resolveEnforcementMode('advisory')).toBe('advisory');
      expect(authority.resolveEnforcementMode('informational')).toBe('informational');
      expect(authority.resolveEnforcementMode('blocking')).toBe('blocking');
    });

    test('defaults to blocking when undefined', () => {
      expect(authority.resolveEnforcementMode(undefined)).toBe('blocking');
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
    test('creates review with provided options', () => {
      const review = authority.createPendingReview({
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

    test('uses default maxAttempts when not provided', () => {
      const review = authority.createPendingReview({
        gateIds: ['gate-1'],
        instructions: 'Review',
      });

      expect(review.maxAttempts).toBe(2); // DEFAULT_RETRY_LIMIT
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

  describe('decision caching (decide/hasDecided/getCachedDecision/reset)', () => {
    test('hasDecided returns false initially', () => {
      expect(authority.hasDecided()).toBe(false);
    });

    test('getCachedDecision returns null initially', () => {
      expect(authority.getCachedDecision()).toBeNull();
    });

    test('decide caches the decision', () => {
      const input: GateEnforcementInput = {
        sessionId: 'session-1',
        gateIds: ['gate-1', 'gate-2'],
      };

      const decision1 = authority.decide(input);
      const decision2 = authority.decide(input);

      expect(decision1).toBe(decision2); // Same reference
      expect(authority.hasDecided()).toBe(true);
    });

    test('getCachedDecision returns decision after decide', () => {
      const input: GateEnforcementInput = {
        sessionId: 'session-1',
        gateIds: ['gate-1'],
      };

      authority.decide(input);
      const cached = authority.getCachedDecision();

      expect(cached).not.toBeNull();
      expect(cached?.shouldEnforce).toBe(true);
    });

    test('reset clears the cached decision', () => {
      authority.decide({
        sessionId: 'session-1',
        gateIds: ['gate-1'],
      });

      expect(authority.hasDecided()).toBe(true);

      authority.reset();

      expect(authority.hasDecided()).toBe(false);
      expect(authority.getCachedDecision()).toBeNull();
    });

    test('can recompute after reset', () => {
      const input1: GateEnforcementInput = {
        sessionId: 'session-1',
        gateIds: ['gate-1'],
      };

      const decision1 = authority.decide(input1);
      expect(decision1.gateIds).toEqual(['gate-1']);

      authority.reset();

      const input2: GateEnforcementInput = {
        sessionId: 'session-2',
        gateIds: ['gate-2', 'gate-3'],
      };

      const decision2 = authority.decide(input2);
      expect(decision2.gateIds).toEqual(['gate-2', 'gate-3']);
    });
  });

  describe('decide - enforcement decision logic', () => {
    test('shouldEnforce is false when no gates', () => {
      const decision = authority.decide({
        sessionId: 'session-1',
        gateIds: [],
      });

      expect(decision.shouldEnforce).toBe(false);
      expect(decision.reason).toContain('No gates');
    });

    test('shouldEnforce is true with gates', () => {
      const decision = authority.decide({
        sessionId: 'session-1',
        gateIds: ['gate-1', 'gate-2'],
      });

      expect(decision.shouldEnforce).toBe(true);
      expect(decision.gateIds).toEqual(['gate-1', 'gate-2']);
      expect(decision.reason).toContain('Enforcing 2 gates');
    });

    test('uses configured enforcement mode', () => {
      const decision = authority.decide({
        sessionId: 'session-1',
        gateIds: ['gate-1'],
        enforcementMode: 'advisory',
      });

      expect(decision.enforcementMode).toBe('advisory');
    });

    test('defaults to blocking mode', () => {
      const decision = authority.decide({
        sessionId: 'session-1',
        gateIds: ['gate-1'],
      });

      expect(decision.enforcementMode).toBe('blocking');
    });

    test('includes timestamp', () => {
      const before = Date.now();
      const decision = authority.decide({
        sessionId: 'session-1',
        gateIds: ['gate-1'],
      });
      const after = Date.now();

      expect(decision.decidedAt).toBeGreaterThanOrEqual(before);
      expect(decision.decidedAt).toBeLessThanOrEqual(after);
    });

    test('logs decision details', () => {
      authority.decide({
        sessionId: 'session-1',
        gateIds: ['gate-1'],
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[GateEnforcementAuthority] Decision made',
        expect.objectContaining({
          shouldEnforce: true,
          enforcementMode: 'blocking',
          gateCount: 1,
        })
      );
    });
  });
});
