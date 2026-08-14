// @lifecycle canonical - Coverage for ChainStepSchema.id + duplicate-id rejection (P3 Tier 1).
import { describe, expect, it } from '@jest/globals';

import {
  ChainStepSchema,
  validatePromptSchema,
  validatePromptYaml,
} from '../../../src/modules/prompts/prompt-schema.js';

function minimalYamlChain(chainSteps: Array<Record<string, unknown>>) {
  return {
    id: 'test_chain',
    name: 'Test Chain',
    description: 'A chain prompt used for id-uniqueness coverage',
    arguments: [],
    chainSteps,
  };
}

function minimalDataChain(chainSteps: Array<Record<string, unknown>>) {
  return {
    id: 'test_chain',
    name: 'Test Chain',
    category: 'general',
    description: 'A chain prompt used for id-uniqueness coverage',
    file: 'test_chain/prompt.yaml',
    arguments: [],
    chainSteps,
  };
}

describe('ChainStepSchema.id', () => {
  it('accepts a kebab-case explicit id', () => {
    const result = ChainStepSchema.safeParse({
      promptId: 'p1',
      stepName: 'Step One',
      id: 'step-one',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an omitted id (optional)', () => {
    const result = ChainStepSchema.safeParse({ promptId: 'p1', stepName: 'Step One' });
    expect(result.success).toBe(true);
  });

  it('rejects an id that is not kebab-case', () => {
    const result = ChainStepSchema.safeParse({
      promptId: 'p1',
      stepName: 'Step One',
      id: 'Step_One!',
    });
    expect(result.success).toBe(false);
  });
});

describe('validatePromptYaml — chain step id uniqueness', () => {
  it('rejects a chain with two steps sharing the same explicit id', () => {
    const result = validatePromptYaml(
      minimalYamlChain([
        { promptId: 'p1', stepName: 'Step One', id: 'dup' },
        { promptId: 'p2', stepName: 'Step Two', id: 'dup' },
      ])
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("'dup'") && e.includes('duplicated'))).toBe(true);
  });

  it('accepts a chain with distinct explicit ids', () => {
    const result = validatePromptYaml(
      minimalYamlChain([
        { promptId: 'p1', stepName: 'Step One', id: 'first' },
        { promptId: 'p2', stepName: 'Step Two', id: 'second' },
      ])
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('loads an id-less chain without regression (no id field on any step)', () => {
    const result = validatePromptYaml(
      minimalYamlChain([
        { promptId: 'p1', stepName: 'Step One' },
        { promptId: 'p2', stepName: 'Step Two' },
      ])
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data?.chainSteps?.[0]?.id).toBeUndefined();
  });

  it('does not falsely flag two absent ids as a duplicate', () => {
    // Falsification guard: an id-uniqueness check written as `seen.has(step.id)` without an
    // `if (step.id)` guard would treat two `undefined` ids as colliding.
    const result = validatePromptYaml(
      minimalYamlChain([
        { promptId: 'p1', stepName: 'Step One' },
        { promptId: 'p2', stepName: 'Step Two' },
        { promptId: 'p3', stepName: 'Step Three' },
      ])
    );

    expect(result.valid).toBe(true);
  });
});

describe('ChainStepSchema.visibility (P5 Tier 1)', () => {
  it('accepts a withhold/expose declaration using the allowed item vocabulary', () => {
    const result = ChainStepSchema.safeParse({
      promptId: 'p1',
      stepName: 'Step One',
      visibility: {
        withhold: ['chain_history'],
        expose: ['previous_step_output', 'unknowns_ledger'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an omitted visibility declaration (optional, no regression)', () => {
    const result = ChainStepSchema.safeParse({ promptId: 'p1', stepName: 'Step One' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.visibility).toBeUndefined();
  });

  it('rejects an unknown item string and names the allowed vocabulary in the error', () => {
    const result = ChainStepSchema.safeParse({
      promptId: 'p1',
      stepName: 'Step One',
      visibility: { withhold: ['not_a_real_item'] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join(' | ');
      expect(message).toContain('previous_step_output');
      expect(message).toContain('chain_history');
      expect(message).toContain('unknowns_ledger');
    }
  });

  it('rejects an unknown key inside the visibility object (strict)', () => {
    const result = ChainStepSchema.safeParse({
      promptId: 'p1',
      stepName: 'Step One',
      visibility: { hide: ['chain_history'] },
    });
    expect(result.success).toBe(false);
  });
});

describe('validatePromptYaml — chain step visibility round-trip (P5 Tier 1)', () => {
  it('preserves a declared visibility policy through validation', () => {
    const result = validatePromptYaml(
      minimalYamlChain([
        {
          promptId: 'p1',
          stepName: 'Step One',
          visibility: { withhold: ['chain_history'] },
        },
      ])
    );

    expect(result.valid).toBe(true);
    expect(result.data?.chainSteps?.[0]?.visibility).toEqual({ withhold: ['chain_history'] });
  });

  it('round-trips byte-identical when no visibility is declared (negative control)', () => {
    const result = validatePromptYaml(minimalYamlChain([{ promptId: 'p1', stepName: 'Step One' }]));

    expect(result.valid).toBe(true);
    expect(result.data?.chainSteps?.[0]?.visibility).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(result.data?.chainSteps?.[0] ?? {}, 'visibility')
    ).toBe(false);
  });

  it('rejects an invalid item string at the top-level validation entry point', () => {
    const result = validatePromptYaml(
      minimalYamlChain([
        {
          promptId: 'p1',
          stepName: 'Step One',
          visibility: { expose: ['bogus_item'] },
        },
      ])
    );

    expect(result.valid).toBe(false);
  });
});

describe('validatePromptSchema — chain step id uniqueness (PromptDataSchema path)', () => {
  it('rejects a chain with two steps sharing the same explicit id', () => {
    const result = validatePromptSchema(
      minimalDataChain([
        { promptId: 'p1', stepName: 'Step One', id: 'dup' },
        { promptId: 'p2', stepName: 'Step Two', id: 'dup' },
      ])
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("'dup'") && e.includes('duplicated'))).toBe(true);
  });

  it('loads an id-less chain without regression', () => {
    const result = validatePromptSchema(
      minimalDataChain([
        { promptId: 'p1', stepName: 'Step One' },
        { promptId: 'p2', stepName: 'Step Two' },
      ])
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
