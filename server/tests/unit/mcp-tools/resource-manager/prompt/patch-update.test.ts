/**
 * P7 rows 3.4 / 3.5 — patch-mode `update` through `PromptLifecycleProcessor`.
 *
 * The load-bearing assertions here are about ORDER, not about text:
 *
 * - the snapshot handed to `recordEditResult` must already be patched (acceptance (c)) — moving the
 *   patch hop after the version record leaves the snapshot unpatched and fails
 *   `records the PATCHED state`, `version parity` and the file-write test together;
 * - a rejection must be observable as the ABSENCE of both the write and the version record — an
 *   error message that still writes, or that still spends a version, is the same durable defect
 *   Tier 2 closed for a different reason.
 */

import { describe, expect, jest, test } from '@jest/globals';

import { ContentAnalyzer } from '../../../../../src/modules/semantic/content-analyzer.js';
import { ComparisonEngine } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { GateAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { PromptLifecycleProcessor } from '../../../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';

import type { PromptResourceContext } from '../../../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

const TEMPLATE = [
  '## Context',
  '{{input}}',
  '',
  '## Output',
  'Answer in prose.',
  '',
  '## Notes',
  'None.',
].join('\n');

const PATCHED_TEMPLATE = TEMPLATE.replace('Answer in prose.', 'Answer in bullet points.');

const createLogger = () =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * One stub for the disk write and one for the version seam; everything else is real. The version
 * double records `recordEditResult`'s arguments because that call IS the `version_history` row —
 * parity between a patch and a full update is exactly parity of those arguments.
 */
function createProcessor(
  existingPrompt: Record<string, unknown> = {
    id: 'review_code',
    name: 'Review Code',
    category: 'general',
    description: 'Reviews a code function for defects',
    userMessageTemplate: TEMPLATE,
    systemMessage: 'Be precise.',
    arguments: [],
    chainSteps: [],
  }
) {
  const logger = createLogger();
  let currentPrompt = existingPrompt;
  const configManager = {
    getConfigPath: () => '/test/config.yaml',
    getServerRoot: () => '/test',
    getResolvedPromptsDirectory: () => '/test/prompts',
  } as unknown as ConfigManager;
  const dependencies = {
    logger,
    configManager,
    semanticAnalyzer: new ContentAnalyzer(createLogger()),
    onRefresh: jest.fn(async () => {}),
    onRestart: jest.fn(async () => {}),
  };
  const updatePromptImplementation = jest.fn(async (promptData: Record<string, unknown>) => {
    currentPrompt = promptData;
    return { message: 'written' };
  });
  const recordEditResult = jest.fn(
    async (
      _type: string,
      _id: string,
      _prior: unknown,
      _produced: Record<string, unknown>,
      _options: Record<string, unknown>
    ) => ({ version: 7, success: true })
  );

  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations: { updatePromptImplementation },
    getData: () => ({ convertedPrompts: [currentPrompt] }),
    versionHistoryService: {
      isAutoVersionEnabled: () => true,
      loadHistory: jest.fn(async () => ({ current_version: 7 })),
      recordEditResult,
    },
    textDiffService: new ObjectDiffGenerator(),
    comparisonEngine: new ComparisonEngine(logger),
  } as unknown as PromptResourceContext;

  return {
    processor: new PromptLifecycleProcessor(context),
    updatePromptImplementation,
    recordEditResult,
    logger,
  };
}

function textOf(response: { content: Array<{ text?: string }> }): string {
  return response.content.map((part) => part.text ?? '').join('');
}

const PROSE_TO_BULLETS = {
  field: 'user_message_template' as const,
  old_string: 'Answer in prose.',
  new_string: 'Answer in bullet points.',
};

