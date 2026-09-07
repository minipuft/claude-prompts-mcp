#!/usr/bin/env node
// validate-conformance-coverage.js — every bundled framework AND every advertised tool parameter
// must have a claims-conformance scenario (or a declared, closeable exception).
// Usage: node server/scripts/validate-conformance-coverage.js [--self-test]
// Exit: 0 = fully covered, 1 = one or more findings, 2 = invalid args
//
// WHY THIS EXISTS (framework half)
// Plan row 0.5.14 found all 8 bundled frameworks already had scenarios — and that coverage was
// held entirely by hand. Nothing failed when a framework shipped without one, so a 9th directory
// under `resources/frameworks/` would have gone out unexercised and silently. The corpus can only
// ever see the BUNDLED set: a user's own frameworks live in the operator-local tree that CI never
// checks out, so "declared" here means the git-tracked directories and nothing else.
//
// WHY THIS EXISTS (parameter half, added 2026-08-17)
// The framework check has no vocabulary for TOOL PARAMETERS: `workflow` shipped on `prompt_engine`
// with zero conformance rows and this gate stayed green, because it only ever asked about
// `resources/frameworks/`. Re-measured in `plans/reference/technical-debt/test-modernization-roadmap.md`
// (Re-measurement 2026-08-17) as the first open finding — this is that finding's closer. The same
// shape of gap: a declared surface (`tooling/contracts/*.json`) with no corpus cross-check.
//
// This is the same shape as validate-readme.js's claim-coverage check — a declared surface
// cross-checked against the corpus that is supposed to exercise it — and both halves are
// deliberately narrow: they assert a scenario EXISTS naming the framework/parameter, not that the
// scenario is any good. Falsifying what each scenario observes is the corpus's own job
// (`known_divergence`, `error_contains`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

import { auditExceptions, reportExceptionAudit, VERDICT } from './lib/exception-hygiene.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');
const FRAMEWORKS_DIR = path.join(SERVER_ROOT, 'resources', 'frameworks');
const CORPUS_DIR = path.join(SERVER_ROOT, 'tests', 'e2e', 'conformance');
const CONTRACTS_DIR = path.join(SERVER_ROOT, 'tooling', 'contracts');

// ── Framework coverage (original check, unchanged) ───────────────────────────

