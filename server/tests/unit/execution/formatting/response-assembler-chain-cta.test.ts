import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';

import type { PendingGateReview } from '../../../../src/shared/types/chain-execution.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

/**
 * Tests for chain-path CTA methods: buildGateReviewCTA, buildFinalStepMessage,
 * buildChainFooter (non-delegation), formatBlockedResponse, and advisory warnings.
 *
 * These exercise the chain formatting path (formatChainResponse + buildChainFooter)
 * and the blocked response path (formatBlockedResponse).
 */

const assembler = new ResponseAssembler();

const basePrompt: ConvertedPrompt = {
  id: 'demo-prompt',
  name: 'Demo Prompt',
  description: 'Demo',
  category: 'development',
  userMessageTemplate: 'Test {{text}}',
  arguments: [{ name: 'text', type: 'string', description: 'Input', required: true }],
};

function createChainContext(overrides: {
  currentStep: number;
  totalSteps: number;
  chainId?: string;
  promptId?: string;
  strategy?: 'single' | 'chain';
  pendingReview?: PendingGateReview;
  advisoryWarnings?: string[];
  blockedGateIds?: string[];
  responseBlocked?: boolean;
  gateInstructions?: string;
  /**
   * The run-completion latch StepExecutionStage sets from the store's `runStatus`. The
   * assembler reads THIS, not `currentStep >= totalSteps`: standing on the final step is not
   * the same fact as having finished, and conflating them printed a completion banner one call
   * before the run could complete.
   */
  chainComplete?: boolean;
}): ExecutionContext {
  const context = new ExecutionContext({
    command: `>>${overrides.promptId ?? 'demo-prompt'}`,
  });

  context.executionResults = {
    content: 'Chain step output content',
    metadata: {},
    generatedAt: Date.now(),
  };

  context.executionPlan = {
    strategy: overrides.strategy ?? 'chain',
    gates: [],
    requiresFramework: false,
    requiresSession: true,
  };

  context.parsedCommand = {
    promptId: overrides.promptId ?? 'demo-prompt',
    rawArgs: '',
    format: 'symbolic' as const,
    confidence: 0.9,
    convertedPrompt: { ...basePrompt, id: overrides.promptId ?? 'demo-prompt' },
    promptArgs: { text: 'hello' },
    metadata: {
      originalCommand: `>>${overrides.promptId ?? 'demo-prompt'}`,
      parseStrategy: 'symbolic',
      detectedFormat: 'symbolic',
      warnings: [],
    },
  };

  context.sessionContext = {
    sessionId: `session-${Date.now()}`,
    chainId: overrides.chainId ?? 'chain-test#1',
    isChainExecution: true,
    currentStep: overrides.currentStep,
    totalSteps: overrides.totalSteps,
    ...(overrides.pendingReview != null ? { pendingReview: overrides.pendingReview } : {}),
  };

  if (overrides.advisoryWarnings != null) {
    context.state.gates.advisoryWarnings = overrides.advisoryWarnings;
  }

  if (overrides.blockedGateIds != null) {
    context.state.gates.blockedGateIds = overrides.blockedGateIds;
  }

  if (overrides.responseBlocked != null) {
    context.state.gates.responseBlocked = overrides.responseBlocked;
  }

  if (overrides.gateInstructions != null) {
    context.gateInstructions = overrides.gateInstructions;
  }

  if (overrides.chainComplete === true) {
    context.state.session.chainComplete = true;
  }

  return context;
}

