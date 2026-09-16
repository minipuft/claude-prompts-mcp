/**
 * P4.7 — `CategoryFileWriter` is the writer `category.yaml` never had.
 *
 * The row's falsifier is one sentence — *a tool call writes a `category.yaml`* — and the first
 * case here is it. The rest cover the three properties the write has to carry that the falsifier
 * does not mention:
 *
 *  - VALIDATION ON WRITE, because nothing validates on load. `loader.ts` casts the parsed YAML
 *    with `as Partial<Category>`, so an invalid document is not rejected anywhere else and the
 *    transaction's rollback is the only thing standing between a bad payload and a file the
 *    loader will quietly mis-read forever.
 *  - PRESERVATION, so an update that omits a field does not strip it back to a loader default —
 *    the class already fixed for prompts (`PRESERVED_PROMPT_YAML_KEYS`) and gates.
 *  - THE DIRECTORY IS NOT THE RESOURCE. A category directory holds every prompt in the category.
 *    This writer targets the FILE in its mutation transaction, unlike its gate and framework
 *    siblings which target their directory, and a regression there would snapshot and restore
 *    unrelated prompts on a metadata edit.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CategoryFileWriter } from '../../../../src/mcp/tools/category-manager/services/category-file-writer.js';

import type { ConfigManager, Logger } from '../../../../src/shared/types/index.js';

describe('CategoryFileWriter', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let logger: Logger;
  let configManager: ConfigManager;
  let writer: CategoryFileWriter;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'cpm-category-file-'));
    promptsDir = join(workspaceDir, 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    configManager = {
      getResolvedPromptsDirectory: () => promptsDir,
      // No bundled tree in this fixture: the stub answers "no distinct bundled source".
      getBundledResourceDirectory: () => undefined,
      getOverlayResourceDirectories: () => [],
    } as unknown as ConfigManager;
    writer = new CategoryFileWriter({ logger, configManager });
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it('writes a category.yaml carrying every declared field', async () => {
    const result = await writer.writeCategoryFiles({
      id: 'analysis',
      name: 'Analysis',
      description: 'Analytical prompts',
      registerWithMcp: false,
      mcpPromptMode: 'launch',
    });

    expect(result.success).toBe(true);
    const yamlPath = join(promptsDir, 'analysis', 'category.yaml');
    expect(result.paths).toEqual([yamlPath]);

    const written = readFileSync(yamlPath, 'utf8');
    expect(written).toContain('id: analysis');
    expect(written).toContain('name: Analysis');
    expect(written).toContain('description: Analytical prompts');
    expect(written).toContain('registerWithMcp: false');
    expect(written).toContain('mcpPromptMode: launch');
  });

  it('omits an unsupplied optional key rather than writing a default for it', async () => {
    await writer.writeCategoryFiles({
      id: 'analysis',
      name: 'Analysis',
      description: 'Analytical prompts',
    });

    const written = readFileSync(join(promptsDir, 'analysis', 'category.yaml'), 'utf8');
    // The positive control for the case above, and the property `inspect` depends on: a file
    // that declares nothing must stay silent, or "authored" and "defaulted" become the same
    // state on disk and no reader can ever separate them again.
    expect(written).not.toContain('registerWithMcp');
    expect(written).not.toContain('mcpPromptMode');
  });

  it('carries an omitted optional key forward from the file on disk', async () => {
    await writer.writeCategoryFiles({
      id: 'analysis',
      name: 'Analysis',
      description: 'Analytical prompts',
      mcpPromptMode: 'launch',
    });

    const result = await writer.writeCategoryFiles({
      id: 'analysis',
      name: 'Renamed Analysis',
      description: 'Analytical prompts',
    });

    expect(result.success).toBe(true);
    const written = readFileSync(join(promptsDir, 'analysis', 'category.yaml'), 'utf8');
    // MUTATION KILLED: deleting the `Object.assign(yamlData, resolvePreservedCategoryYamlFields(
    // ...))` call from `buildCategoryYaml` turns 3 of these 8 cases red — this one, 'lets a
    // supplied value win', and 'writes a category.yaml carrying every declared field'. Confirmed
    // by removing it, re-running this file, and reverting. It reaches all three because
    // preservation is how BOTH optional keys reach the document, supplied or not.
    expect(written).toContain('mcpPromptMode: launch');
    expect(written).toContain('name: Renamed Analysis');
  });

  it('lets a supplied value win over the value on disk', async () => {
    await writer.writeCategoryFiles({
      id: 'analysis',
      name: 'Analysis',
      description: 'Analytical prompts',
      mcpPromptMode: 'launch',
    });

    await writer.writeCategoryFiles({
      id: 'analysis',
      name: 'Analysis',
      description: 'Analytical prompts',
      mcpPromptMode: 'expand',
    });

    // The other half of preservation. Without this, "carries forward" and "ignores the caller"
    // are indistinguishable, and the case above would pass for a writer that never wrote the key
    // at all.
    expect(readFileSync(join(promptsDir, 'analysis', 'category.yaml'), 'utf8')).toContain(
      'mcpPromptMode: expand'
    );
  });

  it('rolls back an invalid document and removes the directory it created', async () => {
    const result = await writer.writeCategoryFiles({
      id: 'analysis',
      name: 'Analysis',
      description: '',
    });

    expect(result.success).toBe(false);
    expect(result.verificationFailure?.resourceType).toBe('categories');
    expect(result.verificationFailure?.resourceId).toBe('analysis');
    expect(result.verificationFailure?.rolledBack).toBe(true);
    // MUTATION KILLED: dropping the `validate:` property from the transaction options turns this
    // case and 'leaves a pre-existing directory in place when a write fails' red — the empty
    // description is written and reported as a success in both. Confirmed by removing the line,
    // re-running this file, and reverting.
    expect(existsSync(join(promptsDir, 'analysis', 'category.yaml'))).toBe(false);
    // The directory too: `ResourceMutationTransaction` restores the FILE target and knows nothing
    // about the directory `mutate` created, so without the writer's own cleanup a failed create
    // leaves an empty directory that the loader reads as a real, empty category.
    expect(existsSync(join(promptsDir, 'analysis'))).toBe(false);
  });

  it('leaves a pre-existing directory in place when a write fails', async () => {
    const categoryDir = join(promptsDir, 'analysis');
    mkdirSync(join(categoryDir, 'existing_prompt'), { recursive: true });
    writeFileSync(join(categoryDir, 'existing_prompt', 'prompt.yaml'), 'id: existing_prompt\n');

    const result = await writer.writeCategoryFiles({
      id: 'analysis',
      name: 'Analysis',
      description: '',
    });

    expect(result.success).toBe(false);
    // The directory was NOT created by this call, so the cleanup must not touch it — and the
    // prompt inside it proves the rollback never reached the subtree.
    expect(existsSync(join(categoryDir, 'existing_prompt', 'prompt.yaml'))).toBe(true);
  });

  it('leaves every sibling prompt byte-identical across a successful write', async () => {
    const categoryDir = join(promptsDir, 'analysis');
    const siblingPath = join(categoryDir, 'existing_prompt', 'prompt.yaml');
    mkdirSync(join(categoryDir, 'existing_prompt'), { recursive: true });
    writeFileSync(siblingPath, 'id: existing_prompt\nname: Existing\n');

    await writer.writeCategoryFiles({
      id: 'analysis',
      name: 'Analysis',
      description: 'Analytical prompts',
    });

    // The transaction targets the FILE, not the directory. Targeting the directory would copy
    // and restore this prompt on every metadata edit — the reason the writer differs from its
    // gate and framework siblings here.
    expect(readFileSync(siblingPath, 'utf8')).toBe('id: existing_prompt\nname: Existing\n');
  });

  it('refuses an id that resolves outside the prompts root and writes nothing', async () => {
    const result = await writer.writeCategoryFiles({
      id: '../escaped_category',
      name: 'Escaped',
      description: 'Should never be written',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Refusing to write outside the resource root');
    // MUTATION KILLED: replacing `resolveContainedPath` with a plain `path.join` in
    // `categoryDir()` makes this the ONLY red case in the file — the write succeeds and the file
    // lands beside the prompts root. Confirmed by swapping it, re-running this file, and
    // reverting.
    expect(existsSync(join(workspaceDir, 'escaped_category'))).toBe(false);
  });
});
