import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { ChainOperatorExecutor } from '../../src/execution/operators/chain-operator-executor.js';
import type { Logger } from '../../src/logging/index.js';
import type { PromptData, ConvertedPrompt } from '../../src/types/index.js';

const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const mockPromptsData: PromptData[] = [
  {
    id: 'analyze',
    name: 'Code Analyzer',
    file: 'analyze.md',
    description: 'Analyze code',
    category: 'code',
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
    file: 'summarize.md',
    description: 'Summarize analysis',
    category: 'text',
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
  const enhanceStub = jest.fn(async (content: string) => content);

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new ChainOperatorExecutor(
      mockLogger,
      mockPromptsData,
      mockConvertedPrompts,
      enhanceStub
    );
  });

  test('renders first step instructions with guidance', async () => {
    const result = await executor.renderStep({
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: 'code="function foo() {}"' },
        { stepNumber: 2, promptId: 'summarize', args: '' }
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
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: 'code="test"' },
        { stepNumber: 2, promptId: 'summarize', args: '' }
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
      stepPrompts: [],
      currentStepIndex: 0
    });

    expect(result.content).toContain('No executable steps');
  });

  test('falls back when prompt is missing', async () => {
    const result = await executor.renderStep({
      stepPrompts: [
        { stepNumber: 1, promptId: 'unknown_prompt', args: '' }
      ],
      currentStepIndex: 0
    });

    expect(result.content).toContain('Execute the prompt "unknown_prompt"');
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Prompt not found: unknown_prompt'));
  });

  test('parses key=value arguments correctly', async () => {
    const result = await executor.renderStep({
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: 'code="test code"' }
      ],
      currentStepIndex: 0
    });

    expect(result.content).toContain('Analyze this code: test code');
  });

  test('parses JSON arguments correctly', async () => {
    const result = await executor.renderStep({
      stepPrompts: [
        { stepNumber: 1, promptId: 'analyze', args: '{"code":"json test"}' }
      ],
      currentStepIndex: 0
    });

    expect(result.content).toContain('Analyze this code: json test');
  });
});
