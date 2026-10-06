#!/usr/bin/env node

/**
 * Fails when a doc tells a reader to call `system_control` or `resource_manager` with an
 * `action` (or, for `resource_manager`, a `resource_type`) the published contract does not carry.
 *
 * WHY THIS EXISTS. `system_control(action:"whoami")` sat in four doc sites for weeks while the
 * schema accepted twelve other actions and not that one. A reader who copied the exact command
 * got `Unknown action: whoami` from a server that otherwise worked. `typecheck` sees only
 * TypeScript, `lint` does not read prose, and no test executes a code fence, so nothing compared
 * the docs against the vocabulary. The 2026-10-05 survey then found a second instance of the same
 * shape: `resource_manager(resource_type:"checkpoint", ...)` in `docs/guides/ralph-loops.md`.
 *
 * GROUND TRUTH is read at run time from the contracts the schemas are generated from, never held
 * as a copy here: the `action` enum of `tooling/contracts/system-control.json`, and the `action`
 * and `resource_type` enums of `tooling/contracts/resource-manager.json`.
 *
 * WHAT COUNTS AS A CLAIM. A key is read only when it is an argument of a call whose head names
 * the tool: `system_control(` / `system_control {` / `system_control action:"..."`, and the same
 * for `resource_manager`. The bare token `action:"retry"` is not a claim about either tool,
 * because `gate_action:"retry"` on `prompt_engine` and `action:"skip"` in a chain guide share the
 * spelling. A prose mention of a tool name followed later by an unrelated `action:` is likewise
 * not a claim. Inside `system_control` only `action` is checked: its `resource_type` is a filter
 * on the `changes` action (`resource_type:"prompt"`), a different vocabulary. A value written as
 * an alternation (`"gates"|"framework"`) is checked member by member; a placeholder such as
 * `"..."` asserts nothing and is skipped.
 *
 * WHAT IT DOES NOT CLAIM. This is vocabulary, not behavior: a real action with a made-up
 * `operation` (`system_control(action:"gates", operation:"toggle")`) passes, because `operation`
 * is a free-form string per action whose real members (`steps` under `execution_history`) are not
 * all contract command ids. It also cannot see a call spelled without the tool name on the same
 * span (a JSON tool-call object whose `name` is a separate line).
 *
 * SCOPE. Git-tracked markdown among `README.md`, `docs/**`, `server/README.md`, `cli/README.md`
 * and `CONTRIBUTING.md`. `docs/TODO.md` is excluded: it holds labelled sketches of surface that
 * does not exist yet. CHANGELOG.md and `plans/**` are outside: a changelog is the historical
 * record and a plan legitimately quotes the command that tripped a bug.
 *
 * `--self-test` proves each rule can still fail, including a planted `whoami`, and that the
 * ground-truth reader sees a non-empty vocabulary.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';
import { assertNonEmptyScope, trackedFilesUnder } from './lib/tracked-scope.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SERVER, '..');
const GATE = 'documented-tool-actions';

const DOC_PATHS = ['docs', 'README.md', 'server/README.md', 'CONTRIBUTING.md', 'cli/README.md'];

/** Tracked docs that are not claims about shipped surface. Each says why. */
const EXCLUDED_DOCS = new Map([
  ['docs/TODO.md', 'labelled sketches of surface that does not exist yet'],
]);

/**
 * Doc sites that name a value the contract lacks and are already being corrected. Keyed by
 * file, tool, key and value (never a line number, which drifts under unrelated edits), each
 * naming what retires it. The audit fails an entry that stops matching, so the entry cannot
 * outlive the doc line that earned it.
 */
const DOCUMENTED_VALUE_EXCEPTIONS = [
  {
    file: 'docs/guides/ralph-loops.md',
    tool: 'resource_manager',
    key: 'resource_type',
    value: 'checkpoint',
    reason: 'removed by the docs-currency slice (row C.10), which is on its own branch',
    closedBy: 'the docs-currency slice merging to main: delete this entry in the same merge',
  },
];

