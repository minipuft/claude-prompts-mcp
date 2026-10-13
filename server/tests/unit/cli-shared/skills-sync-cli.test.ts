import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  listSupportedSkillsSyncClients,
  parseSkillsSyncArgs,
  runSkillsSyncCommand,
  runSkillsSyncFromArgv,
  SkillsSyncCommandError,
  type SkillsSyncOptions,
  type SkillsSyncOutput,
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

// ─── Real-tree fixtures ─────────────────────────────────────────────────────
//
// Every case below runs the real command against a temp package root that holds its own
// `resources/` and `skills-sync.yaml`. A root without `resources/` silently falls back to the cwd,
// which is the real `server/`, so the layout is built before any command runs. The shell that runs
// the suite may export MCP_RESOURCES_PATH or MCP_WORKSPACE, so every variable the path resolution
// reads is saved, cleared and restored per case.

const ENV_KEYS = [
  'MCP_SERVER_ROOT',
  'MCP_RESOURCES_PATH',
  'MCP_WORKSPACE',
  'MCP_RUNTIME_ROOT',
  'MCP_CONFIG_PATH',
  'HOME',
] as const;

type SavedProcessState = { env: Map<string, string | undefined>; cwd: string };

function saveProcessState(): SavedProcessState {
  return {
    env: new Map(ENV_KEYS.map((key) => [key, process.env[key]])),
    cwd: process.cwd(),
  };
}

function restoreProcessState(saved: SavedProcessState): void {
  for (const [key, value] of saved.env) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  process.chdir(saved.cwd);
}

function captureOutput(): SkillsSyncOutput & { logs: string[]; warns: string[] } {
  const logs: string[] = [];
  const warns: string[] = [];
  return {
    logs,
    warns,
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => warns.push(args.map(String).join(' ')),
    error: () => undefined,
  };
}

async function writePrompt(root: string, category: string, id: string): Promise<void> {
  const dir = path.join(root, 'resources', 'prompts', category, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'prompt.yaml'),
    `id: ${id}\nname: ${id}\ndescription: Fixture prompt ${id}.\ncategory: ${category}\nuserMessageTemplateFile: user-message.md\n`,
    'utf-8'
  );
  await writeFile(path.join(dir, 'user-message.md'), 'Say hello.\n', 'utf-8');
}

/** Every file and directory under `root`, sorted, relative to it. */
async function listTree(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true })).sort();
}

/** The skill directories a preview named, e.g. `alpha` for `  [preview] alpha/SKILL.md`. */
function previewedSkills(logs: readonly string[]): string[] {
  return logs
    .filter((line) => line.startsWith('  [preview] ') && line.endsWith('/SKILL.md'))
    .map((line) => line.replace('  [preview] ', '').replace('/SKILL.md', ''))
    .sort();
}

/** The directory a `── <client> (<scope>) → <dir>` header named for the scope. */
function exportHeaderDir(logs: readonly string[], client: string, scope: string): string {
  const prefix = `── ${client} (${scope}) → `;
  const header = logs.map((line) => line.trim()).find((line) => line.startsWith(prefix));
  if (header === undefined) {
    throw new Error(`no "${prefix}" header in: ${JSON.stringify(logs)}`);
  }
  return header.slice(prefix.length);
}

