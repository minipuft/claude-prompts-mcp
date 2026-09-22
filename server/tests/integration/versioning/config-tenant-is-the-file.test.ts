// @lifecycle canonical - Integration tests for P4.109: a config file's history belongs to the file.
/**
 * Which tenant a `version_history` row about a CONFIG file is keyed under.
 *
 * WHAT WAS BROKEN. Every config writer used to resolve its tenant the way every other resource
 * does — `resolveTenantId`, the basename of the writing process's `CLAUDE_PROJECT_DIR`/cwd. The
 * writers do not share a working directory: the server runs from its install path while `cpm` runs
 * from the operator's. Measured 2026-09-21 against a hermetic server serving a temp workspace,
 * before the fix: `system_control gates disable --persist` recorded under tenant `server` and `cpm
 * config set` against the SAME file recorded under the workspace basename — one file, two
 * histories, both numbered from 1, and `cpm config history` listed only one of them.
 *
 * WHAT THESE CASES PIN. Three properties, each stated as what an operator sees:
 *
 *   1. Two processes with different working directories writing ONE config file produce ONE
 *      history. (`process.chdir` is the drive: it is the whole of what used to differ.)
 *   2. Two workspaces sharing one `state.db` keep two histories and cannot read each other's.
 *      Every config row in the repository is keyed `('config','config')`, so this is the property
 *      that the generic scope CORRECTION would have broken in the other direction.
 *   3. A config request that reaches the generic tenant machinery is refused by name rather than
 *      answered, at both places it could arrive.
 *
 * Each absence assertion carries a positive control, because "workspace B does not see workspace
 * A's versions" is equally satisfied by a probe that sees nothing at all.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { setConfigValueRecorded } from '../../../src/cli-shared/config-checkpoint.js';
import { loadConfigHistory } from '../../../src/cli-shared/config-restore.js';
import { resolveEffectiveTenantId } from '../../../src/cli-shared/version-history-scope.js';
import { loadHistory } from '../../../src/cli-shared/version-history.js';
import { configTenantId } from '../../../src/shared/utils/config-scope.js';
import { testScratchPath } from '../../helpers/scratch-path.js';
import { seedStateDbSchema } from '../../helpers/test-database.js';

const CONFIG_BODY = `{
  // the operator's own note — café ☕
  "version": 5,
  "gates": { "enabled": true }
}
`;

describe('a config file owns its version history, whatever wrote it', () => {
  let root: string;
  let previousProjectDir: string | undefined;
  let previousCwd: string;

  const makeWorkspace = (name: string): string => {
    const workspace = path.join(root, name);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, 'config.jsonc'), CONFIG_BODY, 'utf8');
    return workspace;
  };

  const descriptions = (workspace: string): string[] =>
    (loadConfigHistory(workspace)?.versions ?? []).map((entry) => entry.description);

  beforeEach(() => {
    previousProjectDir = process.env['CLAUDE_PROJECT_DIR'];
    previousCwd = process.cwd();
    root = testScratchPath(`config-tenant-${Math.random().toString(36).slice(2)}`);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousProjectDir === undefined) delete process.env['CLAUDE_PROJECT_DIR'];
    else process.env['CLAUDE_PROJECT_DIR'] = previousProjectDir;
    rmSync(root, { recursive: true, force: true });
  });

  it('records one history for one file, whatever directory the writer ran from', async () => {
    const workspace = makeWorkspace('ws');
    await seedStateDbSchema(workspace);

    // Writer 1: the shape of `cpm`, run from the workspace itself.
    delete process.env['CLAUDE_PROJECT_DIR'];
    process.chdir(workspace);
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');

    // Writer 2: the shape of a server launched from its own install directory. Under the old
    // derivation this was a second tenant, and everything below is what that cost.
    const installDir = path.join(root, 'install');
    mkdirSync(installDir, { recursive: true });
    process.chdir(installDir);
    process.env['CLAUDE_PROJECT_DIR'] = installDir;
    await setConfigValueRecorded(workspace, 'server.port', '4321');

    const db = new DatabaseSync(path.join(workspace, 'runtime-state', 'state.db'));
    try {
      const tenants = db
        .prepare(`SELECT DISTINCT tenant_id FROM version_history WHERE resource_type = 'config'`)
        .all() as Array<{ tenant_id: string }>;
      expect(tenants.map((row) => row.tenant_id)).toEqual([
        configTenantId(path.join(workspace, 'config.jsonc')),
      ]);
    } finally {
      db.close();
    }

    // Read back from a THIRD directory: the listing is one history carrying both writes.
    process.chdir(root);
    expect(descriptions(workspace)).toEqual(
      expect.arrayContaining(['Set gates.enabled', 'Set server.port'])
    );
    expect(loadConfigHistory(workspace)?.versions).toHaveLength(3); // bridge + two writes
  });

  it('keeps two workspaces on one state.db from reading each other, while each reads its own', async () => {
    const alpha = makeWorkspace('alpha');
    const beta = makeWorkspace('beta');
    await seedStateDbSchema(alpha);

    // ONE database for both: `MCP_RUNTIME_ROOT` is what a shared `state.db` looks like, and it is
    // `resolveStateDbPath`'s first branch for every process here.
    const previousRuntimeRoot = process.env['MCP_RUNTIME_ROOT'];
    process.env['MCP_RUNTIME_ROOT'] = alpha;
    try {
      await setConfigValueRecorded(alpha, 'server.port', '4101');
      await setConfigValueRecorded(beta, 'gates.enabled', 'false');

      // Positive control FIRST: each workspace can see its own write. Without this, the
      // cross-workspace assertions below would pass against a reader that finds nothing anywhere.
      expect(descriptions(alpha)).toContain('Set server.port');
      expect(descriptions(beta)).toContain('Set gates.enabled');

      expect(descriptions(alpha)).not.toContain('Set gates.enabled');
      expect(descriptions(beta)).not.toContain('Set server.port');
    } finally {
      if (previousRuntimeRoot === undefined) delete process.env['MCP_RUNTIME_ROOT'];
      else process.env['MCP_RUNTIME_ROOT'] = previousRuntimeRoot;
    }
  });

  it('resolves a workspace reached through a symlink to the same history as its real path', async () => {
    const workspace = makeWorkspace('real');
    await seedStateDbSchema(workspace);
    const link = path.join(root, 'link');
    symlinkSync(workspace, link, 'dir');

    await setConfigValueRecorded(workspace, 'server.port', '4444');
    expect(descriptions(link)).toContain('Set server.port');
    // Control: a DIFFERENT directory is still a different history, so the agreement above is about
    // the symlink resolving and not about every path collapsing onto one id.
    const other = makeWorkspace('other');
    expect(configTenantId(path.join(other, 'config.jsonc'))).not.toBe(
      configTenantId(path.join(workspace, 'config.jsonc'))
    );
  });

  it('refuses a config request that resolved its tenant the generic way, at both entry points', async () => {
    const workspace = makeWorkspace('refused');
    await seedStateDbSchema(workspace);

    // (a) the dispatcher: a ref with no tenant is a reader that skipped `configTenantId`.
    expect(() => loadHistory(workspace, { resourceType: 'config', resourceId: 'config' })).toThrow(
      /configTenantId/
    );

    // Control: the same call for a resource whose tenant IS a workspace scope is not refused.
    expect(loadHistory(workspace, { resourceType: 'gate', resourceId: 'anything' })).toBeNull();

    // (b) the correction itself, which would otherwise serve another project's config history —
    // every workspace keys its rows under the same resource_type/resource_id pair.
    const db = new DatabaseSync(':memory:');
    try {
      expect(() =>
        resolveEffectiveTenantId(db, 'some-workspace', {
          resource_type: 'config',
          resource_id: 'config',
        })
      ).toThrow(/configTenantId/);
    } finally {
      db.close();
    }
  });
});
