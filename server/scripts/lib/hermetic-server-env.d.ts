/**
 * Hand-written declarations for `hermetic-server-env.js`.
 *
 * The module is `.js` because `node`-run scripts import it without a build step; `scripts/**` is
 * outside both tsconfigs, so the runtime never needs these. The Jest suite does, since
 * `tsconfig.test.json` includes `tests/**` and `tests/e2e/helpers/child-env.ts` imports it.
 * Same arrangement as `exception-hygiene.d.ts`.
 */

/** A temp `HOME` and a temp runtime root, created together and torn down together. */
export interface HermeticRoots {
  /** The temp directory holding both roots; removing it removes them. */
  root: string;
  /** `$HOME` for the child — where a skills_sync export would write client skill folders. */
  home: string;
  /** `MCP_RUNTIME_ROOT` for the child — where `runtime-state/` and `logs/` land. */
  runtimeRoot: string;
  /**
   * Both roots as one override object.
   *
   * Spread this into `buildServerEnv` rather than picking fields: they fail as a pair, so a
   * caller that can take `HOME` without `MCP_RUNTIME_ROOT` will eventually do exactly that.
   */
  env: { HOME: string; MCP_RUNTIME_ROOT: string };
  /** Remove `root`. Safe to call more than once. */
  cleanup(): void;
}

export declare function createHermeticRoots(label?: string): HermeticRoots;

/**
 * Throws unless `overrides.HOME` names a directory outside this process's own home.
 */
export declare function buildServerEnv(overrides?: Record<string, string>): NodeJS.ProcessEnv;
