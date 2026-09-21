/**
 * Auto-deregistration of prompts exported as client skills.
 *
 * This shipped broken and silent: the reader parsed a flat `exports` key while every
 * real config had moved to `registrations`, so it returned an empty set on every boot
 * and nothing was ever deregistered. Nothing observed it — mutation M5 (reader returns
 * nothing) passed all 2571 unit tests on 2026-08-16.
 *
 * The behavior under test is the SET the reader returns, so a fake config on disk with
 * a real file read is the whole boundary. No prompt registry is involved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

import { loadSkillsSyncExports } from '../../../src/runtime/data-loader.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import type { Logger } from '../../../src/infra/logging/index.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

const ALL_PROMPTS = ['development/dev-workflow', 'general/other', 'analysis/deep_analysis'];

// A workspace or resources path exported by the developer's shell would otherwise decide which
// skills-sync.yaml these tests read.
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    MCP_WORKSPACE: process.env['MCP_WORKSPACE'],
    MCP_RESOURCES_PATH: process.env['MCP_RESOURCES_PATH'],
  };
  delete process.env['MCP_WORKSPACE'];
  delete process.env['MCP_RESOURCES_PATH'];
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('skills-sync auto-deregistration', () => {
  let serverRoot: string;

  beforeEach(() => {
    serverRoot = mkdtempSync(path.join(os.tmpdir(), 'skills-dereg-'));
  });

  afterEach(async () => {
    await rm(serverRoot, { recursive: true, force: true });
  });

  async function writeConfig(config: unknown): Promise<void> {
    await writeFile(path.join(serverRoot, 'skills-sync.yaml'), yaml.dump(config));
  }

  async function load(): Promise<Set<string>> {
    return loadSkillsSyncExports(
      new PathResolver({ cli: {}, packageRoot: serverRoot }),
      silentLogger,
      ALL_PROMPTS
    );
  }

  it('reads the canonical `registrations` shape', async () => {
    await writeConfig({
      registrations: { 'claude-code': { user: ['prompt:development/dev-workflow'] } },
    });
    expect([...(await load())]).toEqual(['development/dev-workflow']);
  });

  it('unions across every client and scope', async () => {
    // prompts/list is one surface: a prompt exported to ANY client is skill-served,
    // so scope and client must not partition the result.
    await writeConfig({
      registrations: {
        'claude-code': { user: ['prompt:development/dev-workflow'] },
        codex: { project: ['prompt:general/other'] },
      },
    });
    expect([...(await load())].sort()).toEqual(['development/dev-workflow', 'general/other']);
  });

  it('deregisters every prompt when a client selects `all`', async () => {
    await writeConfig({ registrations: { 'claude-code': 'all' } });
    expect([...(await load())].sort()).toEqual([...ALL_PROMPTS].sort());
  });

  it('ignores non-prompt resources — only prompts appear in prompts/list', async () => {
    await writeConfig({
      registrations: {
        'claude-code': { user: ['gate:code-quality', 'framework:cageerf', 'prompt:general/other'] },
      },
    });
    expect([...(await load())]).toEqual(['general/other']);
  });

  it('still honors the deprecated flat `exports` list', async () => {
    await writeConfig({ exports: ['prompt:development/dev-workflow'] });
    expect([...(await load())]).toEqual(['development/dev-workflow']);
  });

  it('returns an empty set when the config declares neither key', async () => {
    await writeConfig({ overrides: { 'claude-code': { outputDir: { user: '/tmp/x' } } } });
    expect((await load()).size).toBe(0);
  });

  it('returns an empty set when the config file is absent', async () => {
    expect((await load()).size).toBe(0);
  });

  it('emits keys as `category/id`, matching the registry lookup key', async () => {
    // registry.ts builds `${prompt.category}/${prompt.id}`; a mismatch here would
    // deregister nothing while still looking like it worked.
    await writeConfig({
      registrations: { 'claude-code': { user: ['prompt:development/dev-workflow'] } },
    });
    const result = await load();
    expect(result.has('development/dev-workflow')).toBe(true);
    expect(result.has('dev-workflow')).toBe(false);
  });
});

describe('skills-sync auto-deregistration reads the file skills sync registers into', () => {
  // Skills sync reads and writes the workspace's skills-sync.yaml when the workspace holds one. A
  // server that read only the package's copy kept a workspace-registered prompt in prompts/list,
  // so the client was offered it twice: once as a skill, once as an MCP prompt.
  let tmpDir: string;
  let packageRoot: string;
  let workspace: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'skills-dereg-workspace-'));
    packageRoot = path.join(tmpDir, 'package');
    workspace = path.join(tmpDir, 'workspace');
    await mkdir(packageRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function registerIn(root: string, promptKey: string): Promise<void> {
    await writeFile(
      path.join(root, 'skills-sync.yaml'),
      yaml.dump({ registrations: { 'claude-code': { user: [`prompt:${promptKey}`] } } })
    );
  }

  /** The exported set the server computes at startup, given `--workspace` when named. */
  async function loadAtStartup(workspaceFlag?: string): Promise<Set<string>> {
    const cli = workspaceFlag === undefined ? {} : { workspace: workspaceFlag };
    return loadSkillsSyncExports(new PathResolver({ cli, packageRoot }), silentLogger, ALL_PROMPTS);
  }

  it('reads the workspace skills-sync.yaml over the package copy', async () => {
    process.env['MCP_WORKSPACE'] = workspace;
    await registerIn(packageRoot, 'development/dev-workflow');
    await registerIn(workspace, 'general/other');

    expect([...(await loadAtStartup())]).toEqual(['general/other']);
  });

  it('follows a workspace named by the --workspace flag, which sets no environment variable', async () => {
    await registerIn(workspace, 'general/other');

    expect([...(await loadAtStartup(workspace))]).toEqual(['general/other']);
  });

  it('reads the package skills-sync.yaml when the workspace holds none', async () => {
    process.env['MCP_WORKSPACE'] = workspace;
    await registerIn(packageRoot, 'development/dev-workflow');

    expect([...(await loadAtStartup())]).toEqual(['development/dev-workflow']);
  });
});
