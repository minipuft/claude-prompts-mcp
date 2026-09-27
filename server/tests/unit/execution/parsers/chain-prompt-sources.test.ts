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
import {
  WorkflowCommandBuilder,
  type WorkflowIrPort,
} from '../../../../src/engine/execution/parsers/workflow-command-builder.js';
import { CommandParsingStage } from '../../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
import { RemainderProcessor } from '../../../../src/engine/execution/capture/remainder-processor.js';
import { createSimpleLogger } from '../../../../src/infra/logging/index.js';
import { retargetGates } from '../../../../src/modules/workflow-ir/chain-prompt-expansion.js';
import { compileWorkflowIR } from '../../../../src/modules/workflow-ir/compiler.js';
import { DEFAULT_WORKFLOW_CAPS } from '../../../../src/modules/workflow-ir/node-schema.js';
import { validateWorkflowIR } from '../../../../src/modules/workflow-ir/validator.js';
import { workflowPromptInfoLookup } from '../../../../src/engine/execution/workflow-prompt-lookup.js';

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
/** P6.95: a chain prompt whose run argument declares a default. */
const svDefault = prompt('sv_default', {
  arguments: [{ name: 'topic', type: 'string', required: false, defaultValue: 'DEF-95' }],
  userMessageTemplate: 'CHAIN-OWN-TEMPLATE',
  chainSteps: [
    { promptId: 'sv_a', stepName: 'A' },
    { promptId: 'sv_b', stepName: 'B', args: { depth: 'deep' } },
  ],
});
/** P6.105: 32 steps — one segment naming it plus one more is 33 expanded nodes, past the cap. */
const svBig = prompt('sv_big', {
  userMessageTemplate: 'CHAIN-OWN-TEMPLATE',
  chainSteps: Array.from({ length: 32 }, (_, index) => ({
    promptId: 'sv_a',
    stepName: `S${index + 1}`,
  })),
});
/** P6.116: a prompt declaring a `required` argument. */
const svReq = prompt('sv_req', {
  arguments: [
    { name: 'topic', type: 'string', required: true },
    { name: 'tone', type: 'string', required: false },
  ],
});
const prompts = [svA, svB, svChain, svPair, svDefault, svBig, svReq];
const lookup = (id: string): ConvertedPrompt | undefined => prompts.find((p) => p.id === id);

const logger = createSimpleLogger();
const argumentParser = new ArgumentParser(logger);
const workflowIrPort = { validate: validateWorkflowIR, compile: compileWorkflowIR, retargetGates };
const stageWith = (symbolicPort: WorkflowIrPort): CommandParsingStage =>
  new CommandParsingStage(
    new UnifiedCommandParser(logger),
    argumentParser,
    () => prompts,
    logger,
    new SymbolicCommandBuilder(argumentParser, logger, symbolicPort),
    { workflowCommandBuilder: new WorkflowCommandBuilder(workflowIrPort, logger) }
  );
const stage = stageWith(workflowIrPort);

