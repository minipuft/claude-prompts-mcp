// @lifecycle test - End-to-end syncCommand and diffCommand coverage (F11).
/**
 * F11: prune PLANNING is unit-tested in `sync-engine.test.ts`, but the commands
 * that call it were not -- including the --prune/--no-prune branch and orphan
 * reporting. F10 adoption rides the same path, so it is driven here too.
 */
import { mkdtempSync } from 'node:fs';
import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
  symlink,
  access,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as yaml from 'js-yaml';

import {
  runSkillsSyncCommand,
  type SkillsSyncOptions,
  type SkillsSyncOutput,
} from '../../../src/modules/skills-sync/service.js';
import { saveVersion } from '../../helpers/version-history-writer.js';
import { resolveSkillsSyncPaths } from '../../../src/runtime/skills-sync-paths.js';
import { seedStateDbSchema } from '../../helpers/test-database.js';

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

  async function writePrompt(
    id: string,
    extra: Record<string, unknown> = {},
    category = 'general'
  ): Promise<void> {
    const dir = path.join(serverRoot, 'resources', 'prompts', category, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'user-message.md'), 'Do the thing.');
    await writeFile(
      path.join(dir, 'prompt.yaml'),
      yaml.dump({
        id,
        name: id,
        description: `${id} description`,
        category,
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

    const { out } = await run({ command: 'sync', preview: true });

    const unchanged = await readFile(path.join(outputDir, 'legacy_export', 'SKILL.md'), 'utf-8');
    expect(unchanged).not.toContain('managed-by');
    // Positive control: the preview did see the directory and planned the adoption.
    expect(out.logs).toContain('  [preview] adopt legacy_export/ as prompt:legacy_export');
  });

  const skillMdPath = (dirName: string) => path.join(outputDir, dirName, 'SKILL.md');
  const exists = (target: string) =>
    access(target).then(
      () => true,
      () => false
    );

  /**
   * Leave a managed skill directory whose resource no longer exists, the way a real run does:
   * sync a resource, then delete its source. The marker is asserted here so every test that
   * calls this starts from a directory prune could legitimately remove.
   */
  async function leaveStaleManagedDir(id = 'retired_prompt'): Promise<void> {
    await writePrompt('kept_prompt');
    await writePrompt(id);
    await run({ command: 'sync' });
    const marked = await readFile(skillMdPath(id), 'utf-8');
    expect(marked).toContain('managed-by: claude-prompts-skills-sync');
    expect(marked).toContain(`managed-resource-key: prompt:general/${id}`);
    await rm(path.join(serverRoot, 'resources', 'prompts', 'general', id), {
      recursive: true,
      force: true,
    });
  }

  describe('stale managed skill directories', () => {
    // The three cases are each other's positive control: the directory is stale and present before
    // every run, so "left in place" (--no-prune, --preview) and "removed" (plain sync) can only
    // both hold if the flag, not an empty prune plan, decides the outcome.
    it('sync --no-prune leaves a stale managed dir in place and says it skipped it', async () => {
      await leaveStaleManagedDir();
      expect(await exists(skillMdPath('retired_prompt'))).toBe(true);

      const { report, out } = await run({ command: 'sync', prune: false });

      expect(report.pruned).toBe(0);
      expect(await exists(skillMdPath('retired_prompt'))).toBe(true);
      expect(out.logs).toContain('  prune skipped (1 stale managed skill(s))');
    });

    it('plain sync prunes the stale managed dir and counts it', async () => {
      await leaveStaleManagedDir();
      expect(await exists(skillMdPath('retired_prompt'))).toBe(true);

      const { report, out } = await run({ command: 'sync' });

      expect(report.pruned).toBe(1);
      expect(await exists(path.join(outputDir, 'retired_prompt'))).toBe(false);
      expect(out.logs).toContain('  pruned retired_prompt/');
      // The live resource is untouched by the same pass.
      expect(await exists(skillMdPath('kept_prompt'))).toBe(true);
    });

    it('sync --preview reports the prune and leaves the directory on disk', async () => {
      await leaveStaleManagedDir();
      expect(await exists(skillMdPath('retired_prompt'))).toBe(true);

      const { report, out } = await run({ command: 'sync', preview: true });

      expect(report.pruned).toBe(0);
      expect(await exists(skillMdPath('retired_prompt'))).toBe(true);
      expect(out.logs).toContain('  [preview] prune retired_prompt/');
    });

    it('sync prunes every directory a stale key maps to, and only this client and scope', async () => {
      await leaveStaleManagedDir();
      // A second directory carrying the same marker: two directories, one resource key.
      await cp(path.join(outputDir, 'retired_prompt'), path.join(outputDir, 'retired_copy'), {
        recursive: true,
      });
      const foreignMarker = (dirName: string, client: string, scope: string) =>
        writeSkillWithMarker(dirName, client, scope, 'prompt:general/not_ours_gone');
      await foreignMarker('other_client_skill', 'codex', 'user');
      await foreignMarker('project_scoped_skill', 'claude-code', 'project');
      for (const dirName of [
        'retired_prompt',
        'retired_copy',
        'other_client_skill',
        'project_scoped_skill',
      ]) {
        expect(await exists(skillMdPath(dirName))).toBe(true);
      }

      const { report } = await run({ command: 'sync' });

      expect(report.pruned).toBe(2);
      expect(await exists(path.join(outputDir, 'retired_prompt'))).toBe(false);
      expect(await exists(path.join(outputDir, 'retired_copy'))).toBe(false);
      expect(await exists(skillMdPath('other_client_skill'))).toBe(true);
      expect(await exists(skillMdPath('project_scoped_skill'))).toBe(true);
    });
  });

  /** A managed-looking skill written by hand, so a test can name the client, scope and key. */
  async function writeSkillWithMarker(
    dirName: string,
    client: string,
    scope: string,
    resourceKey: string
  ): Promise<void> {
    const dir = path.join(outputDir, dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${dirName}\ndescription: Marked.\nmanaged-by: claude-prompts-skills-sync\nmanaged-client: ${client}\nmanaged-scope: ${scope}\nmanaged-resource-key: ${resourceKey}\n---\n\n## Instructions\n\nBody.\n`
    );
  }

  describe('adoption of directories that are not adoptable', () => {
    it('sync completes when the output directory does not exist yet', async () => {
      await writePrompt('kept_prompt');
      await rm(outputDir, { recursive: true, force: true });
      expect(await exists(outputDir)).toBe(false);

      const { report, out } = await run({ command: 'sync' });

      // The run has no database, so its one expected failure is the unsaved manifest.
      expect(report.failures.map((f) => f.id)).toEqual(['claude-code:user']);
      expect(report.written).toBeGreaterThan(0);
      expect(await exists(skillMdPath('kept_prompt'))).toBe(true);
      expect(out.logs.join('\n')).not.toContain('adopted');
    });

    it('sync adopts only the unmarked emitted directory among entries that are not skill directories', async () => {
      await writePrompt('kept_prompt');
      await writeUnmarkedSkillDir('legacy_export', '## Instructions');
      await writeFile(path.join(outputDir, 'stray_file.md'), 'not a directory');
      await mkdir(path.join(outputDir, 'no_skill_md'), { recursive: true });
      await writeFile(path.join(outputDir, 'no_skill_md', 'notes.txt'), 'no SKILL.md here');
      await mkdir(path.join(outputDir, 'empty_skill_md'), { recursive: true });
      await writeFile(skillMdPath('empty_skill_md'), '');
      // Controls: the adoptable directory is unmarked before the run.
      expect(await readFile(skillMdPath('legacy_export'), 'utf-8')).not.toContain('managed-by');

      const { out } = await run({ command: 'sync' });

      expect(out.logs).toContain(
        '  adopted 1 unmarked skill dir(s) emitted before markers existed: legacy_export'
      );
      expect(await readFile(skillMdPath('legacy_export'), 'utf-8')).toContain('managed-by:');
      expect(await readFile(path.join(outputDir, 'stray_file.md'), 'utf-8')).toBe(
        'not a directory'
      );
      expect(await exists(skillMdPath('no_skill_md'))).toBe(false);
      expect(await readFile(skillMdPath('empty_skill_md'), 'utf-8')).toBe('');
    });

    it('sync does not re-stamp an already-marked directory, while adopting its unmarked neighbour', async () => {
      await leaveStaleManagedDir();
      await writeUnmarkedSkillDir('legacy_export', '## Instructions');
      const markedBefore = await readFile(skillMdPath('retired_prompt'), 'utf-8');

      const { out } = await run({ command: 'sync', prune: false });

      expect(await readFile(skillMdPath('retired_prompt'), 'utf-8')).toBe(markedBefore);
      expect(out.logs).toContain(
        '  adopted 1 unmarked skill dir(s) emitted before markers existed: legacy_export'
      );
    });

    // A root user can write a read-only file, which would leave the failure branch unreachable.
    const itNotRoot = process.getuid?.() === 0 ? it.skip : it;
    itNotRoot('sync records a failure when the marker cannot be stamped', async () => {
      await writePrompt('kept_prompt');
      await writeUnmarkedSkillDir('legacy_export', '## Instructions');
      await chmod(skillMdPath('legacy_export'), 0o444);

      try {
        const { report, out } = await run({ command: 'sync' });

        expect(report.failures.map((f) => f.id)).toContain('legacy_export');
        expect(
          out.warns.some(
            (w) => w.includes('legacy_export') && w.includes('could not stamp managed marker')
          )
        ).toBe(true);
        expect(await readFile(skillMdPath('legacy_export'), 'utf-8')).not.toContain('managed-by');
        expect(out.logs.join('\n')).not.toContain('adopted 1');
      } finally {
        await chmod(skillMdPath('legacy_export'), 0o644);
      }
    });
  });

  describe('sync filters, collisions and registration updates', () => {
    it('sync --resource-type writes only that type', async () => {
      await writePrompt('kept_prompt');
      await writeGate('code-quality', 'Code Quality');

      const filtered = await run({ command: 'sync', resourceType: 'gate' });

      expect(filtered.report.resources).toBe(1);
      expect(await exists(skillMdPath('gates-code-quality'))).toBe(true);
      expect(await exists(path.join(outputDir, 'kept_prompt'))).toBe(false);

      // Control: the same tree without the filter does write the prompt, so the absence above
      // came from the filter.
      const unfiltered = await run({ command: 'sync' });
      expect(unfiltered.report.resources).toBe(2);
      expect(await exists(skillMdPath('kept_prompt'))).toBe(true);
    });

    it('sync --id writes only that resource', async () => {
      await writePrompt('alpha_prompt');
      await writePrompt('beta_prompt');

      const { report } = await run({ command: 'sync', id: 'beta_prompt' });

      expect(report.resources).toBe(1);
      expect(await exists(skillMdPath('beta_prompt'))).toBe(true);
      expect(await exists(path.join(outputDir, 'alpha_prompt'))).toBe(false);

      await run({ command: 'sync' });
      expect(await exists(skillMdPath('alpha_prompt'))).toBe(true);
    });

    // The prune plan is built from the resources the run loaded, so a filter that narrows
    // the load made every unfiltered skill look stale. Each case syncs the full tree first, so the
    // directory a filtered run must leave alone is present, marked and managed; the unfiltered
    // case is the positive control that the same directory IS removable.
    describe('a filtered sync does not prune', () => {
      it('sync --id leaves the other managed skills in place, says why, and counts no prune', async () => {
        await writePrompt('alpha_prompt');
        await writePrompt('beta_prompt');
        await run({ command: 'sync' });
        expect(await exists(skillMdPath('alpha_prompt'))).toBe(true);

        const { report, out } = await run({ command: 'sync', id: 'beta_prompt' });

        expect(await exists(skillMdPath('alpha_prompt'))).toBe(true);
        expect(report.pruned).toBe(0);
        expect(out.logs.some((line) => line.startsWith('  pruned '))).toBe(false);
        expect(out.logs).toContain(
          '  prune skipped (filtered by --id: only an unfiltered sync prunes)'
        );
      });

      it('sync --resource-type leaves the skills of other types in place', async () => {
        await writePrompt('alpha_prompt');
        await writeGate('code-quality', 'Code Quality');
        await run({ command: 'sync' });
        expect(await exists(skillMdPath('alpha_prompt'))).toBe(true);

        const { report, out } = await run({ command: 'sync', resourceType: 'gate' });

        expect(await exists(skillMdPath('alpha_prompt'))).toBe(true);
        expect(await exists(skillMdPath('gates-code-quality'))).toBe(true);
        expect(report.pruned).toBe(0);
        expect(out.logs).toContain(
          '  prune skipped (filtered by --resource-type: only an unfiltered sync prunes)'
        );
      });

      it('sync --id --preview plans no prune either', async () => {
        await writePrompt('alpha_prompt');
        await writePrompt('beta_prompt');
        await run({ command: 'sync' });

        const { report, out } = await run({ command: 'sync', id: 'beta_prompt', preview: true });

        expect(report.pruned).toBe(0);
        expect(out.logs.some((line) => line.includes('prune alpha_prompt/'))).toBe(false);
        expect(await exists(skillMdPath('alpha_prompt'))).toBe(true);
      });

      it('control: an unfiltered sync after the source is deleted does prune it', async () => {
        await writePrompt('alpha_prompt');
        await writePrompt('beta_prompt');
        await run({ command: 'sync' });
        await rm(path.join(serverRoot, 'resources', 'prompts', 'general', 'alpha_prompt'), {
          recursive: true,
          force: true,
        });

        const { report, out } = await run({ command: 'sync' });

        expect(report.pruned).toBe(1);
        expect(out.logs).toContain('  pruned alpha_prompt/');
        expect(await exists(path.join(outputDir, 'alpha_prompt'))).toBe(false);
      });
    });

    it('sync category-prefixes the directories of a prompt id used in two categories', async () => {
      await writePrompt('shared_id', {}, 'general');
      await writePrompt('shared_id', {}, 'ops');
      await writePrompt('unique_id', {}, 'general');

      await run({ command: 'sync' });

      expect(await exists(skillMdPath('general-shared_id'))).toBe(true);
      expect(await exists(skillMdPath('ops-shared_id'))).toBe(true);
      expect(await exists(path.join(outputDir, 'shared_id'))).toBe(false);
      // Control: an id used once keeps its plain directory name.
      expect(await exists(skillMdPath('unique_id'))).toBe(true);
    });

    async function writeScopedConfig(userKeys: string[]): Promise<void> {
      await writeFile(
        path.join(serverRoot, 'skills-sync.yaml'),
        yaml.dump({
          registrations: { 'claude-code': { user: userKeys } },
          overrides: { 'claude-code': { outputDir: { user: outputDir, project: outputDir } } },
        })
      );
    }
    const readRegistered = async () =>
      (
        yaml.load(await readFile(path.join(serverRoot, 'skills-sync.yaml'), 'utf-8')) as {
          registrations: { 'claude-code': { user: string[] } };
        }
      ).registrations['claude-code'].user;

    it('sync --id registers an unregistered resource, and --preview reports the same without writing', async () => {
      await writePrompt('alpha_prompt');
      await writePrompt('beta_prompt');
      await writePrompt('gamma_prompt');
      await writeScopedConfig(['prompt:general/alpha_prompt']);

      // Control: the registration list, not the filesystem, decides what a plain sync writes.
      await run({ command: 'sync' });
      expect(await exists(skillMdPath('alpha_prompt'))).toBe(true);
      expect(await exists(path.join(outputDir, 'beta_prompt'))).toBe(false);

      const real = await run({ command: 'sync', id: 'beta_prompt' });
      expect(real.out.logs).toContain('  updated skills-sync.yaml registrations (+1 key(s))');
      expect(await readRegistered()).toEqual([
        'prompt:general/alpha_prompt',
        'prompt:general/beta_prompt',
      ]);
      expect(await exists(skillMdPath('beta_prompt'))).toBe(true);

      const preview = await run({
        command: 'sync',
        id: 'gamma_prompt',
        preview: true,
      });
      expect(preview.out.logs).toContain(
        '  [preview] update skills-sync.yaml registrations (+1 key(s))'
      );
      expect(await readRegistered()).toEqual([
        'prompt:general/alpha_prompt',
        'prompt:general/beta_prompt',
      ]);
      expect(await exists(path.join(outputDir, 'gamma_prompt'))).toBe(false);
    });
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
          // `WHERE client = ? AND scope = ?` clears the pair; a third `resource_key = ?` narrows it.
          rows = rows.filter(
            (row) =>
              !(
                row['client'] === params[0] &&
                row['scope'] === params[1] &&
                (!sql.includes('resource_key = ?') || row['resource_key'] === params[2])
              )
          );
        } else if (sql.includes('INSERT INTO skills_sync_manifests')) {
          // The real table's PRIMARY KEY (client, scope, resource_key).
          if (rows.some((row) => columns.slice(0, 3).every((c, i) => row[c] === params[i]))) {
            throw new Error('UNIQUE constraint failed: skills_sync_manifests');
          }
          rows.push(Object.fromEntries(columns.map((column, i) => [column, params[i]])));
        }
      },
      transaction: async (fn: () => unknown) => await fn(),
    };
  }

  it("records each resource's own history version, even under a directory named prompts", async () => {
    // Twins that differ in ONE identifier, the resource type: the gate `twin` and a prompt `twin`
    // with more history. The server root sits under a directory named `prompts`, so a lookup that
    // derives the resource from the gate's path reads it as a prompt and records 3, not 2.
    serverRoot = path.join(tmpDir, 'prompts', 'server');
    process.env['MCP_SERVER_ROOT'] = serverRoot;
    await mkdir(serverRoot, { recursive: true });
    await writeFile(
      path.join(serverRoot, 'skills-sync.yaml'),
      yaml.dump({
        registrations: { 'claude-code': 'all' },
        overrides: { 'claude-code': { outputDir: { user: outputDir, project: outputDir } } },
      })
    );
    await writeGate('twin', 'Twin');
    await writePrompt('solo');
    await seedStateDbSchema(serverRoot);
    const gateDir = path.join(serverRoot, 'resources', 'gates', 'twin');
    for (let v = 1; v <= 2; v += 1) saveVersion(gateDir, 'gate', 'twin', { v });
    for (let v = 1; v <= 3; v += 1) saveVersion(gateDir, 'prompt', 'twin', { v });
    saveVersion(gateDir, 'prompt', 'solo', { v: 1 });

    const dbManager = manifestDatabase();
    await run({ command: 'sync', dbManager: dbManager as never });

    const versions = Object.fromEntries(
      dbManager
        .query('SELECT * FROM skills_sync_manifests', ['claude-code', 'user'])
        .map((row) => [row['resource_key'], row['version']])
    );
    expect(versions).toEqual({ 'gate:twin': 2, 'prompt:general/solo': 1 });
  });

  describe('a filtered run keeps the manifest rows of the skills it did not touch', () => {
    const rowsByKey = (db: ReturnType<typeof manifestDatabase>) =>
      Object.fromEntries(
        db
          .query('SELECT * FROM skills_sync_manifests', ['claude-code', 'user'])
          .map((row) => [row['resource_key'] as string, row])
      );

    it.each(['export', 'sync'] as const)(
      '%s --id keeps the other skill row and refreshes its own',
      async (command) => {
        await writePrompt('alpha_prompt');
        await writePrompt('beta_prompt');
        const db = manifestDatabase();
        await run({ command, dbManager: db as never });
        const before = rowsByKey(db);
        expect(Object.keys(before).sort()).toEqual([
          'prompt:general/alpha_prompt',
          'prompt:general/beta_prompt',
        ]);
        await writeFile(
          path.join(
            serverRoot,
            'resources',
            'prompts',
            'general',
            'beta_prompt',
            'user-message.md'
          ),
          'Do the OTHER thing.'
        );

        await run({ command, id: 'beta_prompt', dbManager: db as never });

        const after = rowsByKey(db);
        expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
        expect(after['prompt:general/alpha_prompt']).toEqual(before['prompt:general/alpha_prompt']);
        const betaBefore = before['prompt:general/beta_prompt'];
        const betaAfter = after['prompt:general/beta_prompt'];
        expect(betaAfter?.['source_hash']).not.toBe(betaBefore?.['source_hash']);
        expect(betaAfter?.['output_hash']).not.toBe(betaBefore?.['output_hash']);
      }
    );

    it.each(['export', 'sync'] as const)(
      'an unfiltered %s after the source is deleted still drops that row (control)',
      async (command) => {
        await writePrompt('alpha_prompt');
        await writePrompt('beta_prompt');
        const db = manifestDatabase();
        await run({ command, dbManager: db as never });
        await rm(path.join(serverRoot, 'resources', 'prompts', 'general', 'alpha_prompt'), {
          recursive: true,
          force: true,
        });

        await run({ command, dbManager: db as never });

        expect(Object.keys(rowsByKey(db))).toEqual(['prompt:general/beta_prompt']);
      }
    );
  });

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

  /**
   * Diff against a saved manifest: the comparison the manifest path owns, as opposed to the
   * would-be-export fallback above. Each case perturbs ONE thing after an export and first proves
   * the perturbation exists (the manifest row, the edited bytes), so a diff that reported
   * nothing could not pass by the drift never having been made.
   */
  describe('diff with a saved manifest', () => {
    type Db = ReturnType<typeof manifestDatabase>;
    const manifestKeys = (db: Db) =>
      db
        .query('SELECT * FROM skills_sync_manifests', ['claude-code', 'user'])
        .map((row) => row['resource_key'] as string)
        .sort();
    const promptDir = (id: string) => path.join(serverRoot, 'resources', 'prompts', 'general', id);
    type Entry = { type: string; id: string; files: string[] };
    const entriesOf = (report: { drift?: Array<{ entries: Entry[] }> }) =>
      report.drift?.[0]?.entries ?? [];

    async function exportWithManifest(ids: string[]): Promise<Db> {
      for (const id of ids) await writePrompt(id);
      const db = manifestDatabase();
      await run({ command: 'sync', dbManager: db as never });
      expect(manifestKeys(db)).toEqual(ids.map((id) => `prompt:general/${id}`).sort());
      return db;
    }
    const diff = (db: Db, opts: Partial<SkillsSyncOptions> = {}) =>
      run({ command: 'diff', dbManager: db as never, ...opts });

    async function editSource(id: string): Promise<void> {
      const file = path.join(promptDir(id), 'user-message.md');
      const before = await readFile(file, 'utf-8');
      await writeFile(file, 'Do the OTHER thing.');
      expect(before).toBe('Do the thing.');
      expect(await readFile(file, 'utf-8')).not.toBe(before);
    }
    async function editExportedSkill(id: string): Promise<void> {
      const before = await readFile(skillMdPath(id), 'utf-8');
      await writeFile(skillMdPath(id), before + '\nHand-typed paragraph.\n');
      expect(await readFile(skillMdPath(id), 'utf-8')).toContain('Hand-typed paragraph.');
    }

    it('reports a resource with no manifest row as new, and leaves the exported ones clean', async () => {
      const db = await exportWithManifest(['stable_prompt']);
      await writePrompt('fresh_prompt');
      expect(manifestKeys(db)).not.toContain('prompt:general/fresh_prompt');

      const { report, out } = await diff(db);

      expect(entriesOf(report)).toEqual([{ type: 'new', id: 'fresh_prompt', files: [] }]);
      expect(out.logs).toContain('  [NEW] fresh_prompt — not in manifest');
      expect(out.logs.join('\n')).not.toContain('no manifest is saved');
    });

    it('reports changed canonical sources as source drift and names the changed file', async () => {
      const db = await exportWithManifest(['stable_prompt', 'edited_source']);
      await editSource('edited_source');
      const snapshot = JSON.parse(
        db
          .query('SELECT * FROM skills_sync_manifests', ['claude-code', 'user'])
          .find((row) => row['resource_id'] === 'edited_source')?.['source_snapshot'] as string
      ) as Record<string, string>;
      expect(snapshot['user-message.md']).toBe('Do the thing.');

      const { report, out } = await diff(db);

      expect(entriesOf(report)).toContainEqual({
        type: 'source',
        id: 'edited_source',
        files: ['user-message.md'],
      });
      expect(entriesOf(report).map((e) => e.id)).not.toContain('stable_prompt');
      const log = out.logs.join('\n');
      expect(log).toContain('[SOURCE DRIFT] edited_source — canonical sources changed');
      // The source patch, not just the output patch (which carries the same text).
      expect(log).toContain('--- a/edited_source/user-message.md');
      expect(log).toContain('+Do the OTHER thing.');
    });

    it('reports a locally edited exported file as output drift with its patch', async () => {
      const db = await exportWithManifest(['stable_prompt', 'edited_output']);
      await editExportedSkill('edited_output');

      const { report, out } = await diff(db);

      expect(entriesOf(report)).toEqual([
        { type: 'output', id: 'edited_output', files: ['edited_output/SKILL.md'] },
      ]);
      const log = out.logs.join('\n');
      expect(log).toContain('[OUTPUT DRIFT] edited_output — exported files modified locally');
      expect(log).toContain('-Hand-typed paragraph.');
    });

    it('reports a manifest row whose resource is gone as an orphan', async () => {
      const db = await exportWithManifest(['stable_prompt', 'retired_prompt']);
      await rm(promptDir('retired_prompt'), { recursive: true, force: true });
      expect(await exists(promptDir('retired_prompt'))).toBe(false);
      expect(manifestKeys(db)).toContain('prompt:general/retired_prompt');

      const { report, out } = await diff(db);

      expect(entriesOf(report)).toEqual([
        { type: 'orphan', id: 'prompt:general/retired_prompt', files: [] },
      ]);
      expect(out.logs).toContain(
        '  [ORPHAN] prompt:general/retired_prompt (prompt) — no longer in sources'
      );
    });

    it('reports source drift without file names when the manifest row carries no snapshot', async () => {
      const db = await exportWithManifest(['edited_source']);
      await editSource('edited_source');
      for (const row of db.query('SELECT * FROM skills_sync_manifests', ['claude-code', 'user'])) {
        row['source_snapshot'] = null;
      }

      const { report, out } = await diff(db);

      expect(entriesOf(report)).toContainEqual({ type: 'source', id: 'edited_source', files: [] });
      // With nothing to compare against there is no patch to print.
      expect(out.logs.join('\n')).not.toContain('--- a/edited_source/user-message.md');
    });

    it('prints a summary line per drift type', async () => {
      const db = await exportWithManifest(['stable_prompt', 'edited_output', 'retired_prompt']);
      await writePrompt('fresh_prompt');
      await editExportedSkill('edited_output');
      await rm(promptDir('retired_prompt'), { recursive: true, force: true });

      const { out } = await diff(db);

      expect(out.logs).toContain('  3 drift(s):');
      expect(out.logs).toContain('    new      fresh_prompt');
      expect(out.logs).toContain('    output   edited_output');
      expect(out.logs).toContain('    orphan   prompt:general/retired_prompt');
      expect(out.logs.join('\n')).not.toContain('no drift detected');
    });

    it('--output writes the patches, a drift report and a machine-readable manifest', async () => {
      const db = await exportWithManifest([
        'stable_prompt',
        'edited_source',
        'edited_output',
        'retired_prompt',
      ]);
      await writePrompt('fresh_prompt');
      await editSource('edited_source');
      await editExportedSkill('edited_output');
      await rm(promptDir('retired_prompt'), { recursive: true, force: true });
      const patchDir = path.join(tmpDir, 'patches');

      // Control: the same diff without --output leaves no directory behind.
      await diff(db);
      expect(await exists(patchDir)).toBe(false);

      const { out } = await diff(db, { output: patchDir });

      const clientDir = path.join(patchDir, 'claude-code.user');
      expect(out.logs).toContain(`  output → ${clientDir}/`);
      expect((await readdir(clientDir)).sort()).toEqual([
        'drift-report.md',
        'edited_output',
        'edited_source',
        'manifest.json',
      ]);
      expect(
        await readFile(
          path.join(clientDir, 'edited_source', 'source--user-message.md.patch'),
          'utf-8'
        )
      ).toContain('+Do the OTHER thing.');
      expect(
        await readFile(
          path.join(clientDir, 'edited_output', 'output--edited_output--SKILL.md.patch'),
          'utf-8'
        )
      ).toContain('-Hand-typed paragraph.');

      const driftReport = await readFile(path.join(clientDir, 'drift-report.md'), 'utf-8');
      expect(driftReport).toContain('# Drift Report: claude-code (user)');
      expect(driftReport).toContain('## [SOURCE] edited_source');
      expect(driftReport).toContain('### source/user-message.md');
      expect(driftReport).toContain('## [OUTPUT] edited_output');
      expect(driftReport).toContain('## [NEW] fresh_prompt');
      expect(driftReport).toContain('New resource — not yet in manifest.');
      expect(driftReport).toContain('## [ORPHAN] prompt:general/retired_prompt');
      expect(driftReport).toContain('Resource removed from sources but still in manifest.');

      const machine = JSON.parse(
        await readFile(path.join(clientDir, 'manifest.json'), 'utf-8')
      ) as {
        client: string;
        scope: string;
        drifts: Array<{ type: string; id: string; files: string[]; patches: string[] }>;
      };
      expect(machine.client).toBe('claude-code');
      expect(machine.scope).toBe('user');
      expect(machine.drifts).toContainEqual({
        type: 'source',
        id: 'edited_source',
        files: ['user-message.md'],
        patches: ['source/user-message.md'],
      });
      expect(machine.drifts).toContainEqual({
        type: 'output',
        id: 'edited_output',
        files: ['edited_output/SKILL.md'],
        patches: ['output/edited_output/SKILL.md'],
      });
      expect(machine.drifts).toContainEqual({
        type: 'new',
        id: 'fresh_prompt',
        files: [],
        patches: [],
      });
      expect(machine.drifts).toContainEqual({
        type: 'orphan',
        id: 'prompt:general/retired_prompt',
        files: [],
        patches: [],
      });
    });

    it('--output writes nothing for a client and scope that did not drift', async () => {
      const db = await exportWithManifest(['stable_prompt']);
      const patchDir = path.join(tmpDir, 'patches');

      const { report } = await diff(db, { output: patchDir });

      expect(entriesOf(report)).toEqual([]);
      expect(await readdir(patchDir)).toEqual([]);
    });
  });

  describe('manifest version dates', () => {
    it('records the history date for a versioned resource and null for an unversioned one', async () => {
      await writePrompt('versioned_prompt');
      await writePrompt('unversioned_prompt');
      await seedStateDbSchema(serverRoot);
      saveVersion(promptDirOf('versioned_prompt'), 'prompt', 'versioned_prompt', { v: 1 });
      const db = manifestDatabase();

      await run({ command: 'sync', dbManager: db as never });

      const rows = Object.fromEntries(
        db
          .query('SELECT * FROM skills_sync_manifests', ['claude-code', 'user'])
          .map((row) => [row['resource_id'], row])
      );
      expect(rows['versioned_prompt']?.['version']).toBe(1);
      const stamped = rows['versioned_prompt']?.['version_date'];
      expect(typeof stamped).toBe('string');
      expect(Number.isNaN(Date.parse(stamped as string))).toBe(false);
      // Control: a resource with no history row records neither.
      expect(rows['unversioned_prompt']?.['version']).toBeNull();
      expect(rows['unversioned_prompt']?.['version_date']).toBeNull();
    });

    function promptDirOf(id: string): string {
      return path.join(serverRoot, 'resources', 'prompts', 'general', id);
    }
  });

  /**
   * The tool index is read from `resource_index` through the database port. Rows carry nullable
   * columns and a metadata blob that is trusted nowhere else, so the export has to cope with each
   * shape a row can take and say which tools fell back to the on-disk tool.yaml.
   */
  describe('tool index rows', () => {
    const toolRow = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      name: null,
      category: null,
      description: null,
      content_hash: null,
      metadata_json: null,
      ...overrides,
    });

    function toolIndexDatabase(toolRows: Array<Record<string, unknown>> | Error) {
      const manifests = manifestDatabase();
      return {
        ...manifests,
        query: (sql: string, params: unknown[] = []) => {
          if (!sql.includes('resource_index')) return manifests.query(sql, params);
          if (toolRows instanceof Error) throw toolRows;
          return toolRows;
        },
      };
    }

    async function writeToolbox(toolIds: string[]): Promise<void> {
      await writePrompt('toolbox', { tools: toolIds });
      for (const toolId of toolIds) {
        const toolDir = path.join(
          serverRoot,
          'resources',
          'prompts',
          'general',
          'toolbox',
          'tools',
          toolId
        );
        await mkdir(toolDir, { recursive: true });
        await writeFile(
          path.join(toolDir, 'tool.yaml'),
          yaml.dump({ id: toolId, name: `${toolId} on disk`, runtime: 'python' })
        );
        await writeFile(path.join(toolDir, 'script.py'), `print("${toolId}")\n`);
        await writeFile(path.join(toolDir, 'run.js'), `console.log("${toolId}")\n`);
      }
    }
    const toolFiles = async (toolId: string) =>
      (await readdir(path.join(outputDir, 'toolbox', 'tools', toolId))).sort();
    const readToolJson = async (toolId: string) =>
      JSON.parse(
        await readFile(path.join(outputDir, 'toolbox', 'tools', toolId, 'tool.json'), 'utf-8')
      ) as Record<string, unknown>;

    it('exports a tool with schema and config from its row, defaults for missing metadata, and a warning per tool that is not usable', async () => {
      await writeToolbox(['tool_full', 'tool_nulls', 'tool_nullmeta', 'tool_garbage']);
      const db = toolIndexDatabase([
        toolRow('toolbox/tool_full', {
          name: 'Full Tool',
          metadata_json: JSON.stringify({
            runtime: 'node',
            input_schema: { type: 'object', properties: { x: { type: 'string' } } },
            execution: { trigger: 'explicit', confirm: false, strict: true, timeout: 5 },
            env: { FOO: 'bar' },
            script_path: 'run.js',
          }),
        }),
        // Every nullable column null and an empty metadata object: all defaults apply.
        toolRow('toolbox/tool_nulls', { metadata_json: '{}' }),
        // No metadata at all, and metadata that is not JSON: neither can describe a tool.
        toolRow('toolbox/tool_nullmeta', { metadata_json: null }),
        toolRow('toolbox/tool_garbage', { metadata_json: '{not json' }),
      ]);

      const { report, out } = await run({ command: 'sync', dbManager: db as never });

      // tool_full: schema.json and tool.json from the row, the script it named.
      expect(await toolFiles('tool_full')).toEqual(['schema.json', 'script.js', 'tool.json']);
      expect(await readToolJson('tool_full')).toEqual({
        name: 'Full Tool',
        runtime: 'node',
        trigger: 'explicit',
        confirm: false,
        strict: true,
        timeout: 5,
        env: { FOO: 'bar' },
      });
      // tool_nulls: name falls back to the row id, runtime to auto, execution to the defaults.
      expect(await readToolJson('tool_nulls')).toEqual({
        name: 'toolbox/tool_nulls',
        runtime: 'auto',
        trigger: 'schema_match',
        confirm: true,
        strict: false,
      });
      expect(await toolFiles('tool_nulls')).not.toContain('schema.json');
      // The two unusable rows fall back to tool.yaml: no tool.json, and one warning each.
      for (const toolId of ['tool_nullmeta', 'tool_garbage']) {
        expect(await toolFiles(toolId)).not.toContain('tool.json');
        expect(
          out.warns.some((w) => w.includes(`toolbox/${toolId}: not in the resource index`))
        ).toBe(true);
        expect(report.failures.map((f) => f.id)).toContain(`toolbox/${toolId}`);
      }
      expect(out.warns.some((w) => w.includes('toolbox/tool_full:'))).toBe(false);
      expect(out.warns.some((w) => w.includes('toolbox/tool_nulls:'))).toBe(false);
      // The cache was not empty, so the blanket "no tools indexed" warning does not fire.
      expect(out.warns.join('\n')).not.toContain('Tools not found in resource index');
    });

    it('exports every tool without schema and warns once when the index query fails', async () => {
      await writeToolbox(['tool_full']);

      const { report, out } = await run({
        command: 'sync',
        dbManager: toolIndexDatabase(new Error('resource_index unavailable')) as never,
      });

      expect(out.warns.some((w) => w.includes('Tools not found in resource index'))).toBe(true);
      expect(await toolFiles('tool_full')).toEqual(['script.py']);
      expect(report.failures.map((f) => f.id)).toContain('toolbox/tool_full');
      expect(report.written).toBeGreaterThan(0);

      // Control: the same tree with a working index exports the schema and config, so the
      // missing files above came from the failed query.
      await rm(outputDir, { recursive: true, force: true });
      await run({
        command: 'sync',
        dbManager: toolIndexDatabase([
          toolRow('toolbox/tool_full', {
            metadata_json: JSON.stringify({
              input_schema: { type: 'object', properties: { x: {} } },
            }),
          }),
        ]) as never,
      });
      expect(await toolFiles('tool_full')).toContain('schema.json');
    });
  });
});
