import { dirname, join, relative } from 'node:path';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

import { runCpm } from '../helpers/child-process.js';

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run `cpm` with no inherited location variable, a fake HOME, and the given cwd.
 */
function run(
  args: string[],
  opts: { cwd: string; home: string; env?: Record<string, string> }
): RunResult {
  const { status, stdout, stderr } = runCpm(args, {
    cwd: opts.cwd,
    env: { HOME: opts.home, ...opts.env },
  });
  return { stdout, stderr, exitCode: status };
}

/** Every file under `root`, relative path to bytes. */
function snapshotTree(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(root, path), readFileSync(path));
    }
  };
  walk(root);
  return files;
}

describe('cpm workspace (profile registry)', () => {
  let scratch: string;
  let parent: string;
  let home: string;

  /** `<parent>/dev` (two prompts, one gate, a config.jsonc), `<parent>/shared`, `<parent>/extra`. */
  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'cpm-workspace-')));
    parent = join(scratch, 'profiles');
    home = join(scratch, 'home');
    for (const name of ['dev', 'shared', 'extra'])
      mkdirSync(join(parent, name), { recursive: true });
    mkdirSync(join(parent, 'dev/resources/prompts/general/alpha'), { recursive: true });
    writeFileSync(
      join(parent, 'dev/resources/prompts/general/alpha/prompt.yaml'),
      'id: alpha\nname: Alpha\n'
    );
    writeFileSync(
      join(parent, 'dev/resources/prompts/general/beta.yaml'),
      'id: beta\nname: Beta\n'
    );
    mkdirSync(join(parent, 'dev/resources/gates/check'), { recursive: true });
    writeFileSync(join(parent, 'dev/resources/gates/check/gate.yaml'), 'id: check\n');
    writeFileSync(join(parent, 'dev/config.jsonc'), '{ "version": 5 }\n');
    mkdirSync(join(scratch, 'unrelated/inner'), { recursive: true });
    mkdirSync(join(scratch, 'elsewhere/stray'), { recursive: true });
  });

  afterEach(() => {
    if (scratch && existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
  });

  const registryPath = (): string => join(parent, 'workspaces.jsonc');
  const devFlag = (): string[] => ['-w', join(parent, 'dev')];

  describe('registry lookup (4.1)', () => {
    it('resolves both labels of a registry written beside two folders', () => {
      writeFileSync(registryPath(), '// two profiles\n{ "dev": "./dev", "shared": "./shared" }\n');
      const { stdout, exitCode } = run(['workspace', 'list', ...devFlag(), '--json'], {
        cwd: scratch,
        home,
      });
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.workspaces).toEqual([
        { label: 'dev', folder: join(parent, 'dev'), current: true },
        { label: 'shared', folder: join(parent, 'shared'), current: false },
      ]);
    });

    it('reports the missing-registry message from an unrelated cwd with no -w and no variable', () => {
      writeFileSync(registryPath(), '{ "dev": "./dev" }\n');
      const cwd = join(scratch, 'unrelated/inner');
      const { stdout, exitCode } = run(['workspace', 'list'], { cwd, home });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(
        `no workspaces.jsonc beside ${join(scratch, 'unrelated')}; run cpm workspace add <label> <dir>`
      );
    });

    it('control: the same unrelated cwd with -w finds the registry', () => {
      writeFileSync(registryPath(), '{ "dev": "./dev" }\n');
      const cwd = join(scratch, 'unrelated/inner');
      const { stdout, exitCode } = run(['workspace', 'list', ...devFlag()], { cwd, home });
      expect(exitCode).toBe(0);
      expect(stdout).toContain(`dev  ${join(parent, 'dev')}  (current)`);
      expect(stdout).not.toContain('no workspaces.jsonc');
    });

    it('never reads a registry from the home directory', () => {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, 'workspaces.jsonc'), '{ "home": "./home" }\n');
      const { stdout } = run(['workspace', 'list'], {
        cwd: join(scratch, 'unrelated/inner'),
        home,
      });
      expect(stdout).toContain('no workspaces.jsonc beside');
    });
  });

  describe('add, list, show, remove (4.2)', () => {
    it('adds two folders, lists both with (current), shows one, removes one', () => {
      const add1 = run(['workspace', 'add', 'dev', './profiles/dev', ...devFlag()], {
        cwd: scratch,
        home,
      });
      expect(add1.exitCode).toBe(0);
      const add2 = run(['workspace', 'add', 'shared', './profiles/shared', ...devFlag()], {
        cwd: scratch,
        home,
      });
      expect(add2.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(registryPath(), 'utf8'))).toEqual({
        dev: './dev',
        shared: './shared',
      });

      const listed = run(['workspace', 'list', ...devFlag()], { cwd: scratch, home });
      expect(listed.stdout).toContain(`dev     ${join(parent, 'dev')}  (current)`);
      expect(listed.stdout).toContain(`shared  ${join(parent, 'shared')}\n`);

      const shown = run(['workspace', 'show', 'dev', ...devFlag(), '--json'], {
        cwd: scratch,
        home,
      });
      expect(shown.exitCode).toBe(0);
      expect(JSON.parse(shown.stdout)).toEqual({
        label: 'dev',
        folder: join(parent, 'dev'),
        config: join(parent, 'dev/config.jsonc'),
        prompts: 2,
        gates: 1,
        frameworks: 0,
        styles: 0,
      });
      const shownShared = run(['workspace', 'show', 'shared', ...devFlag()], {
        cwd: scratch,
        home,
      });
      expect(shownShared.stdout).toMatch(/config\s+none/);

      const removed = run(['workspace', 'remove', 'shared', ...devFlag()], { cwd: scratch, home });
      expect(removed.exitCode).toBe(0);
      expect(existsSync(join(parent, 'shared'))).toBe(true);
      const after = run(['workspace', 'list', ...devFlag()], { cwd: scratch, home });
      expect(after.stdout).not.toContain('shared');
      expect(after.stdout).toContain('dev');
    });

    it('refuses a folder outside the registry parent, naming the parent', () => {
      const { stderr, exitCode } = run(
        ['workspace', 'add', 'stray', './elsewhere/stray', ...devFlag()],
        {
          cwd: scratch,
          home,
        }
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain(`is not directly inside ${parent}`);
      expect(existsSync(registryPath())).toBe(false);
    });

    it('refuses a duplicate label, naming the folder it already holds', () => {
      run(['workspace', 'add', 'dev', './profiles/dev', ...devFlag()], { cwd: scratch, home });
      const { stderr, exitCode } = run(
        ['workspace', 'add', 'dev', './profiles/shared', ...devFlag()],
        {
          cwd: scratch,
          home,
        }
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain(`Label 'dev' is already registered for ${join(parent, 'dev')}`);
    });

    it('refuses a label outside the rule, naming the rule', () => {
      const { stderr, exitCode } = run(
        ['workspace', 'add', 'Dev!', './profiles/dev', ...devFlag()],
        {
          cwd: scratch,
          home,
        }
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain('lowercase letters, digits, "-" and "_"');
    });

    it('refuses a folder that does not exist', () => {
      const { stderr, exitCode } = run(
        ['workspace', 'add', 'ghost', './profiles/ghost', ...devFlag()],
        {
          cwd: scratch,
          home,
        }
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain('does not exist');
    });

    it('keeps a hand-written comment through add and remove', () => {
      writeFileSync(registryPath(), '{\n  // MARKER: keep me\n  "dev": "./dev"\n}\n');
      run(['workspace', 'add', 'shared', './profiles/shared', ...devFlag()], {
        cwd: scratch,
        home,
      });
      expect(readFileSync(registryPath(), 'utf8')).toContain('// MARKER: keep me');
      run(['workspace', 'remove', 'shared', ...devFlag()], { cwd: scratch, home });
      const text = readFileSync(registryPath(), 'utf8');
      expect(text).toContain('// MARKER: keep me');
      expect(text).not.toContain('shared');
    });

    it('refuses to remove an unknown label, naming the registered ones', () => {
      writeFileSync(registryPath(), '{ "dev": "./dev", "shared": "./shared" }\n');
      const { stderr, exitCode } = run(['workspace', 'remove', 'prod', ...devFlag()], {
        cwd: scratch,
        home,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("No workspace labelled 'prod'; registered: dev, shared.");
    });
  });

  describe('use (4.3)', () => {
    it('prints the MCP_WORKSPACE line and leaves every client config byte-identical', () => {
      writeFileSync(registryPath(), '{ "dev": "./dev", "shared": "./shared" }\n');
      const clientConfigs: Record<string, string> = {
        '.claude.json':
          '{ "mcpServers": { "claude-prompts": { "env": { "MCP_WORKSPACE": "/old" } } } }\n',
        '.config/claude/claude_desktop_config.json': '{ "mcpServers": {} }\n',
        '.cursor/mcp.json': '{ "mcpServers": {} }\n',
        '.codex/config.toml': '[mcp_servers.claude-prompts]\ncommand = "npx"\n',
        '.gemini/settings.json': '{ "mcpServers": {} }\n',
      };
      for (const [path, text] of Object.entries(clientConfigs)) {
        mkdirSync(dirname(join(home, path)), { recursive: true });
        writeFileSync(join(home, path), text);
      }
      const before = snapshotTree(scratch);

      const { stdout, exitCode } = run(['workspace', 'use', 'dev', ...devFlag()], {
        cwd: scratch,
        home,
      });
      expect(exitCode).toBe(0);
      expect(stdout.split('\n')[0]).toBe(`MCP_WORKSPACE=${join(parent, 'dev')}`);

      const after = snapshotTree(scratch);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [path, bytes] of before) expect(after.get(path)?.equals(bytes)).toBe(true);
    });

    it('refuses an unknown label, naming the registered ones', () => {
      writeFileSync(registryPath(), '{ "dev": "./dev", "shared": "./shared" }\n');
      const { stderr, exitCode } = run(['workspace', 'use', 'prod', ...devFlag()], {
        cwd: scratch,
        home,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("No workspace labelled 'prod'; registered: dev, shared.");
    });
  });

  // Removed with MCP_RESOURCES_PATH: the unregistered-folder listing and `add` with no directory.
  describe('add without a directory', () => {
    it('refuses add with no dir, naming the missing directory', () => {
      const { stderr, exitCode } = run(['workspace', 'add', 'shared', ...devFlag()], {
        cwd: scratch,
        home,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain('A directory is required.');
    });

    it('list ignores a set MCP_RESOURCES_PATH: no unregistered heading', () => {
      writeFileSync(registryPath(), '{ "dev": "./dev" }\n');
      const env = { MCP_RESOURCES_PATH: join(parent, 'extra') };
      const listed = run(['workspace', 'list', ...devFlag()], { cwd: scratch, home, env });
      expect(listed.exitCode).toBe(0);
      expect(listed.stdout).not.toContain('unregistered:');
    });
  });
});
