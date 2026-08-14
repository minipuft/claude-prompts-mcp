#!/usr/bin/env node
/**
 * Syncs version from server/package.json to all manifest files.
 *
 * Usage:
 *   npm run sync:versions           # Sync from package.json to all manifests
 *   npm run sync:versions -- 1.5.0  # Set specific version everywhere
 *
 * Hooked to: npm version (runs automatically after version bump)
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const repoRoot = join(serverDir, '..');

// Files to sync (path relative to appropriate root, key to update)
const manifests = [
  { path: join(repoRoot, 'package.json'), key: 'version' },
  { path: join(repoRoot, 'manifest.json'), key: 'version' },
  { path: join(repoRoot, '.claude-plugin', 'plugin.json'), key: 'version' },
  // The CANONICAL Agent Plugins manifest, and the source `.claude-plugin/plugin.json` is rendered
  // from. It had no version writer until 2026-08-13: this list and release-please's `extra-files`
  // both stamped only the rendered copy, so a bump left the source behind and the render inverted —
  // the derived file became the newer one. Reproduced by running this script with an explicit
  // version: `validate:versions` reported the mismatch and `validate:render-drift` reported
  // `.claude-plugin/plugin.json` ahead of `plugin.json`. Both entries are required; dropping either
  // one re-opens the same gap from the other direction.
  { path: join(repoRoot, 'plugin.json'), key: 'version' },
  { path: join(repoRoot, '.release-please-manifest.json'), key: '.' },
];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));
const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');

// Get version: from CLI arg, or from package.json
const cliVersion = process.argv[2];
const packageJson = readJson(join(serverDir, 'package.json'));
const targetVersion = cliVersion || packageJson.version;

console.log(`Syncing version: ${targetVersion}`);

let updated = 0;
for (const { path, key } of manifests) {
  try {
    const data = readJson(path);
    const currentVersion = data[key];

    if (currentVersion !== targetVersion) {
      data[key] = targetVersion;
      writeJson(path, data);
      console.log(`  ✅ ${path.replace(repoRoot + '/', '')}: ${currentVersion} → ${targetVersion}`);
      updated++;
    } else {
      console.log(`  ⏭️  ${path.replace(repoRoot + '/', '')}: already ${targetVersion}`);
    }
  } catch (err) {
    console.error(`  ❌ ${path}: ${err.message}`);
    process.exit(1);
  }
}

// server.json (MCP registry manifest) carries the version twice: top-level and per package
const serverJsonPath = join(repoRoot, 'server.json');
try {
  const data = readJson(serverJsonPath);
  let changed = false;
  if (data.version !== targetVersion) {
    data.version = targetVersion;
    changed = true;
  }
  for (const pkg of data.packages ?? []) {
    if (pkg.version !== targetVersion) {
      pkg.version = targetVersion;
      changed = true;
    }
  }
  if (changed) {
    writeJson(serverJsonPath, data);
    console.log(`  ✅ server.json: → ${targetVersion} (top-level + packages)`);
    updated++;
  } else {
    console.log(`  ⏭️  server.json: already ${targetVersion}`);
  }
} catch (err) {
  console.error(`  ❌ ${serverJsonPath}: ${err.message}`);
  process.exit(1);
}

console.log(`\n✅ Synced ${updated} file(s) to version ${targetVersion}`);
