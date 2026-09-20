/**
 * P4.65 — a chain's `edges` are authorable through `resource_manager`.
 *
 * Classification: integration. Real `PromptLifecycleProcessor`, real `FileOperations` (real YAML
 * serialisation, real mutation transaction, real post-write `ResourceVerificationService`), and a
 * real `PromptLoader`/`PromptConverter` reload behind `onRefresh`, all against a temp workspace.
 * Only the version seam is a double.
 *
 * WHAT THIS FILE OWNS, AND WHAT IT CANNOT SHOW
 * `collectChainEdgeErrors` refuses a `chainSteps` rewrite that orphans an edge, and that refusal is
 * correct — but before P4.65 `edges` was not a tool parameter, so the only remedy was a hand edit
 * of `prompt.yaml`, which this project forbids. These cases assert the write-path half: a supplied
 * value wins, an omitted one preserves the file's own declaration, `unset` clears, and the refusal
 * names the remedy.
 *
 * They CANNOT show the route. These cases call the processor directly, so they skip the registered
 * schema, the router's per-resource-type parameter check, and the transport. That half is driven
 * over `tools/call` by the conformance corpus (`tests/e2e/conformance/workspace-and-mutations.yaml`,
 * the `prompt-chain-edges-*` and `gate-refuses-edges-by-name` scenarios), and it is the half that
 * measurably catches a break: removing `edges` from `UPDATE_FIELDS` reds one conformance row and
 * none of the boundary gates.
 *
 * Note for anyone reasoning about the schema: `resourceManagerInputSchema` is `.passthrough()`, so
 * an undeclared key is NOT stripped on this tool — declaring `edges` there buys the published
 * shape (contract parity, `tests/unit/mcp-tools/tool-input-fields.test.ts`) and validation of each
 * edge object, not arrival.
 */

import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ComparisonEngine } from '../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { GateAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { FileOperations } from '../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { PromptLifecycleProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';
import { PromptConverter } from '../../../src/modules/prompts/converter.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { ContentAnalyzer } from '../../../src/modules/semantic/content-analyzer.js';
import { parseYamlOrThrow } from '../../../src/shared/utils/yaml/yaml-parser.js';

import type { PromptResourceContext } from '../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';

const PROMPT_ID = 'edge_chain';
const STEP_PROMPT_ID = 'edge_step';
const CATEGORY = 'general';

/** Three steps whose minted ids are `step-a`, `step-b`, `step-c` (slugs of `stepName`). */
const STEPS = [
  { promptId: STEP_PROMPT_ID, stepName: 'Step A' },
  { promptId: STEP_PROMPT_ID, stepName: 'Step B' },
  { promptId: STEP_PROMPT_ID, stepName: 'Step C' },
];

/** The two steps left after Step C is dropped — which orphans an edge pointing at `step-c`. */
const STEPS_WITHOUT_C = STEPS.slice(0, 2);

const EDGES = [{ from: 'step-a', to: 'step-c' }];

const createLogger = () =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

interface Harness {
  processor: PromptLifecycleProcessor;
  fileOperations: FileOperations;
  readFiles: (promptId?: string) => Record<string, string>;
  readYaml: (promptId?: string) => Record<string, unknown>;
  reload: () => Promise<void>;
  promptsDir: string;
}

function createHarness(workspaceDir: string): Harness {
  const promptsDir = join(workspaceDir, 'prompts');
  const logger = createLogger();
  const configManager = {
    getConfigPath: () => join(workspaceDir, 'config.yaml'),
    getServerRoot: () => workspaceDir,
    getResolvedPromptsDirectory: () => promptsDir,
  } as unknown as ConfigManager;

  /**
   * The live prompts as the loader exposes them: `chainSteps` present, `edges` ABSENT.
   *
   * That absence is the fixture's whole point — `PromptConverter` deliberately drops `edges`
   * because the loader has already linearized them into step order, so the on-disk YAML is the
   * only place the writer can read a chain's authored edges back from.
   */
  let convertedPrompts: Record<string, unknown>[] = [];

  const reload = async (): Promise<void> => {
    const promptLoader = new PromptLoader(logger);
    const { promptsData } = await promptLoader.loadFromDirectories(promptsDir);
    const converter = new PromptConverter(logger, promptLoader);
    convertedPrompts = (await converter.convertMarkdownPromptsToJson(
      promptsData,
      promptsDir
    )) as unknown as Record<string, unknown>[];
  };

  const dependencies = {
    logger,
    configManager,
    semanticAnalyzer: new ContentAnalyzer(createLogger()),
    onRefresh: jest.fn(reload),
    onRestart: jest.fn(async () => {}),
  };
  const fileOperations = new FileOperations({ logger, configManager });

  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations,
    getData: () => ({ convertedPrompts }),
    versionHistoryService: {
      isAutoVersionEnabled: () => true,
      loadHistory: jest.fn(async () => ({ current_version: 1 })),
      recordEditResult: jest.fn(async () => ({ version: 2, success: true })),
      saveVersion: jest.fn(async () => ({ success: true, version: 1 })),
    },
    textDiffService: new ObjectDiffGenerator(),
    comparisonEngine: new ComparisonEngine(logger),
  } as unknown as PromptResourceContext;

  const dirFor = (promptId: string): string => join(promptsDir, CATEGORY, promptId);
  return {
    processor: new PromptLifecycleProcessor(context),
    fileOperations,
    readFiles: (promptId = PROMPT_ID) => {
      const files: Record<string, string> = {};
      for (const name of readdirSync(dirFor(promptId)).sort()) {
        files[name] = readFileSync(join(dirFor(promptId), name), 'utf8');
      }
      return files;
    },
    readYaml: (promptId = PROMPT_ID) =>
      parseYamlOrThrow<Record<string, unknown>>(
        readFileSync(join(dirFor(promptId), 'prompt.yaml'), 'utf8')
      ),
    reload,
    promptsDir,
  };
}