/** The reply stage 04 set instead of a parsed command, or `undefined` when it parsed. */
async function refusalFrom(
  request: Record<string, unknown>,
  through: CommandParsingStage = stage
): Promise<string | undefined> {
  const context = new ExecutionContext(request as never);
  await through.execute(context);
  return context.response?.content.map((part) => ('text' in part ? part.text : '')).join('\n');
}

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

  test('P6.96: the base chain id source names the prompt the client named, on both IR sources', async () => {
    // `SessionManagementStage.getBaseChainId` mints `chain-<parsedCommand.promptId>`.
    const arrow = await parse({ command: `>>sv_chain topic="T"${ARROW}>>sv_b` });
    const workflow = await parse({
      workflow: { version: 1, nodes: [{ id: 'x', promptId: 'sv_chain' }] },
    });
    expect([arrow.promptId, workflow.promptId]).toEqual(['sv_chain', 'sv_chain']);
    // Both expanded: the first step is the chain prompt's first step, not the id the run names
    expect([arrow.steps?.[0]?.promptId, workflow.steps?.[0]?.promptId]).toEqual(['sv_a', 'sv_a']);
    // Control: a workflow of single prompts names its first node's prompt
    const single = await parse({
      workflow: {
        version: 1,
        nodes: [
          { id: 'x', promptId: 'sv_b' },
          { id: 'y', promptId: 'sv_a' },
        ],
        edges: [{ from: 'x', to: 'y' }],
      },
    });
    expect(single.promptId).toBe('sv_b');
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

/**
 * P6.95 (OQ-A2b stands): with NO run arguments the command-string sources resolve the chain
 * prompt's declared arguments through `ArgumentParser` (author default, else `""`) and project
 * those onto every step, while a Workflow IR node's `args` is a declared object `compileNode`
 * never re-derives defaults for, so its steps carry only what the node declared. MEASURED
 * 2026-09-26 (driven, workflow `{x: <chain whose step declares topic default DEF-95>}`, no args):
 * the step renders `topic=DEF-95` on every source, because the render resolves the step prompt's
 * own defaults; the difference is in `args` only, so it is pinned here rather than fixed.
 *
 * The comparison EXCLUDES DEFAULTED KEYS: a key the run did not supply whose value is the chain
 * prompt's declared default or the parser's `""` fallback is dropped before comparing. Applying
 * the defaults to the IR row instead would hide the `""` fallback, which no declaration names.
 */
describe('P6.95: a chain prompt named with no run arguments', () => {
  const NO_ARG_SOURCES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['direct', { command: '>>sv_default' }],
    ['single-symbolic', { command: '>>sv_default :: verify:"true"' }],
    ['arrow-chain', { command: `>>sv_default${ARROW}>>sv_b` }],
    ['workflow-ir', { workflow: { version: 1, nodes: [{ id: 'x', promptId: 'sv_default' }] } }],
  ];
  const stepsOf = async (request: Record<string, unknown>) =>
    (await parse(request)).steps?.slice(0, 2);
  const defaulted = new Map(
    (svDefault.arguments ?? []).map((arg) => [arg.name, [arg.defaultValue, '']] as const)
  );
  /** A step's args without the keys the run did not supply and a default filled. */
  const withoutDefaulted = (steps: readonly ChainStepPrompt[] | undefined): string[] =>
    rows(
      (steps ?? []).map((step) => ({
        ...step,
        args: Object.fromEntries(
          Object.entries(step.args ?? {}).filter(
            ([key, value]) => !(defaulted.get(key) ?? []).includes(value as never)
          )
        ),
      }))
    );
  const projected = rows(projectChainPromptSteps(svDefault, {}, lookup)?.steps);

  test('the IR contract: only the workflow source leaves the defaulted key off its steps', async () => {
    const topics: Record<string, unknown[]> = {};
    for (const [name, request] of NO_ARG_SOURCES) {
      topics[name] = ((await stepsOf(request)) ?? []).map((step) => step.args?.['topic']);
    }
    expect(topics).toEqual({
      direct: ['DEF-95', 'DEF-95'],
      'single-symbolic': ['DEF-95', 'DEF-95'],
      'arrow-chain': ['DEF-95', 'DEF-95'],
      'workflow-ir': [undefined, undefined],
    });
  });

  test.each(NO_ARG_SOURCES)(
    '%s yields the projected steps once defaulted keys are excluded',
    async (_name, request) => {
      expect(withoutDefaulted(await stepsOf(request))).toEqual(projected);
    }
  );

  test('control: a planted source carrying an unsupplied, undefaulted key still fails by name', async () => {
    const planted = async () =>
      ((await stepsOf({ command: '>>sv_default' })) ?? []).map((step) => ({
        ...step,
        args: { ...step.args, topic: 'NOT-A-DEFAULT' },
      }));
    const names: string[] = [];
    for (const [name, steps] of [
      ...NO_ARG_SOURCES.map(([n, request]) => [n, () => stepsOf(request)] as const),
      ['planted-undefaulted', planted] as const,
    ]) {
      if (JSON.stringify(withoutDefaulted(await steps())) !== JSON.stringify(projected)) {
        names.push(name);
      }
    }
    expect(names).toEqual(['planted-undefaulted']);
  });
});

/**
 * P6.105: every source that builds a Workflow IR validates it EXPANDED, so a chain prompt counts
 * its steps against the node cap wherever it is named. Measured 2026-09-26 on `867c74bd`: the
 * arrow-chain source compiled `sv_big` plus one segment to 33 steps and opened a run, because it
 * never called the validator. Each row names a 32-step chain prompt plus one more node.
 */
describe('P6.105: every IR-building source validates the expanded workflow', () => {
  interface ValidatedSource {
    readonly name: string;
    /** The refusal text, or `undefined` when the source accepted the over-cap workflow. */
    readonly refusal: () => Promise<string | undefined>;
  }
  const VALIDATED: readonly ValidatedSource[] = [
    { name: 'arrow-chain', refusal: () => refusalFrom({ command: `>>sv_big${ARROW}>>sv_b` }) },
    {
      name: 'workflow-ir',
      refusal: () =>
        refusalFrom({
          workflow: {
            version: 1,
            nodes: [
              { id: 'x', promptId: 'sv_big' },
              { id: 'y', promptId: 'sv_b' },
            ],
            edges: [{ from: 'x', to: 'y' }],
          },
        }),
    },
    // The run already holds one node, so the appended chain prompt makes 33.
    { name: 'remainder-append', refusal: async () => (await appendRemainder('sv_big')).refusal },
  ];
  // `[cap-exceeded] node "n1": …` (stage 04's render) or `- cap-exceeded: …` (the remainder's)
  const CAP = /cap-exceeded\]?:? (node "[\w-]+": )?Expanding chain prompt "sv_big" yields 32 nodes/;

  async function unvalidated(sources: readonly ValidatedSource[]): Promise<string[]> {
    const names: string[] = [];
    for (const source of sources) {
      if (!CAP.test((await source.refusal()) ?? '')) names.push(source.name);
    }
    return names;
  }

  test.each(VALIDATED.map((source) => [source.name, source] as const))(
    '%s refuses a chain prompt expanding past the node cap, by name',
    async (_name, source) => {
      expect(await unvalidated([source])).toEqual([]);
    }
  );

  test('the arrow-chain refusal is the workflow rejection, addressed to the segment node', async () => {
    const refusal = await refusalFrom({ command: `>>sv_big${ARROW}>>sv_b` });
    expect(refusal).toContain('Nothing was executed and no run was created.');
    expect(refusal).toContain('[cap-exceeded] node "n1": Expanding chain prompt "sv_big"');
    // Positive control: the same segment under the cap parses
    expect(await refusalFrom({ command: `>>sv_chain${ARROW}>>sv_b` })).toBeUndefined();
  });

  test('an unregistered prompt on the arrow-chain source stays a PromptError', async () => {
    await expect(refusalFrom({ command: `>>sv_a${ARROW}>>sv_missing` })).rejects.toThrow(
      /Converted prompt data not found for chain step: sv_missing/
    );
  });

  test('control: a planted arrow-chain builder that skips the validator fails by name', async () => {
    const skipping = stageWith({
      ...workflowIrPort,
      validate: (ir) => ({ ok: true, order: ir.nodes.map((node) => node.id) }),
    });
    const planted: ValidatedSource = {
      name: 'planted-unvalidated',
      refusal: () => refusalFrom({ command: `>>sv_big${ARROW}>>sv_b` }, skipping),
    };
    expect(await unvalidated([...VALIDATED, planted])).toEqual(['planted-unvalidated']);
  });
});

