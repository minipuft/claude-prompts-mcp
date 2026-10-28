import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/cpm.js');

function run(args: string[], cwd: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      timeout: 10_000,
      cwd,
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

describe('cpm init --project', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'cpm-init-project-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('scaffolds ./.claude-prompts with starter prompts and config.jsonc, then says where it loads', () => {
    const { stdout, exitCode } = run(['init', '--project'], cwd);
    expect(exitCode).toBe(0);
    const promptsDir = join(cwd, '.claude-prompts', 'resources', 'prompts');
    expect(readdirSync(promptsDir).length).toBeGreaterThan(0);
    expect(existsSync(join(cwd, '.claude-prompts', 'config.jsonc'))).toBe(true);
    expect(existsSync(join(cwd, 'resources'))).toBe(false);
    expect(stdout).toContain('load above the user workspace and the bundled ones');
  });

  it('refuses --project combined with a path, writing nothing', () => {
    const { stdout, exitCode } = run(['init', '--project', 'some/path'], cwd);
    expect(exitCode).not.toBe(0);
    expect(stdout).toContain('--project scaffolds ./.claude-prompts and takes no path');
    expect(existsSync(join(cwd, '.claude-prompts'))).toBe(false);
    expect(existsSync(join(cwd, 'some'))).toBe(false);
  });
});
