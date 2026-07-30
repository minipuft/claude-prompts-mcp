import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, mkdirSync, readFileSync, cpSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/cpm.js');
const VERSIONED_WS = join(__dirname, '../fixtures/versioned-workspace');

/**
 * Seed a workspace's runtime-state/state.db with version history entries.
 * Uses python3 sqlite3 — same backend as cli-shared/version-history.ts.
 */
function seedVersionHistory(
  workspace: string,
  resourceType: string,
  resourceId: string,
  versions: Array<{ version: number; snapshot: Record<string, unknown>; description: string; diff_summary?: string }>,
): void {
  const runtimeDir = join(workspace, 'runtime-state');
  if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
  const dbPath = join(runtimeDir, 'state.db');

  const script = `
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("""
  CREATE TABLE IF NOT EXISTS version_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    diff_summary TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )
""")
for v in json.loads(sys.argv[2]):
    db.execute(
        "INSERT INTO version_history (tenant_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at) VALUES (?,?,?,?,?,?,?,?)",
        ('default', sys.argv[3], sys.argv[4], v['version'], json.dumps(v['snapshot']), v.get('diff_summary',''), v['description'], '2025-06-13T08:00:00.000Z')
    )
db.commit()
db.close()
`;

  const result = spawnSync('python3', [
    '-c', script,
    dbPath,
    JSON.stringify(versions),
    resourceType,
    resourceId,
  ], { encoding: 'utf-8', timeout: 5000 });

  if (result.status !== 0) {
    throw new Error(`Failed to seed version history: ${result.stderr}`);
  }
}

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

/** Create a temporary copy of a workspace fixture for write tests. */
function copyWorkspace(source: string): string {
  const tmp = join(__dirname, `../fixtures/.tmp-${Date.now()}`);
  cpSync(source, tmp, { recursive: true });
  return tmp;
}