describe('skills-sync usage validation and config resolution against a real temp tree', () => {
  let tempRoot: string;
  let packageRoot: string;
  let homeDir: string;
  let outDir: string;
  let cwdDir: string;
  let saved: SavedProcessState;

  const configPath = () => path.join(packageRoot, 'skills-sync.yaml');
  const writeConfig = (text: string) => writeFile(configPath(), text, 'utf-8');
  const outputOverride = (dir = outDir) =>
    `overrides:\n  claude-code:\n    outputDir:\n      user: ${dir}\n      project: ${dir}\n`;
  const run = async (opts: SkillsSyncOptions) => {
    const out = captureOutput();
    const report = await runSkillsSyncCommand(opts, out, resolveSkillsSyncPaths());
    return { out, report };
  };
  const previewExport = (extra: Partial<SkillsSyncOptions> = {}) =>
    run({ command: 'export', client: 'claude-code', preview: true, ...extra });

  beforeEach(async () => {
    saved = saveProcessState();
    tempRoot = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'skills-sync-cfg-')));
    packageRoot = path.join(tempRoot, 'package');
    homeDir = path.join(tempRoot, 'home');
    outDir = path.join(tempRoot, 'out');
    cwdDir = path.join(tempRoot, 'cwd');
    await Promise.all([homeDir, outDir, cwdDir].map((dir) => mkdir(dir, { recursive: true })));
    await writePrompt(packageRoot, 'examples', 'alpha');
    await writePrompt(packageRoot, 'examples', 'beta');
    await writeConfig(`registrations:\n  claude-code: all\n${outputOverride()}`);

    process.env['MCP_SERVER_ROOT'] = packageRoot;
    process.env['HOME'] = homeDir;
    for (const key of [
      'MCP_RESOURCES_PATH',
      'MCP_WORKSPACE',
      'MCP_RUNTIME_ROOT',
      'MCP_CONFIG_PATH',
    ]) {
      delete process.env[key];
    }
  });

  afterEach(async () => {
    restoreProcessState(saved);
    await rm(tempRoot, { recursive: true, force: true });
  });

  describe('validateSkillsSyncOptions', () => {
    const skillFile = () => path.join(tempRoot, 'fixtures', 'clone-me', 'SKILL.md');
    const usage = (message: string) => ({ message });

    // One violation per row. `valid` is the same row with that one option made legal, so a
    // refusal that fired because something ELSE was wrong would show up as the twin failing too.
    const rows: Array<{
      name: string;
      opts: () => SkillsSyncOptions;
      message: () => string;
      valid: () => SkillsSyncOptions;
    }> = [
      {
        name: 'an unknown command',
        opts: () => ({ command: 'bogus' }),
        message: () => 'Unknown command: bogus. Run skills-sync help for usage.',
        valid: () => ({ command: 'help' }),
      },
      {
        name: 'an unknown client',
        opts: () => ({ command: 'export', client: 'vscode', preview: true }),
        message: () =>
          `Unknown client: vscode (available: ${listSupportedSkillsSyncClients().join(', ')}, all)`,
        valid: () => ({ command: 'export', client: 'claude-code', preview: true }),
      },
      {
        name: 'an invalid scope',
        opts: () => ({ command: 'export', scope: 'global' as never, preview: true }),
        message: () => 'Invalid scope: global. Expected one of: user, project.',
        valid: () => ({ command: 'export', scope: 'user', preview: true }),
      },
      {
        name: 'an invalid resource type',
        opts: () => ({ command: 'export', resourceType: 'tool' as never, preview: true }),
        message: () =>
          'Invalid resource type: tool. Expected one of: prompt, gate, framework, style.',
        valid: () => ({ command: 'export', resourceType: 'prompt', preview: true }),
      },
      {
        name: '--preview-detail without --preview',
        opts: () => ({ command: 'export', previewDetail: 'summary' }),
        message: () => '--preview-detail requires --preview; on its own it would not be read.',
        valid: () => ({ command: 'export', previewDetail: 'summary', preview: true }),
      },
      {
        name: '--preview-detail with preview explicitly false',
        opts: () => ({ command: 'export', previewDetail: 'summary', preview: false }),
        message: () => '--preview-detail requires --preview; on its own it would not be read.',
        valid: () => ({ command: 'export', previewDetail: 'summary', preview: true }),
      },
      {
        name: '--preview-detail diff on a command other than pull',
        opts: () => ({ command: 'export', preview: true, previewDetail: 'diff' }),
        message: () => '--preview-detail diff is only valid for the pull command.',
        valid: () => ({
          command: 'pull',
          preview: true,
          previewDetail: 'diff',
          client: 'claude-code',
        }),
      },
      {
        name: '--output on a command other than diff or patch',
        opts: () => ({ command: 'export', output: path.join(outDir, 'patches'), preview: true }),
        message: () => '--output is only valid for the diff command.',
        valid: () => ({
          command: 'diff',
          output: path.join(outDir, 'patches'),
          client: 'claude-code',
        }),
      },
      {
        name: '--file on a command other than clone',
        opts: () => ({ command: 'export', file: skillFile(), preview: true }),
        message: () => '--file, --category, and --force are only valid for the clone command.',
        valid: () => ({ command: 'clone', file: skillFile(), preview: true }),
      },
      {
        name: '--category on a command other than clone',
        opts: () => ({ command: 'export', category: 'general', preview: true }),
        message: () => '--file, --category, and --force are only valid for the clone command.',
        valid: () => ({ command: 'clone', file: skillFile(), category: 'general', preview: true }),
      },
      {
        name: '--force on a command other than clone',
        opts: () => ({ command: 'export', force: true, preview: true }),
        message: () => '--file, --category, and --force are only valid for the clone command.',
        valid: () => ({ command: 'clone', file: skillFile(), force: true, preview: true }),
      },
      {
        name: '--prune on a command other than sync',
        opts: () => ({ command: 'export', prune: true, preview: true }),
        message: () => '--prune/--no-prune are only valid for the sync command.',
        valid: () => ({ command: 'sync', prune: true, preview: true, client: 'claude-code' }),
      },
      {
        name: '--no-prune on a command other than sync',
        opts: () => ({ command: 'diff', prune: false, client: 'claude-code' }),
        message: () => '--prune/--no-prune are only valid for the sync command.',
        valid: () => ({ command: 'sync', prune: false, preview: true, client: 'claude-code' }),
      },
      {
        name: 'clone without --file',
        opts: () => ({ command: 'clone' }),
        message: () => 'clone requires --file <path> to a SKILL.md',
        valid: () => ({ command: 'clone', file: skillFile(), preview: true }),
      },
      {
        name: 'clone with an empty --file',
        opts: () => ({ command: 'clone', file: '' }),
        message: () => 'clone requires --file <path> to a SKILL.md',
        valid: () => ({ command: 'clone', file: skillFile(), preview: true }),
      },
    ];

    beforeEach(async () => {
      await mkdir(path.dirname(skillFile()), { recursive: true });
      await writeFile(
        skillFile(),
        '---\nname: Clone Me\ndescription: A skill to clone.\n---\n\n## Usage\n\nReview this.\n',
        'utf-8'
      );
    });

    it.each(rows.map((row) => [row.name, row] as const))(
      'refuses %s with a usage error (exit 2) and writes nothing',
      async (_name, row) => {
        const before = await listTree(tempRoot);

        await expect(run(row.opts())).rejects.toMatchObject({
          name: 'SkillsSyncCommandError',
          exitCode: 2,
          ...usage(row.message()),
        });
        await expect(run(row.opts())).rejects.toBeInstanceOf(SkillsSyncCommandError);

        expect(await listTree(tempRoot)).toEqual(before);
      }
    );

    it.each(rows.map((row) => [row.name, row] as const))(
      'does not refuse the legal twin of %s',
      async (_name, row) => {
        // The twin may still fail for a reason of its own (a clone target that exists, say), but
        // never with the refusal the row pins.
        const outcome = await run(row.valid()).then(
          () => undefined,
          (error: unknown) => (error instanceof Error ? error.message : String(error))
        );

        expect(outcome).not.toBe(row.message());
      }
    );

    it('writes under the same tree when the command is valid (positive control for the listing)', async () => {
      const before = await listTree(tempRoot);

      await run({ command: 'export', client: 'claude-code' });

      const after = await listTree(tempRoot);
      expect(after).not.toEqual(before);
      expect(after).toContain(path.join('out', 'alpha', 'SKILL.md'));
      expect(after).toContain(path.join('out', 'beta', 'SKILL.md'));
    });

    it('treats explicit false/absent flags as not given', async () => {
      // `force === true` is the trigger, so a CLI that parsed --force to false must not refuse.
      await expect(
        run({ command: 'export', client: 'claude-code', preview: true, force: false })
      ).resolves.toBeDefined();
    });
  });

  describe('loadSyncConfig', () => {
    it('names the example to copy when skills-sync.yaml is missing, and writes nothing', async () => {
      await rm(configPath());
      const before = await listTree(tempRoot);

      const failure = await previewExport().then(
        () => undefined,
        (error: unknown) => error as Error
      );

      expect(failure?.message).toContain(
        `No skills-sync.yaml found. Copy the example to get started:\n  cp ${path.join(packageRoot, 'skills-sync.example.yaml')} ${configPath()}`
      );
      expect((failure?.cause as NodeJS.ErrnoException | undefined)?.code).toBe('ENOENT');
      expect(failure).not.toBeInstanceOf(SkillsSyncCommandError);
      expect(await listTree(tempRoot)).toEqual(before);

      // Control: with the file back the same call goes through.
      await writeConfig('registrations:\n  claude-code: all\n');
      await expect(previewExport()).resolves.toBeDefined();
    });

    it('points the copy at the workspace when one is set', async () => {
      const workspace = path.join(tempRoot, 'workspace');
      await mkdir(workspace, { recursive: true });
      process.env['MCP_WORKSPACE'] = workspace;
      await rm(configPath());

      await expect(previewExport()).rejects.toThrow(
        `cp ${path.join(packageRoot, 'skills-sync.example.yaml')} ${path.join(workspace, 'skills-sync.yaml')}`
      );
    });

    it('wraps a YAML syntax error in the same message, keeping the parser reason', async () => {
      await writeConfig('registrations: [unclosed\n');

      const failure = await previewExport().then(
        () => undefined,
        (error: unknown) => error as Error
      );

      expect(failure?.message).toContain('No skills-sync.yaml found. Copy the example');
      expect(failure?.message).toMatch(/\n\(.+\)$/s);
      expect(failure?.cause).toBeInstanceOf(Error);
    });

    it('refuses an empty skills-sync.yaml with the same message, because the YAML loader rejects an empty document', async () => {
      await writeConfig('');

      const failure = await previewExport().then(
        () => undefined,
        (error: unknown) => error as Error
      );

      expect(failure?.message).toContain('No skills-sync.yaml found. Copy the example');
      expect((failure?.cause as Error | undefined)?.message).toContain('input is empty');

      // Control: a comment-only file is a document and loads as an empty config.
      await writeConfig('# nothing registered\nunrelated: 1\n');
      await expect(previewExport()).resolves.toBeDefined();
    });

    it('reads an explicit null document as an empty config, which exports every resource', async () => {
      await writeConfig('~\n');

      const { out } = await previewExport();

      expect(previewedSkills(out.logs)).toEqual(['alpha', 'beta']);
    });
  });

  describe('resolveClientResourceSelection', () => {
    const previewedFor = async (config: string, extra: Partial<SkillsSyncOptions> = {}) => {
      await writeConfig(`${config}${outputOverride()}`);
      const { out } = await previewExport(extra);
      return {
        skills: previewedSkills(out.logs),
        skipped: out.logs.some((line) => line.includes('claude-code: skipped — no registrations')),
      };
    };

    it('exports everything for the registration "all" (positive control for the skips below)', async () => {
      expect(await previewedFor('registrations:\n  claude-code: all\n')).toEqual({
        skills: ['alpha', 'beta'],
        skipped: false,
      });
    });

    it.each([
      ['a string that is not "all"', "registrations:\n  claude-code: 'al'\n"],
      [
        'a list instead of a user/project map',
        'registrations:\n  claude-code:\n    - prompt:examples/alpha\n',
      ],
      ['an empty value', 'registrations:\n  claude-code:\n'],
      ['an entry for another client only', 'registrations:\n  cursor: all\n'],
      ['an empty registrations map', 'registrations: {}\n'],
    ])(
      'skips the client, exporting nothing, when its registration is %s',
      async (_name, config) => {
        expect(await previewedFor(config)).toEqual({ skills: [], skipped: true });
      }
    );

    it('does not fall back to a legacy exports key once registrations exists', async () => {
      expect(await previewedFor('registrations:\n  cursor: all\nexports: all\n')).toEqual({
        skills: [],
        skipped: true,
      });
    });

    it('selects only the listed keys for a scoped registration, and nothing in the other scope', async () => {
      const config = 'registrations:\n  claude-code:\n    user:\n      - prompt:examples/alpha\n';

      expect((await previewedFor(config)).skills).toEqual(['alpha']);
      expect((await previewedFor(config, { scope: 'project' })).skills).toEqual([]);
    });

    it('reads the legacy `exports: all` shape as everything', async () => {
      expect(await previewedFor('exports: all\n')).toEqual({
        skills: ['alpha', 'beta'],
        skipped: false,
      });
    });

    it('reads the legacy `exports: {user, project}` shape as a scoped selection', async () => {
      const config =
        'exports:\n  user:\n    - prompt:examples/alpha\n  project:\n    - prompt:examples/beta\n';

      expect((await previewedFor(config)).skills).toEqual(['alpha']);
      expect((await previewedFor(config, { scope: 'project' })).skills).toEqual(['beta']);
    });

    it.each([
      ['an `exports` list', 'exports:\n  - prompt:examples/alpha\n'],
      ['an `exports` string that is not "all"', "exports: 'al'\n"],
      ['no registrations and no exports', 'unrelated: 1\n'],
    ])('selects every resource for %s, not the listed ones', async (_name, config) => {
      // A typo'd legacy shape exports MORE, where a typo'd registration exports nothing.
      expect(await previewedFor(config)).toEqual({ skills: ['alpha', 'beta'], skipped: false });
    });

    it('ignores the selection when --id names a resource, even for an unregistered client', async () => {
      const result = await previewedFor("registrations:\n  claude-code: 'al'\n", { id: 'alpha' });

      expect(result).toEqual({ skills: ['alpha'], skipped: false });
    });
  });

  describe('resolveOutputDir', () => {
    const headerDirs = async (config: string, scope: 'user' | 'project') => {
      await writeConfig(config);
      const { out } = await previewExport({ scope });
      return exportHeaderDir(out.logs, 'claude-code', scope);
    };
    const registered = 'registrations:\n  claude-code: all\n';

    beforeEach(() => {
      // The project root resolves from MCP_WORKSPACE, which must name an existing directory.
      process.env['MCP_WORKSPACE'] = path.join(tempRoot, 'workspace');
      return mkdir(process.env['MCP_WORKSPACE'], { recursive: true }).then(() => undefined);
    });

    it('keeps the registry default for a scope the override leaves out, per scope', async () => {
      const userOnly = `${registered}overrides:\n  claude-code:\n    outputDir:\n      user: ${outDir}\n`;
      const projectOnly = `${registered}overrides:\n  claude-code:\n    outputDir:\n      project: ${outDir}\n`;
      const workspace = process.env['MCP_WORKSPACE'] as string;

      expect(await headerDirs(userOnly, 'user')).toBe(outDir);
      expect(await headerDirs(userOnly, 'project')).toBe(path.join(workspace, '.claude', 'skills'));
      expect(await headerDirs(projectOnly, 'project')).toBe(outDir);
      expect(await headerDirs(projectOnly, 'user')).toBe(path.join(homeDir, '.claude', 'skills'));
    });

    it('expands a leading ~ against HOME, in the default and in an override', async () => {
      expect(await headerDirs(registered, 'user')).toBe(path.join(homeDir, '.claude', 'skills'));

      const overridden = `${registered}overrides:\n  claude-code:\n    outputDir:\n      user: '~/custom/skills'\n`;
      expect(await headerDirs(overridden, 'user')).toBe(path.join(homeDir, 'custom', 'skills'));
    });

    it('resolves a relative user dir against the cwd, not the package or the workspace', async () => {
      process.chdir(cwdDir);
      const relative = `${registered}overrides:\n  claude-code:\n    outputDir:\n      user: rel/skills\n`;

      expect(await headerDirs(relative, 'user')).toBe(path.join(cwdDir, 'rel', 'skills'));
    });

    it('reports the real path when the output dir is a symlink to an existing directory', async () => {
      const link = path.join(tempRoot, 'link-to-out');
      await symlink(outDir, link);
      const config = `${registered}overrides:\n  claude-code:\n    outputDir:\n      user: ${link}\n`;

      expect(await headerDirs(config, 'user')).toBe(outDir);
    });

    it('skips a second client whose directory resolves to one an earlier client claimed', async () => {
      // Two clients on one physical directory: the second one is warned about, not written twice.
      await writeConfig(
        `registrations:\n  claude-code: all\n  cursor: all\noverrides:\n  claude-code:\n    outputDir:\n      user: ${outDir}\n  cursor:\n    outputDir:\n      user: ${outDir}\n`
      );

      const { out } = await run({ command: 'export', preview: true });

      expect(out.warns.some((line) => line.includes('skipping cursor (user)'))).toBe(true);
    });
  });

  describe('resolveProjectRoot', () => {
    const projectDir = async () => {
      const { out } = await previewExport({ scope: 'project' });
      return exportHeaderDir(out.logs, 'claude-code', 'project');
    };
    const useDefaultOutputDirs = () => writeConfig('registrations:\n  claude-code: all\n');

    it('anchors a relative project dir at an existing MCP_WORKSPACE', async () => {
      const workspace = path.join(tempRoot, 'workspace');
      await mkdir(workspace, { recursive: true });
      process.env['MCP_WORKSPACE'] = workspace;
      process.chdir(cwdDir);
      await useDefaultOutputDirs();

      expect(await projectDir()).toBe(path.join(workspace, '.claude', 'skills'));
    });
  });
});

