/**
 * `buildServerEnv` refuses to build an environment without an isolated HOME.
 *
 * This is the load-bearing half of the HOME contract. `validate:hermetic-child-env` enforces the
 * same rule statically over every call site, but a static check reads spellings — this reads the
 * property, and it is what a spawn site written in a spelling the checker does not recognise
 * still hits.
 *
 * WHY IT MATTERS, measured 2026-09-15 against a temp home: one ordinary
 * `system_control skills_sync export` (`client: claude-code, scope: user`, no preview, refused by
 * nothing) wrote **224 files** into `$HOME/.claude/skills`. Every spawn site in this repository
 * inherited the developer's real `HOME` before this contract existed, so nothing but the absence
 * of such a scenario in the suite stood between a green run and a real `~/.claude/skills`
 * overwrite.
 *
 * WHY HOME CANNOT SIMPLY JOIN THE SCRUB LIST — the case the first three tests below pin: an unset
 * `HOME` does not isolate a child, it only changes which wrong directory it resolves.
 * `os.homedir()` falls back to the passwd entry, and skills-sync's own tilde expansion
 * (`process.env['HOME'] ?? ''`) falls back to the child's cwd.
 */

import { describe, expect, it } from '@jest/globals';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildServerEnv, createHermeticRoots } from '../../../scripts/lib/hermetic-server-env.js';

describe('buildServerEnv requires an isolated HOME', () => {
  it('refuses a call that states no HOME at all', () => {
    expect(() => buildServerEnv({ PORT: '1' })).toThrow(/requires an isolated HOME/);
  });

  it('refuses an empty HOME', () => {
    expect(() => buildServerEnv({ HOME: '' })).toThrow(/requires an isolated HOME/);
  });

  it('refuses a relative HOME, which would resolve against the child cwd', () => {
    expect(() => buildServerEnv({ HOME: './scratch-home' })).toThrow(/must be an absolute path/);
  });

  /**
   * The obvious way to satisfy a presence check is to hand back the very value the contract
   * exists to keep out. A token check passes this; a property check does not.
   */
  it("refuses the caller's own HOME", () => {
    expect(() => buildServerEnv({ HOME: os.homedir() })).toThrow(/reaches this process's own home/);
  });

  it('refuses an ANCESTOR of the caller’s home, which is one directory away from it', () => {
    expect(() => buildServerEnv({ HOME: path.dirname(os.homedir()) })).toThrow(
      /reaches this process's own home/
    );
  });

  /**
   * The negative control. Without it, every assertion above is satisfied by a builder that
   * refuses everything, which would be a gate that blocks rather than a gate that discriminates.
   */
  it('accepts a createHermeticRoots pair, and carries both halves through', () => {
    const roots = createHermeticRoots('hermetic-server-env-unit');
    try {
      const env = buildServerEnv({ ...roots.env, PORT: '1' });
      expect(env['HOME']).toBe(roots.home);
      expect(env['MCP_RUNTIME_ROOT']).toBe(roots.runtimeRoot);
      expect(env['PORT']).toBe('1');
    } finally {
      roots.cleanup();
    }
  });

  it('still scrubs the jest markers and the ambient MCP_* overrides', () => {
    const roots = createHermeticRoots('hermetic-server-env-scrub');
    try {
      // Jest sets both of these in this very process, which is what makes the assertion real
      // rather than a fixture: `NODE_ENV=test` is exactly what stops a child running `main()`.
      expect(process.env['NODE_ENV']).toBeDefined();
      const env = buildServerEnv({ ...roots.env });
      expect(env['NODE_ENV']).toBeUndefined();
      expect(env['JEST_WORKER_ID']).toBeUndefined();
      expect(env['MCP_RESOURCES_PATH']).toBeUndefined();
      expect(env['MCP_WORKSPACE']).toBeUndefined();
      expect(env['MCP_CONFIG_PATH']).toBeUndefined();
    } finally {
      roots.cleanup();
    }
  });
});

describe('createHermeticRoots', () => {
  it('creates both directories and removes them together', () => {
    const roots = createHermeticRoots('hermetic-roots-lifecycle');

    expect(existsSync(roots.home)).toBe(true);
    expect(existsSync(roots.runtimeRoot)).toBe(true);
    expect(roots.home.startsWith(roots.root)).toBe(true);
    expect(roots.runtimeRoot.startsWith(roots.root)).toBe(true);

    roots.cleanup();
    expect(existsSync(roots.root)).toBe(false);
    // Idempotent: a caller that cleans up twice (a `finally` plus a teardown) must not throw.
    expect(() => roots.cleanup()).not.toThrow();
  });

  it('hands back both roots as ONE override object', () => {
    const roots = createHermeticRoots('hermetic-roots-pair');
    try {
      // The pair is the point: a caller cannot spread `roots.env` and receive only `HOME`, which
      // is how the `MCP_RUNTIME_ROOT` half stopped being adopted at half the spawn sites.
      expect(Object.keys(roots.env).sort()).toEqual(['HOME', 'MCP_RUNTIME_ROOT']);
    } finally {
      roots.cleanup();
    }
  });
});
