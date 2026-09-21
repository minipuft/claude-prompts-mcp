/**
 * `cpm` finds exactly the prompts the server serves (plan row P4.53).
 *
 * `discoverResourcePaths` takes its skip rules from `server/src/shared/utils/prompt-layout.ts`,
 * the module the server's loader uses. The walk is driven through the built `cpm` binary, which
 * bundles that module: `cpm list` and `cpm validate` both call it. Every skipped prompt below has
 * a twin that differs only in the name (or depth) the rule keys on, so an empty result cannot
 * pass. The expected ids are the ones the loader serves for this layout: every root directory
 * except an excluded one is a category, `_`/`.` entries are ignored, `tools/` is reserved below
 * the root only, and a `prompt.yaml` directly inside a root directory is not a prompt.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/cpm.js');
const VALID_WS = join(__dirname, '../fixtures/valid-workspace');
const BROKEN_PROMPT = join(
  __dirname,
  '../fixtures/invalid-workspace/resources/prompts/dev/broken/prompt.yaml',
);

function cpm(args: string[]): { status: number; stdout: string } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

function listedIds(type: string, workspace: string): string[] {
  const { status, stdout } = cpm([
    'list',
    type,
    '--json',
    '--workspace',
    workspace,
  ]);
  expect(status).toBe(0);
  return (JSON.parse(stdout) as Array<{ id: string }>)
    .map((item) => item.id)
    .sort();
}

describe('cpm list prompts — the loader rules', () => {
  let workspace = '';
  let root = '';

  const writePrompt = (relativeDir: string): void => {
    mkdirSync(join(root, relativeDir), { recursive: true });
    writeFileSync(join(root, relativeDir, 'prompt.yaml'), 'id: x\n');
  };

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'cpm-category-rule-'));
    root = join(workspace, 'resources/prompts');
    writePrompt('backups/in_backups'); // twin of `backup`
    writePrompt('backup/in_backup');
    writePrompt('node_module/in_node_module'); // twin of `node_modules`
    writePrompt('node_modules/in_node_modules');
    writePrompt('drafts/in_drafts'); // twin of `_drafts`
    writePrompt('_drafts/in_hidden');
    writePrompt('tools/leaf'); // `tools` at the root is a category
    writePrompt('general/tools'); // ... and reserved one level down
    writePrompt('general/toolbox'); // twin of `general/tools`
    writePrompt('general/_quiet'); // ignored below the root too
    writePrompt('general/quiet'); // twin of `general/_quiet`
    writePrompt('solo'); // a root directory's own prompt.yaml is not served
    writePrompt('general/solo'); // twin one level down
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('lists exactly the prompts the loader serves', () => {
    expect(listedIds('prompts', workspace)).toEqual([
      'in_backups',
      'in_drafts',
      'in_node_module',
      'leaf',
      'quiet',
      'solo',
      'toolbox',
    ]);
  });

  it('applies no category rule to a flat layout', () => {
    for (const name of ['backup', '_drafts', 'tools']) {
      mkdirSync(join(workspace, 'resources/gates', name), { recursive: true });
      writeFileSync(
        join(workspace, 'resources/gates', name, 'gate.yaml'),
        `id: ${name}\n`,
      );
    }
    expect(listedIds('gates', workspace)).toEqual([
      '_drafts',
      'backup',
      'tools',
    ]);
  });
});

describe('cpm validate — only what the server serves', () => {
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'cpm-validate-served-'));
    cpSync(VALID_WS, workspace, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const validateWithBrokenPromptIn = (category: string): number => {
    const dir = join(workspace, 'resources/prompts', category, 'broken');
    mkdirSync(dir, { recursive: true });
    cpSync(BROKEN_PROMPT, join(dir, 'prompt.yaml'));
    return cpm(['validate', '--prompts', '--workspace', workspace]).status;
  };

  it('ignores a broken prompt under backup/', () => {
    expect(validateWithBrokenPromptIn('backup')).toBe(0);
  });

  it('reports the same broken prompt under backups/', () => {
    expect(validateWithBrokenPromptIn('backups')).toBe(1);
  });
});
