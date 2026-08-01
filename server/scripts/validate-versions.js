#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const distributionMode = process.argv.includes('--distribution');
const skipNpmCheck = process.argv.includes('--skip-npm') || process.env.SKIP_NPM_CHECK === 'true';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '..');
const repoRoot = join(serverDir, '..');

const files = [
  { path: join(serverDir, 'package.json'), name: 'server/package.json' },
  { path: join(repoRoot, 'manifest.json'), name: 'manifest.json' },
  { path: join(repoRoot, '.claude-plugin', 'plugin.json'), name: '.claude-plugin/plugin.json' },
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

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status} ${response.statusText})`);
  }
  return response.json();
};

const assertVersion = (label, actual) => {
  if (!actual) {
    throw new Error(`${label} missing version`);
  }
  if (actual !== coreVersion) {
    throw new Error(`${label} version ${actual} does not match ${coreVersion}`);
  }
};

const assertMarketplaceSource = (source) => {
  if (!source || source.source !== 'url') {
    throw new Error('Marketplace source must use url source');
  }
  // The repo was renamed claude-prompts-mcp -> claude-prompts. Assert the real name,
  // not the rename redirect: a redirect the marketplace silently depends on breaks the
  // day the old name is reclaimed, and this check is the only thing that would notice.
  if (source.url !== 'https://github.com/minipuft/claude-prompts.git') {
    throw new Error(`Marketplace source url mismatch: ${source.url}`);
  }
  if (source.ref !== 'dist') {
    throw new Error(`Marketplace source ref mismatch: ${source.ref}`);
  }
};

/**
 * Assert a downstream repo's `claude-prompts` range still covers the version we ship.
 *
 * Downstream repos own their own version numbers; what has to stay true is that their
 * dependency range admits ours. Two consumers now (gemini, opencode), so the major-match
 * lives here rather than being copied per check.
 *
 * Known constraint: only the `^MAJOR.` form is accepted. A pinned exact version is
 * rejected even when it does cover us, because the sync-downstream job always writes a
 * caret range — anything else means the range stopped being generated and should be
 * looked at. Widen this only alongside a downstream that legitimately pins.
 */
const assertDependencyRange = (label, dependencies) => {
  const dep = dependencies?.['claude-prompts'];
  if (!dep) {
    throw new Error(`${label} missing claude-prompts dependency`);
  }
  const majorMatch = dep.match(/\^(\d+)\./);
  if (!majorMatch) {
    throw new Error(`${label} dependency range unexpected format: ${dep}`);
  }
  const depMajor = parseInt(majorMatch[1], 10);
  const coreMajor = parseInt(coreVersion.split('.')[0], 10);
  if (depMajor !== coreMajor) {
    throw new Error(
      `${label} dependency ${dep} does not cover ${coreVersion} (major mismatch: ${depMajor} vs ${coreMajor})`
    );
  }
};

const distributionChecks = [
  {
    label: 'minipuft-plugins marketplace',
    url: 'https://raw.githubusercontent.com/minipuft/minipuft-plugins/main/.claude-plugin/marketplace.json',
    validate: (data) => {
      const entry = data.plugins?.find((plugin) => plugin.name === 'claude-prompts');
      if (!entry) {
        throw new Error('Marketplace entry for claude-prompts missing');
      }
      assertVersion('Marketplace plugin', entry.version);
      assertMarketplaceSource(entry.source);
    },
  },
  {
    // Checks gemini's DEPENDENCY RANGE, not gemini-extension.json's own version.
    // This previously asserted `gemini-extension.json.version === coreVersion`, which
    // contradicted the documented decision that release-please owns that number
    // downstream (see extension-publish.yml, sync-downstream closing comment). gemini is
    // at 1.3.2 while we ship 3.0.1, so the check could only ever fail — it never fired
    // because downstream-sync.yml runs on repository_dispatch and has zero runs.
    // gemini-extension.json carries no reference to our version at all; it invokes
    // `npx claude-prompts`, so the range in package.json is the only real coupling.
    label: 'gemini-prompts dependency',
    url: 'https://raw.githubusercontent.com/minipuft/gemini-prompts/main/package.json',
    validate: (data) => assertDependencyRange('gemini-prompts', data.dependencies),
  },
  {
    label: 'opencode-prompts dependency',
    url: 'https://raw.githubusercontent.com/minipuft/opencode-prompts/main/package.json',
    validate: (data) => {
      assertDependencyRange('opencode-prompts', data.dependencies);
    },
  },
];

const npmCheck = async () => {
  if (skipNpmCheck) {
    return;
  }
  const data = await fetchJson('https://registry.npmjs.org/claude-prompts/latest');
  assertVersion('npm latest', data.version);
};

const runDistributionChecks = async () => {
  console.log('\nDistribution Check:');
  for (const check of distributionChecks) {
    try {
      const data = await fetchJson(check.url);
      check.validate(data);
      console.log(`  ✅ ${check.label}`);
    } catch (err) {
      console.error(`  ❌ ${check.label}: ${err.message}`);
      process.exit(1);
    }
  }

  try {
    await npmCheck();
    if (!skipNpmCheck) {
      console.log('  ✅ npm latest');
    }
  } catch (err) {
    console.error(`  ❌ npm latest: ${err.message}`);
    process.exit(1);
  }

  console.log(`\n✅ Distribution versions match ${coreVersion}`);
};

if (distributionMode) {
  await runDistributionChecks();
}
