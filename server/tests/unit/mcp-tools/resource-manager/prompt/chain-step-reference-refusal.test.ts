// @lifecycle canonical - The write boundary refuses a chain step naming an unregistered prompt.
//
// Before this, `validateChainStepReferences` returned WARNINGS and skipped every id containing
// '/', which `PROMPT_ID_PATTERN` makes the canonical form for a nested step — so the check
// exempted exactly the ids it existed to check, the prompt was saved, and the run failed one
// step later. The nested cases here are the regression; the bare case is the coverage that was
// already nominally there.
import { describe, expect, jest, test } from '@jest/globals';

import { ContentAnalyzer } from '../../../../../src/modules/semantic/content-analyzer.js';
import { GateAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { PromptAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { PromptLifecycleProcessor } from '../../../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';

import type { PromptResourceContext } from '../../../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { PromptDraftInput } from '../../../../../src/mcp/tools/resource-manager/prompt/services/prompt-draft-service.js';
import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

const createLogger = () =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

const REGISTERED_PROMPT = {
  id: 'readme_improver',
  name: 'Readme Improver',
  category: 'documentation',
  description: 'Improves a readme',
  userMessageTemplate: 'Improve {{doc}}',
  arguments: [],
  chainSteps: [],
};

/**
 * The processor with one stub: `updatePromptImplementation`, the only disk write. It is stubbed
 * rather than mocked away because the assertion these tests exist for is that it is NOT called —
 * a refusal that still wrote would pass every text assertion.
 */
function createProcessor(seeded: Array<Record<string, unknown>> = [REGISTERED_PROMPT]) {
  const logger = createLogger();
  const convertedPrompts = [...seeded];
  let writtenPrompt: Record<string, unknown> | undefined;
  // The write is only VISIBLE to the post-write verification once the registry is refreshed, so
  // the stub refresh republishes what the file boundary was handed. Without it every accepted
  // write reports "verification FAILED" and the accept/refuse assertions stop discriminating.
  const onRefresh = jest.fn(async () => {
    if (writtenPrompt === undefined) return;
    const index = convertedPrompts.findIndex((prompt) => prompt['id'] === writtenPrompt?.['id']);
    if (index >= 0) convertedPrompts[index] = writtenPrompt;
    else convertedPrompts.push(writtenPrompt);
  });
  const dependencies = {
    logger,
    configManager: {
      getConfigPath: () => '/test/config.yaml',
      getServerRoot: () => '/test',
      getResolvedPromptsDirectory: () => '/test/prompts',
    } as unknown as ConfigManager,
    semanticAnalyzer: new ContentAnalyzer(createLogger()),
    onRefresh,
    onRestart: jest.fn(async () => {}),
  };
  const updatePromptImplementation = jest.fn(async (promptData: Record<string, unknown>) => {
    writtenPrompt = promptData;
    return {
      message: `written ${String(promptData['id'])}`,
      affectedFiles: ['/test/prompts/documentation/x/prompt.yaml'],
    };
  });

  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations: { updatePromptImplementation },
    getData: () => ({ convertedPrompts }),
    versionHistoryService: {
      isAutoVersionEnabled: () => false,
      loadHistory: jest.fn(async () => null),
    },
    textDiffService: { generatePromptDiff: () => ({ hasChanges: false, formatted: '' }) },
    comparisonEngine: {
      compareAnalyses: () => ({}),
      generateDisplaySummary: () => '',
    },
  } as unknown as PromptResourceContext;

  return { processor: new PromptLifecycleProcessor(context), updatePromptImplementation };
}

function textOf(response: { content: Array<{ text?: string }> }): string {
  return response.content.map((part) => part.text ?? '').join('');
}

const chainArgs = (chainSteps: Array<Record<string, unknown>>): PromptDraftInput =>
  ({
    id: 'release_chain',
    name: 'Release Chain',
    description: 'A chain used to cover chain step reference refusal',
    category: 'documentation',
    user_message_template: 'Run the chain',
    chain_steps: chainSteps,
  }) as unknown as PromptDraftInput;

describe('resource_manager create — a chain step must name a registered prompt', () => {
  test('refuses a bare step id that is not registered, naming the step position', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = (await processor.createPrompt(
      chainArgs([
        { promptId: 'readme_improver', stepName: 'Improve' },
        { promptId: 'run_smoke_tests', stepName: 'Smoke' },
      ])
    )) as never;

    expect(textOf(response)).toContain("step 2 references unknown promptId 'run_smoke_tests'");
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  test('refuses a NESTED step id belonging to another chain — the case the old skip let through', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = (await processor.createPrompt(
      chainArgs([{ promptId: 'deep_analysis/initial_scan', stepName: 'Scan' }])
    )) as never;

    expect(textOf(response)).toContain(
      "step 1 references unknown promptId 'deep_analysis/initial_scan'"
    );
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  test('refuses an id nested two levels under the chain — the scaffold never creates it', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = (await processor.createPrompt(
      chainArgs([{ promptId: 'release_chain/phase/step', stepName: 'Deep' }])
    )) as never;

    expect(textOf(response)).toContain(
      "step 1 references unknown promptId 'release_chain/phase/step'"
    );
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  test('saves a chain whose steps are all registered', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = (await processor.createPrompt(
      chainArgs([{ promptId: 'readme_improver', stepName: 'Improve' }])
    )) as never;

    expect(textOf(response)).toContain('✅ **Prompt Created**');
    expect(updatePromptImplementation).toHaveBeenCalledTimes(1);
  });

  test('saves a chain whose steps are its OWN one-level children — this call scaffolds them', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = (await processor.createPrompt(
      chainArgs([
        { promptId: 'release_chain/cut_tag', stepName: 'Cut tag' },
        { promptId: 'release_chain/announce', stepName: 'Announce' },
      ])
    )) as never;

    expect(textOf(response)).toContain('✅ **Prompt Created**');
    expect(updatePromptImplementation).toHaveBeenCalledTimes(1);
  });
});

describe('resource_manager update — the same refusal on an existing chain', () => {
  const existingChain = {
    id: 'release_chain',
    name: 'Release Chain',
    category: 'documentation',
    description: 'A chain used to cover chain step reference refusal',
    userMessageTemplate: 'Run the chain',
    arguments: [],
    chainSteps: [{ promptId: 'readme_improver', stepName: 'Improve' }],
  };

  test('refuses a full chain_steps replacement carrying an unregistered id', async () => {
    const { processor, updatePromptImplementation } = createProcessor([
      REGISTERED_PROMPT,
      existingChain,
    ]);

    const response = (await processor.updatePrompt({
      id: 'release_chain',
      chain_steps: [
        { promptId: 'readme_improver', stepName: 'Improve' },
        { promptId: 'run_smoke_tests', stepName: 'Smoke' },
      ],
    })) as never;

    expect(textOf(response)).toContain("step 2 references unknown promptId 'run_smoke_tests'");
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  test('refuses a chain_step_operation:"add" that appends an unregistered id', async () => {
    const { processor, updatePromptImplementation } = createProcessor([
      REGISTERED_PROMPT,
      existingChain,
    ]);

    const response = (await processor.updatePrompt({
      id: 'release_chain',
      chain_step_operation: 'add',
      chain_step_data: { promptId: 'run_smoke_tests', stepName: 'Smoke' },
    })) as never;

    expect(textOf(response)).toContain("step 2 references unknown promptId 'run_smoke_tests'");
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  test('accepts an update whose steps all resolve', async () => {
    const { processor, updatePromptImplementation } = createProcessor([
      REGISTERED_PROMPT,
      existingChain,
    ]);

    await processor.updatePrompt({
      id: 'release_chain',
      chain_step_operation: 'add',
      chain_step_data: { promptId: 'release_chain/cut_tag', stepName: 'Cut tag' },
    });

    expect(updatePromptImplementation).toHaveBeenCalledTimes(1);
  });
});
