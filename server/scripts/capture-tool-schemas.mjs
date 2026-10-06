#!/usr/bin/env node
/**
 * Capture the MCP `inputSchema` that this server actually publishes, for all three tools.
 *
 * Why this exists
 * ---------------
 * `@modelcontextprotocol/sdk` converts our hand-written zod schemas to JSON Schema at
 * registration time, and it picks the converter by inspecting the zod major:
 *
 *   dist/esm/server/zod-json-schema-compat.js:19-28
 *     if (isZ4Schema(schema)) return z4mini.toJSONSchema(...)   // zod 4 path
 *     return zodToJsonSchema(...)                               // zod 3 path
 *
 * So upgrading zod swaps the engine that produces our published tool surface, and
 * `CLAUDE.md` §Public API Contract puts that surface inside the contract a major version
 * protects. Neither typecheck nor the test suite observes it: both run against the zod
 * objects, not the emitted JSON Schema.
 *
 * The capture is taken over the wire from a running server rather than by calling the
 * SDK converter directly. Calling the converter would test our belief about which code
 * path runs; `tools/list` tests what a client receives.
 *
 * Usage
 * -----
 *   node scripts/capture-tool-schemas.mjs                 # write the snapshot
 *   node scripts/capture-tool-schemas.mjs --check         # compare, exit 1 on drift
 *   node scripts/capture-tool-schemas.mjs --out <path>    # alternate destination
 *
 * `--check` prints a structural diff. That diff is the deliverable of the zod 4
 * migration: empty means the bump is a minor, non-empty means it is a major.
 *
 * Size ceiling (B.87)
 * -------------------
 * The structural snapshot replaces every description with a marker, so it cannot see the one
 * cost a description carries: bytes every client spends context on at each `tools/list`. When
 * `resource_manager` started publishing a description per parameter, its `inputSchema` grew from
 * 15,341 to 33,620 bytes (measured 2026-10-05), and nothing would have noticed it doubling again. So both modes also measure each tool's published `inputSchema` as compact JSON, with
 * the description text as served, and compare it against a ceiling.
 *
 * The canonical home of each ceiling is `tests/snapshots/mcp-input-schema-sizes.json`
 * (`SIZE_BASELINE` below), one `{ bytes, ceiling }` entry per tool. `bytes` is the measurement
 * the last capture recorded; `ceiling` is set by hand and never written by this script, because
 * raising it is the decision this check exists to make visible in a diff. A tool over its
 * ceiling, or a tool with no entry, fails both modes. A capture rewrites `bytes` only. The
 * ceilings were first set at the measurement plus 10%, rounded up to the next 1,000 bytes.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDistFreshness } from './lib/dist-freshness.js';
import { buildServerEnv, createHermeticRoots } from './lib/hermetic-server-env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');
const DEFAULT_SNAPSHOT = path.join(SERVER_ROOT, 'tests', 'snapshots', 'mcp-input-schemas.json');
const SIZE_BASELINE = path.join(SERVER_ROOT, 'tests', 'snapshots', 'mcp-input-schema-sizes.json');

const HEALTH_TIMEOUT_MS = 30_000;
const RPC_TIMEOUT_MS = 20_000;

const args = process.argv.slice(2);
const checkMode = args.includes('--check');
const outIndex = args.indexOf('--out');
const snapshotPath = outIndex === -1 ? DEFAULT_SNAPSHOT : path.resolve(args[outIndex + 1]);

function reservePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Spawn the built server on streamable-http.
 *
 * The environment comes from `lib/hermetic-server-env.js`, the list `verify:mcp` and the e2e
 * suite scrub too: the server skips `main()` under JEST_WORKER_ID, an inherited
 * `--experimental-vm-modules` leaks the parent's flags, and the ambient MCP_* path overrides
 * would let the operator's config, library and runtime state decide a snapshot that is
 * committed. MCP_WORKSPACE is then set on purpose.
 *
 * MCP_RUNTIME_ROOT is set too, to a directory this run creates and removes. Scrubbing the
 * variable is not enough: without it the runtime root falls back to the workspace, whose
 * `state.db` holds the operator's persisted toggles. A `system_control gates disable` there
 * narrows `prompt_engine` for every later server on that workspace, so the capture would record
 * a schema missing `gates`, `gate_verdict` and `gate_action` — measured 2026-09-14, an 8-change
 * diff. The committed snapshot is the gates-enabled shape, which only a fresh `state.db` serves.
 */