/** Framework ids the server ships, taken from the directory names it loads them from. */
function declaredFrameworks(dir = FRAMEWORKS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Corpus text with COMMENTS STRIPPED.
 *
 * A framework named only in a `#` comment is documentation, not coverage. validate-readme.js hit
 * exactly this: matching raw file text let a symbol mentioned in a YAML comment count as an
 * exercised claim, so the check passed while the claim went untested.
 */
function corpusCommandText(dir = CORPUS_DIR) {
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n')
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');
}

/**
 * Is this framework exercised anywhere in the corpus?
 *
 * Matched case-insensitively because the symbolic form is `^cageerf` while the directory is
 * `cageerf` and prose uses `CAGEERF`. Word-bounded so `react` does not match `reactivity`.
 */
function isExercised(framework, text) {
  return new RegExp(`\\b${framework.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function findUncoveredFrameworks(frameworks, text) {
  return frameworks.filter((f) => !isExercised(f, text));
}

// ── Parameter coverage (new) ──────────────────────────────────────────────────
//
// MATCHING RULE, chosen and documented here because parameter names collide with English words
// (`command`, `gates`, `id`, `format`...) in a way framework ids do not:
//
//   A parameter counts as covered iff its name appears as a top-level KEY of an `args:` mapping
//   on a request naming ITS tool, i.e. `requests: [{ tool: <tool>, args: { <parameter>: ... } }]`
//   in `tests/e2e/claims-conformance.test.ts`'s own `ScenarioRequest` shape.
//
// Rejected alternative: free-text substring/word match (the framework rule above). `gates` and
// `id` appear constantly in prose, comments, and OTHER tools' `args` blocks — a free-text match
// would pass every one of them without a single scenario ever setting `gates:` on `prompt_engine`.
// Scoping to "key of `args` on a request naming this tool" is the strictest rule that still passes
// today's real coverage (verified against the corpus below) with no hand-written allowlist.
// Comments need no separate stripping pass here (unlike the framework text match): a `#` line is
// not a YAML mapping key, so js-yaml never surfaces it as one.

/** Tool contracts, in the sense `generate-contracts.ts`'s `resolveContractPosture` calls `'tool'`.
 *
 * `resolveContractPosture` checks `contract.toolDescription` FIRST and unconditionally — a
 * `resource-shape` or `artifact-less` contract (`metadata.artifactKind`) carries no
 * `toolDescription` by construction, so `Boolean(contract.toolDescription)` reproduces exactly the
 * resolver's `'tool'` branch without importing it: that module is TypeScript run under `tsx`, and
 * this script runs under plain `node` like its framework half. `tooling/contracts/workflow-ir.json`
 * (`artifactKind: 'resource-shape'`) is the contract this exists to skip — it describes an MCP
 * value shape, not a registered tool's parameter list, and has no MCP surface for a conformance
 * scenario to call.
 */
function loadToolContracts(dir = CONTRACTS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter((contract) => Boolean(contract.toolDescription));
}

function parameterNames(contract) {
  return (contract.parameters ?? []).map((p) => p.name);
}

/** `tool -> Set(parameter names seen as `args` keys for that tool)`, across the whole corpus. */
function corpusArgsByTool(dir = CORPUS_DIR) {
  const byTool = new Map();
  if (!fs.existsSync(dir)) return byTool;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    collectCorpusArgs(fs.readFileSync(path.join(dir, file), 'utf8'), byTool);
  }
  return byTool;
}

/** Exported as its own function so the self-test can feed it fixture YAML text directly. */
function collectCorpusArgs(yamlText, byTool = new Map()) {
  const doc = yaml.load(yamlText);
  for (const scenario of doc?.scenarios ?? []) {
    for (const request of scenario?.requests ?? []) {
      if (!request?.tool) continue;
      const set = byTool.get(request.tool) ?? new Set();
      for (const key of Object.keys(request.args ?? {})) set.add(key);
      byTool.set(request.tool, set);
    }
  }
  return byTool;
}

/**
 * Declared parameter-coverage exceptions.
 *
 * Mirrors `AcceptedException` in `src/infra/database/table-contracts.ts`: every entry names a
 * `reason` the parameter is uncovered today and a `closedBy` condition that would remove the
 * entry. Audited by the shared `scripts/lib/exception-hygiene.js` (`auditExceptions`) below —
 * the same module `validate-table-contracts.ts` uses — rather than a second hand-rolled
 * stale/dangling check: an exception that stops describing the truth (SATISFIED — the parameter
 * is now exercised) or never described anything (SUBJECT_MISSING — no contract advertises that
 * parameter) must fail exactly like a bare empty `closedBy` does.
 */
function exceptionGroup(tool, parameters, reason, closedBy) {
  return parameters.map((parameter) => ({ tool, parameter, reason, closedBy }));
}

const PARAMETER_COVERAGE_EXCEPTIONS = [
  // ── prompt_engine ────────────────────────────────────────────────────────
  ...exceptionGroup(
    'prompt_engine',
    ['gates'],
    'Quick-gate / gate-definition arrays put the run into the interactive gate-verdict retry ' +
      'loop (chain_id + gate_verdict resume) that chain-lifecycle.yaml already drives for ' +
      'gate_verdict/gate_action — but always via a fixture prompt that DECLARES a gate. No such ' +
      'fixture is wired to a `gates:` argument today.',
    'A conformance scenario that submits `gates:` on a chain-triggering prompt and drives the ' +
      'resulting gate_verdict resume to completion, mirroring chain-lifecycle.yaml.'
  ),
  ...exceptionGroup(
    'prompt_engine',
    ['options'],
    '`options` is an open `record` "forwarded downstream" with no single observable effect ' +
      'documented in the contract to assert against.',
    'A conformance scenario once `options` gains a documented, corpus-assertable effect.'
  ),
  // `observations` and `remainder` each had an exception here until 2026-08-30, both retired by
  // `conformance/unknown-interrupt.yaml` (plan row 0.5) rather than edited. `remainder`'s own
  // `closedBy` named that scenario; `observations`' was carried out with it, because the same
  // rows declare a blocking observation and then assert an effect that is reachable ONLY if the
  // ledger opened — a stronger reading than the status readback its `closedBy` proposed.
  // Neither is left behind as a satisfied entry: this gate audits its own exceptions and flags a
  // SATISFIED one, which is the detection row 0.5 was written to supply — and which is what
  // caught the `observations` entry here.

  // ── system_control ──────────────────────────────────────────────────────
  ...exceptionGroup(
    'system_control',
    ['session_id'],
    'Session-scoped operations need an existing session/chain id to target; the shared read-only ' +
      'server (tool-surface.yaml) runs no scenario that mints one first.',
    'A conformance scenario pairing a chain-lifecycle run with a session_id-scoped system_control ' +
      'call against that run.'
  ),
  ...exceptionGroup(
    'system_control',
    ['reason', 'persist'],
    'Audit `reason` and `persist:true` are only meaningful alongside a framework/gate toggle that ' +
      'writes config.json — a mutation unsafe to run against the shared read-only server that ' +
      'tool-surface.yaml uses for every system_control row.',
    'An isolated-workspace scenario (like workspace-and-mutations.yaml) toggling a framework or ' +
      'gate with `persist:true` and a `reason` set.'
  ),
  ...exceptionGroup(
    'system_control',
    ['show_details', 'include_history'],
    'Detail/history-inclusion toggles for status, analytics, framework, gate, and session reports; ' +
      'no scenario asserts a detailed-vs-summary or with/without-history distinction today.',
    'A conformance scenario asserting text present only in the detailed or history-inclusive ' +
      'report, distinguishing it from the current default-level assertions.'
  ),

  ...exceptionGroup(
    'prompt_engine',
    ['handoff', 'claim_token'],
    'Cross-client handoff (plan 2A): minting needs a live run and claiming needs a SECOND ' +
      'server process sharing the same state.db, which the single-server conformance harness ' +
      'cannot spawn today.',
    'A two-server conformance scenario (plan 2A row 2.2): mint in process A, claim in process ' +
      'B, resume executes in B, and a second claim on the spent token is refused by name.'
  ),
  // ── resource_manager ─────────────────────────────────────────────────────
  ...exceptionGroup(
    'resource_manager',
    [
      // `system_message` and `tools` were removed from this list on 2026-09-02: the P2.1/P2.3
      // scenarios in workspace-and-mutations.yaml now exercise both, and this check's own
      // satisfied-exception arm is what caught them still being listed.
      'arguments',
      'argument_updates',
      'patch',
      'chain_steps',
      'gate_configuration',
      'injection',
      'register_with_mcp',
      'mcp_prompt_mode',
      'subagent_model',
      'agent_type',
      'execution_hint',
      'composer',
    ],
    'Prompt create/update payload field. workspace-and-mutations.yaml exercises `create` with ' +
      'only name/category/description/user_message_template, and `update` with only ' +
      'user_message_template — this field has no scenario yet.',
    'An isolated-workspace scenario creating or updating a prompt with this field set, asserting ' +
      "an effect that distinguishes it from the field's default."
  ),
  ...exceptionGroup(
    'resource_manager',
    ['reason'],
    'Audit `reason` for reload/delete/switch; workspace-and-mutations.yaml exercises delete and ' +
      'reload without ever setting it.',
    'A conformance scenario deleting or reloading a resource with `reason` set, confirmed in the ' +
      "response or a subsequent read of the resource's audit trail."
  ),
  ...exceptionGroup(
    'resource_manager',
    ['enabled_only', 'filter', 'format', 'search_query'],
    'resource_manager list-action refinement field; every `list` scenario in the corpus uses ' +
      'default arguments (`{resource_type, action: list}`) only.',
    'A conformance scenario asserting the filtered/formatted list output differs from the ' +
      'unfiltered default.'
  ),
  ...exceptionGroup(
    'resource_manager',
    ['gate_type', 'guidance', 'pass_criteria', 'activation', 'retry_config'],
    'gate resource_type create/update payload field; the corpus exercises resource_type:gate ' +
      'only via read-only `inspect` on a bundled gate (`resource-manager-gate-inspect`), never ' +
      'create/update.',
    'An isolated-workspace scenario creating or updating a gate resource with this field set.'
  ),
  ...exceptionGroup(
    'resource_manager',
    [
      'framework',
      'system_prompt_guidance',
      'phases',
      'gates',
      'tool_descriptions',
      'enabled',
      'persist',
    ],
    'framework resource_type create/update payload field; the corpus exercises ' +
      'resource_type:framework only via read-only `inspect` (`resource-manager-framework-inspect`). ' +
      'Framework `switch` itself is exercised through system_control, a different tool contract.',
    'An isolated-workspace scenario creating or updating a framework resource with this field set.'
  ),
  ...exceptionGroup(
    'resource_manager',
    ['from_version', 'to_version', 'limit', 'skip_version'],
    "Versioning field beyond rollback's `version`; the corpus exercises `action:rollback` (with " +
      '`version`) but not `action:compare` (from_version/to_version), `action:history` (limit), ' +
      'or an update carrying skip_version.',
    'A conformance scenario exercising `action:compare` or `action:history`, or an update with ' +
      'skip_version:true asserting no new version was saved.'
  ),

  // ── skills_sync ──────────────────────────────────────────────────────────
  ...exceptionGroup(
    'skills_sync',
    [
      'action',
      'client',
      'scope',
      'resource_type',
      'id',
      'prune',
      'output',
      'file',
      'category',
      'preview',
      'preview_detail',
      'force',
    ],
    'skills_sync has no conformance corpus file at all — the tool ships zero scenarios, so every ' +
      'one of its parameters is unexercised.',
    'A tests/e2e/conformance/skills-sync.yaml file with at least one scenario per parameter, ' +
      "mirroring the other three tools' corpus files."
  ),
];

/**
 * Every advertised (tool, parameter) pair not covered by the corpus and not named by any
 * declared exception. The exceptions themselves are audited separately, by `auditExceptions`
 * below — this function only reports parameters that carry NO exception at all.
 */
function findUncoveredParameters(
  contracts,
  argsByTool,
  exceptions = PARAMETER_COVERAGE_EXCEPTIONS
) {
  const exceptionKeys = new Set(exceptions.map((e) => `${e.tool}::${e.parameter}`));
  const problems = [];

  for (const contract of contracts) {
    const covered = argsByTool.get(contract.tool) ?? new Set();
    for (const parameter of parameterNames(contract)) {
      if (covered.has(parameter)) continue;
      if (exceptionKeys.has(`${contract.tool}::${parameter}`)) continue;
      problems.push(
        `${contract.tool}.${parameter} has no conformance scenario and no declared exception — ` +
          'add a scenario or declare one in PARAMETER_COVERAGE_EXCEPTIONS.'
      );
    }
  }

  return problems;
}

/**
 * Audits `PARAMETER_COVERAGE_EXCEPTIONS` via the shared exception-hygiene contract: an entry
 * must suppress a real, currently-true finding — a parameter genuinely uncovered by the corpus,
 * on a parameter that actually exists on a loaded tool contract. SATISFIED (parameter is now
 * covered) and SUBJECT_MISSING (parameter doesn't exist) both fail, same as an empty `closedBy`.
 */
function auditParameterExceptions(
  contracts,
  argsByTool,
  exceptions = PARAMETER_COVERAGE_EXCEPTIONS
) {
  const knownPairs = new Set();
  for (const contract of contracts) {
    for (const parameter of parameterNames(contract)) {
      knownPairs.add(`${contract.tool}::${parameter}`);
    }
  }

  return auditExceptions({
    gate: 'conformance-coverage:parameters',
    entries: exceptions,
    describe: (exception) => `${exception.tool}.${exception.parameter}`,
    closedBy: (exception) => exception.closedBy,
    classify: (exception) => {
      const key = `${exception.tool}::${exception.parameter}`;
      if (!knownPairs.has(key)) {
        return {
          verdict: VERDICT.SUBJECT_MISSING,
          detail: 'no loaded tool contract advertises this parameter',
        };
      }
      const covered = argsByTool.get(exception.tool) ?? new Set();
      if (covered.has(exception.parameter)) {
        return {
          verdict: VERDICT.SATISFIED,
          detail: 'the parameter is now exercised in the corpus',
        };
      }
      return { verdict: VERDICT.LOAD_BEARING };
    },
  });
}

// ── Self-test ─────────────────────────────────────────────────────────────────

function selfTest() {
  const cases = [];

  // (Framework half — unchanged.)
  const frameworkCases = [
    { name: 'covered framework passes', fw: ['cageerf'], text: 'command: ^cageerf >>x', want: 0 },
    { name: 'missing framework fails', fw: ['newthing'], text: 'command: ^cageerf >>x', want: 1 },
    {
      name: 'comment-only mention does NOT count',
      fw: ['newthing'],
      text: '# newthing is planned\ncommand: ^cageerf >>x',
      want: 1,
    },
    {
      name: 'substring does not count as coverage',
      fw: ['react'],
      text: 'command: >>x reactivity:true',
      want: 1,
    },
  ];
  for (const c of frameworkCases) {
    const stripped = c.text
      .split('\n')
      .map((l) => l.replace(/#.*$/, ''))
      .join('\n');
    const got = findUncoveredFrameworks(c.fw, stripped).length;
    cases.push({ name: c.name, ok: got === c.want, detail: `expected ${c.want}, got ${got}` });
  }

  // (Parameter half — new.)
  const fixtureContract = (parameters) => ({
    tool: 'fake_tool',
    toolDescription: { description: 'fixture' },
    parameters: parameters.map((name) => ({ name })),
  });

  // (a) a parameter present in the corpus passes.
  {
    const argsByTool = collectCorpusArgs(
      "scenarios:\n  - id: x\n    requests: [{ tool: fake_tool, args: { my_param: 'v' } }]\n"
    );
    const uncovered = findUncoveredParameters([fixtureContract(['my_param'])], argsByTool, []);
    const audit = auditParameterExceptions([fixtureContract(['my_param'])], argsByTool, []);
    cases.push({
      name: 'covered parameter passes',
      ok: uncovered.length === 0 && audit.problems.length === 0,
      detail: JSON.stringify({ uncovered, auditProblems: audit.problems }),
    });
  }

  // (b) a missing parameter fails, naming tool + parameter.
  {
    const argsByTool = collectCorpusArgs(
      "scenarios:\n  - id: x\n    requests: [{ tool: fake_tool, args: { other: 'v' } }]\n"
    );
    const uncovered = findUncoveredParameters([fixtureContract(['missing_param'])], argsByTool, []);
    cases.push({
      name: 'missing parameter fails naming tool+parameter',
      ok:
        uncovered.length === 1 &&
        uncovered[0].includes('fake_tool.missing_param') &&
        uncovered[0].includes('no conformance scenario'),
      detail: JSON.stringify(uncovered),
    });
  }

  // (c) a declared exception with a valid closedBy suppresses the finding.
  {
    const argsByTool = collectCorpusArgs('scenarios: []\n');
    const exceptions = [
      {
        tool: 'fake_tool',
        parameter: 'excused_param',
        reason: 'fixture',
        closedBy: 'fixture tier',
      },
    ];
    const contracts = [fixtureContract(['excused_param'])];
    const uncovered = findUncoveredParameters(contracts, argsByTool, exceptions);
    const audit = auditParameterExceptions(contracts, argsByTool, exceptions);
    cases.push({
      name: 'valid exception suppresses the finding',
      ok: uncovered.length === 0 && audit.problems.length === 0,
      detail: JSON.stringify({ uncovered, auditProblems: audit.problems }),
    });
  }

  // (d) an exception with an empty closedBy is itself a failure.
  {
    const argsByTool = collectCorpusArgs('scenarios: []\n');
    const exceptions = [
      { tool: 'fake_tool', parameter: 'excused_param', reason: 'fixture', closedBy: '   ' },
    ];
    const audit = auditParameterExceptions(
      [fixtureContract(['excused_param'])],
      argsByTool,
      exceptions
    );
    cases.push({
      name: 'exception with empty closedBy is rejected',
      ok: audit.problems.length === 1 && audit.problems[0].message.includes('no closedBy'),
      detail: JSON.stringify(audit.problems),
    });
  }

  // (e) framework coverage behavior is unchanged — covered above via frameworkCases; this case
  // additionally proves the two checks are independent (a parameter fixture cannot mask a
  // framework finding or vice versa, since main() combines both problem lists).
  {
    const uncoveredFrameworksHere = findUncoveredFrameworks(['cageerf'], 'command: ^cageerf >>x');
    const argsByTool = collectCorpusArgs(
      "scenarios:\n  - id: x\n    requests: [{ tool: fake_tool, args: { my_param: 'v' } }]\n"
    );
    const uncoveredParams = findUncoveredParameters(
      [fixtureContract(['my_param'])],
      argsByTool,
      []
    );
    cases.push({
      name: 'framework and parameter checks are independent',
      ok: uncoveredFrameworksHere.length === 0 && uncoveredParams.length === 0,
      detail: `frameworks=${JSON.stringify(uncoveredFrameworksHere)} params=${JSON.stringify(uncoveredParams)}`,
    });
  }

  // Bonus: stale (SATISFIED) and dangling (SUBJECT_MISSING) exceptions are caught by the shared
  // `auditExceptions` module — the exact blind spot `.claude/rules/sqlite-persistence.md` names
  // for `AcceptedException`: an entry that stops describing reality passes silently otherwise.
  {
    const argsByTool = collectCorpusArgs(
      "scenarios:\n  - id: x\n    requests: [{ tool: fake_tool, args: { now_covered: 'v' } }]\n"
    );
    const exceptions = [
      { tool: 'fake_tool', parameter: 'now_covered', reason: 'fixture', closedBy: 'fixture tier' },
    ];
    const audit = auditParameterExceptions(
      [fixtureContract(['now_covered'])],
      argsByTool,
      exceptions
    );
    cases.push({
      name: 'stale (SATISFIED) exception is flagged',
      ok: audit.problems.length === 1 && audit.problems[0].message.includes(VERDICT.SATISFIED),
      detail: JSON.stringify(audit.problems),
    });
  }
  {
    const argsByTool = collectCorpusArgs('scenarios: []\n');
    const exceptions = [
      { tool: 'fake_tool', parameter: 'real_param', reason: 'fixture', closedBy: 'fixture' },
      { tool: 'fake_tool', parameter: 'nonexistent_param', reason: 'fixture', closedBy: 'fixture' },
    ];
    const audit = auditParameterExceptions(
      [fixtureContract(['real_param'])],
      argsByTool,
      exceptions
    );
    cases.push({
      name: 'dangling (SUBJECT_MISSING) exception is flagged',
      ok:
        audit.problems.length === 1 &&
        audit.problems[0].message.includes(VERDICT.SUBJECT_MISSING) &&
        audit.problems[0].subject.includes('nonexistent_param'),
      detail: JSON.stringify(audit.problems),
    });
  }

  let failed = 0;
  for (const c of cases) {
    if (!c.ok) failed++;
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : ` (${c.detail})`}`);
  }
  if (failed > 0) {
    console.error(`\n✗ self-test: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log('\n✓ self-test: all cases passed');
  process.exit(0);
}

// ── Entry point ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
for (const a of argv) {
  if (a !== '--self-test') {
    console.error(`Unknown argument: ${a}`);
    process.exit(2);
  }
}
if (argv.includes('--self-test')) selfTest();

const frameworks = declaredFrameworks();
if (frameworks.length === 0) {
  console.error(`✗ no frameworks found under ${path.relative(SERVER_ROOT, FRAMEWORKS_DIR)}`);
  process.exit(1);
}

const toolContracts = loadToolContracts();
if (toolContracts.length === 0) {
  console.error(`✗ no tool contracts found under ${path.relative(SERVER_ROOT, CONTRACTS_DIR)}`);
  process.exit(1);
}

const argsByTool = corpusArgsByTool();
const uncoveredFrameworks = findUncoveredFrameworks(frameworks, corpusCommandText());
const uncoveredParameters = findUncoveredParameters(toolContracts, argsByTool);
const exceptionAudit = auditParameterExceptions(toolContracts, argsByTool);

let failed = false;

if (uncoveredFrameworks.length > 0) {
  failed = true;
  console.error('✗ bundled frameworks with no claims-conformance scenario:\n');
  for (const f of uncoveredFrameworks) {
    console.error(`  ${f}  — add a scenario to ${path.relative(SERVER_ROOT, CORPUS_DIR)}/`);
  }
  console.error(
    `\n${uncoveredFrameworks.length} of ${frameworks.length} bundled frameworks ship unexercised.\n` +
      'A framework users receive but no scenario runs is a claim nothing verifies.'
  );
}

if (uncoveredParameters.length > 0) {
  failed = true;
  if (uncoveredFrameworks.length > 0) console.error('');
  console.error('✗ tool parameters with no conformance scenario and no declared exception:\n');
  for (const problem of uncoveredParameters) {
    console.error(`  ${problem}`);
  }
  console.error(
    `\n${uncoveredParameters.length} finding(s) across ${toolContracts.length} tool contract(s).`
  );
}

const exceptionProblemCount = reportExceptionAudit(
  'conformance-coverage:parameters',
  exceptionAudit
);
if (exceptionProblemCount > 0) failed = true;

if (failed) process.exit(1);

const totalParameters = toolContracts.reduce((n, c) => n + parameterNames(c).length, 0);
console.log(
  `✓ conformance coverage: all ${frameworks.length} bundled frameworks exercised ` +
    `(${frameworks.join(', ')})\n` +
    `✓ conformance coverage: all ${totalParameters} advertised parameters across ` +
    `${toolContracts.length} tool contracts are covered or exempted`
);
