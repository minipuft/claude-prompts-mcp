/**
 * What `status` reports about where resources come from, and the one warning a same-id pair
 * between two custom locations earns (rows 1.5 and 1.8).
 *
 * Driven through the real chain: a `PathResolver` reading a `paths.resources` list of real
 * folders, the real resource-index sync (`syncResourceIndex`, which is what records into the
 * ledger at startup and on every reload), the real prompt loader for which body serves, and the
 * section `status` renders. The only stand-ins are the logger and an empty quarantine view.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { formatResourceLocations } from '../../../src/mcp/tools/system-control/handlers/status-action-handler.js';
import { PromptAssetManager } from '../../../src/modules/prompts/index.js';
import {
  loadPromptsAcrossRoots,
  mergePromptResults,
} from '../../../src/modules/prompts/prompt-root-loader.js';
import { ConversationStore } from '../../../src/modules/text-refs/conversation.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import { syncResourceIndex } from '../../../src/runtime/resource-index-resync.js';
import { ResourceLocationLedger } from '../../../src/runtime/resource-location-report.js';

import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';
import type { QuarantineView } from '../../../src/shared/utils/resource-quarantine.js';
import { isolateResourceLocations } from '../../helpers/resource-locations.js';

const locations = isolateResourceLocations();

const NO_REFUSALS: QuarantineView = {
  list: () => [],
  byId: () => [],
  isRefused: () => false,
  size: 0,
};

let dir: string;
let packageRoot: string;
let workspace: string;
let logger: Logger & { warn: jest.Mock };

function writePrompt(
  root: string,
  id: string,
  description: string,
  body: string,
  category = 'examples'
): string {
  const promptDir = path.join(root, 'prompts', category, id);
  mkdirSync(promptDir, { recursive: true });
  writeFileSync(
    path.join(promptDir, 'prompt.yaml'),
    [
      `id: ${id}`,
      `name: ${id}`,
      `category: ${category}`,
      `description: ${description}`,
      'userMessageTemplateFile: user-message.md',
      '',
    ].join('\n')
  );
  writeFileSync(path.join(promptDir, 'user-message.md'), `${body}\n`);
  return path.join(promptDir, 'prompt.yaml');
}

function writeGate(root: string, id: string): void {
  const gateDir = path.join(root, 'gates', id);
  mkdirSync(gateDir, { recursive: true });
  writeFileSync(
    path.join(gateDir, 'gate.yaml'),
    [`id: ${id}`, `name: ${id}`, 'type: validation', `description: Gate ${id}.`, ''].join('\n')
  );
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'location-report-'));
  packageRoot = path.join(dir, 'package');
  for (const type of ['prompts', 'gates', 'frameworks', 'styles']) {
    mkdirSync(path.join(packageRoot, 'resources', type), { recursive: true });
  }
  workspace = path.join(dir, 'profiles', 'shadow');
  mkdirSync(workspace, { recursive: true });
  locations.set({ workspace, runtimeRoot: path.join(dir, 'runtime') });
  logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger & { warn: jest.Mock };
});

afterEach(async () => {
  await SqliteEngine.shutdownInstance();
  rmSync(dir, { recursive: true, force: true });
});

/** A resolver whose `paths.resources` list is `list`, `"bundled"` kept as the literal. */
function resolverWith(list: readonly string[]): PathResolver {
  const resolver = new PathResolver({ cli: {}, packageRoot });
  resolver.readResourceLocationsFrom(() => ({ resources: list }));
  return resolver;
}

/** One index sync through the real resync, recording into `ledger`. */
async function sync(resolver: PathResolver, ledger: ResourceLocationLedger): Promise<void> {
  await syncResourceIndex({
    pathResolver: resolver,
    logger,
    indexQuarantine: NO_REFUSALS,
    locationLedger: ledger,
  });
}

