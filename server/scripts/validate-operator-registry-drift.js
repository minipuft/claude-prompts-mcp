#!/usr/bin/env node
/**
 * Every hand-written copy of a registry operator must agree with `operators.json`.
 *
 * WHY THIS EXISTS. The framework operator had five definitions and no gate holding them together:
 * the registry, the extractor in `parser-utils.ts`, the routing allowlist in `tool-routing.ts`,
 * the CTA renderer in `response-assembler.ts`, and a fallback copy in `hooks/prompt-suggest.py`
 * — plus a documentation table. Two changes landed on the extractor and the registry was left at
 * its pre-change state for two revisions. Nothing failed, because the registry pattern's only
 * consumer is the chain-prefix STRIP and no test drove a framework operator through a chain. The
 * canonical `^` sigil therefore threw `Invalid chain step format` on every chained command while
 * the plan recorded it as shipped.
 *
 * WHAT IT CHECKS, AND WHY THESE SITES. `parser-utils.ts` is absent from this file on purpose: it
 * now derives its pattern from the registry, so it cannot drift and a check on it would be
 * vacuous. The four sites below CANNOT derive — an allowlist of literal tokens, a template
 * literal, a Python fallback that exists precisely for when the registry is unreachable, and a
 * markdown table. Those are the ones that need a gate rather than a refactor.
 *
 * SCOPE. Paths are enumerated literally, not walked, so untracked files cannot enter and a moved
 * file fails loudly rather than silently passing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SERVER = path.resolve(path.dirname(SCRIPT_PATH), '..');
const REPO = path.resolve(SERVER, '..');
const REGISTRY = path.join(SERVER, 'tooling/contracts/registries/operators.json');

/** Sites carrying a hand-written copy of the framework operator. Relative to the repo root. */
const SITES = {
  routing: 'server/src/engine/execution/pipeline/routing/tool-routing.ts',
  cta: 'server/src/engine/execution/formatting/response-assembler.ts',
  hookFallback: 'hooks/prompt-suggest.py',
  parserDoc: 'server/src/engine/execution/parsers/README.md',
};

function readRepoFile(relative) {
  return readFileSync(path.join(REPO, relative), 'utf8');
}

function loadFrameworkOperator(registryText) {
  const contract = JSON.parse(registryText);
  const framework = contract.operators.find((op) => op.id === 'framework');
  if (!framework) throw new Error('operators.json declares no `framework` operator');
  return {
    symbol: framework.symbol,
    deprecated: framework.deprecatedSymbols ?? [],
    pattern: framework.pattern.typescript,
  };
}

