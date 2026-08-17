import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ContentAnalyzer } from '../../../../../src/modules/semantic/content-analyzer.js';
import { GateAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { PromptAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { ComparisonEngine } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { ObjectDiffGenerator } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { FileOperations } from '../../../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { PromptLifecycleProcessor } from '../../../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';

import type { PromptResourceContext } from '../../../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

const createLogger = () =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

const createSemanticAnalyzer = () => new ContentAnalyzer(createLogger());

/**
 * Builds the processor with real analysis collaborators and exactly one stub.
 *
 * `createPrompt` reaches `dependencies`, `promptAnalyzer`, `gateAnalyzer`, `fileOperations` and
 * `getData` — five of `PromptResourceContext`'s nine fields, plus `dependencies.onRefresh` via
 * `handleSystemRefresh`. The rest are never read on this path and are omitted rather than faked.
 * The single stub is
 * `fileOperations.updatePromptImplementation` — the only disk write. `PromptAnalyzer`,
 * `ContentAnalyzer` and `GateAnalyzer` are all real, deliberately: the branch under test renders
 * `GateAnalyzer`'s output, so stubbing it would assert nothing but the stub's own return value.
 */
function createProcessor() {
  const logger = createLogger();
  const onRefresh = jest.fn(async () => {});
  // `onRefresh` is reached via handleSystemRefresh after the response is assembled, so it is a
  // required collaborator even though it contributes nothing to the text under test.
  const dependencies = {
    logger,
    semanticAnalyzer: createSemanticAnalyzer(),
    onRefresh,
    onRestart: jest.fn(async () => {}),
  };
  // Typed argument so `mock.calls[0][0]` is reachable — an untyped jest.fn() infers a
  // zero-length tuple and indexing it is a type error, not just a lint nit.
  const updatePromptImplementation = jest.fn(async (_promptData: Record<string, unknown>) => ({
    message: 'written',
  }));

  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations: { updatePromptImplementation },
    getData: () => ({ convertedPrompts: [] }),
  } as unknown as PromptResourceContext;

  return {
    processor: new PromptLifecycleProcessor(context),
    updatePromptImplementation,
    onRefresh,
    logger,
  };
}

/**
 * `GateAnalyzer.analyzePromptContent` matches /code|programming|function|class|method|variable/
 * against the template, which is what produces the `code-quality` recommendation. A neutral
 * fixture yields an empty list, the `recommendedGates.length > 0` guard short-circuits, and an
 * assertion on absence would pass while proving nothing — so the wording here is load-bearing.
 */
const codePromptArgs = {
  id: 'review_code',
  name: 'Review Code',
  description: 'Reviews a code function for defects',
  category: 'general',
  user_message_template: 'Review this code function and report any defects: {{snippet}}',
  arguments: [{ name: 'snippet', type: 'string', required: true }],
};

function textOf(response: { content: Array<{ text?: string }> }): string {
  return response.content.map((part) => part.text ?? '').join('');
}

describe('PromptLifecycleProcessor.createPrompt gate recommendations', () => {
  test('suggests rule-based gates when no gate_configuration is supplied', async () => {
    const { processor } = createProcessor();

    const text = textOf((await processor.createPrompt({ ...codePromptArgs })) as never);

    expect(text).toContain('💡 **Suggested Gates**');
    // Asserted against what the real GateAnalyzer derives from the template, not a constant the
    // test supplied — a stubbed analyzer would make this assertion meaningless.
    expect(text).toContain('code-quality');
    expect(text).toContain('Use `update` action with `gate_configuration`');
  });

  test('reports the applied configuration instead of suggestions when one is supplied', async () => {
    const { processor } = createProcessor();

    const text = textOf(
      (await processor.createPrompt({
        ...codePromptArgs,
        gate_configuration: { include: ['code-quality'] },
      })) as never
    );

    expect(text).toContain('🔒 **Gate Configuration Applied**');
    expect(text).toContain('Include Gates: code-quality');
    // The branch is exclusive: an explicit configuration suppresses the suggestions entirely.
    expect(text).not.toContain('💡 **Suggested Gates**');
  });

  test('writes the prompt through the file boundary exactly once and touches no disk directly', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    await processor.createPrompt({ ...codePromptArgs });

    expect(updatePromptImplementation).toHaveBeenCalledTimes(1);
    expect(updatePromptImplementation.mock.calls[0]?.[0]).toMatchObject({
      id: 'review_code',
      category: 'general',
    });
  });

  test('reports success with the created prompt identity', async () => {
    const { processor } = createProcessor();

    const text = textOf((await processor.createPrompt({ ...codePromptArgs })) as never);

    expect(text).toContain('✅ **Prompt Created**');
    expect(text).toContain('review_code');
  });
});

