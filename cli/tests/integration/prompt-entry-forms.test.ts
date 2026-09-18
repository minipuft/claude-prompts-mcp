/**
 * `cpm` sees, and acts on, a prompt in either form the loader serves (plan row P4.55, ruling R35).
 *
 * A prompt is a directory (`{category}/…/{id}/prompt.yaml`) or a single file
 * (`{category}/…/{id}.yaml`), at any depth below its category, and is served under its path below
 * the category (`chain/step`). `cpm` used to walk two levels and carry `{ id, dir }`, so it missed
 * nested chain steps and single-file prompts entirely, and `delete` had nothing but a directory to
 * remove: for a single file, the only directory in reach was its category.
 *
 * The fixture holds a nested chain step and a single-file prompt, each beside a twin that differs
 * ONLY in form, plus one id spelled both ways, where the directory wins. The expected id set is
 * the one `PromptLoader` serves for the same tree, computed in-process, and it is also stated
 * literally. The server pins the same rules in
 * `server/tests/integration/database/single-file-prompt-indexing.test.ts` (single-file prompts,
 * nested qualification, directory wins) and
 * `server/tests/integration/prompts/nested-prompt-discovery.test.ts` (chain steps at any depth).
 *
 * Every command is driven through the built `dist/cpm.js`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { PromptLoader } from '../../../server/src/modules/prompts/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/cpm.js');
const SCOPE = 'cli-entry-forms-scope';

/** What the loader serves for the fixture below, stated literally. */
const SERVED_IDS = ['chain', 'chain/step_dir', 'chain/step_file', 'single', 'single_dir', 'twin'];

