import { describe, expect, test } from '@jest/globals';

import {
  ChainStepSchema,
  PromptDataSchema,
  PromptYamlSchema,
  stripExporterOnlyStepKeys,
} from '../../../src/modules/prompts/prompt-schema.js';

describe('Delegation field in prompt schemas', () => {
  describe('ChainStepSchema', () => {
    const baseStep = { promptId: 'test-step', stepName: 'Test Step' };

    // Tier A: step-level `delegation` is an EXPORTER-only key. It has no runtime reader on any of
    // the three step inputs, so it is not part of the vocabulary `ChainStepSchema` now derives
    // from `workflowNodeSchema` — the schema rejects it, and every ingress function strips it
    // first so YAML the skills-sync exporter honours still loads. Prompt-LEVEL `delegation` is
    // unaffected (both prompt schemas are `.passthrough()`), which the blocks below still assert.
    test('does not declare step-level delegation — the schema rejects it', () => {
      const withKey = { ...baseStep } as Record<string, unknown>;
      withKey['delegation'] = true;
      expect(ChainStepSchema.safeParse(withKey).success).toBe(false);
      withKey['delegation'] = false;
      expect(ChainStepSchema.safeParse(withKey).success).toBe(false);
    });

    test('strips step-level delegation at ingress so the prompt still loads', () => {
      const stripped = stripExporterOnlyStepKeys({
        chainSteps: [{ ...baseStep, delegation: true }],
      }) as { chainSteps: Array<Record<string, unknown>> };
      expect(ChainStepSchema.safeParse(stripped.chainSteps[0]).success).toBe(true);
    });

    test('parses a step that never carried the key', () => {
      const result = ChainStepSchema.safeParse(baseStep);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('delegation');
      }
    });

    test('rejects a non-boolean delegation value instead of silently dropping it', () => {
      const result = ChainStepSchema.safeParse({ ...baseStep, delegation: 'yes' });
      expect(result.success).toBe(false);
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

    test('keeps agentType when the exporter-only key is stripped beside it', () => {
      const stripped = stripExporterOnlyStepKeys({
        chainSteps: [{ ...baseStep, delegation: true, agentType: 'Explore' }],
      }) as { chainSteps: Array<Record<string, unknown>> };
      const result = ChainStepSchema.safeParse(stripped.chainSteps[0]);
      expect(result.success).toBe(true);
      if (result.success) {
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

    test('accepts prompt-level delegation with chain steps carrying the exporter-only key', () => {
      // Through the ingress helper, as every real caller does: the step key is stripped, the
      // prompt-level key rides the schema's `.passthrough()` and survives.
      const result = PromptYamlSchema.safeParse(
        stripExporterOnlyStepKeys({
          id: 'chain-test',
          name: 'Chain Test',
          description: 'A chain prompt with delegation',
          delegation: true,
          chainSteps: [
            { promptId: 'step1', stepName: 'Step 1' },
            { promptId: 'step2', stepName: 'Step 2', delegation: false },
          ],
        })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBe(true);
        expect(result.data.chainSteps?.[1]).not.toHaveProperty('delegation');
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
      const result = PromptYamlSchema.safeParse(
        stripExporterOnlyStepKeys({
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
        })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delegation).toBe(true);
        expect(result.data.delegationAgent).toBe('general-purpose');
        expect(result.data.chainSteps?.[1].agentType).toBe('code-reviewer');
        expect(result.data.chainSteps?.[2]).not.toHaveProperty('delegation');
      }
    });
  });
});