/**
 * Row 1.6: `gate_configuration` moved out of a hand-written special case in `updatePrompt` and into
 * `UPDATE_FIELDS`. The special case existed only to fold the [Framework] `gates` parameter in as an
 * alias, which was accepted on update but silently ignored on create.
 *
 * Two behaviours, so two tests. The first is the regression risk of the change — moving the field
 * into the map must not stop it updating. The second is the change itself.
 *
 * Both assert on what reaches the file boundary rather than on response prose, because the prose
 * for these fields is rendered from `promptData` and would pass on a value that never persisted.
 */
describe('PromptLifecycleProcessor.updatePrompt gate_configuration handling', () => {
  const existingPrompt = {
    id: 'review_code',
    name: 'Review Code',
    category: 'general',
    description: 'Reviews a code function for defects',
    userMessageTemplate: 'Review: {{snippet}}',
    arguments: [],
    chainSteps: [],
    gateConfiguration: { include: ['pre-existing'] },
  };

  /**
   * The update path reaches four collaborators the create path does not: `getData` must return the
   * stored prompt, `versionHistoryService.isAutoVersionEnabled()` gates the versioning branch, and
   * `textDiffService` / `comparisonEngine` render the change summary. Versioning is stubbed to
   * `false` so the assertions stay on field mapping; the diff generator and comparison engine are
   * real, since stubbing them would assert only their own return values.
   */
  function createUpdateProcessor() {
    const logger = createLogger();
    const dependencies = {
      logger,
      semanticAnalyzer: createSemanticAnalyzer(),
      onRefresh: jest.fn(async () => {}),
      onRestart: jest.fn(async () => {}),
    };
    const updatePromptImplementation = jest.fn(async (_promptData: Record<string, unknown>) => ({
      message: 'written',
    }));

    const context = {
      dependencies,
      promptAnalyzer: new PromptAnalyzer(dependencies),
      gateAnalyzer: new GateAnalyzer(dependencies as never),
      fileOperations: { updatePromptImplementation },
      getData: () => ({ convertedPrompts: [existingPrompt] }),
      versionHistoryService: { isAutoVersionEnabled: () => false },
      textDiffService: new ObjectDiffGenerator(),
      comparisonEngine: new ComparisonEngine(logger),
    } as unknown as PromptResourceContext;

    return { processor: new PromptLifecycleProcessor(context), updatePromptImplementation };
  }

  test('gate_configuration still updates through UPDATE_FIELDS', async () => {
    const { processor, updatePromptImplementation } = createUpdateProcessor();

    await processor.updatePrompt({
      id: 'review_code',
      gate_configuration: { include: ['code-quality'] },
    } as never);

    const written = updatePromptImplementation.mock.calls[0][0];
    expect(written.gateConfiguration).toEqual({ include: ['code-quality'] });
  });

  test('the [Framework] gates parameter is no longer accepted on a prompt update', async () => {
    const { processor, updatePromptImplementation } = createUpdateProcessor();

    await processor.updatePrompt({
      id: 'review_code',
      gates: { include: ['smuggled-via-framework-param'] },
    } as never);

    const written = updatePromptImplementation.mock.calls[0][0];
    // Falls back to the stored configuration, exactly as `create` has always behaved when handed
    // `gates`. Asserting the fallback rather than `toBeUndefined()` distinguishes "alias ignored"
    // from "field wiped", which are different defects.
    expect(written.gateConfiguration).toEqual({ include: ['pre-existing'] });
  });
});

/**
 * OQ-P7-8 (owner ruling 2026-08-13). The five fields the YAML writer preserves rather than builds
 * are now settable through `create` and `update`.
 *
 * These assert on the payload handed to `updatePromptImplementation` rather than on written YAML:
 * this is the layer that decides WHICH keys reach the writer, and it is also the payload recorded
 * as the version snapshot. The writer's own precedence (supplied beats on-disk) is pinned in
 * `file-operations.validation.test.ts` against real files.
 */
