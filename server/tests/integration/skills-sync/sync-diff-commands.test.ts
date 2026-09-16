// @lifecycle test - End-to-end syncCommand and diffCommand coverage (F11).
/**
 * F11: prune PLANNING is unit-tested in `sync-engine.test.ts`, but the commands
 * that call it were not -- including the --prune/--no-prune branch and orphan
 * reporting. F10 adoption rides the same path, so it is driven here too.
 */
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile, symlink, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as yaml from 'js-yaml';

import {
  runSkillsSyncCommand,
  type SkillsSyncOptions,
  type SkillsSyncOutput,
} from '../../../src/modules/skills-sync/service.js';
import { resolveSkillsSyncPaths } from '../../../src/runtime/skills-sync-paths.js';

function silentOutput(): SkillsSyncOutput & { logs: string[]; warns: string[] } {
  const logs: string[] = [];
  const warns: string[] = [];
  return {
    logs,
    warns,
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => warns.push(args.map(String).join(' ')),
    error: () => {},
  };
}

describe('sync and diff commands end to end (F11)', () => {
  let tmpDir: string;
  let serverRoot: string;
  let outputDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'skills-sync-cmd-'));
    serverRoot = path.join(tmpDir, 'server');
    outputDir = path.join(tmpDir, 'output');
    await mkdir(serverRoot, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    savedEnv = {
      MCP_SERVER_ROOT: process.env['MCP_SERVER_ROOT'],
      MCP_RESOURCES_PATH: process.env['MCP_RESOURCES_PATH'],
    };
    process.env['MCP_SERVER_ROOT'] = serverRoot;
    delete process.env['MCP_RESOURCES_PATH'];

    await writeFile(
      path.join(serverRoot, 'skills-sync.yaml'),
      yaml.dump({
        registrations: { 'claude-code': 'all' },
        overrides: {
          'claude-code': { outputDir: { user: outputDir, project: outputDir } },
        },
      })
    );
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writePrompt(id: string, extra: Record<string, unknown> = {}): Promise<void> {
    const dir = path.join(serverRoot, 'resources', 'prompts', 'general', id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'user-message.md'), 'Do the thing.');
    await writeFile(
      path.join(dir, 'prompt.yaml'),
      yaml.dump({
        id,
        name: id,
        description: `${id} description`,
        category: 'general',
        userMessageTemplateFile: 'user-message.md',
        ...extra,
      })
    );
  }

  async function writeGate(
    id: string,
    name: string,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    const gateDir = path.join(serverRoot, 'resources', 'gates', id);
    await mkdir(gateDir, { recursive: true });
    await writeFile(
      path.join(gateDir, 'gate.yaml'),
      yaml.dump({ id, name, type: 'validation', description: `${name} gate`, ...extra })
    );
    await writeFile(path.join(gateDir, 'guidance.md'), `Guidance for ${id}.`);
  }

  /** A directory left by an export that predates managed markers. */
  async function writeUnmarkedSkillDir(dirName: string, leadHeading: string): Promise<void> {
    const dir = path.join(outputDir, dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${dirName}\ndescription: A pre-marker export.\n---\n\n${leadHeading}\n\nBody text.\n`
    );
  }

  function run(opts: Partial<SkillsSyncOptions>) {
    const out = silentOutput();
    return runSkillsSyncCommand(
      { command: 'sync', client: 'claude-code', scope: 'user', ...opts } as SkillsSyncOptions,
      out,
      resolveSkillsSyncPaths()
    ).then((report) => ({ report, out }));
  }

  it('sync refuses to write a skill directory that is a symlink out of the base dir', async () => {
    // Same defect as the export test (2026-08-27 codex→claude-code clobber), on the sync path:
    // the guard sits at the second write site, so it needs its own falsifiable assertion.
    await writePrompt('aliased');
    await writePrompt('plain');
    const foreignDir = path.join(tmpDir, 'other-client', 'aliased');
    await mkdir(foreignDir, { recursive: true });
    const sentinel = '---\nmanaged-client: other\n---\nFOREIGN RENDER — must survive\n';
    await writeFile(path.join(foreignDir, 'SKILL.md'), sentinel);
    await symlink(foreignDir, path.join(outputDir, 'aliased'), 'dir');

    const { report, out } = await run({ command: 'sync' });

    expect(await readFile(path.join(foreignDir, 'SKILL.md'), 'utf-8')).toBe(sentinel);
    expect(report.failures.map((f) => f.id)).toContain('aliased');
    expect(out.warns.some((w) => w.includes('aliased') && w.includes('resolves outside'))).toBe(
      true
    );
    await access(path.join(outputDir, 'plain', 'SKILL.md'));
  });

  it('sync writes skills and reports what it wrote', async () => {
    await writePrompt('kept_prompt');

    const { report } = await run({ command: 'sync' });

    expect(report.command).toBe('sync');
    expect(report.written).toBeGreaterThan(0);
  });

  it('sync adopts an unmarked directory this emitter produced', async () => {
    await writePrompt('kept_prompt');
    // `legacy_export` shares no substring with `kept_prompt`, so an assertion
    // about it cannot pass by matching the other fixture's name.
    await writeUnmarkedSkillDir('legacy_export', '## Instructions');

    const { out } = await run({ command: 'sync' });

    expect(out.logs.join('\n')).toContain('legacy_export');
    const adopted = await readFile(path.join(outputDir, 'legacy_export', 'SKILL.md'), 'utf-8');
    expect(adopted).toContain('managed-by: claude-prompts-skills-sync');
  });

  it('sync leaves a hand-written directory untouched', async () => {
    await writePrompt('kept_prompt');
    await writeUnmarkedSkillDir('hand_written', '## Overview');

    await run({ command: 'sync' });

    const untouched = await readFile(path.join(outputDir, 'hand_written', 'SKILL.md'), 'utf-8');
    // Guards the inverse of the previous case: without this, a fix that adopted
    // every unmarked directory would pass it.
    expect(untouched).not.toContain('managed-by');
  });

  it('sync completes past a neighbouring hand-written skill whose frontmatter is not valid YAML', async () => {
    // Same defect as the diff case below ("survives a neighbouring skill whose frontmatter is
    // not valid YAML"), on the write path: findAdoptableSkillDirs scans every directory in the
    // output dir, hand-written ones included, and a `description:` holding an unquoted colon is
    // not valid YAML — measured against a real ~/.claude/skills (2026-09-15).
    await writePrompt('kept_prompt');
    const handWrittenContent =
      '---\nname: hand_written\ndescription: Use when: a colon appears unquoted.\n---\n\nBody.\n';
    const handWritten = path.join(outputDir, 'hand_written');
    await mkdir(handWritten, { recursive: true });
    await writeFile(path.join(handWritten, 'SKILL.md'), handWrittenContent);

    const { report } = await run({ command: 'sync' });

    expect(report.written).toBeGreaterThan(0);
    expect(await readFile(path.join(handWritten, 'SKILL.md'), 'utf-8')).toBe(handWrittenContent);
  });

  it('sync does not adopt on a preview', async () => {
    await writePrompt('kept_prompt');
    await writeUnmarkedSkillDir('legacy_export', '## Instructions');

    await run({ command: 'sync', preview: true });

    const unchanged = await readFile(path.join(outputDir, 'legacy_export', 'SKILL.md'), 'utf-8');
    expect(unchanged).not.toContain('managed-by');
  });

  it('sync honors --no-prune by leaving stale managed dirs in place', async () => {
    await writePrompt('kept_prompt');
    await run({ command: 'sync' });

    const { report } = await run({ command: 'sync', prune: false });

    expect(report.pruned).toBe(0);
  });

  it('sync warns before removing the frontmatter hooks block from an on-disk managed SKILL.md', async () => {
    // Mirrors the export removal-warning test (d3308a56): the same guard, now on the sync
    // write loop, which previously carried no removal check at all.
    await writeGate('code-quality', 'Code Quality');
    await writePrompt('hook_dropped', {
      gateConfiguration: { include: ['code-quality'] },
      enforceGateHooks: true,
    });
    await run({ command: 'sync' }); // first sync: SKILL.md carries the frontmatter hooks block

    await writePrompt('hook_dropped', {
      gateConfiguration: { include: ['code-quality'] },
      // enforceGateHooks dropped — the second sync would lose the block silently.
    });
    const { out } = await run({ command: 'sync' });

    expect(
      out.warns.some((w) => w.includes('hook_dropped') && w.includes('enforceGateHooks'))
    ).toBe(true);
  });

  it('diff runs against the exported tree without writing', async () => {
    await writePrompt('kept_prompt');
    await run({ command: 'sync' });

    const { report } = await run({ command: 'diff' });

    expect(report.command).toBe('diff');
    expect(report.written).toBe(0);
  });

  /**
   * Every run above passes no database, which is the state a plain CLI export leaves behind:
   * files on disk and no manifest row. Diff used to print nothing at all there, which reads
   * exactly like a clean tree — so these drive the comparison against the would-be export.
   */
  describe('diff with no saved manifest', () => {
    const skillMd = (id: string) => path.join(outputDir, id, 'SKILL.md');

    it('reports a locally edited skill file as output drift, in the JSON', async () => {
      await writePrompt('edited_prompt');
      await run({ command: 'sync' });
      await writeFile(
        skillMd('edited_prompt'),
        (await readFile(skillMd('edited_prompt'), 'utf-8')) + '\nHand-typed paragraph.\n'
      );

      const { out } = await run({ command: 'diff', json: true });

      const report = JSON.parse(out.logs.join('\n')) as {
        drift?: Array<{ entries: Array<{ type: string; id: string; files: string[] }> }>;
      };
      expect(report.drift?.[0]?.entries).toContainEqual({
        type: 'output',
        id: 'edited_prompt',
        files: ['edited_prompt/SKILL.md'],
      });
    });

    it('reports a resource with no skill directory as new', async () => {
      await writePrompt('erased_prompt');
      await run({ command: 'sync' });
      await rm(path.join(outputDir, 'erased_prompt'), { recursive: true, force: true });

      const { report } = await run({ command: 'diff' });

      expect(report.drift?.[0]?.entries).toContainEqual({
        type: 'new',
        id: 'erased_prompt',
        files: [],
      });
    });

    it('reports a managed directory whose resource is gone as an orphan', async () => {
      await writePrompt('kept_prompt');
      await writePrompt('retired_prompt');
      await run({ command: 'sync' });
      await rm(path.join(serverRoot, 'resources', 'prompts', 'general', 'retired_prompt'), {
        recursive: true,
        force: true,
      });

      const { report } = await run({ command: 'diff' });

      expect(report.drift?.[0]?.entries).toContainEqual({
        type: 'orphan',
        id: 'prompt:general/retired_prompt',
        files: [],
      });
    });

    it('survives a neighbouring skill whose frontmatter is not valid YAML', async () => {
      // Measured against a real ~/.claude/skills (2026-09-15): two hand-written skills carry a
      // `description:` with an unquoted colon, and the marker parser threw on them — aborting a
      // read-only diff over every client.
      await writePrompt('kept_prompt');
      await run({ command: 'sync' });
      const handWritten = path.join(outputDir, 'hand_written');
      await mkdir(handWritten, { recursive: true });
      await writeFile(
        path.join(handWritten, 'SKILL.md'),
        '---\nname: hand_written\ndescription: Use when: a colon appears unquoted.\n---\n\nBody.\n'
      );

      const { report } = await run({ command: 'diff' });

      expect(report.drift).toEqual([{ client: 'claude-code', scope: 'user', entries: [] }]);
    });

    it('reports an untouched export as clean, and still prints the drift report', async () => {
      // The inverse of the three above: without this, a change that classified everything as
      // drift would pass all of them.
      await writePrompt('kept_prompt');
      await run({ command: 'sync' });

      const { report, out } = await run({ command: 'diff' });

      expect(report.drift).toEqual([{ client: 'claude-code', scope: 'user', entries: [] }]);
      expect(out.logs.join('\n')).toContain('── claude-code (user) drift report');
      expect(out.logs.join('\n')).toContain('no drift detected');
    });
  });

  /**
   * A database that stores the manifest rows and nothing else — enough for an export to save a
   * manifest and the next diff to read it back. Resources are loaded from disk either way.
   */
  function manifestDatabase() {
    const columns = [
      'client',
      'scope',
      'resource_key',
      'resource_id',
      'resource_type',
      'source_hash',
      'output_hash',
      'output_files',
      'exported_at',
      'version',
      'version_date',
      'config_hash',
      'source_snapshot',
    ];
    let rows: Array<Record<string, unknown>> = [];
    return {
      isInitialized: () => true,
      query: (sql: string, params: unknown[] = []) =>
        sql.includes('skills_sync_manifests')
          ? rows.filter((row) => row['client'] === params[0] && row['scope'] === params[1])
          : [],
      run: (sql: string, params: unknown[] = []) => {
        if (sql.includes('DELETE FROM skills_sync_manifests')) {
          rows = rows.filter((row) => !(row['client'] === params[0] && row['scope'] === params[1]));
        } else if (sql.includes('INSERT INTO skills_sync_manifests')) {
          rows.push(Object.fromEntries(columns.map((column, i) => [column, params[i]])));
        }
      },
      transaction: async (fn: () => unknown) => await fn(),
    };
  }

  it('diff fills the same drift report from a saved manifest', async () => {
    // Positive control for the block above: the manifest path must keep answering the JSON
    // question too, or "drift is present" would only ever mean "no manifest was found".
    await writePrompt('kept_prompt');
    const dbManager = manifestDatabase() as never;
    await run({ command: 'sync', dbManager });

    const { report, out } = await run({ command: 'diff', dbManager });

    expect(report.drift).toEqual([{ client: 'claude-code', scope: 'user', entries: [] }]);
    expect(out.logs.join('\n')).not.toContain('no manifest is saved');
  });
});
