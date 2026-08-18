import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';

import {
  parseSkillsSyncArgs,
  runSkillsSyncCommand,
  SkillsSyncCommandError,
} from '../../../src/modules/skills-sync/service.js';

describe('skills-sync CLI option handling', () => {
  const output = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  it('parses --json for machine-readable output', () => {
    const opts = parseSkillsSyncArgs(['node', 'scripts/skills-sync.ts', 'diff', '--json']);

    expect(opts.command).toBe('diff');
    expect(opts.json).toBe(true);
  });

  it('rejects --verbose, which never had behavior behind it', () => {
    // Deleted rather than kept as a warned no-op: a knob whose retirement
    // nobody would notice is a permanent parallel path (cleanup-standards.md).
    expect(() =>
      parseSkillsSyncArgs(['node', 'scripts/skills-sync.ts', 'diff', '--verbose'])
    ).toThrow();
  });

  it('emits nothing but a parseable JSON report on stdout under --json', async () => {
    const logged: string[] = [];
    const jsonOutput = {
      log: (...args: unknown[]) => logged.push(args.join(' ')),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const report = await runSkillsSyncCommand({ command: 'help', json: true }, jsonOutput);

    // Exactly one stdout write, and it round-trips as JSON — the help banner
    // that `help` normally prints would corrupt it.
    expect(logged).toHaveLength(1);
    const parsed = JSON.parse(logged[0] as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({ command: 'help', failures: [] });
    expect(report.command).toBe('help');
  });

  it('rejects clone without --file as usage error', async () => {
    await expect(runSkillsSyncCommand({ command: 'clone' }, output)).rejects.toMatchObject({
      name: 'SkillsSyncCommandError',
      exitCode: 2,
      message: 'clone requires --file <path> to a SKILL.md',
    });
  });

  it('rejects invalid command as usage error', async () => {
    await expect(runSkillsSyncCommand({ command: 'bogus' }, output)).rejects.toMatchObject({
      name: 'SkillsSyncCommandError',
      exitCode: 2,
    });
  });

  it('uses typed command errors for usage failures', async () => {
    try {
      await runSkillsSyncCommand({ command: 'diff', scope: 'bad' as never }, output);
      throw new Error('Expected command to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillsSyncCommandError);
      expect((error as SkillsSyncCommandError).exitCode).toBe(2);
    }
  });

  it('rolls back clone writes when companion gate validation fails', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skills-sync-cli-'));
    const previousServerRoot = process.env['MCP_SERVER_ROOT'];
    const previousResourcesPath = process.env['MCP_RESOURCES_PATH'];

    try {
      process.env['MCP_SERVER_ROOT'] = tempRoot;
      delete process.env['MCP_RESOURCES_PATH'];

      await mkdir(path.join(tempRoot, 'resources', 'prompts'), { recursive: true });
      await mkdir(path.join(tempRoot, 'resources', 'gates'), { recursive: true });

      const skillDir = path.join(tempRoot, 'fixtures', 'invalid-skill');
      const skillFile = path.join(skillDir, 'SKILL.md');
      await mkdir(path.join(skillDir, 'gates', 'broken-gate'), { recursive: true });
      await writeFile(
        skillFile,
        `---
name: Invalid Gate Rollback
description: Prompt clone fixture with invalid companion gate.
---

## Instructions

Use this fixture to validate clone rollback behavior.
`,
        'utf-8'
      );
      await writeFile(
        path.join(skillDir, 'gates', 'broken-gate', 'gate.yaml'),
        `id: broken-gate
name: Broken Gate
`,
        'utf-8'
      );

      await expect(
        runSkillsSyncCommand(
          {
            command: 'clone',
            file: skillFile,
            id: 'rollback-clone',
            category: 'workflow',
            resourceType: 'prompt',
            force: true,
          },
          output
        )
      ).rejects.toThrow('Clone validation failed');

      expect(existsSync(path.join(tempRoot, 'resources', 'prompts', 'workflow'))).toBe(false);
      expect(
        existsSync(path.join(tempRoot, 'resources', 'prompts', 'workflow', 'rollback-import'))
      ).toBe(false);
      expect(existsSync(path.join(tempRoot, 'resources', 'gates', 'broken-gate'))).toBe(false);
    } finally {
      if (previousServerRoot === undefined) {
        delete process.env['MCP_SERVER_ROOT'];
      } else {
        process.env['MCP_SERVER_ROOT'] = previousServerRoot;
      }
      if (previousResourcesPath === undefined) {
        delete process.env['MCP_RESOURCES_PATH'];
      } else {
        process.env['MCP_RESOURCES_PATH'] = previousResourcesPath;
      }
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