describe('PromptLifecycleProcessor preserved-field parameters (OQ-P7-8)', () => {
  /**
   * A live prompt as the LOADER produces one: `registerWithMcp` and `mcpPromptMode` are always
   * populated because `PromptConverter` RESOLVES them through prompt → category → global →
   * default, while `subagentModel`, `agentType` and `injection` appear only when the file declared
   * them. That asymmetry is the whole reason the canonical snapshot projects three of the five and
   * refuses the other two — a fixture carrying only the authored three would make the refusal
   * untestable.
   */
  const livePrompt = {
    id: 'review_code',
    name: 'Review Code',
    category: 'general',
    description: 'Reviews a code function for defects',
    userMessageTemplate: 'Review: {{snippet}}',
    arguments: [],
    chainSteps: [],
    registerWithMcp: true,
    mcpPromptMode: 'expand',
    subagentModel: 'heavy',
    agentType: 'code-lifecycle-auditor',
    injection: { 'system-prompt': { enabled: false } },
  };

  function createUpdateProcessor(prompt: Record<string, unknown> = livePrompt) {
    const logger = createLogger();
    const dependencies = {
      logger,
      semanticAnalyzer: createSemanticAnalyzer(),
      onRefresh: jest.fn(async () => {}),
      onRestart: jest.fn(async () => {}),
    };
    const updatePromptImplementation = jest.fn(async (_promptData: Record<string, unknown>) => ({
      message: 'written',
    }));

    const context = {
      dependencies,
      promptAnalyzer: new PromptAnalyzer(dependencies),
      gateAnalyzer: new GateAnalyzer(dependencies as never),
      fileOperations: { updatePromptImplementation },
      getData: () => ({ convertedPrompts: [prompt] }),
      versionHistoryService: { isAutoVersionEnabled: () => false },
      textDiffService: new ObjectDiffGenerator(),
      comparisonEngine: new ComparisonEngine(logger),
    } as unknown as PromptResourceContext;

    return { processor: new PromptLifecycleProcessor(context), updatePromptImplementation };
  }

  const cases = [
    ['injection', { 'gate-guidance': { enabled: true, target: 'gates' } }],
    ['register_with_mcp', false, 'registerWithMcp'],
    ['mcp_prompt_mode', 'launch', 'mcpPromptMode'],
    ['subagent_model', 'fast', 'subagentModel'],
    ['agent_type', 'general-purpose', 'agentType'],
  ] as const;

  // One case per field. A merge map missing exactly one entry fails exactly one test, naming the
  // parameter — the property DEV-T1-4's inert-entry reasoning depended on and never had.
  for (const [parameter, value, dataKey = parameter] of cases) {
    test(`update sets ${parameter}`, async () => {
      const { processor, updatePromptImplementation } = createUpdateProcessor();

      await processor.updatePrompt({ id: 'review_code', [parameter]: value } as never);

      expect(updatePromptImplementation.mock.calls[0][0][dataKey]).toEqual(value);
    });

    test(`create sets ${parameter}`, async () => {
      const { processor, updatePromptImplementation } = createUpdateProcessor();

      await processor.createPrompt({
        id: 'brand_new',
        name: 'Brand New',
        description: 'A new prompt',
        category: 'general',
        user_message_template: 'Do {{task}}',
        [parameter]: value,
      } as never);

      expect(updatePromptImplementation.mock.calls[0][0][dataKey]).toEqual(value);
    });
  }

  test('create writes no key for a preserved field the caller omitted', async () => {
    const { processor, updatePromptImplementation } = createUpdateProcessor();

    await processor.createPrompt({
      id: 'brand_new',
      name: 'Brand New',
      description: 'A new prompt',
      category: 'general',
      user_message_template: 'Do {{task}}',
    } as never);

    const written = updatePromptImplementation.mock.calls[0][0];
    for (const key of [
      'injection',
      'registerWithMcp',
      'mcpPromptMode',
      'subagentModel',
      'agentType',
    ]) {
      expect(written).not.toHaveProperty(key);
    }
  });

  /**
   * THE regression guard for the canonical-snapshot decision.
   *
   * `promptData` outranks the writer's on-disk preservation, so any resolved value the projection
   * lets through is written into the file as an explicit prompt-level override — freezing the
   * prompt against its category and global default, on every unrelated edit, without a caller
   * asking. `canonicalPromptSnapshot` must therefore NOT project these two, even though the live
   * prompt always carries them.
   */
  test('an unrelated update carries neither resolved registerWithMcp nor mcpPromptMode', async () => {
    const { processor, updatePromptImplementation } = createUpdateProcessor();

    await processor.updatePrompt({ id: 'review_code', description: 'Updated' } as never);

    const written = updatePromptImplementation.mock.calls[0][0];
    expect(written).not.toHaveProperty('registerWithMcp');
    expect(written).not.toHaveProperty('mcpPromptMode');
  });

  /**
   * The other half: the three fields whose live value IS the authored one are projected, so the
   * snapshot this payload becomes describes the prompt's whole state. Without this, a rollback to
   * a version recorded by an unrelated edit restores a prompt that version never described — it
   * lands on whatever on-disk preservation happens to be holding at rollback time.
   */
  test('an unrelated update carries the three authored preserved fields forward', async () => {
    const { processor, updatePromptImplementation } = createUpdateProcessor();

    await processor.updatePrompt({ id: 'review_code', description: 'Updated' } as never);

    const written = updatePromptImplementation.mock.calls[0][0];
    expect(written.subagentModel).toBe('heavy');
    expect(written.agentType).toBe('code-lifecycle-auditor');
    expect(written.injection).toEqual({ 'system-prompt': { enabled: false } });
  });

  test('projects no key for an authored field the live prompt never declared', async () => {
    // Preserve-if-present, never defaulted: a prompt with no `subagentModel` must not acquire one
    // from the projection, or the writer would materialise it into the YAML.
    const { processor, updatePromptImplementation } = createUpdateProcessor({
      id: 'review_code',
      name: 'Review Code',
      category: 'general',
      description: 'Reviews a code function for defects',
      userMessageTemplate: 'Review: {{snippet}}',
      arguments: [],
      chainSteps: [],
      registerWithMcp: true,
      mcpPromptMode: 'expand',
    });

    await processor.updatePrompt({ id: 'review_code', description: 'Updated' } as never);

    const written = updatePromptImplementation.mock.calls[0][0];
    expect(written).not.toHaveProperty('subagentModel');
    expect(written).not.toHaveProperty('agentType');
    expect(written).not.toHaveProperty('injection');
  });

  test('an explicit value outranks the projected live value', async () => {
    const { processor, updatePromptImplementation } = createUpdateProcessor();

    await processor.updatePrompt({ id: 'review_code', subagent_model: 'fast' } as never);

    expect(updatePromptImplementation.mock.calls[0][0].subagentModel).toBe('fast');
  });
});

