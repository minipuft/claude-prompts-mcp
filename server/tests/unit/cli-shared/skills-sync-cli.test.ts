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
import { resolveSkillsSyncPaths } from '../../../src/runtime/skills-sync-paths.js';

describe('skills-sync CLI option handling', () => {
  const output = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  it('writes the help banner through the output it was given, not the process console', async () => {
    // The service runs inside the server, where stdout is the STDIO protocol channel; only the CLI
    // wrapper in scripts/skills-sync.ts may bind output to the console.
    const logged: string[] = [];
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runSkillsSyncCommand(
        { command: 'help' },
        {
          log: (...args: unknown[]) => logged.push(args.join(' ')),
          warn: jest.fn(),
          error: jest.fn(),
        },
        resolveSkillsSyncPaths()
      );
    } finally {
      consoleLog.mockRestore();
    }

    expect(consoleLog).not.toHaveBeenCalled();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('skills-sync — Export canonical resources');
  });

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

    const report = await runSkillsSyncCommand(
      { command: 'help', json: true },
      jsonOutput,
      resolveSkillsSyncPaths()
    );

    // Exactly one stdout write, and it round-trips as JSON — the help banner
    // that `help` normally prints would corrupt it.
    expect(logged).toHaveLength(1);
    const parsed = JSON.parse(logged[0] as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({ command: 'help', failures: [] });
    expect(report.command).toBe('help');
  });

  it('rejects clone without --file as usage error', async () => {
    await expect(
      runSkillsSyncCommand({ command: 'clone' }, output, resolveSkillsSyncPaths())
    ).rejects.toMatchObject({
      name: 'SkillsSyncCommandError',
      exitCode: 2,
      message: 'clone requires --file <path> to a SKILL.md',
    });
  });

  it('rejects invalid command as usage error', async () => {
    await expect(
      runSkillsSyncCommand({ command: 'bogus' }, output, resolveSkillsSyncPaths())
    ).rejects.toMatchObject({
      name: 'SkillsSyncCommandError',
      exitCode: 2,
    });
  });

  it('uses typed command errors for usage failures', async () => {
    try {
      await runSkillsSyncCommand(
        { command: 'diff', scope: 'bad' as never },
        output,
        resolveSkillsSyncPaths()
      );
      throw new Error('Expected command to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillsSyncCommandError);
      expect((error as SkillsSyncCommandError).exitCode).toBe(2);
    }
  });

  it('refuses a missing MCP_RESOURCES_PATH by name instead of falling through to another tree', async () => {
    // Before this refusal, a missing directory fell through to the checkout's own server root, so
    // a diff or sync ran against a tree the operator never named.
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skills-sync-cli-missing-'));
    const missing = path.join(tempRoot, 'no-such-resources');
    const previousResourcesPath = process.env['MCP_RESOURCES_PATH'];

    try {
      process.env['MCP_RESOURCES_PATH'] = missing;
      await expect(
        runSkillsSyncCommand(
          parseSkillsSyncArgs(['node', 'scripts/skills-sync.ts', 'diff']),
          output,
          resolveSkillsSyncPaths()
        )
      ).rejects.toThrow(
        `Refusing to run: the MCP_RESOURCES_PATH environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.`
      );
      expect(existsSync(missing)).toBe(false);
    } finally {
      if (previousResourcesPath === undefined) {
        delete process.env['MCP_RESOURCES_PATH'];
      } else {
        process.env['MCP_RESOURCES_PATH'] = previousResourcesPath;
      }
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('refuses a missing MCP_WORKSPACE before resolving a project-scope output dir, and treats an empty one as unset', async () => {
    // Before this refusal, the project root was path.resolve(MCP_WORKSPACE) with no check, so a
    // project-scope export resolved into a directory tree the operator never named.
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skills-sync-cli-workspace-'));
    const missing = path.join(tempRoot, 'no-such-workspace');
    const saved = new Map(
      ['MCP_SERVER_ROOT', 'MCP_RESOURCES_PATH', 'MCP_WORKSPACE'].map((key) => [
        key,
        process.env[key],
      ])
    );
    // Only a registered project-scope client reaches the project root.
    const demo = path.join(tempRoot, 'resources', 'prompts', 'examples', 'demo');
    await mkdir(demo, { recursive: true });
    await writeFile(
      path.join(demo, 'prompt.yaml'),
      'id: demo\nname: Demo\ndescription: Fixture prompt.\nuserMessageTemplateFile: user-message.md\n',
      'utf-8'
    );
    await writeFile(path.join(demo, 'user-message.md'), 'Say hello.\n', 'utf-8');
    await writeFile(
      path.join(tempRoot, 'skills-sync.yaml'),
      'registrations:\n  agent-plugins:\n    project:\n      - prompt:examples/demo\n',
      'utf-8'
    );
    const projectDiff = () =>
      runSkillsSyncCommand(
        parseSkillsSyncArgs([
          'node',
          'scripts/skills-sync.ts',
          'diff',
          '--client',
          'agent-plugins',
          '--scope',
          'project',
        ]),
        output,
        resolveSkillsSyncPaths()
      );

    try {
      process.env['MCP_SERVER_ROOT'] = tempRoot;
      delete process.env['MCP_RESOURCES_PATH'];

      process.env['MCP_WORKSPACE'] = missing;
      await expect(projectDiff()).rejects.toThrow(
        `Refusing to run: the MCP_WORKSPACE environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.`
      );
      expect(existsSync(missing)).toBe(false);

      process.env['MCP_WORKSPACE'] = '';
      await expect(projectDiff()).resolves.toBeDefined();
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(tempRoot, { recursive: true, force: true });
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
          output,
          resolveSkillsSyncPaths()
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
