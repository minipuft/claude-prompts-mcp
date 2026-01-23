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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

// Build options
const isProduction = process.env.NODE_ENV === 'production';
const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
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
  ],

  // Banner: Note that source file already has shebang, so we only need the require shim
  // The require shim allows CJS packages (like Express deps) to use require() in ESM bundle
  banner: {
    js: `import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);`,
  },

  // Define build-time constants
  define: {
    'process.env.BUILD_VERSION': JSON.stringify(pkg.version),
    'process.env.BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },

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
      // Watch mode for development
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
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

      console.log('\nBuild complete: dist/index.js');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
