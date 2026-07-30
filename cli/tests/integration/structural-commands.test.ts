import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/cpm.js');
const VERSIONED_WS = join(__dirname, '../fixtures/versioned-workspace');

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    // Merge stderr into stdout for backward-compatible assertions on error paths
    stdout: result.status === 0 ? stdout : stdout + stderr,
    stderr,
    exitCode: result.status ?? 1,
  };
}

function copyWorkspace(source: string): string {
  const tmp = join(__dirname, `../fixtures/.tmp-structural-${Date.now()}`);
  cpSync(source, tmp, { recursive: true });
  return tmp;
}

// ── cpm rename ────────────────────────────────────────────────────────────

describe('cpm rename', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = copyWorkspace(VERSIONED_WS);
  });

  afterEach(() => {
    if (existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('renames a prompt', () => {
    const { stdout, exitCode } = run([
      'rename', 'prompt', 'test-prompt', 'renamed-prompt',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Renamed prompt 'test-prompt' -> 'renamed-prompt'");

    // Old dir gone, new dir exists
    expect(existsSync(join(tmpWs, 'resources/prompts/general/test-prompt'))).toBe(false);
    expect(existsSync(join(tmpWs, 'resources/prompts/general/renamed-prompt/prompt.yaml'))).toBe(true);

    // YAML id updated
    const content = readFileSync(join(tmpWs, 'resources/prompts/general/renamed-prompt/prompt.yaml'), 'utf8');
    expect(content).toContain('id: renamed-prompt');
  });

  it('renames a gate', () => {
    const { stdout, exitCode } = run([
      'rename', 'gate', 'test-gate', 'quality-gate',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Renamed gate 'test-gate' -> 'quality-gate'");
    expect(existsSync(join(tmpWs, 'resources/gates/quality-gate/gate.yaml'))).toBe(true);
  });

  it('outputs JSON', () => {
    const { stdout, exitCode } = run([
      'rename', 'prompt', 'test-prompt', 'json-renamed',
      '--json', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.id).toBe('json-renamed');
    expect(data.oldId).toBe('test-prompt');
    expect(data.type).toBe('prompt');
  });

  it('errors when source not found', () => {
    const { exitCode, stdout } = run([
      'rename', 'prompt', 'nonexistent', 'something',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('not found');
  });

  it('errors when target already exists', () => {
    // Create a second prompt to collide with
    run(['create', 'prompt', 'collision', '--workspace', tmpWs]);

    const { exitCode, stdout } = run([
      'rename', 'prompt', 'test-prompt', 'collision',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('already exists');
  });

  it('prints reference warning', () => {
    const { stdout } = run([
      'rename', 'prompt', 'test-prompt', 'new-name',
      '--workspace', tmpWs,
    ]);
    expect(stdout).toContain('Renamed');
    expect(stdout).toContain('new-name');
  });

  it('succeeds when resource has no version history', () => {
    // Version history is SQLite-backed (runtime-state/state.db), not sidecar files.
    // Rename should succeed even without a state.db present.
    const { exitCode, stdout } = run([
      'rename', 'prompt', 'test-prompt', 'hist-renamed',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Renamed prompt 'test-prompt' -> 'hist-renamed'");
  });

  it('preserves YAML comments', () => {
    // Add a comment to the YAML file before renaming
    const yamlPath = join(tmpWs, 'resources/prompts/general/test-prompt/prompt.yaml');
    const original = readFileSync(yamlPath, 'utf8');
    writeFileSync(yamlPath, '# My custom comment\n' + original, 'utf8');

    run(['rename', 'prompt', 'test-prompt', 'commented-prompt', '--workspace', tmpWs]);

    const newContent = readFileSync(
      join(tmpWs, 'resources/prompts/general/commented-prompt/prompt.yaml'), 'utf8',
    );
    expect(newContent).toContain('# My custom comment');
  });
});

// ── cpm move ──────────────────────────────────────────────────────────────

describe('cpm move', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = copyWorkspace(VERSIONED_WS);
  });

  afterEach(() => {
    if (existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('moves prompt to a new category', () => {
    const { stdout, exitCode } = run([
      'move', 'prompt', 'test-prompt',
      '--category', 'tools',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('general -> tools');

    // Old location gone
    expect(existsSync(join(tmpWs, 'resources/prompts/general/test-prompt'))).toBe(false);

    // New location exists with updated category
    const newYaml = join(tmpWs, 'resources/prompts/tools/test-prompt/prompt.yaml');
    expect(existsSync(newYaml)).toBe(true);
    const content = readFileSync(newYaml, 'utf8');
    expect(content).toContain('category: tools');
  });

  it('outputs JSON', () => {
    const { stdout, exitCode } = run([
      'move', 'prompt', 'test-prompt',
      '--category', 'development',
      '--json', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.id).toBe('test-prompt');
    expect(data.oldCategory).toBe('general');
    expect(data.newCategory).toBe('development');
  });

  it('errors on non-prompt type', () => {
    const { exitCode, stdout } = run([
      'move', 'gate', 'test-gate',
      '--category', 'tools',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Only prompts have categories');
  });

  it('errors on missing --category flag', () => {
    const { exitCode } = run([
      'move', 'prompt', 'test-prompt',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
  });

  it('prints chain step warning', () => {
    const { stdout } = run([
      'move', 'prompt', 'test-prompt',
      '--category', 'tools',
      '--workspace', tmpWs,
    ]);
    expect(stdout).toContain('chain steps');
  });

  it('succeeds when resource has no version history', () => {
    // Version history is SQLite-backed — move should succeed without state.db
    const { exitCode, stdout } = run([
      'move', 'prompt', 'test-prompt',
      '--category', 'tools',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('general -> tools');

    // Old location should be completely gone
    expect(existsSync(join(tmpWs, 'resources/prompts/general/test-prompt'))).toBe(false);
  });
});

// ── cpm toggle ────────────────────────────────────────────────────────────

describe('cpm toggle', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = copyWorkspace(VERSIONED_WS);
  });

  afterEach(() => {
    if (existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('toggles framework from false to true', () => {
    const { stdout, exitCode } = run([
      'toggle', 'framework', 'test-method',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('enabled false -> true');

    const content = readFileSync(
      join(tmpWs, 'resources/frameworks/test-method/framework.yaml'), 'utf8',
    );
    expect(content).toContain('enabled: true');
  });

  it('toggles style from true to false', () => {
    const { stdout, exitCode } = run([
      'toggle', 'style', 'test-style',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('enabled true -> false');
  });

  it('outputs JSON', () => {
    const { stdout, exitCode } = run([
      'toggle', 'framework', 'test-method',
      '--json', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.previousValue).toBe(false);
    expect(data.newValue).toBe(true);
    expect(data.type).toBe('framework');
  });

  it('errors on prompt type', () => {
    const { exitCode, stdout } = run([
      'toggle', 'prompt', 'test-prompt',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("'enabled' field");
  });

  it('errors on gate type', () => {
    const { exitCode } = run([
      'toggle', 'gate', 'test-gate',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
  });
});

// ── cpm link-gate ─────────────────────────────────────────────────────────

describe('cpm link-gate', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = copyWorkspace(VERSIONED_WS);
  });

  afterEach(() => {
    if (existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('links a gate to a prompt', () => {
    const { stdout, exitCode } = run([
      'link-gate', 'test-prompt', 'test-gate',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Linked gate 'test-gate' to prompt 'test-prompt'");

    const content = readFileSync(
      join(tmpWs, 'resources/prompts/general/test-prompt/prompt.yaml'), 'utf8',
    );
    expect(content).toContain('test-gate');
    expect(content).toContain('gateConfiguration');
  });

  it('unlinks a gate with --remove', () => {
    // First link
    run(['link-gate', 'test-prompt', 'test-gate', '--workspace', tmpWs]);

    // Then unlink
    const { stdout, exitCode } = run([
      'link-gate', 'test-prompt', 'test-gate',
      '--remove', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Unlinked gate 'test-gate' from prompt 'test-prompt'");
  });

  it('outputs JSON', () => {
    const { stdout, exitCode } = run([
      'link-gate', 'test-prompt', 'test-gate',
      '--json', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.action).toBe('added');
    expect(data.include).toContain('test-gate');
  });

  it('errors when prompt not found', () => {
    const { exitCode, stdout } = run([
      'link-gate', 'nonexistent', 'test-gate',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('not found');
  });

  it('errors when gate not found on add', () => {
    const { exitCode, stdout } = run([
      'link-gate', 'test-prompt', 'nonexistent-gate',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('not found');
  });

  it('allows removing non-existent gate (gate may be deleted)', () => {
    // --remove doesn't validate gate existence, only checks prompt's include array
    const { exitCode, stdout } = run([
      'link-gate', 'test-prompt', 'nonexistent-gate',
      '--remove', '--workspace', tmpWs,
    ]);
    // Should fail because the gate isn't in the include array, not because gate doesn't exist
    expect(exitCode).toBe(1);
    expect(stdout).toContain('not linked');
  });
});
