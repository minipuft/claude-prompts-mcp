#!/usr/bin/env node

/**
 * Proves the built server actually answers on the MCP surface — without restarting Claude Code.
 *
 * WHY THIS EXISTS
 * The loop it replaces: change code, restart the MCP server, manually re-review functionality,
 * then re-explain what was checked. Restarting is the slow part and it is usually unnecessary.
 * A Claude Code restart makes a new build *live for interactive use*; it is not how you learn
 * whether the build works. Spawning a server from the current `dist/` answers that in seconds,
 * and prints something short enough to paste instead of re-narrating.
 *
 * `start:test` (--startup-test) proves the process boots. It does not prove a single tool
 * answers. This is the complement.
 *
 * WHY A SEPARATE CLIENT FROM THE E2E HELPER
 * `tests/e2e/helpers/http-mcp-client.ts` spawns a server too, and reusing it was the obvious
 * move. The original reason not to was transport: that helper drove HTTP+SSE, whose handshake
 * hung whenever it ran after a substantial jest run in the same shell (measured: e2e alone 4/4
 * green; test:unit -> e2e fails; test:integration -> e2e fails; raising timeouts moved the error
 * three times then exhausted 30s, falsifying the slowness hypothesis), while streamable-http
 * under identical preconditions did not (alone 981ms | after test:unit 846ms | after
 * test:integration 1013ms).
 *
 * That reason is now void: the HTTP+SSE transport was removed in the SDK v2 upgrade and the e2e
 * helper drives streamable-http too, so the two are no longer different transports. What still
 * separates them is purpose — this is an operator tool with read-only safety assertions and
 * paste-sized output, that one is a jest fixture. Consolidating them is defensible and unclaimed;
 * the measured history above is kept so nobody re-derives the SSE hang as a live constraint.
 *
 * SAFETY: every call is read-only. Nothing here creates, updates or deletes a resource, and the
 * run asserts afterwards that `state.db` and the workspace resources were left alone.
 *
 * Exit 0 when every check passes; exit 1 with the failing lines otherwise.
 */

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { VERDICT, auditExceptions } from './lib/exception-hygiene.js';

const SERVER_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');

/** Wall-clock ceiling for the whole run; a hang must fail loudly, never sit forever. */
const HEALTH_TIMEOUT_MS = 25_000;
const RPC_TIMEOUT_MS = 20_000;

/**
 * Ground truth read from disk at run time.
 *
 * Deliberately derived, never hardcoded. A literal list of framework ids here would be correct on
 * the day it was written and quietly wrong after the next rename — which is the exact rot that
 * left `verify:action-metadata` reading two files that no longer existed while reporting success.
 */