function spawnServer(port, roots) {
  const env = buildServerEnv({
    PORT: String(port),
    MCP_WORKSPACE: REPO_ROOT,
    ...roots.env,
  });

  return spawn('node', [DIST_ENTRY, '--transport=streamable-http', '--quiet'], {
    cwd: SERVER_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForHealth(baseUrl) {
  const started = Date.now();
  while (Date.now() - started < HEALTH_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return true;
    } catch (_error) {
      // Server still binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

/** Responses arrive as SSE frames or bare JSON depending on the request; accept both. */
function parseRpcBody(body) {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      try {
        return JSON.parse(trimmed.slice(5).trim());
      } catch (_error) {
        // Not the payload frame.
      }
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function createRpcClient(baseUrl) {
  let sessionId = null;
  let nextId = 1;

  async function send(method, params) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;

    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!sessionId) sessionId = response.headers.get('mcp-session-id');
    return parseRpcBody(await response.text());
  }

  async function handshake() {
    const initialized = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'capture-tool-schemas', version: '1' },
    });
    await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return initialized;
  }

  return { send, handshake };
}

/**
 * Recursively sort object keys.
 *
 * Key order is not part of the JSON Schema contract, but it is part of `JSON.stringify`
 * output — without this a converter that emits the same schema in a different order would
 * show as a diff, and the whole point is that a non-empty diff means something.
 */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortDeep(value[key])])
    );
  }
  return value;
}

/**
 * Replace every `description` VALUE with a presence marker.
 *
 * Parameter descriptions inside `inputSchema` are resolved through the framework overlay
 * (`prompt-engine.schema.ts` DescriptionResolver), so their text depends on which framework
 * happens to be active in `state.db`. A developer machine with a framework selected and a
 * clean CI runner with none produce different strings for identical code — which made the
 * first version of this snapshot fail in CI while passing locally.
 *
 * The text is not what this snapshot is for. The SDK picks its JSON Schema converter by zod
 * major, and what a converter changes is STRUCTURE: types, `required`, `additionalProperties`,
 * `$ref` inlining, enum placement. Description prose is contract-owned and already covered by
 * `validate:contracts`.
 *
 * A marker rather than deletion, so "the converter stopped emitting descriptions at all"
 * still shows up as a diff — that is a structural change, and dropping the key would hide it.
 */
function normalizeDescriptions(value) {
  if (Array.isArray(value)) return value.map(normalizeDescriptions);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key === 'description' && typeof child === 'string'
          ? '<present>'
          : normalizeDescriptions(child),
      ])
    );
  }
  return value;
}

/**
 * Tool descriptions carry the active framework overlay and resource counts, which move
 * for reasons unrelated to zod. Only `inputSchema` is captured — widening this would make
 * the diff noisy exactly where it needs to be trustworthy.
 */
function extractSchemas(toolsListResponse) {
  const tools = toolsListResponse?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('tools/list returned no tools');
  }

  const captured = {};
  for (const tool of tools) {
    if (!tool.inputSchema) {
      throw new Error(`tool ${tool.name} has no inputSchema`);
    }
    captured[tool.name] = sortDeep(normalizeDescriptions(tool.inputSchema));
  }
  return sortDeep(captured);
}

/**
 * Each tool's published `inputSchema` size in bytes: compact JSON of what `tools/list` served,
 * descriptions included, since those are the bytes a client reads.
 */
function measureSchemaBytes(toolsListResponse) {
  const sizes = {};
  for (const tool of toolsListResponse.result.tools) {
    sizes[tool.name] = Buffer.byteLength(JSON.stringify(tool.inputSchema), 'utf8');
  }
  return sizes;
}

/**
 * Compare measured sizes against the hand-set ceilings. Returns one line per failure: a tool
 * over its ceiling, or a tool the baseline has no ceiling for.
 */
function checkSchemaSizes(measured, baseline) {
  const failures = [];
  for (const [tool, bytes] of Object.entries(measured)) {
    const entry = baseline[tool];
    if (typeof entry?.ceiling !== 'number') {
      failures.push(`${tool}: ${bytes} bytes, and no ceiling in ${path.basename(SIZE_BASELINE)}`);
    } else if (bytes > entry.ceiling) {
      failures.push(`${tool}: ${bytes} bytes, over its ceiling of ${entry.ceiling}`);
    }
  }
  return failures;
}

/** Print every tool's size against its recorded measurement and ceiling. */
function reportSchemaSizes(measured, baseline) {
  for (const [tool, bytes] of Object.entries(measured)) {
    const entry = baseline[tool] ?? {};
    const recorded = typeof entry.bytes === 'number' ? entry.bytes : 'none';
    console.log(
      `  ${tool}: ${bytes} bytes (recorded ${recorded}, ceiling ${entry.ceiling ?? 'none'})`
    );
  }
}

/**
 * Flatten to `path -> JSON value` so two schemas can be compared leaf by leaf.
 *
 * An empty object must still emit a leaf. `additionalProperties: {}` (zod 4's way of
 * saying "any extra property is allowed") would otherwise contribute no entries at all
 * and read as a deletion of `additionalProperties: true` rather than a rewording of it —
 * the diff would over-report a semantic change that did not happen.
 */
