// @lifecycle test - Stage19 grades authored sentinel collisions and skips genuine structural holds.
/**
 * Real Stage19, framework registry/guide, declaration lookup, evaluator and composition.
 * Only session-store I/O is mocked. A missing declared section is the measured failure; a pending
 * structural finding is its skip twin. No native model, transport or cold-store claim is made.
 */
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import {
  composeStructuralReview,
  PHASE_GUARD_GATE_ID,
  selectToolReviewGateIds,
} from '../../../../src/engine/execution/pipeline/decisions/gates/structural-review-composition.js';
import { PhaseGuardVerificationStage } from '../../../../src/engine/execution/pipeline/stages/19-phase-guard-verification-stage.js';
import { GenericFrameworkGuide } from '../../../../src/engine/frameworks/definitions/generic-framework-guide.js';
import { FrameworkRegistry } from '../../../../src/engine/frameworks/definitions/registry.js';
import { GateDefinitionSchema } from '../../../../src/engine/gates/core/gate-schema.js';
import { noopLogger } from '../../../../src/infra/logging/index.js';

import type {
  GateReview,
  GateReviewDefinitionSnapshot,
} from '../../../../src/shared/types/chain-execution.js';
import type { ChainSessionService } from '../../../../src/shared/types/chain-session.js';

function review(gateId: string): GateReview {
  return {
    nodeId: 'n1',
    kind: 'detached',
    phase: 'awaiting-verdict',
    combinedPrompt: 'Original instructions',
    gateIds: [gateId],
    prompts: [],
    createdAt: 1,
    attemptCount: 2,
    maxAttempts: 5,
    history: [],
    metadata: { nodeId: 'n1', source: 'worker-report' },
  };
}

function authoredReview(): GateReview {
  const definition = GateDefinitionSchema.parse({
    id: PHASE_GUARD_GATE_ID,
    name: 'Authored collision',
    type: 'validation',
    description: 'Actual schema-accepted public fixture',
    pass_criteria: [{ type: 'inline_guidance' }],
  }) as GateReviewDefinitionSnapshot['definition'];
  return {
    ...review(PHASE_GUARD_GATE_ID),
    semanticContext: {
      nodeId: 'n1',
      attemptId: 'attempt-1',
      definitions: {
        [PHASE_GUARD_GATE_ID]: { definition, definitionDigest: 'frozen-public-digest' },
      },
    },
  };
}

function markedReview(open: GateReview): GateReview {
  return {
    ...open,
    ...composeStructuralReview(open, {
      gateId: PHASE_GUARD_GATE_ID,
      feedback: 'Missing context',
      retryHints: [],
      failedPhases: ['context'],
      mode: 'enforce',
      previousResponse: 'missing',
      reviewedStep: { nodeId: 'n1', stepNumber: 1 },
      maxAttempts: 3,
      createdAt: 42,
    }),
  };
}

async function execute(open: GateReview) {
  const guide = new GenericFrameworkGuide({
    id: 'fixture',
    name: 'Fixture',
    type: 'fixture',
    version: '1',
    enabled: true,
    systemPromptGuidance: '',
    phases: {
      processingSteps: [
        {
          id: 'context',
          name: 'Context',
          description: 'Declared section',
          frameworkBasis: 'Fixture',
          order: 1,
          required: true,
          section_header: '## Context',
          guards: { required: true },
        },
      ],
    },
  });
  const registry = new FrameworkRegistry(noopLogger, {
    autoLoadBuiltIn: false,
    validateOnRegistration: true,
    customGuides: [guide],
  });
  await registry.initialize();
  expect(registry.getGuide('fixture')).toBe(guide);
  const setPending = jest
    .fn<ChainSessionService['setPendingGateReview']>()
    .mockResolvedValue(undefined);
  const setReview = jest.fn<ChainSessionService['setReview']>().mockResolvedValue(undefined);
  const store = {
    getReview: () => open,
    getSession: () => ({
      state: {
        stepStates: new Map([
          ['n1', { declaredSections: ['## Context'], state: 'working', isPlaceholder: false }],
        ]),
      },
    }),
    setPendingGateReview: setPending,
    setReview,
  } as unknown as ChainSessionService;
  const context = new ExecutionContext({
    command: '>>fixture',
    user_response: 'missing the declared section',
  });
  context.sessionContext = {
    sessionId: 'session-1',
    isChainExecution: true,
    currentStep: 1,
    totalSteps: 2,
  };
  context.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };
  context.frameworkContext = {
    selectedFramework: {
      id: 'fixture',
      name: 'Fixture',
      description: 'Synthetic public framework',
      type: 'fixture',
      systemPromptTemplate: '',
      executionGuidelines: [],
      priority: 1,
      enabled: true,
    },
    systemPrompt: '',
    executionGuidelines: [],
    metadata: { confidence: 1, appliedAt: new Date(0) },
  };
  const stage = new PhaseGuardVerificationStage(
    () => ({ getFrameworkGuide: (id) => registry.getGuide(id) }),
    () => ({ mode: 'enforce', maxRetries: 2 }),
    store,
    noopLogger
  );
  await stage.execute(context);
  return { context, setPending, setReview, stage };
}

