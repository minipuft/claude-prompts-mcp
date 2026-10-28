import { describe, expect, test } from '@jest/globals';

import { PromptRequestContext } from '../../../../src/engine/execution/context/prompt-request-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';

import type { ShellVerifyResult } from '../../../../src/engine/gates/shell/types.js';
import type { PendingGateReview } from '../../../../src/shared/types/chain-execution.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

/**
 * Tests for chain-path CTA methods: buildGateReviewCTA, buildFinalStepMessage,
 * buildChainFooter (non-delegation), formatBlockedResponse, interrupt projections,
 * and advisory warnings.
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
}): PromptRequestContext {
  const context = new PromptRequestContext({
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
      // R96: a finished run offers no next step, not even one saying there is none.
      expect(footer).not.toContain('Next:');
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
      // R96 (P4.119): the review says how to answer it; a `Next:` asking for more step output
      // would invite a step the run does not have.
      expect(footer).not.toContain('Next:');
    });

    test('CONTROL: a mid-run step with a verdict outstanding keeps its Next line', () => {
      const context = createChainContext({
        currentStep: 2,
        totalSteps: 3,
        pendingReview: makePendingReview(),
      });

      const footer = assembler.buildChainFooter(context);

      expect(footer).toContain('Next: chain_id=');
      expect(footer).toContain('gate_verdict');
    });

    test('a gated render with no review pending offers the object verdict, never the string', () => {
      // R11.2: the string cannot carry a semantic report, and this line is what clients copy.
      const context = createChainContext({ currentStep: 1, totalSteps: 2 });
      context.executionResults!.metadata = { asksVerdict: true };

      const footer = assembler.buildChainFooter(context);

      expect(footer).toContain(
        'Next: chain_id="chain-test#1", user_response="<your step output>", gate_verdict={"overall": "PASS|FAIL", "rationale": "<why>"}'
      );
      expect(footer).not.toContain('GATE_REVIEW');
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

    test('an exhausted review names the gate_action moves, no verdict and no review block (P6.23)', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 3,
        pendingReview: makePendingReview({ attemptCount: 2, maxAttempts: 2, phase: 'exhausted' }),
      });

      const reply = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(reply).toContain(
        'Next: chain_id="chain-test#1", gate_action="retry" | gate_action="skip"'
      );
      expect(reply).toContain(
        'Stop the whole run at any time: chain_id="chain-test#1", gate_action="abort"'
      );
      expect(reply).toContain('No node, trailer or report is required.');
      expect(reply).not.toContain('cancel: true');
      expect(reply).not.toContain('gate_verdict');
      expect(reply).not.toContain('Gate Review Required');
      expect(reply).toContain('Progress 1/3');
    });

    test('an exhausted review on the final step still names its moves, not a verdict wait', () => {
      const context = createChainContext({
        currentStep: 3,
        totalSteps: 3,
        pendingReview: makePendingReview({ attemptCount: 2, maxAttempts: 2, phase: 'exhausted' }),
      });

      const footer = assembler.buildChainFooter(context);

      expect(footer).toContain('Progress 3/3');
      expect(footer).not.toContain('awaiting gate verdict');
      expect(footer).toContain('gate_action="retry" | gate_action="skip"');
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
      const context = new PromptRequestContext({ command: '>>demo-prompt' });
      context.state.gates.blockedGateIds = ['quality'];
      // No sessionContext at all

      const result = assembler.formatBlockedResponse(context);

      expect(result).toContain('Response Blocked');
      expect(result).not.toContain('Resume:');
    });

    // ── P4.101 ────────────────────────────────────────────────────────────────
    //
    // The blocking branch returns before the ordinary review footer, so everything that footer
    // carries — the attempt counter and the schema-validated resubmit template — was absent
    // from the one reply a caller is meant to act on.

    test('shows where the caller stands in the retry budget', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 2,
        chainId: 'chain-blocked#1',
        blockedGateIds: ['quality'],
        responseBlocked: true,
        pendingReview: makePendingReview({ attemptCount: 1, maxAttempts: 3 }),
      });

      const result = assembler.formatBlockedResponse(context);

      expect(result).toContain('**Attempt 2/3** — 1 attempt remains after this one.');
    });

    test('the blocked reply and the review footer read ONE counter', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 2,
        chainId: 'chain-blocked#1',
        blockedGateIds: ['quality'],
        responseBlocked: true,
        pendingReview: makePendingReview({ attemptCount: 2, maxAttempts: 5 }),
      });

      // Two renderings, one source. Asserting them against each other rather than against two
      // literals is what fails if a second computation appears on either side — the footer's
      // `N/M` shorthand and the block's long form must still name the same attempt.
      const blocked = assembler.formatBlockedResponse(context);
      const footer = assembler.formatChainResponse(context, { isChainFormatting: true } as never);

      expect(blocked).toContain('**Attempt 3/5**');
      expect(footer).toContain('(attempt 3/5)');
    });

    test('omits the counter when the gate allows a single attempt', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 2,
        chainId: 'chain-blocked#1',
        blockedGateIds: ['quality'],
        responseBlocked: true,
        pendingReview: makePendingReview({ attemptCount: 0, maxAttempts: 1 }),
      });

      const result = assembler.formatBlockedResponse(context);

      // "Attempt 1/1" is not a budget, and the review footer has always omitted it in this
      // state. Positive control for the absence: the reply IS a block and DOES carry a resume.
      expect(result).toContain('Response Blocked');
      expect(result).toContain('Resume:');
      expect(result).not.toMatch(/attempt 1(\/| of )1/i);
    });

    test('offers the structured verdict form and nothing else', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 2,
        chainId: 'chain-blocked#1',
        blockedGateIds: ['quality'],
        responseBlocked: true,
        pendingReview: makePendingReview({ attemptCount: 1, maxAttempts: 3 }),
      });

      const result = assembler.formatBlockedResponse(context);

      // The object form is the only shape gate_verdict accepts; a reply that taught any other
      // would cost the caller an attempt on the call where getting it wrong matters.
      expect(result).toContain('"overall": "PASS"');
      expect(result).toContain('"rationale"');
      expect(result).not.toContain('GATE_REVIEW');
      expect(result).not.toContain('legacy');
    });

    test('falls back to the bare resume line when no review is pending', () => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 2,
        chainId: 'chain-blocked#1',
        blockedGateIds: ['quality'],
        responseBlocked: true,
      });

      const result = assembler.formatBlockedResponse(context);

      // No pending review means no advertised gate list, so there is no template to key to.
      // Inventing per-gate slots would advertise a shape the caller cannot fill.
      expect(result).toContain('gate_verdict={"overall": "PASS"|"FAIL", "rationale": "<reason>"}');
      expect(result).not.toContain('"per_gate"');
      expect(result).not.toContain('GATE_REVIEW');
    });
  });

  describe('advisory warnings', () => {
    test('renders advisory warnings in single prompt', () => {
      const context = new PromptRequestContext({ command: '>>demo-prompt' });
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

    test('renders advisory warnings in the reply that completes the chain (P6.37)', () => {
      const context = createChainContext({
        currentStep: 2,
        totalSteps: 2,
        advisoryWarnings: ['Gate step-quality failed: misses the gate'],
      });
      context.state.session.chainComplete = true;

      const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

      expect(result).toContain('Chain execution complete');
      expect(result).toContain('Gate step-quality failed: misses the gate');
    });
  });

  describe('node-driven fallback readers (P4 row 5.4)', () => {
    type PrivateReaders = {
      findNextDelegatedStep: (
        context: ReturnType<typeof createChainContext>
      ) => { promptId: string } | undefined;
    };
    const readers = assembler as unknown as PrivateReaders;

    // A 3-step chain after one insertion: node ordinals are draft=1, inv-x=2, analyze=3,
    // review=4, while the parse-time stepNumbers are still 1..3. The fallback reader
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
  });
});

describe('interrupt abort projections', () => {
  test.each([false, true])(
    'soft/paused=%s offers one run abort in text and structured verbs',
    (paused) => {
      const context = createChainContext({
        currentStep: 1,
        totalSteps: 3,
        ...(paused
          ? {
              pendingReview: makePendingReview({ gateIds: ['__unknown_interrupt__'], prompts: [] }),
            }
          : {}),
      });
      context.state.session.chainInterrupt = {
        reason: 'blocking_unknown',
        unknownId: 'u1',
        statement: 'Confirm the dependency',
        openBlockingUnknowns: [{ id: 'u1', statement: 'Confirm the dependency' }],
        uninvestigatedUnknownIds: [],
        affectedStepIds: [],
        remainingNodes: [],
        paused,
      };
      const verbs = paused
        ? [
            'gate_action:resume',
            'gate_action:accept_alternative (with remainder)',
            'gate_action:abort',
          ]
        : ['answer the step', 'remainder', 'gate_action:abort'];
      const structured = assembler.buildInterruptStructuredContent(context);
      expect(structured?.['resume']).toEqual({ chain_id: 'chain-test#1', verbs });
      const text = assembler.formatChainResponse(context, { isChainFormatting: true } as any);
      for (const verb of verbs) expect(text).toContain(`- ${verb}`);
      expect(text).toContain('No node, trailer, report or retry exhaustion is required.');
      expect(text).not.toMatch(/cancel(: true)?/);
    }
  );
});

describe('a passing `:: verify:` check in the chain reply (chain-step-gates row 2.3)', () => {
  const ran = (overrides: Partial<ShellVerifyResult> = {}): ShellVerifyResult => ({
    passed: true,
    exitCode: 0,
    stdout: '144 passing',
    stderr: '',
    durationMs: 144,
    command: 'npm test',
    ...overrides,
  });

  const replyAfter = (results: ShellVerifyResult[] | undefined): string => {
    const context = createChainContext({ currentStep: 2, totalSteps: 3 });
    if (results !== undefined) context.state.gates.shellVerifyResults = results;
    return assembler.formatChainResponse(context, { isChainFormatting: true } as any);
  };

  test('the passed command, its exit code and duration follow the step it released', () => {
    const reply = replyAfter([ran()]);

    expect(reply).toContain('## Shell Verification Results');
    expect(reply).toContain(':: verify — PASSED');
    expect(reply).toContain('**Command:** `npm test`');
    expect(reply).toContain('**Exit Code:** 0');
    expect(reply).toContain('**Duration:** 144ms');
    expect(reply.indexOf('Chain step output content')).toBeLessThan(
      reply.indexOf('## Shell Verification Results')
    );
  });

  test('control: a call that ran no check shows no result section', () => {
    expect(replyAfter(undefined)).not.toContain('Shell Verification Results');
    expect(replyAfter([])).not.toContain('Shell Verification Results');
  });

  test('control: a result that did not pass is not presented as one', () => {
    expect(replyAfter([ran({ passed: false, exitCode: 1 })])).not.toContain('PASSED');
  });
});
