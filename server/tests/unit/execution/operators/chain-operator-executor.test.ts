import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import { ChainOperatorExecutor } from '../../../../src/engine/execution/operators/chain-operator-executor.js';

import type { DeclaredSection } from '../../../../src/engine/frameworks/declared-sections.js';
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
        selectedFramework: { framework: 'CAGEERF', name: 'CAGEERF' },
        category: 'code',
        systemPrompt: 'Apply the CAGEERF framework with rigor.',
      })
    );

    const result = await frameworkExecutor.renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'framework' } }],
      currentStepIndex: 0,
    });

    expect(result.content).toContain('## 🎯 CAGEERF Framework Active');
    expect(result.content).not.toContain('Framework Framework');
    expect(result.content).toContain('Apply the CAGEERF framework with rigor.');
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
            selectedFramework: { name: 'SCAMPER', framework: 'SCAMPER' },
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
      selectedFramework: { framework: 'CAGEERF', name: 'CAGEERF' },
      systemPrompt: 'Apply the framework.',
    });

    const executor = new ChainOperatorExecutor(
      mockLogger,
      [
        {
          ...mockConvertedPrompts[0],
          systemMessage: 'You are operating under the C.A.G.E.E.R.F framework for prompts.',
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
    expect(result.content).not.toContain('Framework Active');
    expect(result.content).toContain(
      'You are operating under the C.A.G.E.E.R.F framework for prompts.'
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
          criteriaSummary: 'Follow framework',
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

  describe('declared section headers (Tier 2.3, OQ-1)', () => {
    /** The four required CAGEERF sections, matching phases.yaml at HEAD 2026-08-17. */
    const cageerfSections: DeclaredSection[] = [
      { header: '## Context', required: true, phaseId: 'context_establishment', criteria: [] },
      { header: '## Analysis', required: true, phaseId: 'systematic_analysis', criteria: [] },
      { header: '## Goals', required: true, phaseId: 'goal_definition', criteria: [] },
      { header: '## Execution', required: true, phaseId: 'execution_planning', criteria: [] },
    ];

    function buildExecutor(sections: DeclaredSection[]): ChainOperatorExecutor {
      return new ChainOperatorExecutor(mockLogger, mockConvertedPrompts, undefined, undefined, {
        declaredSectionsProvider: () => sections,
      });
    }

    function stepWithFramework(frameworkId: string) {
      return {
        stepNumber: 1,
        promptId: 'analyze',
        args: { code: 'x' },
        frameworkContext: {
          selectedFramework: { id: frameworkId, name: frameworkId.toUpperCase() },
          systemPrompt: `Apply ${frameworkId}.`,
        } as any,
      };
    }

    test('emitted prompt contains every declared header for the active framework', async () => {
      const executor = buildExecutor(cageerfSections);

      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: [stepWithFramework('cageerf')],
        currentStepIndex: 0,
      });

      for (const section of cageerfSections) {
        expect(result.content).toContain(`\`${section.header}\``);
      }
    });

    test('back-test: mutating a fixture section_header changes the rendered prompt and fails an assertion against the old value', async () => {
      const OLD_HEADER = '## Goals';
      const NEW_HEADER = '## Objectives';

      // Simulates phases.yaml renaming a declared header — the exact drift this tier exists to
      // make impossible to miss. A snapshot test would silently re-record this output and never
      // surface the rename; this test instead proves the rendered prompt tracks the fixture.
      const mutatedSections = cageerfSections.map((section) =>
        section.header === OLD_HEADER ? { ...section, header: NEW_HEADER } : section
      );

      const executor = buildExecutor(mutatedSections);
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: [stepWithFramework('cageerf')],
        currentStepIndex: 0,
      });

      // The rendered prompt reflects the mutated fixture...
      expect(result.content).toContain(`\`${NEW_HEADER}\``);

      // ...and an assertion written against the STALE header value now fails — proving this
      // check is live rather than frozen. `toThrow` makes the failure itself the assertion: if
      // the renderer ever regressed to hardcoding '## Goals' instead of reading the fixture,
      // this proof would stop throwing and the test above (asserting NEW_HEADER) would also fail.
      expect(() => expect(result.content).toContain(`\`${OLD_HEADER}\``)).toThrow();
    });

    test('no provider wired declares nothing (pre-Tier-2 behavior, byte-identical)', async () => {
      const executor = new ChainOperatorExecutor(mockLogger, mockConvertedPrompts);

      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: [stepWithFramework('cageerf')],
        currentStepIndex: 0,
      });

      expect(result.content).not.toContain('Required Sections');
    });

    test('a framework with no guarded phases declares nothing', async () => {
      const executor = buildExecutor([]);

      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: [stepWithFramework('plain-framework')],
        currentStepIndex: 0,
      });

      expect(result.content).not.toContain('Required Sections');
    });

    describe('gate review render (F5 — 13-session-stage opens the review upfront, renderNormalStep never runs)', () => {
      function buildPendingReview(attemptCount: number) {
        return {
          combinedPrompt: '',
          gateIds: [],
          prompts: [],
          createdAt: Date.now(),
          attemptCount,
          maxAttempts: 3,
        };
      }

      test('declares every header for the reviewed step on the FIRST render (attemptCount 0)', async () => {
        const executor = buildExecutor(cageerfSections);

        const result = await executor.renderStep({
          executionType: 'gate_review',
          pendingGateReview: buildPendingReview(0) as any,
          stepPrompts: [stepWithFramework('cageerf')],
          chainContext: {},
          additionalGateIds: [],
        });

        expect(result.content).toContain('Required Sections');
        for (const section of cageerfSections) {
          expect(result.content).toContain(`\`${section.header}\``);
        }
      });

      test('still declares every header on a RETRY (attemptCount > 0), unlike frameworkGuidance which is suppressed', async () => {
        const executor = buildExecutor(cageerfSections);

        const result = await executor.renderStep({
          executionType: 'gate_review',
          pendingGateReview: buildPendingReview(1) as any,
          stepPrompts: [stepWithFramework('cageerf')],
          chainContext: {},
          additionalGateIds: [],
        });

        // A retry exists because a declared header failed to appear (or a structural check
        // failed); the vocabulary must be restated so the retry can actually fix it — omitting
        // it here would tell the model to fix its structure without telling it the structure.
        expect(result.content).toContain('Required Sections');
        for (const section of cageerfSections) {
          expect(result.content).toContain(`\`${section.header}\``);
        }
      });

      test('no provider wired declares nothing on gate review (matches the normal-step behavior)', async () => {
        const executor = new ChainOperatorExecutor(mockLogger, mockConvertedPrompts);

        const result = await executor.renderStep({
          executionType: 'gate_review',
          pendingGateReview: buildPendingReview(0) as any,
          stepPrompts: [stepWithFramework('cageerf')],
          chainContext: {},
          additionalGateIds: [],
        });

        expect(result.content).not.toContain('Required Sections');
      });
    });
  });
});
