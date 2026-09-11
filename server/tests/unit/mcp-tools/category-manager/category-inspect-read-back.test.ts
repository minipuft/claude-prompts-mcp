/**
 * P4.7 / P4.11 — category `inspect` renders the DOCUMENT, and renders a field only when the
 * document declares it.
 *
 * WHY NOT THE LOADED `Category`. `loader.ts` resolves `name` to `formatCategoryName(id)` and
 * `description` to `Prompts in the <id> category` whenever `category.yaml` declares neither, and
 * `registerWithMcp`/`mcpPromptMode` fall through to prompt-level and global defaults. So the
 * loaded object cannot distinguish "the author chose this" from "the loader supplied it", and an
 * `inspect` built on it would report a default as an authored value — the P4.6-shaped gap the
 * gate and framework read-backs already closed for their own fields.
 *
 * These cases drive `CategoryDiscoveryProcessor.handleInspect` against a real temp directory, so
 * they exercise the render path and the filesystem walk, not a copy of either.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CategoryDiscoveryProcessor } from '../../../../src/mcp/tools/category-manager/services/category-discovery-processor.js';

import type { CategoryResourceContext } from '../../../../src/mcp/tools/category-manager/core/context.js';
import type { ConfigManager, Logger } from '../../../../src/shared/types/index.js';

describe('CategoryDiscoveryProcessor.handleInspect — declared-only read-back', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let processor: CategoryDiscoveryProcessor;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'cpm-category-inspect-'));
    promptsDir = join(workspaceDir, 'prompts');
    mkdirSync(promptsDir, { recursive: true });

    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    const configManager = {
      getResolvedPromptsDirectory: () => promptsDir,
      getBundledResourceDirectory: () => undefined,
      getOverlayResourceDirectories: () => [],
    } as unknown as ConfigManager;

    processor = new CategoryDiscoveryProcessor({
      logger,
      configManager,
    } as unknown as CategoryResourceContext);
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  function declare(id: string, yaml: string): void {
    mkdirSync(join(promptsDir, id), { recursive: true });
    writeFileSync(join(promptsDir, id, 'category.yaml'), yaml);
  }

  async function inspect(id: string): Promise<string> {
    const result = await processor.handleInspect({ action: 'inspect', id });
    return (result.content[0] as { text: string }).text;
  }

  it('renders every field the document declares', async () => {
    declare(
      'analysis',
      'id: analysis\nname: Analysis\ndescription: Analytical prompts\nregisterWithMcp: false\nmcpPromptMode: launch\n'
    );

    const text = await inspect('analysis');

    expect(text).toContain('Name: Analysis');
    expect(text).toContain('Description: Analytical prompts');
    expect(text).toContain('Register With MCP: false');
    expect(text).toContain('MCP Prompt Mode: launch');
  });

  it('omits a field the document does not declare — never a printed default', async () => {
    declare('analysis', 'id: analysis\nname: Analysis\ndescription: Analytical prompts\n');

    const text = await inspect('analysis');

    // MUTATION KILLED: changing the `value !== undefined && value !== null` guard in
    // `describeDeclaration` to an unconditional push makes this case red (it prints
    // `Register With MCP: undefined`) while the case above still passes. Confirmed by applying
    // it, re-running this file, and reverting.
    expect(text).toContain('Name: Analysis');
    expect(text).not.toContain('Register With MCP:');
    expect(text).not.toContain('MCP Prompt Mode:');
  });

  it('says a directory with no category.yaml declares nothing', async () => {
    mkdirSync(join(promptsDir, 'undeclared'), { recursive: true });

    const text = await inspect('undeclared');

    // The state P4.7 exists to end, and the one `inspect` must not paper over: a category served
    // under a name nobody chose. Reporting the derived name as though it were authored is the
    // failure this row's whole read-back design is against.
    expect(text).toContain('Declaration: none');
    expect(text).toContain('DERIVED from the directory name');
    expect(text).not.toContain('Name:');
  });

  it('flags a document whose id disagrees with its directory', async () => {
    // Unreachable through the tool — `validateCategorySchema` refuses it on write — but reachable
    // for any file authored by hand before P4.7, and invisible everywhere else: the loader names
    // the category by its DIRECTORY and never reads this key.
    declare('analysis', 'id: anaylsis\nname: Analysis\ndescription: Analytical prompts\n');

    const text = await inspect('analysis');

    expect(text).toContain("declares id 'anaylsis'");
    expect(text).toContain("served as 'analysis'");
  });

  it('refuses a category no root holds', async () => {
    const result = await processor.handleInspect({ action: 'inspect', id: 'nonexistent' });
    expect(result.isError).toBe(true);
  });
});
