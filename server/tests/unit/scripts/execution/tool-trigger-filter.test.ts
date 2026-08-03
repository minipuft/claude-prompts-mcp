// @lifecycle canonical - Unit tests for ToolTriggerFilter.
/**
 * ToolTriggerFilter Unit Tests
 *
 * Tests the execution mode filtering service including:
 * - Confirmation filtering (confirm: true)
 * - Confirmation response building
 * - Explicit tool request handling
 */

import {
  ToolTriggerFilter,
  createToolTriggerFilter,
  getDefaultToolTriggerFilter,
  resetDefaultToolTriggerFilter,
} from '../../../../src/modules/automation/execution/tool-trigger-filter.js';
import { resetDefaultPendingConfirmationTracker } from '../../../../src/modules/automation/execution/pending-confirmation-tracker.js';
import type {
  LoadedScriptTool,
  ToolDetectionMatch,
} from '../../../../src/modules/automation/types.js';
import { DEFAULT_EXECUTION_CONFIG } from '../../../../src/modules/automation/types.js';

describe('ToolTriggerFilter', () => {
  let service: ToolTriggerFilter;

  beforeEach(() => {
    service = createToolTriggerFilter({ debug: false });
  });

  afterEach(() => {
    resetDefaultToolTriggerFilter();
    resetDefaultPendingConfirmationTracker();
  });

  const createMockTool = (overrides: Partial<LoadedScriptTool> = {}): LoadedScriptTool => ({
    id: 'test_tool',
    name: 'Test Tool',
    description: 'A test tool',
    scriptPath: 'script.py',
    runtime: 'python',
    inputSchema: { type: 'object', properties: {} },
    toolDir: '/tmp/tools/test_tool',
    absoluteScriptPath: '/tmp/tools/test_tool/script.py',
    promptId: 'test_prompt',
    descriptionContent: 'Test tool description',
    enabled: true,
    execution: { ...DEFAULT_EXECUTION_CONFIG },
    ...overrides,
  });

  const createMockMatch = (overrides: Partial<ToolDetectionMatch> = {}): ToolDetectionMatch => ({
    toolId: 'test_tool',
    promptId: 'test_prompt',
    priority: 0.9,
    matchReason: 'schema_match',
    extractedInputs: {},
    requiresConfirmation: false,
    explicitRequest: false,
    ...overrides,
  });

  describe('filterByTrigger', () => {
    it('should pass non-confirm tools to ready for execution', () => {
      const tool = createMockTool({ execution: { ...DEFAULT_EXECUTION_CONFIG, confirm: false } });
      const match = createMockMatch({ requiresConfirmation: false });

      const result = service.filterByTrigger([match], [tool], 'test_prompt');

      expect(result.readyForExecution).toHaveLength(1);
      expect(result.readyForExecution[0].toolId).toBe('test_tool');
      expect(result.skippedManual).toHaveLength(0);
      expect(result.pendingConfirmation).toHaveLength(0);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('should add confirm tools to pending confirmation', () => {
      const tool = createMockTool({
        id: 'confirm_tool',
        name: 'Confirm Tool',
        execution: {
          ...DEFAULT_EXECUTION_CONFIG,
          confirm: true,
          confirmMessage: 'Run expensive analysis?',
        },
      });
      const match = createMockMatch({
        toolId: 'confirm_tool',
        requiresConfirmation: true,
        explicitRequest: false,
      });

      const result = service.filterByTrigger([match], [tool], 'test_prompt');

      expect(result.readyForExecution).toHaveLength(0);
      expect(result.pendingConfirmation).toHaveLength(1);
      expect(result.pendingConfirmation[0].toolId).toBe('confirm_tool');
      expect(result.pendingConfirmation[0].message).toBe('Run expensive analysis?');
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should execute confirm tools with explicit request', () => {
      const tool = createMockTool({
        id: 'confirm_tool',
        execution: { ...DEFAULT_EXECUTION_CONFIG, confirm: true },
      });
      const match = createMockMatch({
        toolId: 'confirm_tool',
        requiresConfirmation: true,
        explicitRequest: true, // User explicitly approved
      });

      const result = service.filterByTrigger([match], [tool], 'test_prompt');

      expect(result.readyForExecution).toHaveLength(1);
      expect(result.readyForExecution[0].toolId).toBe('confirm_tool');
      expect(result.pendingConfirmation).toHaveLength(0);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('should use default confirmation message when not specified', () => {
      const tool = createMockTool({
        id: 'confirm_tool',
        name: 'My Tool',
        execution: { ...DEFAULT_EXECUTION_CONFIG, confirm: true },
        // No confirmMessage specified
      });
      const match = createMockMatch({
        toolId: 'confirm_tool',
        requiresConfirmation: true,
      });

      const result = service.filterByTrigger([match], [tool], 'test_prompt');

      expect(result.pendingConfirmation[0].message).toBe('Execute My Tool?');
    });

    it('should handle mixed confirmation requirements in a single request', () => {
      const autoTool = createMockTool({
        id: 'auto_tool',
        execution: { ...DEFAULT_EXECUTION_CONFIG, confirm: false },
      });
      const confirmTool = createMockTool({
        id: 'confirm_tool',
        name: 'Confirm Tool',
        execution: { ...DEFAULT_EXECUTION_CONFIG, confirm: true },
      });
      const explicitConfirmTool = createMockTool({
        id: 'confirm_tool_explicit',
        name: 'Confirm Tool Explicit',
        execution: { ...DEFAULT_EXECUTION_CONFIG, confirm: true },
      });

      const matches = [
        createMockMatch({ toolId: 'auto_tool', requiresConfirmation: false }),
        createMockMatch({ toolId: 'confirm_tool', requiresConfirmation: true }),
        createMockMatch({
          toolId: 'confirm_tool_explicit',
          requiresConfirmation: true,
          explicitRequest: true,
        }),
      ];

      const result = service.filterByTrigger(
        matches,
        [autoTool, confirmTool, explicitConfirmTool],
        'test_prompt'
      );

      expect(result.readyForExecution).toHaveLength(2);
      expect(result.readyForExecution.map((m) => m.toolId).sort()).toEqual(
        ['auto_tool', 'confirm_tool_explicit'].sort()
      );
      expect(result.skippedManual).toHaveLength(0);
      expect(result.pendingConfirmation).toHaveLength(1);
      expect(result.pendingConfirmation[0].toolId).toBe('confirm_tool');
    });

    it('should skip matches with no matching tool', () => {
      const tool = createMockTool({ id: 'existing_tool' });
      const match = createMockMatch({ toolId: 'nonexistent_tool' });

      const result = service.filterByTrigger([match], [tool], 'test_prompt');

      expect(result.readyForExecution).toHaveLength(0);
      expect(result.skippedManual).toHaveLength(0);
      expect(result.pendingConfirmation).toHaveLength(0);
    });

    it('should default requiresConfirmation to false when undefined', () => {
      const tool = createMockTool();
      const match = createMockMatch({ requiresConfirmation: undefined });

      const result = service.filterByTrigger([match], [tool], 'test_prompt');

      expect(result.readyForExecution).toHaveLength(1);
    });
  });

  describe('buildConfirmationResponse', () => {
    it('should build structured confirmation response with re-run syntax', () => {
      const filterResult = {
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [
          {
            toolId: 'tool1',
            toolName: 'Tool One',
            message: 'Run Tool One?',
            resumeCommand: '>>test_prompt',
          },
          {
            toolId: 'tool2',
            toolName: 'Tool Two',
            message: 'Run Tool Two?',
            resumeCommand: '>>test_prompt',
          },
        ],
        requiresConfirmation: true,
      };

      const response = service.buildConfirmationResponse(filterResult, 'test_prompt');

      expect(response.type).toBe('confirmation_required');
      expect(response.tools).toHaveLength(2);
      // Resume command is now just the prompt ID (re-run to approve)
      expect(response.resumeCommand).toBe('>>test_prompt');
      expect(response.message).toContain('Tool One, Tool Two');
      expect(response.message).toContain('re-run the same command');
    });
  });

  describe('factory functions', () => {
    it('should create service with default config', () => {
      const service = createToolTriggerFilter();
      expect(service).toBeInstanceOf(ToolTriggerFilter);
    });

    it('should create service with custom config', () => {
      const service = createToolTriggerFilter({ debug: true });
      expect(service).toBeInstanceOf(ToolTriggerFilter);
    });
  });

  describe('default instance management', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getDefaultToolTriggerFilter();
      const instance2 = getDefaultToolTriggerFilter();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getDefaultToolTriggerFilter();
      resetDefaultToolTriggerFilter();
      const instance2 = getDefaultToolTriggerFilter();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('re-run to approve flow', () => {
    it('should auto-approve on re-run with same inputs', () => {
      const tool = createMockTool({
        id: 'confirm_tool',
        name: 'Confirm Tool',
        execution: { ...DEFAULT_EXECUTION_CONFIG, confirm: true },
      });
      const match = createMockMatch({
        toolId: 'confirm_tool',
        requiresConfirmation: true,
        extractedInputs: { key: 'value' },
      });

      // First call: should require confirmation
      const result1 = service.filterByTrigger([match], [tool], 'test_prompt');
      expect(result1.readyForExecution).toHaveLength(0);
      expect(result1.pendingConfirmation).toHaveLength(1);
      expect(result1.requiresConfirmation).toBe(true);

      // Second call (re-run): should auto-approve
      const result2 = service.filterByTrigger([match], [tool], 'test_prompt');
      expect(result2.readyForExecution).toHaveLength(1);
      expect(result2.readyForExecution[0].toolId).toBe('confirm_tool');
      expect(result2.pendingConfirmation).toHaveLength(0);
      expect(result2.requiresConfirmation).toBe(false);
    });

    it('should require new confirmation when inputs change', () => {
      const tool = createMockTool({
        id: 'confirm_tool',
        name: 'Confirm Tool',
        execution: { ...DEFAULT_EXECUTION_CONFIG, confirm: true },
      });

      // First call with original inputs
      const match1 = createMockMatch({
        toolId: 'confirm_tool',
        requiresConfirmation: true,
        extractedInputs: { key: 'value1' },
      });
      const result1 = service.filterByTrigger([match1], [tool], 'test_prompt');
      expect(result1.pendingConfirmation).toHaveLength(1);

      // Second call with different inputs
      const match2 = createMockMatch({
        toolId: 'confirm_tool',
        requiresConfirmation: true,
        extractedInputs: { key: 'value2' }, // Different value
      });
      const result2 = service.filterByTrigger([match2], [tool], 'test_prompt');

      // Should still require confirmation (inputs don't match)
      expect(result2.pendingConfirmation).toHaveLength(1);
      expect(result2.requiresConfirmation).toBe(true);
    });

    it('should clear pending after successful auto-approve (single use)', () => {
      const tool = createMockTool({
        id: 'confirm_tool',
        execution: { ...DEFAULT_EXECUTION_CONFIG, confirm: true },
      });
      const match = createMockMatch({
        toolId: 'confirm_tool',
        requiresConfirmation: true,
        extractedInputs: { key: 'value' },
      });

      // First call: pending
      service.filterByTrigger([match], [tool], 'test_prompt');

      // Second call: auto-approve
      const result2 = service.filterByTrigger([match], [tool], 'test_prompt');
      expect(result2.readyForExecution).toHaveLength(1);

      // Third call: should require confirmation again (pending was cleared)
      const result3 = service.filterByTrigger([match], [tool], 'test_prompt');
      expect(result3.pendingConfirmation).toHaveLength(1);
      expect(result3.requiresConfirmation).toBe(true);
    });
  });
});

describe('partitionAutoApprove', () => {
  const match = (toolId: string): ToolDetectionMatch =>
    ({ toolId, confidence: 1, extractedInputs: {} }) as unknown as ToolDetectionMatch;
  const tool = (id: string, autoApproveOnValid?: boolean): LoadedScriptTool =>
    ({
      id,
      ...(autoApproveOnValid === undefined ? {} : { execution: { autoApproveOnValid } }),
    }) as unknown as LoadedScriptTool;

  test('routes tools declaring autoApproveOnValid away from the confirmation flow', () => {
    const filter = new ToolTriggerFilter();

    const partition = filter.partitionAutoApprove(
      [match('validator'), match('formatter')],
      [tool('validator', true), tool('formatter', false)]
    );

    expect(partition.autoApprove.map((m) => m.toolId)).toEqual(['validator']);
    expect(partition.normal.map((m) => m.toolId)).toEqual(['formatter']);
  });

  test('a tool with no execution block is normal, not auto-approve', () => {
    const filter = new ToolTriggerFilter();

    const partition = filter.partitionAutoApprove([match('plain')], [tool('plain', undefined)]);

    expect(partition.autoApprove).toEqual([]);
    expect(partition.normal.map((m) => m.toolId)).toEqual(['plain']);
  });

  test('an unknown tool goes to normal rather than being granted the fast path', () => {
    // filterByTrigger skips unknown tools; granting one auto-approval would be the more
    // dangerous divergence, so the unknown case defaults to the path that asks.
    const filter = new ToolTriggerFilter();

    const partition = filter.partitionAutoApprove([match('ghost')], []);

    expect(partition.autoApprove).toEqual([]);
    expect(partition.normal.map((m) => m.toolId)).toEqual(['ghost']);
  });

  test('an empty match list partitions to two empty lists', () => {
    const filter = new ToolTriggerFilter();

    expect(filter.partitionAutoApprove([], [tool('validator', true)])).toEqual({
      autoApprove: [],
      normal: [],
    });
  });
});
