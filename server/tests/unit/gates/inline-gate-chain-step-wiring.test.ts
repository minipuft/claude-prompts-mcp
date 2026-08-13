import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { CommandParsingStage } from '../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
import { GateSetResolver } from '../../../src/engine/gates/services/gate-set-resolver.js';
import { ChainStepSchema } from '../../../src/modules/prompts/prompt-schema.js';
import { yamlToPromptData } from '../../../src/modules/prompts/yaml-prompt-loader.js';

import type {
  ArgumentParser,
  ArgumentParsingResult,
} from '../../../src/engine/execution/parsers/argument-parser.js';
import type { UnifiedCommandParser } from '../../../src/engine/execution/parsers/command-parser.js';
import type { SymbolicCommandBuilder } from '../../../src/engine/execution/parsers/symbolic-command-builder.js';
import type { PromptYaml } from '../../../src/modules/prompts/prompt-schema.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';

/**
 * `inlineGateIds` end-to-end across the three strippers (P6 Tier 4, OQ-P6-8).
 *
 * The reader has always existed — `GateEnhancementService.enhanceChainSteps` passes
 * `step.inlineGateIds` to `GateSetResolver` as `inlineOperatorGateIds`. What made the field dead
 * were three sequential strippers between authoring and runtime (P6-F7):
 *
 *   1. `ChainStepSchema` — declared the field (already fixed before this tier)
 *   2. `normalizeChainSteps`'s allowlist in yaml-prompt-loader — dropped it
 *   3. the stage-04 projection onto `ChainStepPrompt` — dropped it
 *
 * A field carried at fewer than all three is silently dead, so this suite walks all three plus
 * the resolver, and every stage carries a negative that must stay byte-identical for a step that
 * declares nothing.
 */

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

function makeYaml(overrides: Partial<PromptYaml> = {}): PromptYaml {
  return {
    id: 'gated_chain',
    name: 'Gated Chain',
    description: 'chain with a step-level gate binding',
    arguments: [],
    ...overrides,
  } as PromptYaml;
}

