// @lifecycle test - Runs the resource file-set enumerator over the whole bundled catalog (row O.1)
/**
 * The enumeration that closes the class, run against the real catalog.
 *
 * The unit test beside this one asserts the RULES on hand-built fixtures; a fixture only ever
 * contains what its author thought of. This file runs the same enumerator over every resource this
 * package ships and asks the two questions a fixture cannot:
 *
 *   1. Does any real resource make it THROW? (a containment refusal firing on shipped content
 *      would break a checkpoint of the catalog itself)
 *   2. Which files under a resource's own directory does it NOT claim? Every one of those is
 *      either a stray — correctly excluded — or a rule this module is missing, and the difference
 *      cannot be settled by reading the enumerator. So the list is PINNED: a new unclaimed file
 *      fails this test and has to be classified deliberately.
 *
 * And it asserts symmetry in the direction that matters — every file the real LOADER reads for a
 * resource is in the set — by comparing the loader's own inlined output against the contents of
 * the enumerated files. That is an independent derivation: the loader answers from its own joins,
 * not from this module's rules, so a rule that named the wrong file produces a content mismatch
 * rather than an agreeing pair.
 *
 * Classification: Unit. Reads `server/resources/**` and nothing else; writes nothing.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import {
  isExcludedCategoryDirectoryName,
  isIgnoredPromptEntryName,
  isReservedPromptDirectoryName,
  isSingleFilePromptName,
} from '../../../src/shared/utils/prompt-layout.js';
import { resourceFileSet } from '../../../src/shared/utils/resource-file-set.js';
import { parseYamlOrThrow } from '../../../src/shared/utils/yaml/yaml-parser.js';

import type { ResourceType } from '../../../src/modules/versioning/types.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RESOURCES = path.join(SERVER_ROOT, 'resources');
const PROMPTS = path.join(RESOURCES, 'prompts');
const GATES = path.join(RESOURCES, 'gates');
const FRAMEWORKS = path.join(RESOURCES, 'frameworks');

/**
 * Bundled files under a resource TREE that no resource of that tree claims.
 *
 * Measured 2026-09-20 on `origin/main` f711401b. Each entry is a decision, not an observation:
 *
 * - `gates/_index.md` and `gates/config/*.yaml` sit at the gates ROOT, beside the gate
 *   directories rather than inside one. They are catalog-level files (`verdict-patterns.yaml` is
 *   read by the verdict parser, `shell-presets.yaml` by the shell allowlist), owned by the
 *   package, and no gate can checkpoint them because no gate contains them.
 * `gates/handoff-artifacts/check-artifacts.js` used to be a fourth entry: the gate named it
 * relative to the SERVER's working directory, which no containment-preserving rule can reach from
 * the gate's own directory. P4.105 moved the reference into the gate root, where it is an ordinary
 * declared reference — so the script is claimed now, and this list is one shorter.
 */
const EXPECTED_UNCLAIMED = [
  'gates/_index.md',
  'gates/config/shell-presets.yaml',
  'gates/config/verdict-patterns.yaml',
];

interface BundledResource {
  resourceType: ResourceType;
  entryPath: string;
}

/** Every file beneath `dir`, as paths relative to `RESOURCES`, POSIX-separated. */
async function walkFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      found.push(path.relative(RESOURCES, full).split(path.sep).join('/'));
    }
  }
  return found;
}