describe('patch-mode update', () => {
  test('writes the patched template without the untouched sections being resent', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = await processor.updatePrompt({
      id: 'review_code',
      patch: [PROSE_TO_BULLETS],
    } as never);

    expect(response.isError).toBe(false);
    const written = updatePromptImplementation.mock.calls[0][0];
    expect(written['userMessageTemplate']).toBe(PATCHED_TEMPLATE);
    // The sections the caller never transmitted survive verbatim — that is acceptance (a).
    expect(written['userMessageTemplate']).toContain('## Notes');
    expect(written['systemMessage']).toBe('Be precise.');
  });

  /**
   * ORDERING FALSIFICATION. Move the patch hop below the `recordEditResult` call and this fails:
   * the recorded snapshot would carry the pre-patch template while the file carries the patched
   * one, which is precisely the "no version row ever holds current live content" defect P7-D2
   * closed.
   */
  test('records the PATCHED state as the version snapshot', async () => {
    const { processor, recordEditResult } = createProcessor();

    await processor.updatePrompt({ id: 'review_code', patch: [PROSE_TO_BULLETS] } as never);

    expect(recordEditResult).toHaveBeenCalledTimes(1);
    const produced = recordEditResult.mock.calls[0][3];
    expect(produced['userMessageTemplate']).toBe(PATCHED_TEMPLATE);
  });

  /**
   * Acceptance (c): version parity. The patch and the equivalent full update must produce the same
   * `version_history` row — same produced snapshot, same description, same diff summary — because
   * both reach the same seam with the same `promptData`.
   */
  test('produces the same version row and the same file as an equivalent full update', async () => {
    const patched = createProcessor();
    await patched.processor.updatePrompt({
      id: 'review_code',
      patch: [PROSE_TO_BULLETS],
    } as never);

    const full = createProcessor();
    await full.processor.updatePrompt({
      id: 'review_code',
      user_message_template: PATCHED_TEMPLATE,
    } as never);

    const patchCall = patched.recordEditResult.mock.calls[0];
    const fullCall = full.recordEditResult.mock.calls[0];

    expect(patchCall[3]).toEqual(fullCall[3]);
    expect(patchCall[4]).toEqual(fullCall[4]);
    expect(patched.updatePromptImplementation.mock.calls[0][0]).toEqual(
      full.updatePromptImplementation.mock.calls[0][0]
    );
    // A diff summary of +0/-0 would mean the version row describes a change that is not in it.
    expect((patchCall[4] as { diff_summary: string }).diff_summary).not.toBe('+0/-0');
  });

  test('rejects an ambiguous anchor without writing or spending a version', async () => {
    const { processor, updatePromptImplementation, recordEditResult } = createProcessor({
      id: 'review_code',
      name: 'Review Code',
      category: 'general',
      description: 'Reviews a code function for defects',
      userMessageTemplate: 'step\nstep',
      arguments: [],
      chainSteps: [],
    });

    const response = await processor.updatePrompt({
      id: 'review_code',
      patch: [{ field: 'user_message_template', old_string: 'step', new_string: 'phase' }],
    } as never);

    expect(response.isError).toBe(true);
    expect(textOf(response as never)).toContain('anchor_ambiguous');
    expect(updatePromptImplementation).not.toHaveBeenCalled();
    expect(recordEditResult).not.toHaveBeenCalled();
  });

  test('rejects an anchor that does not match, naming it', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = await processor.updatePrompt({
      id: 'review_code',
      patch: [{ field: 'user_message_template', old_string: 'Answer in verse.', new_string: 'x' }],
    } as never);

    expect(response.isError).toBe(true);
    expect(textOf(response as never)).toContain('Answer in verse.');
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  test('refuses patch combined with a full body parameter instead of preferring one', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = await processor.updatePrompt({
      id: 'review_code',
      patch: [PROSE_TO_BULLETS],
      user_message_template: 'a wholly different body',
    } as never);

    expect(response.isError).toBe(true);
    expect(textOf(response as never)).toContain('`user_message_template`');
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });
});

