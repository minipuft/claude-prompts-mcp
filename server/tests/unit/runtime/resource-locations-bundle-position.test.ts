/**
 * Where the package's own folder sits once a `paths.resources` list is in force (R3c, R3d).
 *
 * Two rules, each pinned against the loaders that serve from the list rather than against the list
 * alone:
 *
 *  - A list that leaves `"bundled"` out removes the bundle from every type's lookup, and the six
 *    shipped frameworks still load from the package — those six and no others.
 *  - A list that names `"bundled"` serves it AT THAT POSITION for every kind. Prompts merge lowest
 *    first (`loadPromptsAcrossRoots`), the flat-layout kinds look up highest first; before this
 *    the prompt merge took the bundle first whatever the list said, so a list naming `"bundled"`
 *    ahead of a folder still let that folder's prompt win.
 *
 * The config list goes through a real `ConfigLoader`, the folders are real directories, and the
 * prompt loader's only stand-in is the per-root read, which reports the root a marker came from.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { RuntimeFrameworkLoader } from '../../../src/engine/frameworks/definitions/runtime-framework-loader.js';
import { SHIPPED_FRAMEWORK_IDS } from '../../../src/engine/frameworks/definitions/shipped-frameworks.js';
import { ConfigLoader } from '../../../src/infra/config/index.js';
import {
  loadPromptsAcrossRoots,
  mergePromptResults,
} from '../../../src/modules/prompts/prompt-root-loader.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import { indexerResourceRoots, resolveResourceRoots } from '../../../src/runtime/resource-roots.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { PromptAssetManager } from '../../../src/modules/prompts/index.js';
import type { Category, PromptData } from '../../../src/modules/prompts/types.js';
import { isolateResourceLocations } from '../../helpers/resource-locations.js';

const locations = isolateResourceLocations();

/** The package's real frameworks folder: the six shipped definitions, valid by construction. */
const REAL_FRAMEWORKS = path.resolve(process.cwd(), 'resources', 'frameworks');

let dir: string;
let packageRoot: string;
let configDir: string;
let custom: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bundle-position-'));
  packageRoot = path.join(dir, 'package');
  configDir = path.join(dir, 'cfg');
  custom = path.join(configDir, 'custom');
  for (const type of ['prompts', 'gates', 'styles']) {
    mkdirSync(path.join(packageRoot, 'resources', type), { recursive: true });
    mkdirSync(path.join(custom, type), { recursive: true });
  }
  // A custom, empty workspace: the profile's own folder is distinct from the package's and absent.
  locations.set({ workspace: path.join(dir, 'workspace') });
  mkdirSync(path.join(dir, 'workspace'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A resolver reading `list` as `paths.resources`, resolved against `configDir`. */
async function resolverWith(list: string[]): Promise<PathResolver> {
  const configPath = path.join(configDir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ version: 5, paths: { resources: list } }));
  const loader = new ConfigLoader(configPath);
  await loader.loadConfig();
  const resolver = new PathResolver({ cli: {}, packageRoot });
  resolver.readResourceLocationsFrom(() => loader.getConfig().paths);
  return resolver;
}

const bundledOf = (type: string): string => path.join(packageRoot, 'resources', type);

describe('a paths.resources list without "bundled" serves only the listed locations', () => {
  it.each(['prompts', 'gates', 'styles'])(
    'gives %s a lookup order with no bundled folder in it, and no bundled root',
    async (type) => {
      const resolver = await resolverWith(['./custom']);
      const roots = resolveResourceRoots(
        resolver,
        type,
        resolver.getResourceLocations(type).writeRoot
      );

      expect(resolver.getResourceLocations(type).bundledImplicit).toBe(true);
      expect(roots.lookupDirs).toContain(path.join(custom, type));
      expect(roots.lookupDirs).not.toContain(bundledOf(type));
      expect(roots.overlays).not.toContain(bundledOf(type));
      expect(roots.bundled).toBeUndefined();
    }
  );

  it('keeps the bundle out of the resource index and the reload overlay list too', async () => {
    const resolver = await resolverWith(['./custom']);
    const index = indexerResourceRoots(resolver);

    for (const [type, dirName] of [
      ['prompt', 'prompts'],
      ['gate', 'gates'],
      ['style', 'styles'],
    ] as const) {
      expect(index[type]).not.toContain(bundledOf(dirName));
    }
    expect(resolver.getOverlayResourceDirs('prompts', resolver.getPromptsPath())).toEqual([
      path.join(custom, 'prompts'),
    ]);
  });
});