describe('cpm create', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = copyWorkspace(VERSIONED_WS);
  });

  afterEach(() => {
    if (existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('creates a new prompt', () => {
    const { stdout, exitCode } = run([
      'create', 'prompt', 'my-new-prompt',
      '--name', 'My New Prompt',
      '--description', 'A new prompt',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Created prompt 'my-new-prompt'");

    const yamlPath = join(tmpWs, 'resources/prompts/general/my-new-prompt/prompt.yaml');
    expect(existsSync(yamlPath)).toBe(true);
  });

  it('creates a gate', () => {
    const { stdout, exitCode } = run([
      'create', 'gate', 'new-gate',
      '--name', 'New Gate',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Created gate 'new-gate'");
  });

  it('errors when resource already exists', () => {
    const { exitCode, stdout } = run([
      'create', 'prompt', 'test-prompt',
      '--category', 'general',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('already exists');
  });

  it('errors on missing type', () => {
    const { exitCode } = run(['create']);
    expect(exitCode).toBe(1);
  });

  it('errors on missing id', () => {
    const { exitCode } = run(['create', 'prompt']);
    expect(exitCode).toBe(1);
  });

  it('outputs JSON on success', () => {
    const { stdout, exitCode } = run([
      'create', 'prompt', 'json-test',
      '--json', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.id).toBe('json-test');
    expect(data.type).toBe('prompt');
  });

  it('creates a style', () => {
    const { stdout, exitCode } = run([
      'create', 'style', 'my-style',
      '--name', 'My Style',
      '--description', 'A custom style',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Created style 'my-style'");

    const yamlPath = join(tmpWs, 'resources/styles/my-style/style.yaml');
    expect(existsSync(yamlPath)).toBe(true);

    const content = readFileSync(yamlPath, 'utf8');
    expect(content).toContain('id: my-style');
    expect(content).toContain('name: My Style');
    expect(content).toContain('enabled: true');
  });

  it('supports --no-validate for create flows', () => {
    const { stdout, exitCode } = run([
      'create', 'prompt', 'skip-validate',
      '--no-validate',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Created prompt 'skip-validate'");
  });

  it('creates a framework with required fields', () => {
    const { stdout, exitCode } = run([
      'create', 'framework', 'new-method',
      '--name', 'New Method',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Created framework 'new-method'");

    const yamlPath = join(tmpWs, 'resources/frameworks/new-method/framework.yaml');
    const content = readFileSync(yamlPath, 'utf8');
    expect(content).toContain('framework: NEW_METHOD');
    expect(content).toContain('version: 1.0.0');
  });
});

describe('cpm delete', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = copyWorkspace(VERSIONED_WS);
  });

  afterEach(() => {
    if (existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('requires --force flag', () => {
    const { exitCode, stdout } = run([
      'delete', 'prompt', 'test-prompt',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('--force');
  });

  it('deletes with --force', () => {
    const dir = join(tmpWs, 'resources/prompts/general/test-prompt');
    expect(existsSync(dir)).toBe(true);

    const { exitCode, stdout } = run([
      'delete', 'prompt', 'test-prompt',
      '--force', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Deleted prompt 'test-prompt'");
    expect(existsSync(dir)).toBe(false);
  });

  it('errors when resource not found', () => {
    const { exitCode } = run([
      'delete', 'prompt', 'nonexistent',
      '--force', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
  });
});

describe('cpm history', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = copyWorkspace(VERSIONED_WS);
    seedVersionHistory(tmpWs, 'prompt', 'test-prompt', [
      { version: 1, snapshot: { id: 'test-prompt', name: 'Test Prompt', description: 'Initial test prompt for CLI.' }, description: 'Version 1' },
      { version: 2, snapshot: { id: 'test-prompt', name: 'Test Prompt', description: 'A test prompt.' }, description: 'Simplified description', diff_summary: '+1/-1' },
      { version: 3, snapshot: { id: 'test-prompt', name: 'Test Prompt', description: 'A test prompt for CLI integration tests.' }, description: 'Updated description', diff_summary: '+1/-0' },
    ]);
  });

  afterEach(() => {
    if (existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('shows version history', () => {
    const { stdout, exitCode } = run([
      'history', 'prompt', 'test-prompt',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Version History');
    expect(stdout).toContain('test-prompt');
    expect(stdout).toContain('3 versions');
  });

  it('outputs JSON', () => {
    const { stdout, exitCode } = run([
      'history', 'prompt', 'test-prompt',
      '--json', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.current_version).toBe(3);
    expect(data.versions).toHaveLength(3);
  });

  it('respects --limit', () => {
    const { stdout, exitCode } = run([
      'history', 'prompt', 'test-prompt',
      '--limit', '1', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('and 2 more versions');
  });

  it('handles missing history gracefully', () => {
    // Workspace without state.db — history should report empty
    const emptyWs = copyWorkspace(VERSIONED_WS);
    // Don't seed — no runtime-state/state.db

    const { stdout, exitCode } = run([
      'history', 'prompt', 'test-prompt',
      '--workspace', emptyWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No version history');
    rmSync(emptyWs, { recursive: true, force: true });
  });
});

describe('cpm compare', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = copyWorkspace(VERSIONED_WS);
    seedVersionHistory(tmpWs, 'prompt', 'test-prompt', [
      { version: 1, snapshot: { id: 'test-prompt', name: 'Test Prompt', description: 'Initial test prompt for CLI.' }, description: 'Version 1' },
      { version: 2, snapshot: { id: 'test-prompt', name: 'Test Prompt', description: 'A test prompt.' }, description: 'Simplified description', diff_summary: '+1/-1' },
      { version: 3, snapshot: { id: 'test-prompt', name: 'Test Prompt', description: 'A test prompt for CLI integration tests.' }, description: 'Updated description', diff_summary: '+1/-0' },
    ]);
  });

  afterEach(() => {
    if (existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('compares two versions', () => {
    const { stdout, exitCode } = run([
      'compare', 'prompt', 'test-prompt', '1', '3',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Version 1 -> Version 3');
    expect(stdout).toContain('description');
  });

  it('outputs JSON', () => {
    const { stdout, exitCode } = run([
      'compare', 'prompt', 'test-prompt', '1', '2',
      '--json', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.from.version).toBe(1);
    expect(data.to.version).toBe(2);
  });

  it('errors on missing version', () => {
    const { exitCode, stdout } = run([
      'compare', 'prompt', 'test-prompt', '1', '99',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('not found');
  });

  it('errors on invalid version numbers', () => {
    const { exitCode } = run([
      'compare', 'prompt', 'test-prompt', 'abc', '3',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
  });
});

describe('cpm rollback', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = copyWorkspace(VERSIONED_WS);
    seedVersionHistory(tmpWs, 'prompt', 'test-prompt', [
      { version: 1, snapshot: { id: 'test-prompt', name: 'Test Prompt', description: 'Initial test prompt for CLI.' }, description: 'Version 1' },
      { version: 2, snapshot: { id: 'test-prompt', name: 'Test Prompt', description: 'A test prompt.' }, description: 'Simplified description', diff_summary: '+1/-1' },
      { version: 3, snapshot: { id: 'test-prompt', name: 'Test Prompt', description: 'A test prompt for CLI integration tests.' }, description: 'Updated description', diff_summary: '+1/-0' },
    ]);
  });

  afterEach(() => {
    if (existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('rolls back to a previous version', () => {
    const { stdout, exitCode } = run([
      'rollback', 'prompt', 'test-prompt', '1',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('saved v4');
    expect(stdout).toContain('restored v1');

    // Verify YAML was updated with v1 snapshot
    const yamlPath = join(tmpWs, 'resources/prompts/general/test-prompt/prompt.yaml');
    const content = readFileSync(yamlPath, 'utf8');
    expect(content).toContain('Initial test prompt for CLI');
  });

  it('outputs JSON', () => {
    const { stdout, exitCode } = run([
      'rollback', 'prompt', 'test-prompt', '2',
      '--json', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.saved_version).toBe(4);
    expect(data.restored_version).toBe(2);
  });

  it('errors on nonexistent version', () => {
    const { exitCode } = run([
      'rollback', 'prompt', 'test-prompt', '99',
      '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(1);
  });
});

describe('cpm guide', () => {
  it('shows all commands without goal', () => {
    const { stdout, exitCode } = run(['guide']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('CPM CLI Guide');
    expect(stdout).toContain('lifecycle');
    expect(stdout).toContain('discovery');
    expect(stdout).toContain('versioning');
  });

  it('ranks commands by goal relevance', () => {
    const { stdout, exitCode } = run(['guide', 'create']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Recommended:');
    expect(stdout).toContain('cpm create');
  });

  it('outputs JSON', () => {
    const { stdout, exitCode } = run(['guide', '--json']);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(16);
  });

  it('ranks versioning commands for version goal', () => {
    const { stdout, exitCode } = run(['guide', 'revert', '--json']);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data[0].id).toBe('rollback');
  });
});

describe('cpm validate (duplicate detection)', () => {
  let tmpWs: string;

  beforeEach(() => {
    tmpWs = copyWorkspace(VERSIONED_WS);
  });

  afterEach(() => {
    if (existsSync(tmpWs)) rmSync(tmpWs, { recursive: true, force: true });
  });

  it('warns on duplicate prompt IDs across categories', () => {
    // Create a second prompt with the same ID in a different category
    run([
      'create', 'prompt', 'test-prompt',
      '--category', 'tools',
      '--workspace', tmpWs,
    ]);

    const { stderr } = run([
      'validate', '--prompts', '--workspace', tmpWs,
    ]);
    expect(stderr).toContain('Duplicate ID');
    expect(stderr).toContain('only one will register');
  });

  it('includes duplicate warnings in JSON output', () => {
    run([
      'create', 'prompt', 'test-prompt',
      '--category', 'tools',
      '--workspace', tmpWs,
    ]);

    const { stdout } = run([
      'validate', '--prompts', '--json', '--workspace', tmpWs,
    ]);
    const data = JSON.parse(stdout);
    expect(data.summary.warnings).toBeGreaterThanOrEqual(2);

    const dupWarnings = data.results.filter(
      (r: { warnings: string[] }) => r.warnings.some((w: string) => w.includes('Duplicate ID')),
    );
    expect(dupWarnings).toHaveLength(2);
  });

  it('no duplicate warnings when IDs are unique', () => {
    const { stderr } = run([
      'validate', '--prompts', '--workspace', tmpWs,
    ]);
    expect(stderr).not.toContain('Duplicate ID');
  });

  it('validates styles', () => {
    run([
      'create', 'style', 'val-style',
      '--name', 'Validation Style',
      '--workspace', tmpWs,
    ]);

    const { stdout, exitCode } = run([
      'validate', '--styles', '--workspace', tmpWs,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('[styles]');
    expect(stdout).toContain('valid');
  });
});
