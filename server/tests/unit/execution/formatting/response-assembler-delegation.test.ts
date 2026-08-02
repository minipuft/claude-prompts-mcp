import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';

describe('ResponseAssembler – delegation detection from parsed steps', () => {
  const assembler = new ResponseAssembler();

  test('injects delegation CTA when next step has delegated flag (parsed steps)', () => {
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

    // Handoff CTA injected from parsed steps
    expect(result).toContain('HANDOFF');
    expect(result).toContain('Step 2');
    expect(result).toContain('second');
    // Footer shows handoff Next: line
    expect(result).toContain('Handoff via Task tool');
  });

  test('injects delegation CTA from StepExecutionStage metadata when available', () => {
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

    expect(result).toContain('HANDOFF');
    expect(result).toContain('research');
    expect(result).toContain('Handoff via Task tool');
  });

  test('uses codex delegation strategy when client profile is codex', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-codex',
      chainId: 'chain-codex#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
    };
    context.state.identity.context = {
      identity: {
        organizationId: 'org-a',
        workspaceId: 'workspace-a',
        identitySource: 'default',
        clientProfile: {
          clientFamily: 'codex',
          clientId: 'codex-cli',
          clientVersion: '1.0.0',
          delegationProfile: 'spawn_agent_v1',
        },
      },
      organizationId: 'org-a',
      workspaceId: 'workspace-a',
      continuityScopeId: 'workspace-a',
      identitySource: 'default',
      organizationSource: 'default',
      clientProfile: {
        clientFamily: 'codex',
        clientId: 'codex-cli',
        clientVersion: '1.0.0',
        delegationProfile: 'spawn_agent_v1',
      },
    } as any;
    context.executionResults = {
      content: 'Step 1 output',
      metadata: {
        nextStepDelegated: true,
        stepNumber: 1,
        totalSteps: 2,
        promptName: 'review',
      },
      generatedAt: Date.now(),
    };

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);
    const footer = assembler.buildChainFooter(context);

    expect(result).toContain('Tool: spawn_agent');
    expect(footer).toContain('Handoff via Codex agent capability (spawn_agent preferred)');
  });

  test('uses gemini delegation strategy when client profile is gemini', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-gemini',
      chainId: 'chain-gemini#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
    };
    context.state.identity.context = {
      identity: {
        organizationId: 'org-a',
        workspaceId: 'workspace-a',
        identitySource: 'default',
        clientProfile: {
          clientFamily: 'gemini',
          clientId: 'gemini',
          clientVersion: '1.0.0',
          delegationProfile: 'gemini_subagent_v1',
        },
      },
      organizationId: 'org-a',
      workspaceId: 'workspace-a',
      continuityScopeId: 'workspace-a',
      identitySource: 'default',
      organizationSource: 'default',
      clientProfile: {
        clientFamily: 'gemini',
        clientId: 'gemini',
        clientVersion: '1.0.0',
        delegationProfile: 'gemini_subagent_v1',
      },
    } as any;
    context.executionResults = {
      content: 'Step 1 output',
      metadata: {
        nextStepDelegated: true,
        stepNumber: 1,
        totalSteps: 2,
        promptName: 'review',
      },
      generatedAt: Date.now(),
    };

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);
    const footer = assembler.buildChainFooter(context);

    expect(result).toContain("Gemini's sub-agent/handoff");
    expect(footer).toContain('Handoff via Gemini sub-agent capability');
  });

  test('uses cursor delegation strategy with experimental footer messaging', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-cursor',
      chainId: 'chain-cursor#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
    };
    context.state.identity.context = {
      identity: {
        organizationId: 'org-a',
        workspaceId: 'workspace-a',
        identitySource: 'default',
        clientProfile: {
          clientFamily: 'cursor',
          clientId: 'cursor',
          clientVersion: '1.0.0',
          delegationProfile: 'cursor_agent_v1',
        },
      },
      organizationId: 'org-a',
      workspaceId: 'workspace-a',
      continuityScopeId: 'workspace-a',
      identitySource: 'default',
      organizationSource: 'default',
      clientProfile: {
        clientFamily: 'cursor',
        clientId: 'cursor',
        clientVersion: '1.0.0',
        delegationProfile: 'cursor_agent_v1',
      },
    } as any;
    context.executionResults = {
      content: 'Step 1 output',
      metadata: {
        nextStepDelegated: true,
        stepNumber: 1,
        totalSteps: 2,
        promptName: 'review',
      },
      generatedAt: Date.now(),
    };

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as any);
    const footer = assembler.buildChainFooter(context);

    expect(result).toContain('Handoff (experimental/testing)');
    expect(footer).toContain('Handoff via Cursor agent capability (experimental/testing)');
  });

  test('does not inject delegation CTA when no delegation detected', () => {
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

    expect(result).not.toContain('HANDOFF');
    expect(result).not.toContain('Handoff via Task tool');
  });

  test('delegation coexists with gate instructions in output', () => {
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

    // BOTH gate instructions AND delegation CTA present
    expect(result).toContain('Quality Gates');
    expect(result).toContain('HANDOFF');
    expect(result).toContain('delegated-step');
    // Gate instructions in the delegation envelope
    expect(result).toContain('EXECUTION CONTEXT');
  });

  test('footer shows delegation Next line over gate review when both present', () => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-5',
      chainId: 'chain-both#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 3,
      pendingReview: {
        combinedPrompt: 'review',
        gateIds: ['quality'],
        prompts: [],
        createdAt: Date.now(),
        attemptCount: 0,
        maxAttempts: 2,
      } as any,
    };
    (context as any).parsedCommand = {
      promptId: 'demo',
      steps: [
        { stepNumber: 1, promptId: 'first', args: {} },
        { stepNumber: 2, promptId: 'second', args: {}, delegated: true },
      ],
    };
    context.executionResults = {
      content: 'Step output',
      metadata: {},
      generatedAt: Date.now(),
    };

    const footer = assembler.buildChainFooter(context);

    // Handoff takes priority in footer over gate review
    expect(footer).toContain('Handoff via Task tool');
    expect(footer).not.toContain('gate_verdict');
  });
});
