import { describe, test, expect, jest } from '@jest/globals';

import { BRIEF_END, BRIEF_START } from '../../../../src/engine/execution/delegation/brief.js';
import { ChainOperatorExecutor } from '../../../../src/engine/execution/operators/chain-operator-executor.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const prompts: ConvertedPrompt[] = [
  {
    id: 'step1',
    name: 'Step One',
    description: 'first',
    category: 'code',
    userMessageTemplate: 'Do step one: {{input}}',
    systemMessage: 'You are step one',
    arguments: [{ name: 'input', type: 'string', description: 'in', required: false }],
  },
  {
    id: 'step2',
    name: 'Step Two',
    description: 'second',
    category: 'code',
    userMessageTemplate: 'Do step two: {{previous_step_output}}',
    systemMessage: 'You are step two',
    arguments: [],
  },
  {
    id: 'step3',
    name: 'Step Three',
    description: 'third',
    category: 'code',
    userMessageTemplate: 'Do step three: {{previous_step_output}}',
    systemMessage: 'You are step three',
    arguments: [],
  },
];

describe('ChainOperatorExecutor delegation rendering (R-1)', () => {
  test('S2/S4: delegated step brief carries its OWN gate text under ### Quality Gates', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, prompts);
    const stepPrompts = [
      {
        stepNumber: 1,
        promptId: 'step1',
        args: {},
        metadata: { gateInstructions: 'GATE-A: check step one output' },
      },
      {
        stepNumber: 2,
        promptId: 'step2',
        args: {},
        delegated: true,
        metadata: { gateInstructions: 'GATE-B: check step two output' },
      },
    ];

    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts,
      currentStepIndex: 1,
      chainContext: { step_results: { '1': 'step one result' } },
    });

    expect(result.content).toContain('### Quality Gates');
    expect(result.content).toContain('GATE-B: check step two output');
    expect(result.content).not.toContain('GATE-A: check step one output');
    expect(result.currentStepDelegated).toBe(true);
  });

  test('S1: brief carries prior-step history; withholding chain_history removes it and manifests it', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, prompts);
    const stepPromptsBase = [
      { stepNumber: 1, promptId: 'step1', args: {} },
      { stepNumber: 2, promptId: 'step2', args: {} },
      { stepNumber: 3, promptId: 'step3', args: {}, delegated: true },
    ];
    const chainContext = {
      step_results: { '1': 'step one output content', '2': 'step two output content' },
    };

    const historyResult = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: stepPromptsBase,
      currentStepIndex: 2,
      chainContext,
    });

    expect(historyResult.content).toContain('### Chain History');
    expect(historyResult.content).toContain('#### Step 1');
    expect(historyResult.content).toContain('step one output content');

    // Withhold: step 1 declares withhold chain_history — reaches step 3's render.
    const withholdSteps = [
      {
        stepNumber: 1,
        promptId: 'step1',
        args: {},
        visibility: { withhold: ['chain_history' as const] },
      },
      { stepNumber: 2, promptId: 'step2', args: {} },
      { stepNumber: 3, promptId: 'step3', args: {}, delegated: true },
    ];

    const withheldResult = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: withholdSteps,
      currentStepIndex: 2,
      chainContext,
    });

    expect(withheldResult.content).not.toContain('### Chain History');
    expect(withheldResult.content).not.toContain('step one output content');
    expect(withheldResult.content).toContain(
      'CONTEXT WITHHELD (names only, values not provided): chain_history'
    );
  });

  test('S7: next-step-delegated response carries an advisory, not a handoff', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, prompts);
    const stepPrompts = [
      { stepNumber: 1, promptId: 'step1', args: {} },
      { stepNumber: 2, promptId: 'step2', args: {}, delegated: true },
    ];

    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts,
      currentStepIndex: 0,
    });

    expect(result.callToAction).not.toContain('HANDOFF INSTRUCTIONS');
    expect(result.callToAction).not.toContain('Pass ALL content above');
    expect(result.callToAction).toContain('⚡ Note');
    expect(result.nextStepDelegated).toBe(true);
    expect(result.currentStepDelegated).toBeUndefined();
  });

  test('S7: the delegated step itself carries exactly one HANDOFF INSTRUCTIONS block, after the brief', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, prompts);
    const stepPrompts = [
      { stepNumber: 1, promptId: 'step1', args: {} },
      { stepNumber: 2, promptId: 'step2', args: {}, delegated: true },
    ];

    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts,
      currentStepIndex: 1,
      chainContext: { step_results: { '1': 'step one result' } },
    });

    expect(result.content).toContain(BRIEF_START);
    expect(result.content).toContain(BRIEF_END);

    const handoffOccurrences = result.content.split('HANDOFF INSTRUCTIONS').length - 1;
    expect(handoffOccurrences).toBe(1);

    const briefEndIndex = result.content.indexOf(BRIEF_END);
    const handoffIndex = result.content.indexOf('HANDOFF INSTRUCTIONS');
    expect(briefEndIndex).toBeGreaterThanOrEqual(0);
    expect(handoffIndex).toBeGreaterThan(briefEndIndex);
    expect(result.currentStepDelegated).toBe(true);
  });

  // Ported from response-assembler-visibility.test.ts (P5 Tier 3.2) when the envelope's second
  // producer was retired (S7): the manifest wiring these pinned now lives in the operator's
  // brief, so the wiring proof moves to the producer that remains.
  test('P5 port: the delegated step’s own expose cancels the manifest and restores history', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, prompts);
    const stepPrompts = [
      {
        stepNumber: 1,
        promptId: 'step1',
        args: {},
        visibility: { withhold: ['chain_history' as const] },
      },
      { stepNumber: 2, promptId: 'step2', args: {} },
      {
        stepNumber: 3,
        promptId: 'step3',
        args: {},
        delegated: true,
        visibility: { expose: ['chain_history' as const] },
      },
    ];

    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts,
      currentStepIndex: 2,
      chainContext: { step_results: { '1': 'step one output content', '2': 'step two out' } },
    });

    expect(result.content).not.toContain('CONTEXT WITHHELD');
    expect(result.content).toContain('### Chain History');
    expect(result.content).toContain('step one output content');
  });

  test('P5 port: the manifest coexists with the brief’s Quality Gates section', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, prompts);
    const stepPrompts = [
      {
        stepNumber: 1,
        promptId: 'step1',
        args: {},
        visibility: { withhold: ['unknowns_ledger' as const] },
      },
      {
        stepNumber: 2,
        promptId: 'step2',
        args: {},
        delegated: true,
        metadata: { gateInstructions: 'GATE-D: coexistence check' },
      },
    ];

    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts,
      currentStepIndex: 1,
      chainContext: { step_results: { '1': 'step one result' } },
    });

    expect(result.content).toContain('### Quality Gates');
    expect(result.content).toContain('GATE-D: coexistence check');
    expect(result.content).toContain(
      'CONTEXT WITHHELD (names only, values not provided): unknowns_ledger'
    );
  });

  // S10: the gate-review render's synthetic identity (`__gate_review__`, stepNumber
  // stepPrompts.length + 1) is deliberate and pinned by gate-review-stage tests — but no
  // delegation advisory may originate here wearing those coordinates. The advisory for a
  // review response is assembler-owned (ResponseAssembler.buildHandoffSection resolves the
  // REAL delegated step from parsed steps; see response-assembler-delegation.test.ts). This
  // pins the producer boundary: the review render emits no advisory at all.
  test('S10: gate-review render emits no delegation advisory of its own', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, prompts);
    const stepPrompts = [
      {
        stepNumber: 1,
        promptId: 'step1',
        args: {},
        metadata: { gateInstructions: 'GATE-A: check step one output' },
      },
      { stepNumber: 2, promptId: 'step2', args: {}, delegated: true },
    ];

    const result = await executor.renderStep({
      executionType: 'gate_review',
      stepPrompts,
      chainContext: { current_step: 1, step_results: { '1': 'step one result' } },
      pendingGateReview: {
        combinedPrompt: 'Review the output',
        gateIds: ['code-quality'],
        prompts: [],
        createdAt: Date.now(),
        attemptCount: 0,
        maxAttempts: 3,
      },
      additionalGateIds: ['code-quality'],
    });

    // Synthetic identity stays on the render result (that contract is pinned elsewhere)...
    expect(result.promptId).toBe('__gate_review__');
    expect(result.promptName).toBe('Quality Gate Validation');
    // ...but no advisory line may leave this producer carrying those coordinates.
    expect(result.content).not.toContain('⚡ Note');
    expect(result.content).not.toContain('is delegated');
    expect(result.callToAction).not.toContain('⚡ Note');
    expect(result.callToAction).not.toContain('is delegated');
  });

  test('a gate-review render whose TARGET step is delegated carries that step’s brief', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, prompts);
    const stepPrompts = [
      { stepNumber: 1, promptId: 'step1', args: {} },
      {
        stepNumber: 2,
        promptId: 'step2',
        args: {},
        delegated: true,
        metadata: { gateInstructions: 'GATE-B: check step two output' },
      },
    ];

    // Since row 2.11 a phase-guard review NAMES the step it graded, so this is the case where
    // the delegated step is the one that failed its own guards — its worker's reply came back
    // without a required section. `current_step` agrees here, which is what makes this the
    // reviewed-step-is-the-standing-step shape rather than the split one.
    const result = await executor.renderStep({
      executionType: 'gate_review',
      stepPrompts,
      chainContext: { current_step: 2, step_results: { '1': 'step one result' } },
      pendingGateReview: {
        combinedPrompt: 'Review the output',
        gateIds: ['__phase_guard__'],
        prompts: [],
        createdAt: Date.now(),
        attemptCount: 0,
        maxAttempts: 3,
        metadata: { source: 'phase-guard-verification', stepNumber: 2, nodeId: 'n2' },
      },
      additionalGateIds: ['__phase_guard__'],
    });

    expect(result.content).toContain(BRIEF_START);
    expect(result.content).toContain('HANDOFF RESULT');
    expect(result.content).toContain('node: n2');
    expect(result.content).toContain('run_in_background: false');
    // The reviewed step's task is INSIDE the brief — it is what the worker is being handed.
    const briefBody = result.content.slice(
      result.content.indexOf(BRIEF_START),
      result.content.indexOf(BRIEF_END)
    );
    expect(briefBody).toContain('Original Task Instructions');
    expect(briefBody).toContain('GATE-B: check step two output');
  });

  test('a gate-review RETRY of the same delegated step renders no brief', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, prompts);
    const stepPrompts = [
      { stepNumber: 1, promptId: 'step1', args: {} },
      { stepNumber: 2, promptId: 'step2', args: {}, delegated: true },
    ];

    const result = await executor.renderStep({
      executionType: 'gate_review',
      stepPrompts,
      chainContext: { current_step: 2, step_results: { '1': 'step one result' } },
      pendingGateReview: {
        combinedPrompt: 'Review the output',
        gateIds: ['__phase_guard__'],
        prompts: [],
        createdAt: Date.now(),
        // attemptCount > 0 abbreviates the task body to "review the original task above", so a
        // brief here would hand the worker a task the retry is not asking anyone to redo.
        attemptCount: 1,
        maxAttempts: 3,
        metadata: { source: 'phase-guard-verification', stepNumber: 2, nodeId: 'n2' },
      },
      additionalGateIds: ['__phase_guard__'],
    });

    expect(result.content).not.toContain(BRIEF_START);
    expect(result.content).not.toContain('HANDOFF RESULT');
  });

  test('R-2: result contract labels the worker verdict PROPOSED', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, prompts);
    const stepPrompts = [
      { stepNumber: 1, promptId: 'step1', args: {} },
      {
        stepNumber: 2,
        promptId: 'step2',
        args: {},
        delegated: true,
        metadata: { gateInstructions: 'GATE-C: verify correctness' },
      },
    ];

    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts,
      currentStepIndex: 1,
      chainContext: { step_results: { '1': 'step one result' } },
    });

    const briefStart = result.content.indexOf(BRIEF_START);
    const briefEnd = result.content.indexOf(BRIEF_END);
    const briefBody = result.content.slice(briefStart, briefEnd);

    expect(briefBody).toContain('Proposed Gate Review');
    expect(result.callToAction).toContain('Proposed Gate Review');
    expect(result.callToAction).toContain('before submitting your gate_verdict');
  });
});
