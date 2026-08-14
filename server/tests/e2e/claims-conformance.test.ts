/**
 * Claims-conformance suite
 *
 * Every scenario in `conformance/*.yaml` asserts something the PUBLISHED surface claims — the
 * README, docs/, or a contract registry — and this driver executes it against a real spawned
 * server over the real transport. A red scenario means the documentation and the server
 * disagree.
 *
 * WHY THIS EXISTS
 * Tier 3a of the acquisition plan found 9 overstated README claims by hand; `%guided` threw a
 * parse error for anyone who typed it. Nothing could have caught that: the smoke suite tests
 * transport and protocol CORRECTNESS, and no test anywhere tests documentation TRUTHFULNESS.
 * The distinction is why this is a sibling suite and not extra cases in the smoke file.
 *
 * WHY IT COSTS NO TOKENS
 * The server needs no LLM to be exercised — the LLM is the CLIENT, and this script plays that
 * role. Functional coverage of the claim surface is therefore free, which is what lets it run on
 * every full-route CI pass and gate every publish.
 *
 * CADENCE: rides `test:e2e` (full-route CI only) plus the npm-publish gate. Never in pre-commit
 * and never in the docs/hooks push routes — see the plan's cadence contract.
 */

import { promises as fs, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import * as yaml from 'js-yaml';

import {
  getAvailablePort,
  startServerWithHttp,
  waitForHealth,
  killServer,
  StreamableHttpMcpClient,
} from './helpers/http-mcp-client.js';

import type { ChildProcess } from 'node:child_process';

const CORPUS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'conformance');

/**
 * A defect in the SCENARIO, not in the server.
 *
 * Kept as its own class because the driver's catch block converts a thrown error into "the server
 * rejected this", which an `error_contains:` row then reads as its claim being honored. An unbound
 * `${...}` or a capture that matched nothing would therefore make a NEGATIVE scenario go green
 * while proving nothing — the exact failure mode the plan records twice (rows 0.5.11, 0.5.12).
 * This class is re-thrown past the catch so a broken scenario always reds as a broken scenario.
 */
class ScenarioSetupError extends Error {}

/** `${name}` — only a whole placeholder binds; a bare `$` or `{}` is left alone. */
const BINDING_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

interface ScenarioRequest {
  tool?: string;
  method?: string;
  args?: Record<string, unknown>;
  /**
   * Values to lift out of THIS request's response text for later requests to reference.
   *
   * `name -> regex source with exactly one capture group`. Without it a chain round-trip is
   * inexpressible: a resume needs the `chain_id` the server MINTED, which is knowable only from
   * response N when composing request N+1. Matching on the response TEXT rather than a JSON path
   * is deliberate — the id is published to the calling LLM inside the prose footer
   * (`response-assembler.ts:658`), so the text is the surface a real client actually reads, and a
   * capture that stops matching means the client-facing contract moved.
   *
   * A regex that does not match THROWS. It never yields empty-string, because binding `""` into a
   * later `chain_id` would produce a plausible-looking request that fails for a schema reason and
   * blames the wrong claim.
   */
  capture?: Record<string, string>;
}

/**
 * Which server a scenario runs against.
 *
 * `shared` — the bundled resource tree, read-only. Every scenario that only READS belongs here;
 * one server amortizes its ~5s startup across the whole corpus.
 *
 * `isolated` — a throwaway workspace holding a COPY of the bundled tree, reached by pointing
 * `MCP_WORKSPACE` at it. Required by anything that mutates: `resource_manager` create/update/
 * delete/rollback write real files, and against the shared server they would write into
 * `server/resources/prompts/` — the repo. A second server also means a leaked mutation cannot
 * reach a read-only row and be reported as that row's claim failing.
 */
type WorkspaceMode = 'shared' | 'isolated';

