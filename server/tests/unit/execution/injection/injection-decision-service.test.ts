// @lifecycle canonical - Unit tests for InjectionDecisionService
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { DEFAULT_INJECTION_CONFIG } from '../../../../src/execution/pipeline/decisions/injection/constants.js';
import { InjectionDecisionService } from '../../../../src/execution/pipeline/decisions/injection/injection-decision-service.js';

import type {
  InjectionConfig,
  InjectionDecisionInput,
  InjectionRuntimeOverride,
  InjectionType,
} from '../../../../src/execution/pipeline/decisions/injection/types.js';

describe('InjectionDecisionService', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('constructor', () => {
    it('should create service with default config', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);
      expect(service).toBeDefined();
    });

    it('should create service with custom config', () => {
      const customConfig: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        defaults: {
          'system-prompt': false,
          'gate-guidance': true,
          'style-guidance': true,
        },
      };
      const service = new InjectionDecisionService(customConfig, mockLogger);
      expect(service).toBeDefined();
    });
  });

  describe('decide', () => {
    it('should return inject=true for system-prompt with default config on step 1', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };

      const decision = service.decide(input);

      expect(decision.inject).toBe(true);
      // DEFAULT_INJECTION_CONFIG has global config, so source is 'global-config'
      expect(decision.source).toBe('global-config');
    });

    it('should return inject=false for system-prompt with %clean modifier', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
        modifiers: { clean: true },
      };

      const decision = service.decide(input);

      expect(decision.inject).toBe(false);
      expect(decision.source).toBe('modifier');
      expect(decision.reason).toContain('clean');
    });

    it('should return inject=false for style-guidance with %lean modifier', () => {
      // %lean disables system-prompt and style-guidance, but NOT gate-guidance
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'style-guidance',
        currentStep: 1,
        modifiers: { lean: true },
      };

      const decision = service.decide(input);

      expect(decision.inject).toBe(false);
      expect(decision.source).toBe('modifier');
    });

    it('should NOT disable gate-guidance with %lean modifier', () => {
      // %lean only affects system-prompt and style-guidance
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'gate-guidance',
        currentStep: 1,
        modifiers: { lean: true },
      };

      const decision = service.decide(input);

      expect(decision.inject).toBe(true);
      expect(decision.source).not.toBe('modifier');
    });

    it('should honor runtime override set via setRuntimeOverride', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);

      // Set runtime override via the service's method
      service.setRuntimeOverride({
        type: 'system-prompt',
        enabled: false,
        scope: 'session',
        setAt: Date.now(),
      });

      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };

      const decision = service.decide(input);

      expect(decision.inject).toBe(false);
      expect(decision.source).toBe('runtime-override');
    });

    it('should honor overrides synced from session manager and clear cached decisions', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);

      // Prime cache with default decision (inject=true)
      service.decide({
        injectionType: 'system-prompt',
        currentStep: 1,
      });

      const overrides = new Map<InjectionType, InjectionRuntimeOverride>();
      overrides.set('system-prompt', {
        type: 'system-prompt',
        enabled: false,
        scope: 'session',
        setAt: Date.now(),
      });

      service.syncRuntimeOverrides(overrides);

      const decision = service.decide({
        injectionType: 'system-prompt',
        currentStep: 1,
      });

      expect(decision.inject).toBe(false);
      expect(decision.source).toBe('runtime-override');
    });

    it('should cache decisions for same input', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };

      const decision1 = service.decide(input);
      const decision2 = service.decide(input);

      // Both should have same decidedAt (cached)
      expect(decision1.decidedAt).toBe(decision2.decidedAt);
    });
  });

  describe('decideAll', () => {
    it('should return decisions for all injection types', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input = {
        currentStep: 1,
      };

      const state = service.decideAll(input);

      expect(state.systemPrompt).toBeDefined();
      expect(state.gateGuidance).toBeDefined();
      expect(state.styleGuidance).toBeDefined();
    });

    it('should track currentStep in state', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input = {
        currentStep: 3,
      };

      const state = service.decideAll(input);

      expect(state.currentStep).toBe(3);
    });
  });

  describe('frequency handling', () => {
    it('should inject on first step with first-only frequency', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        'system-prompt': {
          enabled: true,
          frequency: { mode: 'first-only' },
        },
      };
      const service = new InjectionDecisionService(config, mockLogger);

      const decision = service.decide({
        injectionType: 'system-prompt',
        currentStep: 1,
      });

      expect(decision.inject).toBe(true);
    });

    it('should not inject on subsequent steps with first-only frequency', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        'system-prompt': {
          enabled: true,
          frequency: { mode: 'first-only' },
        },
      };
      const service = new InjectionDecisionService(config, mockLogger);

      const decision = service.decide({
        injectionType: 'system-prompt',
        currentStep: 2,
      });

      expect(decision.inject).toBe(false);
      expect(decision.reason).toContain('first-only');
    });

    it('should never inject with never frequency', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        'system-prompt': {
          enabled: true,
          frequency: { mode: 'never' },
        },
      };
      const service = new InjectionDecisionService(config, mockLogger);

      const decision1 = service.decide({
        injectionType: 'system-prompt',
        currentStep: 1,
      });
      const decision2 = service.decide({
        injectionType: 'system-prompt',
        currentStep: 5,
      });

      expect(decision1.inject).toBe(false);
      expect(decision2.inject).toBe(false);
    });

    it('should inject at intervals with every frequency', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        'system-prompt': {
          enabled: true,
          frequency: { mode: 'every', interval: 2 },
        },
      };

      // Test each step with fresh service to avoid caching issues
      const service1 = new InjectionDecisionService(config, mockLogger);
      const decision1 = service1.decide({
        injectionType: 'system-prompt',
        currentStep: 1,
      });
      expect(decision1.inject).toBe(true); // Step 1 always injects

      const service2 = new InjectionDecisionService(config, mockLogger);
      const decision2 = service2.decide({
        injectionType: 'system-prompt',
        currentStep: 2,
      });
      expect(decision2.inject).toBe(false); // Step 2: (2-1) % 2 = 1, not 0

      const service3 = new InjectionDecisionService(config, mockLogger);
      const decision3 = service3.decide({
        injectionType: 'system-prompt',
        currentStep: 3,
      });
      expect(decision3.inject).toBe(true); // Step 3: (3-1) % 2 = 0
    });
  });

  describe('modifier precedence', () => {
    it('should prioritize %clean over runtime override', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
        modifiers: { clean: true },
        sessionOverrides: { 'system-prompt': true },
      };

      const decision = service.decide(input);

      expect(decision.inject).toBe(false);
      expect(decision.source).toBe('modifier');
    });

    it('should allow injection with %judge modifier', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
        modifiers: { judge: true },
      };

      const decision = service.decide(input);

      expect(decision.inject).toBe(true);
      expect(decision.source).toBe('modifier');
    });
  });

  describe('cache management', () => {
    it('should reset cached decisions', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);

      // Make a decision
      service.decide({
        injectionType: 'system-prompt',
        currentStep: 1,
      });

      expect(service.hasDecided('system-prompt')).toBe(true);

      // Reset cache
      service.reset();

      expect(service.hasDecided('system-prompt')).toBe(false);
    });

    it('should cache decisions by type', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);

      // Make decisions
      service.decide({ injectionType: 'system-prompt', currentStep: 1 });
      service.decide({ injectionType: 'gate-guidance', currentStep: 1 });

      expect(service.hasDecided('system-prompt')).toBe(true);
      expect(service.hasDecided('gate-guidance')).toBe(true);
      expect(service.hasDecided('style-guidance')).toBe(false);
    });

    it('should return cached decision without recomputing', () => {
      const service = new InjectionDecisionService(DEFAULT_INJECTION_CONFIG, mockLogger);

      // Make a decision
      service.decide({ injectionType: 'system-prompt', currentStep: 1 });

      // Get cached
      const cached = service.getCachedDecision('system-prompt');

      expect(cached).toBeDefined();
      expect(cached?.inject).toBe(true);
    });
  });
});
