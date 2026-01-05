/**
 * Methodology Creation Integration Test
 *
 * Tests the complete methodology creation workflow with real modules:
 * - ConsolidatedFrameworkManager (real validation logic)
 * - MethodologyFileService (mocked filesystem)
 * - FrameworkManager (real registration)
 *
 * Mocks:
 * - Filesystem operations (controlled fixtures)
 * - FrameworkManager registry operations
 *
 * Classification: Integration (multiple real modules, mock I/O only)
 *
 * Note: The manager now requires methodology_gates for validation to pass.
 * Methodologies without all required fields will fail validation.
 */

import { describe, expect, test, jest, beforeEach } from '@jest/globals';

import type { Logger } from '../../../src/logging/index.js';
import type { ConfigManager } from '../../../src/config/index.js';
import type { FrameworkManager } from '../../../src/frameworks/framework-manager.js';
import type { ToolResponse } from '../../../src/types/index.js';
import type {
  FrameworkManagerInput,
  MethodologyCreationData,
} from '../../../src/mcp-tools/framework-manager/core/types.js';

// Import the real manager for integration testing
import { ConsolidatedFrameworkManager } from '../../../src/mcp-tools/framework-manager/core/manager.js';

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

const createMockFrameworkManager = (): FrameworkManager => {
  const registeredFrameworks = new Map<
    string,
    { id: string; name: string; type: string; enabled: boolean; description: string }
  >();

  // Mock methodology registry with all required methods
  const mockMethodologyRegistry = {
    hasGuide: jest.fn((id: string) => registeredFrameworks.has(id.toLowerCase())),
    getRuntimeLoader: jest.fn(() => ({
      clearCache: jest.fn(),
    })),
    loadAndRegisterById: jest.fn(async (id: string) => {
      // Simulate successful registration
      return { id, name: `${id} Guide` };
    }),
    unregisterGuide: jest.fn((id: string) => registeredFrameworks.delete(id.toLowerCase())),
  };

  return {
    getFramework: jest.fn((id: string) => registeredFrameworks.get(id.toLowerCase())),
    listFrameworks: jest.fn(() => Array.from(registeredFrameworks.values())),
    registerFramework: jest.fn(async (id: string) => {
      registeredFrameworks.set(id.toLowerCase(), {
        id: id.toLowerCase(),
        name: `${id} Framework`,
        type: id.toUpperCase(),
        enabled: true,
        description: '',
      });
      return true;
    }),
    unregister: jest.fn((id: string) => {
      return registeredFrameworks.delete(id.toLowerCase());
    }),
    getMethodologyGuide: jest.fn(() => null),
    getMethodologyRegistry: jest.fn(() => mockMethodologyRegistry),
  } as unknown as FrameworkManager;
};

