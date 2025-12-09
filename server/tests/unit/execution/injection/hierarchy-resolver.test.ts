// @lifecycle canonical - Unit tests for HierarchyResolver
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { DEFAULT_INJECTION_CONFIG } from '../../../../src/execution/pipeline/decisions/injection/constants.js';
import { HierarchyResolver } from '../../../../src/execution/pipeline/decisions/injection/index.js';

import type {
  InjectionConfig,
  InjectionDecisionInput,
} from '../../../../src/execution/pipeline/decisions/injection/types.js';

describe('HierarchyResolver', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('resolve', () => {
    it('should return system-default when no specific config exists', () => {
      const minimalConfig: InjectionConfig = {
        defaults: {
          'system-prompt': true,
          'gate-guidance': true,
          'style-guidance': true,
        },
      };
      const resolver = new HierarchyResolver(minimalConfig, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };

      const result = resolver.resolve('system-prompt', input);

      expect(result.config.enabled).toBe(true);
      expect(result.source).toBe('system-default');
    });

    it('should use global config when specified', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        'system-prompt': {
          enabled: false,
          frequency: { mode: 'never' },
        },
      };
      const resolver = new HierarchyResolver(config, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };

      const result = resolver.resolve('system-prompt', input);

      expect(result.config.enabled).toBe(false);
      expect(result.source).toBe('global-config');
    });

    it('should override with category config', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        categories: [
          {
            categoryId: 'analysis',
            'system-prompt': { enabled: false },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
        categoryId: 'analysis',
      };

      const result = resolver.resolve('system-prompt', input);

      expect(result.config.enabled).toBe(false);
      expect(result.source).toBe('category-config');
    });

    it('should override with chain config', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        chains: [
          {
            chainPattern: 'deploy-*',
            'system-prompt': { enabled: false },
            'gate-guidance': { enabled: true },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
        chainId: 'deploy-prod',
      };

      const result = resolver.resolve('system-prompt', input);

      expect(result.config.enabled).toBe(false);
      expect(result.source).toBe('chain-config');
    });

    it('should handle step config for specific step numbers', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        steps: [
          {
            stepTarget: 2,
            'system-prompt': { enabled: false },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);

      const resultStep1 = resolver.resolve('system-prompt', {
        injectionType: 'system-prompt',
        currentStep: 1,
      });
      const resultStep2 = resolver.resolve('system-prompt', {
        injectionType: 'system-prompt',
        currentStep: 2,
      });

      // Step 1 should use global config (DEFAULT_INJECTION_CONFIG has global settings)
      expect(resultStep1.source).toBe('global-config');

      // Step 2 should use step config
      expect(resultStep2.config.enabled).toBe(false);
      expect(resultStep2.source).toBe('step-config');
    });

    it('should handle step config for first step', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        steps: [
          {
            stepTarget: 'first',
            'gate-guidance': { enabled: false },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);

      const result = resolver.resolve('gate-guidance', {
        injectionType: 'gate-guidance',
        currentStep: 1,
      });

      expect(result.config.enabled).toBe(false);
      expect(result.source).toBe('step-config');
    });

    it('should handle step config for last step', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        steps: [
          {
            stepTarget: 'last',
            'style-guidance': { enabled: false },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);

      const result = resolver.resolve('style-guidance', {
        injectionType: 'style-guidance',
        currentStep: 5,
        totalSteps: 5,
      });

      expect(result.config.enabled).toBe(false);
      expect(result.source).toBe('step-config');
    });

    it('should handle step config for odd steps', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        steps: [
          {
            stepTarget: 'odd',
            'system-prompt': { enabled: false },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);

      const oddResult = resolver.resolve('system-prompt', {
        injectionType: 'system-prompt',
        currentStep: 3,
      });
      const evenResult = resolver.resolve('system-prompt', {
        injectionType: 'system-prompt',
        currentStep: 4,
      });

      expect(oddResult.config.enabled).toBe(false);
      expect(oddResult.source).toBe('step-config');
      expect(evenResult.source).toBe('global-config'); // Falls back to global
    });

    it('should handle step config for even steps', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        steps: [
          {
            stepTarget: 'even',
            'gate-guidance': { enabled: false },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);

      const result = resolver.resolve('gate-guidance', {
        injectionType: 'gate-guidance',
        currentStep: 4,
      });

      expect(result.config.enabled).toBe(false);
      expect(result.source).toBe('step-config');
    });
  });

  describe('pattern matching', () => {
    it('should match exact chain patterns', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        chains: [
          {
            chainPattern: 'exact-match',
            'system-prompt': { enabled: false },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);

      const exactResult = resolver.resolve('system-prompt', {
        injectionType: 'system-prompt',
        currentStep: 1,
        chainId: 'exact-match',
      });
      const noMatch = resolver.resolve('system-prompt', {
        injectionType: 'system-prompt',
        currentStep: 1,
        chainId: 'exact-match-extended',
      });

      expect(exactResult.config.enabled).toBe(false);
      expect(exactResult.source).toBe('chain-config');
      expect(noMatch.source).toBe('global-config'); // Falls back to global config
    });

    it('should match suffix wildcards (prefix-*)', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        chains: [
          {
            chainPattern: 'test-*',
            'gate-guidance': { enabled: false },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);

      const result = resolver.resolve('gate-guidance', {
        injectionType: 'gate-guidance',
        currentStep: 1,
        chainId: 'test-integration',
      });

      expect(result.config.enabled).toBe(false);
      expect(result.source).toBe('chain-config');
    });

    it('should match prefix wildcards (*-suffix)', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        chains: [
          {
            chainPattern: '*-workflow',
            'style-guidance': { enabled: false },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);

      const result = resolver.resolve('style-guidance', {
        injectionType: 'style-guidance',
        currentStep: 1,
        chainId: 'deploy-workflow',
      });

      expect(result.config.enabled).toBe(false);
      expect(result.source).toBe('chain-config');
    });

    it('should match contains wildcards (*contains*)', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        chains: [
          {
            chainPattern: '*research*',
            'system-prompt': { enabled: false },
          },
        ],
      };
      const resolver = new HierarchyResolver(config, mockLogger);

      const result = resolver.resolve('system-prompt', {
        injectionType: 'system-prompt',
        currentStep: 1,
        chainId: 'deep-research-v2',
      });

      expect(result.config.enabled).toBe(false);
      expect(result.source).toBe('chain-config');
    });
  });

  describe('runtime override', () => {
    it('should use runtime override when applicable', () => {
      const resolver = new HierarchyResolver(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };
      const runtimeOverride = {
        type: 'system-prompt' as const,
        enabled: false,
        scope: 'session' as const,
        setAt: Date.now(),
      };

      const result = resolver.resolve('system-prompt', input, runtimeOverride);

      expect(result.config.enabled).toBe(false);
      expect(result.source).toBe('runtime-override');
    });

    it('should ignore expired runtime override', () => {
      const resolver = new HierarchyResolver(DEFAULT_INJECTION_CONFIG, mockLogger);
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };
      const runtimeOverride = {
        type: 'system-prompt' as const,
        enabled: false,
        scope: 'session' as const,
        setAt: Date.now() - 10000,
        expiresAt: Date.now() - 1000, // Already expired
      };

      const result = resolver.resolve('system-prompt', input, runtimeOverride);

      // Should fall back to global config, not use expired override
      expect(result.source).toBe('global-config');
    });

    it('should use chain-scoped override only for matching chain', () => {
      const resolver = new HierarchyResolver(DEFAULT_INJECTION_CONFIG, mockLogger);
      const runtimeOverride = {
        type: 'gate-guidance' as const,
        enabled: false,
        scope: 'chain' as const,
        scopeId: 'target-chain',
        setAt: Date.now(),
      };

      const matchResult = resolver.resolve(
        'gate-guidance',
        { injectionType: 'gate-guidance', currentStep: 1, chainId: 'target-chain' },
        runtimeOverride
      );
      const noMatchResult = resolver.resolve(
        'gate-guidance',
        { injectionType: 'gate-guidance', currentStep: 1, chainId: 'other-chain' },
        runtimeOverride
      );

      expect(matchResult.source).toBe('runtime-override');
      expect(noMatchResult.source).toBe('global-config');
    });
  });

  describe('frequency resolution', () => {
    it('should resolve frequency from global config', () => {
      const config: InjectionConfig = {
        ...DEFAULT_INJECTION_CONFIG,
        'system-prompt': {
          enabled: true,
          frequency: { mode: 'every', interval: 5 },
        },
      };
      const resolver = new HierarchyResolver(config, mockLogger);

      const result = resolver.resolve('system-prompt', {
        injectionType: 'system-prompt',
        currentStep: 1,
      });

      expect(result.config.frequency).toEqual({ mode: 'every', interval: 5 });
    });
  });

  describe('getResolutionPriority', () => {
    it('should return the resolution priority order', () => {
      const resolver = new HierarchyResolver(DEFAULT_INJECTION_CONFIG, mockLogger);

      const priority = resolver.getResolutionPriority();

      expect(priority).toContain('runtime-override');
      expect(priority).toContain('step-config');
      expect(priority).toContain('chain-config');
      expect(priority).toContain('category-config');
      expect(priority).toContain('global-config');
      expect(priority).toContain('system-default');
    });
  });

  describe('injection types', () => {
    it('should handle all injection types', () => {
      const resolver = new HierarchyResolver(DEFAULT_INJECTION_CONFIG, mockLogger);
      const types: Array<'system-prompt' | 'gate-guidance' | 'style-guidance'> = [
        'system-prompt',
        'gate-guidance',
        'style-guidance',
      ];

      for (const type of types) {
        const result = resolver.resolve(type, {
          injectionType: type,
          currentStep: 1,
        });
        expect(result).toHaveProperty('config');
        expect(result).toHaveProperty('source');
      }
    });
  });
});
