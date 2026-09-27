import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createSymbolicCommandParser } from '../../../../src/engine/execution/parsers/symbolic-operator-parser.js';
import { SymbolicCommandBuilder } from '../../../../src/engine/execution/parsers/symbolic-command-builder.js';
import { retargetGates } from '../../../../src/modules/workflow-ir/chain-prompt-expansion.js';
import { compileWorkflowIR } from '../../../../src/modules/workflow-ir/compiler.js';
import { validateWorkflowIR } from '../../../../src/modules/workflow-ir/validator.js';

import type {
  ArgumentParser,
  ArgumentParsingResult,
} from '../../../../src/engine/execution/parsers/argument-parser.js';
import type { ChainOperator } from '../../../../src/engine/execution/parsers/types/operator-types.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

/**
 * S9 — per-step inline gate attribution (plans/subagent-delegation-contract-2026-08-12.md).
 *
 * A `::` gate token inside a chain segment used to stay in the segment text, so it polluted
 * the step's positional args AND never reached `ExecutionStep.inlineGateCriteria` (which had
 * zero writers). These tests pin the fix: the token is stripped from the segment and the
 * anonymous/canonical criteria attach to the step that carried it. A named form registers once on
 * the global namedInlineGates path, and since R44 (P6.99) its id also joins the criteria of the
 * segment that carried it, so that segment's node binds it; `verify:` stays command-level (R32).
 * The deprecated `=` form is untouched.
 */
