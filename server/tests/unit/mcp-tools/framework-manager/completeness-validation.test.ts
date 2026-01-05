/**
 * Methodology Validation Unit Tests
 *
 * Tests the validateMethodology logic which blocks creation of
 * incomplete methodologies and provides focused error guidance.
 *
 * Validation tiers (80% threshold):
 * - REQUIRED: system_prompt_guidance (30%), phases (30%), methodology_gates (20%)
 * - RECOMMENDED: methodology_elements (10%), template_suggestions (5%), description (5%)
 *
 * Classification: Unit (single class, mocked dependencies)
 */

import { describe, expect, test, jest, beforeEach } from '@jest/globals';

import type { Logger } from '../../../../src/logging/index.js';
import type { ConfigManager } from '../../../../src/config/index.js';
import type { FrameworkManager } from '../../../../src/frameworks/framework-manager.js';
import type {
  MethodologyCreationData,
  MethodologyValidationResult,
} from '../../../../src/mcp-tools/framework-manager/core/types.js';

import { ConsolidatedFrameworkManager } from '../../../../src/mcp-tools/framework-manager/core/manager.js';

// Create minimal mocks - we're testing validation logic, not integration
const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createMockConfigManager = (): ConfigManager =>
  ({
    getServerRoot: jest.fn().mockReturnValue('/test/server'),
    getConfigPath: jest.fn().mockReturnValue('/test/server/config.json'),
    getConfig: jest.fn().mockReturnValue({}),
    getFrameworksConfig: jest.fn().mockReturnValue({ enabled: true }),
    getGatesConfig: jest.fn().mockReturnValue({}),
    getChainSessionConfig: jest.fn().mockReturnValue(null),
    getInjectionConfig: jest.fn().mockReturnValue(null),
    getVersioningConfig: jest.fn().mockReturnValue({
      enabled: true,
      max_versions: 50,
      auto_version: true,
    }),
    shutdown: jest.fn(),
  }) as unknown as ConfigManager;

const createMockFrameworkManager = (): FrameworkManager =>
  ({
    getFramework: jest.fn(() => undefined),
    listFrameworks: jest.fn(() => []),
    registerFramework: jest.fn(async () => true),
    unregister: jest.fn(() => true),
    getMethodologyGuide: jest.fn(() => null),
    getMethodologyRegistry: jest.fn(() => ({
      hasGuide: jest.fn(() => false),
    })),
  }) as unknown as FrameworkManager;

/**
 * Helper to validate methodology via the manager's private method.
 * This gives us direct access to test the validation logic in isolation.
 */
function validateMethodology(
  manager: ConsolidatedFrameworkManager,
  data: MethodologyCreationData
): MethodologyValidationResult {
  return (manager as unknown as { validateMethodology: (d: MethodologyCreationData) => MethodologyValidationResult }).validateMethodology(data);
}

