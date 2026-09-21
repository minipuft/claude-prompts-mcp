// @lifecycle canonical - Integration tests for the injected resource file locator (row O.4a).
/**
 * A checkpoint is recorded from a resource's FILES, and a version row holds only a type and an id.
 * The locator is what closes that gap, and it is the one place a wrong answer is silent: it picks
 * between a workspace definition and the bundled one of the same id, and the row it produces looks
 * identical either way until a rollback writes the wrong bytes back.
 *
 * So every case here runs against REAL directories on disk, with a real `PathResolver` over a
 * temporary workspace and a temporary package root — root precedence resolved by its one owner
 * (`resolveResourceRoots`), never restated here. Both roots hold a gate named `shared`, which is
 * the case the precedence rule exists for.
 *
 * Environment: the ambient shell exports `MCP_RESOURCES_PATH`, and `resolveResourceSubdir` reads
 * it directly — left set, every workspace lookup below resolves somewhere else entirely and the
 * suite would be measuring the developer's own resource library. It is cleared per test, with
 * `MCP_WORKSPACE` beside it for the same reason.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { VersioningConfigProvider } from '#modules/versioning/version-history-service.js';
import type { ResourceType } from '#modules/versioning/types.js';

import { VersionHistoryService } from '#modules/versioning/version-history-service.js';
import { PathResolver } from '#runtime/paths.js';
import { createResourceFileLocator } from '#runtime/resource-roots.js';

const SCRUBBED = ['MCP_RESOURCES_PATH', 'MCP_WORKSPACE', 'MCP_RUNTIME_ROOT'] as const;

let workspace: string;
let packageRoot: string;
let saved: Record<string, string | undefined>;

/** A `VersionHistoryService` wired exactly as the four tool handlers wire theirs. */
function serviceOver(resolver: PathResolver): VersionHistoryService {
  const configManager: VersioningConfigProvider = {
    getVersioningConfig: () => ({ enabled: true, autoVersion: true, maxVersions: 50 }),
    getServerRoot: () => packageRoot,
  };
  return new VersionHistoryService({
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never,
    configManager,
    resourceFileLocator: createResourceFileLocator(resolver),
  });
}

/**
 * The service's own locator answer, reached through the same private field the write path uses.
 *
 * Private on purpose — the only production caller is inside this class (row O.4b) — so the test
 * reaches it by cast rather than by widening the surface for a test's convenience.
 */
function locate(
  service: VersionHistoryService,
  resourceType: ResourceType,
  resourceId: string
): Promise<{ located: true; entryPath: string } | { located: false; reason: string }> {
  return (
    service as unknown as {
      locateResourceFiles: (
        t: ResourceType,
        i: string
      ) => Promise<{ located: true; entryPath: string } | { located: false; reason: string }>;
    }
  ).locateResourceFiles(resourceType, resourceId);
}

async function write(file: string, body: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body, 'utf8');
}

beforeEach(async () => {
  saved = Object.fromEntries(SCRUBBED.map((key) => [key, process.env[key]]));
  for (const key of SCRUBBED) delete process.env[key];

  workspace = await mkdtemp(path.join(tmpdir(), 'cs-write-ws-'));
  packageRoot = await mkdtemp(path.join(tmpdir(), 'cs-write-pkg-'));

  // Bundled tree — the package's own resources, lowest precedence.
  await write(path.join(packageRoot, 'resources/gates/shared/gate.yaml'), 'id: shared\n');
  await write(path.join(packageRoot, 'resources/gates/bundled-only/gate.yaml'), 'id: bundled\n');
  await write(
    path.join(packageRoot, 'resources/frameworks/cageerf/framework.yaml'),
    'id: cageerf\n'
  );
  await write(path.join(packageRoot, 'resources/prompts/general/notes/prompt.yaml'), 'id: notes\n');
  await write(path.join(packageRoot, 'resources/prompts/general/category.yaml'), 'id: general\n');

  // Workspace tree — the operator's own resources, higher precedence, same `shared` id.
  await write(path.join(workspace, 'resources/gates/shared/gate.yaml'), 'id: shared-workspace\n');
  await write(path.join(workspace, 'resources/gates/ws-only/gate.yaml'), 'id: ws-only\n');
  await write(
    path.join(workspace, 'resources/frameworks/ws-framework/framework.yaml'),
    'id: ws-framework\n'
  );
  await write(path.join(workspace, 'resources/prompts/team/plan/prompt.yaml'), 'id: plan\n');
  await write(path.join(workspace, 'resources/prompts/team/category.yaml'), 'id: team\n');
  // Single-file layout: `{category}/{id}.yaml`, which has no directory of its own.
  await write(path.join(workspace, 'resources/prompts/team/quick.yaml'), 'id: quick\n');
});

