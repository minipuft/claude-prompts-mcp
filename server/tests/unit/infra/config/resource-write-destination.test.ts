/**
 * Where resource WRITES land (T1.1, T1.9 / D7, D8 Arc 1).
 *
 * `getResolvedPromptsDirectory()` is the destination every prompt mutation resolves through
 * (`file-operations.ts:248,452`). It used to resolve against the config file alone while READS
 * resolved through `PathResolver`'s full chain (`MCP_RESOURCES_PATH` -> `MCP_WORKSPACE` ->
 * package default). Setting `MCP_RESOURCES_PATH` therefore moved every read and no write:
 * prompts were served from the override while edits landed back in the package's own
 * `resources/prompts`.
 *
 * It failed silently, and worse than silently on this repo's own machine — the shipped
 * `config.prompts.directory` names the same path the default resolution produces, so the two
 * agreed by coincidence and the divergence only appears once someone overrides the resources root.
 *
 * These tests pin the delegation and its fallback. `tsc` cannot see either: both branches return
 * `string` and differ only in which string.
 */

import { describe, expect, it } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { ConfigLoader, type ResourcePathSource } from '../../../../src/infra/config/index.js';

/** A resolver whose every member returns a path far from any config directory. */
function resolverAt(root: string): ResourcePathSource {
  return {
    getPromptsPath: () => path.join(root, 'prompts'),
    getGatesPath: () => path.join(root, 'gates'),
    getFrameworksPath: () => path.join(root, 'frameworks'),
  };
}

async function loaderWith(resourcePaths?: ResourcePathSource) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfg-write-dest-'));
  const configPath = path.join(dir, 'config.json');
  await writeFile(
    configPath,
    JSON.stringify({ prompts: { directory: 'resources/prompts' } }),
    'utf8'
  );
  const manager = new ConfigLoader(configPath, resourcePaths);
  await manager.loadConfig();
  return { manager, dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe('prompt write destination', () => {
  it('resolves through the injected path source, so writes follow reads', async () => {
    const { manager, dir, cleanup } = await loaderWith(resolverAt('/somewhere/else/resources'));
    const overrideRoot = '/somewhere/else/resources/prompts';

    try {
      const resolved = manager.getResolvedPromptsDirectory();

      expect(resolved).toBe(overrideRoot);
      // The assertion that actually encodes the bug: the destination must NOT have been derived
      // from the config file's own directory, which is what produced the divergence.
      expect(resolved.startsWith(dir)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('falls back to the config-relative directory when constructed without a path source', async () => {
    const { manager, dir, cleanup } = await loaderWith();

    try {
      // Tests and the CLI's throwaway loader construct ConfigLoader with no resolver; their
      // behaviour is deliberately unchanged.
      expect(manager.getResolvedPromptsDirectory()).toBe(path.join(dir, 'resources/prompts'));
    } finally {
      await cleanup();
    }
  });

  it('lets an explicit override outrank the path source', async () => {
    const { manager, dir, cleanup } = await loaderWith(resolverAt('/somewhere/else/resources'));

    try {
      expect(manager.getResolvedPromptsDirectory('/explicit/target')).toBe('/explicit/target');
      // A relative override still anchors to the config directory, not to the path source.
      expect(manager.getResolvedPromptsDirectory('custom/prompts')).toBe(
        path.join(dir, 'custom/prompts')
      );
    } finally {
      await cleanup();
    }
  });

  it('resolves the gates directory through the path source too', async () => {
    const { manager, dir, cleanup } = await loaderWith(resolverAt('/somewhere/else/resources'));

    try {
      // Gates were a degree worse than prompts: `getGatesDirectory` hardcoded `resources/gates`
      // and read neither the config file nor the environment, while gate READS were already
      // overlay-merged through PathResolver (`module-initializer.ts:199`).
      expect(manager.getGatesDirectory()).toBe('/somewhere/else/resources/gates');
      expect(manager.getGatesDirectory().startsWith(dir)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('falls back to the hardcoded gates directory without a path source', async () => {
    const { manager, dir, cleanup } = await loaderWith();

    try {
      expect(manager.getGatesDirectory()).toBe(path.join(dir, 'resources', 'gates'));
    } finally {
      await cleanup();
    }
  });

  it('resolves the frameworks directory through the path source too', async () => {
    const { manager, dir, cleanup } = await loaderWith(resolverAt('/somewhere/else/resources'));

    try {
      // Frameworks were the third instance, and the one where getting it wrong is destructive:
      // `FrameworkFileWriter.deleteFramework` does `rm(frameworkDir, {recursive: true})` on
      // whatever this resolves to.
      expect(manager.getFrameworksDirectory()).toBe('/somewhere/else/resources/frameworks');
      expect(manager.getFrameworksDirectory().startsWith(dir)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('falls back to the config-relative frameworks directory without a path source', async () => {
    const { manager, dir, cleanup } = await loaderWith();

    try {
      expect(manager.getFrameworksDirectory()).toBe(path.join(dir, 'resources', 'frameworks'));
    } finally {
      await cleanup();
    }
  });
});
