// @lifecycle canonical - Resolves the server's own version for health/identity reporting.
/**
 * Server Version Resolution
 *
 * `/health`, the MCP `initialize` `serverInfo`, and the telemetry `service.version` resource
 * attribute all need to answer one question: what version is this process? The answer is
 * `server/package.json`'s own `"version"`, never a config value — an operator's config cannot
 * say what version the binary is, only the binary's own package manifest can (see #287).
 *
 * Two readers, in priority order:
 *
 * 1. `process.env.BUILD_VERSION` — `esbuild.config.mjs` injects this from `package.json` at
 *    build time, so the bundled `dist/index.js` never touches the filesystem for it.
 * 2. A direct read of `package.json`, for everything that runs unbundled — ts-jest, ts-node, a
 *    script importing `src/` directly. `server-version.ts` lives two directories below the
 *    package root (`src/infra/config/`), so the walk is fixed rather than searched.
 *
 * A version that cannot be determined either way throws rather than reporting a hard-coded
 * default. Before this module existed, `DEFAULT_SERVER_CONFIG.version` was the literal string
 * `'1.0.0'`, unconditionally, for the entire life of the 4.x release line — `/health` and MCP
 * `initialize` both reported it while `package.json` said `4.0.1`. A wrong-but-plausible-looking
 * version is worse than a loud failure: nothing downstream had reason to doubt `1.0.0`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedVersion: string | undefined;

/** Resolve the server's own version. Cached after the first successful read. */
export function getServerVersion(): string {
  if (cachedVersion !== undefined) {
    return cachedVersion;
  }

  const injected = process.env['BUILD_VERSION'];
  if (typeof injected === 'string' && injected.length > 0) {
    cachedVersion = injected;
    return cachedVersion;
  }

  cachedVersion = readVersionFromPackageJson();
  return cachedVersion;
}

function readVersionFromPackageJson(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', '..', '..', 'package.json');

  let raw: string;
  try {
    raw = readFileSync(pkgPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot determine server version: process.env.BUILD_VERSION is not set and ${pkgPath} ` +
        `is not readable. This should only happen outside an esbuild build; if this is ` +
        `dist/index.js, the build injected nothing and is broken.`,
      { cause: error }
    );
  }

  let pkg: unknown;
  try {
    pkg = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot determine server version: ${pkgPath} is not valid JSON.`, {
      cause: error,
    });
  }

  const version = (pkg as { version?: unknown } | null)?.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Cannot determine server version: ${pkgPath} has no "version" string.`);
  }

  return version;
}