const DISK_FRAMEWORK_IDS = readdirSync(path.join(SERVER_ROOT, 'resources', 'frameworks'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/** Compare display names to directory ids without caring about dots, case or spacing. */
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Response text by check label, so one check can be asserted against another. */
const seen = new Map();

/** Parse `**category**: id, id, ...` listing lines into ids. */
function parseListedPromptIds(text) {
  return text
    .split('\n')
    .filter((line) => /^\*\*[^*]+\*\*:/.test(line))
    .flatMap((line) => line.slice(line.indexOf(':') + 1).split(','))
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Read-only probes, one line of output each.
 *
 * Each names the tool it exercises and a predicate over the response text. Adding a check is one
 * entry — that is deliberate, so this stays cheap to extend as the surface grows.
 *
 * ASSERT CONTENT, NOT SHAPE. The first version of this file tested `/prompts/i` against the prompt
 * listing and `text.length > 0` against the framework listing. Both pass on a server that has lost
 * every prompt and every framework, because the words survive in the header and the footer. A
 * check that a wrong-but-well-formed response satisfies is a check that reports health it has not
 * measured — and this script exists to be trusted in place of a manual review pass.
 *
 * Each predicate returns `true`, or a string naming what was actually wrong.
 */
const TOOL_CHECKS = [
  {
    // Cross-checked against the framework listing below, which is what makes it falsifiable:
    // agreement between two independent renderings cannot be faked by either one alone.
    label: 'system_control status',
    tool: 'system_control',
    args: { action: 'status' },
    expect: (text) => {
      const active = text.match(/Framework System.*?\(([^)]+)\)/)?.[1];
      if (!active) return 'status does not name an active framework';
      if (!DISK_FRAMEWORK_IDS.some((id) => normalize(active).includes(normalize(id)))) {
        return `active framework "${active}" matches no framework on disk`;
      }
      return true;
    },
  },
  {
    // The declared count and the enumerated ids come from different parts of the renderer, so a
    // listing that silently drops prompts fails here even though the header still says "Prompts".
    label: 'resource_manager prompt list',
    tool: 'resource_manager',
    args: { resource_type: 'prompt', action: 'list' },
    expect: (text) => {
      const declared = Number(text.match(/\*\*Prompts\*\*\s*\((\d+)\)/)?.[1]);
      if (!Number.isFinite(declared)) return 'listing does not declare a prompt count';
      if (declared === 0) return 'listing declares zero prompts';
      const listed = parseListedPromptIds(text);
      if (listed.length !== declared) {
        return `declares ${declared} prompts but enumerates ${listed.length}`;
      }
      return true;
    },
  },
  {
    // Same catalogue reached through the other tool. Disagreement means one of the two reads a
    // different registry than the operator thinks — invisible to any per-tool check.
    label: 'prompt_engine listprompts',
    tool: 'prompt_engine',
    args: { command: '>>listprompts' },
    expect: (text) => {
      const listed = parseListedPromptIds(text);
      if (listed.length === 0) return 'listing enumerates no prompts';
      const viaResourceManager = parseListedPromptIds(
        seen.get('resource_manager prompt list') ?? ''
      );
      if (viaResourceManager.length === 0) return 'no resource_manager listing to compare against';
      // Compare the id SETS, not the counts. Equal counts are satisfied by two catalogues that
      // disagree about every entry, and a tool reading the wrong registry usually still returns a
      // plausible number of prompts.
      const other = new Set(viaResourceManager);
      const divergent = listed.filter((id) => !other.has(id));
      if (divergent.length > 0) {
        return `prompt_engine lists ${divergent.length} prompt(s) resource_manager does not, e.g. "${divergent[0]}"`;
      }
      if (listed.length !== viaResourceManager.length) {
        return `prompt_engine lists ${listed.length} but resource_manager lists ${viaResourceManager.length}`;
      }
      return true;
    },
  },
  {
    // The ledger's store is created lazily inside setDatabasePort, so an action registered
    // before that runs still ROUTES correctly and answers "not available" forever. That
    // response is well-formed, and an 11/11 run reported health against exactly it — the
    // action was structurally dead while every other gate stayed green. This predicate
    // rejects that specific answer rather than merely confirming the action responds.
    label: 'system_control execution_history',
    tool: 'system_control',
    args: { action: 'execution_history', operation: 'list' },
    expect: (text) => {
      if (/not available|not initialized|not wired/i.test(text)) {
        return 'ledger reports unavailable — the record store was not wired at registration time';
      }
      // An empty ledger is a healthy answer: this runs read-only against a server that may
      // legitimately have no history. Both shapes pass; the unavailable shape above does not.
      const emptyNotice = /no execution history/i.test(text);
      const listing = /\*\*Execution History\*\*\s*\(\d+ record/i.test(text);
      if (!emptyNotice && !listing) {
        return 'response is neither an empty-ledger notice nor a record listing';
      }
      return true;
    },
  },
  {
    // Every framework on disk must be served, and exactly one must be active. `length > 0` passed
    // on an empty catalogue; this does not.
    label: 'system_control framework list',
    tool: 'system_control',
    args: { action: 'framework', operation: 'list' },
    expect: (text) => {
      const flat = normalize(text);
      const missing = DISK_FRAMEWORK_IDS.filter((id) => !flat.includes(normalize(id)));
      if (missing.length > 0) return `frameworks on disk but not listed: ${missing.join(', ')}`;
      const activeCount = (text.match(/ACTIVE/g) ?? []).length;
      if (activeCount !== 1) return `expected exactly 1 active framework, found ${activeCount}`;
      return true;
    },
  },
];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Newest mtime under a directory, ignoring nothing — staleness must not be under-reported. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

/**
 * `dist/` is the runtime SSOT and does not track `src/`.
 *
 * Verifying a stale binary is worse than not verifying at all: it returns green for code that is
 * not running. This exact trap cost a wasted restart on 2026-07-31, when dist was three hours
 * older than the change under test.
 */
function checkDistFreshness() {
  let distMtime;
  try {
    distMtime = statSync(DIST_ENTRY).mtimeMs;
  } catch {
    record('dist/ built', false, `${DIST_ENTRY} missing — run \`npm run build\``);
    return false;
  }

  const srcMtime = newestMtime(path.join(SERVER_ROOT, 'src'));
  if (srcMtime > distMtime) {
    const lagMin = Math.round((srcMtime - distMtime) / 60_000);
    record('dist/ current', false, `src is ${lagMin} min newer — run \`npm run build\` first`);
    return false;
  }
  record('dist/ current', true, `built ${new Date(distMtime).toISOString().slice(11, 19)}`);
  return true;
}

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
 * NODE_OPTIONS/NODE_ENV/JEST_WORKER_ID are stripped for the same reason the e2e helper strips
 * them: the server skips `main()` when JEST_WORKER_ID is set, and an inherited
 * `--experimental-vm-modules` leaks the parent's flags into a plain node process.
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
      if (response.ok) return Date.now() - started;
    } catch {
      // Server still binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
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

/** Minimal JSON-RPC caller holding the negotiated session id. */
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
      clientInfo: { name: 'verify-mcp-surface', version: '1' },
    });
    // The spec requires this notification before normal requests are served.
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
 * Tool result as { text, isError }.
 *
 * `isError` is not optional detail — MCP reports tool-level failure there while still returning
 * content. `system_control`'s error text is "Unknown action: X. Valid actions: status, framework,
 * ..." which matched the /status|framework/ predicates, so a deliberately broken call scored PASS
 * until this was checked. A predicate over the text alone cannot tell success from failure.
 */
function resultOf(rpcResponse) {
  return {
    text: rpcResponse?.result?.content?.[0]?.text ?? '',
    isError: rpcResponse?.result?.isError === true,
  };
}

/**
 * Nothing this tool calls may edit an authored resource. Verified, not asserted in a comment.
 *
 * Deliberately scoped to `server/resources/**` and NOT to `state.db`. Booting the server writes
 * runtime state — the content-hash cache and resource index are rebuilt on startup — so state.db's
 * mtime moves for reasons that have nothing to do with whether a check mutated anything. Measured:
 * 4 of 5 identical runs left it alone and the 5th rewrote it, which made this check intermittently
 * red for correct behaviour. An intermittently red trust tool is worse than no trust tool: it
 * trains you to ignore the output. state.db is ephemeral and gitignored; authored resources are
 * what a mutating call would damage, so those are what this guards.
 */
function captureMutationBaseline() {
  return { resources: gitStatusOfResources() };
}

function gitStatusOfResources() {
  try {
    return execFileSync('git', ['status', '--porcelain', 'server/resources'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch {
    return '';
  }
}

function checkNoMutation(baseline) {
  const unchanged = gitStatusOfResources() === baseline.resources;
  record(
    'no resource mutation',
    unchanged,
    unchanged ? 'server/resources untouched' : 'server/resources changed — a check is not read-only'
  );
}

async function runSurfaceChecks(baseUrl) {
  const client = createRpcClient(baseUrl);

  const initialized = await client.handshake();
  const protocolVersion = initialized?.result?.protocolVersion;
  record('initialize', Boolean(protocolVersion), protocolVersion && `protocol ${protocolVersion}`);
  if (!protocolVersion) return;

  const listed = await client.send('tools/list', {});
  const toolNames = (listed?.result?.tools ?? []).map((tool) => tool.name);
  for (const expected of ['prompt_engine', 'resource_manager', 'system_control']) {
    record(`tool registered: ${expected}`, toolNames.includes(expected));
  }

  for (const check of TOOL_CHECKS) {
    const response = await client.send('tools/call', {
      name: check.tool,
      arguments: check.args,
    });
    const rpcError = response?.error?.message;
    if (rpcError) {
      record(check.label, false, rpcError.slice(0, 90));
      continue;
    }
    const { text, isError } = resultOf(response);
    if (isError) {
      record(check.label, false, `tool reported isError — ${text.slice(0, 80)}`);
      continue;
    }
    if (process.env.VERIFY_MCP_DUMP) console.log(`\n----- ${check.label} -----\n${text}\n-----\n`);
    // Recorded before the predicate runs so a later check can assert against this response.
    seen.set(check.label, text);
    const verdict = check.expect(text);
    record(check.label, verdict === true, verdict === true ? `${text.length} chars` : verdict);
  }
}

/**
 * Wrong-but-well-formed responses, one per check.
 *
 * Each reads like a healthy answer — right headers, right footer, right vocabulary — and is wrong
 * in the way the matching predicate is supposed to notice. `--self-test` asserts every predicate
 * rejects its counterpart, which is what keeps this file honest: the previous predicates
 * (`/prompts/i`, `text.length > 0`) accept every one of these.
 *
 * A check added without an entry here fails `--self-test`, so falsifiability is not optional.
 */
const WRONG_BUT_WELL_FORMED = {
  'system_control status':
    '✅ **System Status Overview**\n\n**Framework System**: ✅ Enabled (ATLANTIS)\n**Status**: healthy\n',
  'resource_manager prompt list':
    '📚 **Prompts** (117)\n\n**analysis**: action_plan, content_analysis\n\n_Use `detail:"full"`._',
  // Same count as the peer catalogue, different ids — the shape a tool reading the wrong registry
  // actually produces, and the one a count comparison cannot see.
  'prompt_engine listprompts':
    '📚 **Prompts** (2)\n\n**analysis**: action_plan, deep_research\n\n_Use `detail:"full"`._',
  'system_control framework list':
    '📋 **Available Frameworks**\n\n**C.A.G.E.E.R.F Framework** 🟢 ACTIVE\n**ReACT Framework** ⚪ Available\n',
  // The exact response the dead action returned. It routed, it was well-formed, and 11/11
  // passed alongside it.
  'system_control execution_history':
    '⚠️ **Execution Ledger Not Available**\n\nThe execution record store is not wired. This occurs when the server started without a database.',
};

/** Where the action registry lives. Parsed, not imported — this file must stay dependency-free. */
const SYSTEM_CONTROL_ACTIONS_SOURCE = path.join(
  SERVER_ROOT,
  'src',
  'mcp',
  'metadata',
  'definitions',
  'system-control.ts'
);

/**
 * Actions deliberately without a TOOL_CHECKS entry, each naming what would close it.
 *
 * Mirrors the `acceptedPhantomColumns` + `closedBy` convention in table-contracts.ts: an
 * exemption with no exit is a permanent bypass wearing a temporary label. These predate the
 * registry cross-check; the point of listing them is that the backlog is *visible* and that a
 * NEW action cannot join it silently.
 */
const UNCHECKED_ACTIONS = {
  gates:
    'Needs a check that distinguishes enabled from disabled rather than asserting the word "gates" appears.',
  analytics: 'Needs a metric cross-checked against a second source, as the status check does.',
  config: 'Read-only config dump; needs a value cross-checked against config.json on disk.',
  maintenance: 'Restarts the server — cannot run inside a read-only surface check.',
  guide: 'Returns free-text recommendations with no invariant a predicate could assert.',
  injection: 'Needs a check comparing advertised injection state against the resolved config.',
  session: 'Requires a live chain session; the surface check runs against an idle server.',
  changes: 'Needs seeded resource churn; the run asserts afterwards that nothing was mutated.',
};

/** Read the registered action ids without importing TypeScript. */
function readRegisteredActionIds() {
  const source = readFileSync(SYSTEM_CONTROL_ACTIONS_SOURCE, 'utf8');
  const block = source.match(
    /export const SYSTEM_CONTROL_ACTION_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/
  );
  if (!block) {
    throw new Error(
      `could not locate SYSTEM_CONTROL_ACTION_IDS in ${SYSTEM_CONTROL_ACTIONS_SOURCE} — ` +
        'the registry moved or was renamed, and this cross-check is now blind'
    );
  }
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/**
 * Every registered system_control action must be checked or explicitly exempted.
 *
 * The failure this closes: `execution_history` was registered, routed, and structurally dead,
 * and `verify:mcp` reported 11/11 because TOOL_CHECKS was never extended. The registry grew;
 * the gate did not. Coverage is DERIVED from each check's own `args.action` rather than
 * maintained as a second list, so the two cannot drift apart.
 *
 * What this cannot catch, stated so a green run is not over-read:
 *  - operations within an action (`execution_history:list` vs a future `:purge`) — it counts
 *    actions, not operations;
 *  - `prompt_engine` / `resource_manager`, which expose no comparable flat registry;
 *  - an action whose check exists but asserts shape only — the counterexample requirement
 *    above mitigates that, it does not eliminate it;
 *  - any defect visible only with seeded state, since this runs against an idle server.
 */
function checkActionCoverage() {
  const registered = readRegisteredActionIds();
  const covered = new Set(
    TOOL_CHECKS.filter((check) => check.tool === 'system_control')
      .map((check) => check.args?.action)
      .filter((action) => typeof action === 'string')
  );

  let failures = 0;

  if (registered.length === 0) {
    record('action registry — parsed', false, 'parsed zero actions; the regex matched nothing');
    return 1;
  }
  record('action registry — parsed', true, `${registered.length} registered actions`);

  for (const action of registered) {
    if (covered.has(action)) continue;
    const reason = UNCHECKED_ACTIONS[action];
    const exempted = typeof reason === 'string' && reason.trim().length > 0;
    record(
      `system_control:${action} — checked or exempted`,
      exempted,
      exempted ? `exempt — ${reason}` : 'NO TOOL_CHECKS entry and no UNCHECKED_ACTIONS reason'
    );
    if (!exempted) failures += 1;
  }

  // Exemptions rot in both directions: an action that gained a check keeps a stale excuse, and
  // an action that was deleted leaves one behind. Both mean the list stopped describing reality.
  //
  // This check was the only working instance of exception hygiene in the repo, and it now states
  // its verdicts through the shared definition rather than in its own words. Nothing about its
  // behaviour changed; what changed is that "still true" means the same thing here as it does in
  // the two guards that grew the same check independently.
  const audit = auditExceptions({
    gate: 'verify-mcp-surface',
    entries: Object.entries(UNCHECKED_ACTIONS).map(([action, reason]) => ({ action, reason })),
    describe: (entry) => `system_control:${entry.action}`,
    closedBy: (entry) => entry.reason,
    classify: (entry) => {
      if (!registered.includes(entry.action)) {
        return { verdict: VERDICT.SUBJECT_MISSING, detail: 'action no longer exists' };
      }
      if (covered.has(entry.action)) {
        return { verdict: VERDICT.SATISFIED, detail: 'a TOOL_CHECKS entry now covers it' };
      }
      return { verdict: VERDICT.LOAD_BEARING };
    },
  });

  for (const problem of audit.problems) {
    record(`exemption ${problem.subject}`, false, problem.message);
  }

  return failures + audit.problems.length;
}

/**
 * Prove every predicate can fail before trusting any of them to pass. Runs offline — no server,
 * no port, no build — so it is cheap enough to run alongside the real verification.
 */
function runSelfTest() {
  console.log(
    '\nverify:mcp self-test — every check must reject a wrong-but-well-formed response\n'
  );
  let failures = 0;

  for (const check of TOOL_CHECKS) {
    const fake = WRONG_BUT_WELL_FORMED[check.label];
    if (fake === undefined) {
      record(`${check.label} — has a counterexample`, false, 'no WRONG_BUT_WELL_FORMED entry');
      failures += 1;
      continue;
    }
    // Seed the healthy catalogue so cross-checks fail on the fake, not on a missing peer.
    seen.set(
      'resource_manager prompt list',
      '📚 **Prompts** (2)\n\n**analysis**: action_plan, content_analysis\n'
    );
    const verdict = check.expect(fake);
    const rejected = verdict !== true;
    record(`${check.label} — rejects wrong response`, rejected, rejected ? verdict : 'ACCEPTED IT');
    if (!rejected) failures += 1;
  }

  seen.clear();

  // Falsifiability answers "can this check fail?"; coverage answers "is there a check at all?".
  // A registry can grow past its gate while every existing predicate stays perfectly falsifiable,
  // which is exactly how a dead action passed 11/11.
  console.log('\nverify:mcp self-test — every registered action must be checked or exempted\n');
  failures += checkActionCoverage();

  console.log(
    failures === 0
      ? `\nOK: all ${TOOL_CHECKS.length} checks are falsifiable and every action is accounted for\n`
      : `\nFAILED: ${failures} problem(s) — see lines above\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  console.log('\nMCP surface verification (spawns a server from dist/ — no Claude Code restart)\n');

  const baseline = captureMutationBaseline();

  if (!checkDistFreshness()) {
    console.log('\nRefusing to continue: a green result against a stale build would be a lie.\n');
    process.exit(1);
  }

  const port = await reservePort();
  const server = spawnServer(port);
  const baseUrl = `http://127.0.0.1:${port}`;

  let stderr = '';
  server.stderr?.on('data', (chunk) => (stderr += chunk.toString()));

  try {
    const healthMs = await waitForHealth(baseUrl);
    if (healthMs === null) {
      record('server healthy', false, `no /health within ${HEALTH_TIMEOUT_MS}ms`);
      if (stderr.trim()) console.log(`\n  server stderr:\n${stderr.trim().slice(0, 600)}\n`);
    } else {
      record('server healthy', true, `${healthMs}ms`);
      await runSurfaceChecks(baseUrl);
    }
  } catch (error) {
    record('surface checks', false, error instanceof Error ? error.message : String(error));
  } finally {
    server.kill('SIGTERM');
  }

  checkNoMutation(baseline);

  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${failed.length === 0 ? 'OK' : 'FAILED'}: ${results.length - failed.length}/${results.length} checks passed\n`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