function makePendingReview(overrides?: Partial<PendingGateReview>): PendingGateReview {
  return {
    combinedPrompt: 'Review the output',
    gateIds: ['intent-quality'],
    prompts: [
      {
        gateId: 'intent-quality',
        gateName: 'Intent Quality',
        criteriaSummary: 'Check intent',
      },
    ],
    createdAt: Date.now(),
    attemptCount: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

describe('ResponseAssembler – chain-path CTA methods', () => {
  describe('buildGateReviewCTA', () => {
    test('renders gate review with attempt info', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 3,
        pendingReview: makePendingReview({
          attemptCount: 1,
          maxAttempts: 3,
        }),
      });

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).toContain('Gate Review Required');
      expect(result).toContain('(attempt 2/3)');
      expect(result).toContain('chain_id=');
      expect(result).toContain('gate_verdict');
    });

    test('renders without attempt info when maxAttempts is 1', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 3,
        pendingReview: makePendingReview({
          attemptCount: 0,
          maxAttempts: 1,
        }),
      });

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).toContain('Gate Review Required');
      expect(result).not.toContain('(attempt');
    });

    test('phase guard review shows structural header', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 2,
        pendingReview: makePendingReview({
          gateIds: ['__phase_guard__'],
          prompts: [],
        }),
      });

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).toContain('Structural Review Required');
    });

    test('mixed phase guard + regular gates shows combined header', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 2,
        pendingReview: makePendingReview({
          gateIds: ['__phase_guard__', 'code-quality'],
          prompts: [
            { gateId: 'code-quality', gateName: 'Code Quality', criteriaSummary: 'Check code' },
          ],
        }),
      });

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).toContain('Structural + Gate Review Required');
    });

    test('gate review suppresses final step message', () => {
      const context = createChainContext({
        currentStep: 3,
        totalSteps: 3,
        pendingReview: makePendingReview(),
      });

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).toContain('Gate Review Required');
      expect(result).not.toContain('Chain execution complete');
    });
  });

  describe('buildFinalStepMessage + isFinalChainStep', () => {
    test('renders completion once the run has actually completed', () => {
      const context = createChainContext({
        currentStep: 3,
        totalSteps: 3,
        strategy: 'chain',
        chainComplete: true,
      });

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).toContain('Chain execution complete');
    });

    test('does not render completion when not final step', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 3,
        strategy: 'chain',
      });

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).not.toContain('Chain execution complete');
    });

    test('strategy single suppresses chain completion (Bug A guard)', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 1,
        strategy: 'single',
      });

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).not.toContain('Chain execution complete');
    });

    test('completion includes re-run CTA from buildUsageCTA', () => {
      const context = createChainContext({
        currentStep: 3,
        totalSteps: 3,
        strategy: 'chain',
        chainComplete: true,
      });

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).toContain('Chain execution complete');
      expect(result).toContain('Re-run:');
    });
  });

  describe('buildChainFooter — non-delegation paths', () => {
    test('progress line mid-chain', () => {
      const context = createChainContext({
        currentStep: 2,
        totalSteps: 4,
      });

      const footer = assembler.buildChainFooter(context);

      expect(footer).toContain('Progress 2/4');
    });

    test('completion line once the run has completed', () => {
      const context = createChainContext({
        currentStep: 3,
        totalSteps: 3,
        chainComplete: true,
      });

      const footer = assembler.buildChainFooter(context);

      expect(footer).toContain('Chain complete (3/3)');
      expect(footer).toContain('No user_response needed');
    });

    test('final step with a verdict outstanding does not claim completion', () => {
      // The P2 live-drive defect: at 3/3 with a gate review open the footer said
      // "Chain complete" and "No user_response needed", so a banner-obeying client stopped
      // driving and the run stayed `working` forever.
      const context = createChainContext({
        currentStep: 3,
        totalSteps: 3,
        pendingReview: makePendingReview(),
      });

      const footer = assembler.buildChainFooter(context);

      expect(footer).not.toContain('Chain complete');
      expect(footer).not.toContain('No user_response needed');
      expect(footer).toContain('Final step 3/3');
      expect(footer).toContain('awaiting gate verdict');
      expect(footer).toContain('gate_verdict');
    });

    test('final step with no review still asks for the step output', () => {
      const context = createChainContext({
        currentStep: 3,
        totalSteps: 3,
      });

      const footer = assembler.buildChainFooter(context);

      expect(footer).not.toContain('Chain complete');
      expect(footer).toContain('Progress 3/3');
      expect(footer).toContain('user_response="<your step output>"');
    });

    test('the final-step message waits for the latch too', () => {
      const onFinalStep = createChainContext({
        currentStep: 3,
        totalSteps: 3,
        strategy: 'chain',
      });
      expect(
        assembler.formatChainResponse(onFinalStep, { isChainFormatting: true } as any)
      ).not.toContain('Chain execution complete');
    });

    test('gate review next line when pendingReview exists', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 3,
        pendingReview: makePendingReview(),
      });

      const footer = assembler.buildChainFooter(context);

      expect(footer).toContain('gate_verdict');
      expect(footer).toContain('user_response');
    });

    test('user_response next line when no review (mid-chain)', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 3,
      });

      const footer = assembler.buildChainFooter(context);

      expect(footer).toContain('user_response');
      expect(footer).not.toContain('gate_verdict');
    });
  });

  describe('formatBlockedResponse', () => {
    test('renders blocked response with gate IDs', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 2,
        blockedGateIds: ['quality'],
        responseBlocked: true,
      });

      const result = assembler.formatBlockedResponse(context);

      expect(result).toContain('Response Blocked');
      expect(result).toContain('quality');
    });

    test('includes resume instructions with chainId', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 2,
        chainId: 'chain-blocked#1',
        blockedGateIds: ['quality'],
        responseBlocked: true,
      });

      const result = assembler.formatBlockedResponse(context);

      expect(result).toContain('Resume:');
      expect(result).toContain('chain_id="chain-blocked#1"');
    });

    test('renders without resume when no chainId', () => {
      const context = new ExecutionContext({ command: '>>demo-prompt' });
      context.state.gates.blockedGateIds = ['quality'];
      // No sessionContext at all

      const result = assembler.formatBlockedResponse(context);

      expect(result).toContain('Response Blocked');
      expect(result).not.toContain('Resume:');
    });
  });

  describe('advisory warnings', () => {
    test('renders advisory warnings in single prompt', () => {
      const context = new ExecutionContext({ command: '>>demo-prompt' });
      context.executionResults = {
        content: 'Test output',
        metadata: {},
        generatedAt: Date.now(),
      };
      context.parsedCommand = {
        promptId: 'demo-prompt',
        rawArgs: '',
        format: 'symbolic' as const,
        confidence: 0.9,
        convertedPrompt: basePrompt,
        promptArgs: { text: 'hello' },
        metadata: {
          originalCommand: '>>demo-prompt',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };
      context.state.gates.advisoryWarnings = ['Low confidence detected'];

      const result = assembler.formatSinglePromptResponse(context, {} as any);

      expect(result).toContain('Advisory Gate Warnings');
      expect(result).toContain('Low confidence detected');
    });

    test('renders advisory warnings in chain response', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 2,
        advisoryWarnings: ['Phase guard warning: check structure'],
      });

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).toContain('Advisory Gate Warnings');
      expect(result).toContain('Phase guard warning: check structure');
    });
  });

  describe('node-driven fallback readers (P4 row 5.4)', () => {
    type PrivateReaders = {
      findNextDelegatedStep: (
        context: ReturnType<typeof createChainContext>
      ) => { promptId: string } | undefined;
      resolveCurrentPrompt: (
        context: ReturnType<typeof createChainContext>
      ) => { id?: string } | undefined;
    };
    const readers = assembler as unknown as PrivateReaders;

    // A 3-step chain after one insertion: node ordinals are draft=1, inv-x=2, analyze=3,
    // review=4, while the parse-time stepNumbers are still 1..3. The two fallback readers
    // used to look parse steps up by the NODE ordinal, naming the step one early.
    const mutatedSteps = [
      { stepNumber: 1, nodeId: 'draft', promptId: 'draft', args: {} },
      { stepNumber: 2, nodeId: 'analyze', promptId: 'analyze', args: {} },
      {
        stepNumber: 3,
        nodeId: 'review',
        promptId: 'review',
        args: {},
        delegated: true,
        convertedPrompt: { id: 'review' },
      },
    ] as never[];

    function mutatedContext(currentStep: number, currentNodeId: string) {
      const context = createChainContext({ currentStep, totalSteps: 4 });
      (context.parsedCommand as { steps?: unknown }).steps = mutatedSteps;
      (context.sessionContext as { currentNodeId?: string }).currentNodeId = currentNodeId;
      return context;
    }

    it('standing on a PLANNED node post-insertion, the next delegated step is found by node id, not by the shifted ordinal', () => {
      // Node ordinal 3 = analyze; ordinal lookup would find stepNumber 3 (review) and report
      // ITS successor (none), missing the delegation entirely.
      const result = readers.findNextDelegatedStep(mutatedContext(3, 'analyze'));
      expect(result?.promptId).toBe('review');
    });

    it('standing on an INSERTED node, delegation is conservatively absent rather than one step early', () => {
      // Node ordinal 2 = inv-x; ordinal lookup would find stepNumber 2 (analyze) and claim its
      // successor review is the next step — wrong, the run's next node is analyze.
      const result = readers.findNextDelegatedStep(mutatedContext(2, 'inv-x'));
      expect(result).toBeUndefined();
    });

    it('resolveCurrentPrompt finds the completed final step by node id when its node ordinal exceeds every stepNumber', () => {
      const context = mutatedContext(4, 'review');
      (context.parsedCommand as { convertedPrompt?: unknown }).convertedPrompt = undefined;
      const prompt = readers.resolveCurrentPrompt(context);
      expect(prompt?.id).toBe('review');
    });
  });
});
