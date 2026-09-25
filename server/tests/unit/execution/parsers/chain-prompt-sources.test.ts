// @lifecycle test - P6.86 / R36 / R40: every command source that can name a chain prompt projects the same steps.
/**
 * Four sources build a `ParsedCommand` from a command, and each can name a chain prompt: a direct
 * `>>chain` (`CommandParsingStage.buildDirectCommand`), a single symbolic command
 * (`SymbolicCommandBuilder.buildSingleSymbolicPrompt`), an arrow-chain segment
 * (`buildSymbolicChain` → `compileWorkflowIR`) and a submitted Workflow IR node
 * (`WorkflowCommandBuilder` → `compileWorkflowIR`). Before P6.74/P6.79 two of the four ran the
 * chain prompt's own template as one step, and nothing failed when they diverged.
 *
 * Each source is driven through the real stage 04 with the same chain prompt and the same run
 * argument, and its steps are compared with `projectChainPromptSteps` on `promptId`, `args` and
 * `inlineGateIds`, byte for byte. Node ids are left aside: the direct and single-symbolic sources
 * keep the projection's ids (`a`, `b`, `c`), while the two IR sources mint `<node>-<step>` (R40).
 *
 * The enumeration is closed by a predicate, not by this list alone: every `: ParsedCommand = {`
 * construction in `src/` must be claimed by a row below, so a fifth source fails by file name.
 * Blind spot (as of 2026-09-25 · flips when a remainder or `chain_id` append can name a chain
 * prompt without passing `compileWorkflowIR`): model-authored remainders write store nodes, not a
 * `ParsedCommand`, so this predicate does not see them.
 */
import { describe, expect, test } from '@jest/globals';

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ArgumentParser } from '../../../../src/engine/execution/parsers/argument-parser.js';
import { projectChainPromptSteps } from '../../../../src/engine/execution/parsers/chain-step-projection.js';
import { UnifiedCommandParser } from '../../../../src/engine/execution/parsers/command-parser.js';
import { SymbolicCommandBuilder } from '../../../../src/engine/execution/parsers/symbolic-command-builder.js';
import { WorkflowCommandBuilder } from '../../../../src/engine/execution/parsers/workflow-command-builder.js';
import { CommandParsingStage } from '../../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
import { createSimpleLogger } from '../../../../src/infra/logging/index.js';
import { compileWorkflowIR } from '../../../../src/modules/workflow-ir/compiler.js';
import { validateWorkflowIR } from '../../../../src/modules/workflow-ir/validator.js';

import type { ParsedCommand } from '../../../../src/engine/execution/context/index.js';
import type { ChainStepPrompt } from '../../../../src/engine/execution/operators/types.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../src');
/** Assembled, so no command literal in this file carries the operator as prose. */
const ARROW = ' -' + '-> ';
const TOPIC: ConvertedPrompt['arguments'] = [{ name: 'topic', type: 'string', required: false }];

const prompt = (id: string, extra: Partial<ConvertedPrompt> = {}): ConvertedPrompt => ({
  id,
  name: id,
  description: id,
  category: 'test',
  arguments: TOPIC,
  userMessageTemplate: `BODY-${id}`,
  ...extra,
});
const svA = prompt('sv_a');
const svB = prompt('sv_b');
const svChain = prompt('sv_chain', {
  userMessageTemplate: 'CHAIN-OWN-TEMPLATE',
  chainSteps: [
    { promptId: 'sv_a', stepName: 'A', inlineGateIds: ['sv-block'] },
    { promptId: 'sv_b', stepName: 'B', inlineGateIds: ['sv-block'], args: { depth: 'deep' } },
    { promptId: 'sv_a', stepName: 'C', inlineGateIds: ['sv-block'] },
  ],
});
const prompts = [svA, svB, svChain];
const lookup = (id: string): ConvertedPrompt | undefined => prompts.find((p) => p.id === id);

const logger = createSimpleLogger();
const argumentParser = new ArgumentParser(logger);
const stage = new CommandParsingStage(
  new UnifiedCommandParser(logger),
  argumentParser,
  () => prompts,
  logger,
  new SymbolicCommandBuilder(argumentParser, logger, compileWorkflowIR),
  {
    workflowCommandBuilder: new WorkflowCommandBuilder(
      { validate: validateWorkflowIR, compile: compileWorkflowIR },
      logger
    ),
  }
);

