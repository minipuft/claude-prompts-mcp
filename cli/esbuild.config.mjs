/**
 * esbuild configuration for the cpm CLI tool.
 *
 * Produces a single self-contained cpm.js that bundles cli-shared schemas and
 * utilities from the server source (no runtime deps needed).
 *
 * Two consumers, one config — the CLI ships as the `cpm` bin of the
 * `claude-prompts` npm package, so `server/esbuild.config.mjs` imports
 * `buildCli()` from here rather than duplicating it. Every path below is
 * absolute so the build is correct regardless of the caller's cwd.
 *
 * Usage:
 *   npm -w cli run build          # standalone -> cli/dist/cpm.js
 *   npm --prefix server run build # bundled    -> server/dist/cpm.js
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { zodLocalesTrimPlugin } from "./esbuild-plugins/zod-locales-trim.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, "..", "server");
const releasePkg = JSON.parse(
  readFileSync(join(SERVER_ROOT, "package.json"), "utf8"),
);

/**
 * Resolve a dependency's ESM entry point via its own `module` field, instead of the
 * `main` field esbuild's `platform: 'node'` prefers by default.
 *
 * Needed for a dependency shaped like `jsonc-parser`: `main` points at a UMD build
 * whose factory reaches `require` through a parameter (`require2("./impl/format")`),
 * which esbuild cannot trace statically -- the file it would need to bundle is never
 * found, so the bundle only fails at RUNTIME when node looks for `./impl/format`
 * next to it and it isn't there (measured on `server/dist/index.js` and
 * `cli/dist/cpm.js`, F-T5-17).
 *
 * `fromDir` anchors node's own module resolution (`createRequire`) rather than a
 * path literal, so this tracks wherever npm actually installed the package -- no
 * hardcoded machine path. `fromDir` need not exist as a file; `createRequire` only
 * uses its directory to walk `node_modules` upward.
 */
function resolveEsmEntry(packageName, fromDir) {
  const req = createRequire(join(fromDir, "package.json"));
  const pkgJsonPath = req.resolve(`${packageName}/package.json`);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  if (!pkg.module) {
    throw new Error(
      `${packageName} has no "module" field at ${pkgJsonPath} -- cannot alias to its ESM build`,
    );
  }
  return join(dirname(pkgJsonPath), pkg.module);
}

const JSONC_PARSER_ESM_ENTRY = resolveEsmEntry("jsonc-parser", SERVER_ROOT);

