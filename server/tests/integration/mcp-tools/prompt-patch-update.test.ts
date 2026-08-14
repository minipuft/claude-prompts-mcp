/**
 * P7 row 3.6 — patch-mode update against the REAL write path.
 *
 * Classification: integration. Real `PromptLifecycleProcessor`, real `FileOperations` (real YAML
 * serialisation, real mutation transaction, real post-write `ResourceVerificationService` check)
 * writing into a temp workspace. Only the version seam is a double, because the assertion about it
 * is what it is CALLED with — that call is the `version_history` row.
 *
 * These cover the two acceptance clauses that only the file boundary can show:
 *   (a) a one-section edit that never transmits the untouched sections produces the same FILE as
 *       the equivalent full update;
 *   (b) a rejected edit leaves the file byte-identical and consumes no version.
 */

import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ContentAnalyzer } from '../../../src/modules/semantic/content-analyzer.js';
import { ComparisonEngine } from '../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { GateAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { FileOperations } from '../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { PromptLifecycleProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';

import type { PromptResourceContext } from '../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';

const PROMPT_ID = 'patch_target';
const CATEGORY = 'general';

const TEMPLATE = [
  '## Context',
  '{{input}}',
  '',
  '## Output',
  'Answer in prose.',
  '',
  '## Notes',
  'Leave this section alone.',
].join('\n');

const PATCHED_TEMPLATE = TEMPLATE.replace('Answer in prose.', 'Answer in bullet points.');

const createLogger = () =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

interface Harness {
  processor: PromptLifecycleProcessor;
  fileOperations: FileOperations;
  recordEditResult: jest.Mock;
  /**
   * Every file the writer produced for this prompt, keyed by name. The writer externalises the two
   * text bodies to `user-message.md` / `system-message.md`, so reading `prompt.yaml` alone would
   * assert on a file that contains neither of the things a patch edits.
   */
  readFiles: () => Record<string, string>;
  livePrompt: Record<string, unknown>;
}

function createHarness(workspaceDir: string): Harness {
  const promptsDir = join(workspaceDir, 'prompts');
  const logger = createLogger();
  const dependencies = {
    logger,
    semanticAnalyzer: new ContentAnalyzer(createLogger()),
    onRefresh: jest.fn(async () => {}),
    onRestart: jest.fn(async () => {}),
  };
  const fileOperations = new FileOperations({
    logger,
    configManager: { getResolvedPromptsDirectory: () => promptsDir } as unknown as ConfigManager,
  });

  const livePrompt: Record<string, unknown> = {
    id: PROMPT_ID,
    name: 'Patch Target',
    category: CATEGORY,
    description: 'A prompt used to exercise anchored patching',
    userMessageTemplate: TEMPLATE,
    systemMessage: 'Be precise.',
    arguments: [],
    chainSteps: [],
  };

  const recordEditResult = jest.fn(async () => ({ version: 3, success: true })) as jest.Mock;

  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations,
    getData: () => ({ convertedPrompts: [livePrompt] }),
    versionHistoryService: { isAutoVersionEnabled: () => true, recordEditResult },
    textDiffService: new ObjectDiffGenerator(),
    comparisonEngine: new ComparisonEngine(logger),
  } as unknown as PromptResourceContext;

  return {
    processor: new PromptLifecycleProcessor(context),
    fileOperations,
    recordEditResult,
    readFiles: () => {
      const dir = join(promptsDir, CATEGORY, PROMPT_ID);
      const files: Record<string, string> = {};
      for (const name of readdirSync(dir).sort()) {
        files[name] = readFileSync(join(dir, name), 'utf8');
      }
      return files;
    },
    livePrompt,
  };
}

async function seed(harness: Harness): Promise<void> {
  await harness.fileOperations.updatePromptImplementation({ ...harness.livePrompt });
}

describe('patch-mode update against the real writer', () => {
  let workspaces: string[] = [];

  function workspace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-patch-'));
    workspaces.push(dir);
    return dir;
  }

  beforeEach(() => {
    workspaces = [];
  });

  afterEach(() => {
    for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Acceptance (a) + (c) at the file boundary. Two independent workspaces run the same edit two
   * ways; the produced files must be byte-identical. Byte comparison is safe here because the
   * fixture declares no `arguments` — the converter's `required: false` materialisation (Tier 1,
   * DEV-T1-3) has nothing to materialise onto, so no normalisation is needed.
   */
  test('produces a byte-identical file to the equivalent full update', async () => {
    const patched = createHarness(workspace());
    await seed(patched);
    const patchResponse = await patched.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: 'Answer in bullet points.',
        },
      ],
    } as never);

    const full = createHarness(workspace());
    await seed(full);
    const fullResponse = await full.processor.updatePrompt({
      id: PROMPT_ID,
      user_message_template: PATCHED_TEMPLATE,
    } as never);

    expect(patchResponse.isError).toBe(false);
    expect(fullResponse.isError).toBe(false);
    expect(patched.readFiles()).toEqual(full.readFiles());
    expect(patched.readFiles()['user-message.md']).toContain('Answer in bullet points.');
    expect(patched.readFiles()['user-message.md']).toContain('Leave this section alone.');
  });

  test('records the same version snapshot as the full update', async () => {
    const patched = createHarness(workspace());
    await seed(patched);
    await patched.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: 'Answer in bullet points.',
        },
      ],
    } as never);

    const full = createHarness(workspace());
    await seed(full);
    await full.processor.updatePrompt({
      id: PROMPT_ID,
      user_message_template: PATCHED_TEMPLATE,
    } as never);

    expect(patched.recordEditResult.mock.calls[0]).toEqual(full.recordEditResult.mock.calls[0]);
  });

  test('a template-syntax error leaves the file untouched and spends no version', async () => {
    const harness = createHarness(workspace());
    await seed(harness);
    const before = harness.readFiles();

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: '{% for x in %}Answer in prose.',
        },
      ],
    } as never);

    expect(response.isError).toBe(true);
    expect(harness.readFiles()).toEqual(before);
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('a failed anchor leaves the file untouched and spends no version', async () => {
    const harness = createHarness(workspace());
    await seed(harness);
    const before = harness.readFiles();

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        { field: 'user_message_template', old_string: 'not present anywhere', new_string: 'x' },
      ],
    } as never);

    expect(response.isError).toBe(true);
    expect(harness.readFiles()).toEqual(before);
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('dry_run leaves the file untouched and spends no version', async () => {
    const harness = createHarness(workspace());
    await seed(harness);
    const before = harness.readFiles();

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: 'Answer in bullet points.',
        },
      ],
      dry_run: true,
    } as never);

    expect(response.isError).toBe(false);
    expect(harness.readFiles()).toEqual(before);
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('a multi-field patch writes every touched body in one version', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: 'Answer in bullet points.',
        },
        { field: 'system_message', old_string: 'precise', new_string: 'exhaustive' },
        { field: 'description', old_string: 'anchored patching', new_string: 'patch mode' },
      ],
    } as never);

    expect(response.isError).toBe(false);
    const files = harness.readFiles();
    expect(files['user-message.md']).toContain('Answer in bullet points.');
    expect(files['system-message.md']).toContain('Be exhaustive.');
    expect(files['prompt.yaml']).toContain('patch mode');
    expect(harness.recordEditResult).toHaveBeenCalledTimes(1);
  });
});
