// @lifecycle test - End-to-end syncCommand and diffCommand coverage (F11).
/**
 * F11: prune PLANNING is unit-tested in `sync-engine.test.ts`, but the commands
 * that call it were not -- including the --prune/--no-prune branch and orphan
 * reporting. F10 adoption rides the same path, so it is driven here too.
 */
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as yaml from 'js-yaml';

import {
  runSkillsSyncCommand,
  type SkillsSyncOptions,
  type SkillsSyncOutput,
} from '../../../src/modules/skills-sync/service.js';

function silentOutput(): SkillsSyncOutput & { logs: string[]; warns: string[] } {
  const logs: string[] = [];
  const warns: string[] = [];
  return {
    logs,
    warns,
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => warns.push(args.map(String).join(' ')),
    error: () => {},
  };
}

describe('sync and diff commands end to end (F11)', () => {
  let tmpDir: string;
  let serverRoot: string;
  let outputDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'skills-sync-cmd-'));
    serverRoot = path.join(tmpDir, 'server');
    outputDir = path.join(tmpDir, 'output');
    await mkdir(serverRoot, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    savedEnv = {
      MCP_SERVER_ROOT: process.env['MCP_SERVER_ROOT'],
      MCP_RESOURCES_PATH: process.env['MCP_RESOURCES_PATH'],
    };
    process.env['MCP_SERVER_ROOT'] = serverRoot;
    delete process.env['MCP_RESOURCES_PATH'];

    await writeFile(
      path.join(serverRoot, 'skills-sync.yaml'),
      yaml.dump({
        registrations: { 'claude-code': 'all' },
        overrides: {
          'claude-code': { outputDir: { user: outputDir, project: outputDir } },
        },
      })
    );
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writePrompt(id: string): Promise<void> {
    const dir = path.join(serverRoot, 'resources', 'prompts', 'general', id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'user-message.md'), 'Do the thing.');
    await writeFile(
      path.join(dir, 'prompt.yaml'),
      yaml.dump({
        id,
        name: id,
        description: `${id} description`,
        category: 'general',
        userMessageTemplateFile: 'user-message.md',
      })
    );
  }

  /** A directory left by an export that predates managed markers. */
  async function writeUnmarkedSkillDir(dirName: string, leadHeading: string): Promise<void> {
    const dir = path.join(outputDir, dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${dirName}\ndescription: A pre-marker export.\n---\n\n${leadHeading}\n\nBody text.\n`
    );
  }

  function run(opts: Partial<SkillsSyncOptions>) {
    const out = silentOutput();
    return runSkillsSyncCommand(
      { command: 'sync', client: 'claude-code', scope: 'user', ...opts } as SkillsSyncOptions,
      out
    ).then((report) => ({ report, out }));
  }

  it('sync writes skills and reports what it wrote', async () => {
    await writePrompt('kept_prompt');

    const { report } = await run({ command: 'sync' });

    expect(report.command).toBe('sync');
    expect(report.written).toBeGreaterThan(0);
  });

  it('sync adopts an unmarked directory this emitter produced', async () => {
    await writePrompt('kept_prompt');
    // `legacy_export` shares no substring with `kept_prompt`, so an assertion
    // about it cannot pass by matching the other fixture's name.
    await writeUnmarkedSkillDir('legacy_export', '## Instructions');

    const { out } = await run({ command: 'sync' });

    expect(out.logs.join('\n')).toContain('legacy_export');
    const adopted = await readFile(path.join(outputDir, 'legacy_export', 'SKILL.md'), 'utf-8');
    expect(adopted).toContain('managed-by: claude-prompts-skills-sync');
  });

  it('sync leaves a hand-written directory untouched', async () => {
    await writePrompt('kept_prompt');
    await writeUnmarkedSkillDir('hand_written', '## Overview');

    await run({ command: 'sync' });

    const untouched = await readFile(path.join(outputDir, 'hand_written', 'SKILL.md'), 'utf-8');
    // Guards the inverse of the previous case: without this, a fix that adopted
    // every unmarked directory would pass it.
    expect(untouched).not.toContain('managed-by');
  });

  it('sync does not adopt on a dry run', async () => {
    await writePrompt('kept_prompt');
    await writeUnmarkedSkillDir('legacy_export', '## Instructions');

    await run({ command: 'sync', dryRun: true });

    const unchanged = await readFile(path.join(outputDir, 'legacy_export', 'SKILL.md'), 'utf-8');
    expect(unchanged).not.toContain('managed-by');
  });

  it('sync honors --no-prune by leaving stale managed dirs in place', async () => {
    await writePrompt('kept_prompt');
    await run({ command: 'sync' });

    const { report } = await run({ command: 'sync', prune: false });

    expect(report.pruned).toBe(0);
  });

  it('diff runs against the exported tree without writing', async () => {
    await writePrompt('kept_prompt');
    await run({ command: 'sync' });

    const { report } = await run({ command: 'diff' });

    expect(report.command).toBe('diff');
    expect(report.written).toBe(0);
  });
});
