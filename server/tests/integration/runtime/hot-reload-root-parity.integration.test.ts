/**
 * A hot reload must serve the catalog a restart would.
 *
 * WHY THIS TEST EXISTS, AND WHY NOTHING CAUGHT THE DEFECT
 * `reloadPromptData` loaded ONE directory — the primary root — while startup merged the bundled
 * base and every workspace overlay. So under a configured workspace the first hot reload rebuilt
 * the live catalog from the primary root alone, dropped the bundled tree and every overlay, and
 * published the change with no error. Measured 2026-08-30 (issue #229 follow-up, R-HR1): an edit
 * to a bundled-only prompt under an external `MCP_RESOURCES_PATH` was never observed, held 60s,
 * against a control where an external-tree edit appeared at t+5s.
 *
 * Zero tests exercised `reloadPromptData` before this one. That is the whole reason a defect this
 * large sat behind a green suite: the fix and the pre-fix code produce identical results for every
 * assertion anyone had written, because none of them reloaded across more than one root.
 *
 * A COUNT-BASED ASSERTION CANNOT SEE THIS. `prompts/list` reported 113 before AND after the
 * reload, because binding is deduped per shell — the entries survive while their content stops
 * tracking the file. Every assertion below therefore reads CONTENT (a prompt's presence by id, and
 * its `userMessageTemplate` body), never a catalog size. A test asserting `length` would pass
 * against the defect.
 *
 * WHY THIS IS INTEGRATION, NOT E2E
 * The defect lives in which ROOTS the reload composes, which this reaches directly with real
 * directories and a real `PromptAssetManager`. Driving a live server through its 500ms file-watcher
 * debounce would add transport and timing without adding evidence about the composition, and would
 * trade a deterministic assertion for a flaky one. Nothing here is mocked except the config
 * accessors that name the roots.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PromptAssetManager } from '../../../src/modules/prompts/index.js';
import { reloadPromptData } from '../../../src/modules/prompts/prompt-refresh-service.js';
import { ConversationStore } from '../../../src/modules/text-refs/conversation.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';

import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

async function writePrompt(
  root: string,
  category: string,
  id: string,
  body: string
): Promise<void> {
  const dir = path.join(root, category, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'prompt.yaml'),
    [
      `id: ${id}`,
      `name: ${id}`,
      `category: ${category}`,
      `description: Fixture prompt ${id}.`,
      'userMessageTemplateFile: user-message.md',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(path.join(dir, 'user-message.md'), `${body}\n`, 'utf8');
}

/**
 * Only the four accessors `reloadPromptData` reads. A fuller double would let a signature change
 * pass here while breaking the real call, which is the mock-integrity failure this repo has hit
 * before — so this deliberately implements the narrow surface and casts once.
 */
function configFor(primary: string, bundled: string, overlays: string[]): ConfigManager {
  return {
    getResolvedPromptsDirectory: () => primary,
    getBundledResourceDirectory: () => bundled,
    getOverlayResourceDirectories: () => overlays,
    // `PromptAssetManager` reads this in its constructor; false keeps the fixture off the MCP
    // registration path, which this test does not exercise and does not need a server for.
    getPromptsRegisterWithMcp: () => false,
  } as unknown as ConfigManager;
}

describe('hot reload composes the same roots startup does', () => {
  let workspace: string;
  let bundled: string;
  let primary: string;
  let overlay: string;
  let promptManager: PromptAssetManager;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'hot-reload-parity-'));
    bundled = path.join(workspace, 'bundled');
    primary = path.join(workspace, 'primary');
    overlay = path.join(workspace, 'overlay');

    // One prompt unique to each root. Uniqueness is what makes the assertion decisive: a prompt
    // present in two roots would still appear after a single-root reload and prove nothing.
    await writePrompt(bundled, 'general', 'bundled_only', 'BUNDLED ORIGINAL');
    await writePrompt(primary, 'general', 'primary_only', 'PRIMARY ORIGINAL');
    await writePrompt(overlay, 'general', 'overlay_only', 'OVERLAY ORIGINAL');

    // Real collaborators — both take only a logger, so there is nothing to gain by faking them,
    // and a fake would decouple this test from the loader it is measuring.
    promptManager = new PromptAssetManager(
      logger,
      new TextReferenceStore(logger),
      new ConversationStore(logger),
      configFor(primary, bundled, [overlay])
    );
  });

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  const reload = async (): Promise<{ ids: string[]; body: (id: string) => string | undefined }> => {
    const result = await reloadPromptData({
      configManager: configFor(primary, bundled, [overlay]),
      promptManager,
    });
    return {
      ids: result.convertedPrompts.map((prompt) => prompt.id),
      body: (id) => result.convertedPrompts.find((p) => p.id === id)?.userMessageTemplate,
    };
  };

  it('serves prompts from every root, not just the primary one', async () => {
    // The load-bearing case. Pre-fix this returned `primary_only` alone.
    const { ids } = await reload();
    expect(ids).toContain('bundled_only');
    expect(ids).toContain('primary_only');
    expect(ids).toContain('overlay_only');
  });

  it('picks up an edit to a BUNDLED-ONLY prompt — the reported defect', async () => {
    await reload();
    await writePrompt(bundled, 'general', 'bundled_only', 'BUNDLED EDITED');

    const { body } = await reload();
    expect(body('bundled_only')).toContain('BUNDLED EDITED');
  });

  it('picks up an edit to an OVERLAY-ONLY prompt', async () => {
    await reload();
    await writePrompt(overlay, 'general', 'overlay_only', 'OVERLAY EDITED');

    const { body } = await reload();
    expect(body('overlay_only')).toContain('OVERLAY EDITED');
  });

  it('picks up an edit to a PRIMARY-tree prompt — the positive control', async () => {
    // This arm passed throughout the defect's lifetime. Without it, a reload that returned nothing
    // at all would satisfy the two cases above by making them fail for the right reason but the
    // wrong cause; this proves the probe observes a reload when one genuinely occurs.
    await reload();
    await writePrompt(primary, 'general', 'primary_only', 'PRIMARY EDITED');

    const { body } = await reload();
    expect(body('primary_only')).toContain('PRIMARY EDITED');
  });

  it('lets a higher-precedence root win a duplicate id, as startup does', async () => {
    // Precedence is bundle → primary → overlays. Asserted here because the shared loader owns it
    // for both paths now, so a reordering would silently change what a reload serves.
    await writePrompt(bundled, 'general', 'shared_id', 'FROM BUNDLED');
    await writePrompt(primary, 'general', 'shared_id', 'FROM PRIMARY');
    await writePrompt(overlay, 'general', 'shared_id', 'FROM OVERLAY');

    const { body } = await reload();
    expect(body('shared_id')).toContain('FROM OVERLAY');
  });

  it('does not depend on catalog size — the assertion a count-based test would make', async () => {
    // Kept as an explicit reminder rather than a real check: the served COUNT is stable across the
    // defect, so this expectation holds with and without the fix. It is here so a future reader
    // sees why the other cases read bodies instead.
    const before = await reload();
    await writePrompt(bundled, 'general', 'bundled_only', 'BUNDLED EDITED AGAIN');
    const after = await reload();

    expect(after.ids.length).toBe(before.ids.length);
    expect(after.body('bundled_only')).not.toBe(before.body('bundled_only'));
  });
});