const createMockFileService = () => {
  const writtenFiles: Map<string, MethodologyCreationData> = new Map();

  return {
    methodologyExists: jest.fn((id: string) => writtenFiles.has(id.toLowerCase())),
    deleteMethodology: jest.fn(async (id: string) => {
      writtenFiles.delete(id.toLowerCase());
      return true;
    }),
    getMethodologyDir: jest.fn((id: string) => `/test/server/resources/methodologies/${id.toLowerCase()}`),
    writeMethodologyFiles: jest.fn(async (data: MethodologyCreationData) => {
      writtenFiles.set(data.id.toLowerCase(), data);
      return {
        success: true,
        paths: [
          `/test/server/resources/methodologies/${data.id}/methodology.yaml`,
          `/test/server/resources/methodologies/${data.id}/phases.yaml`,
        ],
      };
    }),
    loadExistingMethodology: jest.fn(async (id: string) => {
      const data = writtenFiles.get(id.toLowerCase());
      if (data === undefined) return null;
      // Return ExistingMethodologyData structure (raw YAML representation)
      return {
        methodology: data as unknown as Record<string, unknown>,
        phases: null,
        systemPrompt: data.system_prompt_guidance,
        judgePrompt: null,
        methodologyPath: `/test/server/resources/methodologies/${id}/methodology.yaml`,
        phasesPath: null,
        systemPromptPath: `/test/server/resources/methodologies/${id}/system-prompt.md`,
        judgePromptPath: null,
      };
    }),
    toMethodologyCreationData: jest.fn(
      (
        id: string,
        existing: { methodology: Record<string, unknown>; systemPrompt: string | null }
      ) => {
        // Convert ExistingMethodologyData back to MethodologyCreationData
        const raw = existing.methodology;
        const name = typeof raw['name'] === 'string' ? raw['name'] : undefined;
        const systemGuidance =
          existing.systemPrompt ??
          (typeof raw['system_prompt_guidance'] === 'string'
            ? raw['system_prompt_guidance']
            : undefined);
        if (name === undefined || systemGuidance === undefined) return null;
        return {
          id,
          name,
          methodology:
            typeof raw['methodology'] === 'string' ? raw['methodology'] : id.toUpperCase(),
          system_prompt_guidance: systemGuidance,
          ...raw, // Include all other fields
        } as MethodologyCreationData;
      }
    ),
    getWrittenData: (id: string) => writtenFiles.get(id.toLowerCase()),
    clear: () => writtenFiles.clear(),
  };
};