const TOOL_HEAD = /\b(system_control|resource_manager)\b/g;
const BARE_KEY_AFTER_HEAD = /^[ \t]+["']?(?:action|resource_type)["']?[ \t]*:/;
const KEYED_VALUE =
  /(?<![\w-])["']?(action|resource_type)["']?[ \t]*:[ \t]*((?:["'][^"'\n]*["'][ \t]*\|?[ \t]*)+)/g;
const MAX_CALL_SPAN = 800;

/** The `enum[a|b|c]` members of one contract parameter, throwing when the shape is not there. */
function parameterEnum(contract, tool, name) {
  const parameter = contract.parameters.find((candidate) => candidate.name === name);
  const members = /^enum\[([^\]]+)\]$/.exec(parameter?.type ?? '')?.[1].split('|');
  if (members === undefined || members.length === 0) {
    throw new Error(
      `${tool} contract has no enum-typed '${name}' parameter — the contract moved or changed ` +
        'shape, and this checker is now blind'
    );
  }
  return new Set(members);
}

function readVocabulary() {
  const read = (file) =>
    JSON.parse(readFileSync(path.join(SERVER, 'tooling', 'contracts', file), 'utf8'));
  const systemControl = read('system-control.json');
  const resourceManager = read('resource-manager.json');
  return {
    system_control: { action: parameterEnum(systemControl, 'system_control', 'action') },
    resource_manager: {
      action: parameterEnum(resourceManager, 'resource_manager', 'action'),
      resource_type: parameterEnum(resourceManager, 'resource_manager', 'resource_type'),
    },
  };
}

/** The argument text of the call whose head ends at `headEnd`, or null for a prose mention. */
function callSpan(source, headEnd) {
  const rest = source.slice(headEnd);
  const open = /^[ \t]*([({])/.exec(rest);
  if (open !== null) {
    const start = headEnd + open[0].length - 1;
    let depth = 0;
    const limit = Math.min(source.length, start + MAX_CALL_SPAN);
    for (let at = start; at < limit; at += 1) {
      if ('({['.includes(source[at])) depth += 1;
      else if (')}]'.includes(source[at])) depth -= 1;
      if (depth === 0) return source.slice(start + 1, at);
    }
    // Unbalanced inside the bound: a truncated example. Read only its own line.
    const lineEnd = source.indexOf('\n', start);
    return source.slice(start + 1, lineEnd === -1 ? source.length : lineEnd);
  }
  if (BARE_KEY_AFTER_HEAD.test(rest)) {
    const lineEnd = rest.indexOf('\n') === -1 ? rest.length : rest.indexOf('\n');
    const tick = rest.indexOf('`');
    return rest.slice(0, tick !== -1 && tick < lineEnd ? tick : lineEnd);
  }
  return null;
}

const lineOf = (source, at) => source.slice(0, at).split('\n').length;

/** Every `{tool, key, value, line}` a doc names under a tool head, one per alternation member. */
function documentedClaims(source) {
  const claims = [];
  for (const head of source.matchAll(TOOL_HEAD)) {
    const span = callSpan(source, head.index + head[0].length);
    if (span === null) continue;
    const tool = head[1];
    for (const keyed of span.matchAll(KEYED_VALUE)) {
      const key = keyed[1];
      if (tool === 'system_control' && key !== 'action') continue;
      for (const quoted of keyed[2].matchAll(/["']([^"']*)["']/g)) {
        for (const value of quoted[1].split('|')) {
          if (!/^[a-z][a-z0-9_]*$/.test(value)) continue; // a placeholder claims nothing
          claims.push({ tool, key, value, line: lineOf(source, head.index) });
        }
      }
    }
  }
  return claims;
}

function unknownClaims(source, vocabulary) {
  return documentedClaims(source).filter(
    (claim) => !vocabulary[claim.tool][claim.key].has(claim.value)
  );
}

const exceptionKey = (file, claim) => `${file}|${claim.tool}|${claim.key}|${claim.value}`;

function classifyException(entry, { reachable, stillViolates }) {
  if (!reachable) {
    return { verdict: VERDICT.SUBJECT_MISSING, detail: 'no such tracked doc file' };
  }
  if (!stillViolates) {
    return {
      verdict: VERDICT.SATISFIED,
      detail: `${entry.file} no longer names ${entry.tool} ${entry.key}:"${entry.value}"`,
    };
  }
  return { verdict: VERDICT.LOAD_BEARING };
}

function run() {
  const vocabulary = readVocabulary();
  const docFiles = trackedFilesUnder(DOC_PATHS, { cwd: REPO }).filter(
    (file) => file.endsWith('.md') && !EXCLUDED_DOCS.has(file)
  );
  assertNonEmptyScope(docFiles, DOC_PATHS, `validate:${GATE}`);

  const declared = new Set(DOCUMENTED_VALUE_EXCEPTIONS.map((e) => exceptionKey(e.file, e)));
  const stillFailing = new Set();
  const violations = [];
  let claimsChecked = 0;

  for (const file of docFiles) {
    const source = readFileSync(path.join(REPO, file), 'utf8');
    claimsChecked += documentedClaims(source).length;
    for (const claim of unknownClaims(source, vocabulary)) {
      const key = exceptionKey(file, claim);
      stillFailing.add(key);
      if (!declared.has(key)) violations.push({ file, ...claim });
    }
  }

  // A scan that observed no claim at all is blind, not clean.
  if (claimsChecked === 0) {
    console.error(`✖ ${GATE}: no documented tool claim found in ${docFiles.length} doc file(s).`);
    return 1;
  }

  const audit = auditExceptions({
    gate: GATE,
    entries: DOCUMENTED_VALUE_EXCEPTIONS,
    describe: (e) => `${e.file} ${e.tool} ${e.key}:"${e.value}"`,
    closedBy: (e) => e.closedBy,
    classify: (e) =>
      classifyException(e, {
        reachable: docFiles.includes(e.file),
        stillViolates: stillFailing.has(exceptionKey(e.file, e)),
      }),
  });

  for (const { file, tool, key, value, line } of violations) {
    const known = [...vocabulary[tool][key]].join(', ');
    console.error(`✖ ${file}:${line}: ${tool} ${key}:"${value}" is not in the contract (${known})`);
  }
  if (violations.length > 0) {
    console.error(
      `\n${violations.length} documented tool value(s) do not exist. Point the doc at a command ` +
        'that exists, or add the value to the contract first.'
    );
  }

  const exceptionProblems = reportExceptionAudit(GATE, audit);
  if (violations.length > 0 || exceptionProblems > 0) return 1;

  console.log(
    `✔ ${claimsChecked} documented tool value(s) across ${docFiles.length} doc file(s) exist in ` +
      `the contracts (${DOCUMENTED_VALUE_EXCEPTIONS.length} declared exception(s)).`
  );
  return 0;
}

/** Each rejected case must FAIL and each accepted case must PASS, or the rule proves nothing. */
function selfTest() {
  let failures = 0;
  const vocabulary = readVocabulary();
  const verdict = (name, ok) => {
    console.log(`${ok ? '✔' : '✖'} self-test: ${name}`);
    if (!ok) failures += 1;
  };

  verdict(
    'the reader sees real vocabulary (status, prompt)',
    vocabulary.system_control.action.has('status') &&
      vocabulary.resource_manager.resource_type.has('prompt')
  );
  verdict(
    'the reader sees no whoami (the planted value is genuinely unknown)',
    !vocabulary.system_control.action.has('whoami')
  );

  const rejected = [
    ['a planted system_control whoami', 'system_control(action:"whoami")', 'whoami'],
    ['a spaced, single-quoted action', "system_control(action: 'whoami', x: 1)", 'whoami'],
    ['a bare-form call', 'run system_control action:"whoami", operation:"x"', 'whoami'],
    ['a brace-form call', 'system_control {action:"whoami", previw:true}', 'whoami'],
    ['a made-up alternation member', 'system_control(action:"gates"|"nope")', 'nope'],
    [
      'a resource_type outside the enum',
      'resource_manager(resource_type:"checkpoint")',
      'checkpoint',
    ],
    [
      'an unknown resource_manager action after a valid resource_type',
      'resource_manager(resource_type:"prompt", action:"whoami")',
      'whoami',
    ],
    ['a call wrapped across lines', 'system_control(\n  action:"whoami"\n)', 'whoami'],
  ];
  for (const [name, text, value] of rejected) {
    verdict(
      `${name} is rejected`,
      unknownClaims(text, vocabulary).some((claim) => claim.value === value)
    );
  }

  const accepted = [
    ['a registered system_control action', 'system_control(action:"status")'],
    ['an alternation of registered actions', 'system_control(action:"gates"|"framework")'],
    [
      'a resource_manager call with real values',
      'resource_manager(resource_type:"gate", action:"list")',
    ],
    ['a placeholder value', 'resource_manager(resource_type:"prompt|gate", action:"...")'],
    ['an action-less resource_manager call', 'resource_manager(id:"x")'],
    // The twins below differ from a rejected case in ONE thing: which tool owns the key.
    [
      'a changes filter resource_type',
      'system_control(action:"changes", resource_type:"checkpoint")',
    ],
    ['a prompt_engine gate_action', 'prompt_engine(command:">>x", gate_action:"whoami")'],
    ['a chain-guide action naming no tool', 'Reply with action:"whoami" to continue'],
    [
      'a prose mention far from the key',
      'The system_control tool is described below.\n\naction:"whoami"',
    ],
  ];
  for (const [name, text] of accepted) {
    verdict(`${name} is accepted`, unknownClaims(text, vocabulary).length === 0);
  }

  const classify = (facts) =>
    classifyException({ file: 'docs/x.md', tool: 't', key: 'k', value: 'v' }, facts).verdict;
  verdict(
    'a live exception is load-bearing',
    classify({ reachable: true, stillViolates: true }) === VERDICT.LOAD_BEARING
  );
  verdict(
    'an exception whose site stopped violating is satisfied',
    classify({ reachable: true, stillViolates: false }) === VERDICT.SATISFIED
  );
  verdict(
    'an exception naming an untracked file is subject-missing',
    classify({ reachable: false, stillViolates: false }) === VERDICT.SUBJECT_MISSING
  );
  verdict(
    'an exception with no closedBy is flagged',
    auditExceptions({
      gate: GATE,
      entries: [{ file: 'docs/x.md' }],
      describe: (e) => e.file,
      closedBy: (e) => e.closedBy,
      classify: () => ({ verdict: VERDICT.LOAD_BEARING }),
    }).problems.length > 0
  );

  return failures === 0 ? 0 : 1;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run());
