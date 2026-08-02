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

import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zodLocalesTrimPlugin } from './esbuild-plugins/zod-locales-trim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

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
 */
export const BUNDLE_BUDGET_BYTES = 512_000; // 500KB — shipped (minified)
export const DEV_BUNDLE_BUDGET_BYTES = 640_000; // 625KB — unminified dev build

/** Absolute path to the server source tree the CLI shares code with. */
const SERVER_SRC = join(__dirname, '..', 'server', 'src');

/**
 * Build options for the cpm bundle.
 *
 * @param {{ outfile?: string, minify?: boolean }} [overrides]
 * @returns {import('esbuild').BuildOptions}
 */
export function createCliBuildOptions(overrides = {}) {
  const {
    outfile = join(__dirname, 'dist', 'cpm.js'),
    minify = process.env.NODE_ENV === 'production',
  } = overrides;

  return {
    absWorkingDir: __dirname,
    entryPoints: [join(__dirname, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outfile,
    sourcemap: true,
    minify,
    keepNames: true,

    // Node.js built-ins are always available at runtime
    external: [
      'node:assert', 'node:buffer', 'node:child_process', 'node:cluster',
      'node:crypto', 'node:dgram', 'node:dns', 'node:events', 'node:fs',
      'node:fs/promises', 'node:http', 'node:https', 'node:net', 'node:os',
      'node:path', 'node:readline', 'node:stream', 'node:string_decoder',
      'node:tls', 'node:url', 'node:util', 'node:vm', 'node:worker_threads',
      'node:zlib', 'node:perf_hooks',
      // Unprefixed equivalents
      'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram',
      'dns', 'events', 'fs', 'http', 'https', 'net', 'os', 'path',
      'readline', 'stream', 'string_decoder', 'tls', 'url', 'util', 'vm',
      'worker_threads', 'zlib', 'perf_hooks',
    ],

    // CJS require shim for ESM bundle (shebang comes from src/index.ts)
    banner: {
      js: `import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);`,
    },

    define: {
      'process.env.CPM_VERSION': JSON.stringify(pkg.version),
    },

    // Resolve @cli-shared to server source; esbuild bundles transitive deps
    alias: {
      '@cli-shared': join(SERVER_SRC, 'cli-shared'),
      // Server path aliases needed for transitive imports within cli-shared re-exports
      '@shared': join(SERVER_SRC, 'shared'),
      '@engine': join(SERVER_SRC, 'engine'),
      '@modules': join(SERVER_SRC, 'modules'),
    },

    treeShaking: true,
    logLevel: 'info',
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
 * @param {{ outfile?: string, minify?: boolean }} [overrides]
 * @returns {Promise<string>} absolute path to the emitted bundle
 */
export function checkCliBundleSize(outfile, minified = false) {
  const bytes = statSync(outfile).size;
  const sizeKB = (bytes / 1024).toFixed(1);
  const budget = minified ? BUNDLE_BUDGET_BYTES : DEV_BUNDLE_BUDGET_BYTES;
  const label = minified ? 'minified' : 'unminified';

  console.log(`  cpm bundle: ${sizeKB} KB (${label}) -> ${outfile}`);

  if (bytes > budget) {
    throw new Error(
      `cpm bundle exceeds ${budget / 1024}KB ${label} budget (${sizeKB} KB)`,
    );
  }
  return bytes;
}

export async function buildCli(overrides = {}) {
  // esbuild is imported lazily, not at module scope. `server/esbuild.config.mjs`
  // imports createCliBuildOptions() from this file, and a bare `esbuild` specifier
  // resolves from THIS file's directory upward — cli/node_modules, then the repo root.
  // CI's Build job installs only server/node_modules, so a top-level import made
  // `npm --prefix server run build` fail with ERR_MODULE_NOT_FOUND. Options are pure
  // data and cross the package boundary safely; the bundler does not.
  const esbuild = await import('esbuild');
  const options = createCliBuildOptions(overrides);
  await esbuild.build(options);
  checkCliBundleSize(options.outfile, Boolean(options.minify));
  return options.outfile;
}

// Standalone invocation: `node esbuild.config.mjs` / `npm -w cli run build`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Building CLI...');
  buildCli().then(
    () => console.log('\nBuild complete: cli/dist/cpm.js'),
    (error) => {
      console.error('Build failed:', error);
      process.exit(1);
    },
  );
}
