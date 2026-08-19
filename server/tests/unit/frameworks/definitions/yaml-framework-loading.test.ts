/**
 * YAML Framework Loading Tests
 *
 * Tests that verify YAML-based framework loading works correctly.
 * Replaces the deprecated TypeScript guide tests.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { jest } from '@jest/globals';

import {
  getDefaultRuntimeLoader,
  createGenericGuide,
  resetDefaultRuntimeLoader,
  RuntimeFrameworkLoader,
} from '../../../../src/engine/frameworks/definitions/index.js';

import type { FrameworkGuide } from '../../../../src/engine/frameworks/types/index.js';

// The 7 frameworks the phase-guard declaration contract plan measured as
// declaring `guards:` in phases.yaml (plans/phase-guard-declaration-contract-2026-08-15.md).
const GUARDED_BUNDLED_FRAMEWORK_IDS = [
  '5w1h',
  'cageerf',
  'focus',
  'liquescent',
  'radiant',
  'react',
  'scamper',
];

describe('YAML Framework Loading', () => {
  beforeAll(() => {
    // Reset loader to ensure clean state
    resetDefaultRuntimeLoader();
  });

  describe('RuntimeFrameworkLoader', () => {
    it('discovers all built-in frameworks from YAML', () => {
      const loader = getDefaultRuntimeLoader();
      const frameworks = loader.discoverFrameworks();

      expect(frameworks).toContain('cageerf');
      expect(frameworks).toContain('react');
      expect(frameworks).toContain('5w1h');
      expect(frameworks).toContain('scamper');
      expect(frameworks.length).toBeGreaterThanOrEqual(4);
    });

    it('loads each built-in framework definition', () => {
      const loader = getDefaultRuntimeLoader();
      const builtInIds = ['cageerf', 'react', '5w1h', 'scamper'];

      for (const id of builtInIds) {
        const definition = loader.loadFramework(id);
        expect(definition).toBeDefined();
        expect(definition?.id).toBe(id);
        expect(definition?.name).toBeTruthy();
        expect(definition?.type).toBeTruthy();
        expect(definition?.systemPromptGuidance).toBeTruthy();
      }
    });

    it('throws fail-fast error for missing framework', () => {
      const loader = getDefaultRuntimeLoader();
      const result = loader.loadFramework('nonexistent-framework');
      expect(result).toBeUndefined();
    });
  });

  describe('GenericFrameworkGuide from YAML', () => {
    it('creates valid FrameworkGuide from YAML definition', () => {
      const loader = getDefaultRuntimeLoader();
      const definition = loader.loadFramework('cageerf');
      expect(definition).toBeDefined();

      const guide = createGenericGuide(definition!);

      // Verify FrameworkGuide interface implementation
      expect(guide.frameworkId).toBe('cageerf');
      expect(guide.frameworkName).toBeTruthy();
      expect(guide.type).toBeTruthy();
      expect(guide.version).toBeTruthy();

      // Verify required methods exist
      expect(typeof guide.guidePromptCreation).toBe('function');
      expect(typeof guide.guideTemplateProcessing).toBe('function');
      expect(typeof guide.guideExecutionSteps).toBe('function');
      expect(typeof guide.enhanceWithFramework).toBe('function');
      expect(typeof guide.validateFrameworkCompliance).toBe('function');
      expect(typeof guide.getSystemPromptGuidance).toBe('function');
    });

    it('all built-in frameworks provide tool descriptions', () => {
      const loader = getDefaultRuntimeLoader();
      const builtInIds = ['cageerf', 'react', '5w1h', 'scamper'];

      for (const id of builtInIds) {
        const definition = loader.loadFramework(id);
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
        const definition = loader.loadFramework(id);
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

  // Tier 3.3/3.4 of plans/phase-guard-declaration-contract-2026-08-15.md: wires the
  // previously-dead validatePhasesSchema (F1) into the loader so a guards block with
  // no section_header is refused at load, instead of reaching the runtime evaluator
  // unaddressable. These tests seed throwaway framework directories under a temp dir
  // and point a loader instance directly at it — no bundled resource is modified.
  describe('Phase validation wiring (F1 — validatePhasesSchema)', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'phase-guard-loader-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    function seedFramework(id: string, phasesYaml: string): void {
      const dir = join(tmpDir, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'framework.yaml'),
        [
          `id: ${id}`,
          `name: Test ${id}`,
          'type: TEST',
          'version: 1.0.0',
          'enabled: true',
          'phasesFile: phases.yaml',
          'systemPromptGuidance: Test guidance for phase validation wiring.',
          '',
        ].join('\n')
      );
      writeFileSync(join(dir, 'phases.yaml'), phasesYaml);
    }

    it('refuses a framework whose guards block has no section_header, naming the phase id', () => {
      seedFramework(
        'guardless-header',
        [
          'processingSteps:',
          '  - id: bad_phase',
          '    name: Bad Phase',
          '    description: Missing section header deliberately.',
          '    frameworkBasis: test',
          '    order: 1',
          '    required: true',
          '    guards:',
          '      required: true',
          '      min_length: 10',
          'executionSteps: []',
          '',
        ].join('\n')
      );

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const loader = new RuntimeFrameworkLoader({ frameworksDir: tmpDir, enableCache: false });
        const definition = loader.loadFramework('guardless-header');

        expect(definition).toBeUndefined();
        const messages = errorSpy.mock.calls.map((call) => call.join(' ')).join(' | ');
        expect(messages).toContain('bad_phase');
        expect(messages).toContain('guards');
        expect(messages).toContain('section_header');
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('still loads a framework whose guarded phase declares a section_header', () => {
      seedFramework(
        'guarded-with-header',
        [
          'processingSteps:',
          '  - id: good_phase',
          '    name: Good Phase',
          '    description: Declares both guards and a section_header.',
          '    frameworkBasis: test',
          '    order: 1',
          '    required: true',
          "    section_header: '## Context'",
          '    guards:',
          '      required: true',
          '      min_length: 10',
          'executionSteps: []',
          '',
        ].join('\n')
      );

      const loader = new RuntimeFrameworkLoader({ frameworksDir: tmpDir, enableCache: false });
      const definition = loader.loadFramework('guarded-with-header');

      expect(definition).toBeDefined();
      expect(definition?.id).toBe('guarded-with-header');
    });

    it('loads all 7 bundled guarded frameworks clean with the phases validator live', () => {
      resetDefaultRuntimeLoader();
      const loader = getDefaultRuntimeLoader();
      const ids = loader.discoverFrameworks();

      // The regression this test guards: waking a validator that has never run
      // must not newly refuse resources that shipped green.
      expect(ids).toEqual(expect.arrayContaining(GUARDED_BUNDLED_FRAMEWORK_IDS));

      for (const id of ids) {
        const definition = loader.loadFramework(id);
        expect(definition).toBeDefined();
      }

      expect(loader.getStats().loadErrors).toBe(0);
      resetDefaultRuntimeLoader();
    });
  });
});