describe('PhaseGuardVerificationStage structural membership reader', () => {
  test('ordinary legacy review actually grades missing declared structure and preserves its gate', async () => {
    const open = review('ordinary-gate');
    const { context, setPending } = await execute(open);
    expect(context.state.gates.answerGrade).toMatchObject({
      kind: 'evaluated',
      result: { allPassed: false, failedPhases: ['context'] },
      holdsNodeId: 'n1',
    });
    expect(setPending).toHaveBeenCalledTimes(1);
    expect(setPending).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        gateIds: ['ordinary-gate', PHASE_GUARD_GATE_ID],
        structuralGateIds: [PHASE_GUARD_GATE_ID],
        attemptCount: 2,
        maxAttempts: 5,
      })
    );
  });

  test('unmarked authored canonical ID actually grades and composes without dropping authored authority', async () => {
    const open = authoredReview();
    const { context, setPending } = await execute(open);
    expect(context.state.gates.answerGrade).toMatchObject({
      kind: 'evaluated',
      result: { allPassed: false, failedPhases: ['context'] },
      holdsNodeId: 'n1',
    });
    expect(setPending).toHaveBeenCalledTimes(1);
    const composed = setPending.mock.calls[0][1];
    expect(composed.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
    expect(composed.structuralGateIds).toEqual([PHASE_GUARD_GATE_ID]);
    expect(composed.semanticContext).toBe(open.semanticContext);
    expect(composed.metadata?.['source']).toBe('worker-report');
    expect(composed.attemptCount).toBe(2);
    expect(composed.maxAttempts).toBe(5);
    expect(selectToolReviewGateIds(composed)).toEqual([PHASE_GUARD_GATE_ID]);
    expect(open.structuralGateIds).toBeUndefined();
  });

  test('marked authored collision already has a structural finding and skips duplicate grading', async () => {
    const open = authoredReview();
    const marked = markedReview(open);
    const { context, setPending, setReview } = await execute(marked);
    expect(context.state.gates.answerGrade).toEqual({
      kind: 'skipped',
      reason: 'Phase guard review already pending',
    });
    expect(setPending).not.toHaveBeenCalled();
    expect(setReview).not.toHaveBeenCalled();
    expect(selectToolReviewGateIds(marked)).toEqual([PHASE_GUARD_GATE_ID]);
  });

  test('contextless unmarked legacy structural review retains the original pending skip', async () => {
    const { context, setPending } = await execute(review(PHASE_GUARD_GATE_ID));
    expect(context.state.gates.answerGrade).toEqual({
      kind: 'skipped',
      reason: 'Phase guard review already pending',
    });
    expect(setPending).not.toHaveBeenCalled();
  });

  test('a passing late replacement clears structural membership and preserves the authored collision/source', async () => {
    const open = authoredReview();
    const marked = markedReview(open);
    const { context, stage, setReview } = await execute(marked);
    const cleared = await stage.gradeLateReport(
      context,
      'session-1',
      { nodeId: 'n1', stepNumber: 1 },
      marked,
      '## Context\nDeclared content.'
    );
    if (cleared === null) throw new Error('Passing replacement erased the authored requirement');
    expect(cleared?.structuralGateIds).toEqual([]);
    expect(cleared?.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
    expect(cleared?.semanticContext).toBe(open.semanticContext);
    expect(cleared?.metadata?.['source']).toBe('worker-report');
    expect(cleared?.metadata).not.toHaveProperty('failedPhases');
    expect(cleared?.metadata).not.toHaveProperty('mode');
    expect(cleared?.attemptCount).toBe(2);
    expect(cleared?.maxAttempts).toBe(5);
    expect(setReview.mock.calls).toHaveLength(1);
    expect(setReview.mock.calls[0][0]).toBe('session-1');
    expect(setReview.mock.calls[0][1]).toBe(cleared);
  });

  test('a passing late grade leaves an unmarked authored review untouched', async () => {
    const open = authoredReview();
    const { context, stage, setReview } = await execute(open);
    const unchanged = await stage.gradeLateReport(
      context,
      'session-1',
      { nodeId: 'n1', stepNumber: 1 },
      open,
      '## Context\nDeclared content.'
    );
    expect(unchanged).toBe(open);
    expect(setReview).not.toHaveBeenCalled();
    expect(unchanged?.metadata?.['source']).toBe('worker-report');
  });
});