/**
 * Row 2.3 / OQ-P7-6. `saveVersion` used to return `{success:false}` on a persistence failure and
 * this caller logged a warning and PROCEEDED — so the new content was written, the operator was
 * told the update succeeded, and `version_history` (a DURABLE table nothing regenerates) carried a
 * silent gap where the pre-edit state should have been.
 *
 * The discriminating assertion is the ABSENCE of the write, not the error text: a version-save
 * failure that still reports an error while writing the file leaves exactly the same gap.
 */
describe('PromptLifecycleProcessor.updatePrompt version-save failure', () => {
  const existingPrompt = {
    id: 'review_code',
    name: 'Review Code',
    category: 'general',
    description: 'Reviews a code function for defects',
    userMessageTemplate: 'Review: {{snippet}}',
    arguments: [],
    chainSteps: [],
  };

  function createFailingVersionProcessor() {
    const logger = createLogger();
    const dependencies = {
      logger,
      semanticAnalyzer: createSemanticAnalyzer(),
      onRefresh: jest.fn(async () => {}),
      onRestart: jest.fn(async () => {}),
    };
    const updatePromptImplementation = jest.fn(async (_promptData: Record<string, unknown>) => ({
      message: 'written',
    }));
    // P7 row 2.4: the update path records through `recordEditResult` (go-forward numbering);
    // the abort posture is asserted against that seam.
    const recordEditResult = jest.fn(async () => {
      throw new Error('Failed to persist version snapshot for prompt/review_code: disk I/O error');
    });

    const context = {
      dependencies,
      promptAnalyzer: new PromptAnalyzer(dependencies),
      gateAnalyzer: new GateAnalyzer(dependencies as never),
      fileOperations: { updatePromptImplementation },
      getData: () => ({ convertedPrompts: [existingPrompt] }),
      versionHistoryService: { isAutoVersionEnabled: () => true, recordEditResult },
      textDiffService: new ObjectDiffGenerator(),
      comparisonEngine: new ComparisonEngine(logger),
    } as unknown as PromptResourceContext;

    return {
      processor: new PromptLifecycleProcessor(context),
      updatePromptImplementation,
      recordEditResult,
    };
  }

  test('aborts the update without writing when the snapshot cannot be saved', async () => {
    const { processor, updatePromptImplementation, recordEditResult } =
      createFailingVersionProcessor();

    const response = (await processor.updatePrompt({
      id: 'review_code',
      description: 'A description that must not reach disk',
    } as never)) as { isError: boolean; content: Array<{ text?: string }> };

    expect(recordEditResult).toHaveBeenCalledTimes(1);
    expect(updatePromptImplementation).not.toHaveBeenCalled();
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('No changes were written');
  });

  // P7 row 2.4 discriminating test: the recorded snapshot is the state the edit PRODUCES.
  // Recording `beforeContent` instead (the pre-fix semantics) fails the produced-state assertion.
  test('records the produced state, with the prior live state as the bridge input', async () => {
    const logger = createLogger();
    const dependencies = {
      logger,
      semanticAnalyzer: createSemanticAnalyzer(),
      onRefresh: jest.fn(async () => {}),
      onRestart: jest.fn(async () => {}),
    };
    const updatePromptImplementation = jest.fn(async (_promptData: Record<string, unknown>) => ({
      message: 'written',
    }));
    const recordEditResult = jest.fn(async () => ({ success: true, version: 7, bridged: false }));
    const context = {
      dependencies,
      promptAnalyzer: new PromptAnalyzer(dependencies),
      gateAnalyzer: new GateAnalyzer(dependencies as never),
      fileOperations: { updatePromptImplementation },
      getData: () => ({ convertedPrompts: [existingPrompt] }),
      versionHistoryService: { isAutoVersionEnabled: () => true, recordEditResult },
      textDiffService: new ObjectDiffGenerator(),
      comparisonEngine: new ComparisonEngine(logger),
    } as unknown as PromptResourceContext;
    const processor = new PromptLifecycleProcessor(context);

    await processor.updatePrompt({
      id: 'review_code',
      description: 'The produced description',
    } as never);

    expect(recordEditResult).toHaveBeenCalledTimes(1);
    const [, , prior, produced] = recordEditResult.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(prior['description']).toBe(existingPrompt.description);
    expect(produced['description']).toBe('The produced description');
  });

  test('skip_version bypasses the snapshot entirely and still writes', async () => {
    const { processor, updatePromptImplementation, recordEditResult } =
      createFailingVersionProcessor();

    const response = (await processor.updatePrompt({
      id: 'review_code',
      description: 'Updated without a version',
      skip_version: true,
    } as never)) as { isError: boolean };

    // The escape hatch the abort message names has to actually work, or the failure is a deadlock.
    expect(recordEditResult).not.toHaveBeenCalled();
    expect(updatePromptImplementation).toHaveBeenCalledTimes(1);
    expect(response.isError).toBe(false);
  });
});