/** Every prompt and category the bundled prompts tree declares, at every depth. */
async function discoverPromptTree(
  dir: string,
  atCategoryRoot: boolean
): Promise<BundledResource[]> {
  const found: BundledResource[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (isIgnoredPromptEntryName(entry.name)) continue;
    if (atCategoryRoot && isExcludedCategoryDirectoryName(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isReservedPromptDirectoryName(entry.name)) continue;
      if (await exists(path.join(full, 'prompt.yaml'))) {
        found.push({ resourceType: 'prompt', entryPath: path.join(full, 'prompt.yaml') });
      }
      found.push(...(await discoverPromptTree(full, false)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === 'category.yaml') {
      found.push({ resourceType: 'category', entryPath: full });
    } else if (!atCategoryRoot && isSingleFilePromptName(entry.name)) {
      found.push({ resourceType: 'prompt', entryPath: full });
    }
  }
  return found;
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Every `{root}/{id}/{entry}` resource of one flat-layout tree. */
async function discoverFlatTree(
  root: string,
  resourceType: ResourceType,
  entryFile: string
): Promise<BundledResource[]> {
  const found: BundledResource[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name, entryFile);
    if (await exists(candidate)) found.push({ resourceType, entryPath: candidate });
  }
  return found;
}

async function discoverBundledResources(): Promise<BundledResource[]> {
  return [
    ...(await discoverPromptTree(PROMPTS, true)),
    ...(await discoverFlatTree(GATES, 'gate', 'gate.yaml')),
    ...(await discoverFlatTree(FRAMEWORKS, 'framework', 'framework.yaml')),
  ];
}

describe('resourceFileSet over the bundled catalog', () => {
  it('enumerates every bundled resource without throwing', async () => {
    const resources = await discoverBundledResources();
    // A positive control for the walk itself: an empty discovery would make every assertion below
    // vacuous, and "zero throws" is exactly the claim an empty list satisfies fraudulently.
    expect(resources.length).toBeGreaterThan(80);

    for (const resource of resources) {
      const set = await resourceFileSet(resource);
      expect(set.files.length).toBeGreaterThan(0);
      expect(set.files[0]?.absolutePath).toBe(resource.entryPath);
      for (const file of set.files) {
        expect(path.isAbsolute(file.absolutePath)).toBe(true);
        expect(file.relativePath).not.toContain('\\');
        expect(file.relativePath.startsWith('..')).toBe(false);
        expect(file.size).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('claims every bundled file except the four that are deliberately outside a resource', async () => {
    const resources = await discoverBundledResources();
    const claimed = new Set<string>();
    for (const resource of resources) {
      const set = await resourceFileSet(resource);
      for (const file of set.files) {
        claimed.add(path.relative(RESOURCES, file.absolutePath).split(path.sep).join('/'));
      }
    }

    const onDisk = [
      ...(await walkFiles(PROMPTS)),
      ...(await walkFiles(GATES)),
      ...(await walkFiles(FRAMEWORKS)),
    ];
    const unclaimed = onDisk.filter((file) => !claimed.has(file)).sort();

    expect(unclaimed).toEqual(EXPECTED_UNCLAIMED);
    // The other half of the same measurement: the claimed set is most of the tree, so a rule that
    // collapsed to "entry files only" would still satisfy the list above and fail here.
    expect(claimed.size).toBeGreaterThan(onDisk.length - EXPECTED_UNCLAIMED.length - 1);
  });

  it('enumerates the guidance file every bundled gate loader actually inlines', async () => {
    const loader = new GateDefinitionLoader({ gatesDir: GATES });
    const gates = await discoverFlatTree(GATES, 'gate', 'gate.yaml');
    expect(gates.length).toBeGreaterThan(20);

    let compared = 0;
    for (const gate of gates) {
      const id = path.basename(path.dirname(gate.entryPath));
      const loaded = loader.loadGate(id);
      const guidance = loaded?.guidance;
      if (typeof guidance !== 'string' || guidance.length === 0) continue;

      // The loader inlined SOME file. Assert that file is one this enumerator claims, by content:
      // the loader resolved its own join, so agreeing here is not this module agreeing with itself.
      const set = await resourceFileSet(gate);
      const contents = await Promise.all(
        set.files.map(async (file) => (await readFile(file.absolutePath, 'utf8')).trim())
      );
      expect(contents).toContain(guidance.trim());
      compared += 1;
    }
    // Without this, a loader returning `undefined` for every gate would skip every comparison and
    // the test would pass having asserted nothing.
    expect(compared).toBe(gates.length);
  });

  it('enumerates the phases file every bundled framework inlines', async () => {
    const frameworks = await discoverFlatTree(FRAMEWORKS, 'framework', 'framework.yaml');
    expect(frameworks.length).toBeGreaterThan(5);

    let compared = 0;
    for (const framework of frameworks) {
      const entry = parseYamlOrThrow<Record<string, unknown>>(
        await readFile(framework.entryPath, 'utf8')
      );
      const declared = entry['phasesFile'];
      if (typeof declared !== 'string') continue;
      const set = await resourceFileSet(framework);
      expect(set.files.map((file) => file.relativePath)).toContain(declared);
      compared += 1;
    }
    expect(compared).toBe(frameworks.length);
  });

  it('enumerates the message files every bundled prompt declares', async () => {
    const prompts = (await discoverPromptTree(PROMPTS, true)).filter(
      (resource) => resource.resourceType === 'prompt'
    );
    expect(prompts.length).toBeGreaterThan(40);

    let compared = 0;
    for (const prompt of prompts) {
      const entry = parseYamlOrThrow<Record<string, unknown>>(
        await readFile(prompt.entryPath, 'utf8')
      );
      const set = await resourceFileSet(prompt);
      const relative = set.files.map((file) => file.relativePath);
      for (const key of ['systemMessageFile', 'userMessageTemplateFile']) {
        const declared = entry[key];
        if (typeof declared !== 'string') continue;
        expect(relative).toContain(declared);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(40);
  });
});