/** `tool-routing.ts` allowlists prefix tokens literally; every declared sigil must be present. */
function checkRoutingAllowlist(operator, source) {
  const match = source.match(/const ALLOWED_PREFIX_TOKENS = \[(.*?)\]/s);
  if (!match) return [`${SITES.routing}: ALLOWED_PREFIX_TOKENS not found (moved or renamed?)`];

  const tokens = [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const required = [operator.symbol, ...operator.deprecated];
  return required
    .filter((sigil) => !tokens.includes(sigil))
    .map(
      (sigil) =>
        `${SITES.routing}: ALLOWED_PREFIX_TOKENS is missing '${sigil}', which operators.json ` +
        `declares for the framework operator. Commands prefixed with it will not route.`
    );
}

/**
 * The CTA renderer builds the echoed token with a literal sigil. Checking that it uses the
 * CANONICAL one is the point: rendering a deprecated sigil teaches every user the spelling that
 * is being removed.
 */
function checkCtaSymbol(operator, source) {
  const body = source.match(/resolveFrameworkToken\(context: ExecutionContext\)[\s\S]*?\n {2}\}/);
  if (!body) return [`${SITES.cta}: resolveFrameworkToken not found (moved or renamed?)`];

  const rendered = [...body[0].matchAll(/`(.)\$\{/g)].map((m) => m[1]);
  if (rendered.length === 0) return [`${SITES.cta}: resolveFrameworkToken renders no sigil`];

  return rendered
    .filter((sigil) => sigil !== operator.symbol)
    .map(
      (sigil) =>
        `${SITES.cta}: resolveFrameworkToken renders '${sigil}' but operators.json declares ` +
        `'${operator.symbol}' canonical. The CTA would teach a deprecated spelling.`
    );
}

/**
 * The Python fallback runs only when `lib/operators.py` cannot load the registry, so it is
 * unreachable in every normal run — which is exactly why it drifts unnoticed. It must stay
 * byte-equal to the registry pattern.
 */
function checkHookFallback(operator, source) {
  // Scope to the framework detector's body first. Matching the first `re.search` in the file
  // finds the `>>`-prompt-id regex instead — a probe for something merely ADJACENT to the
  // property, which is the failure this whole gate was written to catch.
  const fn = source.match(/def detect_framework\([\s\S]*?(?=\ndef )/);
  if (!fn) return [`${SITES.hookFallback}: detect_framework not found (moved or renamed?)`];

  const match = fn[0].match(/re\.search\(\s*r"((?:[^"\\]|\\.)*)",\s*message\)/);
  if (!match) return [`${SITES.hookFallback}: framework fallback regex not found`];

  // Python `r"..."` is a raw string, so the source text IS the pattern — no unescaping. The JSON
  // side is already unescaped by the parse above, so both sides are compared as regex source.
  if (match[1] === operator.pattern) return [];
  return [
    `${SITES.hookFallback}: fallback regex has drifted from operators.json.\n` +
      `    registry: ${operator.pattern}\n` +
      `    fallback: ${match[1]}`,
  ];
}

/** The parser README publishes an operator table; a stale row documents a sigil that is wrong. */
function checkParserDoc(operator, source) {
  const row = source.split('\n').find((line) => /^\|\s*Framework\s*\|/.test(line));
  if (!row) return [`${SITES.parserDoc}: no Framework row in the operator table`];

  // Split on unescaped pipes only — the Pattern cell contains `\|` as regex alternation, and a
  // naive split('|') tears it in half and then compares the fragment.
  const cells = row.split(/(?<!\\)\|/).map((cell) => cell.trim());
  const [, , symbolCell = '', patternCell = ''] = cells;
  const problems = [];

  if (!symbolCell.includes(`\`${operator.symbol}\``)) {
    problems.push(
      `${SITES.parserDoc}: Framework row shows symbol ${symbolCell || '(empty)'} but ` +
        `operators.json declares \`${operator.symbol}\``
    );
  }
  // The table escapes `|` for markdown; undo that before comparing to the registry source.
  const documented = patternCell.replace(/\\\|/g, '|').replace(/^`\/|\/`$/g, '');
  if (documented !== operator.pattern) {
    problems.push(
      `${SITES.parserDoc}: Framework row documents a stale pattern.\n` +
        `    registry:   ${operator.pattern}\n` +
        `    documented: ${documented}`
    );
  }
  return problems;
}

function runChecks(operator, sources) {
  return [
    ...checkRoutingAllowlist(operator, sources.routing),
    ...checkCtaSymbol(operator, sources.cta),
    ...checkHookFallback(operator, sources.hookFallback),
    ...checkParserDoc(operator, sources.parserDoc),
  ];
}

/**
 * `hooks/lib/operators.py` compiles `pattern.typescript` with Python `re`. The registry declares
 * ONE pattern per operator on purpose — measured 2026-08-12, all eight compile and agree across
 * both engines, so a second `pattern.python` key would add a definition to maintain rather than
 * remove one. What that leaves unguarded is the day someone writes a construct only one engine
 * accepts — a named group, an engine-specific escape — which fails silently on the Python side
 * because `_load_operators()` swallows the error and returns an empty dict.
 *
 * This is separate from the copy checks above: those compare TEXT, this compares BEHAVIOUR.
 */
