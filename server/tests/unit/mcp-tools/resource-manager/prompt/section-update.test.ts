/**
 * Tests for UPDATE_FIELDS map and !== undefined field-level update behavior.
 */

import { UPDATE_FIELDS } from '../../../../../src/mcp/tools/resource-manager/prompt/utils/validation.js';

describe('UPDATE_FIELDS map', () => {
  it('maps all expected MCP param names to camelCase data fields', () => {
    expect(UPDATE_FIELDS).toEqual({
      name: 'name',
      category: 'category',
      description: 'description',
      system_message: 'systemMessage',
      user_message_template: 'userMessageTemplate',
      arguments: 'arguments',
      chain_steps: 'chainSteps',
      gate_configuration: 'gateConfiguration',
      composer: 'composer',
      // OQ-P7-8: the five fields `PRESERVED_PROMPT_YAML_KEYS` carries forward became settable
      // (owner ruling 2026-08-13). Listed exhaustively rather than spread from the preserved
      // constant, because this assertion's job is to notice a map that grew without anyone saying
      // so — importing the growth would defeat it.
      injection: 'injection',
      register_with_mcp: 'registerWithMcp',
      mcp_prompt_mode: 'mcpPromptMode',
      subagent_model: 'subagentModel',
      agent_type: 'agentType',
    });
  });

  it('covers all updatable string fields', () => {
    const stringFields = [
      'name',
      'category',
      'description',
      'system_message',
      'user_message_template',
    ];
    for (const field of stringFields) {
      expect(UPDATE_FIELDS).toHaveProperty(field);
    }
  });

  it('covers all updatable complex fields', () => {
    const complexFields = ['arguments', 'chain_steps', 'composer'];
    for (const field of complexFields) {
      expect(UPDATE_FIELDS).toHaveProperty(field);
    }
  });

  /**
   * Inverted 2026-08-06 (plan row 1.6). This previously asserted the ABSENCE of
   * `gate_configuration`, reasoned as "(has alias handling)" — the hand-written special case in
   * `updatePrompt` that also accepted the [Framework] `gates` parameter. That alias was accepted on
   * update and silently ignored on create, which settled it as unintended; removing it left the
   * field with no reason to be special-cased.
   *
   * Worth noting how this test read before the change: it documented the implementation as though
   * it were a decision, so the alias looked deliberate to anyone who started here. A test asserting
   * that something is excluded should say what would make it includable.
   */
  it('includes gate_configuration, which no longer has special-case alias handling', () => {
    expect(UPDATE_FIELDS).toHaveProperty('gate_configuration', 'gateConfiguration');
  });

  it('does not include tools (always full replacement)', () => {
    expect(UPDATE_FIELDS).not.toHaveProperty('tools');
  });
});

describe('UPDATE_FIELDS loop behavior (integration-style)', () => {
  /**
   * Simulates the updatePrompt field merge logic using UPDATE_FIELDS.
   * This mirrors the actual handler pattern without needing the full handler.
   */
  function simulateFieldMerge(
    existing: Record<string, unknown>,
    args: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...existing };
    for (const [argKey, dataKey] of Object.entries(UPDATE_FIELDS)) {
      if (args[argKey] !== undefined) {
        result[dataKey] = args[argKey];
      }
    }
    return result;
  }

  const existingPrompt = {
    name: 'Original Name',
    category: 'testing',
    description: 'Original description',
    systemMessage: 'You are a test assistant.',
    userMessageTemplate: 'Process: {{input}}',
    arguments: [{ name: 'input', type: 'string', description: 'Input data' }],
    chainSteps: [],
  };

  it('overrides only provided fields, preserves the rest', () => {
    const result = simulateFieldMerge(existingPrompt, { description: 'New description' });
    expect(result.description).toBe('New description');
    expect(result.name).toBe('Original Name');
    expect(result.systemMessage).toBe('You are a test assistant.');
    expect(result.userMessageTemplate).toBe('Process: {{input}}');
  });

  it('clears a field when empty string is provided', () => {
    const result = simulateFieldMerge(existingPrompt, { system_message: '' });
    expect(result.systemMessage).toBe('');
    expect(result.name).toBe('Original Name');
  });

  it('clears description when empty string is provided', () => {
    const result = simulateFieldMerge(existingPrompt, { description: '' });
    expect(result.description).toBe('');
  });

  it('preserves all fields when no args provided', () => {
    const result = simulateFieldMerge(existingPrompt, {});
    expect(result).toEqual(existingPrompt);
  });

  it('updates multiple fields at once', () => {
    const result = simulateFieldMerge(existingPrompt, {
      name: 'New Name',
      description: 'New desc',
      category: 'production',
    });
    expect(result.name).toBe('New Name');
    expect(result.description).toBe('New desc');
    expect(result.category).toBe('production');
    expect(result.systemMessage).toBe('You are a test assistant.');
  });

  it('replaces arguments array entirely', () => {
    const newArgs = [
      { name: 'content', type: 'string', description: 'Content to process' },
      { name: 'mode', type: 'string', description: 'Processing mode' },
    ];
    const result = simulateFieldMerge(existingPrompt, { arguments: newArgs });
    expect(result.arguments).toEqual(newArgs);
    expect(result.name).toBe('Original Name');
  });

  it('replaces chain_steps array entirely', () => {
    const newSteps = [{ promptId: 'step1', stepName: 'Step 1' }];
    const result = simulateFieldMerge(existingPrompt, { chain_steps: newSteps });
    expect(result.chainSteps).toEqual(newSteps);
  });

  it('ignores fields not in UPDATE_FIELDS (gate_configuration, tools)', () => {
    const result = simulateFieldMerge(existingPrompt, {
      gate_configuration: { include: ['code-quality'] },
      tools: [{ id: 'my_tool' }],
    });
    // These should NOT be applied by the field map loop
    expect(result).not.toHaveProperty('gate_configuration');
    expect(result).not.toHaveProperty('tools');
  });
});
