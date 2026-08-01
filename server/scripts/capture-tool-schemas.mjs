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
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');
const DEFAULT_SNAPSHOT = path.join(SERVER_ROOT, 'tests', 'snapshots', 'mcp-input-schemas.json');

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
 * NODE_OPTIONS/NODE_ENV/JEST_WORKER_ID are stripped for the same reason
 * `verify-mcp-surface.mjs` strips them: the server skips `main()` under JEST_WORKER_ID,
 * and an inherited `--experimental-vm-modules` leaks the parent's flags.
 */
function spawnServer(port) {
  const env = { ...process.env, PORT: String(port), MCP_WORKSPACE: REPO_ROOT };
  delete env.NODE_OPTIONS;
  delete env.NODE_ENV;
  delete env.JEST_WORKER_ID;

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
    } catch {
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
      } catch {
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
    captured[tool.name] = sortDeep(tool.inputSchema);
  }
  return sortDeep(captured);
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
  if (!existsSync(DIST_ENTRY)) {
    console.error(`${DIST_ENTRY} missing — run \`npm run build\` first`);
    process.exit(1);
  }

  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawnServer(port);
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

    if (!checkMode) {
      mkdirSync(path.dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, serialized);
      console.log(
        `Captured ${Object.keys(captured).length} tool schemas -> ${path.relative(SERVER_ROOT, snapshotPath)}`
      );
      return;
    }

    if (!existsSync(snapshotPath)) {
      console.error(`No snapshot at ${snapshotPath} — run without --check first`);
      process.exit(1);
    }

    const baseline = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    const changes = diffSchemas(baseline, captured);

    if (changes.length === 0) {
      console.log(`OK: published inputSchema identical for ${Object.keys(captured).length} tools`);
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
    process.exit(1);
  } finally {
    server.kill('SIGTERM');
  }
}

await main();
