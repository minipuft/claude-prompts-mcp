import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCpm } from '../helpers/child-process.js';

function run(args: string[], cwd: string): { stdout: string; exitCode: number } {
  const { status, stdout, stderr } = runCpm(args, { cwd });
  return { stdout: status === 0 ? stdout : stdout + stderr, exitCode: status };
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
