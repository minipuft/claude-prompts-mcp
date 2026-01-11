#!/usr/bin/env node
/**
 * Validates version consistency across all manifest files.
 * Ensures package.json, manifest.json, and plugin.json have matching versions.
 * Exits non-zero if versions don't match.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const repoRoot = join(serverDir, '..');

const files = [
  { path: join(serverDir, 'package.json'), name: 'server/package.json' },
  { path: join(repoRoot, 'manifest.json'), name: 'manifest.json' },
  { path: join(repoRoot, '.claude-plugin', 'plugin.json'), name: '.claude-plugin/plugin.json' },
];

const versions = files.map((f) => {
  try {
    const content = JSON.parse(readFileSync(f.path, 'utf-8'));
    return { ...f, version: content.version };
  } catch (err) {
    return { ...f, version: null, error: err.message };
  }
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

console.log(`\n✅ All versions consistent: ${uniqueVersions[0]}`);
