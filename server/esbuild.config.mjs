/**
 * esbuild configuration for bundled distribution
 *
 * Produces a single self-contained index.js that includes all dependencies.
 * This eliminates the need for node_modules at runtime.
 *
 * Usage:
 *   npm run build
 *   node dist/index.js --transport=stdio
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The `cpm` CLI ships as a second bin of this package (package.json "bin"). Its build
// config lives with its source in cli/ and is imported rather than duplicated here, so
// the two entry points cannot drift. The import stays DYNAMIC because a static one is
// resolved before any code in this module runs, which would turn a missing cli/ into an
// unattributable module-resolution error instead of the message below.
const CLI_CONFIG = join(__dirname, '..', 'cli', 'esbuild.config.mjs');
const CLI_ENTRY = join(__dirname, '..', 'cli', 'src', 'index.ts');
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

// Build options
const isProduction = process.env.NODE_ENV === 'production';
const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  // Use ESM format to preserve import.meta.url for path resolution
  // Add a require shim in banner to handle CJS dependencies
  format: 'esm',
  outfile: 'dist/index.js',

  // Generate source maps for debugging
  sourcemap: true,

  // Keep readable for initial debugging - can enable minify later
  minify: isProduction,

  // Keep names for readable stack traces
  keepNames: true,

  // Node.js built-in modules should be external (always available at runtime)
  // Some Express dependencies use dynamic require() that doesn't bundle well in ESM
  external: [
    'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
    'domain', 'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'punycode',
    'querystring', 'readline', 'stream', 'string_decoder', 'tls', 'tty', 'url',
    'util', 'v8', 'vm', 'zlib', 'worker_threads', 'perf_hooks', 'async_hooks',
    'node:assert', 'node:buffer', 'node:child_process', 'node:cluster',
    'node:crypto', 'node:dgram', 'node:dns', 'node:domain', 'node:events',
    'node:fs', 'node:fs/promises', 'node:http', 'node:https', 'node:net',
    'node:os', 'node:path', 'node:punycode', 'node:querystring', 'node:readline',
    'node:stream', 'node:stream/web', 'node:string_decoder', 'node:tls',
    'node:tty', 'node:url', 'node:util', 'node:v8', 'node:vm', 'node:zlib',
    'node:worker_threads', 'node:perf_hooks', 'node:async_hooks', 'node:inspector',
    'node:sqlite',
  ],

  // Banner: ESM shims for CJS dependencies (Express)
  // - require shim: CJS packages use require() in ESM bundle
  // - __dirname/__filename shims: needed by some CJS packages
  // Uses var (not const) so source-level const __filename/__dirname redeclarations work
  banner: {
    js: `import { createRequire as __createRequire } from 'module';
import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __pathDirname } from 'path';
const require = __createRequire(import.meta.url);
var __filename = __fileURLToPath(import.meta.url);
var __dirname = __pathDirname(__filename);`,
  },

  // Define build-time constants
  define: {
    'process.env.BUILD_VERSION': JSON.stringify(pkg.version),
    'process.env.BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },

  // No `alias` block. Subpath imports are declared once in package.json "imports", which
  // esbuild resolves natively — no second copy of the map to drift out of sync.

  // Enable tree-shaking
  treeShaking: true,

  // Log level
  logLevel: 'info',

  // Metafile for bundle analysis
  metafile: true,
};

async function build() {
  try {
    console.log('Building bundled server...');
    console.log(`  Entry: src/index.ts`);
    console.log(`  Output: dist/index.js`);
    console.log(`  Mode: ${isProduction ? 'production' : 'development'}`);

    if (isWatch) {
      // Watch mode for development (skip clean to preserve declarations)
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      // Clean dist/ to prevent stale artifacts from deleted source files
      rmSync('dist', { recursive: true, force: true });
      mkdirSync('dist', { recursive: true });

      // Single build
      const result = await esbuild.build(buildOptions);

      // Report bundle size
      if (result.metafile) {
        const output = result.metafile.outputs['dist/index.js'];
        if (output) {
          const sizeKB = (output.bytes / 1024).toFixed(1);
          const sizeMB = (output.bytes / 1024 / 1024).toFixed(2);
          console.log(`\nBundle size: ${sizeKB} KB (${sizeMB} MB)`);
          console.log(`Inputs: ${Object.keys(output.inputs).length} files`);
        }
      }

      // Second bin: the cpm CLI, bundled from cli/src with the shared config.
      // Emitted into dist/ so package.json "files": ["dist"] ships it.
      //
      // Only the options object crosses the package boundary — this file runs them
      // through its OWN esbuild. cli/ imports resolve from cli/node_modules upward,
      // which CI's Build job (server-only `npm ci`) does not install.
      //
      // Required, not optional. This used to fall back to a skip because the Docker
      // build used `server/` as its context, leaving `../cli` unresolvable — that image
      // no longer exists, and every remaining consumer (npm publish, plugin-dist,
      // desktop-extension) builds from a full checkout. package.json declares a `cpm`
      // bin, so a silent skip would publish a manifest pointing at nothing.
      if (!existsSync(CLI_ENTRY) || !existsSync(CLI_CONFIG)) {
        throw new Error(
          `cpm CLI sources not found (${CLI_ENTRY}). package.json declares a "cpm" bin, ` +
            `so this build cannot produce a publishable package. Build from a full checkout.`,
        );
      }

      console.log('\nBuilding cpm CLI...');
      const { createCliBuildOptions, checkCliBundleSize } = await import(
        pathToFileURL(CLI_CONFIG).href
      );
      const cliOptions = createCliBuildOptions({
        outfile: join(__dirname, 'dist', 'cpm.js'),
        minify: isProduction,
      });
      await esbuild.build(cliOptions);
      checkCliBundleSize(cliOptions.outfile);

      // No declaration emit. This package ships a server binary and Python hooks, not a
      // library — nothing imports it, so the 405 .d.ts files this produced were read by
      // no one, and the "types" entry backing them pointed at a path that did not exist.
      // Restore this step alongside a real consumer, together with package.json "types"
      // and a smoke test that typechecks against `npm pack` output.

      console.log('\nBuild complete: dist/index.js, dist/cpm.js');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