/**
 * Size budgets for the `cpm` bundle. Two numbers because two artifacts exist.
 *
 * `prepublishOnly` runs `build:prod`, so the artifact that reaches npm is minified —
 * that is the one 500KB governs. A plain `npm run build` (CI, pre-push, local) emits
 * the unminified bundle, which is legitimately larger and gets its own ceiling rather
 * than being waved through.
 *
 * Both are enforced. Skipping the check when unminified would make the common path a
 * check that cannot fail, and CI runs exactly that path.
 *
 * Measured 2026-08-01 on zod 4.4.3 with the locale trim: 294.9 KB minified,
 * 565.4 KB unminified. The headroom is deliberate, not slack to spend.
 *
 * DEV_BUNDLE_BUDGET_BYTES raised 2026-09-19 (row 7.10, R75): bundling jsonc-parser's
 * ESM build correctly (see resolveEsmEntry() below / F-T5-17) measured 673,115 B
 * unminified — the dependency itself, not scope creep. BUNDLE_BUDGET_BYTES (shipped,
 * minified) is untouched: measured 339,980 B with the same fix, well under 512,000.
 *
 * Raised again 2026-09-20, and this one is a MERGE arithmetic, not either side's growth:
 * neither parent exceeded 680,000 alone. The resource-surface branch measured 614,157 B
 * without jsonc-parser, and #338 measured 673,115 B without the branch's `cpm` work
 * (nested chain steps, single-file prompts, the subtree history operations). Merged:
 * 682,605 B, over by 2,605. 680,000 was set from a measurement of one parent taken one
 * day before the other landed, which is the only reason it looked like enough headroom.
 * jsonc-parser is bundled once — six ESM modules, each emitted a single time — so this is
 * additive, not a duplicate dependency the merge introduced. BUNDLE_BUDGET_BYTES (shipped,
 * minified) is again untouched and is the number that governs what users download.
 *
 * Raised again 2026-09-20 (row P4.64), and this one buys a behaviour: `cpm` resource writes
 * now preserve the comments and layout of the parts an edit did not name, which needs the
 * `yaml` package's CST layer. Measured on this tree:
 *
 *   both libraries bundled   941.2 KB  — js-yaml and yaml side by side, rejected
 *   js-yaml dropped          839,424 B — the measured size this ceiling is set from
 *
 * js-yaml left the `cpm` bundle entirely because exactly one module in that graph imported it
 * (`shared/utils/yaml/yaml-parser.ts`), worth 125,991 input bytes. It remains a dependency for
 * server-only code that the CLI never reaches. The swap was gated on parse equivalence, not
 * assumed: all 105 bundled resources parse to identical values under both libraries, with a
 * control (an explicit `%YAML 1.1` directive) confirming the probe can see a difference when
 * one exists. Serializer FORMATTING does differ — byte-identical on 24 of 105 — though all 105
 * round-trip to the same value.
 *
 * The strictness parity checks added after that measurement took it to 840,813 — a 840,000
 * ceiling would already be failing, which is the argument below making itself. Merging main
 * (#341, #342) took it to 845,835, leaving 4,165 B: the branch's own work accounts for none of
 * that last step, and the margin is thin again on the same axis.
 *
 * Set to 850,000 rather than the next 10,000 above the measurement: 839,424 leaves 576 bytes,
 * and this constant has twice been raised from a number that looked like enough headroom at the
 * time (see the two paragraphs above). 10,576 B is a working margin; 576 B is the next trivial
 * CLI change failing the build.
 *
 * BUNDLE_BUDGET_BYTES (shipped, minified) is again untouched: measured 407,640 B here against
 * 512,000, and it is still the number that governs what users download.
 *
 * Raised to 900,000 on 2026-09-20 (row P4.92 / S1.3, owner ruling R60). Two facts, and the
 * second is the reason the step is 50,000 rather than another 10,000:
 *
 *   1. The paragraph above says 845,835 leaves 4,165 B. That measurement predates #343
 *      (`feat(resources): editing a resource keeps its comments`): `f711401b` measures
 *      849,743 B, so the real headroom was 257 B, and the stale figure was carried into a
 *      slice brief and planned against. The number a ceiling is set from expires the moment
 *      anything merges; only a re-measurement is evidence.
 *   2. What crossed it: `version_history`'s two writers now share ONE identity rule
 *      (`hashCanonical`, `shared/utils/hash.ts`), which is what makes a row written by the
 *      server and a row written by `cpm` comparable. The canonical encoder is 1,709 B of the
 *      2,722 B delta; the rest is the CLI writer's equality branch and the `recorded` field.
 *      There is no arrangement of that fix that keeps the encoder out of this bundle, so the
 *      ceiling is the thing that had to move.
 *
 * Measured here after the change: 852,826 B, identical from both workspaces' builds. 900,000
 * leaves 47,174 B, which is a margin for the remaining hash
 * unification (`resource_index`, skills-sync, `promptRevision`) rather than slack to spend.
 * The largest inputs, if this needs reclaiming instead of raising again: `cli/src/cli.ts`
 * 18.9 KB, `modules/prompts/prompt-schema.ts` 18.3 KB,
 * `cli-shared/_generated/config-template.ts` 15.0 KB, `engine/gates/core/gate-schema.ts`
 * 13.7 KB. Re-measure both bundles before quoting any of these.
 *
 * BUNDLE_BUDGET_BYTES (shipped, minified) is untouched for the fourth time.
 *
 * Raised to 1,000,000 on 2026-09-21 (row O.8, owner ruling). What crossed it: `cpm rollback`
 * now resolves its restore through the SAME planner `resource_manager rollback` uses
 * (`modules/versioning/byte-restore.ts` → `restore-plan.ts`), which is what makes the two
 * surfaces put the same bytes back rather than agreeing by inspection. Measured by stubbing each
 * piece out and rebuilding, from 889,452 B at the step's base:
 *
 *   | reachable                                                    | bundle       |
 *   | ------------------------------------------------------------ | ------------ |
 *   | base (`8db356df`)                                             | 889,452 B    |
 *   | + `writeRestoredFiles`/`restoreTargets`/`--preview` plumbing  | ~894,976 B   |
 *   | + `resolveByteRestore` reachable                              | ~901,734 B   |
 *   | + `describeRestorePlan` in the command                        | 902,976 B    |
 *
 * The two middle rows are derived from the build's own printed KB (±512 B) because each was a
 * throwaway stub; the first and last are `stat` on the emitted file. 902,976 B against 900,000 is
 * an overshoot of 2,976 B — a feature that cannot be had for less,
 * because the alternative to reaching the shared planner is a second implementation of "which
 * bytes land on an operator's disk". The step is 100,000 rather than another 3,000 for the reason
 * the 2026-09-20 entry above records: this constant has now been raised four times, three of them
 * by a margin that the next merge consumed. 1,000,000 leaves 97,037 B.
 *
 * BUNDLE_BUDGET_BYTES (shipped, minified) is untouched for the fifth time.
 *
 * Raised to 1,100,000 on 2026-09-22 (row P4.162, owner ruling R105). Measured at `c3c49eab`
 * before the change: 998,494 B, leaving 1,506 B — less than one gate-schema edit, and the next
 * slices all touch schemas this bundle reaches. The step is 100,000 for the same reason as the
 * last one. BUNDLE_BUDGET_BYTES (shipped, minified) is untouched for the sixth time.
 */
