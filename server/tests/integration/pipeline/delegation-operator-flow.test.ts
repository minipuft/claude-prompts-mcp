/**
 * Delegation Operator (==>) Integration Test
 *
 * Tests the complete ==> delegation flow with real modules:
 * - SymbolicCommandParser (real) — detects ==> and sets delegated flags
 * - ChainOperatorExecutor (real) — renders delegation-aware CTA
 * - OperatorValidationStage (real) — normalizes prompt-level delegation
 *
 * Mocks:
 * - Logger (no I/O)
 * - ConvertedPrompts (test fixtures)
 *
 * Classification: Integration (real parser + real executor + real stage, mock I/O only)
 *
 * This test catches issues that unit tests miss:
 * - Delegation flag propagation from parser → chain operator → CTA
 * - Silent normalization of prompt-level delegation:true
 * - Agent type resolution chain (step → prompt → default)
 * - Mixed ==> and --> in the same chain
 */

import { describe, expect, test, jest, beforeEach } from '@jest/globals';

import { createParsingSystem } from '../../../src/engine/execution/parsers/index.js';
import { ChainOperatorExecutor } from '../../../src/engine/execution/operators/chain-operator-executor.js';
import { OperatorValidationStage } from '../../../src/engine/execution/pipeline/stages/06-operator-validation-stage.js';
import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type {
  ChainOperator,
  SymbolicCommandParseResult,
} from '../../../src/engine/execution/parsers/types/operator-types.js';
import type { ChainStepPrompt } from '../../../src/engine/execution/operators/types.js';
import type { FrameworkValidator } from '../../../src/engine/frameworks/framework-validator.js';

const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const testPrompts: ConvertedPrompt[] = [
  {
    id: 'research',
    name: 'Research Task',
    description: 'Research a topic',
    category: 'analysis',
    userMessageTemplate: 'Research: {{topic}}',
    arguments: [{ name: 'topic', type: 'string', description: 'Topic', required: true }],
  },
  {
    id: 'summarize',
    name: 'Summarizer',
    description: 'Summarize findings',
    category: 'text',
    userMessageTemplate: 'Summarize: {{previous_step_output}}',
    arguments: [],
  },
  {
    id: 'review',
    name: 'Code Reviewer',
    description: 'Review code output',
    category: 'code',
    userMessageTemplate: 'Review: {{previous_step_output}}',
    arguments: [],
  },
];

