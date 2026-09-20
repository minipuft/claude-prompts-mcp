import { describe, expect, jest, test } from '@jest/globals';

import { ContentAnalyzer } from '../../../../../src/modules/semantic/content-analyzer.js';
import { ComparisonEngine } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { GateAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { PromptLifecycleProcessor } from '../../../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';
import {
  UNSETTABLE_FIELDS,
  UPDATE_FIELDS,
} from '../../../../../src/mcp/tools/resource-manager/prompt/utils/validation.js';
import { resourceManagerInputSchema } from '../../../../../src/mcp/tools/schemas/resource-manager.schema.js';
import { workflowBudgetSchema } from '../../../../../src/mcp/tools/schemas/workflow-ir.schema.js';
import {
  PromptArtifactsSchema,
  PromptYamlSchema,
} from '../../../../../src/modules/prompts/prompt-schema.js';

import type { PromptResourceContext } from '../../../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

const createLogger = () =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

interface Harness {
  processor: PromptLifecycleProcessor;
  updatePromptImplementation: jest.Mock<
    (prompt: Record<string, unknown>) => Promise<{
      message: string;
      affectedFiles: string[];
    }>
  >;
  recordEditResult: jest.Mock;
  saveVersion: jest.Mock;
  onRefresh: jest.Mock;
}

function createHarness(
  options: { currentVersion?: number; refreshMatches?: boolean } = {}
): Harness {
  const logger = createLogger();
  const configManager = {
    getConfigPath: () => '/workspace/config.yaml',
    getServerRoot: () => '/workspace',
    getResolvedPromptsDirectory: () => '/workspace/prompts',
  } as unknown as ConfigManager;
  let currentVersion = options.currentVersion ?? 4;
  /** Version numbers `saveVersion` has assigned to ids that did not exist before this harness. */
  const createdVersions = new Map<string, number>();
  let pendingPrompt: Record<string, unknown> | undefined;
  let convertedPrompts: Record<string, unknown>[] = [
    {
      id: 'existing_prompt',
      name: 'Existing Prompt',
      category: 'general',
      description: 'Existing description',
      systemMessage: '',
      userMessageTemplate: 'Before {{input}}',
      arguments: [{ name: 'input', required: true }],
      chainSteps: [],
    },
  ];

  const onRefresh = jest.fn(async () => {
    if (pendingPrompt !== undefined && options.refreshMatches !== false) {
      convertedPrompts = [
        ...convertedPrompts.filter((prompt) => prompt['id'] !== pendingPrompt?.['id']),
        pendingPrompt,
      ];
    }
  });
  const dependencies = {
    logger,
    configManager,
    semanticAnalyzer: new ContentAnalyzer(logger),
    onRefresh,
    onRestart: jest.fn(async () => {}),
  };
  // Models the real writer's transaction: the caller's `commit` step runs after the write and a
  // throw rolls the files back (P4.2). A double ignoring `options` measures a writer that no
  // longer exists.
  const updatePromptImplementation = jest.fn(
    async (
      promptData: Record<string, unknown>,
      _suppliedKeys?: unknown,
      _sourceRoot?: unknown,
      _writeIntent?: unknown,
      options?: { commit?: () => Promise<void> }
    ) => {
      const previous = pendingPrompt;
      pendingPrompt = promptData;
      try {
        await options?.commit?.();
      } catch (error) {
        pendingPrompt = previous;
        throw new Error(`Prompt write failed and was rolled back: ${String(error)}`);
      }
      return {
        message: 'written',
        affectedFiles: [`/workspace/prompts/general/${String(promptData['id'])}/prompt.yaml`],
      };
    }
  );
  const loadHistory = jest.fn(async (_type: string, id: string) => {
    if (id === 'existing_prompt') return { current_version: currentVersion } as never;
    const created = createdVersions.get(id);
    return created !== undefined && pendingPrompt?.['id'] === id
      ? ({ current_version: created } as never)
      : null;
  });
  const recordEditResult = jest.fn(async () => {
    currentVersion += 1;
    return { success: true, version: currentVersion, bridged: false };
  });
  // The create-path writer: no prior state to bridge, so it saves version 1 for a
  // fresh id directly — mirroring `saveVersion`'s real MAX(existing)+1 arithmetic, which an id
  // with no rows yet resolves to 1 on its own. Untyped rest params (matching `recordEditResult`
  // above): an explicitly typed signature here does not structurally match `jest.Mock`.
  const saveVersion = jest.fn(async (...args: unknown[]) => {
    createdVersions.set(args[1] as string, 1);
    return { success: true, version: 1 };
  });
  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    comparisonEngine: new ComparisonEngine(logger),
    textDiffService: new ObjectDiffGenerator(),
    fileOperations: { updatePromptImplementation, projectPromptWrite: jest.fn(async () => []) },
    versionHistoryService: {
      isAutoVersionEnabled: () => true,
      loadHistory,
      recordEditResult,
      saveVersion,
    },
    getData: () => ({ convertedPrompts }),
  } as unknown as PromptResourceContext;

  return {
    processor: new PromptLifecycleProcessor(context),
    updatePromptImplementation,
    recordEditResult,
    saveVersion,
    onRefresh,
  };
}

