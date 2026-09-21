/**
 * handoff-artifacts check script.
 *
 * Spawns the real script the gate's `shell_verify` criterion names, the way the executor does:
 * `node resources/gates/handoff-artifacts/check-artifacts.js` with the handoff on stdin. The
 * cwd is a temp directory holding `a.ts`, because the check resolves every path it reads
 * against `process.cwd()` — that is the behaviour under test, not an incidental detail.
 */
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

const SCRIPT = resolve(
  here,
  '..',
  '..',
  '..',
  'resources',
  'gates',
  'handoff-artifacts',
  'check-artifacts.js'
);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCheck(handoff: string, cwd: string): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
    child.stdin.write(handoff);
    child.stdin.end();
  });
}

describe('handoff-artifacts check script', () => {
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'handoff-artifacts-'));
    writeFileSync(join(workDir, 'a.ts'), 'export const a = 1;\n');
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('passes when the one named artifact exists', async () => {
    const result = await runCheck(
      ['done — artifacts: a.ts', '', 'concerns   none', ''].join('\n'),
      workDir
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ok a.ts');
  });

  it('fails and names the artifact that does not exist', async () => {
    const result = await runCheck(
      ['done', 'artifacts: a.ts, b.ts', '', 'concerns   none', ''].join('\n'),
      workDir
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('b.ts');
    expect(result.stdout).toContain('missing b.ts');
  });

  it('fails when the handoff names no artifacts at all', async () => {
    const result = await runCheck(
      ['done — rewrote the loader', '', 'concerns   none', ''].join('\n'),
      workDir
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no artifacts: line');
  });

  it('reads the bullet form of the artifacts list', async () => {
    const result = await runCheck(
      ['done', 'artifacts:', '- a.ts', '', 'concerns   none', ''].join('\n'),
      workDir
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ok a.ts');
  });

  it('reads the done section only — an artifacts line under findings does not count', async () => {
    const result = await runCheck(
      [
        'done — rewrote the loader',
        '',
        'concerns   none',
        '',
        'findings',
        'artifacts: a.ts',
        '',
      ].join('\n'),
      workDir
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no artifacts: line');
  });
});
