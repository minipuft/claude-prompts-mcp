import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/cpm.js');
const SERVER_PACKAGE = join(__dirname, '../../../server/package.json');
const VALID_WS = join(__dirname, '../fixtures/valid-workspace');
const INVALID_WS = join(__dirname, '../fixtures/invalid-workspace');
const EMPTY_WS = join(__dirname, '../fixtures/empty-workspace');

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? '') + (e.stderr ?? ''),
      exitCode: e.status ?? 1,
    };
  }
}

describe('cpm CLI', () => {
  describe('global flags', () => {
    it('prints help', () => {
      const { stdout, exitCode } = run(['--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage: cpm <command>');
      expect(stdout).toContain('validate');
      expect(stdout).toContain('list');
      expect(stdout).toContain('inspect');
      expect(stdout).toContain('init');
    });

    it('prints version', () => {
      const { stdout, exitCode } = run(['--version']);
      const releaseVersion = JSON.parse(readFileSync(SERVER_PACKAGE, 'utf8')).version;
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(releaseVersion);
    });

    it('errors on unknown command', () => {
      const { stdout, exitCode } = run(['foobar']);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('Unknown command: foobar');
    });
  });

  describe('validate', () => {
    it('validates a workspace with all valid resources', () => {
      const { stdout, exitCode } = run(['validate', '--all', '--workspace', VALID_WS]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('\u2713');
      expect(stdout).toContain('valid');
    });

    it('reports invalid resources', () => {
      const { stdout, exitCode } = run(['validate', '--prompts', '--workspace', INVALID_WS]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('\u2717');
    });

    it('handles empty workspace gracefully', () => {
      const { stdout, exitCode } = run(['validate', '--all', '--workspace', EMPTY_WS]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('No resources found');
    });

    it('outputs JSON when --json flag is used', () => {
      const { stdout, exitCode } = run(['validate', '--all', '--workspace', VALID_WS, '--json']);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty('valid');
      expect(data).toHaveProperty('summary');
      expect(data).toHaveProperty('results');
      expect(data.summary.total).toBeGreaterThan(0);
    });

    it('validates only specified type with --gates', () => {
      const { stdout, exitCode } = run(['validate', '--gates', '--workspace', VALID_WS]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('[gates]');
      expect(stdout).not.toContain('[prompts]');
    });
  });

  describe('list', () => {
    it('lists prompts', () => {
      const { stdout, exitCode } = run(['list', 'prompts', '--workspace', VALID_WS]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('hello');
    });

    it('lists gates as JSON', () => {
      const { stdout, exitCode } = run(['list', 'gates', '--workspace', VALID_WS, '--json']);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('id');
    });

    it('errors on missing type', () => {
      const { stdout, exitCode } = run(['list', '--workspace', VALID_WS]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('Usage');
    });

    it('errors on invalid type', () => {
      const { stdout, exitCode } = run(['list', 'widgets', '--workspace', VALID_WS]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('Unknown type');
    });
  });

  describe('inspect', () => {
    it('inspects a prompt by id', () => {
      const { stdout, exitCode } = run(['inspect', 'prompt', 'hello', '--workspace', VALID_WS]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Hello Prompt');
    });

    it('inspects a gate by id', () => {
      const { stdout, exitCode } = run([
        'inspect', 'gate', 'test-gate', '--workspace', VALID_WS, '--json',
      ]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.id).toBe('test-gate');
    });

    it('errors when resource not found', () => {
      const { stdout, exitCode } = run(['inspect', 'prompt', 'nonexistent', '--workspace', VALID_WS]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('not found');
    });

    it('errors on missing type', () => {
      const { stdout, exitCode } = run(['inspect', '--workspace', VALID_WS]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('Usage');
    });
  });

  describe('init', () => {
    const INIT_TARGET = join(__dirname, '../fixtures/.tmp-init-test');

    afterEach(() => {
      if (existsSync(INIT_TARGET)) {
        rmSync(INIT_TARGET, { recursive: true, force: true });
      }
    });

    it('initializes a new workspace', () => {
      const { stdout, exitCode } = run(['init', INIT_TARGET]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Workspace created');
      expect(existsSync(join(INIT_TARGET, 'resources', 'prompts'))).toBe(true);
    });

    it('outputs JSON when --json flag is used', () => {
      const { stdout, exitCode } = run(['init', INIT_TARGET, '--json']);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.success).toBe(true);
    });

    it('fails when directory already contains resources', () => {
      // First init
      run(['init', INIT_TARGET]);
      // Second init should fail
      const { exitCode } = run(['init', INIT_TARGET]);
      expect(exitCode).toBe(1);
    });
  });
});