export const BUNDLE_BUDGET_BYTES = 512_000; // 500KB — shipped (minified)
export const DEV_BUNDLE_BUDGET_BYTES = 1_100_000; // ~1074KB — unminified dev build

/** Absolute path to the server source tree the CLI shares code with. */
const SERVER_SRC = join(SERVER_ROOT, "src");

/**
 * Build options for the cpm bundle.
 *
 * @param {{ outfile?: string, minify?: boolean, version?: string }} [overrides]
 * @returns {import('esbuild').BuildOptions}
 */
export function createCliBuildOptions(overrides = {}) {
  const {
    outfile = join(__dirname, "dist", "cpm.js"),
    minify = process.env.NODE_ENV === "production",
    version = releasePkg.version,
  } = overrides;

  return {
    absWorkingDir: __dirname,
    entryPoints: [join(__dirname, "src", "index.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile,
    sourcemap: true,
    minify,
    keepNames: true,

    // Node.js built-ins are always available at runtime
    external: [
      "node:assert",
      "node:buffer",
      "node:child_process",
      "node:cluster",
      "node:crypto",
      "node:dgram",
      "node:dns",
      "node:events",
      "node:fs",
      "node:fs/promises",
      "node:http",
      "node:https",
      "node:net",
      "node:os",
      "node:path",
      "node:readline",
      "node:stream",
      "node:string_decoder",
      "node:tls",
      "node:url",
      "node:util",
      "node:vm",
      "node:worker_threads",
      "node:zlib",
      "node:perf_hooks",
      // Unprefixed equivalents
      "assert",
      "buffer",
      "child_process",
      "cluster",
      "crypto",
      "dgram",
      "dns",
      "events",
      "fs",
      "http",
      "https",
      "net",
      "os",
      "path",
      "readline",
      "stream",
      "string_decoder",
      "tls",
      "url",
      "util",
      "vm",
      "worker_threads",
      "zlib",
      "perf_hooks",
    ],

    // CJS require shim for ESM bundle (shebang comes from src/index.ts)
    banner: {
      js: `import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);`,
    },

    define: {
      "process.env.CPM_VERSION": JSON.stringify(version),
    },

    // Resolve @cli-shared to server source; esbuild bundles transitive deps
    alias: {
      "@cli-shared": join(SERVER_SRC, "cli-shared"),
      // Server path aliases needed for transitive imports within cli-shared re-exports
      "@shared": join(SERVER_SRC, "shared"),
      "@engine": join(SERVER_SRC, "engine"),
      "@modules": join(SERVER_SRC, "modules"),
      // Third-party ESM-entry override, not a path alias for our own code: see
      // resolveEsmEntry() above / F-T5-17.
      "jsonc-parser": JSONC_PARSER_ESM_ENTRY,
    },

    treeShaking: true,
    logLevel: "info",
    metafile: true,

    // zod 4 re-exports all 53 locales as a namespace, which tree shaking cannot
    // eliminate — 279KB of an 842KB bundle. See esbuild-plugins/zod-locales-trim.mjs.
    plugins: [zodLocalesTrimPlugin()],
  };
}

/**
 * Build the cpm bundle and enforce the size budget.
 *
 * Size is read from the emitted file rather than from the metafile, because
 * the metafile keys outputs by a path relative to `absWorkingDir` and the two
 * consumers emit to different directories.
 *
 * @param {{ outfile?: string, minify?: boolean, version?: string }} [overrides]
 * @returns {Promise<string>} absolute path to the emitted bundle
 */
export function checkCliBundleSize(outfile, minified = false) {
  const bytes = statSync(outfile).size;
  const sizeKB = (bytes / 1024).toFixed(1);
  const budget = minified ? BUNDLE_BUDGET_BYTES : DEV_BUNDLE_BUDGET_BYTES;
  const label = minified ? "minified" : "unminified";

  console.log(`  cpm bundle: ${sizeKB} KB (${label}) -> ${outfile}`);

  if (bytes > budget) {
    throw new Error(
      `cpm bundle exceeds ${budget / 1024}KB ${label} budget (${sizeKB} KB)`,
    );
  }
  return bytes;
}

/**
 * Refuse a bundle that still contains a relative `require()` of a file esbuild did
 * not emit next to it -- the shape a UMD/CJS dependency leaves behind when its
 * factory reaches `require` through a variable instead of a literal specifier
 * (see resolveEsmEntry() above / F-T5-17). esbuild bundles what it can trace
 * statically and leaves the rest as a literal `require()` call in the output, which
 * only fails at RUNTIME -- this catches it at build time instead, for the NEXT
 * dependency shaped this way, not just this one.
 *
 * @param {string} outfile - path to the built bundle
 */
export function assertNoUntraceableRequires(outfile) {
  const source = readFileSync(outfile, "utf8");
  const outDir = dirname(resolve(outfile));
  // `require`, or an esbuild-renamed `require2`/`require3`/... when the bundled
  // source itself declares a local `require` binding esbuild had to disambiguate.
  const pattern = /\brequire\d*\(\s*(["'])(\.[^"'\r\n]+)\1\s*\)/g;
  const missing = [];
  const seen = new Set();

  for (const match of source.matchAll(pattern)) {
    const specifier = match[2];
    if (seen.has(specifier)) continue;
    seen.add(specifier);

    const candidate = join(outDir, specifier);
    const resolved = ["", ".js", ".cjs", ".mjs", ".json"].some((ext) =>
      existsSync(candidate + ext),
    );
    if (!resolved) missing.push(specifier);
  }

  if (missing.length > 0) {
    throw new Error(
      `${outfile} still contains a relative require() of a file that was not emitted ` +
        `next to it: ${missing.join(", ")}. This usually means a dependency resolved ` +
        `to a UMD/CJS build whose require() calls esbuild could not trace statically ` +
        `(reached through a variable, not a literal specifier) -- point the build at ` +
        `that dependency's ESM entry with an 'alias' entry (see resolveEsmEntry above) ` +
        `instead of letting it resolve through 'main'.`,
    );
  }
}

export async function buildCli(overrides = {}) {
  // esbuild is imported lazily, not at module scope. `server/esbuild.config.mjs`
  // imports createCliBuildOptions() from this file, and a bare `esbuild` specifier
  // resolves from THIS file's directory upward — cli/node_modules, then the repo root.
  // CI's Build job installs only server/node_modules, so a top-level import made
  // `npm --prefix server run build` fail with ERR_MODULE_NOT_FOUND. Options are pure
  // data and cross the package boundary safely; the bundler does not.
  const esbuild = await import("esbuild");
  const options = createCliBuildOptions(overrides);
  await esbuild.build(options);
  checkCliBundleSize(options.outfile, Boolean(options.minify));
  assertNoUntraceableRequires(options.outfile);
  return options.outfile;
}

// Standalone invocation: `node esbuild.config.mjs` / `npm -w cli run build`
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log("Building CLI...");
  buildCli().then(
    () => console.log("\nBuild complete: cli/dist/cpm.js"),
    (error) => {
      console.error("Build failed:", error);
      process.exit(1);
    },
  );
}