afterEach(async () => {
  for (const key of SCRUBBED) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(workspace, { recursive: true, force: true });
  await rm(packageRoot, { recursive: true, force: true });
});

describe('createResourceFileLocator, through VersionHistoryService', () => {
  function resolver(): PathResolver {
    return new PathResolver({ cli: { workspace }, packageRoot });
  }

  it.each([
    ['gate' as const, 'ws-only', 'resources/gates/ws-only/gate.yaml'],
    ['framework' as const, 'ws-framework', 'resources/frameworks/ws-framework/framework.yaml'],
    ['prompt' as const, 'plan', 'resources/prompts/team/plan/prompt.yaml'],
    ['category' as const, 'team', 'resources/prompts/team/category.yaml'],
  ])('locates a workspace %s', async (type, id, expected) => {
    const result = await locate(serviceOver(resolver()), type, id);
    expect(result).toMatchObject({ located: true, entryPath: path.join(workspace, expected) });
  });

  it.each([
    ['gate' as const, 'bundled-only', 'resources/gates/bundled-only/gate.yaml'],
    ['framework' as const, 'cageerf', 'resources/frameworks/cageerf/framework.yaml'],
    ['prompt' as const, 'notes', 'resources/prompts/general/notes/prompt.yaml'],
    ['category' as const, 'general', 'resources/prompts/general/category.yaml'],
  ])('locates a bundled %s the workspace does not override', async (type, id, expected) => {
    const result = await locate(serviceOver(resolver()), type, id);
    expect(result).toMatchObject({ located: true, entryPath: path.join(packageRoot, expected) });
  });

  it('prefers the workspace definition when both roots hold the id', async () => {
    const result = await locate(serviceOver(resolver()), 'gate', 'shared');
    // The precedence assertion that matters: `resourceRootPrecedence` ranks the workspace above
    // the bundled tree, and a locator that re-derived the order would plausibly answer the other
    // way — which is a rollback writing the package's bytes over the operator's gate.
    expect(result).toMatchObject({
      located: true,
      entryPath: path.join(workspace, 'resources/gates/shared/gate.yaml'),
      // The roots travel with the answer: `resourceFileSet` classifies the entry's ORIGIN from
      // them, and an entry reported without its bundled root would be classified `primary`.
      roots: {
        primary: path.join(workspace, 'resources/gates'),
        bundled: path.join(packageRoot, 'resources/gates'),
      },
    });
  });

  it('locates a single-file prompt, which has no directory of its own', async () => {
    const result = await locate(serviceOver(resolver()), 'prompt', 'quick');
    expect(result).toMatchObject({
      located: true,
      entryPath: path.join(workspace, 'resources/prompts/team/quick.yaml'),
    });
  });

  it('refuses, with a reason, an id no root holds', async () => {
    const result = await locate(serviceOver(resolver()), 'gate', 'deleted-gate');
    expect(result.located).toBe(false);
    if (result.located) throw new Error('unreachable');
    expect(result.reason).toContain('gate.yaml');
    expect(result.reason).toContain('deleted-gate');
  });

  it('refuses when the files are removed after they were recorded', async () => {
    const service = serviceOver(resolver());
    const before = await locate(service, 'gate', 'ws-only');
    expect(before.located).toBe(true); // positive control: the probe CAN find this id

    await rm(path.join(workspace, 'resources/gates/ws-only'), { recursive: true });

    const after = await locate(service, 'gate', 'ws-only');
    expect(after.located).toBe(false);
  });

  it('refuses when no locator was injected at all', async () => {
    const service = new VersionHistoryService({
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never,
      configManager: {
        getVersioningConfig: () => ({ enabled: true, autoVersion: true, maxVersions: 50 }),
        getServerRoot: () => packageRoot,
      },
    });
    const result = await locate(service, 'gate', 'ws-only');
    expect(result).toEqual({
      located: false,
      reason: 'no resource file locator was injected into this service',
    });
  });
});
