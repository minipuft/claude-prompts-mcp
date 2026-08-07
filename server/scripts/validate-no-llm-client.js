#!/usr/bin/env node

/**
 * Guards the semantic LLM side-client retirement against reintroduction.
 *
 * The server used to carry an outbound model client (`LLMClient` + provider factory), a gate
 * service that consumed it, a dual-mode analyzer, and a framework integration module — roughly
 * 2,200 lines that were all reachable only when a config flag defaulting to `false` was on. None
 * of it ever ran here. Model-graded gate evaluation is served instead by the `%judge` modifier
 * (`src/engine/gates/judge/`), which delegates to the client's own subagent and returns through
 * `gate_verdict` — no outbound API call, no API key at rest.
 *
 * NOT the same thing as `validate:no-legacy-sidecars`, despite the plan that commissioned this
 * guard proposing the filename `validate-no-llm-sidecar.js`. In this repo "sidecar" already means
 * a JSON state file that SQLite replaced, and that guard forbids file-path shapes. Two guards
 * whose names differ by one word while forbidding unrelated things is the homonym trap that
 * `claude/no-deprecated-automation-mode` documents avoiding (it scopes narrowly because `mode` is
 * one of this repo's heaviest homonyms), so this one is named for what it forbids: an LLM client.
 *
 * SCOPE is the shipping surface (`src/`, `../cli/src`) — not `tests/`. Several tests name the
 * retired symbols deliberately, in assertions that pin their ABSENCE
 * (`expect(stats).not.toHaveProperty('llmIntegrationEnabled')`). Those are the retirement working,
 * not a violation of it, and a test naming a symbol cannot reintroduce the capability.
 *
 * `GateValidationResult` is deliberately NOT forbidden even though T2.5 deleted a type by that
 * name. A live, unrelated `GateValidationResult` exists in
 * `src/mcp/tools/prompt-engine/utils/validation.ts`. Forbidding the string would fail on code that
 * has nothing to do with this retirement.
 *
 * RETIREMENT CONDITION: delete this guard when the deprecated `analysis` config section is removed
 * in the next major. At that point ALLOWLIST must be empty — the section is the only reason any
 * `llmIntegration` reference survives. If it is not empty then, the entries left are real
 * reintroductions and want reading, not deleting.
 *
 * `--self-test` proves each rule can still fail.
 *
 * Exit 0 when nothing is forbidden and no allowlist entry has gone stale; exit 1 otherwise.
 *
 * MECHANISM: script — reach — scans `../cli/src` alongside `src/`, outside the ESLint root
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SERVER = new URL('..', import.meta.url).pathname;

/** The shipping surface. `tests/` is excluded on purpose — see the header. */
const SCOPE = ['src', '../cli/src'];

/**
 * Symbols with no surviving legitimate use anywhere. Each was deleted outright; a hit means the
 * capability is being rebuilt rather than the name being reused.
 */
const FORBIDDEN = [
  { pattern: 'LLMClientFactory', why: 'provider client factory, deleted in T1' },
  { pattern: 'llm-clients', why: 'the deleted client module path' },
  { pattern: 'setLLMClient', why: 'analyzer LLM injection point, deleted in T3' },
  { pattern: 'performLLMAnalysis', why: 'the analyzer LLM branch, deleted in T3' },
  { pattern: 'SemanticGateService', why: 'gate service that consumed the client, deleted in T2' },
  { pattern: 'SemanticIntegrationFactory', why: 'integration factory, deleted in T1' },
  { pattern: 'FrameworkSemanticIntegration', why: 'unreachable module, deleted in T3.5' },
  { pattern: 'isLLMEnabled', why: 'config flag gating user-visible text, retired in T3.5' },
  { pattern: 'llmUsed', why: 'always-false analysis metadata, deleted in T3' },
  { pattern: 'MCP_LLM_', why: 'undocumented env surface, deleted with the client in T1' },
];

/**
 * The deprecated-but-still-parsed config plumbing. `analysis.semanticAnalysis` stays readable for
 * one deprecation cycle (T0.1) because `config.json` is declared public API surface, so these
 * files must keep naming the key.
 *
 * `closedBy` is not decoration: an exception with no exit is a permanent bypass wearing a
 * temporary label. Every entry here closes on the same event, which is why the guard retires
 * wholesale rather than entry by entry.
 */
const ALLOWLIST = [
  {
    file: 'src/infra/config/index.ts',
    why: 'parses and defaults the deprecated section, folds its inert spelling, and emits the deprecation warning',
    closedBy: 'removal of the `analysis` config section in the next major',
  },
  {
    file: 'src/shared/types/core-config.ts',
    why: 'declares the types describing the still-parsed section',
    closedBy: 'removal of the `analysis` config section in the next major',
  },
  {
    file: 'src/shared/types/index.ts',
    why: 're-exports those types',
    closedBy: 'removal of the `analysis` config section in the next major',
  },
];

/** Terms that are legitimate only inside the allowlisted config plumbing. */
const SCOPED = ['llmIntegration', 'LLMIntegrationConfig'];

/**
 * Classifies one ripgrep hit. Pure — the self-test drives it with fabricated inputs rather than
 * by planting a violation in the working tree, so a self-test run cannot leave debris behind.
 *
 * @returns `null` when the hit is acceptable, otherwise the reason it is not.
 */
export function classify(file, line) {
  for (const { pattern, why } of FORBIDDEN) {
    if (line.includes(pattern)) {
      return `forbidden symbol '${pattern}' — ${why}`;
    }
  }

  for (const term of SCOPED) {
    if (!line.includes(term)) continue;
    const allowed = ALLOWLIST.some((entry) => file.includes(entry.file));
    if (!allowed) {
      return `'${term}' outside the deprecated config plumbing — the section is parsed, not read`;
    }
  }

  return null;
}