function cpm(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', timeout: 10_000 });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const body = (id: string, name = `${id} prompt`): string =>
  [
    `id: ${id}`,
    `name: ${name}`,
    'category: general',
    'description: A prompt that loads cleanly for the entry-form tests.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

describe('cpm and the two prompt forms', () => {
  let workspace = '';
  let prompts = '';
  const at = (...segments: string[]): string => join(prompts, 'general', ...segments);

  const writeFile = (path: string, content: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  };

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'cpm-entry-forms-'));
    prompts = join(workspace, 'resources/prompts');
    writeFile(at('chain', 'prompt.yaml'), body('chain'));
    writeFile(at('chain', 'step_dir', 'prompt.yaml'), body('step_dir')); // nested, dir form
    writeFile(at('chain', 'step_file.yaml'), body('step_file')); // its twin, file form
    writeFile(at('single.yaml'), body('single')); // single-file prompt
    writeFile(at('single_dir', 'prompt.yaml'), body('single_dir')); // its twin, dir form
    writeFile(at('twin', 'prompt.yaml'), body('twin', 'the directory form'));
    writeFile(at('twin.yaml'), body('twin', 'the file form'));
    writeFile(at('category.yaml'), 'id: general\nname: General\n'); // not a prompt
    writeFile(at('_draft.yaml'), body('_draft')); // ignored
    writeFile(at('chain', 'tools', 'helper', 'tool.yaml'), 'id: helper\n'); // script tool
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const listed = (): string[] => {
    const { status, stdout } = cpm(['list', 'prompts', '--json', '--workspace', workspace]);
    expect(status).toBe(0);
    return (JSON.parse(stdout) as Array<{ id: string }>).map((item) => item.id).sort();
  };

  const served = async (): Promise<string[]> => {
    const silent = { debug() {}, info() {}, warn() {}, error() {} };
    const loader = new PromptLoader(silent as never, { enableCache: false });
    const loaded = await loader.loadFromDirectories(prompts);
    return loaded.promptsData.map((prompt) => prompt.id).sort();
  };

  describe('list and validate', () => {
    it('lists exactly the ids the loader serves', async () => {
      expect(await served()).toEqual(SERVED_IDS);
      expect(listed()).toEqual(SERVED_IDS);
    });

    it('reads the directory form of an id spelled both ways', () => {
      const { stdout } = cpm(['inspect', 'prompt', 'twin', '--json', '--workspace', workspace]);
      expect(JSON.parse(stdout).name).toBe('the directory form');
    });

    it('validates every served prompt, nested steps and single files included', () => {
      const { status, stdout } = cpm(['validate', '--prompts', '--json', '--workspace', workspace]);
      const report = JSON.parse(stdout) as { valid: boolean; results: Array<{ id: string }> };
      expect(report.results.map((r) => r.id).sort()).toEqual(SERVED_IDS);
      expect(report.valid).toBe(true);
      expect(status).toBe(0);
    });
  });

  describe('delete', () => {
    it('removes a single-file prompt and nothing else in its category', () => {
      const { status } = cpm(['delete', 'prompt', 'single', '--force', '--workspace', workspace]);
      expect(status).toBe(0);
      expect(existsSync(at('single.yaml'))).toBe(false);
      expect(existsSync(at())).toBe(true);
      expect(listed()).toEqual(SERVED_IDS.filter((id) => id !== 'single'));
    });

    it('removes a nested single-file step and leaves its chain', () => {
      const { status } = cpm(['delete', 'prompt', 'chain/step_file', '--force', '--workspace', workspace]);
      expect(status).toBe(0);
      expect(existsSync(at('chain', 'step_file.yaml'))).toBe(false);
      expect(listed()).toEqual(SERVED_IDS.filter((id) => id !== 'chain/step_file'));
    });

    it('removes a directory prompt with its directory, as before', () => {
      writeFile(at('single_dir', 'user-message.md'), 'companion');
      const { status } = cpm(['delete', 'prompt', 'single_dir', '--force', '--workspace', workspace]);
      expect(status).toBe(0);
      expect(existsSync(at('single_dir'))).toBe(false);
      expect(listed()).toEqual(SERVED_IDS.filter((id) => id !== 'single_dir'));
    });

    it('removes a nested directory step and leaves its chain', () => {
      const { status } = cpm(['delete', 'prompt', 'chain/step_dir', '--force', '--workspace', workspace]);
      expect(status).toBe(0);
      expect(existsSync(at('chain', 'step_dir'))).toBe(false);
      expect(existsSync(at('chain', 'prompt.yaml'))).toBe(true);
    });
  });

  describe('rename', () => {
    it('renames a nested step: path and id change together', () => {
      const { status } = cpm(['rename', 'prompt', 'chain/step_dir', 'chain/step_moved', '--workspace', workspace]);
      expect(status).toBe(0);
      expect(existsSync(at('chain', 'step_dir'))).toBe(false);
      expect(readFileSync(at('chain', 'step_moved', 'prompt.yaml'), 'utf8')).toContain('id: step_moved\n');
      expect(listed()).toContain('chain/step_moved');
    });

    it('renames a single-file prompt: path and id change together', () => {
      const { status } = cpm(['rename', 'prompt', 'single', 'solo', '--workspace', workspace]);
      expect(status).toBe(0);
      expect(existsSync(at('single.yaml'))).toBe(false);
      expect(readFileSync(at('solo.yaml'), 'utf8')).toContain('id: solo\n');
      expect(listed()).toContain('solo');
    });

    it('refuses to move a step into another chain by renaming it, and writes nothing', () => {
      const before = readFileSync(at('chain', 'step_dir', 'prompt.yaml'), 'utf8');
      const { status, stderr } = cpm(['rename', 'prompt', 'chain/step_dir', 'other/step_dir', '--workspace', workspace]);
      expect(status).toBe(1);
      expect(stderr).toContain('only the last segment of an id can change');
      expect(readFileSync(at('chain', 'step_dir', 'prompt.yaml'), 'utf8')).toBe(before);
    });

    it('refuses an occupied target before rewriting the id', () => {
      // A plain directory is no prompt, so only the rename's own target check can catch it. The
      // old order rewrote `id:` first and then failed, leaving a half-renamed prompt.
      mkdirSync(at('occupied'));
      const before = readFileSync(at('single_dir', 'prompt.yaml'), 'utf8');
      const { status, stderr } = cpm(['rename', 'prompt', 'single_dir', 'occupied', '--workspace', workspace]);
      expect(status).toBe(1);
      expect(stderr).toContain('already exists');
      expect(readFileSync(at('single_dir', 'prompt.yaml'), 'utf8')).toBe(before);
    });

    it('refuses a name the loader would not serve', () => {
      const { status, stderr } = cpm(['rename', 'prompt', 'single', '_hidden', '--workspace', workspace]);
      expect(status).toBe(1);
      expect(stderr).toContain("does not serve a prompt named '_hidden'");
      expect(existsSync(at('single.yaml'))).toBe(true);
    });
  });

  describe('move', () => {
    it('moves a single-file prompt to another category as a file', () => {
      const { status } = cpm(['move', 'prompt', 'single', '--category', 'other', '--workspace', workspace]);
      expect(status).toBe(0);
      expect(existsSync(at('single.yaml'))).toBe(false);
      expect(readFileSync(join(prompts, 'other', 'single.yaml'), 'utf8')).toContain('category: other\n');
    });

    it('refuses to move a nested step out of its chain, by name', () => {
      const { status, stderr } = cpm(['move', 'prompt', 'chain/step_file', '--category', 'other', '--workspace', workspace]);
      expect(status).toBe(1);
      expect(stderr).toContain("Cannot move 'chain/step_file' on its own");
      expect(existsSync(at('chain', 'step_file.yaml'))).toBe(true);
    });
  });

  describe('history keys', () => {
    // `step_dir` at the top of a category is the twin of `chain/step_dir` that differs only in its
    // id, so a history call that guesses the id from the path's last segment hits the wrong rows.
    const seed = (resourceId: string, versions: number): void => {
      mkdirSync(join(workspace, 'runtime-state'), { recursive: true });
      writeFileSync(
        join(workspace, 'config.json'),
        JSON.stringify({ identity: { launchDefaults: { workspaceId: SCOPE } } }),
      );
      const db = new DatabaseSync(join(workspace, 'runtime-state', 'state.db'));
      db.exec(`CREATE TABLE IF NOT EXISTS version_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL DEFAULT 'default',
        organization_id TEXT, workspace_id TEXT, resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot TEXT NOT NULL,
        diff_summary TEXT DEFAULT '', description TEXT DEFAULT '', created_at TEXT NOT NULL)`);
      const insert = db.prepare(
        `INSERT INTO version_history (tenant_id, workspace_id, resource_type, resource_id, version,
         snapshot, description, created_at) VALUES (?, ?, 'prompt', ?, ?, '{}', 'seeded', ?)`,
      );
      for (let v = 1; v <= versions; v++) {
        insert.run(SCOPE, SCOPE, resourceId, v, '2026-09-17T00:00:00.000Z');
      }
      db.close();
    };

    const rowCount = (resourceId: string): number => {
      const db = new DatabaseSync(join(workspace, 'runtime-state', 'state.db'));
      const row = db
        .prepare('SELECT count(*) AS n FROM version_history WHERE resource_id = ?')
        .get(resourceId) as { n: number };
      db.close();
      return row.n;
    };

    beforeEach(() => {
      seed('chain/step_dir', 2);
      seed('step_dir', 3);
    });

    it('reads a nested step under its composite id', () => {
      const { stdout } = cpm(['history', 'prompt', 'chain/step_dir', '--json', '--workspace', workspace]);
      expect(JSON.parse(stdout).versions).toHaveLength(2);
    });

    it('deletes only the nested step’s rows', () => {
      cpm(['delete', 'prompt', 'chain/step_dir', '--force', '--workspace', workspace]);
      expect(rowCount('chain/step_dir')).toBe(0);
      expect(rowCount('step_dir')).toBe(3);
    });

    it('carries the composite history to the renamed step', () => {
      cpm(['rename', 'prompt', 'chain/step_dir', 'chain/step_moved', '--workspace', workspace]);
      expect(rowCount('chain/step_moved')).toBe(2);
      expect(rowCount('step_dir')).toBe(3);
    });
  });
});