async function parse(request: Record<string, unknown>): Promise<ParsedCommand> {
  const context = new ExecutionContext(request as never);
  await stage.execute(context);
  if (context.parsedCommand === undefined) {
    throw new Error(`no parsed command for ${JSON.stringify(request)}`);
  }
  return context.parsedCommand;
}

/** The part of a step every source must agree on. */
const rows = (steps: readonly ChainStepPrompt[] | undefined): string[] =>
  (steps ?? []).map((step) =>
    JSON.stringify([step.promptId, step.args, step.inlineGateIds ?? null])
  );

interface CommandSource {
  readonly name: string;
  /** The `: ParsedCommand = {` construction sites this source owns, as `<file>`. */
  readonly sites: readonly string[];
  /** The chain prompt's steps as this source yields them. */
  readonly steps: () => Promise<readonly ChainStepPrompt[] | undefined>;
}

const SOURCES: readonly CommandSource[] = [
  {
    name: 'direct',
    sites: ['engine/execution/pipeline/stages/04-parsing-stage.ts'],
    steps: async () => (await parse({ command: '>>sv_chain topic="T"' })).steps,
  },
  {
    name: 'single-symbolic',
    sites: ['engine/execution/parsers/symbolic-command-builder.ts'],
    steps: async () => (await parse({ command: '>>sv_chain topic="T" :: verify:"true"' })).steps,
  },
  {
    name: 'arrow-chain',
    sites: ['engine/execution/parsers/symbolic-command-builder.ts'],
    // The segment's steps; the trailing `sv_b` segment is the arrow's other node
    steps: async () =>
      (await parse({ command: `>>sv_chain topic="T"${ARROW}>>sv_b` })).steps?.slice(0, 3),
  },
  {
    name: 'workflow-ir',
    sites: ['engine/execution/parsers/workflow-command-builder.ts'],
    steps: async () =>
      (
        await parse({
          workflow: {
            version: 1,
            nodes: [{ id: 'x', promptId: 'sv_chain', args: { topic: 'T' } }],
          },
        })
      ).steps,
  },
];

/** The projection every source must reach. */
const expected = rows(projectChainPromptSteps(svChain, { topic: 'T' }, lookup)?.steps);

/** Names of the sources whose steps differ from the projection. */
async function divergent(sources: readonly CommandSource[]): Promise<string[]> {
  const names: string[] = [];
  for (const source of sources) {
    if (JSON.stringify(rows(await source.steps())) !== JSON.stringify(expected)) {
      names.push(source.name);
    }
  }
  return names;
}

function parsedCommandSites(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return parsedCommandSites(full);
    if (!entry.name.endsWith('.ts')) return [];
    const count = readFileSync(full, 'utf8').match(/:\s*ParsedCommand\s*=\s*\{/g)?.length ?? 0;
    return Array.from({ length: count }, () => path.relative(SRC, full));
  });
}

describe('every command source naming a chain prompt projects the same steps', () => {
  test('the projection itself is three steps carrying the run argument', () => {
    expect(expected).toEqual([
      JSON.stringify(['sv_a', { topic: 'T' }, ['sv-block']]),
      JSON.stringify(['sv_b', { topic: 'T', depth: 'deep' }, ['sv-block']]),
      JSON.stringify(['sv_a', { topic: 'T' }, ['sv-block']]),
    ]);
  });

  test.each(SOURCES.map((source) => [source.name, source] as const))(
    '%s yields the projected steps',
    async (_name, source) => {
      expect(await divergent([source])).toEqual([]);
    }
  );

  test('control: a planted source that skips the projection fails by name', async () => {
    const planted: CommandSource = {
      name: 'planted-unprojected',
      sites: [],
      steps: async () => [
        {
          stepNumber: 1,
          nodeId: 'n1',
          promptId: svChain.id,
          args: { topic: 'T' },
          variableName: 'step_1',
          convertedPrompt: svChain,
        } as ChainStepPrompt,
      ],
    };
    expect(await divergent([...SOURCES, planted])).toEqual(['planted-unprojected']);
  });

  test('every ParsedCommand construction in src/ belongs to an enumerated source', () => {
    // One entry per construction, so a second one in an already-claimed file fails too
    const claimed = SOURCES.flatMap((source) => source.sites).sort();
    const found = parsedCommandSites(SRC).sort();
    // Positive control: the scan reaches the four constructions the sources name
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(found).toEqual(claimed);
  });
});