interface Scenario {
  id: string;
  claim_source: string;
  /** Set from the corpus file's doc-level `workspace:` key, defaulting to `shared`. */
  workspace: WorkspaceMode;
  requests: ScenarioRequest[];
  expect: {
    ok?: boolean;
    /**
     * The response must FAIL and its text must contain this substring.
     *
     * There is deliberately no bare `rejects: true` counterpart. One existed, and every row using
     * it was unfalsifiable in the same way: `operator-plus-reserved` asserted only "this failed"
     * and passed for two months on "Missing required field: text" — the fixture's own argument
     * validation — while the operator it named was in fact being accepted. A negative row that
     * does not name WHY cannot distinguish its claim from any unrelated failure on the same input,
     * so the driver rejects a scenario whose expect block omits every assertion (plan row 0.5.12).
     */
    error_contains?: string;
    tools_include?: string[];
    /**
     * The response must SUCCEED and its text must contain this substring.
     *
     * Exists because `ok: true` cannot see a silent no-op. `@CAGEERF>>prompt` (no space) ran the
     * prompt and returned success while never applying the framework — so an `ok` assertion
     * passed identically before and after the pattern was fixed. Asserting on content is the only
     * way a scenario observes whether the claimed EFFECT happened, rather than merely that the
     * call did not throw.
     */
    text_contains?: string;
    /**
     * `resources/list` must advertise every one of these URIs.
     *
     * `ok: true` is structurally blind on this method: the server answers `resources/list` with
     * `{resources: []}` whenever `resources.registerWithMcp` is false, which is the DEFAULT
     * (`config/index.ts:186`). The corpus row asserting `ok` therefore passed for the whole life
     * of the resource surface while every URI in `docs/reference/mcp-tools.md` returned
     * "Resource not found" — measured 2026-08-11. Naming URIs is what separates "the method is
     * implemented" from "the documented resources exist".
     */
    resources_include?: string[];
    /** `resources/list` must advertise nothing — the claim that the surface is opt-in. */
    resources_empty?: boolean;
  };
  /**
   * A measured, dated disagreement between the published claim and the server.
   *
   * The scenario stays in the corpus asserting the CLAIM, and the driver inverts it: it asserts
   * the divergence is still present. So the day the server is fixed, this row goes red as a
   * SATISFIED exception and must be deleted — the opposite of a skip, which would go quiet
   * forever. `closed_by` names what deletes it.
   */
  known_divergence?: { measured: string; closed_by: string; since: string };
}

/** Load every corpus file. Exported shape is validated here so a malformed row fails loudly. */
function loadCorpus(): Scenario[] {
  const scenarios: Scenario[] = [];
  for (const file of readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.yaml'))) {
    const doc = yaml.load(readFileSync(path.join(CORPUS_DIR, file), 'utf8')) as {
      scenarios?: Scenario[];
      workspace?: string;
    };
    // Declared per FILE, not per scenario: the mode selects which server the row runs against, and
    // a file whose rows split across two servers would read as one corpus while being two.
    const workspace = doc.workspace ?? 'shared';
    if (workspace !== 'shared' && workspace !== 'isolated') {
      throw new Error(
        `${file}: workspace must be "shared" or "isolated", got "${String(doc.workspace)}"`
      );
    }
    for (const s of doc.scenarios ?? []) {
      // A scenario with no traceable claim is a unit test in the wrong place — reject it here
      // rather than let the corpus quietly become a second unit suite.
      if (!s.id || !s.claim_source || !s.requests?.length || !s.expect) {
        throw new Error(
          `${file}: scenario "${s.id ?? '<no id>'}" is missing id, claim_source, requests, or expect`
        );
      }
      // A negative row must name WHY it fails. `rejects: true` asserted only THAT the call failed,
      // so any unrelated failure on the same input satisfied it — which is how the `+` operator
      // row stayed green for two months on the fixture's missing-argument error while the operator
      // itself was accepted. Caught at load so the corpus, not one test, reports the defect.
      if ('rejects' in s.expect) {
        throw new Error(
          `${file}: scenario "${s.id}" uses "rejects: true", which was removed — a negative row ` +
            `cannot distinguish its own claim from an unrelated failure. Use ` +
            `error_contains: "<substring only this claim produces>".`
        );
      }
      const assertions = [
        'ok',
        'error_contains',
        'text_contains',
        'tools_include',
        'resources_include',
        'resources_empty',
      ] as const;
      if (!assertions.some((key) => key in s.expect)) {
        throw new Error(
          `${file}: scenario "${s.id}" asserts nothing — expect must set one of ${assertions.join(', ')}`
        );
      }
      scenarios.push({ ...s, workspace });
    }
  }
  return scenarios;
}

