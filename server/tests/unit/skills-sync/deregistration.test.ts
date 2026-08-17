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
import { rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

import { loadSkillsSyncExports } from '../../../src/runtime/data-loader.js';
import type { Logger } from '../../../src/infra/logging/index.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

const ALL_PROMPTS = ['development/dev-workflow', 'general/other', 'analysis/deep_analysis'];

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
    return loadSkillsSyncExports(serverRoot, silentLogger, ALL_PROMPTS);
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
    expect((await loadSkillsSyncExports(serverRoot, silentLogger, ALL_PROMPTS)).size).toBe(0);
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