describe('preview', () => {
  test('renders the result and writes nothing, recording no version', async () => {
    const { processor, updatePromptImplementation, recordEditResult } = createProcessor();

    const response = await processor.updatePrompt({
      action: 'preview',
      preview_action: 'update',
      id: 'review_code',
      patch: [PROSE_TO_BULLETS],
    } as never);

    expect(response.isError).toBe(false);
    const text = textOf(response as never);
    expect(text).toContain('Preview');
    expect(text).toContain('Answer in bullet points.');
    expect(updatePromptImplementation).not.toHaveBeenCalled();
    expect(recordEditResult).not.toHaveBeenCalled();
  });

  test('applies to a full update as well, still writing nothing', async () => {
    const { processor, updatePromptImplementation, recordEditResult } = createProcessor();

    const response = await processor.updatePrompt({
      action: 'preview',
      preview_action: 'update',
      id: 'review_code',
      description: 'A different description entirely',
    } as never);

    expect(response.isError).toBe(false);
    expect(updatePromptImplementation).not.toHaveBeenCalled();
    expect(recordEditResult).not.toHaveBeenCalled();
  });

  test('reports a failed anchor before a version is spent', async () => {
    const { processor, recordEditResult } = createProcessor();

    const response = await processor.updatePrompt({
      action: 'preview',
      preview_action: 'update',
      id: 'review_code',
      patch: [{ field: 'user_message_template', old_string: 'nope', new_string: 'x' }],
    } as never);

    expect(response.isError).toBe(true);
    expect(recordEditResult).not.toHaveBeenCalled();
  });
});

describe('produced-state validation (row 3.5)', () => {
  test('rejects a patch that breaks template syntax, without writing or versioning', async () => {
    const { processor, updatePromptImplementation, recordEditResult } = createProcessor();

    const response = await processor.updatePrompt({
      id: 'review_code',
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: '{% if tone %}Answer in prose.',
        },
      ],
    } as never);

    expect(response.isError).toBe(true);
    expect(textOf(response as never)).toContain('userMessageTemplate');
    expect(updatePromptImplementation).not.toHaveBeenCalled();
    expect(recordEditResult).not.toHaveBeenCalled();
  });

  test('rejects a full update that breaks template syntax', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = await processor.updatePrompt({
      id: 'review_code',
      user_message_template: 'Hello {{ broken( }}',
    } as never);

    expect(response.isError).toBe(true);
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  /**
   * The differential rule. Three shipped prompts carry Handlebars-style `{{#if}}` bodies that no
   * Nunjucks parse accepts (measured 2026-08-12: `creative/lora_profile`,
   * `general/diagnosisCard`, plus `{{{x}}}` in the same family). A flat syntax gate would refuse
   * every future edit to them — including an edit that repairs them.
   */
  test('allows an edit to a prompt whose template was already unparseable', async () => {
    const { processor, updatePromptImplementation } = createProcessor({
      id: 'legacy_prompt',
      name: 'Legacy',
      category: 'general',
      description: 'Carries Handlebars-era syntax',
      userMessageTemplate: '{{#if signals}}Signals: {{{signals}}}{{/if}}\nTail text.',
      arguments: [],
      chainSteps: [],
    });

    const response = await processor.updatePrompt({
      id: 'legacy_prompt',
      patch: [
        { field: 'user_message_template', old_string: 'Tail text.', new_string: 'New tail.' },
      ],
    } as never);

    expect(response.isError).toBe(false);
    expect(updatePromptImplementation.mock.calls[0][0]['userMessageTemplate']).toContain(
      'New tail.'
    );
  });

  /**
   * Rendering with empty arguments would throw here ("cannot read split of undefined") even though
   * the syntax is valid, which is why the check compiles instead of rendering.
   */
  test('accepts valid template syntax that cannot be rendered without arguments', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = await processor.updatePrompt({
      id: 'review_code',
      patch: [
        {
          field: 'user_message_template',
          old_string: 'None.',
          new_string: "{% for job in jobs.split(',') %}{{job}}{% endfor %}",
        },
      ],
    } as never);

    expect(response.isError).toBe(false);
    expect(updatePromptImplementation).toHaveBeenCalledTimes(1);
  });

  test('a patch arms reference validation the same way a full body does', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    const response = await processor.updatePrompt({
      id: 'review_code',
      patch: [
        {
          field: 'user_message_template',
          old_string: 'None.',
          new_string: '{{ref:no_such_prompt}}',
        },
      ],
    } as never);

    expect(response.isError).toBe(true);
    expect(textOf(response as never)).toContain('reference errors');
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });
});