describe('a paths.resources list naming "bundled" serves it at its position', () => {
  it('puts the bundle last when "bundled" is listed last', async () => {
    const resolver = await resolverWith(['./custom', 'bundled']);
    const roots = resolveResourceRoots(resolver, 'gates', resolver.getGatesPath());

    expect(roots.lookupDirs.at(-1)).toBe(bundledOf('gates'));
    expect(roots.bundled).toBe(bundledOf('gates'));
  });

  it('puts the bundle ahead of the custom folder when "bundled" is listed first', async () => {
    const resolver = await resolverWith(['bundled', './custom']);
    const { lookupDirs } = resolveResourceRoots(resolver, 'gates', resolver.getGatesPath());

    // The profile's own folders always outrank the list; among the listed entries, list order.
    const listed = lookupDirs.filter(
      (entry) => entry === bundledOf('gates') || entry === path.join(custom, 'gates')
    );
    expect(listed).toEqual([bundledOf('gates'), path.join(custom, 'gates')]);
  });

  describe('a same-id prompt in the bundle and the custom folder', () => {
    beforeEach(() => {
      writeFileSync(path.join(bundledOf('prompts'), 'marker'), 'bundled');
      writeFileSync(path.join(custom, 'prompts', 'marker'), 'custom');
    });

    /** One prompt, `shared/same`, whose description names the root it was read from. */
    const markerReader = {
      async loadAndConvertPrompts(root: string) {
        let marker: string;
        try {
          marker = readFileSync(path.join(root, 'marker'), 'utf8');
        } catch {
          return { promptsData: [], categories: [], convertedPrompts: [], invalid: 0 };
        }
        const promptsData = [{ id: 'same', category: 'shared', description: marker }];
        const categories = [{ id: 'shared', name: 'Shared', description: marker }];
        const convertedPrompts = [{ id: 'same', category: 'shared', description: marker }];
        return {
          promptsData: promptsData as unknown as PromptData[],
          categories: categories as unknown as Category[],
          convertedPrompts: convertedPrompts as unknown as ConvertedPrompt[],
          invalid: 0,
        };
      },
    } as unknown as PromptAssetManager;

    const servedBy = async (list: string[]): Promise<string | undefined> => {
      const resolver = await resolverWith(list);
      const primary = resolver.getPromptsPath();
      const loaded = await loadPromptsAcrossRoots(
        markerReader,
        {
          primary,
          basePath: primary,
          bundled: resolver.getBundledResourceDir('prompts'),
          overlays: resolver.getOverlayResourceDirs('prompts', primary),
        },
        mergePromptResults
      );
      return loaded.convertedPrompts.find((prompt) => prompt.id === 'same')?.description;
    };

    it('resolves to the bundled copy when "bundled" is listed first', async () => {
      expect(await servedBy(['bundled', './custom'])).toBe('bundled');
    });

    it('CONTROL: resolves to the custom copy when the two are swapped', async () => {
      expect(await servedBy(['./custom', 'bundled'])).toBe('custom');
    });

    it('serves no bundled copy at all when the list leaves "bundled" out', async () => {
      // Only the bundle holds the prompt now, and the list does not name it.
      rmSync(path.join(custom, 'prompts', 'marker'));
      expect(await servedBy(['./custom'])).toBeUndefined();
    });
  });
});

describe('the shipped frameworks load from the package when the list leaves "bundled" out', () => {
  beforeEach(() => {
    const frameworks = bundledOf('frameworks');
    cpSync(REAL_FRAMEWORKS, frameworks, { recursive: true });
    // A seventh framework in the bundle: on disk, valid, and not one of the six.
    cpSync(path.join(frameworks, 'focus'), path.join(frameworks, 'seventh'), { recursive: true });
    const yamlPath = path.join(frameworks, 'seventh', 'framework.yaml');
    writeFileSync(
      yamlPath,
      readFileSync(yamlPath, 'utf8')
        .replace(/^id: focus$/m, 'id: seventh')
        .replace(/^name: .*$/m, 'name: Seventh')
    );
  });

  /** The framework loader exactly as the composition root configures it (`initializeModules`). */
  async function frameworkLoaderFor(list: string[]): Promise<RuntimeFrameworkLoader> {
    const resolver = await resolverWith(list);
    const roots = resolveResourceRoots(resolver, 'frameworks', resolver.getFrameworksPath());
    return new RuntimeFrameworkLoader({
      frameworksDir: roots.primary as string,
      additionalFrameworksDirs: roots.lookupDirs,
      shippedFrameworksDir: resolver.getBundledResourceDir('frameworks'),
    });
  }

  it('serves the six, and not the seventh bundled framework', async () => {
    const loader = await frameworkLoaderFor(['./custom']);

    expect(loader.discoverFrameworks()).toEqual([...SHIPPED_FRAMEWORK_IDS].sort());
    for (const id of SHIPPED_FRAMEWORK_IDS) {
      expect(loader.loadFramework(id)?.id.toLowerCase()).toBe(id);
    }
    expect(loader.loadFramework('seventh')).toBeUndefined();
  });

  it('CONTROL: serves the seventh too once the list names "bundled"', async () => {
    const loader = await frameworkLoaderFor(['./custom', 'bundled']);

    expect(loader.discoverFrameworks()).toContain('seventh');
    expect(loader.loadFramework('seventh')?.name).toBe('Seventh');
  });
});