describe('Methodology Creation Integration', () => {
  let logger: Logger;
  let configManager: ConfigManager;
  let frameworkManager: FrameworkManager;
  let mockFileService: ReturnType<typeof createMockFileService>;
  let manager: ConsolidatedFrameworkManager;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createLogger();
    configManager = createMockConfigManager();
    frameworkManager = createMockFrameworkManager();
    mockFileService = createMockFileService();

    // Create manager with mocked file service
    manager = new ConsolidatedFrameworkManager({
      logger,
      frameworkManager,
      configManager,
    });

    // Override file service with mock
    (manager as unknown as { fileService: typeof mockFileService }).fileService = mockFileService;
  });

  describe('Validation Requirements', () => {
    test('rejects methodology missing phases', async () => {
      // Arrange: Methodology without phases (should fail validation)
      const input: FrameworkManagerInput = {
        action: 'create',
        id: 'no-phases-test',
        name: 'No Phases Framework',
        system_prompt_guidance: 'Apply this methodology.',
        // Missing: phases
        // Missing: methodology_gates
      };

      // Act
      const response = await manager.handleAction(input, {});

      // Assert: Validation failure
      expect(response.isError).toBe(true);
      const text = (response.content[0] as { text: string }).text;
      expect(text).toContain('phases is required');
    });

    test('rejects methodology missing methodology_gates', async () => {
      // Arrange: Methodology with phases but no gates
      const input: FrameworkManagerInput = {
        action: 'create',
        id: 'no-gates-test',
        name: 'No Gates Framework',
        system_prompt_guidance: 'Apply this methodology.',
        phases: [
          { id: 'phase1', name: 'Phase 1', description: 'First phase' },
          { id: 'phase2', name: 'Phase 2', description: 'Second phase' },
        ],
        // Missing: methodology_gates
      };

      // Act
      const response = await manager.handleAction(input, {});

      // Assert: Validation failure
      expect(response.isError).toBe(true);
      const text = (response.content[0] as { text: string }).text;
      expect(text).toContain('methodology_gates is required');
    });

    test('creates valid methodology with all required fields', async () => {
      // Arrange: Complete methodology with all required fields
      const input: FrameworkManagerInput = {
        action: 'create',
        id: 'valid-test',
        name: 'Valid Test Framework',
        system_prompt_guidance: 'Apply this methodology systematically.',
        phases: [
          { id: 'phase1', name: 'Phase 1', description: 'First phase' },
          { id: 'phase2', name: 'Phase 2', description: 'Second phase' },
        ],
        methodology_gates: [
          {
            id: 'phase1_gate',
            name: 'Phase 1 Gate',
            description: 'Validates phase 1',
            methodologyArea: 'Phase 1',
            priority: 'high',
            validationCriteria: ['Criteria 1', 'Criteria 2'],
          },
        ],
      };

      // Act
      const response = await manager.handleAction(input, {});

      // Assert: Success
      expect(response.isError).toBe(false);
      const text = (response.content[0] as { text: string }).text;
      expect(text).toContain("'valid-test' created");
      expect(text).toMatch(/\d+%/); // Should show percentage
    });
  });

  describe('Completeness Scoring', () => {
    test('shows 80% score for minimal valid methodology', async () => {
      // Arrange: Minimal valid methodology (only required fields)
      const input: FrameworkManagerInput = {
        action: 'create',
        id: 'minimal-valid',
        name: 'Minimal Valid Framework',
        system_prompt_guidance: 'Apply this methodology.',
        phases: [
          { id: 'phase1', name: 'Phase 1', description: 'First' },
          { id: 'phase2', name: 'Phase 2', description: 'Second' },
        ],
        methodology_gates: [
          {
            id: 'gate1',
            name: 'Gate 1',
            description: 'Test gate',
            methodologyArea: 'Phase 1',
            priority: 'high',
            validationCriteria: ['Check 1'],
          },
        ],
      };

      // Act
      const response = await manager.handleAction(input, {});

      // Assert: 80% (30 guidance + 30 phases + 20 gates)
      expect(response.isError).toBe(false);
      const text = (response.content[0] as { text: string }).text;
      expect(text).toContain('80%');
    });

    test('shows higher score with optional fields', async () => {
      // Arrange: Methodology with optional fields
      const input: FrameworkManagerInput = {
        action: 'create',
        id: 'enhanced-test',
        name: 'Enhanced Test Framework',
        description: 'A complete framework', // +5%
        system_prompt_guidance: 'Apply this methodology.',
        phases: [
          { id: 'phase1', name: 'Phase 1', description: 'First' },
          { id: 'phase2', name: 'Phase 2', description: 'Second' },
        ],
        methodology_gates: [
          {
            id: 'gate1',
            name: 'Gate 1',
            description: 'Test gate',
            methodologyArea: 'Phase 1',
            priority: 'high',
            validationCriteria: ['Check 1'],
          },
        ],
        methodology_elements: { // +10%
          requiredSections: ['Phase 1', 'Phase 2'],
        },
        template_suggestions: [ // +5%
          {
            section: 'system',
            type: 'addition',
            description: 'Add guidance',
            content: 'Test',
            methodologyJustification: 'Consistency',
            impact: 'high',
          },
        ],
      };

      // Act
      const response = await manager.handleAction(input, {});

      // Assert: 100% (80 base + 5 description + 10 elements + 5 suggestions)
      expect(response.isError).toBe(false);
      const text = (response.content[0] as { text: string }).text;
      expect(text).toContain('100%');
    });
  });

  describe('Field Preservation', () => {
    test('preserves all advanced fields in written data', async () => {
      // Arrange: Methodology with all field types
      const input: FrameworkManagerInput = {
        action: 'create',
        id: 'preservation-test',
        name: 'Preservation Test',
        system_prompt_guidance: 'Test guidance',
        phases: [
          { id: 'p1', name: 'Phase 1', description: 'First' },
          { id: 'p2', name: 'Phase 2', description: 'Second' },
        ],
        methodology_gates: [
          {
            id: 'g1',
            name: 'Gate 1',
            description: 'Test gate',
            methodologyArea: 'Phase 1',
            priority: 'high',
            validationCriteria: ['criteria'],
          },
        ],
        processing_steps: [
          {
            id: 's1',
            name: 'Step 1',
            description: 'First step',
            methodologyBasis: 'Phase 1',
            order: 1,
            required: true,
          },
        ],
        execution_steps: [
          {
            id: 'e1',
            name: 'Exec 1',
            action: 'Do',
            methodologyPhase: 'Phase 1',
            dependencies: [],
            expected_output: 'Output',
          },
        ],
        quality_indicators: {
          p1: { keywords: ['test'], patterns: ['test'] },
        },
      };

      // Act
      await manager.handleAction(input, {});

      // Assert: All fields preserved in written data
      const writtenData = mockFileService.getWrittenData('preservation-test');
      expect(writtenData).toBeDefined();
      expect(writtenData?.phases).toHaveLength(2);
      expect(writtenData?.methodology_gates).toHaveLength(1);
      expect(writtenData?.processing_steps).toHaveLength(1);
      expect(writtenData?.execution_steps).toHaveLength(1);
      expect(writtenData?.quality_indicators).toHaveProperty('p1');
    });
  });

  describe('Error Handling', () => {
    test('rejects missing required fields', async () => {
      // Arrange: Missing name
      const input: FrameworkManagerInput = {
        action: 'create',
        id: 'test',
        name: '', // Empty
        system_prompt_guidance: 'Test',
      };

      // Act
      const response = await manager.handleAction(input, {});

      // Assert: Error response
      expect(response.isError).toBe(true);
      expect((response.content[0] as { text: string }).text).toContain('name is required');
    });

    test('rejects duplicate methodology ID', async () => {
      // Arrange: Create first methodology (valid)
      const firstInput: FrameworkManagerInput = {
        action: 'create',
        id: 'duplicate-test',
        name: 'First',
        system_prompt_guidance: 'Test guidance.',
        phases: [
          { id: 'p1', name: 'Phase 1', description: 'First' },
          { id: 'p2', name: 'Phase 2', description: 'Second' },
        ],
        methodology_gates: [
          {
            id: 'gate1',
            name: 'Gate 1',
            description: 'Test',
            methodologyArea: 'Phase 1',
            priority: 'high',
            validationCriteria: ['Check'],
          },
        ],
      };
      await manager.handleAction(firstInput, {});

      // Act: Try to create duplicate
      const duplicateInput: FrameworkManagerInput = {
        action: 'create',
        id: 'duplicate-test',
        name: 'Second',
        system_prompt_guidance: 'Test 2',
        phases: [
          { id: 'p1', name: 'Phase 1', description: 'First' },
          { id: 'p2', name: 'Phase 2', description: 'Second' },
        ],
        methodology_gates: [
          {
            id: 'gate1',
            name: 'Gate 1',
            description: 'Test',
            methodologyArea: 'Phase 1',
            priority: 'high',
            validationCriteria: ['Check'],
          },
        ],
      };
      const response = await manager.handleAction(duplicateInput, {});

      // Assert: Error response
      expect(response.isError).toBe(true);
      expect((response.content[0] as { text: string }).text).toContain('already exists');
    });
  });

  describe('Inspect Action', () => {
    test('shows methodology details for existing methodology', async () => {
      // Arrange: Create a methodology first
      const createInput: FrameworkManagerInput = {
        action: 'create',
        id: 'inspect-test',
        name: 'Inspect Test Framework',
        system_prompt_guidance: 'Test guidance',
        description: 'Test description',
        phases: [
          { id: 'p1', name: 'Phase 1', description: 'First' },
          { id: 'p2', name: 'Phase 2', description: 'Second' },
        ],
        methodology_gates: [
          {
            id: 'gate1',
            name: 'Gate 1',
            description: 'Test',
            methodologyArea: 'Phase 1',
            priority: 'high',
            validationCriteria: ['Check'],
          },
        ],
      };
      await manager.handleAction(createInput, {});

      // Act: Inspect the methodology
      const inspectInput: FrameworkManagerInput = {
        action: 'inspect',
        id: 'inspect-test',
      };
      const response = await manager.handleAction(inspectInput, {});

      // Assert: Should show methodology details
      expect(response.isError).toBe(false);
      const text = (response.content[0] as { text: string }).text;

      // Should show basic details
      expect(text).toContain('Methodology:');
      expect(text).toContain('ID: inspect-test');
    });
  });
});