const CORPUS = loadCorpus();

/**
 * Does the published claim hold for this outcome?
 *
 * Used ONLY by the `known_divergence` inversion, which asserts this is false — i.e. that the
 * recorded disagreement is still present, so the row reds the day the server is fixed.
 *
 * It must mirror the positive assertions exactly. It previously reduced to "did not error", which
 * silently mis-handled every content-based mode: a divergence whose whole shape is "succeeds but
 * does nothing" — the documented two-parameter chain resume, which returns ok while the chain
 * stays on step 1 — evaluated as claim-holds and made the row unwritable. `text_contains` was
 * added after the inversion and nothing rechecked it, because no divergence row used the mode
 * until one did (measured 2026-08-11).
 */
function claimHoldsFor(
  want: Scenario['expect'],
  outcome: { isError: boolean; text: string }
): boolean {
  if (want.error_contains !== undefined) {
    return outcome.isError && outcome.text.includes(want.error_contains);
  }
  if (want.text_contains !== undefined) {
    return !outcome.isError && outcome.text.includes(want.text_contains);
  }
  // Every mode this function cannot evaluate must SAY SO rather than fall through to a default.
  // The fall-through is what broke it before: `text_contains` was added to the schema after the
  // inversion was written, silently collapsed to "did not error", and made a whole class of
  // divergence unwritable. A throw here means the next added mode fails loudly on first use.
  if (want.resources_include || want.resources_empty) {
    throw new ScenarioSetupError(
      'known_divergence cannot invert resources_include/resources_empty — assert the divergence ' +
        'with error_contains or text_contains instead'
    );
  }
  // `ok` and `tools_include` both reduce to "the call succeeded" here; `tools_include` is asserted
  // against a tools/list payload that a divergence row has never needed to invert.
  return !outcome.isError;
}

/**
 * Extract a comparable outcome from a tools/call response.
 *
 * Two failure channels, and a claim can legitimately be enforced through either: the helper
 * THROWS on a JSON-RPC protocol error, and returns `{isError: true}` for a tool-level rejection.
 * Collapsing them here is deliberate — the published claim is "this is rejected", not "this is
 * rejected at layer N".
 */
function outcomeOf(result: unknown, thrown: Error | null): { isError: boolean; text: string } {
  if (thrown) return { isError: true, text: thrown.message };
  const r = result as {
    isError?: boolean;
    content?: Array<{ text?: string }>;
    contents?: Array<{ text?: string }>;
  };
  // `content` is the tools/call payload; `contents` is the resources/read one. Both are read here
  // so a scenario asserts on WHAT WAS RETURNED regardless of which method produced it — otherwise
  // every `resources/read` row would see an empty string and fail on a text assertion that the
  // server in fact satisfied.
  const parts = [...(r?.content ?? []), ...(r?.contents ?? [])];
  const text = parts.map((c) => c.text ?? '').join('\n');
  return { isError: r?.isError === true, text };
}