function flatten(value, prefix = '', into = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      into.set(prefix, '{}');
      return into;
    }
    for (const [key, child] of entries) {
      flatten(child, prefix ? `${prefix}.${key}` : key, into);
    }
  } else {
    into.set(prefix, JSON.stringify(value));
  }
  return into;
}

function diffSchemas(baseline, current) {
  const before = flatten(baseline);
  const after = flatten(current);
  const changes = [];

  for (const [key, value] of before) {
    if (!after.has(key)) {
      changes.push({ kind: 'removed', path: key, before: value });
    } else if (after.get(key) !== value) {
      changes.push({ kind: 'changed', path: key, before: value, after: after.get(key) });
    }
  }
  for (const [key, value] of after) {
    if (!before.has(key)) {
      changes.push({ kind: 'added', path: key, after: value });
    }
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

async function main() {
  // The snapshot is taken from `dist/`, so a build older than `src/` captures — or passes — a
  // surface that is not the one the source declares. Measured 2026-09-22 (P4.136): a source
  // change without a rebuild answered `OK: published inputSchema identical`. Refused in both
  // modes: writing a snapshot from a stale build is the same lie, committed.
  const freshness = checkDistFreshness(DIST_ENTRY, path.join(SERVER_ROOT, 'src'));
  if (!freshness.fresh) {
    console.error(`capture-tool-schemas: refusing a ${freshness.kind} build — ${freshness.reason}`);
    process.exit(1);
  }

  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const roots = createHermeticRoots('capture-tool-schemas');
  const server = spawnServer(port, roots);
  let stderr = '';
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    if (!(await waitForHealth(baseUrl))) {
      throw new Error(`server did not become healthy in ${HEALTH_TIMEOUT_MS}ms\n${stderr}`);
    }

    const client = createRpcClient(baseUrl);
    await client.handshake();
    const listed = await client.send('tools/list', {});
    const captured = extractSchemas(listed);
    const serialized = `${JSON.stringify(captured, null, 2)}\n`;
    const sizes = measureSchemaBytes(listed);
    const sizeBaseline = existsSync(SIZE_BASELINE)
      ? JSON.parse(readFileSync(SIZE_BASELINE, 'utf-8'))
      : {};
    console.log('Published inputSchema sizes:');
    reportSchemaSizes(sizes, sizeBaseline);
    const sizeFailures = checkSchemaSizes(sizes, sizeBaseline);
    for (const failure of sizeFailures) {
      console.error(`  over budget: ${failure}`);
    }
    if (sizeFailures.length > 0) {
      console.error(
        `\nA ceiling is raised by hand in ${path.relative(SERVER_ROOT, SIZE_BASELINE)}, ` +
          'which makes the growth a reviewed change rather than a drift.'
      );
      process.exitCode = 1;
    }

    if (!checkMode) {
      mkdirSync(path.dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, serialized);
      const recorded = Object.fromEntries(
        Object.entries(sizes).map(([tool, bytes]) => [
          tool,
          { ...sizeBaseline[tool], bytes, ceiling: sizeBaseline[tool]?.ceiling ?? null },
        ])
      );
      writeFileSync(SIZE_BASELINE, `${JSON.stringify(recorded, null, 2)}\n`);
      console.log(
        `Captured ${Object.keys(captured).length} tool schemas -> ${path.relative(SERVER_ROOT, snapshotPath)}`
      );
      return;
    }

    if (!existsSync(snapshotPath)) {
      console.error(`No snapshot at ${snapshotPath} — run without --check first`);
      process.exitCode = 1;
      return;
    }

    const baseline = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    const changes = diffSchemas(baseline, captured);

    if (changes.length === 0) {
      const verdict = sizeFailures.length === 0 ? 'OK' : 'FAIL (size)';
      console.log(
        `${verdict}: published inputSchema structure identical for ${Object.keys(captured).length} tools`
      );
      return;
    }

    console.error(`\n${changes.length} inputSchema changes vs snapshot:\n`);
    for (const change of changes) {
      if (change.kind === 'changed') {
        console.error(
          `  ~ ${change.path}\n      before: ${change.before}\n      after:  ${change.after}`
        );
      } else if (change.kind === 'added') {
        console.error(`  + ${change.path} = ${change.after}`);
      } else {
        console.error(`  - ${change.path} = ${change.before}`);
      }
    }
    console.error('\nThis diff decides the version: it is the published MCP tool surface.');
    process.exitCode = 1;
  } finally {
    // Wait for exit before removing the runtime root: a server still shutting down writes there.
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
      await once(server, 'exit');
    }
    roots.cleanup();
  }
}

await main();