/**
 * P6.116 / R48: the arrow-chain source tells the validator no `required` arguments
 * (`withoutRequiredArguments`); the Workflow IR source does, and refuses a node omitting one.
 * MEASURED 2026-09-26 on `83355182`: the arrow-chain node for `sv_req` with no `topic` carries
 * `topic: ""` (ArgumentParser's `empty_fallback` fills every declared argument, for every argument
 * string tried), so the key-presence check could not fire there either way; the pin is therefore
 * on what the builder TELLS the validator, beside the observable refusal.
 */
describe('P6.116: only the workflow source enforces `required`', () => {
  const REQUIRED = /omits required argument "topic" of prompt "sv_req"/;
  type Source = readonly [string, () => Promise<string | undefined>];
  const MISSING_REQUIRED: readonly Source[] = [
    ['arrow-chain', () => refusalFrom({ command: `>>sv_req${ARROW}>>sv_b` })],
    [
      'workflow-ir',
      () => refusalFrom({ workflow: { version: 1, nodes: [{ id: 'x', promptId: 'sv_req' }] } }),
    ],
  ];

  async function refusing(sources: readonly Source[]): Promise<string[]> {
    const names: string[] = [];
    for (const [name, refusal] of sources) {
      if (REQUIRED.test((await refusal()) ?? '')) names.push(name);
    }
    return names;
  }

  type ValidatorDeps = Parameters<WorkflowIrPort['validate']>[1];
  /** The sources whose validator call was told `sv_req` declares a `required` argument. */
  async function toldRequired(
    arrowBuilderDeps: (deps: ValidatorDeps) => ValidatorDeps = (deps) => deps
  ): Promise<string[]> {
    const told: string[] = [];
    // `asBuilt` stands in the builder's place: what reaches the recorder is what it passed.
    const recording = (name: string, asBuilt: typeof arrowBuilderDeps): WorkflowIrPort => ({
      ...workflowIrPort,
      validate: (ir, deps) => {
        const passed = asBuilt(deps);
        if ((passed.lookupPrompt('sv_req')?.requiredArguments.length ?? 0) > 0) told.push(name);
        return workflowIrPort.validate(ir, passed);
      },
    });
    const recorded = new CommandParsingStage(
      new UnifiedCommandParser(logger),
      argumentParser,
      () => prompts,
      logger,
      new SymbolicCommandBuilder(
        argumentParser,
        logger,
        recording('arrow-chain', arrowBuilderDeps)
      ),
      {
        workflowCommandBuilder: new WorkflowCommandBuilder(
          recording('workflow-ir', (deps) => deps),
          logger
        ),
      }
    );
    await refusalFrom({ command: `>>sv_req${ARROW}>>sv_b` }, recorded);
    await refusalFrom(
      { workflow: { version: 1, nodes: [{ id: 'x', promptId: 'sv_req' }] } },
      recorded
    );
    return told;
  }

  test('the workflow source refuses the missing argument by name; the arrow-chain source parses', async () => {
    expect(await refusing(MISSING_REQUIRED)).toEqual(['workflow-ir']);
    const arrow = await parse({ command: `>>sv_req${ARROW}>>sv_b` });
    expect(arrow.steps?.map((step) => step.promptId)).toEqual(['sv_req', 'sv_b']);
    // Control: the same workflow node supplying the argument parses
    expect(
      await refusalFrom({
        workflow: { version: 1, nodes: [{ id: 'x', promptId: 'sv_req', args: { topic: 'T' } }] },
      })
    ).toBeUndefined();
  });

  test('only the workflow builder tells the validator a `required` argument', async () => {
    expect(await toldRequired()).toEqual(['workflow-ir']);
  });

  test('control: a planted arrow-chain builder that passes `required` is named', async () => {
    const passingRequired = (deps: ValidatorDeps): ValidatorDeps => ({
      ...deps,
      lookupPrompt: workflowPromptInfoLookup(lookup),
    });
    expect(await toldRequired(passingRequired)).toEqual(['arrow-chain', 'workflow-ir']);
  });
});