/** Substitute every `${name}`; an unbound name is a scenario defect, never an empty string. */
function interpolate(value: string, bindings: Map<string, string>, scenarioId: string): string {
  return value.replace(BINDING_PATTERN, (_match, name: string) => {
    const bound = bindings.get(name);
    if (bound === undefined) {
      throw new ScenarioSetupError(
        `scenario ${scenarioId}: "\${${name}}" is not bound — no earlier request captured it`
      );
    }
    return bound;
  });
}

/** Walk args recursively so a binding works wherever a string lives, not only at the top level. */
function bindValue(value: unknown, bindings: Map<string, string>, scenarioId: string): unknown {
  if (typeof value === 'string') return interpolate(value, bindings, scenarioId);
  if (Array.isArray(value)) return value.map((entry) => bindValue(entry, bindings, scenarioId));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        bindValue(entry, bindings, scenarioId),
      ])
    );
  }
  return value;
}

/** Record this request's captures, failing loudly (and as a SCENARIO error) if one cannot match. */
function applyCaptures(
  capture: Record<string, string>,
  text: string,
  bindings: Map<string, string>,
  scenarioId: string
): void {
  for (const [name, pattern] of Object.entries(capture)) {
    const match = new RegExp(pattern).exec(text);
    if (!match || match[1] === undefined) {
      throw new ScenarioSetupError(
        `scenario ${scenarioId}: capture "${name}" (/${pattern}/) matched nothing. ` +
          `Server said: ${text.slice(0, 1200)}`
      );
    }
    bindings.set(name, match[1]);
  }
}

/**
 * Build the throwaway workspace the `isolated` corpus runs against.
 *
 * Two distinct claims need two distinct directory shapes, and one workspace can carry both:
 *
 *   `<ws>/resources/`  a full copy of the bundled tree. `getResourcesPath()` prefers
 *                      `<workspace>/resources` over the package default (paths.ts:181-188), so
 *                      every mutating write lands here instead of in the repo.
 *   `<ws>/prompts/`    an overlay-only category. `getOverlayResourceDirs('prompts', primary)`
 *                      returns `<ws>/prompts` because it exists and differs from the primary dir
 *                      `<ws>/resources/prompts` (paths.ts:359-366), so the loader merges it on
 *                      top of the copied tree — which is the documented overlay claim.
 *
 * Both paths are dead code on the shared server: `getOverlayResourceDirs` returns `[]` unless
 * `isUsingCustomWorkspace()`, and until this fixture existed no scenario in the corpus ever ran
 * with a custom workspace, so the entire overlay branch was unexercised.
 */
