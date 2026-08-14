#!/usr/bin/env node
/**
 * Assert every version-bearing manifest in THIS repository agrees.
 *
 * A `--distribution` mode used to live here: ~130 lines fetching the three downstream repos and
 * asserting their published state against ours. It was deleted 2026-08-13, after measurement, not
 * as tidying — it had **never executed**. Its only caller was `downstream-sync.yml`, which reports
 * `total_count: 0` runs since it was written, because its sole trigger is a `repository_dispatch`
 * whose only sender (`opencode-prompts`) lacks the `UPSTREAM_DISPATCH_TOKEN` its dispatch step
 * needs and swallows the failure with `continue-on-error`. Three independent no-ops in series.
 *
 * The half of it that had real value is now better served elsewhere: the fleet auditor in
 * `minipuft/repository-standards` covers all three downstream repos, runs on a schedule (verified
 * succeeded 2026-08-10) and EXITS NON-ZERO on drift, where this one was `continue-on-error`. It
 * also compares each downstream's resolved `package-lock` version rather than the declared
 * dependency range, which is the stronger claim.
 *
 * One assertion had NO other home and was NOT dropped with the rest — the marketplace
 * `source.url` guard, which catches the listing resolving this repo through a rename redirect.
 * It now lives in `extension-publish.yml`'s `sync-downstream` job, beside the step that edits the
 * marketplace entry: that job runs on every release and blocks, where this file's copy was
 * reachable only from a workflow that never ran. `validate-release-workflow.js` asserts it is
 * still there, so it cannot be removed as quietly as this one was.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const repoRoot = join(serverDir, '..');

const files = [
  // Root package.json is release-please's NATIVE bump target (component "."), not an
  // extra-file — but manual flows (npm version → sync-versions) and merges can move it
  // independently, so it participates in the consistency check. Its lockfile is
  // deliberately excluded: release-please bumps package.json without the lock, so a
  // lock check would fail after every release until the next npm install.
  { path: join(repoRoot, 'package.json'), name: 'package.json (root)' },
  { path: join(serverDir, 'package.json'), name: 'server/package.json' },
  { path: join(repoRoot, 'manifest.json'), name: 'manifest.json' },
  { path: join(repoRoot, '.claude-plugin', 'plugin.json'), name: '.claude-plugin/plugin.json' },
  // Agent Plugins 1.0.0 canonical manifest. Registered with the manifest it was promoted from,
  // not deferred to the renderer tier: a versioned manifest that no gate reads can drift from
  // the moment it exists, and the render pipeline that will own the rest is not built yet.
  { path: join(repoRoot, 'plugin.json'), name: 'plugin.json (Agent Plugins)' },
  { path: join(repoRoot, 'server.json'), name: 'server.json' },
];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));

const readJsonSafe = (path, name) => {
  try {
    return { content: readJson(path), error: null };
  } catch (err) {
    return { content: null, error: `${name}: ${err.message}` };
  }
};

const versions = files.map((f) => {
  const { content, error } = readJsonSafe(f.path, f.name);
  return {
    ...f,
    version: content?.version ?? null,
    error,
  };
});

const validVersions = versions.filter((v) => v.version);
const uniqueVersions = [...new Set(validVersions.map((v) => v.version))];

console.log('Version Check:');
versions.forEach((v) => {
  const status = v.error ? '❌ MISSING' : uniqueVersions.length === 1 ? '✅' : '⚠️';
  console.log(`  ${status} ${v.name}: ${v.version || v.error}`);
});

if (uniqueVersions.length > 1) {
  console.error('\n❌ Version mismatch detected!');
  console.error(`   Found versions: ${uniqueVersions.join(', ')}`);
  console.error('   All manifest files must have the same version.');
  process.exit(1);
}

if (uniqueVersions.length === 0) {
  console.error('\n❌ No valid versions found!');
  process.exit(1);
}

const coreVersion = uniqueVersions[0];

// server.json also carries per-package versions the MCP registry validates
try {
  const serverJson = readJson(join(repoRoot, 'server.json'));
  for (const pkg of serverJson.packages ?? []) {
    if (pkg.version !== coreVersion) {
      console.error(
        `\n❌ server.json package ${pkg.identifier} version ${pkg.version} != ${coreVersion}`
      );
      process.exit(1);
    }
  }
  const pkgJson = readJson(join(serverDir, 'package.json'));
  if (serverJson.name !== pkgJson.mcpName) {
    console.error(
      `\n❌ server.json name (${serverJson.name}) must equal package.json mcpName (${pkgJson.mcpName}) — the MCP registry rejects mismatches`
    );
    process.exit(1);
  }
} catch (err) {
  console.error(`\n❌ Unable to cross-check server.json: ${err.message}`);
  process.exit(1);
}

const releaseManifestPath = join(repoRoot, '.release-please-manifest.json');
try {
  const manifest = readJson(releaseManifestPath);
  const manifestVersion = manifest['.'] || manifest.server;
  if (manifestVersion && manifestVersion !== coreVersion) {
    console.error(`\n❌ Release manifest mismatch: ${manifestVersion} (expected ${coreVersion})`);
    process.exit(1);
  }
} catch (err) {
  console.error(`\n❌ Unable to read ${releaseManifestPath}: ${err.message}`);
  process.exit(1);
}

const changelogPath = join(repoRoot, 'CHANGELOG.md');
try {
  const content = readFileSync(changelogPath, 'utf-8');
  if (!content.includes(`## [${coreVersion}]`)) {
    console.error(`\n❌ Missing changelog entry for ${coreVersion} in CHANGELOG.md`);
    process.exit(1);
  }
} catch (err) {
  console.error(`\n❌ Unable to read ${changelogPath}: ${err.message}`);
  process.exit(1);
}

console.log(`\n✅ Local versions consistent: ${coreVersion}`);