/**
 * Seed the workspace with the chain AND its edges, plus the single prompt its steps reference.
 *
 * Written through the real writer, then loaded back, so the processor's in-memory view is exactly
 * what the loader produces — including the dropped `edges`.
 */
async function seed(harness: Harness): Promise<void> {
  await harness.fileOperations.updatePromptImplementation({
    id: STEP_PROMPT_ID,
    name: 'Edge Step',
    category: CATEGORY,
    description: 'A step this chain references',
    userMessageTemplate: 'Do the step.',
    arguments: [],
  });
  await harness.fileOperations.updatePromptImplementation({
    id: PROMPT_ID,
    name: 'Edge Chain',
    category: CATEGORY,
    description: 'A chain that declares dependency edges',
    userMessageTemplate: 'Run the chain.',
    arguments: [],
    chainSteps: STEPS.map((step) => ({ ...step })),
    edges: EDGES.map((edge) => ({ ...edge })),
  });
  await harness.reload();
}

describe('chain `edges` through the real prompt write path', () => {
  let workspaces: string[] = [];

  function workspace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-edges-'));
    workspaces.push(dir);
    return dir;
  }

  beforeEach(() => {
    workspaces = [];
  });

  afterEach(() => {
    for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
  });

  test('an update that touches nothing else preserves the authored edges', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      description: 'A chain that declares dependency edges (revised)',
    } as never);

    expect(response.isError).toBe(false);
    // The live prompt carries no `edges`, so a writer reading the in-memory projection instead of
    // the file would drop the key here and report success.
    expect(harness.readYaml()['edges']).toEqual(EDGES);
  });

  test('a supplied edge set wins over the file, and is written verbatim', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      edges: [{ from: 'step-b', to: 'step-c' }],
    } as never);

    expect(response.isError).toBe(false);
    expect(harness.readYaml()['edges']).toEqual([{ from: 'step-b', to: 'step-c' }]);
  });

  test('dropping a step an edge names, with the corrected edges in the same call, succeeds', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      chain_steps: STEPS_WITHOUT_C.map((step) => ({ ...step })),
      edges: [{ from: 'step-a', to: 'step-b' }],
    } as never);

    expect(response.isError).toBe(false);
    const yamlAfter = harness.readYaml();
    expect(yamlAfter['chainSteps']).toHaveLength(2);
    expect(yamlAfter['edges']).toEqual([{ from: 'step-a', to: 'step-b' }]);
  });

  test('`unset: ["edges"]` drops the key while the steps change in the same call', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      chain_steps: STEPS_WITHOUT_C.map((step) => ({ ...step })),
      unset: ['edges'],
    } as never);

    expect(response.isError).toBe(false);
    const yamlAfter = harness.readYaml();
    expect(yamlAfter).not.toHaveProperty('edges');
    expect(yamlAfter['chainSteps']).toHaveLength(2);
  });

  test('an edge set both supplied and unset in one call is refused rather than ordered', async () => {
    const harness = createHarness(workspace());
    await seed(harness);
    const before = harness.readFiles();

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      edges: [{ from: 'step-a', to: 'step-b' }],
      unset: ['edges'],
    } as never);

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('`edges` is both written and listed in `unset`');
    expect(harness.readFiles()).toEqual(before);
  });

  test('the orphaning step rewrite alone is refused, rolled back, and names the remedy', async () => {
    const harness = createHarness(workspace());
    await seed(harness);
    const before = harness.readFiles();

    // The writer throws past the processor; `PromptResourceHandler` is what turns this into an
    // `isError` response. Asserting the thrown text keeps the assertion on the message the
    // handler forwards verbatim.
    await expect(
      harness.processor.updatePrompt({
        id: PROMPT_ID,
        chain_steps: STEPS_WITHOUT_C.map((step) => ({ ...step })),
      } as never)
    ).rejects.toThrow(/names step id 'step-c'/);

    // Rolled back: the refusal is not a half-write.
    expect(harness.readFiles()).toEqual(before);
  });

  test('the refusal names the remedy that did not exist before this parameter', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const thrown = await harness.processor
      .updatePrompt({
        id: PROMPT_ID,
        chain_steps: STEPS_WITHOUT_C.map((step) => ({ ...step })),
      } as never)
      .then(
        () => '',
        (error: unknown) => (error instanceof Error ? error.message : String(error))
      );

    expect(thrown).toContain('send `edges` in the same `resource_manager` update');
    expect(thrown).toContain('unset: ["edges"]');
  });

  test('a cycle is refused and also names the remedy', async () => {
    const harness = createHarness(workspace());
    await seed(harness);
    const before = harness.readFiles();

    await expect(
      harness.processor.updatePrompt({
        id: PROMPT_ID,
        edges: [
          { from: 'step-a', to: 'step-b' },
          { from: 'step-b', to: 'step-a' },
        ],
      } as never)
    ).rejects.toThrow(/send `edges` in the same `resource_manager` update/);

    expect(harness.readFiles()).toEqual(before);
  });

  test('a valid edge set is a POSITIVE CONTROL for every refusal above', async () => {
    // Without this, a `collectChainEdgeErrors` that refused unconditionally would satisfy both
    // refusal cases, and the remedy text would be asserted over a gate that rejects everything.
    const harness = createHarness(workspace());
    await seed(harness);

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      edges: [{ from: 'step-a', to: 'step-b' }],
    } as never);

    expect(response.isError).toBe(false);
    expect(response.content[0]?.text).not.toContain('send `edges` in the same');
  });

  test('create writes the edges it was given', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const response = await harness.processor.createPrompt({
      id: 'created_edge_chain',
      name: 'Created Edge Chain',
      category: CATEGORY,
      description: 'Created with edges',
      user_message_template: 'Run it.',
      chain_steps: STEPS.map((step) => ({ ...step })),
      edges: EDGES.map((edge) => ({ ...edge })),
    } as never);

    expect(response.isError).toBe(false);
    expect(harness.readYaml('created_edge_chain')['edges']).toEqual(EDGES);
  });
});