const draftBase = {
  name: 'Draft Prompt',
  description: 'A prompt creation draft',
};

describe('prompt validate/create authoring contract', () => {
  test.each([
    ['template', { user_message_template: 'Do {{input}}' }],
    ['system-only', { system_message: 'Answer tersely.' }],
    [
      'chain-only',
      { chain_steps: [{ promptId: 'existing_prompt', stepName: 'Use existing prompt' }] },
    ],
  ])('validates a %s draft without mutating state', async (variant, content) => {
    const harness = createHarness();

    const response = await harness.processor.validatePrompt({
      ...draftBase,
      id: `draft_${variant.replace('-', '_')}`,
      ...content,
    } as never);

    expect(response.isError).toBe(false);
    expect(response.structuredContent).toMatchObject({
      action: 'validate',
      valid: true,
      mutated: false,
    });
    expect(harness.updatePromptImplementation).not.toHaveBeenCalled();
    expect(harness.recordEditResult).not.toHaveBeenCalled();
    expect(harness.onRefresh).not.toHaveBeenCalled();
  });

  test('rejects a draft with no content and accepts a complete script-tool definition', async () => {
    const harness = createHarness();
    const invalid = await harness.processor.validatePrompt({ id: 'empty', ...draftBase } as never);
    const valid = await harness.processor.validatePrompt({
      id: 'with_tool',
      ...draftBase,
      user_message_template: 'Use {{input}}',
      tools: [
        {
          id: 'echo_input',
          name: 'Echo input',
          runtime: 'python',
          script: 'import json\nprint(json.dumps({"ok": True}))',
          schema: {
            type: 'object',
            properties: { input: { type: 'string' } },
            required: ['input'],
          },
        },
      ],
    } as never);

    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent).toMatchObject({ valid: false, mutated: false });
    expect(valid.isError).toBe(false);
    expect(valid.structuredContent).toMatchObject({ valid: true, mutated: false });
  });

  test('returns a verified, addressable receipt after create and refresh', async () => {
    const harness = createHarness();

    const response = await harness.processor.createPrompt({
      id: 'created_prompt',
      ...draftBase,
      user_message_template: 'Create {{input}}',
    } as never);

    expect(response.isError).toBe(false);
    expect(response.structuredContent).toMatchObject({
      action: 'create',
      mutated: true,
      receipt: {
        id: 'created_prompt',
        config_path: '/workspace/config.yaml',
        server_root: '/workspace',
        resource_root: '/workspace/prompts',
        refresh_status: 'loaded',
        loaded_after_refresh: true,
        // The created state is recorded as version 1, not 0.
        current_version: 1,
      },
    });
    expect(harness.onRefresh).toHaveBeenCalledTimes(1);
  });

  // A create records the created state as version 1 — through `saveVersion` directly, never
  // through `recordEditResult` (there is no prior state to bridge).
  test('records the created state as version 1 through saveVersion, not recordEditResult', async () => {
    const harness = createHarness();

    await harness.processor.createPrompt({
      id: 'created_prompt',
      ...draftBase,
      user_message_template: 'Create {{input}}',
    } as never);

    expect(harness.saveVersion).toHaveBeenCalledTimes(1);
    expect(harness.saveVersion).toHaveBeenCalledWith(
      'prompt',
      'created_prompt',
      expect.objectContaining({ id: 'created_prompt' }),
      expect.objectContaining({ description: expect.stringContaining('Created') })
    );
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('marks a write as failed when refresh does not expose the produced state', async () => {
    const harness = createHarness({ refreshMatches: false });

    const response = await harness.processor.createPrompt({
      id: 'stale_prompt',
      ...draftBase,
      user_message_template: 'Create {{input}}',
    } as never);

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      receipt: { refresh_status: 'verification_failed', loaded_after_refresh: false },
    });
  });
});

describe('prompt update optimistic concurrency', () => {
  test('matching expected_version writes once and advances the receipt version', async () => {
    const harness = createHarness({ currentVersion: 4 });

    const response = await harness.processor.updatePrompt({
      id: 'existing_prompt',
      description: 'Updated description',
      expected_version: 4,
    } as never);

    expect(response.isError).toBe(false);
    expect(harness.updatePromptImplementation).toHaveBeenCalledTimes(1);
    expect(harness.recordEditResult).toHaveBeenCalledTimes(1);
    expect(response.structuredContent).toMatchObject({ receipt: { current_version: 5 } });
  });

  test('stale expected_version returns a conflict without a write or version', async () => {
    const harness = createHarness({ currentVersion: 4 });

    const response = await harness.processor.updatePrompt({
      id: 'existing_prompt',
      description: 'Stale update',
      expected_version: 3,
    } as never);

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      conflict: true,
      expected_version: 3,
      current_version: 4,
      mutated: false,
    });
    expect(harness.updatePromptImplementation).not.toHaveBeenCalled();
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('expected_version cannot be combined with skip_version', async () => {
    const harness = createHarness({ currentVersion: 4 });

    const response = await harness.processor.updatePrompt({
      id: 'existing_prompt',
      description: 'Unsafe update',
      expected_version: 4,
      skip_version: true,
    } as never);

    expect(response.isError).toBe(true);
    expect(harness.updatePromptImplementation).not.toHaveBeenCalled();
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });
});

