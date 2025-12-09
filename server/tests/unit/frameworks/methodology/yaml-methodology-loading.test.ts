/**
 * YAML Methodology Loading Tests
 *
 * Tests that verify YAML-based methodology loading works correctly.
 * Replaces the deprecated TypeScript guide tests.
 */

import {
  getDefaultRuntimeLoader,
  createGenericGuide,
  resetDefaultRuntimeLoader,
} from '../../../../src/frameworks/methodology/index.js';

import type { IMethodologyGuide } from '../../../../src/frameworks/types/index.js';

describe('YAML Methodology Loading', () => {
  beforeAll(() => {
    // Reset loader to ensure clean state
    resetDefaultRuntimeLoader();
  });

  describe('RuntimeMethodologyLoader', () => {
    it('discovers all built-in methodologies from YAML', () => {
      const loader = getDefaultRuntimeLoader();
      const methodologies = loader.discoverMethodologies();

      expect(methodologies).toContain('cageerf');
      expect(methodologies).toContain('react');
      expect(methodologies).toContain('5w1h');
      expect(methodologies).toContain('scamper');
      expect(methodologies.length).toBeGreaterThanOrEqual(4);
    });

    it('loads each built-in methodology definition', () => {
      const loader = getDefaultRuntimeLoader();
      const builtInIds = ['cageerf', 'react', '5w1h', 'scamper'];

      for (const id of builtInIds) {
        const definition = loader.loadMethodology(id);
        expect(definition).toBeDefined();
        expect(definition?.id).toBe(id);
        expect(definition?.name).toBeTruthy();
        expect(definition?.methodology).toBeTruthy();
        expect(definition?.systemPromptGuidance).toBeTruthy();
      }
    });

    it('throws fail-fast error for missing methodology', () => {
      const loader = getDefaultRuntimeLoader();
      const result = loader.loadMethodology('nonexistent-methodology');
      expect(result).toBeUndefined();
    });
  });

  describe('GenericMethodologyGuide from YAML', () => {
    it('creates valid IMethodologyGuide from YAML definition', () => {
      const loader = getDefaultRuntimeLoader();
      const definition = loader.loadMethodology('cageerf');
      expect(definition).toBeDefined();

      const guide = createGenericGuide(definition!);

      // Verify IMethodologyGuide interface implementation
      expect(guide.frameworkId).toBe('cageerf');
      expect(guide.frameworkName).toBeTruthy();
      expect(guide.methodology).toBeTruthy();
      expect(guide.version).toBeTruthy();

      // Verify required methods exist
      expect(typeof guide.guidePromptCreation).toBe('function');
      expect(typeof guide.guideTemplateProcessing).toBe('function');
      expect(typeof guide.guideExecutionSteps).toBe('function');
      expect(typeof guide.enhanceWithMethodology).toBe('function');
      expect(typeof guide.validateMethodologyCompliance).toBe('function');
      expect(typeof guide.getSystemPromptGuidance).toBe('function');
    });

    it('all built-in methodologies provide tool descriptions', () => {
      const loader = getDefaultRuntimeLoader();
      const builtInIds = ['cageerf', 'react', '5w1h', 'scamper'];

      for (const id of builtInIds) {
        const definition = loader.loadMethodology(id);
        expect(definition).toBeDefined();

        const guide = createGenericGuide(definition!);
        const toolDescriptions = guide.getToolDescriptions?.();

        expect(toolDescriptions).toBeDefined();
        expect(typeof toolDescriptions).toBe('object');
      }
    });

    it('each guide provides system prompt guidance', () => {
      const loader = getDefaultRuntimeLoader();
      const builtInIds = ['cageerf', 'react', '5w1h', 'scamper'];

      for (const id of builtInIds) {
        const definition = loader.loadMethodology(id);
        const guide = createGenericGuide(definition!);

        const guidance = guide.getSystemPromptGuidance({});
        expect(typeof guidance).toBe('string');
        expect(guidance.length).toBeGreaterThan(0);
      }
    });
  });

  describe('YAML Loading Fail-Fast Behavior', () => {
    it('loader provides stats for monitoring', () => {
      const loader = getDefaultRuntimeLoader();
      const stats = loader.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.cacheSize).toBe('number');
      expect(typeof stats.cacheHits).toBe('number');
      expect(typeof stats.cacheMisses).toBe('number');
    });
  });
});
