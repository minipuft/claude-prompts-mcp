/**
 * esbuild plugin: drop zod 4's unused locale bundle from the `cpm` binary.
 *
 * The problem
 * -----------
 * `zod/v4/classic/external.js` ends with
 *
 *   export * as locales from "../locales/index.js";
 *
 * A namespace re-export is opaque to tree shaking — esbuild has to assume any key
 * may be read at runtime, so all 53 translations are emitted. Measured on the cpm
 * bundle, that is **279 KB of 842 KB**, and it is what pushed the CLI past its
 * 500 KB budget when zod moved 3 -> 4.
 *
 * Why this is safe
 * ----------------
 * The default locale does not come through that barrel. Two lines earlier the same
 * file does its own direct import and installs it:
 *
 *   import en from "../locales/en.js";
 *   config(en());
 *
 * That import is untouched here, so error messages are unaffected. This plugin only
 * replaces the `locales/index.js` barrel — the thing reached as `z.locales.<lang>` —
 * with a stub exporting `en` alone.
 *
 * The narrowing that matters
 * --------------------------
 * `z.locales.fr()` and friends resolve to `undefined` in the CLI bundle. Nothing in
 * `cli/src` or the shared server schemas reads `z.locales` (verified by
 * `rg "\.locales"`), and the CLI has no locale-switching surface. If one is ever
 * added, delete this plugin and raise the budget instead — do not add languages back
 * one at a time.
 *
 * Resolution note
 * ---------------
 * The stub is a virtual module that re-exports from an ABSOLUTE path computed off the
 * intercepted request, never a bare `zod/...` specifier. zod is installed only in
 * `server/node_modules`, so a bare specifier written here would resolve from `cli/`
 * and fail — the same hazard that forced `buildCli()` to import esbuild lazily.
 *
 * Scope: the `cpm` CLI build only. The server bundle has no size budget and is left
 * alone, so a locale regression cannot hide behind this in the MCP server.
 */

import { join } from 'node:path';

const NAMESPACE = 'zod-locales-trim';

/** @returns {import('esbuild').Plugin} */
export function zodLocalesTrimPlugin() {
  return {
    name: NAMESPACE,
    setup(build) {
      // Matches the barrel only. `locales/en.js` does not end in `index.js`, so the
      // direct import that installs the default locale is never intercepted.
      build.onResolve({ filter: /locales[\\/]index\.js$/ }, (args) => {
        // Guard on the importer so a project file named locales/index.js is untouched.
        if (!args.importer.replace(/\\/g, '/').includes('/node_modules/zod/')) {
          return null;
        }
        // `args.resolveDir` is zod's own `v4/classic/`; the barrel it asked for lives
        // at `../locales/index.js`, so `en.js` is its sibling.
        return {
          path: join(args.resolveDir, args.path, '..', 'en.js'),
          namespace: NAMESPACE,
        };
      });

      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({
        contents: `export { default as en } from ${JSON.stringify(args.path)};`,
        loader: 'js',
        resolveDir: build.initialOptions.absWorkingDir,
      }));
    },
  };
}
