/**
 * P4.59 — `resource_manager update` on an id that is neither loaded nor quarantined must be
 * refused as unknown BEFORE any patch or diagnosis logic runs.
 *
 * WHAT WENT WRONG
 * `plan_table` ships only as the nested chain step `implementation_plan/plan_table`, addressable
 * exclusively by its composite id. `updatePrompt` had no upfront "does this id exist" refusal:
 * `currentPrompt` came back `undefined`, the quarantine lookup (`resolveRepairTarget`) also found
 * nothing, and the call fell through to the same path a legitimate repair uses —
 * `canonicalPromptSnapshot(id, undefined)`, an empty draft defaulted to `category: 'general'` —
 * as if creating a brand-new prompt nobody asked for. A `patch` against that empty draft then
 * reached `applyTemplatePatches`, found no anchor in an empty `userMessageTemplate`, and answered
 * `anchor_not_found` — a true statement about an anchor that could never have existed, naming the
 * wrong cause.
 *
 * THE FIX
 * `updatePrompt` now refuses immediately when `currentPrompt` and `repairTarget` are both
 * undefined, before `checkExpectedVersion`, before `canonicalPromptSnapshot`, before any patch
 * logic. When the bare id matches the last `/`-segment of exactly one loaded nested step, the
 * refusal suggests the composite id; several matches are listed instead of guessed at.
 */

import { describe, expect, jest, test } from '@jest/globals';

import { GateAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { PromptAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { PromptLifecycleProcessor } from '../../../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';

import type { PromptResourceContext } from '../../../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { Logger } from '../../../../../src/shared/types/index.js';

function textOf(response: { content: Array<{ text?: string }> }): string {
  return response.content.map((part) => part.text ?? '').join('');
}

/**
 * The refusal path reads only `getData().convertedPrompts`; the twin (a KNOWN id) reaches
 * `promptAnalyzer.analyzePrompt` ahead of the patch failure, so a real `PromptAnalyzer` is wired
 * rather than stubbed — a stub would assert only the stub's own return value. No `quarantine`
 * dependency is supplied, so `resolveRepairTarget` always finds nothing (`quarantine?.byId(id) ??
 * []`), matching a truly unknown id in production (never loaded, never quarantined).
 */
function createProcessor(convertedPrompts: Record<string, unknown>[]) {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const updatePromptImplementation = jest.fn(async () => ({ message: 'written' }));
  const dependencies = {
    logger,
    onRefresh: jest.fn(async () => {}),
    onRestart: jest.fn(async () => {}),
  };
  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations: {
      updatePromptImplementation,
      projectPromptWrite: jest.fn(async () => []),
    },
    getData: () => ({ convertedPrompts }),
    versionHistoryService: {
      isAutoVersionEnabled: () => false,
      loadHistory: jest.fn(async () => null),
    },
  } as unknown as PromptResourceContext;

  return { processor: new PromptLifecycleProcessor(context), updatePromptImplementation };
}

describe('update on an unknown prompt id (P4.59)', () => {
  test('refuses a bare id that only exists as one nested step, before any patch logic runs', async () => {
    const { processor, updatePromptImplementation } = createProcessor([
      { id: 'implementation_plan', name: 'Implementation Plan', category: 'planning' },
      { id: 'implementation_plan/plan_table', name: 'Plan Table', category: 'planning' },
    ]);

    const response = await processor.updatePrompt({
      id: 'plan_table',
      patch: [{ field: 'user_message_template', old_string: 'anything', new_string: 'x' }],
    } as never);

    expect(response.isError).toBe(true);
    const text = textOf(response as never);
    expect(text).toContain('unknown prompt');
    expect(text).toContain('plan_table');
    expect(text).toContain('implementation_plan/plan_table');
    // The falsifier this row exists to fix: the OLD behaviour reached the patch/anchor machinery
    // and answered this instead of naming the id as unknown up front.
    expect(text).not.toContain('anchor_not_found');
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  test('lists every match when several nested steps share the bare id', async () => {
    const { processor } = createProcessor([
      { id: 'chain_one/plan_table', name: 'One', category: 'planning' },
      { id: 'chain_two/plan_table', name: 'Two', category: 'planning' },
    ]);

    const response = await processor.updatePrompt({
      id: 'plan_table',
      description: 'x',
    } as never);

    expect(response.isError).toBe(true);
    const text = textOf(response as never);
    expect(text).toContain('chain_one/plan_table');
    expect(text).toContain('chain_two/plan_table');
  });

  test('refuses a bare id with no nested match at all, without a composite suggestion', async () => {
    const { processor } = createProcessor([
      { id: 'implementation_plan/plan_table', name: 'Plan Table', category: 'planning' },
    ]);

    const response = await processor.updatePrompt({
      id: 'totally_unknown_id',
      description: 'x',
    } as never);

    expect(response.isError).toBe(true);
    const text = textOf(response as never);
    expect(text).toContain('unknown prompt');
    expect(text).not.toContain('Did you mean');
  });

  /**
   * TWIN (required by the row): a KNOWN id with a real missing anchor still returns
   * `anchor_not_found` — the fix refuses only an id that resolves to nothing at all, not every
   * `anchor_not_found`.
   */
  test('twin: a KNOWN id with a real missing anchor still returns anchor_not_found', async () => {
    const { processor, updatePromptImplementation } = createProcessor([
      {
        id: 'implementation_plan/plan_table',
        name: 'Plan Table',
        category: 'planning',
        userMessageTemplate: 'Render the table.',
        arguments: [],
        chainSteps: [],
      },
    ]);

    const response = await processor.updatePrompt({
      id: 'implementation_plan/plan_table',
      patch: [
        {
          field: 'user_message_template',
          old_string: 'this anchor does not exist',
          new_string: 'x',
        },
      ],
    } as never);

    expect(response.isError).toBe(true);
    expect(textOf(response as never)).toContain('anchor_not_found');
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });
});
