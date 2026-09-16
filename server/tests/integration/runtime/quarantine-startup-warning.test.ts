// @lifecycle test - Integration test for the startup quarantine warning naming the serving root (P4.23)
/**
 * THE ROW'S FALSIFIER.
 *
 * > the warning for a shadowed prompt names the serving root by path, and an unshadowed
 * > quarantined prompt carries no serving-root clause.
 *
 * The startup line said `(another root is serving this id — your edit is not live)`. Which root is
 * the fact that decides what the operator does next: repairing a workspace file that shadows a
 * BUNDLED prompt changes what serves, and repairing one that shadows nothing simply restores a
 * prompt nobody currently has. The answer was already in scope — the prompt loader stamps
 * `sourceRoot` on every converted prompt on the pass that loaded it — and the warning re-derived
 * shadowing from a bare `Set` of served ids instead, which cannot carry a root.
 *
 * Integration, with a REAL `PathResolver` over two real trees. The defect is about which root
 * answered, so a stubbed resolver handing back invented directory names would be asserting the
 * fixture rather than the composition — and `loadPromptData` reads the resolver for the primary
 * root, the bundled root, the overlays, and the skills-sync paths, so a narrow double would have
 * to guess at four surfaces (the mock-integrity failure `hot-reload-root-parity` records).
 *
 * Classification: Integration (real filesystem, real `PromptAssetManager`, real `PathResolver`;
 * only `ConfigManager` is stubbed, and only for the one field the log line reads).
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ConversationStore } from '../../../src/modules/text-refs/conversation.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';
import { PromptAssetManager } from '../../../src/modules/prompts/index.js';
import { loadPromptData } from '../../../src/runtime/data-loader.js';
import { PathResolver } from '../../../src/runtime/paths.js';

import type { ConfigLoader } from '../../../src/infra/config/index.js';
import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';
import type { RuntimeLaunchOptions } from '../../../src/runtime/options.js';

const warnings: string[] = [];

const logger: Logger = {
  info: () => {},
  warn: (message: string) => {
    warnings.push(message);
  },
  error: () => {},
  debug: () => {},
} as unknown as Logger;

/** A prompt that loads cleanly. */
const validPrompt = (id: string, body: string): string =>
  [
    `id: ${id}`,
    `name: ${id} prompt`,
    'category: general',
    `description: ${body}`,
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

/** Declared `id` disagrees with the directory name — valid YAML, refused by the loader. */
const refusedPrompt = (dirName: string): string =>
  [
    `id: ${dirName}_mismatched`,
    `name: ${dirName} prompt`,
    'category: general',
    'description: A prompt whose declared id does not match its directory.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

async function writePrompt(promptsRoot: string, id: string, body: string): Promise<void> {
  const dir = path.join(promptsRoot, 'general', id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'prompt.yaml'), body, 'utf8');
}

/**
 * The one accessor the startup log reads, plus the registration switch `PromptAssetManager` reads
 * in its constructor. `PathResolver` answers every path question, which is the point of the test.
 */
const configStub = {
  getConfig: () => ({ prompts: { directory: 'resources/prompts' } }),
  getPromptsRegisterWithMcp: () => false,
} as unknown as ConfigLoader & ConfigManager;

/**
 * Path settings this test must not inherit from whoever is running it.
 *
 * `PathResolver` reads the environment before it reads its `cli` options, and a developer shell
 * here commonly exports `MCP_RESOURCES_PATH` at a personal prompt library — measured while writing
 * this file: the fixture control below reported 90-odd ids from that library instead of the two
 * written above. Clearing them is not tidiness; without it the test asserts against a tree it did
 * not create, and passes or fails by whose machine it is.
 */
const INHERITED_PATH_SETTINGS = [
  'MCP_RESOURCES_PATH',
  'MCP_WORKSPACE',
  'MCP_RUNTIME_ROOT',
  'MCP_CONFIG_PATH',
] as const;

describe('the startup quarantine warning names the root that is answering (P4.23)', () => {
  const inherited = new Map<string, string | undefined>();
  let tmp: string;
  let packageRoot: string;
  let workspace: string;
  let bundledPrompts: string;
  let workspacePrompts: string;
  let promptManager: PromptAssetManager;
  let pathResolver: PathResolver;

  beforeEach(async () => {
    warnings.length = 0;
    for (const name of INHERITED_PATH_SETTINGS) {
      inherited.set(name, process.env[name]);
      delete process.env[name];
    }
    tmp = await mkdtemp(path.join(tmpdir(), 'quarantine-startup-warning-'));
    packageRoot = path.join(tmp, 'package');
    workspace = path.join(tmp, 'workspace');
    bundledPrompts = path.join(packageRoot, 'resources', 'prompts');
    workspacePrompts = path.join(workspace, 'resources', 'prompts');

    // `shadowed` exists in BOTH roots and the workspace copy is broken: the bundled definition
    // keeps serving, and the operator's edit is inert. `orphan` is broken in the workspace and
    // exists nowhere else, so nothing serves that id at all. The two lines must read differently.
    await writePrompt(bundledPrompts, 'shadowed', validPrompt('shadowed', 'the bundled copy'));
    await writePrompt(bundledPrompts, 'untouched', validPrompt('untouched', 'never edited'));
    await writePrompt(workspacePrompts, 'shadowed', refusedPrompt('shadowed'));
    await writePrompt(workspacePrompts, 'orphan', refusedPrompt('orphan'));

    pathResolver = new PathResolver({ cli: { workspace }, packageRoot });
    promptManager = new PromptAssetManager(
      logger,
      new TextReferenceStore(logger),
      new ConversationStore(logger),
      configStub
    );
  });

  afterEach(async () => {
    for (const [name, value] of inherited) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    inherited.clear();
    if (tmp) await rm(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  const load = async (): Promise<string[]> => {
    const result = await loadPromptData({
      logger,
      configManager: configStub,
      promptManager,
      runtimeOptions: { quiet: true, verbose: false } as unknown as RuntimeLaunchOptions,
      pathResolver,
      serverRoot: packageRoot,
    });
    // Fixture control: the two roots really did compose, and the bundled `shadowed` really is what
    // serves. Without this, both assertions below could be measuring a server that loaded nothing.
    expect(result.convertedPrompts.map((prompt) => prompt.id).sort()).toEqual([
      'shadowed',
      'untouched',
    ]);
    return warnings.filter((line) => line.includes('quarantined prompt'));
  };

  it('names the serving root by path for a shadowed prompt', async () => {
    const lines = await load();
    const shadowedLine = lines.find((line) => line.includes("'shadowed'"));

    expect(shadowedLine).toBeDefined();
    expect(shadowedLine).toContain(
      path.join(workspacePrompts, 'general', 'shadowed', 'prompt.yaml')
    );
    // The path, not the bare fact. `bundledPrompts` is a different directory from the refused
    // file's root, so this fails if the line names the root the broken file is in.
    expect(shadowedLine).toContain(`served from ${bundledPrompts}`);
    expect(shadowedLine).not.toContain('another root is serving this id');
  });

  it('gives an unshadowed quarantined prompt no serving-root clause', async () => {
    const lines = await load();
    const orphanLine = lines.find((line) => line.includes("'orphan'"));

    // The discriminating control. A renderer that appended a serving-root clause to every record
    // would satisfy the case above on its own; nothing serves `orphan`, so it must carry none.
    expect(orphanLine).toBeDefined();
    expect(orphanLine).not.toContain('served from');
    expect(orphanLine).not.toContain('your edit is not live');
    // …while still saying the two things it always said: the file, and why it was refused.
    expect(orphanLine).toContain(path.join(workspacePrompts, 'general', 'orphan', 'prompt.yaml'));
    expect(orphanLine).toContain('orphan_mismatched');
  });
});
