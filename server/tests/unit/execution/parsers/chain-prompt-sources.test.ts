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
 * A fifth source writes store nodes rather than a `ParsedCommand`: a model-authored remainder
 * (the `remainder` parameter, and the `chain_id` arrow-append the executor rewrites into it). It is
 * driven through the real `RemainderProcessor.apply` against a session with an open blocking
 * unknown and a store that records the node specs `replaceRemainder` is handed (P6.93). A
 * contributed node carries only `{id, promptId, stepName, args, delegated}`, so this row names an
 * UNGATED chain prompt (`sv_pair`) and its expected rows come from that prompt's projection; a
 * chain prompt whose steps declare gates is refused by name (asserted below).
 *
 * The enumeration is closed by two predicates, not by this list alone: every `: ParsedCommand = {`
 * construction and every `.replaceRemainder(` call in `src/` must be claimed by a row below, so a
 * sixth source fails by file name.
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
import { RemainderProcessor } from '../../../../src/engine/execution/capture/remainder-processor.js';
import { createSimpleLogger } from '../../../../src/infra/logging/index.js';
import { compileWorkflowIR } from '../../../../src/modules/workflow-ir/compiler.js';
import { DEFAULT_WORKFLOW_CAPS } from '../../../../src/modules/workflow-ir/node-schema.js';
import { validateWorkflowIR } from '../../../../src/modules/workflow-ir/validator.js';

import type { ParsedCommand } from '../../../../src/engine/execution/context/index.js';
import type {
  ChainSession,
  ChainSessionService,
  RemainderNodeSpec,
} from '../../../../src/shared/types/chain-session.js';
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
const svPair = prompt('sv_pair', {
  userMessageTemplate: 'CHAIN-OWN-TEMPLATE',
  chainSteps: [
    { promptId: 'sv_a', stepName: 'A' },
    { promptId: 'sv_b', stepName: 'B', args: { depth: 'deep' } },
  ],
});
const prompts = [svA, svB, svChain, svPair];
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

/**
 * Apply `{mode:'append', nodes:[{id:'r1', promptId, args:{topic:'T'}}]}` to a one-node run holding
 * an open blocking unknown, and return what the store was asked to write — or the refusal.
 */
async function appendRemainder(
  promptId: string
): Promise<{ written: readonly RemainderNodeSpec[]; refusal?: string }> {
  let written: readonly RemainderNodeSpec[] = [];
  const store = {
    replaceRemainder: async (_id: string, nodes: readonly RemainderNodeSpec[]) => {
      written = nodes;
      return { kind: 'applied', mode: 'append', nodes: [] };
    },
  } as unknown as ChainSessionService;
  const session = {
    sessionId: 's1',
    unknownsLedger: [
      { id: 'u1', statement: 'open', state: 'active', blocking: true, discoveredAtStep: 1 },
    ],
    state: {
      currentNodeId: 'n1',
      nodes: [{ id: 'n1', promptId: 'sv_a', stepName: 'sv_a' }],
      lastUpdated: 0,
    },
  } as unknown as ChainSession;
  const outcome = await new RemainderProcessor(
    store,
    { validate: validateWorkflowIR, defaultCaps: DEFAULT_WORKFLOW_CAPS },
    () => prompts,
    logger
  ).apply('s1', session, {
    mode: 'append',
    nodes: [{ id: 'r1', promptId, args: { topic: 'T' } }],
  });
  return outcome.kind === 'refused' ? { written, refusal: outcome.message } : { written };
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
  /** The `.replaceRemainder(` call sites this source owns, as `<file>`. */
  readonly writes?: readonly string[];
  /** The chain prompt this source names; `sv_chain` unless the source cannot carry step gates. */
  readonly chainPrompt?: ConvertedPrompt;
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
  {
    name: 'remainder-append',
    sites: [],
    writes: ['engine/execution/capture/remainder-processor.ts'],
    chainPrompt: svPair,
    // What the store writes, as steps: a contributed node carries no gate ids.
    steps: async () =>
      (await appendRemainder('sv_pair')).written.map(
        (spec, index) =>
          ({
            stepNumber: index + 1,
            nodeId: spec.id,
            promptId: spec.promptId,
            args: spec.args,
            variableName: spec.stepName,
          }) as ChainStepPrompt
      ),
  },
];

/** The projection a source must reach. */
const expectedFor = (source: CommandSource): string[] =>
  rows(projectChainPromptSteps(source.chainPrompt ?? svChain, { topic: 'T' }, lookup)?.steps);
const expected = expectedFor(SOURCES[0] as CommandSource);

/** Names of the sources whose steps differ from the projection. */
async function divergent(sources: readonly CommandSource[]): Promise<string[]> {
  const names: string[] = [];
  for (const source of sources) {
    if (JSON.stringify(rows(await source.steps())) !== JSON.stringify(expectedFor(source))) {
      names.push(source.name);
    }
  }
  return names;
}

function sitesMatching(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sitesMatching(full, pattern);
    if (!entry.name.endsWith('.ts')) return [];
    const count = readFileSync(full, 'utf8').match(pattern)?.length ?? 0;
    return Array.from({ length: count }, () => path.relative(SRC, full));
  });
}
const parsedCommandSites = (dir: string) => sitesMatching(dir, /:\s*ParsedCommand\s*=\s*\{/g);

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

  test('every remainder write in src/ belongs to an enumerated source', () => {
    const claimed = SOURCES.flatMap((source) => source.writes ?? []).sort();
    // `this.chainSessionStore.replaceRemainder(` — the interface declaration and the store's own
    // definition carry no receiver, so only callers match.
    const found = sitesMatching(SRC, /\.replaceRemainder\(/g).sort();
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found).toEqual(claimed);
  });

  test('the remainder source refuses a chain prompt whose steps declare gates, by name', async () => {
    const { written, refusal } = await appendRemainder('sv_chain');
    expect(written).toEqual([]);
    expect(refusal).toContain('- step "r1-a": inlineGateIds');
    // Positive control: the ungated chain prompt reaches the store
    expect((await appendRemainder('sv_pair')).written.map((spec) => spec.id)).toEqual([
      'r1-a',
      'r1-b',
    ]);
  });
});