async function buildIsolatedWorkspace(): Promise<string> {
  const ws = await fs.mkdtemp(path.join(tmpdir(), 'claims-isolated-'));
  const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  await fs.cp(path.join(serverRoot, 'resources'), path.join(ws, 'resources'), { recursive: true });

  // Turn the `resource://` surface ON here, and only here.
  //
  // `resources.registerWithMcp` defaults to FALSE ("tools provide more efficient discovery",
  // config/index.ts:186), so on the shared server every documented `resource://` URI 404s and
  // `resources/list` returns `{resources: []}`. That default is deliberate and is itself a claim
  // the shared corpus asserts; the READ surface can only be exercised with it enabled. Patching
  // the package config rather than writing a fresh one keeps every other setting at its shipped
  // value, so a mutating row still runs against the configuration users get.
  const cfg = JSON.parse(await fs.readFile(path.join(serverRoot, 'config.json'), 'utf8')) as {
    resources?: Record<string, unknown>;
  };
  cfg.resources = { ...(cfg.resources ?? {}), registerWithMcp: true };
  await fs.writeFile(path.join(ws, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');

  // The overlay fixture. `overlay_probe` exists ONLY here — never in the bundled tree — so a
  // scenario that finds it has proven the overlay directory was merged, not that the copy worked.
  const overlayDir = path.join(ws, 'prompts', 'conformance-overlay', 'overlay_probe');
  await fs.mkdir(overlayDir, { recursive: true });
  await fs.writeFile(
    path.join(overlayDir, 'prompt.yaml'),
    [
      'id: overlay_probe',
      'name: Overlay Probe',
      'category: conformance-overlay',
      'description: >-',
      '  Exists only in the isolated workspace overlay directory, never in the bundled tree.',
      '  Its discoverability IS the assertion that workspace resources overlay bundled ones.',
      'userMessageTemplateFile: user-message.md',
      '',
    ].join('\n'),
    'utf8'
  );
  await fs.writeFile(
    path.join(overlayDir, 'user-message.md'),
    'OVERLAY_PROBE_MARKER — served from the workspace overlay.\n',
    'utf8'
  );
  return ws;
}

/**
 * Run one scenario against one client and assert its claim.
 *
 * Extracted from the describe body when the corpus grew a second server: the assertion logic is
 * identical across workspace modes, and duplicating it would let the two copies drift into
 * asserting different things under the same corpus schema.
 */
async function runScenario(active: StreamableHttpMcpClient, scenario: Scenario): Promise<void> {
  // Values captured from earlier responses in THIS scenario. Scoped per scenario on purpose:
  // leaking a chain_id between rows would let one scenario's failure mode arrive as another's.
  const bindings = new Map<string, string>();
  let last: unknown;
  let thrown: Error | null = null;
  try {
    for (const req of scenario.requests) {
      const args = bindValue(req.args ?? {}, bindings, scenario.id) as Record<string, unknown>;
      last = req.method
        ? await active.request(req.method, args)
        : await active.request('tools/call', {
            name: req.tool as string,
            arguments: args,
          });
      if (req.capture) {
        applyCaptures(req.capture, outcomeOf(last, null).text, bindings, scenario.id);
      }
    }
  } catch (error) {
    // A scenario defect is not evidence about the server — never let it become one.
    if (error instanceof ScenarioSetupError) throw error;
    thrown = error instanceof Error ? error : new Error(String(error));
  }

  const { expect: want } = scenario;

  if (scenario.known_divergence) {
    // Inverted on purpose: assert the divergence PERSISTS. When the server starts honoring
    // the claim this fails, naming the row to delete — a suppression that reports its own
    // expiry instead of outliving what it suppressed.
    const outcome = outcomeOf(last, thrown);
    expect(claimHoldsFor(want, outcome)).toBe(false);
    return;
  }

  if (want.resources_include || want.resources_empty) {
    if (thrown) throw thrown;
    const uris = ((last as { resources?: Array<{ uri?: string }> })?.resources ?? []).map(
      (r) => r.uri
    );
    if (want.resources_empty) expect(uris).toHaveLength(0);
    for (const uri of want.resources_include ?? []) expect(uris).toContain(uri);
    return;
  }

  if (want.tools_include) {
    if (thrown) throw thrown;
    const names = ((last as { tools?: Array<{ name?: string }> })?.tools ?? []).map((t) => t.name);
    for (const name of want.tools_include) expect(names).toContain(name);
    return;
  }

  const outcome = outcomeOf(last, thrown);

  if (want.error_contains !== undefined) {
    // Both halves matter: it must fail, AND it must fail for the stated reason. Asserting
    // only the message would pass on a success that happens to echo the string back.
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain(want.error_contains);
    return;
  }
  if (want.text_contains !== undefined) {
    expect(
      outcome.isError ? `EXPECTED SUCCESS, server said: ${outcome.text.slice(0, 1200)}` : 'ok'
    ).toBe('ok');
    expect(outcome.text).toContain(want.text_contains);
    return;
  }
  if (want.ok === true) {
    // Include the server's own words in the failure. A conformance failure is a claim/behavior
    // disagreement, and the next reader's first question is always "what did it actually say?"
    expect(
      outcome.isError ? `EXPECTED SUCCESS, server said: ${outcome.text.slice(0, 400)}` : 'ok'
    ).toBe('ok');
    return;
  }
  throw new Error(`scenario ${scenario.id}: expect block asserts nothing`);
}

const SHARED = CORPUS.filter((s) => s.workspace === 'shared');
const ISOLATED = CORPUS.filter((s) => s.workspace === 'isolated');

describe('claims conformance', () => {
  let proc: ChildProcess | null = null;
  let client: StreamableHttpMcpClient | null = null;
  let runtimeRoot: string;

  beforeAll(async () => {
    const port = await getAvailablePort();
    const baseUrl = `http://localhost:${port}`;

    // Isolate every write. The helper defaults MCP_WORKSPACE to PROJECT_ROOT, which pointed this
    // suite at the developer's live state.db — measured 2026-08-09, a verify:claims run modified
    // <repo>/runtime-state/state.db. Executing prompts appends execution_records and arg_history
    // there. Resources stay pointed at the bundled tree, which is what makes this server the
    // READ-ONLY one; anything that mutates resources belongs to the isolated describe below.
    runtimeRoot = await fs.mkdtemp(path.join(tmpdir(), 'claims-conformance-'));
    proc = startServerWithHttp(port, {
      transport: 'streamable-http',
      env: { MCP_RUNTIME_ROOT: runtimeRoot },
    });
    // The server takes ~5s to initialize; the helper's 10s default is not enough headroom on a
    // loaded CI runner, and the smoke suite already settled on these values.
    await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });
    client = new StreamableHttpMcpClient(baseUrl);
    await client.initialize();
  }, 60000);

  afterAll(async () => {
    if (client) await client.close();
    if (proc) await killServer(proc);
    if (runtimeRoot) await fs.rm(runtimeRoot, { recursive: true, force: true });
  }, 20000);

  it('loads a non-empty corpus', () => {
    expect(SHARED.length).toBeGreaterThan(0);
  });

  it.each(SHARED.map((s) => [s.id, s] as const))(
    '%s',
    async (_id, scenario) => {
      if (!client) throw new Error('client not initialized');
      await runScenario(client, scenario);
    },
    45000
  );
});