/**
 * The class P4.65 belongs to: a `prompt.yaml` key the loader accepts that no tool parameter writes.
 *
 * `edges` was one of these. It was schema-valid, load-bearing (`collectChainEdgeErrors` refuses a
 * chain whose edges no longer match its steps), and unreachable from `resource_manager` — so the
 * only remedy for a refusal was a hand edit of `prompt.yaml`, which this project forbids. Fixing
 * `edges` alone would close one instance; this closes the CLASS, by failing when a new key joins
 * `PromptYamlSchema` without being classified.
 *
 * Deliberately a classification, not a "must be settable" rule: two keys legitimately are not, and
 * each carries the observation that would flip it.
 */
describe('every prompt.yaml key the loader accepts is classified', () => {
  /**
   * Keys the WRITER owns: it produces the message files, so it decides their pointers. A caller
   * sets the BODY (`system_message`, `user_message_template`) and the writer decides where it goes.
   */
  const WRITER_OWNED = new Set(['systemMessageFile', 'userMessageTemplateFile']);

  const SETTABLE = new Set<string>([
    // The resource identity — the `id` parameter, not a field overlay.
    'id',
    // Reaches `promptData` directly from `args.tools` rather than through `UPDATE_FIELDS`.
    'tools',
    ...Object.values(UPDATE_FIELDS),
  ]);

  /**
   * There is deliberately NO third category.
   *
   * This gate shipped (P4.65) with two stamped exceptions, `budget` and `artifacts`, each carrying
   * an as-of date and a falsifier. P4.82 read both against their own documentation — a chain's
   * budget and a prompt's artifact declaration are things an AUTHOR states, and the docs say so in
   * those words — so both became settable and the exception list emptied. Re-introducing one means
   * arguing that a key `PromptYamlSchema` accepts is not authored by the person authoring the
   * prompt, which is a claim worth making explicitly rather than by adding a row.
   */
  test('no key is left unclassified, and nothing is exempt', () => {
    const unclassified = Object.keys(PromptYamlSchema.shape).filter(
      (key) => !SETTABLE.has(key) && !WRITER_OWNED.has(key)
    );

    expect(unclassified).toEqual([]);
  });

  test('every classification still names a key the loader accepts', () => {
    // The other direction: a stale entry documents a key that is gone.
    const accepted = new Set(Object.keys(PromptYamlSchema.shape));
    const stale = [...WRITER_OWNED, ...SETTABLE].filter((key) => !accepted.has(key));

    expect(stale).toEqual([]);
  });

  test('every settable prompt.yaml key is also clearable, or is one a prompt cannot load without', () => {
    // `unset` refuses the four structural fields BY NAME rather than writing a prompt that fails
    // its next load; everything else optional in the loader's schema must be clearable, or
    // "supply to set, omit to preserve" leaves it write-once.
    const STRUCTURAL = new Set(['id', 'name', 'category', 'description', 'userMessageTemplate']);
    const settableParameters = Object.entries(UPDATE_FIELDS).filter(
      ([, dataKey]) => !STRUCTURAL.has(dataKey)
    );
    const unclearable = settableParameters
      .filter(([parameter]) => UNSETTABLE_FIELDS[parameter] === undefined)
      .map(([parameter]) => parameter);

    expect(unclearable).toEqual([]);
  });

  test("budget and artifacts are validated by the loader's own schemas, not copies", () => {
    // IDENTITY, not equivalence. The tool's bound on a structural cap has to BE the loader's
    // bound: a restatement here would be a second place for `DEFAULT_WORKFLOW_CAPS` to drift from,
    // and it would still refuse an over-cap value — just later, after a write and a rollback,
    // which no conformance assertion on the refusal TEXT can tell apart from the boundary case.
    const shape = resourceManagerInputSchema.shape as Record<string, { unwrap?: () => unknown }>;
    expect(shape['budget']?.unwrap?.()).toBe(workflowBudgetSchema);
    expect(shape['artifacts']?.unwrap?.()).toBe(PromptArtifactsSchema);
  });

  test('the three keys this class was found through are settable and clearable', () => {
    // Named rather than left implicit in the sweeps above, which would stay green if any of them
    // were dropped from both maps at once.
    for (const key of ['edges', 'budget', 'artifacts']) {
      expect(UPDATE_FIELDS[key]).toBe(key);
      expect(UNSETTABLE_FIELDS[key]).toBe(key);
    }
  });
});
