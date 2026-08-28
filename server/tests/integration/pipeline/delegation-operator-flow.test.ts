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
import { SymbolicCommandBuilder } from '../../../src/engine/execution/parsers/symbolic-command-builder.js';
import { ChainOperatorExecutor } from '../../../src/engine/execution/operators/chain-operator-executor.js';
import { CommandParsingStage } from '../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
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

      // Step 4: Render step 1 (next step is delegated) — the CTA is now a one-line advisory
      // (S7): the full handoff moved to the delegated step's OWN render, so the preceding
      // step no longer carries "Pass ALL content above" pointed at the wrong step's content.
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 0,
      });

      expect(result.callToAction).toContain('⚡ Note');
      expect(result.callToAction).toContain('Summarizer');
      expect(result.callToAction).not.toContain('HANDOFF INSTRUCTIONS');

      // Step 5 (S7): the authoritative handoff — HANDOFF INSTRUCTIONS, Tool call, subagent_type
      // — renders WITH the delegated step's own EXECUTION BRIEF, one resume later.
      const delegatedResult = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 1,
      });

      expect(delegatedResult.content).toContain('HANDOFF INSTRUCTIONS');
      expect(delegatedResult.content).toContain('Tool: Task');
      expect(delegatedResult.content).toContain('subagent_type: "general-purpose"');
      expect(delegatedResult.currentStepDelegated).toBe(true);
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

      // S7: Tool: X only appears in the delegated step's OWN handoff content now, not in the
      // preceding step's advisory — render the delegated step (index 1) to see the strategy
      // resolution. chainContext carries through unchanged since extractClientProfile reads it
      // regardless of which step is rendering.
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 1,
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

      expect(result.content).toContain('Tool: spawn_agent');
      expect(result.content).not.toContain('Tool: Task');
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

      // Step 2 → Step 3 IS delegated → one-line advisory (S7), not a full CTA
      const step2Result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 1,
      });
      expect(step2Result.callToAction).toContain('⚡ Note');
      expect(step2Result.callToAction).not.toContain('HANDOFF INSTRUCTIONS');

      // Step 3 is final AND delegated: the delegated-current-step handoff wins over the
      // final-step "deliver" branch (S7) — a delegated final step still needs its sub-agent
      // spawned and resumed before delivery, so it cannot skip straight to "deliver the final
      // response" the way a non-delegated final step does.
      const step3Result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 2,
      });
      expect(step3Result.content).toContain('HANDOFF INSTRUCTIONS');
      expect(step3Result.content).toContain('subagent_type: "general-purpose"');
      expect(step3Result.callToAction).toContain('HANDOFF INSTRUCTIONS');
      expect(step3Result.currentStepDelegated).toBe(true);
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

      // The chain operator's own ChainStep[] is NOT synced by OperatorValidationStage (P6
      // row 6.3 deleted that mirror — it had zero downstream readers). It stays exactly as
      // the parser left it: no `==>` in this command, so no step was marked at parse time.
      expect(chainOp!.steps[1].delegated).not.toBe(true);

      // Step 1's CTA is now the one-line advisory (S7) — the model-hinted handoff renders
      // WITH step 2's own EXECUTION BRIEF one resume later.
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: context.parsedCommand!.steps!,
        currentStepIndex: 0,
      });
      expect(result.callToAction).toContain('⚡ Note');
      expect(result.callToAction).not.toContain('HANDOFF INSTRUCTIONS');

      const delegatedResult = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: context.parsedCommand!.steps!,
        currentStepIndex: 1,
      });
      expect(delegatedResult.content).toContain('HANDOFF INSTRUCTIONS');
      expect(delegatedResult.content).toContain('subagent_type: "general-purpose"');
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

      // Step 2 is itself delegated (S7): rendering it now always produces the spawn-handoff
      // CTA regardless of step 3's status — a delegated CURRENT step's callToAction no longer
      // depends on the NEXT step, only on `step.delegated` of the step being rendered.
      const step2Result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: context.parsedCommand!.steps!,
        currentStepIndex: 1,
      });
      expect(step2Result.callToAction).toContain('HANDOFF INSTRUCTIONS');
      expect(step2Result.currentStepDelegated).toBe(true);
    });
  });

  describe('agent type resolution', () => {
    test('step-level agentType takes priority over the host default', async () => {
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

      // S7: agentType now resolves inside the delegated step's OWN handoff content, not the
      // preceding step's advisory — render the delegated step (index 1) itself.
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 1,
      });

      // Step-level agentType wins, passed through exactly as written
      expect(result.content).toContain('subagent_type: "Explore"');
      expect(result.content).not.toContain('chain-executor');
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

      // S7: render the delegated step itself — its content carries the handoff.
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 1,
      });

      expect(result.content).toContain('subagent_type: "Explore"');
      expect(result.content).not.toContain('chain-executor');
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

      // S7: render the delegated step itself — its content carries the handoff.
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 1,
      });

      expect(result.content).toContain('subagent_type: "code-reviewer"');
      expect(result.content).not.toContain('Explore');
    });

    test('defaults to the host general-purpose agent when no overrides', async () => {
      const stepPrompts: ChainStepPrompt[] = [
        { stepNumber: 1, promptId: 'research', args: {} },
        { stepNumber: 2, promptId: 'summarize', args: {}, delegated: true },
      ];

      // S7: render the delegated step itself — its content carries the handoff.
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts,
        currentStepIndex: 1,
      });

      expect(result.content).toContain('subagent_type: "general-purpose"');
      expect(result.content).not.toContain('chain-executor');
      expect(result.content).not.toContain('claude-prompts:');
    });
  });

  /**
   * P5-F5 — delegation reachability on the DIRECT (non-symbolic) invocation path.
   *
   * A plain `>>chain_prompt` never produces symbolic operators: `CommandParsingStage` takes
   * `buildDirectCommand`, which writes each step's `subagentModel` onto `parsedCommand.steps`
   * and leaves `parsedCommand.operators` undefined. `OperatorValidationStage` used to return on
   * an empty operator set BEFORE `normalizeDelegation`, so YAML-declared delegation was inert on
   * every invocation that did not spell `==>` — the exact thing `docs/reference/chain-schema.md`
   * documents as working. Real stage 04 + real stage 06 + real executor; only the logger and the
   * prompt fixtures are stand-ins.
   */
  describe('direct invocation path — YAML subagentModel (P5-F5)', () => {
    const chainPrompts: ConvertedPrompt[] = [
      ...testPrompts,
      {
        id: 'delegating_chain',
        name: 'Delegating Chain',
        description: 'Chain whose second step declares subagentModel in YAML',
        category: 'analysis',
        userMessageTemplate: 'Run the chain',
        arguments: [],
        chainSteps: [
          { promptId: 'research', stepName: 'Research' },
          { promptId: 'summarize', stepName: 'Summarize', subagentModel: 'fast' },
        ],
      } as ConvertedPrompt,
      {
        id: 'plain_chain',
        name: 'Plain Chain',
        description: 'Chain declaring no delegation fields at all',
        category: 'analysis',
        userMessageTemplate: 'Run the chain',
        arguments: [],
        chainSteps: [
          { promptId: 'research', stepName: 'Research' },
          { promptId: 'summarize', stepName: 'Summarize' },
        ],
      } as ConvertedPrompt,
    ];

    /** Drive real stage 04 over a bare `>>id` command — no operators, no `==>`. */
    const parseDirectly = async (command: string): Promise<ExecutionContext> => {
      const parsing = createParsingSystem(mockLogger);
      const stage04 = new CommandParsingStage(
        parsing.commandParser,
        parsing.argumentParser,
        () => chainPrompts,
        mockLogger,
        new SymbolicCommandBuilder(parsing.argumentParser, mockLogger)
      );
      const context = new ExecutionContext({ command });
      await stage04.execute(context);
      return context;
    };

    const runStage06 = async (context: ExecutionContext): Promise<void> => {
      await new OperatorValidationStage(null, mockLogger).execute(context);
    };

    test('the direct path really produces no operators (the exit that hid the defect)', async () => {
      const context = await parseDirectly('>>delegating_chain');

      // If this ever becomes non-empty the suite below stops discriminating: it would then be
      // exercising the symbolic path the `==>` tests above already cover.
      expect(context.parsedCommand?.operators?.operators ?? []).toHaveLength(0);
      expect(context.parsedCommand?.commandType).toBe('chain');
      expect(context.parsedCommand?.steps?.[1]?.subagentModel).toBe('fast');
    });

    test('stage 06 marks the step delegated even though no operator was parsed', async () => {
      const context = await parseDirectly('>>delegating_chain');
      expect(context.parsedCommand?.steps?.[1]?.delegated).toBeUndefined();

      await runStage06(context);

      expect(context.parsedCommand!.steps![0]!.delegated).not.toBe(true);
      expect(context.parsedCommand!.steps![1]!.delegated).toBe(true);
    });

    test('the marked step produces a delegation CTA on the preceding step', async () => {
      const context = await parseDirectly('>>delegating_chain');
      await runStage06(context);

      // The preceding step's CTA is the one-line advisory now (S7) — not the full CTA.
      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: context.parsedCommand!.steps!,
        currentStepIndex: 0,
      });

      expect(result.nextStepDelegated).toBe(true);
      expect(result.callToAction).toContain('⚡ Note');
      expect(result.callToAction).not.toContain('HANDOFF INSTRUCTIONS');

      // The full handoff — HANDOFF INSTRUCTIONS, Tool: Task — renders WITH the marked step's
      // own EXECUTION BRIEF, one resume later.
      const delegatedResult = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: context.parsedCommand!.steps!,
        currentStepIndex: 1,
      });
      expect(delegatedResult.content).toContain('HANDOFF INSTRUCTIONS');
      expect(delegatedResult.content).toContain('Tool: Task');
    });

    test('a chain declaring no delegation fields is untouched by stage 06', async () => {
      const context = await parseDirectly('>>plain_chain');
      const before = JSON.stringify(context.parsedCommand!.steps);

      await runStage06(context);

      // Bounds the blast radius: the hoist may only add marks where a `subagentModel` exists.
      // Measured 2026-08-12 (`rg --no-ignore`): 1 of 17 shipped chain resources carries one.
      expect(JSON.stringify(context.parsedCommand!.steps)).toBe(before);
      expect(context.parsedCommand!.steps!.some((s) => s.delegated === true)).toBe(false);

      const result = await executor.renderStep({
        executionType: 'normal',
        stepPrompts: context.parsedCommand!.steps!,
        currentStepIndex: 0,
      });
      expect(result.nextStepDelegated).toBeUndefined();
      expect(result.callToAction).not.toContain('HANDOFF');
    });
  });
});
