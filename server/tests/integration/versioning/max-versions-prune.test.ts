// @lifecycle test - Both writers of version_history trim to the operator's configured bound.
/**
 * `versioning.maxVersions` must mean the same number on both surfaces.
 *
 * It did not. `VersionHistoryService` trimmed to the configured value; the CLI's public writers
 * bound a hardcoded `DEFAULT_MAX_VERSIONS` into every request, so a workspace configured to keep
 * three versions kept three after an MCP edit and fifty after a `cpm rollback` — against one
 * `state.db`, on one resource. The bound is now resolved from the workspace config document and
 * both writers call ONE prune.
 *
 * Four properties, one per way the fix can be wrong:
 *   a. the server keeps exactly N, and keeps the NEWEST N (a prune ordered the other way would
 *      still leave N rows and pass a count-only assertion);
 *   b. the CLI keeps exactly N for the same N, through the same real `state.db`;
 *   c. `resolveConfiguredMaxVersions` reads the file — both spellings — and falls back rather
 *      than throwing on a missing or malformed value;
 *   d. every `cpm` command that calls a CLI write function supplies that bound. (c) proves the
 *      resolver works; only (d) says anything reached it, and it is enumerated from the command
 *      directory rather than from a list in this file.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TestDatabaseContext } from '../../helpers/test-database.js';
import type { VersioningConfigProvider } from '../../../src/modules/versioning/version-history-service.js';

import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { createTestDatabaseManager, seedStateDbSchema } from '../../helpers/test-database.js';
import { testScratchPath } from '../../helpers/scratch-path.js';
import { resolveConfiguredMaxVersions } from '../../../src/cli-shared/version-history.js';
import { saveVersion } from '../../helpers/version-history-writer.js';
import { DEFAULT_MAX_VERSIONS } from '../../../src/cli-shared/version-history-types.js';

const TENANT = 'max-versions-tenant';
const KEPT = 3;
const WRITTEN = 5;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

class FixedVersioningConfig implements VersioningConfigProvider {
  constructor(
    private readonly root: string,
    private readonly maxVersions: number
  ) {}
  getVersioningConfig() {
    return { enabled: true, maxVersions: this.maxVersions, autoVersion: true };
  }
  getServerRoot(): string {
    return this.root;
  }
}

describe('versioning.maxVersions is one bound for both writers', () => {
  describe('the server writer', () => {
    let ctx: TestDatabaseContext;

    beforeEach(async () => {
      ctx = await createTestDatabaseManager('max-versions-server');
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    it(`keeps exactly ${KEPT} rows, and the newest ${KEPT}`, async () => {
      const service = new VersionHistoryService({
        logger: ctx.logger as never,
        configManager: new FixedVersioningConfig(ctx.testDir, KEPT),
        dbManager: ctx.dbManager,
        scope: { workspaceId: TENANT },
      });

      for (let i = 1; i <= WRITTEN; i += 1) {
        await service.saveVersion('gate', 'alpha', { body: `v${i}` }, { description: `v${i}` });
      }

      const rows = ctx.dbManager.query<{ version: number; snapshot: string }>(
        'SELECT version, snapshot FROM version_history ORDER BY version'
      );
      expect(rows.map((row) => row.version)).toEqual([3, 4, 5]);
      // The SNAPSHOT is read, not only the number: a prune that kept the oldest rows and a
      // renumbering that shifted them apart both produce `[3,4,5]`.
      expect(rows.map((row) => JSON.parse(row.snapshot).body)).toEqual(['v3', 'v4', 'v5']);
    });
  });

  describe('the CLI writer, against a real state.db', () => {
    let workspace: string;
    const savedRuntimeRoot = process.env['MCP_RUNTIME_ROOT'];
    const savedWorkspace = process.env['MCP_WORKSPACE'];
    const savedResources = process.env['MCP_RESOURCES_PATH'];

    beforeEach(async () => {
      workspace = testScratchPath('max-versions-cli');
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.mkdir(workspace, { recursive: true });
      await seedStateDbSchema(workspace);
      // The ambient shell exports MCP_RESOURCES_PATH; nothing here may resolve against it.
      delete process.env['MCP_RESOURCES_PATH'];
      delete process.env['MCP_WORKSPACE'];
      process.env['MCP_RUNTIME_ROOT'] = workspace;
    });

    afterEach(async () => {
      for (const [key, value] of [
        ['MCP_RUNTIME_ROOT', savedRuntimeRoot],
        ['MCP_WORKSPACE', savedWorkspace],
        ['MCP_RESOURCES_PATH', savedResources],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await fs.rm(workspace, { recursive: true, force: true });
    });

    function versionsOnDisk(): Array<{ version: number; body: string }> {
      const db = new DatabaseSync(path.join(workspace, 'runtime-state', 'state.db'));
      const rows = db
        .prepare('SELECT version, snapshot FROM version_history ORDER BY version')
        .all() as unknown as Array<{ version: number; snapshot: string }>;
      db.close();
      return rows.map((row) => ({
        version: Number(row.version),
        body: (JSON.parse(row.snapshot) as { body: string }).body,
      }));
    }

    it(`keeps exactly ${KEPT} rows when the workspace config says ${KEPT}`, async () => {
      await fs.writeFile(
        path.join(workspace, 'config.json'),
        JSON.stringify({ version: 5, versioning: { maxVersions: KEPT } })
      );

      const configured = resolveConfiguredMaxVersions(workspace);
      expect(configured).toBe(KEPT);

      for (let i = 1; i <= WRITTEN; i += 1) {
        saveVersion(
          workspace,
          'gate',
          'alpha',
          { body: `v${i}` },
          { description: `v${i}`, maxVersions: configured }
        );
      }

      expect(versionsOnDisk()).toEqual([
        { version: 3, body: 'v3' },
        { version: 4, body: 'v4' },
        { version: 5, body: 'v5' },
      ]);
    });

    it('keeps the built-in default when the workspace configures nothing — the control', async () => {
      // Without this, the case above cannot distinguish "the configured value was honoured" from
      // "some prune ran": WRITTEN is below the default, so the default keeps everything.
      expect(resolveConfiguredMaxVersions(workspace)).toBe(DEFAULT_MAX_VERSIONS);

      for (let i = 1; i <= WRITTEN; i += 1) {
        saveVersion(
          workspace,
          'gate',
          'alpha',
          { body: `v${i}` },
          { description: `v${i}`, maxVersions: resolveConfiguredMaxVersions(workspace) }
        );
      }

      expect(versionsOnDisk().map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
    });

    it('reads the 4.x snake_case spelling the server still folds in', async () => {
      await fs.writeFile(
        path.join(workspace, 'config.json'),
        JSON.stringify({ version: 5, versioning: { max_versions: 7 } })
      );
      expect(resolveConfiguredMaxVersions(workspace)).toBe(7);
    });

    it('falls back rather than throwing on a malformed value', async () => {
      for (const bad of ['many', 0, -3, 2.5, null]) {
        await fs.writeFile(
          path.join(workspace, 'config.json'),
          JSON.stringify({ version: 5, versioning: { maxVersions: bad } })
        );
        expect(resolveConfiguredMaxVersions(workspace)).toBe(DEFAULT_MAX_VERSIONS);
      }
    });
  });

  /**
   * The class, not the site.
   *
   * The defect's SHAPE is "a `cpm` command writes version rows without saying what bound to trim
   * to". Fixing `rollback.ts` closes today's only instance; this closes the class, and it
   * enumerates the instances from the commands directory rather than from a list here — a new
   * command that starts writing history is a finding, not an omission nobody notices.
   */
  describe('every cpm command that writes history supplies the configured bound', () => {
    /**
     * Where each CLI writer's options object sits in its parameter list, 1-based, and the type it
     * declares there.
     *
     * Both halves are asserted against the source below rather than trusted: a renamed or moved
     * parameter would otherwise make this scanner check the wrong argument and keep passing.
     * `rollbackVersion` names a different type from the other two because it also takes the
     * restore callback there — the bound rides in the same object either way, which is the
     * property this scanner is about.
     */
    const WRITERS: Record<string, { position: number; optionsType: string }> = {
      // `saveVersion` was removed from this list when it left `cli-shared` (P4.106): it had no
      // `cpm` call site at all, and now lives in `tests/helpers/version-history-writer.ts`,
      // where no bound a workspace configured applies to it.
      // `recordResourceWrite` replaced `recordEditResult` here on 2026-09-21: it is the writer
      // every `cpm` edit and create now reaches, and its bound rides in the same object as the
      // write callback rather than in an options argument of its own.
      recordResourceWrite: { position: 3, optionsType: 'ResourceWriteRecord' },
      rollbackVersion: { position: 5, optionsType: 'RollbackRestore' },
    };

    /**
     * Top-level arguments of the call (or parameters of the declaration) starting at `open`.
     *
     * `angles` is only set when reading a DECLARATION: there `<` and `>` can only be a generic,
     * and without tracking them `Record<string, unknown>` reads as two parameters. In an argument
     * list they may also be comparisons, so the flag stays off and no call site here carries one.
     */
    function argumentsOf(source: string, open: number, angles = false): string[] {
      let depth = 0;
      let current = '';
      const args: string[] = [];
      for (let i = open; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(' || ch === '[' || ch === '{' || (angles && ch === '<')) depth += 1;
        if (angles && ch === '>') depth -= 1;
        if (ch === ')' || ch === ']' || ch === '}') {
          depth -= 1;
          if (depth === 0) {
            if (current.trim() !== '') args.push(current.trim());
            return args;
          }
        }
        if (ch === ',' && depth === 1) {
          args.push(current.trim());
          current = '';
          continue;
        }
        if (!(depth === 1 && i === open)) current += ch;
      }
      return args;
    }

    /** Every call to a CLI writer in `source`, with the arguments it passed. */
    function callsIn(source: string): Array<{ name: string; args: string[] }> {
      const found: Array<{ name: string; args: string[] }> = [];
      for (const name of Object.keys(WRITERS)) {
        const pattern = new RegExp(`(^|[^\\w.])${name}\\s*\\(`, 'g');
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
          found.push({ name, args: argumentsOf(source, match.index + match[0].length - 1) });
        }
      }
      return found;
    }

    it('declares the options object where this scanner looks for it', () => {
      const source = readFileSync(
        path.join(REPO_ROOT, 'server/src/cli-shared/version-history.ts'),
        'utf8'
      );
      for (const [name, writer] of Object.entries(WRITERS)) {
        const start = source.search(new RegExp(`export (async )?function ${name}\\(`));
        expect(start).toBeGreaterThan(-1);
        const params = argumentsOf(source, source.indexOf('(', start), true);
        expect(params).toHaveLength(writer.position);
        expect(params[writer.position - 1]).toContain(writer.optionsType);
      }
    });

    it('passes a resolved bound at every cpm call site', () => {
      const commandsDir = path.join(REPO_ROOT, 'cli/src/commands');
      const files = readdirSync(commandsDir).filter((name) => name.endsWith('.ts'));
      expect(files.length).toBeGreaterThan(0);

      const offenders: string[] = [];
      let checked = 0;
      for (const file of files) {
        const source = readFileSync(path.join(commandsDir, file), 'utf8');
        for (const call of callsIn(source)) {
          checked += 1;
          const position = (WRITERS[call.name] as { position: number }).position;
          const supplied = call.args[position - 1];
          if (supplied === undefined || !supplied.includes('resolveConfiguredMaxVersions')) {
            offenders.push(`${file}: ${call.name} passes ${call.args.length} arguments`);
          }
        }
      }

      // The positive control for the scanner itself: an absence is only evidence once the probe
      // has been shown to see something. `cpm rollback` is the one live call site today.
      expect(checked).toBeGreaterThan(0);
      expect(offenders).toEqual([]);
    });

    it('reports a planted call that omits the bound — the scanner sees something', () => {
      const planted = `
        const a = rollbackVersion(dir, ref, 2, data, { enumerate, targets, apply });
        const b = rollbackVersion(dir, ref, 2, data, {
          enumerate,
          targets,
          apply,
          maxVersions: resolveConfiguredMaxVersions(ws),
        });
      `;
      const calls = callsIn(planted);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.args[4]).not.toContain('resolveConfiguredMaxVersions');
      expect(calls[1]?.args[4]).toContain('resolveConfiguredMaxVersions');
    });
  });
});
