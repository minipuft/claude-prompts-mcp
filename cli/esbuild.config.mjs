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

import * as esbuild from 'esbuild';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

export const BUNDLE_BUDGET_BYTES = 512_000; // 500KB

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
export async function buildCli(overrides = {}) {
  const options = createCliBuildOptions(overrides);
  await esbuild.build(options);

  const bytes = statSync(options.outfile).size;
  const sizeKB = (bytes / 1024).toFixed(1);
  console.log(`  cpm bundle: ${sizeKB} KB -> ${options.outfile}`);

  if (bytes > BUNDLE_BUDGET_BYTES) {
    throw new Error(
      `cpm bundle exceeds ${BUNDLE_BUDGET_BYTES / 1024}KB budget (${sizeKB} KB)`,
    );
  }

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
