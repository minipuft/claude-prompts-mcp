import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { ChainOperatorExecutor } from '../../../../dist/execution/operators/chain-operator-executor.js';
import type { Logger } from '../../../../dist/logging/index.js';
import type { ConvertedPrompt } from '../../../../dist/types/index.js';

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
        required: true
      }
    ]
  },
  {
    id: 'summarize',
    name: 'Summarizer',
    description: 'Summarize analysis',
    category: 'text',
    userMessageTemplate: 'Summarize: {{previous_step_output}}{% if input %} Additional context: {{input}}{% endif %}',
    systemMessage: 'You are a summarizer',
    arguments: [
      {
        name: 'input',
        type: 'string',
        description: 'Text to summarize',
        required: false
      }
    ]
  }
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
        { stepNumber: 2, promptId: 'summarize', args: {} }
      ],
      currentStepIndex: 0
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
        { stepNumber: 2, promptId: 'summarize', args: {} }
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
      currentStepIndex: 0
    });

    expect(result.content).toContain('No executable steps');
  });

  test('falls back when prompt is missing', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [
        { stepNumber: 1, promptId: 'unknown_prompt', args: {} }
      ],
      currentStepIndex: 0
    });

    expect(result.content).toContain('Execute the prompt "unknown_prompt"');
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Prompt not found: unknown_prompt'));
  });

  test('parses key=value arguments correctly', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: { code: 'test code' } }
      ],
      currentStepIndex: 0
    });

    expect(result.content).toContain('Analyze this code: test code');
  });

  test('parses JSON arguments correctly', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: { code: 'json test' } }
      ],
      currentStepIndex: 0
    });

    expect(result.content).toContain('Analyze this code: json test');
  });

  test('renders chain metadata banner on first step when context present', async () => {
    const result = await executor.renderStep({
      executionType: 'normal',
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: { code: 'metadata test' } },
        { stepNumber: 2, promptId: 'summarize', args: {} }
      ],
      currentStepIndex: 0,
      chainContext: {
        chain_metadata: {
          chainId: 'chain-alpha',
          name: 'Chain Alpha',
          description: 'Test chain for metadata rendering',
          gates: ['framework-compliance'],
          inlineGateIds: ['inline_gate_focus'],
          totalSteps: 2,
          chainRunId: 'session-context'
        }
      }
    });

    expect(result.content).toContain('Chain Alpha');
    expect(result.content).toContain('Test chain for metadata rendering');
    expect(result.content).toContain('inline_gate_focus');
    expect(result.content).toContain('Quality Gates');
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
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: { code: 'framework' } },
      ],
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
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: { code: 'context' } },
      ],
      currentStepIndex: 0,
    });

    expect(frameworkResolver).not.toHaveBeenCalled();
    expect(result.content).not.toContain('Framework Methodology Active');
    expect(result.content).toContain('You are operating under the C.A.G.E.E.R.F methodology for prompts.');
  });
});
