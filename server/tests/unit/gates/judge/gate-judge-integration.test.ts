import { describe, expect, it, jest } from '@jest/globals';

import {
  resolveJudgeGates,
  composeJudgeReviewPrompt,
} from '../../../../src/engine/gates/core/review-utils.js';
import { GATE_VERDICT_REQUIRED_FORMAT } from '../../../../src/engine/gates/core/gate-verdict-contract.js';

import type { GateDefinitionProvider } from '../../../../src/engine/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../../src/engine/gates/types.js';

function createMockGateLoader(
  gates: Record<string, LightweightGateDefinition>
): GateDefinitionProvider {
  return {
    loadGate: jest.fn<(id: string) => Promise<LightweightGateDefinition | null>>(
      async (id: string) => gates[id] ?? null
    ),
    loadGates: jest.fn(
      async (ids: string[]) =>
        ids.map((id) => gates[id]).filter(Boolean) as LightweightGateDefinition[]
    ),
    getActiveGates: jest.fn(async () => ({
      activeGates: [],
      guidanceText: [],
      validationGates: [],
    })),
    listAvailableGates: jest.fn(async () => Object.keys(gates)),
    listAvailableGateDefinitions: jest.fn(async () => Object.values(gates)),
    clearCache: jest.fn(),
    isGateActive: jest.fn(() => true),
    getStatistics: jest.fn(() => ({
      cachedGates: 0,
      totalLoads: 0,
      lastAccess: null,
    })),
    isMethodologyGate: jest.fn(async () => false),
    isMethodologyGateCached: jest.fn(() => false),
    getMethodologyGateIds: jest.fn(async () => []),
  } as unknown as GateDefinitionProvider;
}

const baseGate: LightweightGateDefinition = {
  id: 'code-quality',
  name: 'Code Quality',
  type: 'validation',
  description: 'Validates code quality',
  guidance: 'Check for proper error handling and clean code.',
  pass_criteria: [
    {
      type: 'inline_guidance',
      min_length: 100,
      required_patterns: ['function', 'return'],
    },
  ],
};

describe('resolveJudgeGates', () => {
  it('categorizes gates into judge and self based on evaluation config', async () => {
    const judgeGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'judge-gate',
      evaluation: { mode: 'judge', strict: true },
    };
    const selfGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'self-gate',
      evaluation: { mode: 'self' },
    };

    const loader = createMockGateLoader({
      'judge-gate': judgeGate,
      'self-gate': selfGate,
    });

    const result = await resolveJudgeGates(['judge-gate', 'self-gate'], loader);

    expect(result.judgeGates).toHaveLength(1);
    expect(result.judgeGates[0]?.id).toBe('judge-gate');
    expect(result.selfGates).toHaveLength(1);
    expect(result.selfGates[0]?.id).toBe('self-gate');
  });

  it('uses global defaults when gate has no evaluation config', async () => {
    const gateNoConfig: LightweightGateDefinition = {
      ...baseGate,
      id: 'no-config-gate',
    };

    const loader = createMockGateLoader({ 'no-config-gate': gateNoConfig });

    // Default mode is 'self', so no judge gates
    const result = await resolveJudgeGates(['no-config-gate'], loader);
    expect(result.judgeGates).toHaveLength(0);
    expect(result.selfGates).toHaveLength(1);

    // With global default 'judge', the gate becomes judge
    const resultWithDefaults = await resolveJudgeGates(['no-config-gate'], loader, {
      defaultMode: 'judge',
      strict: true,
    });
    expect(resultWithDefaults.judgeGates).toHaveLength(1);
    expect(resultWithDefaults.selfGates).toHaveLength(0);
  });

  it('skips gates that cannot be loaded', async () => {
    const loader = createMockGateLoader({ 'existing-gate': baseGate });

    const result = await resolveJudgeGates(['existing-gate', 'missing-gate'], loader);

    expect(result.selfGates).toHaveLength(1);
    expect(result.judgeGates).toHaveLength(0);
  });
});

