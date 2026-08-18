import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';

/**
 * R-1/S7 retarget (2026-08-18): the assembler no longer renders a full handoff for a NEXT
 * delegated step — that CTA was phase-shifted (it described step N+1 while "Pass ALL content
 * above" pointed at step N's content). The assembler now emits a ONE-LINE advisory for a
 * next-delegated step, and the handoff FOOTER line fires only when the CURRENT step is
 * delegated (its response carries the EXECUTION BRIEF, rendered by ChainOperatorExecutor).
 * Client-profile strategy bodies ("Tool: spawn_agent" etc.) moved with the handoff to the
 * operator's brief response; the per-profile FOOTER instruction remains assembler-owned and is
 * what the strategy tests below assert.
 */
describe('ResponseAssembler – delegation detection from parsed steps', () => {
  const assembler = new ResponseAssembler();

  /** Identity context fixture for a client profile. */
  function setClientProfile(
    context: ExecutionContext,
    clientFamily: string,
    clientId: string,
    delegationProfile: string
  ): void {
    const clientProfile = {
      clientFamily,
      clientId,
      clientVersion: '1.0.0',
      delegationProfile,
    };
    context.state.identity.context = {
      identity: {
        organizationId: 'org-a',
        workspaceId: 'workspace-a',
        identitySource: 'default',
        clientProfile,
      },
      organizationId: 'org-a',
      workspaceId: 'workspace-a',
      continuityScopeId: 'workspace-a',
      identitySource: 'default',
      organizationSource: 'default',
      clientProfile,
    } as any;
  }

  test('emits a one-line advisory when next step has delegated flag (parsed steps)', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-deleg#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 3,
    };
    // Simulate parsed steps with delegation on step 2
    (context as any).parsedCommand = {
      promptId: 'demo',
      steps: [
        { stepNumber: 1, promptId: 'first', args: {} },
        { stepNumber: 2, promptId: 'second', args: {}, delegated: true },
        { stepNumber: 3, promptId: 'third', args: {} },
      ],
    };
    context.executionResults = {
      content: 'Step 1 rendered content',
      metadata: {}, // No nextStepDelegated from StepExecutionStage (pendingReview blocked it)
      generatedAt: Date.now(),
    };

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

    // (S7) Advisory only — the full handoff renders with step 2's own brief, one resume later
    expect(result).toContain('⚡ Note');
    expect(result).toContain('Step 2');
    expect(result).toContain('second');
    expect(result).not.toContain('HANDOFF INSTRUCTIONS');
    // (S7) Footer does NOT show a handoff line for a next-delegated step — this response has no brief
    expect(result).not.toContain('Handoff via Task tool');
  });

  test('emits the advisory from StepExecutionStage metadata when available', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-2',
      chainId: 'chain-meta#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
    };
    context.executionResults = {
      content: 'Step 1 output',
      metadata: {
        nextStepDelegated: true,
        stepNumber: 1,
        totalSteps: 2,
        promptName: 'research',
      },
      generatedAt: Date.now(),
    };

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

    expect(result).toContain('⚡ Note');
    expect(result).toContain('research');
    expect(result).not.toContain('HANDOFF INSTRUCTIONS');
  });

  test('codex client profile selects the codex handoff footer for a delegated CURRENT step', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-codex',
      chainId: 'chain-codex#1',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 2,
    };
    setClientProfile(context, 'codex', 'codex-cli', 'spawn_agent_v1');
    // (S7) The footer handoff line now keys on the CURRENT step being delegated — this
    // response carries the brief, so the footer directs spawn-then-resume.
    context.executionResults = {
      content: 'Step 2 brief-bearing content',
      metadata: {
        currentStepDelegated: true,
        stepNumber: 2,
        totalSteps: 2,
        promptName: 'review',
      },
      generatedAt: Date.now(),
    };

    const footer = assembler.buildChainFooter(context);

    expect(footer).toContain('Handoff via Codex agent capability (spawn_agent preferred)');
  });

  test('gemini client profile selects the gemini handoff footer for a delegated CURRENT step', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-gemini',
      chainId: 'chain-gemini#1',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 2,
    };
    setClientProfile(context, 'gemini', 'gemini', 'gemini_subagent_v1');
    context.executionResults = {
      content: 'Step 2 brief-bearing content',
      metadata: {
        currentStepDelegated: true,
        stepNumber: 2,
        totalSteps: 2,
        promptName: 'review',
      },
      generatedAt: Date.now(),
    };

    const footer = assembler.buildChainFooter(context);

    expect(footer).toContain('Handoff via Gemini sub-agent capability');
  });

  test('cursor client profile selects the experimental cursor footer for a delegated CURRENT step', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-cursor',
      chainId: 'chain-cursor#1',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 2,
    };
    setClientProfile(context, 'cursor', 'cursor', 'cursor_agent_v1');
    context.executionResults = {
      content: 'Step 2 brief-bearing content',
      metadata: {
        currentStepDelegated: true,
        stepNumber: 2,
        totalSteps: 2,
        promptName: 'review',
      },
      generatedAt: Date.now(),
    };

    const footer = assembler.buildChainFooter(context);

    expect(footer).toContain('Handoff via Cursor agent capability (experimental/testing)');
  });

  test('does not inject advisory or handoff when no delegation detected', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-3',
      chainId: 'chain-no-deleg#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
    };
    (context as any).parsedCommand = {
      promptId: 'demo',
      steps: [
        { stepNumber: 1, promptId: 'first', args: {} },
        { stepNumber: 2, promptId: 'second', args: {} }, // no delegated flag
      ],
    };
    context.executionResults = {
      content: 'Normal step output',
      metadata: {},
      generatedAt: Date.now(),
    };

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

    expect(result).not.toContain('⚡ Note');
    expect(result).not.toContain('HANDOFF');
    expect(result).not.toContain('Handoff via Task tool');
  });

  test('advisory coexists with gate instructions in output', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-4',
      chainId: 'chain-gates-deleg#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
    };
    (context as any).parsedCommand = {
      promptId: 'demo',
      steps: [
        { stepNumber: 1, promptId: 'first', args: {} },
        { stepNumber: 2, promptId: 'delegated-step', args: {}, delegated: true },
      ],
    };
    // Gate instructions from GateEnhancementStage
    context.gateInstructions = '### Quality Gates\nEnsure code quality meets criteria.';
    context.executionResults = {
      content: 'Step 1 with gates',
      metadata: {},
      generatedAt: Date.now(),
    };

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);

    // BOTH gate instructions AND the advisory present
    expect(result).toContain('Quality Gates');
    expect(result).toContain('⚡ Note');
    expect(result).toContain('delegated-step');
    // (S7) The envelope is retired: gate text for the delegated step travels in ITS brief,
    // rendered by the operator — never in this response's advisory.
    expect(result).not.toContain('EXECUTION CONTEXT');
  });

  test('footer shows the handoff Next line over gate review only for a delegated CURRENT step', () => {
    const pendingReview = {
      combinedPrompt: 'review',
      gateIds: ['quality'],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 0,
      maxAttempts: 2,
    } as any;

    // Case 1 (S7 flip): NEXT-step delegation no longer wins the footer — the gate review line
    // renders, because this response carries no brief to hand off.
    const nextDelegated = new ExecutionContext({ command: 'noop' });
    nextDelegated.sessionContext = {
      sessionId: 'sess-5',
      chainId: 'chain-both#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 3,
      pendingReview,
    };
    (nextDelegated as any).parsedCommand = {
      promptId: 'demo',
      steps: [
        { stepNumber: 1, promptId: 'first', args: {} },
        { stepNumber: 2, promptId: 'second', args: {}, delegated: true },
      ],
    };
    nextDelegated.executionResults = {
      content: 'Step output',
      metadata: {},
      generatedAt: Date.now(),
    };

    const nextFooter = assembler.buildChainFooter(nextDelegated);
    expect(nextFooter).not.toContain('Handoff via Task tool');
    expect(nextFooter).toContain('gate_verdict');

    // Case 2: CURRENT-step delegation wins the footer — this response carries the brief.
    const currentDelegated = new ExecutionContext({ command: 'noop' });
    currentDelegated.sessionContext = {
      sessionId: 'sess-6',
      chainId: 'chain-both#2',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 3,
      pendingReview,
    };
    currentDelegated.executionResults = {
      content: 'Brief-bearing step output',
      metadata: {
        currentStepDelegated: true,
        stepNumber: 2,
        totalSteps: 3,
        promptName: 'second',
      },
      generatedAt: Date.now(),
    };

    const currentFooter = assembler.buildChainFooter(currentDelegated);
    expect(currentFooter).toContain('Handoff via Task tool');
    expect(currentFooter).not.toContain('gate_verdict');
  });
});