const createArgumentResult = (
  processedArgs: ArgumentParsingResult['processedArgs']
): ArgumentParsingResult => ({
  processedArgs,
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

describe('stripper 1 — ChainStepSchema', () => {
  test('accepts a step-level inlineGateIds declaration', () => {
    const result = ChainStepSchema.safeParse({
      promptId: 'inline',
      stepName: 'Gated Step',
      inlineGateIds: ['code-quality'],
    });
    expect(result.success).toBe(true);
  });
});

describe('stripper 2 — normalizeChainSteps (yaml-prompt-loader)', () => {
  test('carries inlineGateIds from YAML into PromptData', () => {
    // normalizeChainSteps builds its output object field-by-field rather than spreading `step`,
    // so an accepted field is silently dropped unless it is named there.
    const result = yamlToPromptData(
      makeYaml({
        chainSteps: [
          { promptId: 'setup', stepName: 'Setup' },
          { promptId: 'inline', stepName: 'Gated Step', inlineGateIds: ['code-quality'] },
        ],
      } as Partial<PromptYaml>)
    );

    expect(result.chainSteps?.[1]?.inlineGateIds).toEqual(['code-quality']);
  });

  test('leaves a step that declares nothing without the key at all', () => {
    // The byte-identical negative. 16 of 17 local chains — and every bundled chain — declare no
    // inlineGateIds, and this is what bounds the blast radius of the wiring.
    const result = yamlToPromptData(
      makeYaml({
        chainSteps: [{ promptId: 'setup', stepName: 'Setup' }],
      } as Partial<PromptYaml>)
    );

    expect(result.chainSteps?.[0]).not.toHaveProperty('inlineGateIds');
  });
});

describe('stripper 3 — the stage-04 projection onto ChainStepPrompt', () => {
  async function parseChain(chainSteps: ConvertedPrompt['chainSteps']): Promise<ExecutionContext> {
    const chainPrompt: ConvertedPrompt = {
      id: 'gated_chain',
      name: 'Gated Chain',
      description: '',
      category: 'general',
      userMessageTemplate: '',
      arguments: [],
      chainSteps,
    };
    const stepPrompt: ConvertedPrompt = {
      id: 'inline',
      name: 'Inline',
      description: '',
      category: 'general',
      userMessageTemplate: 'step',
      arguments: [],
    };
    const setupPrompt: ConvertedPrompt = { ...stepPrompt, id: 'setup', name: 'Setup' };

    const mockCommandParser: Partial<UnifiedCommandParser> = {
      parseCommand: jest.fn<any>().mockResolvedValue({
        promptId: 'gated_chain',
        rawArgs: '',
        format: 'simple' as const,
        commandType: 'single' as const,
        confidence: 1,
        metadata: {
          originalCommand: '>>gated_chain',
          parseStrategy: 'simple',
          detectedFormat: 'simple',
          warnings: [],
        },
      }),
    };
    const mockArgumentParser: Partial<ArgumentParser> = {
      parseArguments: jest.fn<any>().mockResolvedValue(createArgumentResult({})),
    };

    const stage = new CommandParsingStage(
      mockCommandParser as UnifiedCommandParser,
      mockArgumentParser as ArgumentParser,
      () => [chainPrompt, stepPrompt, setupPrompt],
      createLogger() as never,
      { buildSymbolicCommand: jest.fn() } as unknown as SymbolicCommandBuilder
    );

    const context = new ExecutionContext({ command: '>>gated_chain' });
    await stage.execute(context);
    return context;
  }

  test('projects a declared inlineGateIds onto the runtime step', async () => {
    const context = await parseChain([
      { promptId: 'setup', stepName: 'Setup' },
      { promptId: 'inline', stepName: 'Gated Step', inlineGateIds: ['code-quality'] },
    ]);

    expect(context.parsedCommand?.steps?.[1]?.inlineGateIds).toEqual(['code-quality']);
  });

  test('copies rather than aliases the authored array', async () => {
    // The projection spreads into a new array. Aliasing would let a runtime mutation
    // (InlineGateProcessor appends to `target.inlineGateIds`) write back into the loaded
    // resource, which survives for the process lifetime and would leak across runs.
    const authored = ['code-quality'];
    const context = await parseChain([
      { promptId: 'inline', stepName: 'Gated Step', inlineGateIds: authored },
    ]);

    // Asserted present FIRST. Without it the push below is an optional-chain no-op and the test
    // passes on a build where the projection was dropped entirely — a mutation never reached.
    const projected = context.parsedCommand?.steps?.[0]?.inlineGateIds;
    expect(projected).toEqual(['code-quality']);
    expect(projected).not.toBe(authored);

    projected?.push('mutated');
    expect(authored).toEqual(['code-quality']);
  });

  test('leaves a step that declares nothing without the key at all', async () => {
    const context = await parseChain([{ promptId: 'setup', stepName: 'Setup' }]);
    expect(context.parsedCommand?.steps?.[0]).not.toHaveProperty('inlineGateIds');
  });
});

describe('the channel the projected field feeds', () => {
  test('GateSetResolver accepts the ids at rank inline-operator', async () => {
    // This is the reader that predated the producer. Proving the rank matters: `inline-operator`
    // is rank 100, above a caller-supplied gate, so a step-level binding is not silently
    // outranked by anything else in the accumulation.
    const resolver = new GateSetResolver(createLogger() as never, undefined, undefined);
    const resolution = await resolver.resolve({
      prompt: {
        id: 'inline',
        name: 'Inline',
        description: '',
        category: 'general',
        userMessageTemplate: 'step',
        arguments: [],
      } as unknown as ConvertedPrompt,
      category: 'general',
      frameworkInjected: false,
      inlineOperatorGateIds: ['code-quality'],
      autoAssignCategoryGates: false,
    });

    const accepted = resolution.accepted.find((gate) => gate.id === 'code-quality');
    expect(accepted).toBeDefined();
    expect(accepted?.source).toBe('inline-operator');
  });
});
