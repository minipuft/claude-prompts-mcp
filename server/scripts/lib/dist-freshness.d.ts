/**
 * Hand-written declarations for `dist-freshness.js`.
 *
 * The module is `.js` because `verify-mcp-surface.mjs` imports it without a build step;
 * `scripts/**` is outside both tsconfigs, so the runtime never needs these. The Jest suite does,
 * since `tsconfig.test.json` includes `tests/**` and `tests/e2e/helpers/child-env.ts` imports it.
 * Same arrangement as `hermetic-server-env.d.ts`.
 */

export declare function checkDistFreshness(
  distEntry: string,
  srcDir: string
): { fresh: true; builtAt: number } | { fresh: false; kind: 'missing' | 'stale'; reason: string };