/**
 * Mutating scenarios, against a copy of the resource tree.
 *
 * Separate server rather than separate scenarios on the shared one. `resource_manager` create/
 * update/delete write real files, and the shared server's resource path is the repo's own
 * `server/resources/` — a delete row there would remove a tracked prompt from the working tree.
 * The second process also bounds the blast radius: a mutation that leaks past its own scenario
 * can only reach other isolated rows, so it cannot surface as a read-only row's claim failing.
 */
describe('claims conformance (isolated workspace)', () => {
  let proc: ChildProcess | null = null;
  let client: StreamableHttpMcpClient | null = null;
  let workspace: string;
  let runtimeRoot: string;

  beforeAll(async () => {
    const port = await getAvailablePort();
    const baseUrl = `http://localhost:${port}`;

    workspace = await buildIsolatedWorkspace();
    runtimeRoot = await fs.mkdtemp(path.join(tmpdir(), 'claims-isolated-runtime-'));
    proc = startServerWithHttp(port, {
      transport: 'streamable-http',
      // MCP_WORKSPACE is what redirects the resource tree; MCP_RUNTIME_ROOT keeps state.db out of
      // it so a resource rollback and a state write cannot be confused for each other.
      env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: runtimeRoot },
    });
    await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });
    client = new StreamableHttpMcpClient(baseUrl);
    await client.initialize();
  }, 60000);

  afterAll(async () => {
    if (client) await client.close();
    if (proc) await killServer(proc);
    if (workspace) await fs.rm(workspace, { recursive: true, force: true });
    if (runtimeRoot) await fs.rm(runtimeRoot, { recursive: true, force: true });
  }, 20000);

  it.each(ISOLATED.map((s) => [s.id, s] as const))(
    '%s',
    async (_id, scenario) => {
      if (!client) throw new Error('client not initialized');
      await runScenario(client, scenario);
    },
    45000
  );
});