describe('composeJudgeReviewPrompt', () => {
  it('returns empty result for no judge gates', () => {
    const result = composeJudgeReviewPrompt([], 'some output');
    expect(result.hasJudgeGates).toBe(false);
    expect(result.judgePrompt).toBe('');
    expect(result.judgeGateIds).toEqual([]);
  });

  it('builds judge prompt from a single gate', () => {
    const judgeGate: LightweightGateDefinition = {
      ...baseGate,
      evaluation: { mode: 'judge', model: 'haiku', strict: true },
    };

    const result = composeJudgeReviewPrompt([judgeGate], 'function add(a, b) { return a + b; }');

    expect(result.hasJudgeGates).toBe(true);
    expect(result.judgeGateIds).toEqual(['code-quality']);
    expect(result.modelHint).toBe('haiku');
    expect(result.judgePrompt).toContain('## Judge Evaluation');
    expect(result.judgePrompt).toContain('independent quality reviewer');
    expect(result.judgePrompt).toContain('function add(a, b)');
    expect(result.judgePrompt).toContain(GATE_VERDICT_REQUIRED_FORMAT);
  });

  it('includes formatted pass_criteria in judge prompt', () => {
    const judgeGate: LightweightGateDefinition = {
      ...baseGate,
      evaluation: { mode: 'judge' },
    };

    const result = composeJudgeReviewPrompt([judgeGate], 'test output');

    // Should contain formatted criterion text from structured pass_criteria
    expect(result.judgePrompt).toContain('at least 100 characters');
    expect(result.judgePrompt).toContain('function, return');
  });

  it('includes guidance text as criteria', () => {
    const judgeGate: LightweightGateDefinition = {
      id: 'test',
      name: 'Test Gate',
      type: 'validation',
      description: 'Test',
      guidance: 'Follow clean code principles',
      evaluation: { mode: 'judge' },
    };

    const result = composeJudgeReviewPrompt([judgeGate], 'test output');
    expect(result.judgePrompt).toContain('Follow clean code principles');
  });

  it('merges criteria from multiple judge gates', () => {
    const gate1: LightweightGateDefinition = {
      id: 'gate-1',
      name: 'Gate One',
      type: 'validation',
      description: 'First gate',
      guidance: 'Check error handling',
      evaluation: { mode: 'judge', model: 'haiku' },
    };
    const gate2: LightweightGateDefinition = {
      id: 'gate-2',
      name: 'Gate Two',
      type: 'validation',
      description: 'Second gate',
      guidance: 'Check type safety',
      evaluation: { mode: 'judge' },
    };

    const result = composeJudgeReviewPrompt([gate1, gate2], 'test output');

    expect(result.judgeGateIds).toEqual(['gate-1', 'gate-2']);
    expect(result.modelHint).toBe('haiku'); // From first gate
    expect(result.judgePrompt).toContain('Check error handling');
    expect(result.judgePrompt).toContain('Check type safety');
    expect(result.judgePrompt).toContain('Combined Review');
  });

  it('uses strict protocol by default for judge mode', () => {
    const judgeGate: LightweightGateDefinition = {
      ...baseGate,
      evaluation: { mode: 'judge' },
    };

    const result = composeJudgeReviewPrompt([judgeGate], 'test output');
    expect(result.judgePrompt).toContain('**FAILS**');
    expect(result.judgePrompt).toContain('Only PASS if you cannot find genuine failures');
  });

  it('uses balanced protocol when strict is false', () => {
    const judgeGate: LightweightGateDefinition = {
      ...baseGate,
      evaluation: { mode: 'judge', strict: false },
    };

    const result = composeJudgeReviewPrompt([judgeGate], 'test output');
    expect(result.judgePrompt).not.toContain('**FAILS**');
    expect(result.judgePrompt).toContain('substantially meets all criteria');
  });

  it('strips generation context — no chain history or framework', () => {
    const judgeGate: LightweightGateDefinition = {
      ...baseGate,
      evaluation: { mode: 'judge' },
    };

    const result = composeJudgeReviewPrompt([judgeGate], 'test output');
    expect(result.judgePrompt).not.toContain('Chain History');
    expect(result.judgePrompt).not.toContain('Framework');
    expect(result.judgePrompt).not.toContain('CAGEERF');
    expect(result.judgePrompt).not.toContain('EXECUTION CONTEXT');
  });
});
