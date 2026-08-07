import { describe, expect, test } from '@jest/globals';

import {
  ChainStepSchema,
  PromptDataSchema,
  PromptYamlSchema,
} from '../../../src/modules/prompts/prompt-schema.js';

describe('Delegation field in prompt schemas', () => {
  describe('ChainStepSchema', () => {
    const baseStep = { promptId: 'test-step', stepName: 'Test Step' };

    test('accepts delegation: true', () => {
      const result = ChainStepSchema.safeParse({ ...baseStep, delegation: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBeUndefined();
      }
    });

    test('accepts delegation: false', () => {
      const result = ChainStepSchema.safeParse({ ...baseStep, delegation: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBeUndefined();
      }
    });

    test('accepts missing delegation (optional)', () => {
      const result = ChainStepSchema.safeParse(baseStep);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBeUndefined();
      }
    });

    test('strips non-schema delegation values', () => {
      const result = ChainStepSchema.safeParse({ ...baseStep, delegation: 'yes' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBeUndefined();
      }
    });

    test('carries agentType through as a string', () => {
      const result = ChainStepSchema.safeParse({ ...baseStep, agentType: 'code-reviewer' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentType).toBe('code-reviewer');
      }
    });

    test('rejects an empty agentType rather than carrying a blank agent name', () => {
      const result = ChainStepSchema.safeParse({ ...baseStep, agentType: '' });
      expect(result.success).toBe(false);
    });

    test('accepts delegation with agentType together', () => {
      const result = ChainStepSchema.safeParse({
        ...baseStep,
        delegation: true,
        agentType: 'Explore',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBeUndefined();
        expect(result.data.agentType).toBe('Explore');
      }
    });

    test('accepts missing agentType (optional)', () => {
      const result = ChainStepSchema.safeParse(baseStep);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentType).toBeUndefined();
      }
    });
  });

  describe('PromptDataSchema', () => {
    const basePrompt = {
      id: 'test',
      name: 'Test Prompt',
      description: 'A test prompt',
      category: 'test',
      file: 'test.md',
      arguments: [],
    };

    test('accepts delegation: true', () => {
      const result = PromptDataSchema.safeParse({ ...basePrompt, delegation: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBe(true);
      }
    });

    test('accepts delegation: false', () => {
      const result = PromptDataSchema.safeParse({ ...basePrompt, delegation: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBe(false);
      }
    });

    test('accepts missing delegation (optional)', () => {
      const result = PromptDataSchema.safeParse(basePrompt);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBeUndefined();
      }
    });

    test('accepts delegationAgent as a string', () => {
      const result = PromptDataSchema.safeParse({
        ...basePrompt,
        delegationAgent: 'Explore',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegationAgent).toBe('Explore');
      }
    });

    test('accepts delegation with delegationAgent together', () => {
      const result = PromptDataSchema.safeParse({
        ...basePrompt,
        delegation: true,
        delegationAgent: 'code-reviewer',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBe(true);
        expect(result.data.delegationAgent).toBe('code-reviewer');
      }
    });
  });

  describe('PromptYamlSchema', () => {
    const baseYaml = {
      id: 'test',
      name: 'Test Prompt',
      description: 'A test prompt',
      userMessageTemplate: 'Hello {{name}}',
    };

    test('accepts delegation: true', () => {
      const result = PromptYamlSchema.safeParse({ ...baseYaml, delegation: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBe(true);
      }
    });

    test('accepts delegation: false', () => {
      const result = PromptYamlSchema.safeParse({ ...baseYaml, delegation: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBe(false);
      }
    });

    test('accepts missing delegation (optional)', () => {
      const result = PromptYamlSchema.safeParse(baseYaml);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBeUndefined();
      }
    });

    test('accepts delegation with chain steps', () => {
      const result = PromptYamlSchema.safeParse({
        id: 'chain-test',
        name: 'Chain Test',
        description: 'A chain prompt with delegation',
        delegation: true,
        chainSteps: [
          { promptId: 'step1', stepName: 'Step 1' },
          { promptId: 'step2', stepName: 'Step 2', delegation: false },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBe(true);
        expect(result.data.chainSteps?.[1].delegation).toBeUndefined();
      }
    });

    test('accepts delegationAgent as a string', () => {
      const result = PromptYamlSchema.safeParse({
        ...baseYaml,
        delegationAgent: 'Explore',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegationAgent).toBe('Explore');
      }
    });

    test('accepts delegation + delegationAgent + step-level agentType', () => {
      const result = PromptYamlSchema.safeParse({
        id: 'chain-agents',
        name: 'Chain with Agents',
        description: 'Chain with custom delegation agents',
        delegation: true,
        delegationAgent: 'general-purpose',
        chainSteps: [
          { promptId: 'step1', stepName: 'Step 1' },
          { promptId: 'step2', stepName: 'Step 2', agentType: 'code-reviewer' },
          { promptId: 'step3', stepName: 'Step 3', delegation: false },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBe(true);
        expect(result.data.delegationAgent).toBe('general-purpose');
        expect(result.data.chainSteps?.[1].agentType).toBe('code-reviewer');
        expect(result.data.chainSteps?.[2].delegation).toBeUndefined();
      }
    });
  });
});
