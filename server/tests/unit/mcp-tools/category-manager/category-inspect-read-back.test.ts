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

/**
 * P4.39 — what `inspect` says an update would DO, for a declaration in another root.
 *
 * A write lands in the primary, which outranks every overlay and the bundled tree
 * (`shared/utils/resource-root-lookup.ts` §resourceRootPrecedence). `collectViews` walks
 * bundled -> overlays -> primary letting a later declaration win, so a foreign declaring root is
 * an overlay or the bundled tree and an update displaces either — the sentence names which one.
 * When an overlay outranked the primary this sentence told the operator their copy would take over
 * while the overlay went on declaring the category; the case below pins the opposite verdict.
 *
 * A renderer that said "outranked" for every foreign root, or "takes precedence" without naming
 * the root it takes precedence over, would satisfy one polarity on its own — so the overlay and
 * bundled cases each assert their own root, and a declaration in the writable root asserts that
 * no such line is rendered at all.
 */
describe('CategoryDiscoveryProcessor.handleInspect — which root wins after an update (P4.39)', () => {
  let workspaceDir: string;
  let primaryDir: string;
  let overlayDir: string;
  let bundledDir: string;

  /** `{root}/{id}/category.yaml` — the only layout the walk recognizes as a declaration. */
  function declareIn(root: string, id: string): void {
    mkdirSync(join(root, id), { recursive: true });
    writeFileSync(join(root, id, 'category.yaml'), `id: ${id}\nname: Declared ${id}\n`);
  }

  /**
   * A processor over a three-root tree.
   *
   * The stub is the whole point of the fixture: `collectViews` asks the config manager for the
   * bundled root and the overlay list and builds its order from those two answers plus the
   * primary, so a stub that returned nothing (the suite above) can never reach either branch.
   */
  function processorOverRoots(overlays: string[], bundled: string | undefined) {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    const configManager = {
      getResolvedPromptsDirectory: () => primaryDir,
      getBundledResourceDirectory: () => bundled,
      getOverlayResourceDirectories: () => overlays,
    } as unknown as ConfigManager;
    return new CategoryDiscoveryProcessor({
      logger,
      configManager,
    } as unknown as CategoryResourceContext);
  }

  async function inspectWith(processor: CategoryDiscoveryProcessor, id: string): Promise<string> {
    const result = await processor.handleInspect({ action: 'inspect', id });
    return (result.content[0] as { text: string }).text;
  }

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'cpm-category-rank-'));
    primaryDir = join(workspaceDir, 'resources', 'prompts');
    overlayDir = join(workspaceDir, 'prompts');
    bundledDir = join(workspaceDir, 'package', 'resources', 'prompts');
    for (const dir of [primaryDir, overlayDir, bundledDir]) mkdirSync(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it('FALSIFIER — a declaration in an overlay IS displaced by writing the primary, and the overlay is named', async () => {
    declareIn(overlayDir, 'analysis');
    const text = await inspectWith(processorOverRoots([overlayDir], bundledDir), 'analysis');

    // The root being displaced is named, and the write is described as taking over from it.
    expect(text).toContain(`Source Root: ${overlayDir}`);
    expect(text).toContain(`which takes precedence over ${overlayDir}`);
    expect(text).toContain("'analysis' would then be declared from your copy");
    // The claim the old order made true, in the branch that made it.
    expect(text).not.toContain('outranks that root');
    expect(text).not.toContain('would still be declared');
  });

  it('POSITIVE CONTROL — a declaration in the bundled tree IS displaced, and says so', async () => {
    declareIn(bundledDir, 'examples');
    const text = await inspectWith(processorOverRoots([overlayDir], bundledDir), 'examples');

    // The opposite verdict for the opposite rank — without this the case above is satisfied by a
    // renderer that calls every foreign root an outranking one.
    expect(text).toContain(`Source Root: ${bundledDir}`);
    expect(text).toContain('takes precedence over the bundled tree');
    expect(text).toContain("'examples' would then be declared from your copy");
    expect(text).not.toContain(`takes precedence over ${overlayDir}`);
    expect(text).not.toContain('outranks that root');
  });

  it('POSITIVE CONTROL — a declaration in the writable root renders no rank line at all', async () => {
    declareIn(primaryDir, 'local');
    const text = await inspectWith(processorOverRoots([overlayDir], bundledDir), 'local');

    // The branch is entered only for a FOREIGN declaring root, so an ordinary category is
    // unchanged by this row — and the two assertions above are not passing on a line the
    // renderer emits unconditionally.
    expect(text).toContain('Declared local');
    expect(text).not.toContain('Source Root:');
    expect(text).not.toContain('outranks');
    expect(text).not.toContain('takes precedence');
  });

  it('the LAST declaring root wins, so a primary declaration beats an overlay declaration of the same id', async () => {
    // The walk's own contract, asserted because the rank label is only meaningful if it names the
    // root that actually won. Both roots declare; the primary is walked last.
    declareIn(primaryDir, 'shared');
    declareIn(overlayDir, 'shared');
    const text = await inspectWith(processorOverRoots([overlayDir], bundledDir), 'shared');

    expect(text).toContain(`Declaration: ${join(primaryDir, 'shared', 'category.yaml')}`);
    // The winner is the writable root, so no foreign-root rank line is rendered.
    expect(text).not.toContain('Source Root:');
    expect(text).not.toContain(overlayDir + '/shared/category.yaml');
  });
});
