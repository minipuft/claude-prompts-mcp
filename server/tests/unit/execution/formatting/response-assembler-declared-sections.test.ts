import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';

import type { DeclaredSection } from '../../../../src/engine/frameworks/declared-sections.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';
import type { FrameworkExecutionContext } from '../../../../src/engine/frameworks/types/framework-types.js';

/**
 * Tests for the second declared-header injection point (Tier 2.5/2.6 of
 * plans/phase-guard-declaration-contract-2026-08-15.md, OQ-1): `formatSinglePromptResponse`
 * must push the same declared-header block the chain path renders, for exactly the executions
 * that reach stage 19 phase-guard verification — a gated single prompt (explicit `gates`, a
 * `gate` operator, or `chainSteps`), never an ungated one.
 */

const basePrompt: ConvertedPrompt = {
  id: 'test-prompt',
  name: 'Test Prompt',
  description: 'Test',
  category: 'development',
  userMessageTemplate: 'Test {{text}}',
  arguments: [{ name: 'text', type: 'string', description: 'Input', required: true }],
};

/** The four required CAGEERF sections, matching phases.yaml at HEAD 2026-08-17. */
const CAGEERF_SECTIONS: DeclaredSection[] = [
  { header: '## Context', required: true, phaseId: 'context_establishment', criteria: [] },
  { header: '## Analysis', required: true, phaseId: 'systematic_analysis', criteria: [] },
  { header: '## Goals', required: true, phaseId: 'goal_definition', criteria: [] },
  { header: '## Execution', required: true, phaseId: 'execution_planning', criteria: [] },
];

function buildFrameworkContext(id: string): FrameworkExecutionContext {
  return {
    selectedFramework: {
      id,
      name: id.toUpperCase(),
      description: 'test framework',
      type: id.toUpperCase(),
      systemPromptTemplate: '',
      executionGuidelines: [],
      applicableTypes: [],
      priority: 0,
      enabled: true,
    },
    systemPrompt: `Apply ${id}.`,
    executionGuidelines: [],
    metadata: { selectionReason: 'test', confidence: 1, appliedAt: new Date() },
  };
}

function createContext(overrides: { gated?: boolean; frameworkId?: string }): ExecutionContext {
  const context = new ExecutionContext({ command: `>>${basePrompt.id}` });

  context.executionResults = {
    content: 'Test output content',
    metadata: {},
    generatedAt: Date.now(),
  };

  context.executionPlan = {
    strategy: 'single',
    gates: overrides.gated ? ['some-gate'] : [],
    requiresFramework: overrides.frameworkId != null,
    requiresSession: Boolean(overrides.gated),
  };

  context.parsedCommand = {
    promptId: basePrompt.id,
    rawArgs: '',
    format: 'symbolic' as const,
    confidence: 0.9,
    convertedPrompt: basePrompt,
    promptArgs: { text: 'hello' },
    metadata: {
      originalCommand: `>>${basePrompt.id}`,
      parseStrategy: 'symbolic',
      detectedFormat: 'symbolic',
      warnings: [],
    },
  };

  if (overrides.frameworkId != null) {
    context.frameworkContext = buildFrameworkContext(overrides.frameworkId);
  }

  // Mirrors execution-planner.ts:427-450 / OQ-1: a GATED single prompt receives a session; an
  // UNGATED one does not. `isChainExecution: true` is set here deliberately — F2 records that
  // the flag is true for gated single prompts too, so a correct implementation must not rely on
  // it to decide whether to declare.
  if (overrides.gated) {
    context.sessionContext = {
      sessionId: 'session-declared-sections-test',
      chainId: 'chain-declared-sections-test#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 1,
    };
  }

  return context;
}

describe('ResponseAssembler – declared section headers (Tier 2.5/2.6)', () => {
  test('a gated single prompt under a guarded framework declares the headers', () => {
    const provider = jest.fn((frameworkId: string) =>
      frameworkId === 'cageerf' ? CAGEERF_SECTIONS : []
    );
    const assembler = new ResponseAssembler(undefined, provider);
    const context = createContext({ gated: true, frameworkId: 'cageerf' });

    const result = assembler.formatSinglePromptResponse(context, {} as any);

    expect(result).toContain(
      '**Required Sections** — emit these headers verbatim; they are graded structurally:'
    );
    for (const section of CAGEERF_SECTIONS) {
      expect(result).toContain(`\`${section.header}\` (required)`);
    }
    expect(provider).toHaveBeenCalledWith('cageerf');
  });

  test('an ungated single prompt under the same guarded framework declares nothing', () => {
    const provider = jest.fn((frameworkId: string) =>
      frameworkId === 'cageerf' ? CAGEERF_SECTIONS : []
    );
    const assembler = new ResponseAssembler(undefined, provider);
    // Same framework as the gated case above — the only variable is the absence of a session,
    // which is what an ungated single prompt actually looks like (execution-planner.ts:427-450).
    const context = createContext({ gated: false, frameworkId: 'cageerf' });

    const result = assembler.formatSinglePromptResponse(context, {} as any);

    expect(result).not.toContain('Required Sections');
    expect(result).not.toContain('## Context');
    // The skip happens before the provider is even asked — no session means this execution
    // will never reach stage 19, so calling the provider would be wasted work too.
    expect(provider).not.toHaveBeenCalled();
  });

  test('a gated single prompt under a framework with no guarded phases declares nothing', () => {
    // Provider resolves the framework but the framework itself declares no guards — the
    // real-world shape of resolveDeclaredSections() returning [] for a guardless framework.
    const provider = jest.fn((_frameworkId: string) => [] as DeclaredSection[]);
    const assembler = new ResponseAssembler(undefined, provider);
    const context = createContext({ gated: true, frameworkId: 'plain-framework' });

    const result = assembler.formatSinglePromptResponse(context, {} as any);

    expect(result).not.toContain('Required Sections');
    expect(provider).toHaveBeenCalledWith('plain-framework');
  });

  test('a gated single prompt with no framework selected declares nothing', () => {
    const provider = jest.fn(() => CAGEERF_SECTIONS);
    const assembler = new ResponseAssembler(undefined, provider);
    const context = createContext({ gated: true });

    const result = assembler.formatSinglePromptResponse(context, {} as any);

    expect(result).not.toContain('Required Sections');
    expect(provider).not.toHaveBeenCalled();
  });

  test('no provider wired declares nothing, even when gated under a guarded framework', () => {
    const assembler = new ResponseAssembler();
    const context = createContext({ gated: true, frameworkId: 'cageerf' });

    const result = assembler.formatSinglePromptResponse(context, {} as any);

    expect(result).not.toContain('Required Sections');
  });
});
