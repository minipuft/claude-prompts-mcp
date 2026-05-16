import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import { ChainOperatorExecutor } from '../../../../src/engine/execution/operators/chain-operator-executor.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ConvertedPrompt } from '../../../../src/shared/types/index.js';

const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const mockConvertedPrompts: ConvertedPrompt[] = [
  {
    id: 'analyze',
    name: 'Code Analyzer',
    description: 'Analyze code',
    category: 'code',
    userMessageTemplate: 'Analyze this code: {{code}}',
    systemMessage: 'You are a code analyzer',
    arguments: [
      {
        name: 'code',
        type: 'string',
        description: 'Code to analyze',
        required: true,
      },
    ],
  },
  {
    id: 'summarize',
    name: 'Summarizer',
    description: 'Summarize analysis',
    category: 'text',
    userMessageTemplate:
      'Summarize: {{previous_step_output}}{% if input %} Additional context: {{input}}{% endif %}',
    systemMessage: 'You are a summarizer',
    arguments: [
      {
        name: 'input',
        type: 'string',
        description: 'Text to summarize',
        required: false,
      },
    ],
  },
];

describe('ChainOperatorExecutor', () => {
  let executor: ChainOperatorExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new ChainOperatorExecutor(mockLogger, mockConvertedPrompts);
  });

  test('renders first step instructions with guidance', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: { code: 'function foo() {}' } },
        { stepNumber: 2, promptId: 'summarize', args: {} },
      ],
      currentStepIndex: 0,
    });

    expect(result.content).toContain('You are a code analyzer');
    expect(result.content).toContain('Analyze this code: function foo() {}');
    expect(result.callToAction).toContain('Step 2');
  });

  test('injects stored previous step output when available', async () => {
    const chainContext = {
      step_results: {
        '1': 'Analysis result: key findings identified',
      },
    };

    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: { code: 'test' } },
        { stepNumber: 2, promptId: 'summarize', args: {} },
      ],
      currentStepIndex: 1,
      chainContext,
    });

    expect(result.content).toContain('You are a summarizer');
    expect(result.content).toContain('Analysis result: key findings identified');
    expect(result.content).toContain('Summarize: Analysis result: key findings identified');
  });

  test('handles empty chains gracefully', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [],
      currentStepIndex: 0,
    });

    expect(result.content).toContain('No executable steps');
  });

  test('falls back when prompt is missing', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'unknown_prompt', args: {} }],
      currentStepIndex: 0,
    });

    expect(result.content).toContain('Execute the prompt "unknown_prompt"');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Prompt not found: unknown_prompt')
    );
  });

  test('parses key=value arguments correctly', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'test code' } }],
      currentStepIndex: 0,
    });

    expect(result.content).toContain('Analyze this code: test code');
  });

  test('parses JSON arguments correctly', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'json test' } }],
      currentStepIndex: 0,
    });

    expect(result.content).toContain('Analyze this code: json test');
  });

  test('renders streamlined chain metadata banner on first step when context present', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: { code: 'metadata test' } },
        { stepNumber: 2, promptId: 'summarize', args: {} },
      ],
      currentStepIndex: 0,
      chainContext: {
        current_step: 1,
        chain_metadata: {
          chainId: 'chain-alpha',
          name: 'Chain Alpha',
          description: 'Test chain for metadata rendering',
          inlineGateIds: ['inline_gate_focus'],
          totalSteps: 2,
          chainRunId: 'session-context',
        },
      },
    });

    expect(result.content).not.toContain('prompt:');
  });

  test('injects framework guidance when context provided', async () => {
    const frameworkExecutor = new ChainOperatorExecutor(
      mockLogger,
      mockConvertedPrompts,
      undefined,
      async () => ({
        selectedFramework: { methodology: 'CAGEERF', name: 'CAGEERF' },
        category: 'code',
        systemPrompt: 'Apply the CAGEERF methodology with rigor.',
      })
    );

    const result = await frameworkExecutor.renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'framework' } }],
      currentStepIndex: 0,
    });

    expect(result.content).toContain('Framework Methodology Active');
    expect(result.content).toContain('Apply the CAGEERF methodology with rigor.');
  });

  test('uses step-level framework context when provided', async () => {
    const executor = new ChainOperatorExecutor(mockLogger, mockConvertedPrompts);

    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [
        {
          stepNumber: 1,
          promptId: 'analyze',
          args: { code: 'context' },
          frameworkContext: {
            selectedFramework: { name: 'SCAMPER', methodology: 'SCAMPER' },
            systemPrompt: 'Use SCAMPER for ideation.',
          } as any,
        },
      ],
      currentStepIndex: 0,
    });

    expect(result.content).toContain('SCAMPER');
    expect(result.content).toContain('Use SCAMPER for ideation.');
  });

  test('skips duplicate framework banners when prompt already contains guidance', async () => {
    const frameworkResolver = jest.fn().mockResolvedValue({
      selectedFramework: { methodology: 'CAGEERF', name: 'CAGEERF' },
      systemPrompt: 'Apply the methodology.',
    });

    const executor = new ChainOperatorExecutor(
      mockLogger,
      [
        {
          ...mockConvertedPrompts[0],
          systemMessage: 'You are operating under the C.A.G.E.E.R.F methodology for prompts.',
        },
      ],
      undefined,
      frameworkResolver
    );

    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'context' } }],
      currentStepIndex: 0,
    });

    expect(frameworkResolver).not.toHaveBeenCalled();
    expect(result.content).not.toContain('Framework Methodology Active');
    expect(result.content).toContain(
      'You are operating under the C.A.G.E.E.R.F methodology for prompts.'
    );
  });

  test('renders gate review instructions using explicit :: gate references', async () => {
    const gateRenderer = {
      renderGuidance: jest.fn().mockResolvedValue('## Gate Guidance'),
    };
    const reviewExecutor = new ChainOperatorExecutor(
      mockLogger,
      mockConvertedPrompts,
      gateRenderer
    );

    const pendingReview = {
      combinedPrompt: '',
      gateIds: [],
      prompts: [
        {
          gateId: 'code-quality',
          gateName: 'Code Quality',
          criteriaSummary: 'Ensure code quality',
        },
      ],
      createdAt: Date.now(),
      attemptCount: 0,
      maxAttempts: 3,
    };

    const chainContext = {
      current_step: 1,
      currentStepArgs: { code: 'alpha' },
      chain_metadata: { inlineGateIds: ['inline_gate_focus'] },
    };

    const result = await reviewExecutor.renderStep({
      executionType: 'gate_review',
      pendingGateReview: pendingReview as any,
      stepPrompts: [
        {
          stepNumber: 1,
          promptId: 'analyze',
          args: { code: 'alpha' },
          inlineGateIds: ['inline_gate_focus'],
        },
      ],
      chainContext,
      additionalGateIds: [],
    });

    expect(gateRenderer.renderGuidance).toHaveBeenCalledWith(
      expect.arrayContaining(['code-quality']),
      expect.objectContaining({
        explicitGateIds: expect.arrayContaining(['code-quality']),
        promptId: 'analyze',
      })
    );
    // Original task template used as review body (gate guidance comes from GateGuidanceRenderer)
    expect(result.content).toContain('Analyze this code: alpha');
  });

  test('renders original intent section when chainContext has original_args', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: { code: 'intent test' } },
        { stepNumber: 2, promptId: 'summarize', args: {} },
      ],
      currentStepIndex: 0,
      chainContext: {
        original_args: { command: '>>analyze', code: 'intent test' },
      },
    });

    expect(result.content).toContain('### Original Request Intent');
    expect(result.content).toContain('Your work must satisfy this intent');
    expect(result.content).toContain('- **command**: >>analyze');
    expect(result.content).toContain('- **code**: intent test');
  });

  test('omits original intent section when original_args is empty', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'no intent' } }],
      currentStepIndex: 0,
      chainContext: {
        original_args: {},
      },
    });

    expect(result.content).not.toContain('### Original Request Intent');
  });

  test('renders response format section with gate coverage when gates enabled', async () => {
    const gateRenderer = {
      renderGuidance: jest.fn().mockResolvedValue('## Gate Guidance'),
    };
    const gatedExecutor = new ChainOperatorExecutor(mockLogger, mockConvertedPrompts, gateRenderer);

    const result = await gatedExecutor.renderStep({
      executionType: 'normal',
      stepPrompts: [
        {
          stepNumber: 1,
          promptId: 'analyze',
          args: { code: 'format test' },
          inlineGateIds: ['code-quality'],
        },
      ],
      currentStepIndex: 0,
      chainContext: {
        chain_metadata: { inlineGateIds: ['code-quality'] },
      },
    });

    expect(result.content).toContain('### Required Response Format');
    expect(result.content).toContain('**Summary**: What was implemented');
    expect(result.content).toContain('**Gate Coverage**:');
    expect(result.content).toContain('[1] PASS|FAIL: rationale');
  });

  test('renders GATE_REVIEW line in response format on final step', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'final step' } }],
      currentStepIndex: 0,
    });

    expect(result.content).toContain('### Required Response Format');
    expect(result.content).toContain('**GATE_REVIEW: PASS|FAIL - overall assessment**');
  });

  test('prefers current_step metadata when selecting review step context', async () => {
    const gateRenderer = {
      renderGuidance: jest.fn().mockResolvedValue('## Gate Guidance'),
    };
    const reviewExecutor = new ChainOperatorExecutor(
      mockLogger,
      mockConvertedPrompts,
      gateRenderer
    );

    const pendingReview = {
      combinedPrompt: '',
      gateIds: [],
      prompts: [
        {
          gateId: 'framework-compliance',
          gateName: 'Framework Compliance',
          criteriaSummary: 'Follow methodology',
          metadata: { stepNumber: 2 },
        },
      ],
      createdAt: Date.now(),
      attemptCount: 1,
      maxAttempts: 3,
    };

    const chainContext = {
      current_step: 2,
      currentStepArgs: { input: 'beta' },
      chain_metadata: { inlineGateIds: ['inline_gate_focus_step'] },
    };

    await reviewExecutor.renderStep({
      executionType: 'gate_review',
      pendingGateReview: pendingReview as any,
      stepPrompts: [
        {
          stepNumber: 1,
          promptId: 'analyze',
          args: { code: 'alpha' },
          inlineGateIds: ['inline_gate_focus'],
        },
        {
          stepNumber: 2,
          promptId: 'summarize',
          args: { input: 'beta' },
          inlineGateIds: ['inline_gate_focus_step'],
        },
      ],
      chainContext,
      additionalGateIds: [],
    });

    expect(gateRenderer.renderGuidance).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptId: 'summarize',
      })
    );
  });

  describe('output_contract pre-emission', () => {
    const frameworkContext = async () => ({
      selectedFramework: { methodology: 'CAGEERF', name: 'CAGEERF' },
      category: 'code',
      systemPrompt: 'Apply CAGEERF systematically',
    });

    const cageerfContract = () => ({
      headers: [
        {
          header: '## Context',
          required: true,
          minLength: 100,
          forbiddenTerms: ['TODO', 'TBD'],
        },
        {
          header: '## Analysis',
          required: true,
          minLength: 100,
        },
        {
          header: '## Refinement',
          required: false,
          minLength: 50,
        },
      ],
    });

    test('injects required-structure skeleton between framework guidance and task content', async () => {
      const contractedExecutor = new ChainOperatorExecutor(
        mockLogger,
        mockConvertedPrompts,
        undefined,
        frameworkContext,
        undefined,
        undefined,
        () => cageerfContract()
      );

      const result = await contractedExecutor.renderStep({
        executionType: 'normal',
        stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'snippet' } }],
        currentStepIndex: 0,
      });

      expect(result.content).toContain('## Required Output Structure');
      expect(result.content).toContain('## Context');
      expect(result.content).toContain('min 100 chars');
      expect(result.content).toContain('do not use:');

      const skeletonIdx = result.content.indexOf('Required Output Structure');
      const taskIdx = result.content.indexOf('Analyze this code: snippet');
      expect(skeletonIdx).toBeGreaterThan(-1);
      expect(taskIdx).toBeGreaterThan(skeletonIdx);
    });

    test('omits skeleton when no framework is active', async () => {
      const contractedExecutor = new ChainOperatorExecutor(
        mockLogger,
        mockConvertedPrompts,
        undefined,
        async () => null,
        undefined,
        undefined,
        () => cageerfContract()
      );

      const result = await contractedExecutor.renderStep({
        executionType: 'normal',
        stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'x' } }],
        currentStepIndex: 0,
      });

      expect(result.content).not.toContain('Required Output Structure');
    });

    test('omits skeleton when resolver returns null', async () => {
      const contractedExecutor = new ChainOperatorExecutor(
        mockLogger,
        mockConvertedPrompts,
        undefined,
        frameworkContext,
        undefined,
        undefined,
        () => null
      );

      const result = await contractedExecutor.renderStep({
        executionType: 'normal',
        stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'x' } }],
        currentStepIndex: 0,
      });

      expect(result.content).not.toContain('Required Output Structure');
    });

    test('omits skeleton when resolver is unwired (back-compat)', async () => {
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'x' } }],
        currentStepIndex: 0,
      });

      expect(result.content).not.toContain('Required Output Structure');
    });
  });
});