describe('Methodology Validation', () => {
  let logger: Logger;
  let manager: ConsolidatedFrameworkManager;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createLogger();
    manager = new ConsolidatedFrameworkManager({
      logger,
      frameworkManager: createMockFrameworkManager(),
      configManager: createMockConfigManager(),
    });
  });

  describe('Required Fields - Blocking Validation', () => {
    test('missing system_prompt_guidance blocks with error', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: '', // Empty - invalid
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('system_prompt_guidance');
      expect(result.score).toBe(0);
    });

    test('missing phases blocks with error (when system_prompt_guidance present)', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        phases: [], // Empty - invalid
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('phases');
      expect(result.score).toBe(30); // Only system_prompt_guidance counted
    });

    test('missing methodology_gates blocks with error (when phases present)', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
        methodology_gates: [], // Empty - invalid
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('methodology_gates');
      expect(result.score).toBe(60); // system_prompt_guidance + phases
    });

    test('all required fields present passes validation', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
        methodology_gates: [
          {
            id: 'g1',
            name: 'Gate 1',
            description: 'Gate desc',
            methodologyArea: 'phase1',
            priority: 'high',
            validationCriteria: ['Criterion 1'],
          },
        ],
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.score).toBe(80); // All required fields = 80%
    });
  });

  describe('Score Calculation', () => {
    test('score 0% with no valid fields', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: '', // Invalid
      };

      const result = validateMethodology(manager, data);
      expect(result.score).toBe(0);
    });

    test('score 30% with only system_prompt_guidance', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
      };

      const result = validateMethodology(manager, data);
      expect(result.score).toBe(30);
    });

    test('score 60% with system_prompt_guidance + phases', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
      };

      const result = validateMethodology(manager, data);
      expect(result.score).toBe(60);
    });

    test('score 80% with all required fields', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
        methodology_gates: [
          {
            id: 'g1',
            name: 'Gate 1',
            description: 'Gate desc',
            methodologyArea: 'phase1',
            priority: 'high',
            validationCriteria: ['Criterion 1'],
          },
        ],
      };

      const result = validateMethodology(manager, data);
      expect(result.score).toBe(80);
    });

    test('score 100% with all fields', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        description: 'A description',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
        methodology_gates: [
          {
            id: 'g1',
            name: 'Gate 1',
            description: 'Gate desc',
            methodologyArea: 'phase1',
            priority: 'high',
            validationCriteria: ['Criterion 1'],
          },
        ],
        methodology_elements: {
          requiredSections: ['Section 1'],
          sectionDescriptions: { 'Section 1': 'Description' },
        },
        template_suggestions: [
          {
            section: 'system',
            type: 'addition',
            description: 'Add header',
            content: 'Content',
            methodologyJustification: 'Reason',
            impact: 'high',
          },
        ],
      };

      const result = validateMethodology(manager, data);
      expect(result.score).toBe(100);
    });
  });

  describe('Quality Levels', () => {
    test('score < 50 yields INCOMPLETE level', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance', // 30%
      };

      const result = validateMethodology(manager, data);
      expect(result.level).toBe('incomplete');
    });

    test('score 50-79 yields STANDARD level', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }], // 60%
      };

      const result = validateMethodology(manager, data);
      expect(result.level).toBe('standard');
    });

    test('score >= 80 yields FULL level', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
        methodology_gates: [
          {
            id: 'g1',
            name: 'Gate 1',
            description: 'Gate desc',
            methodologyArea: 'phase1',
            priority: 'high',
            validationCriteria: ['Criterion 1'],
          },
        ], // 80%
      };

      const result = validateMethodology(manager, data);
      expect(result.level).toBe('full');
    });
  });

  describe('Warnings for Recommended Fields', () => {
    test('no warnings when validation fails (errors take priority)', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: '', // Invalid - will have error
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(false);
      expect(result.warnings).toHaveLength(0); // No warnings when errors present
    });

    test('generates warnings for missing recommended fields when valid', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
        methodology_gates: [
          {
            id: 'g1',
            name: 'Gate 1',
            description: 'Gate desc',
            methodologyArea: 'phase1',
            priority: 'high',
            validationCriteria: ['Criterion 1'],
          },
        ],
        // Missing: methodology_elements, template_suggestions, description
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('methodology_elements'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('template_suggestions'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('description'))).toBe(true);
    });

    test('no warnings when all recommended fields present', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        description: 'A description',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
        methodology_gates: [
          {
            id: 'g1',
            name: 'Gate 1',
            description: 'Gate desc',
            methodologyArea: 'phase1',
            priority: 'high',
            validationCriteria: ['Criterion 1'],
          },
        ],
        methodology_elements: {
          requiredSections: ['Section 1'],
          sectionDescriptions: { 'Section 1': 'Description' },
        },
        template_suggestions: [
          {
            section: 'system',
            type: 'addition',
            description: 'Add header',
            content: 'Content',
            methodologyJustification: 'Reason',
            impact: 'high',
          },
        ],
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('nextStep Guidance', () => {
    test('nextStep shows first error when invalid', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: '',
      };

      const result = validateMethodology(manager, data);

      expect(result.nextStep).toBeDefined();
      expect(result.nextStep).toContain('system_prompt_guidance');
    });

    test('nextStep shows first warning when valid but incomplete', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
        methodology_gates: [
          {
            id: 'g1',
            name: 'Gate 1',
            description: 'Gate desc',
            methodologyArea: 'phase1',
            priority: 'high',
            validationCriteria: ['Criterion 1'],
          },
        ],
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(true);
      expect(result.nextStep).toBeDefined();
      expect(result.warnings).toContain(result.nextStep);
    });

    test('nextStep is undefined when fully complete', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        description: 'A description',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
        methodology_gates: [
          {
            id: 'g1',
            name: 'Gate 1',
            description: 'Gate desc',
            methodologyArea: 'phase1',
            priority: 'high',
            validationCriteria: ['Criterion 1'],
          },
        ],
        methodology_elements: {
          requiredSections: ['Section 1'],
          sectionDescriptions: { 'Section 1': 'Description' },
        },
        template_suggestions: [
          {
            section: 'system',
            type: 'addition',
            description: 'Add header',
            content: 'Content',
            methodologyJustification: 'Reason',
            impact: 'high',
          },
        ],
      };

      const result = validateMethodology(manager, data);

      expect(result.nextStep).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    test('whitespace-only system_prompt_guidance treated as empty', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: '   \n\t  ',
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('system_prompt_guidance');
    });

    test('whitespace-only description treated as empty', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        description: '  ',
        system_prompt_guidance: 'Valid guidance',
        phases: [{ id: 'p1', name: 'Phase 1', description: 'Desc' }],
        methodology_gates: [
          {
            id: 'g1',
            name: 'Gate 1',
            description: 'Gate desc',
            methodologyArea: 'phase1',
            priority: 'high',
            validationCriteria: ['Criterion 1'],
          },
        ],
      };

      const result = validateMethodology(manager, data);

      // Still valid (description is recommended, not required)
      expect(result.valid).toBe(true);
      // But warns about missing description
      expect(result.warnings.some((w) => w.includes('description'))).toBe(true);
    });

    test('undefined phases treated as missing', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        // phases undefined
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('phases');
    });

    test('empty array phases treated as missing', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: 'Valid guidance',
        phases: [],
      };

      const result = validateMethodology(manager, data);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('phases');
    });
  });

  describe('Focused Error Reporting', () => {
    test('only one error at a time for focused guidance', () => {
      const data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: '', // Missing 1
        phases: [], // Missing 2
        methodology_gates: [], // Missing 3
      };

      const result = validateMethodology(manager, data);

      // Should only report one error for focused user guidance
      expect(result.errors).toHaveLength(1);
      // First error should be about system_prompt_guidance (checked first)
      expect(result.errors[0]).toContain('system_prompt_guidance');
    });

    test('error progression: system_prompt_guidance -> phases -> methodology_gates', () => {
      // Step 1: Missing system_prompt_guidance
      let data: MethodologyCreationData = {
        id: 'test',
        name: 'Test',
        methodology: 'TEST',
        system_prompt_guidance: '',
      };
      let result = validateMethodology(manager, data);
      expect(result.errors[0]).toContain('system_prompt_guidance');

      // Step 2: Fix system_prompt_guidance, now missing phases
      data = { ...data, system_prompt_guidance: 'Valid' };
      result = validateMethodology(manager, data);
      expect(result.errors[0]).toContain('phases');

      // Step 3: Fix phases, now missing methodology_gates
      data = { ...data, phases: [{ id: 'p1', name: 'P1', description: 'D' }] };
      result = validateMethodology(manager, data);
      expect(result.errors[0]).toContain('methodology_gates');

      // Step 4: Fix methodology_gates, now valid
      data = {
        ...data,
        methodology_gates: [
          {
            id: 'g1',
            name: 'G1',
            description: 'D',
            methodologyArea: 'p1',
            priority: 'high',
            validationCriteria: ['C1'],
          },
        ],
      };
      result = validateMethodology(manager, data);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
