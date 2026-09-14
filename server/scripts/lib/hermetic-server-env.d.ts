/**
 * Hand-written declarations for `hermetic-server-env.js`.
 *
 * The module is `.js` because `node`-run scripts import it without a build step; `scripts/**` is
 * outside both tsconfigs, so the runtime never needs these. The Jest suite does, since
 * `tsconfig.test.json` includes `tests/**` and `tests/e2e/helpers/child-env.ts` imports it.
 * Same arrangement as `exception-hygiene.d.ts`.
 */

export declare const SCRUBBED_KEYS: readonly string[];

export declare function buildServerEnv(overrides?: Record<string, string>): NodeJS.ProcessEnv;