function checkPythonEngineAgreement(registryText) {
  const probe = `
import json, re, sys
contract = json.loads(sys.stdin.read())
problems = []
for op in contract["operators"]:
    pattern = op["pattern"]["typescript"]
    flags = re.IGNORECASE if "i" in op["pattern"].get("flags", "") else 0
    try:
        re.compile(pattern, flags)
    except re.error as exc:
        problems.append(f'{op["id"]}: compiles in JS but not in Python re ({exc})')
print("\\n".join(problems))
`;
  const output = execFileSync('python3', ['-c', probe], {
    input: registryText,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => `operators.json ${line}. The Python hook would silently detect no operators.`);
}

/**
 * Every operator's own `examples` must be matched by its own `pattern`.
 *
 * WHY. Measured 2026-08-12: `gate` scored 0/3 against its own pattern while the other seven
 * scored 2/2, 3/3, 1/1. Its pattern requires a leading `\s+` and all three examples began at
 * position 0. Nothing compared the two, so the registry could be internally inconsistent while
 * every drift check above passed: those compare the registry to its COPIES, and agreeing copies
 * of a wrong pattern still agree.
 *
 * WHAT THIS IS NOT. `examples` has no live consumer today, and the fix was NOT urgent for that
 * reason — measured before claiming otherwise. `hooks/lib/operators.py` loads it into a dataclass
 * field nothing reads; `generate-contracts.ts` has an `examples` field but it belongs to
 * ToolParameter, a homonym on a different contract; the operator tables in docs/ are hand-written
 * and already anchor their own examples, which is what flagged the registry as the outlier.
 * The value here is that the field is one consumer away from mattering, and a wrong example is
 * invisible until then. Do not restate this as "users were copying broken hints" — they were not.
 *
 * SCOPE — `examples` only, deliberately. `variants[].syntax` holds fragments (`:: 'text'`) that
 * describe an operator's shape rather than a runnable command, so requiring them to match would
 * force a rewrite of accurate documentation to satisfy a check. An example is the thing a reader
 * copies; that is the property worth gating.
 */
function checkExamplesMatchOwnPattern(registryText) {
  const contract = JSON.parse(registryText);
  const problems = [];

  for (const op of contract.operators) {
    const pattern = op.pattern?.typescript;
    const examples = op.examples ?? [];
    if (!pattern || examples.length === 0) continue;

    // Strip `g`/`y` before testing. Both make `.test()` stateful via `lastIndex`, so the same
    // regex would alternate true/false across a loop and this check would report failures that
    // depend on example ORDER — an adjacent-property bug in a gate written to catch exactly that.
    const flags = (op.pattern.flags ?? '').replace(/[gy]/g, '');
    let regex;
    try {
      regex = new RegExp(pattern, flags);
    } catch (error) {
      problems.push(`operators.json ${op.id}: pattern does not compile — ${error.message}`);
      continue;
    }

    const unmatched = examples.filter((example) => !regex.test(example));
    if (unmatched.length > 0) {
      problems.push(
        `operators.json ${op.id}: ${unmatched.length}/${examples.length} example(s) do not match ` +
          `its own pattern — ${unmatched.map((e) => JSON.stringify(e)).join(', ')}. ` +
          'Anchor the example in a full command, or fix the pattern if the example is right.'
      );
    }
  }

  return problems;
}

function loadSources() {
  return Object.fromEntries(
    Object.entries(SITES).map(([key, relative]) => [key, readRepoFile(relative)])
  );
}

/**
 * Proves each check CAN fail. A gate that has never failed is unverified — and this gate exists
 * because four sites passed for two revisions while being wrong.
 */
function selfTest() {
  const operator = loadFrameworkOperator(readFileSync(REGISTRY, 'utf8'));
  const clean = loadSources();

  const mutations = [
    ['routing allowlist drops the canonical sigil', 'routing', (s) => s.replace(/'\^', /, '')],
    ['CTA renders a deprecated sigil', 'cta', (s) => s.replace(/`\^\$\{/g, '`@${')],
    [
      'hook fallback pattern drifts',
      'hookFallback',
      (s) => s.replace(/\[@\^\]/, '@').replace(/\(\?!\[A-Za-z0-9_-\]\)/, '(?=\\s|$)'),
    ],
    ['README documents a stale pattern', 'parserDoc', (s) => s.replace(/\[@\\?\^\]/, '@')],
  ];

  let failures = 0;

  // Cross-engine check gets its own harness: it takes registry TEXT, not the site sources.
  const registryText = readFileSync(REGISTRY, 'utf8');
  if (checkPythonEngineAgreement(registryText).length !== 0) {
    console.error('  ✗ baseline: registry patterns already disagree across engines');
    failures += 1;
  } else {
    console.log('  ✓ baseline: every registry pattern compiles in both engines');
  }
  // `(?<name>...)` is a valid JS named group and a Python `re` error — the exact shape that
  // would leave the hook detecting nothing at all.
  const jsOnly = registryText.replace('"typescript": "-->"', '"typescript": "(?<x>--)>"');
  if (jsOnly === registryText || checkPythonEngineAgreement(jsOnly).length === 0) {
    console.error('  ✗ JS-only construct: mutation did not trip the cross-engine check');
    failures += 1;
  } else {
    console.log('  ✓ JS-only construct is rejected');
  }

  // Self-consistency gets its own baseline + mutation, on registry TEXT like the check above.
  if (checkExamplesMatchOwnPattern(registryText).length !== 0) {
    console.error('  ✗ baseline: an operator already fails to match its own examples');
    failures += 1;
  } else {
    console.log('  ✓ baseline: every operator matches its own examples');
  }
  // Un-anchor the gate examples — the literal defect this check was written for.
  const unanchored = registryText.replace(
    '">>analyze :: \'cite sources\'"',
    '":: \'cite sources\'"'
  );
  if (unanchored === registryText || checkExamplesMatchOwnPattern(unanchored).length === 0) {
    console.error('  ✗ un-anchored example: mutation did not trip the self-consistency check');
    failures += 1;
  } else {
    console.log('  ✓ an example that does not match its own pattern is rejected');
  }

  if (runChecks(operator, clean).length !== 0) {
    console.error('  ✗ baseline: the unmutated tree already reports drift');
    failures += 1;
  } else {
    console.log('  ✓ baseline: clean tree reports no drift');
  }

  for (const [label, key, mutate] of mutations) {
    const mutated = { ...clean, [key]: mutate(clean[key]) };
    if (mutated[key] === clean[key]) {
      console.error(`  ✗ ${label}: mutation was a no-op — the check is untested`);
      failures += 1;
      continue;
    }
    if (runChecks(operator, mutated).length === 0) {
      console.error(`  ✗ ${label}: mutation did not trip the gate`);
      failures += 1;
    } else {
      console.log(`  ✓ ${label}`);
    }
  }

  if (failures > 0) {
    console.error(`\n❌ self-test: ${failures} case(s) failed`);
    process.exit(1);
  }
  console.log('\n✅ self-test: every check fails on its own mutation');
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  // A tracked file that has been deleted should fail here rather than be silently skipped.
  const tracked = execFileSync('git', ['ls-files', '--error-unmatch', ...Object.values(SITES)], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (tracked.split('\n').filter(Boolean).length !== Object.keys(SITES).length) {
    console.error('❌ operator drift: a declared site is no longer tracked');
    process.exit(1);
  }

  const registryText = readFileSync(REGISTRY, 'utf8');
  const operator = loadFrameworkOperator(registryText);
  const problems = [
    ...runChecks(operator, loadSources()),
    ...checkPythonEngineAgreement(registryText),
    ...checkExamplesMatchOwnPattern(registryText),
  ];

  if (problems.length > 0) {
    console.error('❌ Operator registry drift — hand-written copies disagree with operators.json:');
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error(
      '\noperators.json is the SSOT. Update the site, not the registry, unless the registry is ' +
        'the thing that is wrong.'
    );
    process.exit(1);
  }

  console.log(
    `✅ Operator registry: ${Object.keys(SITES).length} hand-written copies agree with operators.json; every operator matches its own examples`
  );
}

main();
