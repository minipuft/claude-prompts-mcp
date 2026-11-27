// @lifecycle canonical - Package root resolution for MCP server startup.
/**
 * Package Root Resolution
 *
 * Resolves the server's package root from the bundled entry point.
 * The bundle is always at dist/index.js — package root is one dirname above.
 *
 * Priority:
 *   1. --server-root CLI flag (explicit override for containers/edge cases)
 *   2. Derive from import.meta.url (dist/index.js → package root)
 *
 * No CWD guessing, no multi-strategy fallbacks.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'url';

const ACCEPTED_PACKAGE_NAMES = ['claude-prompts', 'claude-prompts-mcp'];

interface PackageRootOptions {
  cliOverride?: string;
  verbose?: boolean;
}

/**
 * Resolve the package root directory.
 *
 * The esbuild bundle lives at dist/index.js — one dirname up is the package root.
 * Validates that config.json and a prompts directory exist before returning.
 */
export async function resolvePackageRoot(options?: PackageRootOptions): Promise<string> {
  const verbose = options?.verbose ?? false;
  const cliOverride = options?.cliOverride;

  // 1. CLI override — trust the caller
  if (cliOverride != null && cliOverride.length > 0) {
    const root = path.resolve(cliOverride);
    if (verbose) {
      console.error(`[package-root] Using CLI override: ${root}`);
    }
    await validatePackageRoot(root);
    return root;
  }

  // 2. Derive from bundle location: dist/index.js → dist/ → package root
  const entryFile = fileURLToPath(import.meta.url);
  const packageRoot = path.dirname(path.dirname(entryFile));

  if (verbose) {
    console.error(`[package-root] Entry: ${entryFile}`);
    console.error(`[package-root] Resolved: ${packageRoot}`);
  }

  await verifyPackageIdentity(packageRoot, entryFile, verbose);
  await validatePackageRoot(packageRoot);
  return packageRoot;
}

/**
 * Verify that the resolved directory contains our package.json.
 */
async function verifyPackageIdentity(
  packageRoot: string,
  entryFile: string,
  verbose: boolean
): Promise<void> {
  const pkgPath = path.join(packageRoot, 'package.json');

  let content: string;
  try {
    content = await fs.readFile(pkgPath, 'utf8');
  } catch {
    throw new Error(generateRootError(packageRoot, entryFile));
  }

  const pkg: Record<string, unknown> = JSON.parse(content) as Record<string, unknown>;
  const pkgName = typeof pkg['name'] === 'string' ? pkg['name'] : '';

  if (!ACCEPTED_PACKAGE_NAMES.includes(pkgName)) {
    throw new Error(
      `Found package.json at ${pkgPath} but name "${pkgName}" does not match expected names: ${ACCEPTED_PACKAGE_NAMES.join(', ')}`
    );
  }

  if (verbose) {
    const pkgVersion = typeof pkg['version'] === 'string' ? pkg['version'] : 'unknown';
    console.error(`[package-root] Verified package: ${pkgName}@${pkgVersion}`);
  }
}

/**
 * Validate that a directory contains the required server assets.
 */
async function validatePackageRoot(root: string): Promise<void> {
  const missing: string[] = [];

  // config.json is required
  if (!(await pathExists(path.join(root, 'config.json')))) {
    missing.push('config.json');
  }

  if (!(await pathExists(path.join(root, 'resources', 'prompts')))) {
    missing.push('prompts directory (resources/prompts/)');
  }

  if (missing.length > 0) {
    throw new Error(
      `Invalid package root: ${root}\nMissing: ${missing.join(', ')}\n\n` +
        'Use --server-root=/path/to/server to override, or run with --verbose for diagnostics.'
    );
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function generateRootError(resolvedRoot: string, entryFile: string): string {
  return `
Unable to detect server root directory.

Resolved root: ${resolvedRoot}
Entry file: ${entryFile}

This usually happens when:
1. The package was not installed correctly
2. Required files are missing (config.json, resources/prompts/)

SOLUTIONS:

Use --server-root to specify the package root explicitly:
  node dist/index.js --server-root=/path/to/server

For Claude Desktop / Claude Code, ensure config uses absolute paths:
  {
    "mcpServers": {
      "claude-prompts": {
        "command": "node",
        "args": ["/full/path/to/server/dist/index.js"]
      }
    }
  }

For debugging, run with --verbose flag.
`;
}