/** The description the real prompt loader serves for `id` across the resolver's locations. */
async function servedDescription(resolver: PathResolver, id: string): Promise<string | undefined> {
  const promptManager = new PromptAssetManager(
    logger,
    new TextReferenceStore(logger),
    new ConversationStore(logger),
    { getPromptsRegisterWithMcp: () => false } as unknown as ConfigManager
  );
  const primary = resolver.getPromptsPath();
  const loaded = await loadPromptsAcrossRoots(
    promptManager,
    {
      primary,
      basePath: primary,
      bundled: resolver.getBundledResourceDir('prompts'),
      overlays: resolver.getOverlayResourceDirs('prompts', primary),
    },
    mergePromptResults
  );
  return loaded.convertedPrompts.find((prompt) => prompt.id === id)?.description;
}

/** Every WARN line that names `id`. */
function warningsAbout(id: string): string[] {
  return logger.warn.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.includes(`'${id}'`));
}

describe('status: the resolved stack, in order, with a count per location', () => {
  it('lists each location with its kind and per-kind counts, then the bundle state', async () => {
    const custom = path.join(dir, 'custom');
    const custom2 = path.join(dir, 'custom2');
    writePrompt(custom, 'alpha', 'Alpha.', 'A');
    writePrompt(custom, 'beta', 'Beta.', 'B');
    writeGate(custom, 'tidy');
    writePrompt(custom2, 'gamma', 'Gamma.', 'G');
    const resolver = resolverWith([custom, custom2]);
    const ledger = new ResourceLocationLedger(resolver, logger);

    await sync(resolver, ledger);
    const section = formatResourceLocations(ledger.view().report());

    const customLine = `${custom} (listed) — 2 prompts, 1 gates, 0 frameworks, 0 styles`;
    const custom2Line = `${custom2} (listed) — 1 prompts, 0 gates, 0 frameworks, 0 styles`;
    expect(section).toContain(customLine);
    expect(section).toContain(custom2Line);
    expect(section.indexOf(customLine)).toBeLessThan(section.indexOf(custom2Line));
    // The profile's own folder serves first and holds nothing here.
    expect(section).toContain(`1. ${path.join(workspace, 'resources')} (profile) — 0 prompts`);
    expect(section).toContain('bundled (absent)');
    expect(section).not.toContain(path.join(packageRoot, 'resources'));
    expect(section).toContain('Shadowed: none');
  });

  it('reports the bundle as listed where the list names it, and implicit with no list', async () => {
    const custom = path.join(dir, 'custom');
    writePrompt(custom, 'alpha', 'Alpha.', 'A');

    const listed = resolverWith([custom, 'bundled']);
    const listedLedger = new ResourceLocationLedger(listed, logger);
    await sync(listed, listedLedger);
    expect(formatResourceLocations(listedLedger.view().report())).toContain('bundled (listed)');

    const implicit = resolverWith([]);
    const implicitLedger = new ResourceLocationLedger(implicit, logger);
    await sync(implicit, implicitLedger);
    expect(formatResourceLocations(implicitLedger.view().report())).toContain('bundled (implicit)');
  });
});

describe('status: the profile registry beside the workspace parent', () => {
  const registry = (): string => path.join(dir, 'profiles', 'workspaces.jsonc');

  it('names the current label and its siblings', async () => {
    writeFileSync(
      registry(),
      '// cpm profiles\n{ "shadow": "./shadow", "team": "./team", "shared": "./shared", }\n'
    );
    const resolver = resolverWith([]);
    const report = new ResourceLocationLedger(resolver, logger).view().report();

    expect(formatResourceLocations(report)).toContain('profile: shadow (siblings: team, shared)');
  });

  it('says unlabelled, with the labels it does name, when no label names this workspace', () => {
    writeFileSync(registry(), '{ "dev": "./dev" }');
    const report = new ResourceLocationLedger(resolverWith([]), logger).view().report();

    expect(formatResourceLocations(report)).toContain(
      `profile: unlabelled (registry at ${registry()} names: dev)`
    );
  });

  it('gives a malformed registry one line and does not throw', () => {
    writeFileSync(registry(), '{ "shadow": ');
    const report = new ResourceLocationLedger(resolverWith([]), logger).view().report();
    const profileLines = formatResourceLocations(report)
      .split('\n')
      .filter((line) => line.startsWith('profile:'));

    expect(profileLines).toHaveLength(1);
    expect(profileLines[0]).toContain(`registry at ${registry()} could not be read`);
  });

  it('prints no profile line when no registry sits beside the parent', () => {
    const report = new ResourceLocationLedger(resolverWith([]), logger).view().report();

    expect(formatResourceLocations(report)).not.toContain('profile:');
  });
});