function ripgrep(pattern, paths) {
  try {
    return execSync(`rg -n --no-heading '${pattern}' ${paths.join(' ')}`, {
      encoding: 'utf8',
      cwd: SERVER,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    })
      .split('\n')
      .filter((l) => l.trim() !== '');
  } catch (error) {
    if (error.status === 1) return []; // rg: no matches
    throw error;
  }
}

function splitHit(hit) {
  const first = hit.indexOf(':');
  const second = hit.indexOf(':', first + 1);
  return { file: hit.slice(0, first), text: hit.slice(second + 1) };
}

/**
 * Classifies one allowlist entry against the definition in `lib/exception-hygiene.js`.
 *
 * This guard grew its own stale-entry detector before that module existed, and it was one of only
 * two in the repo that had one. It now supplies the predicate and the shared module owns the
 * verdict vocabulary, the `closedBy` requirement and the report — because three gates each having
 * their own idea of "still true" is how the definition drifts.
 *
 * `unreachable` cannot occur here: every entry is ripgrepped by its own path rather than found
 * inside a scan, so a tracked file is always reached. That is a property of this guard, not a
 * general one — the vocab guard scans a tree and can miss a tracked file entirely.
 */
function classifyEntry(entry) {
  if (!existsSync(path.join(SERVER, entry.file))) {
    // A deleted file is the loudest form of stale, and the likeliest one: when the config
    // section goes, its plumbing goes with it. Reporting it beats crashing on rg's exit 2,
    // which is what this did before the stale-detection path was itself exercised.
    return { verdict: VERDICT.SUBJECT_MISSING, detail: 'file no longer exists' };
  }
  if (ripgrep(SCOPED.join('|'), [entry.file]).length === 0) {
    return { verdict: VERDICT.SATISFIED, detail: 'file no longer names the term' };
  }
  return { verdict: VERDICT.LOAD_BEARING };
}

const SELF_TEST_CASES = [
  {
    rule: 'a reintroduced client factory is caught',
    file: 'src/modules/semantic/clients.ts',
    line: 'export class LLMClientFactory {',
    expectViolation: true,
  },
  {
    rule: 'a reintroduced gate service is caught',
    file: 'src/engine/gates/services/x.ts',
    line: 'return new SemanticGateService(logger);',
    expectViolation: true,
  },
  {
    rule: 'the retired env surface is caught',
    file: 'src/infra/config/env.ts',
    line: "const on = process.env['MCP_LLM_ENABLED'];",
    expectViolation: true,
  },
  {
    rule: 'the retired capability flag is caught',
    file: 'src/mcp/tools/x.ts',
    line: 'if (analyzer.isLLMEnabled()) {',
    expectViolation: true,
  },
  {
    rule: 'a scoped config term outside the plumbing is caught',
    file: 'src/engine/gates/core/gate-validator.ts',
    line: 'const cfg = config.analysis.semanticAnalysis.llmIntegration;',
    expectViolation: true,
  },
  {
    rule: 'the same term inside the plumbing is accepted',
    file: 'src/infra/config/index.ts',
    line: 'const llmIntegration: LLMIntegrationConfig = {',
    expectViolation: false,
  },
  {
    rule: 'the unrelated GateValidationResult homonym is accepted',
    file: 'src/mcp/tools/prompt-engine/utils/validation.ts',
    line: 'export interface GateValidationResult {',
    expectViolation: false,
  },
  {
    rule: 'ordinary judge-path code is accepted',
    file: 'src/engine/gates/judge/judge-prompt-builder.ts',
    line: 'export function buildJudgePrompt(gate: GateDefinition): string {',
    expectViolation: false,
  },
];

function runSelfTest() {
  console.log('\nvalidate:no-llm-client self-test — every rule must behave\n');

  let failures = 0;
  for (const { rule, file, line, expectViolation } of SELF_TEST_CASES) {
    const got = classify(file, line) !== null;
    const ok = got === expectViolation;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${rule}`);
    if (!ok) failures += 1;
  }

  console.log(
    failures === 0
      ? `\nOK: all ${SELF_TEST_CASES.length} rules are falsifiable\n`
      : `\nFAILED: ${failures} rule(s) behaved wrongly\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const terms = [...FORBIDDEN.map((f) => f.pattern), ...SCOPED].join('|');
  const violations = [];
  for (const hit of ripgrep(terms, SCOPE)) {
    const { file, text } = splitHit(hit);
    const reason = classify(file, text);
    if (reason !== null) violations.push(`  ${file}\n    ${text.trim()}\n    ${reason}`);
  }

  const audit = auditExceptions({
    gate: 'no-llm-client',
    entries: ALLOWLIST,
    describe: (entry) => entry.file,
    closedBy: (entry) => entry.closedBy,
    classify: classifyEntry,
  });

  if (violations.length > 0) {
    console.error(`Found ${violations.length} LLM side-client reference(s).\n`);
    console.error('The outbound model client was retired; model-graded gate evaluation is the');
    console.error('`%judge` modifier / `gates.evaluation.defaultMode`, which runs in the');
    console.error("client's own subagent. See docs/guides/judge-mode.md.\n");
    for (const v of violations.slice(0, 40)) console.error(`${v}\n`);
    if (violations.length > 40) console.error(`  ... and ${violations.length - 40} more`);
  }

  const exceptionProblems = reportExceptionAudit('no-llm-client', audit);

  if (violations.length > 0 || exceptionProblems > 0) process.exit(1);

  console.log('No LLM side-client references outside the deprecated config plumbing.');
}

main();