describe('S9 — inline gate token attribution in symbolic chains', () => {
  let parser: ReturnType<typeof createSymbolicCommandParser>;
  let logger: Logger;

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    parser = createSymbolicCommandParser(logger);
    jest.clearAllMocks();
  });

  function chainOpOf(command: string): ChainOperator {
    const result = parser.detectOperators(command);
    const chainOp = result.operators.find((op): op is ChainOperator => op.type === 'chain');
    if (!chainOp) {
      throw new Error(`No chain operator detected for: ${command}`);
    }
    return chainOp;
  }

  test('canonical gate token attaches to its step and leaves args clean', () => {
    const chainOp = chainOpOf('>>a :: code-quality ==> >>b');

    expect(chainOp.steps).toHaveLength(2);
    expect(chainOp.steps[0].promptId).toBe('a');
    expect(chainOp.steps[0].inlineGateCriteria).toEqual(['code-quality']);
    expect(chainOp.steps[0].args).not.toContain('::');
    expect(chainOp.steps[0].args).not.toContain('code-quality');
    expect(chainOp.steps[0].args).toBe('');
    expect(chainOp.steps[1].promptId).toBe('b');
    expect(chainOp.steps[1].inlineGateCriteria).toBeUndefined();
  });

  test('gate token on the second segment attributes to step 2, not step 1', () => {
    const chainOp = chainOpOf('>>a --> >>b :: code-quality');

    expect(chainOp.steps).toHaveLength(2);
    expect(chainOp.steps[0].inlineGateCriteria).toBeUndefined();
    expect(chainOp.steps[1].inlineGateCriteria).toEqual(['code-quality']);
    expect(chainOp.steps[1].args).toBe('');
  });

  test('quoted anonymous criteria attach to their step with clean args', () => {
    const chainOp = chainOpOf('>>a :: "cite sources" --> >>b');

    expect(chainOp.steps).toHaveLength(2);
    expect(chainOp.steps[0].inlineGateCriteria).toEqual(['cite sources']);
    expect(chainOp.steps[0].args).toBe('');
    expect(chainOp.steps[1].inlineGateCriteria).toBeUndefined();
  });

  test('P6.99: a named gate token is stripped from args and its id binds only its own segment', () => {
    const command = '>>a :: security:"no secrets" --> >>b';
    const detection = parser.detectOperators(command);

    const chainOp = detection.operators.find((op): op is ChainOperator => op.type === 'chain');
    expect(chainOp).toBeDefined();
    expect(chainOp?.steps[0].args).toBe('');
    expect(chainOp?.steps.map((step) => step.inlineGateCriteria)).toEqual([
      ['security'],
      undefined,
    ]);

    // Named-gate registration stays on the global path (feeds namedInlineGates).
    const namedGate = detection.operators.find(
      (op) => op.type === 'gate' && op.gateId === 'security'
    );
    expect(namedGate).toBeDefined();
    if (namedGate?.type === 'gate') {
      expect(namedGate.parsedCriteria).toEqual(['no secrets']);
    }
  });

  test('P6.99: a named gate on a later segment binds that segment, not the first', () => {
    const chainOp = chainOpOf('>>a --> >>b :: mygate:"NAMED-99"');
    expect(chainOp.steps.map((step) => step.inlineGateCriteria)).toEqual([undefined, ['mygate']]);
  });

  test('P6.99 control: a `verify:` token on a segment stays command-level and binds no segment', () => {
    const chainOp = chainOpOf('>>a --> >>b :: verify:"true"');
    expect(chainOp.steps.map((step) => step.inlineGateCriteria)).toEqual([undefined, undefined]);
  });

  test('regression: `::` inside a double-quoted arg value is preserved verbatim', () => {
    const chainOp = chainOpOf('>>a input="has :: colons inside" --> >>b');

    expect(chainOp.steps).toHaveLength(2);
    expect(chainOp.steps[0].args).toBe('input="has :: colons inside"');
    expect(chainOp.steps[0].inlineGateCriteria).toBeUndefined();
  });

  test('regression: deprecated bare `=` form is untouched in segments', () => {
    // Baseline measured BEFORE the S9 change (2026-08-18): step args keep the `= "x"` text,
    // whole-command detection still reports a (deprecated) gate with criteria "x".
    const command = '>>a note = "x" --> >>b';
    const detection = parser.detectOperators(command);

    const chainOp = detection.operators.find((op): op is ChainOperator => op.type === 'chain');
    expect(chainOp).toBeDefined();
    expect(chainOp?.steps).toHaveLength(2);
    expect(chainOp?.steps[0].promptId).toBe('a');
    expect(chainOp?.steps[0].args).toBe('note = "x"');
    expect(chainOp?.steps[0].inlineGateCriteria).toBeUndefined();

    expect(detection.operatorTypes).toContain('gate');
    const gateOp = detection.operators.find((op) => op.type === 'gate');
    if (gateOp?.type === 'gate') {
      expect(gateOp.criteria).toBe('x');
      expect(gateOp.parsedCriteria).toEqual(['x']);
    }
  });

  describe('builder-level attribution (buildSymbolicChain)', () => {
    const createArgumentResult = (): ArgumentParsingResult => ({
      processedArgs: {},
      resolvedPlaceholders: {},
      validationResults: [],
      metadata: {
        parsingStrategy: 'test',
        appliedDefaults: [],
        typeCoercions: [],
        contextSources: {},
        warnings: [],
      },
    });

    const makePrompt = (id: string): ConvertedPrompt => ({
      id,
      name: id,
      description: '',
      category: 'general',
      userMessageTemplate: '',
      arguments: [],
    });

    function createBuilder(): SymbolicCommandBuilder {
      const argumentParser = {
        parseArguments: jest.fn(async () => createArgumentResult()),
      } as unknown as ArgumentParser;
      return new SymbolicCommandBuilder(argumentParser, logger, {
        validate: validateWorkflowIR,
        compile: compileWorkflowIR,
        retargetGates,
      });
    }

    test('step carries inlineGateCriteria and no orphan command-level gate is seeded', async () => {
      const command = '>>a :: code-quality ==> >>b';
      const detection = parser.detectOperators(command);
      const parseResult = parser.buildParseResult(command, detection, 'a', '');

      const builder = createBuilder();
      const findPrompt = (id: string) => makePrompt(id);
      const built = await builder.buildSymbolicCommand(parseResult, findPrompt);
      if (!built.ok) throw new Error(JSON.stringify(built.rejections));
      const parsedCommand = built.parsedCommand;

      expect(parseResult.executionPlan.steps[0].inlineGateCriteria).toEqual(['code-quality']);
      expect(parsedCommand.steps?.[0]?.inlineGateCriteria).toEqual(['code-quality']);
      expect(parsedCommand.steps?.[1]?.inlineGateCriteria).toEqual([]);
      // The whole-command anonymousCriteria must NOT double-register as an
      // execution-scope gate no step reviews.
      expect(parsedCommand.inlineGateCriteria ?? []).toEqual([]);
    });

    test("P6.99: a named gate registers globally and binds only its own segment's node", async () => {
      const command = '>>a :: security:"no secrets" --> >>b';
      const detection = parser.detectOperators(command);
      const parseResult = parser.buildParseResult(command, detection, 'a', '');

      const builder = createBuilder();
      const built = await builder.buildSymbolicCommand(parseResult, (id: string) => makePrompt(id));
      if (!built.ok) throw new Error(JSON.stringify(built.rejections));
      const parsedCommand = built.parsedCommand;

      expect(parsedCommand.namedInlineGates).toEqual([
        { gateId: 'security', criteria: ['no secrets'] },
      ]);
      expect(parsedCommand.steps?.map((step) => step.inlineGateCriteria)).toEqual([
        ['security'],
        [],
      ]);
      expect(parsedCommand.inlineGateCriteria ?? []).toEqual([]);
    });
  });
});