describe('a same-id pair between two custom locations (row 1.8)', () => {
  it('warns once naming both files, serves the earlier body, and status marks the later copy', async () => {
    const custom = path.join(dir, 'custom');
    const custom2 = path.join(dir, 'custom2');
    const earlier = writePrompt(custom, 'review', 'Review from custom.', 'EARLIER');
    const later = writePrompt(custom2, 'review', 'Review from custom2.', 'LATER');
    const resolver = resolverWith([custom, custom2]);
    const ledger = new ResourceLocationLedger(resolver, logger);

    // Startup, then a hot-reload re-sync, then two status reads: still one warning.
    await sync(resolver, ledger);
    await sync(resolver, ledger);
    const report = ledger.view().report();
    ledger.view().report();

    expect(warningsAbout('review')).toEqual([
      `Resource 'review' (prompt) is defined in ${earlier} and ${later}; ` +
        'the earlier location serves it',
    ]);
    expect(await servedDescription(resolver, 'review')).toBe('Review from custom.');
    expect(formatResourceLocations(report)).toContain(
      `- review (prompt): served from ${earlier}, hidden copy in ${later}`
    );
  });

  it('draws one warning, not the indexer category warning as well, when the copies sit in different categories', async () => {
    const custom = path.join(dir, 'custom');
    const custom2 = path.join(dir, 'custom2');
    const earlier = writePrompt(custom, 'review', 'Review from custom.', 'EARLIER', 'alpha');
    const later = writePrompt(custom2, 'review', 'Review from custom2.', 'LATER', 'beta');
    const resolver = resolverWith([custom, custom2]);
    const ledger = new ResourceLocationLedger(resolver, logger);

    await sync(resolver, ledger);
    await sync(resolver, ledger);

    expect(warningsAbout('review')).toEqual([
      `Resource 'review' (prompt) is defined in ${earlier} and ${later}; ` +
        'the earlier location serves it',
    ]);
  });

  it('CONTROL: a custom copy in another category than a bundled one keeps the indexer warning', async () => {
    const custom = path.join(dir, 'custom');
    writePrompt(custom, 'review', 'Review from custom.', 'CUSTOM', 'alpha');
    writePrompt(path.join(packageRoot, 'resources'), 'review', 'Bundled.', 'BUNDLED', 'beta');
    const resolver = resolverWith([custom, 'bundled']);
    const ledger = new ResourceLocationLedger(resolver, logger);

    await sync(resolver, ledger);

    const lines = warningsAbout('review');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("duplicate prompt id 'review' in two categories");
  });

  it('CONTROL: a custom copy of a bundled id logs nothing and the custom body serves', async () => {
    const custom = path.join(dir, 'custom');
    const customFile = writePrompt(custom, 'minimal_prompt', 'Custom minimal.', 'CUSTOM');
    const bundledFile = writePrompt(
      path.join(packageRoot, 'resources'),
      'minimal_prompt',
      'Bundled minimal.',
      'BUNDLED'
    );
    const resolver = resolverWith([custom, 'bundled']);
    const ledger = new ResourceLocationLedger(resolver, logger);

    await sync(resolver, ledger);

    expect(warningsAbout('minimal_prompt')).toEqual([]);
    expect(await servedDescription(resolver, 'minimal_prompt')).toBe('Custom minimal.');
    // Still reported: status lists every hidden entry, the warning is what stays quiet.
    expect(formatResourceLocations(ledger.view().report())).toContain(
      `- minimal_prompt (prompt): served from ${customFile}, hidden copy in ${bundledFile}`
    );
  });
});