describe('Delegation Operator (==>) Flow', () => {
  let parsingSystem: ReturnType<typeof createParsingSystem>;
  let executor: ChainOperatorExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    parsingSystem = createParsingSystem(mockLogger);
    executor = new ChainOperatorExecutor(mockLogger, testPrompts);
  });

  describe('parser → chain operator → CTA flow', () => {
    test('==> sets delegated flag and CTA contains delegation instructions', async () => {
      // Step 1: Parse command with ==>
      const parseResult = await parsingSystem.commandParser.parseCommand(
        '>>research topic:"AI" ==> >>summarize',
        testPrompts
      );

      // Step 2: Verify parser detected delegation
      expect(parseResult.format).toBe('symbolic');
      const symbolic = parseResult as SymbolicCommandParseResult;
      const chainOp = symbolic.operators.operators.find(
        (op): op is ChainOperator => op.type === 'chain'
      );

      expect(chainOp).toBeDefined();
      expect(chainOp!.hasDelegation).toBe(true);
      // First step: not delegated (it's the source). Second step: delegated
      expect(chainOp!.steps[0].delegated).not.toBe(true);
      expect(chainOp!.steps[1].delegated).toBe(true);

      // Step 3: Build step prompts (mimicking CommandParsingStage buildSymbolicChain)
      const stepPrompts: ChainStepPrompt[] = chainOp!.steps.map((step, index) => ({
        stepNumber: index + 1,
        promptId: step.promptId,
        args: {},
        convertedPrompt: testPrompts.find((p) => p.id === step.promptId),
        delegated: step.delegated === true ? true : undefined,
      }));

      // Step 4: Render step 1 CTA (next step is delegated)
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 0,
      });

      expect(result.callToAction).toContain('HANDOFF');
      expect(result.callToAction).toContain('Tool: Task');
      expect(result.callToAction).toContain('subagent_type: "claude-prompts:chain-executor"');
      expect(result.callToAction).toContain('Summarizer');
    });

    test('delegation CTA switches to spawn_agent for codex client profile', async () => {
      const parseResult = await parsingSystem.commandParser.parseCommand(
        '>>research topic:"AI" ==> >>summarize',
        testPrompts
      );
      const symbolic = parseResult as SymbolicCommandParseResult;
      const chainOp = symbolic.operators.operators.find(
        (op): op is ChainOperator => op.type === 'chain'
      );
      const stepPrompts: ChainStepPrompt[] = chainOp!.steps.map((step, index) => ({
        stepNumber: index + 1,
        promptId: step.promptId,
        args: {},
        convertedPrompt: testPrompts.find((p) => p.id === step.promptId),
        delegated: step.delegated === true ? true : undefined,
      }));

      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 0,
        chainContext: {
          requestIdentityContext: {
            clientProfile: {
              clientFamily: 'codex',
              clientId: 'codex-cli',
              clientVersion: '1.0.0',
              delegationProfile: 'spawn_agent_v1',
            },
          },
        },
      });

      expect(result.callToAction).toContain('Tool: spawn_agent');
      expect(result.callToAction).not.toContain('Tool: Task');
    });

    test('mixed --> and ==> only delegates the ==> steps', async () => {
      const parseResult = await parsingSystem.commandParser.parseCommand(
        '>>research topic:"test" --> >>summarize ==> >>review',
        testPrompts
      );

      const symbolic = parseResult as SymbolicCommandParseResult;
      const chainOp = symbolic.operators.operators.find(
        (op): op is ChainOperator => op.type === 'chain'
      );

      expect(chainOp).toBeDefined();
      expect(chainOp!.steps).toHaveLength(3);
      // Step 1: research (source, not delegated)
      expect(chainOp!.steps[0].delegated).not.toBe(true);
      // Step 2: summarize (after -->, not delegated)
      expect(chainOp!.steps[1].delegated).not.toBe(true);
      // Step 3: review (after ==>, delegated)
      expect(chainOp!.steps[2].delegated).toBe(true);

      // Build step prompts
      const stepPrompts: ChainStepPrompt[] = chainOp!.steps.map((step, index) => ({
        stepNumber: index + 1,
        promptId: step.promptId,
        args: {},
        convertedPrompt: testPrompts.find((p) => p.id === step.promptId),
        delegated: step.delegated === true ? true : undefined,
      }));

      // Step 1 → Step 2 is NOT delegated → standard CTA
      const step1Result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 0,
      });
      expect(step1Result.callToAction).not.toContain('HANDOFF');
      expect(step1Result.callToAction).toContain('resume shortcut');

      // Step 2 → Step 3 IS delegated → delegation CTA
      const step2Result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 1,
      });
      expect(step2Result.callToAction).toContain('HANDOFF');
      expect(step2Result.callToAction).toContain('subagent_type: "claude-prompts:chain-executor"');

      // Step 3 is final → deliver to user
      const step3Result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 2,
      });
      expect(step3Result.callToAction).toContain('Deliver the final response');
    });

    test('all ==> chain marks every step except first as delegated', async () => {
      const parseResult = await parsingSystem.commandParser.parseCommand(
        '>>research topic:"x" ==> >>summarize ==> >>review',
        testPrompts
      );

      const symbolic = parseResult as SymbolicCommandParseResult;
      const chainOp = symbolic.operators.operators.find(
        (op): op is ChainOperator => op.type === 'chain'
      );

      expect(chainOp!.steps[0].delegated).not.toBe(true);
      expect(chainOp!.steps[1].delegated).toBe(true);
      expect(chainOp!.steps[2].delegated).toBe(true);
      expect(chainOp!.hasDelegation).toBe(true);
    });
  });

  describe('OperatorValidationStage silent normalization → CTA flow', () => {
    test('a chain with no per-step subagentModel leaves steps unchanged', async () => {
      const parseResult = await parsingSystem.commandParser.parseCommand(
        '>>research topic:"test" --> >>summarize',
        testPrompts
      );

      const symbolic = parseResult as SymbolicCommandParseResult;
      const stepPrompts: ChainStepPrompt[] = [
        { stepNumber: 1, promptId: 'research', args: {} },
        { stepNumber: 2, promptId: 'summarize', args: {} },
      ];

      const context = new ExecutionContext({
        command: '>>research topic:"test" --> >>summarize',
      });
      context.parsedCommand = {
        ...symbolic,
        commandType: 'chain',
        convertedPrompt: testPrompts[0],
        steps: stepPrompts,
      };

      const stubValidator = { validateAndNormalize: jest.fn() } as unknown as FrameworkValidator;
      const stage = new OperatorValidationStage(stubValidator, mockLogger);
      await stage.execute(context);

      // Steps remain non-delegated
      expect(context.parsedCommand!.steps![0].delegated).not.toBe(true);
      expect(context.parsedCommand!.steps![1].delegated).not.toBe(true);

      // CTA is standard (no delegation)
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: context.parsedCommand!.steps!,
        currentStepIndex: 0,
      });
      expect(result.callToAction).toContain('resume shortcut');
      expect(result.callToAction).not.toContain('HANDOFF');
    });
  });

  describe('subagentModel → automatic delegation via OperatorValidationStage', () => {
    test('step with subagentModel gets delegated:true after OperatorValidationStage normalization', async () => {
      // Parse a NORMAL chain (no ==>) — no delegation from parser
      const parseResult = await parsingSystem.commandParser.parseCommand(
        '>>research topic:"test" --> >>summarize --> >>review',
        testPrompts
      );

      const symbolic = parseResult as SymbolicCommandParseResult;
      const chainOp = symbolic.operators.operators.find(
        (op): op is ChainOperator => op.type === 'chain'
      );

      // Before normalization: no delegation flags on any step
      expect(chainOp!.steps[0].delegated).not.toBe(true);
      expect(chainOp!.steps[1].delegated).not.toBe(true);
      expect(chainOp!.steps[2].delegated).not.toBe(true);

      // Build step prompts — step 2 has subagentModel (like code_review_test's research step)
      const stepPrompts: ChainStepPrompt[] = chainOp!.steps.map((step, index) => ({
        stepNumber: index + 1,
        promptId: step.promptId,
        args: {},
        convertedPrompt: testPrompts.find((p) => p.id === step.promptId),
        ...(index === 1 ? { subagentModel: 'fast' as const } : {}),
      }));

      const context = new ExecutionContext({
        command: '>>research topic:"test" --> >>summarize --> >>review',
      });
      context.parsedCommand = {
        ...symbolic,
        commandType: 'chain',
        convertedPrompt: testPrompts[0], // No prompt-level delegation
        steps: stepPrompts,
      };

      // Run OperatorValidationStage normalization
      const stubValidator = { validateAndNormalize: jest.fn() } as unknown as FrameworkValidator;
      const stage = new OperatorValidationStage(stubValidator, mockLogger);
      await stage.execute(context);

      // Step 1: NOT delegated (no subagentModel)
      expect(context.parsedCommand!.steps![0].delegated).not.toBe(true);
      // Step 2: DELEGATED (subagentModel: 'fast' implies delegation)
      expect(context.parsedCommand!.steps![1].delegated).toBe(true);
      // Step 3: NOT delegated (no subagentModel)
      expect(context.parsedCommand!.steps![2].delegated).not.toBe(true);

      // Chain operator also updated
      expect(chainOp!.steps[1].delegated).toBe(true);
      expect(chainOp!.hasDelegation).toBe(true);

      // CTA for step 1 → step 2 shows delegation handoff with model hint
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: context.parsedCommand!.steps!,
        currentStepIndex: 0,
      });
      expect(result.callToAction).toContain('HANDOFF');
      expect(result.callToAction).toContain('subagent_type: "claude-prompts:chain-executor"');
    });

    test('step without subagentModel adjacent to step with subagentModel stays non-delegated', async () => {
      const parseResult = await parsingSystem.commandParser.parseCommand(
        '>>research topic:"test" --> >>summarize --> >>review',
        testPrompts
      );

      const symbolic = parseResult as SymbolicCommandParseResult;
      const chainOp = symbolic.operators.operators.find(
        (op): op is ChainOperator => op.type === 'chain'
      );

      // Only middle step has subagentModel
      const stepPrompts: ChainStepPrompt[] = chainOp!.steps.map((step, index) => ({
        stepNumber: index + 1,
        promptId: step.promptId,
        args: {},
        ...(index === 1 ? { subagentModel: 'heavy' as const } : {}),
      }));

      const context = new ExecutionContext({
        command: '>>research topic:"test" --> >>summarize --> >>review',
      });
      context.parsedCommand = {
        ...symbolic,
        commandType: 'chain',
        convertedPrompt: testPrompts[0],
        steps: stepPrompts,
      };

      const stubValidator = { validateAndNormalize: jest.fn() } as unknown as FrameworkValidator;
      const stage = new OperatorValidationStage(stubValidator, mockLogger);
      await stage.execute(context);

      // Only step 2 delegated — no bleed to adjacent steps
      expect(context.parsedCommand!.steps![0].delegated).not.toBe(true);
      expect(context.parsedCommand!.steps![1].delegated).toBe(true);
      expect(context.parsedCommand!.steps![2].delegated).not.toBe(true);

      // Step 2 → Step 3 is NOT delegated, so CTA should be standard
      const step2Result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: context.parsedCommand!.steps!,
        currentStepIndex: 1,
      });
      expect(step2Result.callToAction).not.toContain('HANDOFF');
    });
  });

  describe('agent type resolution', () => {
    test('step-level agentType takes priority over the chain-executor default', async () => {
      const stepPrompts: ChainStepPrompt[] = [
        { stepNumber: 1, promptId: 'research', args: {} },
        {
          stepNumber: 2,
          promptId: 'summarize',
          args: {},
          delegated: true,
          agentType: 'Explore',
          convertedPrompt: testPrompts[1],
        },
      ];

      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 0,
      });

      // Step-level agentType wins (namespaced by strategy)
      expect(result.callToAction).toContain('subagent_type: "claude-prompts:Explore"');
      expect(result.callToAction).not.toContain('chain-executor');
    });

    test('prompt-level agentType applies when the step declares none', async () => {
      const stepPrompts: ChainStepPrompt[] = [
        { stepNumber: 1, promptId: 'research', args: {} },
        {
          stepNumber: 2,
          promptId: 'summarize',
          args: {},
          delegated: true,
          convertedPrompt: { ...testPrompts[1]!, agentType: 'Explore' },
        },
      ];

      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 0,
      });

      expect(result.callToAction).toContain('subagent_type: "claude-prompts:Explore"');
      expect(result.callToAction).not.toContain('chain-executor');
    });

    test('a step agentType overrides the prompt-level default', async () => {
      // The whole point of the two levels: a prompt sets the agent its steps usually want,
      // and one step that needs a different one says so without restating the rest.
      const stepPrompts: ChainStepPrompt[] = [
        { stepNumber: 1, promptId: 'research', args: {} },
        {
          stepNumber: 2,
          promptId: 'summarize',
          args: {},
          delegated: true,
          agentType: 'code-reviewer',
          convertedPrompt: { ...testPrompts[1]!, agentType: 'Explore' },
        },
      ];

      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 0,
      });

      expect(result.callToAction).toContain('subagent_type: "claude-prompts:code-reviewer"');
      expect(result.callToAction).not.toContain('Explore');
    });

    test('defaults to namespaced chain-executor when no overrides', async () => {
      const stepPrompts: ChainStepPrompt[] = [
        { stepNumber: 1, promptId: 'research', args: {} },
        { stepNumber: 2, promptId: 'summarize', args: {}, delegated: true },
      ];

      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 0,
      });

      expect(result.callToAction).toContain('subagent_type: "claude-prompts:chain-executor"');
    });
  });
});
