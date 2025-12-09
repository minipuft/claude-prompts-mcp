import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  FrameworkDecisionAuthority,
  type FrameworkDecisionInput,
} from '../../../../../src/execution/pipeline/decisions/index.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('FrameworkDecisionAuthority', () => {
  let authority: FrameworkDecisionAuthority;

  beforeEach(() => {
    jest.clearAllMocks();
    authority = new FrameworkDecisionAuthority(mockLogger as any);
  });

  describe('initial state', () => {
    test('hasDecided returns false before first decision', () => {
      expect(authority.hasDecided()).toBe(false);
    });

    test('getCachedDecision returns null before first decision', () => {
      expect(authority.getCachedDecision()).toBeNull();
    });
  });

  describe('decision caching', () => {
    test('returns cached decision on subsequent calls', () => {
      const input: FrameworkDecisionInput = {
        globalActiveFramework: 'CAGEERF',
      };

      const decision1 = authority.decide(input);
      const decision2 = authority.decide(input);

      expect(decision1).toBe(decision2); // Same object reference
      expect(authority.hasDecided()).toBe(true);
    });

    test('getCachedDecision returns the cached decision after decide()', () => {
      const input: FrameworkDecisionInput = {
        globalActiveFramework: 'ReACT',
      };

      authority.decide(input);
      const cached = authority.getCachedDecision();

      expect(cached).not.toBeNull();
      expect(cached?.frameworkId).toBe('react');
    });

    test('reset clears the cached decision', () => {
      authority.decide({ globalActiveFramework: 'CAGEERF' });
      expect(authority.hasDecided()).toBe(true);

      authority.reset();
      expect(authority.hasDecided()).toBe(false);
      expect(authority.getCachedDecision()).toBeNull();
    });

    test('decision can be recomputed after reset', () => {
      const input1: FrameworkDecisionInput = { globalActiveFramework: 'CAGEERF' };
      const decision1 = authority.decide(input1);
      expect(decision1.frameworkId).toBe('cageerf');

      authority.reset();

      const input2: FrameworkDecisionInput = { globalActiveFramework: 'ReACT' };
      const decision2 = authority.decide(input2);
      expect(decision2.frameworkId).toBe('react');
    });
  });

  describe('priority: %clean modifier', () => {
    test('disables framework when %clean is true', () => {
      const input: FrameworkDecisionInput = {
        modifiers: { clean: true },
        operatorOverride: 'CAGEERF', // Would normally be highest priority
        globalActiveFramework: 'ReACT',
      };

      const decision = authority.decide(input);

      expect(decision.shouldApply).toBe(false);
      expect(decision.frameworkId).toBeUndefined();
      expect(decision.source).toBe('disabled');
      expect(decision.reason).toContain('%clean');
    });
  });

  describe('priority: %lean modifier', () => {
    test('disables framework when %lean is true', () => {
      const input: FrameworkDecisionInput = {
        modifiers: { lean: true },
        operatorOverride: 'CAGEERF',
        clientOverride: 'ReACT',
        globalActiveFramework: '5W1H',
      };

      const decision = authority.decide(input);

      expect(decision.shouldApply).toBe(false);
      expect(decision.source).toBe('disabled');
      expect(decision.reason).toContain('%lean');
    });

    test('%clean takes precedence over %lean in reason', () => {
      const input: FrameworkDecisionInput = {
        modifiers: { clean: true, lean: true },
      };

      const decision = authority.decide(input);

      expect(decision.shouldApply).toBe(false);
      expect(decision.reason).toContain('%clean'); // Clean checked first
    });
  });

  describe('priority: @ operator override', () => {
    test('uses operator override when present', () => {
      const input: FrameworkDecisionInput = {
        operatorOverride: 'CAGEERF',
        clientOverride: 'ReACT', // Lower priority
        globalActiveFramework: '5W1H', // Lowest priority
      };

      const decision = authority.decide(input);

      expect(decision.shouldApply).toBe(true);
      expect(decision.frameworkId).toBe('cageerf');
      expect(decision.source).toBe('operator');
      expect(decision.reason).toContain('@ operator');
    });

    test('normalizes operator override to lowercase', () => {
      const input: FrameworkDecisionInput = {
        operatorOverride: 'CAGEERF',
      };

      const decision = authority.decide(input);
      expect(decision.frameworkId).toBe('cageerf');
    });
  });

  describe('priority: client selection', () => {
    test('uses client selection when no operator override', () => {
      const input: FrameworkDecisionInput = {
        clientOverride: 'ReACT',
        globalActiveFramework: 'SCAMPER', // Lower priority
      };

      const decision = authority.decide(input);

      expect(decision.shouldApply).toBe(true);
      expect(decision.frameworkId).toBe('react');
      expect(decision.source).toBe('client-selection');
      expect(decision.reason).toContain('judge phase');
    });

    test('normalizes client selection to lowercase', () => {
      const input: FrameworkDecisionInput = {
        clientOverride: 'SCAMPER',
      };

      const decision = authority.decide(input);
      expect(decision.frameworkId).toBe('scamper');
    });
  });

  describe('priority: global active framework', () => {
    test('uses global active when no higher priority source', () => {
      const input: FrameworkDecisionInput = {
        globalActiveFramework: '5W1H',
      };

      const decision = authority.decide(input);

      expect(decision.shouldApply).toBe(true);
      expect(decision.frameworkId).toBe('5w1h');
      expect(decision.source).toBe('global-active');
      expect(decision.reason).toContain('Global active');
    });

    test('normalizes global active to lowercase', () => {
      const input: FrameworkDecisionInput = {
        globalActiveFramework: 'CAGEERF',
      };

      const decision = authority.decide(input);
      expect(decision.frameworkId).toBe('cageerf');
    });
  });

  describe('no framework configured', () => {
    test('returns disabled when no framework source available', () => {
      const input: FrameworkDecisionInput = {};

      const decision = authority.decide(input);

      expect(decision.shouldApply).toBe(false);
      expect(decision.frameworkId).toBeUndefined();
      expect(decision.source).toBe('disabled');
      expect(decision.reason).toContain('No framework configured');
    });

    test('returns disabled with only judge modifier', () => {
      const input: FrameworkDecisionInput = {
        modifiers: { judge: true },
      };

      const decision = authority.decide(input);
      expect(decision.shouldApply).toBe(false);
    });
  });

  describe('decision metadata', () => {
    test('decision includes timestamp', () => {
      const beforeTime = Date.now();
      const decision = authority.decide({ globalActiveFramework: 'CAGEERF' });
      const afterTime = Date.now();

      expect(decision.decidedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(decision.decidedAt).toBeLessThanOrEqual(afterTime);
    });

    test('logs decision details', () => {
      authority.decide({ globalActiveFramework: 'CAGEERF' });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[FrameworkDecisionAuthority] Decision made',
        expect.objectContaining({
          shouldApply: true,
          frameworkId: 'cageerf',
          source: 'global-active',
        })
      );
    });
  });

  describe('getFrameworkId convenience method', () => {
    test('returns framework ID when should apply', () => {
      const input: FrameworkDecisionInput = {
        globalActiveFramework: 'CAGEERF',
      };

      const frameworkId = authority.getFrameworkId(input);
      expect(frameworkId).toBe('cageerf');
    });

    test('returns undefined when framework disabled', () => {
      const input: FrameworkDecisionInput = {
        modifiers: { clean: true },
        globalActiveFramework: 'CAGEERF',
      };

      const frameworkId = authority.getFrameworkId(input);
      expect(frameworkId).toBeUndefined();
    });

    test('returns undefined when no framework configured', () => {
      const input: FrameworkDecisionInput = {};

      const frameworkId = authority.getFrameworkId(input);
      expect(frameworkId).toBeUndefined();
    });

    test('uses cached decision', () => {
      const input: FrameworkDecisionInput = {
        globalActiveFramework: 'CAGEERF',
      };

      authority.getFrameworkId(input);
      authority.getFrameworkId(input);

      // Should only log once since decision is cached
      expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    });
  });

  describe('full priority chain test', () => {
    test('respects complete priority order', () => {
      // Test each priority level wins over all lower levels
      const scenarios: Array<{
        input: FrameworkDecisionInput;
        expectedSource: string;
        expectedFramework?: string;
        description: string;
      }> = [
        {
          description: '%clean beats everything',
          input: {
            modifiers: { clean: true },
            operatorOverride: 'OP',
            clientOverride: 'CLIENT',
            globalActiveFramework: 'GLOBAL',
          },
          expectedSource: 'disabled',
          expectedFramework: undefined,
        },
        {
          description: '%lean beats operator/client/global',
          input: {
            modifiers: { lean: true },
            operatorOverride: 'OP',
            clientOverride: 'CLIENT',
            globalActiveFramework: 'GLOBAL',
          },
          expectedSource: 'disabled',
          expectedFramework: undefined,
        },
        {
          description: 'operator beats client/global',
          input: {
            operatorOverride: 'OP',
            clientOverride: 'CLIENT',
            globalActiveFramework: 'GLOBAL',
          },
          expectedSource: 'operator',
          expectedFramework: 'op',
        },
        {
          description: 'client beats global',
          input: {
            clientOverride: 'CLIENT',
            globalActiveFramework: 'GLOBAL',
          },
          expectedSource: 'client-selection',
          expectedFramework: 'client',
        },
        {
          description: 'global is lowest priority',
          input: {
            globalActiveFramework: 'GLOBAL',
          },
          expectedSource: 'global-active',
          expectedFramework: 'global',
        },
      ];

      scenarios.forEach(({ input, expectedSource, expectedFramework, description }) => {
        const auth = new FrameworkDecisionAuthority(mockLogger as any);
        const decision = auth.decide(input);

        expect(decision.source).toBe(expectedSource);
        expect(decision.frameworkId).toBe(expectedFramework);
      });
    });
  });
});