/**
 * OQ-P7-9: `patch` and `dry_run` are update-only verbs — the schema accepts both on every
 * action, so `create` has to reject them itself. `updatePromptImplementation` not being called
 * is the discriminating assertion: a rejection that still wrote would be the same
 * accepted-here/ignored-there asymmetry P7-D4 exists to kill, just moved one level down.
 */
describe('PromptLifecycleProcessor.createPrompt rejects update-only verbs (OQ-P7-9)', () => {
  test('rejects patch on create before any side effect', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    await expect(
      processor.createPrompt({
        ...codePromptArgs,
        patch: [{ field: 'description', old_string: 'x', new_string: 'y' }],
      } as never)
    ).rejects.toThrow(/patch.*create/i);

    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  test('rejects dry_run on create before any side effect', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    await expect(
      processor.createPrompt({ ...codePromptArgs, dry_run: true } as never)
    ).rejects.toThrow(/dry_run.*create/i);

    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  /**
   * Fix D (tier-b-settability-proposal §2 / P6-F16): `argument_updates` overlays fields onto an
   * EXISTING argument by name — a `create` has no prior argument to overlay onto, the same
   * "no referent on create" reasoning as `patch`/`dry_run` above.
   */
  test('rejects argument_updates on create before any side effect', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    await expect(
      processor.createPrompt({
        ...codePromptArgs,
        argument_updates: [{ name: 'snippet', description: 'y' }],
      } as never)
    ).rejects.toThrow(/argument_updates.*create/i);

    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });
});

/**
 * P7-D4: `create`/`update` wrote successfully regardless of whether the target category ships in
 * the published repo — `server/resources/prompts/.gitignore` allowlists categories, and the
 * write path never consulted it. This exercises the real `FileOperations` (not the mocked stub
 * every other describe block in this file uses) against a read-only copy of the ACTUAL bundled
 * `.gitignore`, so `analysis` and `workflow` are real ground truth, not fixture assumptions.
 */
describe('PromptLifecycleProcessor category ship warning (P7-D4)', () => {
  const testDirname = path.dirname(fileURLToPath(import.meta.url));
  const serverRoot = path.resolve(testDirname, '../../../../..');
  const bundledGitignorePath = path.join(serverRoot, 'resources', 'prompts', '.gitignore');

  let workspaceDir: string | undefined;

  afterEach(() => {
    if (workspaceDir !== undefined) {
      rmSync(workspaceDir, { recursive: true, force: true });
      workspaceDir = undefined;
    }
  });

  function createShipWarningProcessor(): PromptLifecycleProcessor {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-ship-warning-'));
    const promptsDir = join(workspaceDir, 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    // Read-only copy of the file that actually governs shipping — never written back to.
    copyFileSync(bundledGitignorePath, join(promptsDir, '.gitignore'));

    const dependencies = {
      logger: createLogger(),
      semanticAnalyzer: createSemanticAnalyzer(),
      onRefresh: jest.fn(async () => {}),
      onRestart: jest.fn(async () => {}),
    };
    const configManager = {
      getResolvedPromptsDirectory: () => promptsDir,
    } as unknown as ConfigManager;
    const fileOperations = new FileOperations({ logger: dependencies.logger, configManager });

    const context = {
      dependencies,
      promptAnalyzer: new PromptAnalyzer(dependencies),
      gateAnalyzer: new GateAnalyzer(dependencies as never),
      fileOperations,
      getData: () => ({ convertedPrompts: [] }),
      textDiffService: new ObjectDiffGenerator(),
    } as unknown as PromptResourceContext;

    return new PromptLifecycleProcessor(context);
  }

  test('create under a gitignored category (analysis) warns, naming the file and the lines to add', async () => {
    const processor = createShipWarningProcessor();

    const text = textOf(
      (await processor.createPrompt({
        ...codePromptArgs,
        id: 'ship_warning_analysis_probe',
        category: 'analysis',
      })) as never
    );

    expect(text).toContain('Category not tracked in repo');
    expect(text).toContain('server/resources/prompts/.gitignore');
    expect(text).toContain('!analysis/');
    expect(text).toContain('!analysis/**');
  });

  test('create under a tracked category (workflow) does not warn', async () => {
    const processor = createShipWarningProcessor();

    const text = textOf(
      (await processor.createPrompt({
        ...codePromptArgs,
        id: 'ship_warning_workflow_probe',
        category: 'workflow',
      })) as never
    );

    expect(text).not.toContain('Category not tracked in repo');
  });

  test('update also surfaces the warning', async () => {
    const processor = createShipWarningProcessor();
    await processor.createPrompt({
      ...codePromptArgs,
      id: 'ship_warning_update_probe',
      category: 'analysis',
    } as never);

    const text = textOf(
      (await processor.updatePrompt({
        id: 'ship_warning_update_probe',
        category: 'analysis',
        description: 'updated description',
        user_message_template: codePromptArgs.user_message_template,
      } as never)) as never
    );

    expect(text).toContain('Category not tracked in repo');
  });
});
