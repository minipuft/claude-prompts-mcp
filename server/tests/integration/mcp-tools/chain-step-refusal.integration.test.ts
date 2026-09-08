/**
 * Chain integrity row 1.4 — the write boundary against the REAL writer.
 *
 * Classification: integration. Real `PromptLifecycleProcessor` and real `FileOperations` writing
 * into a temp workspace, because the two claims that matter are about DISK: a refused write leaves
 * nothing behind, and an accepted write of a chain's own children scaffolds their directories in
 * the same call. A stubbed file boundary can show neither.
 */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

import type { PromptResourceContext } from '../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { PromptDraftInput } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-draft-service.js';
import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';

const CATEGORY = 'general';
const CHAIN_ID = 'release_chain';

const createLogger = () =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

function createHarness(workspaceDir: string) {
  const promptsDir = join(workspaceDir, 'prompts');
  const logger = createLogger();
  let convertedPrompts: Record<string, unknown>[] = [];

  const configManager = {
    getConfigPath: () => join(workspaceDir, 'config.yaml'),
    getServerRoot: () => workspaceDir,
    getResolvedPromptsDirectory: () => promptsDir,
  } as unknown as ConfigManager;

  // A REAL reload: the post-write verification and every later resolution read what the loader
  // finds on disk, so a scaffolded step directory becomes a registered prompt exactly as it does
  // at runtime.
  const onRefresh = jest.fn(async () => {
    const promptLoader = new PromptLoader(logger);
    const { promptsData } = await promptLoader.loadFromDirectories(promptsDir);
    const converter = new PromptConverter(logger, promptLoader);
    convertedPrompts = (await converter.convertMarkdownPromptsToJson(
      promptsData,
      promptsDir
    )) as unknown as Record<string, unknown>[];
  });

  const dependencies = {
    logger,
    configManager,
    semanticAnalyzer: new ContentAnalyzer(createLogger()),
    onRefresh,
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
      isAutoVersionEnabled: () => false,
      loadHistory: jest.fn(async () => null),
    },
    textDiffService: new ObjectDiffGenerator(),
    comparisonEngine: new ComparisonEngine(logger),
  } as unknown as PromptResourceContext;

  return {
    processor: new PromptLifecycleProcessor(context),
    fileOperations,
    promptsDir,
    refresh: onRefresh,
  };
}

function textOf(response: unknown): string {
  return ((response as { content: Array<{ text?: string }> }).content ?? [])
    .map((part) => part.text ?? '')
    .join('');
}

const chainArgs = (steps: Array<Record<string, unknown>>): PromptDraftInput =>
  ({
    id: CHAIN_ID,
    name: 'Release Chain',
    description: 'A chain used to exercise chain step reference refusal end to end',
    category: CATEGORY,
    user_message_template: 'Run the release chain',
    chain_steps: steps,
  }) as unknown as PromptDraftInput;

describe('resource_manager create — chain step references, against the real writer', () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function workspace() {
    const dir = mkdtempSync(join(tmpdir(), 'chain-step-refusal-'));
    workspaces.push(dir);
    return createHarness(dir);
  }

  test('refuses an external step that names no registered prompt, and writes nothing', async () => {
    const harness = workspace();

    const response = await harness.processor.createPrompt(
      chainArgs([{ promptId: 'run_smoke_tests', stepName: 'Smoke' }])
    );

    expect(textOf(response)).toContain("step 1 references unknown promptId 'run_smoke_tests'");
    expect((response as { isError?: boolean }).isError).toBe(true);
    expect(existsSync(join(harness.promptsDir, CATEGORY, CHAIN_ID))).toBe(false);
  });

  test('names the step POSITION, not just the id, when a later step dangles', async () => {
    const harness = workspace();
    await harness.processor.createPrompt({
      id: 'run_smoke_tests',
      name: 'Run Smoke Tests',
      description: 'Runs the smoke tests for a release',
      category: CATEGORY,
      user_message_template: 'Run the smoke tests',
    } as unknown as PromptDraftInput);
    await harness.refresh();

    const response = await harness.processor.createPrompt(
      chainArgs([
        { promptId: 'run_smoke_tests', stepName: 'Smoke' },
        { promptId: 'publish_release', stepName: 'Publish' },
      ])
    );

    expect(textOf(response)).toContain("step 2 references unknown promptId 'publish_release'");
    expect(existsSync(join(harness.promptsDir, CATEGORY, CHAIN_ID))).toBe(false);
  });

  test('saves the same chain once the step is registered', async () => {
    const harness = workspace();
    await harness.processor.createPrompt({
      id: 'run_smoke_tests',
      name: 'Run Smoke Tests',
      description: 'Runs the smoke tests for a release',
      category: CATEGORY,
      user_message_template: 'Run the smoke tests',
    } as unknown as PromptDraftInput);
    await harness.refresh();

    const response = await harness.processor.createPrompt(
      chainArgs([{ promptId: 'run_smoke_tests', stepName: 'Smoke' }])
    );

    expect(textOf(response)).toContain('✅ **Prompt Created**');
    expect(existsSync(join(harness.promptsDir, CATEGORY, CHAIN_ID, 'prompt.yaml'))).toBe(true);
  });

  test('saves AND scaffolds a chain whose steps are all its own children (R7)', async () => {
    const harness = workspace();

    const response = await harness.processor.createPrompt(
      chainArgs([
        { promptId: `${CHAIN_ID}/cut_tag`, stepName: 'Cut tag' },
        { promptId: `${CHAIN_ID}/announce`, stepName: 'Announce' },
      ])
    );

    expect(textOf(response)).toContain('✅ **Prompt Created**');
    const chainDir = join(harness.promptsDir, CATEGORY, CHAIN_ID);
    expect(existsSync(join(chainDir, 'prompt.yaml'))).toBe(true);
    // The exemption is only sound because THIS call creates them.
    expect(existsSync(join(chainDir, 'cut_tag', 'prompt.yaml'))).toBe(true);
    expect(existsSync(join(chainDir, 'announce', 'prompt.yaml'))).toBe(true);
  });

  test('refuses a step nested two levels under the chain — the scaffold skips that shape', async () => {
    const harness = workspace();

    const response = await harness.processor.createPrompt(
      chainArgs([{ promptId: `${CHAIN_ID}/phase/step`, stepName: 'Deep' }])
    );

    expect(textOf(response)).toContain(
      `step 1 references unknown promptId '${CHAIN_ID}/phase/step'`
    );
    expect(existsSync(join(harness.promptsDir, CATEGORY, CHAIN_ID))).toBe(false);
  });
});