describe('skills-sync argv entry points', () => {
  let saved: SavedProcessState;

  beforeEach(() => {
    saved = saveProcessState();
  });

  afterEach(() => {
    restoreProcessState(saved);
  });

  it('parses no command as help, and --no-prune as prune false', () => {
    expect(parseSkillsSyncArgs(['node', 'scripts/skills-sync.ts']).command).toBe('help');
    expect(parseSkillsSyncArgs(['node', 'scripts/skills-sync.ts', '--json'])).toMatchObject({
      command: 'help',
      json: true,
    });

    const prune = (...flags: string[]) =>
      parseSkillsSyncArgs(['node', 'scripts/skills-sync.ts', 'sync', ...flags]).prune;
    expect(prune()).toBeUndefined();
    expect(prune('--prune')).toBe(true);
    expect(prune('--no-prune')).toBe(false);
    expect(prune('--prune', '--no-prune')).toBe(false);
  });

  it('runs argv end to end: prints the help banner through the output it was given', async () => {
    const out = captureOutput();

    await runSkillsSyncFromArgv(['node', 'scripts/skills-sync.ts'], out, resolveSkillsSyncPaths());

    expect(out.logs).toHaveLength(1);
    expect(out.logs[0]).toContain('skills-sync — Export canonical resources');
  });

  it('refuses a bad argv as a usage error before reading any tree', async () => {
    await expect(
      runSkillsSyncFromArgv(
        ['node', 'scripts/skills-sync.ts', 'export', '--scope', 'global'],
        captureOutput(),
        resolveSkillsSyncPaths()
      )
    ).rejects.toMatchObject({
      exitCode: 2,
      message: 'Invalid scope: global. Expected one of: user, project.',
    });
  });

  it('lists the client registry in registry order, and the help banner names the same ids', async () => {
    const clients = listSupportedSkillsSyncClients();
    const out = captureOutput();
    await runSkillsSyncFromArgv(
      ['node', 'scripts/skills-sync.ts', 'help'],
      out,
      resolveSkillsSyncPaths()
    );

    expect(clients).toEqual(['claude-code', 'cursor', 'codex', 'opencode', 'agent-plugins']);
    expect(out.logs[0]).toContain(`Target client (${clients.join(', ')}, all)`);
  });
});
