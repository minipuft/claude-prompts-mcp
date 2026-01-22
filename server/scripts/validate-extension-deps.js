#!/usr/bin/env node
/**
 * Validates that .mcpb extension dependencies are properly configured.
 *
 * Checks:
 * 1. Required deps exist in server/package.json
 * 2. Excluded deps (bundled inline by esbuild) are not leaked
 * 3. build-extension.sh exclude list matches expected bundled packages
 *
 * Run: node server/scripts/validate-extension-deps.js
 * CI: Part of validate:all
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '../..');
const SERVER_DIR = join(__dirname, '..');

// Deps that SHOULD be in .mcpb (CJS interop safety net)
// These are packages that don't bundle cleanly due to CJS/ESM interop issues
const MCPB_REQUIRED_DEPS = [
  '@modelcontextprotocol/sdk',
  'cors',
  'diff',
  'express',
  'js-yaml',
  'nunjucks',
  'zod',
];

// Deps that should NOT be in .mcpb (bundled inline by esbuild)
// Keep in sync with exclude array in build-extension.sh
const MCPB_EXCLUDED_DEPS = [
  'chokidar', // Bundled inline by esbuild - file watcher
];

function extractBuildScriptExcludeList() {
  const buildScript = readFileSync(join(ROOT_DIR, 'scripts/build-extension.sh'), 'utf-8');

  // Extract exclude array from: const exclude = ['chokidar'];
  const excludeMatch = buildScript.match(/const exclude = \[([^\]]+)\]/);
  if (!excludeMatch) {
    throw new Error('Could not find exclude array in build-extension.sh');
  }

  // Parse the array contents
  const excludeList = excludeMatch[1]
    .split(',')
    .map((s) => s.trim().replace(/['"]/g, ''))
    .filter((s) => s.length > 0);

  return excludeList;
}

function main() {
  const serverPkg = JSON.parse(readFileSync(join(SERVER_DIR, 'package.json'), 'utf-8'));
  const serverDeps = serverPkg.dependencies;

  let hasErrors = false;
  let hasWarnings = false;

  console.log('Validating .mcpb extension dependencies...\n');

  // Check 1: Required deps exist in server/package.json
  console.log('Checking required deps exist in server/package.json:');
  for (const dep of MCPB_REQUIRED_DEPS) {
    if (!serverDeps[dep]) {
      console.error(`  ERROR: ${dep} required for .mcpb but missing from server/package.json`);
      hasErrors = true;
    } else {
      console.log(`  ✓ ${dep}: ${serverDeps[dep]}`);
    }
  }

  // Check 2: Excluded deps should be in package.json (so they're bundled)
  console.log('\nChecking excluded deps are in package.json (for bundling):');
  for (const dep of MCPB_EXCLUDED_DEPS) {
    if (!serverDeps[dep]) {
      console.warn(`  WARNING: ${dep} not in server/package.json - is it still used?`);
      hasWarnings = true;
    } else {
      console.log(`  ✓ ${dep}: ${serverDeps[dep]} (bundled inline, excluded from .mcpb)`);
    }
  }

  // Check 3: build-extension.sh exclude list matches our expected list
  console.log('\nChecking build-extension.sh exclude list:');
  try {
    const buildExcludeList = extractBuildScriptExcludeList();

    // Check all expected excludes are in build script
    for (const dep of MCPB_EXCLUDED_DEPS) {
      if (!buildExcludeList.includes(dep)) {
        console.error(`  ERROR: ${dep} should be in build-extension.sh exclude list`);
        hasErrors = true;
      }
    }

    // Check for unexpected excludes in build script
    for (const dep of buildExcludeList) {
      if (!MCPB_EXCLUDED_DEPS.includes(dep)) {
        console.warn(`  WARNING: ${dep} in build-extension.sh exclude but not in expected list`);
        hasWarnings = true;
      }
    }

    if (!hasErrors && buildExcludeList.length === MCPB_EXCLUDED_DEPS.length) {
      console.log(`  ✓ Exclude list matches: [${buildExcludeList.join(', ')}]`);
    }
  } catch (error) {
    console.error(`  ERROR: ${error.message}`);
    hasErrors = true;
  }

  // Check 4: Warn about new deps that might need consideration
  console.log('\nChecking for new deps that might need review:');
  const allDeps = Object.keys(serverDeps);
  const knownDeps = [...MCPB_REQUIRED_DEPS, ...MCPB_EXCLUDED_DEPS];
  const unknownDeps = allDeps.filter(
    (dep) => !knownDeps.includes(dep) && !dep.startsWith('@types/')
  );

  if (unknownDeps.length > 0) {
    console.warn('  New dependencies found - review if they should be:');
    console.warn('  - Added to MCPB_REQUIRED_DEPS (needs CJS interop at runtime)');
    console.warn('  - Added to MCPB_EXCLUDED_DEPS (bundled inline by esbuild)');
    for (const dep of unknownDeps) {
      console.warn(`  ? ${dep}: ${serverDeps[dep]}`);
    }
    hasWarnings = true;
  } else {
    console.log('  ✓ No unknown dependencies');
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  if (hasErrors) {
    console.error('FAILED: Extension dependency validation has errors');
    process.exit(1);
  } else if (hasWarnings) {
    console.warn('PASSED with warnings: Review the warnings above');
    process.exit(0);
  } else {
    console.log('PASSED: Extension dependencies validated successfully');
    process.exit(0);
  }
}

main();
