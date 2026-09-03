#!/usr/bin/env node
/**
 * A resource lifecycle handler that WRITES must also REGISTER what it wrote — by a route this
 * file names, per processor.
 *
 * WHY THIS EXISTS. Twice in two days the same defect shipped: a `create`/`update` wrote correct,
 * durable files to disk, reported success, and asserted `🔄 registry reloaded` while nothing
 * reloaded. The resource was then unreachable to `inspect`, `update`, `history`, `reload` and
 * `delete` in the process that made it, until the next server restart — and the two causes an
 * operator would naturally suspect, a wrong id and a failed write, were both wrong, with the file
 * on disk proving the write had worked. Gates: `b7102dd9`. Frameworks: the `update`/`reload` half
 * of `plans/reference/technical-debt/framework-resource-lifecycle-2026-08-18.md`.
 *
 * Both times the awaited `onRefresh()` was the decoy. It resolves to the application's FULL SERVER
 * REFRESH, which reloads prompt data — so for prompts it genuinely IS the registration, and for
 * gates and frameworks it is a call that returns without touching their registries.
 *
 * THE ASYMMETRY IS THE WHOLE DESIGN PROBLEM, and getting it wrong makes this gate a placebo.
 * `await onRefresh()` is SUFFICIENT for prompts and INSUFFICIENT for gates and frameworks. A gate
 * that simply demanded an explicit `reload(id)` everywhere would red correct prompt code, and the
 * fix for a false positive is an exception — which is the drift mode that outlives its reason. So
 * the rule is PER PROCESSOR and DECLARED below, and the prompt entry carries WHY `onRefresh`
 * counts there.
 *
 * FOUR DRIFT MODES, four countermeasures — this list is the spec, not commentary:
 *
 *   1. Handler renamed away from `handleCreate` → SILENT PASS.
 *      Countermeasure: EDGE-RESOLVED, never name-keyed. Nothing here greps for `handleCreate`.
 *      The method name is read off the router's own `switch (action)` dispatch, and the processor
 *      file is resolved from `this.<field> = new <Class>(…)` to that class's import specifier.
 *      Rename the method and the edge still resolves; delete the dispatch and the processor
 *      becomes undiscovered, which is its own finding. Name-keyed checks in this repo were wrong
 *      3/3 (`feedback_homonym_false_consumer`).
 *
 *   2. Registration moved into a helper → FALSE POSITIVE → an exception gets added → it outlives
 *      its reason. Countermeasure (a): the reachable text of a handler is its own body PLUS the
 *      bodies of the same-file `this.helper(…)` methods it calls, one hop. That is why
 *      `handleCreate` passes today — its registration lives in `createFrameworkAtomic`, and no
 *      exception was needed to say so. Countermeasure (b): every exception that remains carries
 *      `closedBy` AND is audited by `lib/exception-hygiene.js`, which FAILS on an entry whose
 *      condition no longer holds.
 *
 *   3. A 4TH RESOURCE TYPE in a file the rules do not cover → SILENT PASS, precisely the case this
 *      gate exists for. Countermeasure: SET-EQUALITY, not spot-checks, over TWO independent
 *      enumerations — every `*-lifecycle-processor.ts` under `src/mcp/tools/`, and every processor
 *      any router dispatches a mutating action to. A file in either set with no rule is a loud
 *      "classify this file", and a rule naming neither is a stale rule. Same shape as
 *      `validate-table-contracts.js` against the embedded DDL.
 *
 *   4. Registration through a path this cannot see → not preventable by static shape. Backstopped
 *      behaviourally by `tests/integration/mcp-tools/gate-framework-versioning.integration.test.ts`
 *      (`gate registry coherence` and `framework registry coherence`), whose harnesses wire
 *      `onRefresh` to a COUNTER so a double cannot be more capable than production.
 *
 * WHAT IS DELIBERATELY EXCLUDED, and why that does not weaken the set-equality:
 * `src/engine/execution/pipeline/stages/02-execution-lifecycle-stage.ts` and
 * `src/runtime/telemetry-lifecycle.ts` match a naive `*lifecycle*` glob and are NOT resource
 * lifecycle processors — neither writes a resource nor owns a registry. They are excluded
 * STRUCTURALLY, by both of the enumerations above: neither lives under `src/mcp/tools/`, neither
 * is named `*-lifecycle-processor.ts`, and no router dispatches a resource action to either. No
 * allowlist names them, so no entry can rot; `--self-test` asserts they stay out of the universe.
 *
 * MECHANISM: script — relation — resolves dispatch edges across router and processor files; no
 * linter sees more than one file.
 *
 * Usage: node server/scripts/validate-registry-coherence.js [--self-test]
 * Exit: 0 = coherent, 1 = one or more findings
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SERVER = path.resolve(path.dirname(SCRIPT_PATH), '..');
const TOOLS_DIR = path.join(SERVER, 'src', 'mcp', 'tools');

/** Actions that change resource state on disk, and therefore owe a registry consequence. */
// `rollback` is here because it writes `framework.yaml` through the same file service as
// `update`. Its absence was measured on 2026-08-18: this gate went green while
// `framework-versioning-processor.ts` awaited a no-op `onRefresh` and asserted
// `🔄 Framework registry reloaded` — the exact string deleted from `update` in `d5eaa6a1`. The
// gate's own success line then claimed "every mutating dispatch edge", which was true only under
// this constant's definition of mutating. A scope that excludes a writer is a green run about a
// question nobody asked.
const MUTATING_ACTIONS = ['create', 'update', 'delete', 'reload', 'rollback'];

/**
 * Per-processor registration rules. One entry per resource lifecycle processor; `actions` names,
 * for each mutating action, the call(s) that constitute registration FOR THAT RESOURCE.
 *
 * `why` is required on every entry and is not decoration — it is where the asymmetry is written
 * down. An entry claiming `onRefresh` is sufficient must say what makes it sufficient there.
 */
const RULES = {
  'src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts': {
    resource: 'prompt',
    why:
      'For PROMPTS ONLY, `onRefresh` IS the registration. It resolves to the application full ' +
      'server refresh, whose job is reloading prompt data — so the prompt path is correct as ' +
      'written, and demanding an explicit per-id reload here would red working code. This entry ' +
      'exists so that fact is declared rather than inferred.',
    actions: {
      create: ['onRefresh'],
      update: ['onRefresh'],
      delete: ['onRefresh'],
    },
  },
  'src/mcp/tools/gate-manager/services/gate-lifecycle-processor.ts': {
    resource: 'gate',
    why:
      '`onRefresh` reloads prompt data and never touches the gate registry, so each handler must ' +
      'name the id it wrote. Established by `b7102dd9`, which is the defect this gate generalises.',
    actions: {
      create: ['gateManager.reload('],
      update: ['gateManager.reload('],
      delete: ['gateManager.unregister(', 'unregister('],
      reload: ['gateManager.reload('],
    },
  },
  'src/mcp/tools/gate-manager/services/gate-versioning-processor.ts': {
    resource: 'gate',
    why:
      'Same as the gate lifecycle processor — `onRefresh` never touches the gate registry, so ' +
      '`rollback` names the id it rewrote.',
    actions: {
      rollback: ['gateManager.reload('],
    },
  },
  'src/mcp/tools/resource-manager/prompt/services/prompt-versioning-processor.ts': {
    resource: 'prompt',
    why:
      'For PROMPTS ONLY, `onRefresh` IS the registration — it resolves to the full server ' +
      'refresh, whose job is reloading prompt data. Same reasoning as the prompt lifecycle ' +
      'processor entry; declared so the difference from gates and frameworks is stated, not ' +
      'inferred from its absence.',
    actions: {
      rollback: ['onRefresh'],
    },
  },
  'src/mcp/tools/framework-manager/services/framework-versioning-processor.ts': {
    resource: 'framework',
    why:
      '`rollback` writes `framework.yaml` through the same file service as `update`, so it owes ' +
      'the same registry consequence. It shares `reregisterFramework` with the lifecycle ' +
      'processor rather than holding a private copy: the private copy is exactly how this path ' +
      'was missed when `update` and `reload` were fixed.',
    actions: {
      rollback: ['reregisterFramework('],
    },
  },
  'src/mcp/tools/framework-manager/services/framework-lifecycle-processor.ts': {
    resource: 'framework',
    why:
      'Same as gates: this tool`s `onRefresh` is a `logger.debug` (`src/mcp/tools/index.ts`), so ' +
      'nothing registers unless a handler says so. `create` registers inside ' +
      '`createFrameworkAtomic`, reached by the one-hop helper resolution; `update` and `reload` ' +
      'go through `reregister`, which clears the runtime loader cache FIRST — without that, a ' +
      're-register re-serves the pre-edit content the loader already holds.',
    actions: {
      create: ['registerFramework('],
      update: ['this.reregister(', 'reregisterFramework('],
      delete: ['frameworkManager.unregister(', 'unregister('],
      reload: ['this.reregister(', 'reregisterFramework('],
    },
  },
};

/**
 * Mutating dispatch edges that do NOT reach a lifecycle processor.
 *
 * A router may handle an action inline (`this.method(args)` with no service field). Those edges
 * fall outside the per-processor rules above, so each one is declared here or the run fails —
 * otherwise a fourth resource type could be added entirely inside a router and never be seen.
 */
const HANDLER_LOCAL_MUTATIONS = [
  {
    router: 'src/mcp/tools/resource-manager/prompt/prompt-resource-handler.ts',
    action: 'reload',
    method: 'reloadPrompts',
    reason:
      'Prompt reload is handled on the router itself and awaits `dependencies.onRefresh()`, ' +
      'which for prompts IS the reload — the same reason the prompt processor entry gives. It ' +
      'writes nothing, so there is no write-without-register hazard to check.',
    closedBy: 'prompt reload moving onto a lifecycle processor, at which point RULES covers it',
  },
];

// ── Source loading ───────────────────────────────────────────────────────────

/** Recursively collect files under `dir` matching `test(name)`. */
function walk(dir, test) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, test);
    return test(entry.name) ? [full] : [];
  });
}

/** Every `.ts` file under `src/mcp/tools/`, keyed by repo-relative path. */
function loadToolSources() {
  const sources = new Map();
  for (const file of walk(TOOLS_DIR, (name) => name.endsWith('.ts'))) {
    sources.set(toRelative(file), readFileSync(file, 'utf8'));
  }
  return sources;
}

function toRelative(absolute) {
  return path.relative(SERVER, absolute).split(path.sep).join('/');
}

// ── Edge resolution (drift mode 1) ───────────────────────────────────────────

/**
 * The `switch (action)` segments of a router, as `{ action, segment }`.
 *
 * Returns [] for a file with no such switch, which is how non-routers are excluded — by shape,
 * not by a filename convention that a rename would break.
 */
function switchSegments(rawText) {
  // Comments are stripped first. A doc comment that QUOTES `switch (action)` while explaining it
  // moves the scan's starting point to the comment, so the gate reads the prose above a dispatch
  // table instead of the table. Found 2026-09-03 by this gate's own mutation fixture, which
  // reported 'no findings' after correctly mutating the real statement — the comment above it
  // kept the pattern satisfied. A scanner that cannot tell code from prose about code is the same
  // defect class this file exists to catch.
  const text = rawText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  // `switch (action)` AND `switch (args.action)`. Requiring only the first silently dropped the
  // entire gate router from the universe on this gate's own first run, while `byName` still
  // classified its processor — the exact silent pass this file exists to prevent, found in the
  // file preventing it. The missing-edge finding below is the structural fix; this pattern is the
  // immediate one.
  //
  // As of P2.2 all three routers spell it `switch (action)`, so the `args.action` arm currently
  // has no live subject. Kept rather than narrowed: the reason it exists is that the spelling
  // varies, and it has now varied twice in the other direction.
  const switchIndex = text.search(/switch\s*\(\s*(?:\w+\.)?action\s*\)/);
  if (switchIndex < 0) return [];

  const body = text.slice(switchIndex);
  const cases = [...body.matchAll(/case\s+'([\w_]+)'\s*:/g)];

  return cases.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < cases.length ? cases[index + 1].index : body.length;
    return { action: match[1], segment: body.slice(start, end) };
  });
}

/**
 * The dispatch target of one case segment: `{ field, method }` for `this.svc.doThing(`, or
 * `{ field: null, method }` for a router-local `this.doThing(`.
 */
function dispatchTarget(segment) {
  const delegated = segment.match(/this\.(\w+)\.(\w+)\s*\(/);
  if (delegated !== null) return { field: delegated[1], method: delegated[2] };
  const local = segment.match(/this\.(\w+)\s*\(/);
  if (local !== null) return { field: null, method: local[1] };
  return null;
}

/** `this.<field> = new <Class>(` → the class name the field holds. */
function fieldClass(text, field) {
  const assigned = text.match(new RegExp(`this\\.${field}\\s*=\\s*new\\s+(\\w+)\\s*\\(`));
  return assigned?.[1] ?? null;
}

/** `import { Class } from '<specifier>'` → the repo-relative `.ts` path it names. */
function importedPath(routerRelative, text, className) {
  const pattern = new RegExp(
    `import\\s*\\{[^}]*\\b${className}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`
  );
  const specifier = text.match(pattern)?.[1];
  if (specifier === undefined || !specifier.startsWith('.')) return null;
  const resolved = path.posix.join(path.posix.dirname(routerRelative), specifier);
  return resolved.replace(/\.js$/, '.ts');
}

/**
 * Every mutating dispatch edge across every router, resolved to a processor file where one
 * exists.
 */
function resolveEdges(sources) {
  const edges = [];

  for (const [routerRelative, text] of sources) {
    for (const { action, segment } of switchSegments(text)) {
      if (!MUTATING_ACTIONS.includes(action)) continue;

      const target = dispatchTarget(segment);
      if (target === null) {
        edges.push({ router: routerRelative, action, processor: null, method: null });
        continue;
      }
      if (target.field === null) {
        edges.push({
          router: routerRelative,
          action,
          processor: null,
          method: target.method,
          handlerLocal: true,
        });
        continue;
      }

      const className = fieldClass(text, target.field);
      const processor = className === null ? null : importedPath(routerRelative, text, className);
      edges.push({ router: routerRelative, action, processor, method: target.method });
    }
  }

  return edges;
}

// ── Reachable text (drift mode 2a) ───────────────────────────────────────────

/**
 * The `{…}` block whose opening brace is the first one at or after `from` that starts a LINE of
 * body — `{` followed by end-of-line.
 *
 * The naive "first `{`" latches onto a return-type object literal instead:
 * `private async createFrameworkAtomic(…): Promise<{ success: boolean; … }> {` would yield the
 * type, not the method, and the registration inside it would read as absent. Method bodies in
 * this codebase always open with `{\n`; inline type literals do not. A wrong extraction here
 * produces a FALSE ALARM (patterns not found → finding), never false silence.
 */
function blockAt(text, from) {
  const open = text.slice(from).search(/\{[ \t]*\r?\n/);
  if (open < 0) return '';
  return braceMatch(text, from + open);
}

/** The `{…}` block opening exactly at `open`, brace-matched. */
function braceMatch(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return '';
}

/** The body of `<method>(…) {…}` declared in `text`, or '' when it is not declared there. */
function methodBody(text, method) {
  const declaration = new RegExp(
    `(?:^|\\n)\\s*(?:private\\s+|public\\s+|protected\\s+)?(?:async\\s+)?${method}\\s*[(<]`
  );
  const match = text.match(declaration);
  if (match === null || match.index === undefined) return '';
  return blockAt(text, match.index + match[0].length - 1);
}

/**
 * A handler's own body plus the bodies of the same-file `this.helper(…)` methods it calls — one
 * hop. Registration legitimately lives in a helper (`createFrameworkAtomic`), and requiring it in
 * the handler body would red correct code and buy an exception nobody would ever retire. One hop
 * covers every processor here; a future two-hop arrangement reds loudly, which is the intent.
 */
function reachableText(text, method) {
  const body = methodBody(text, method);
  if (body === '') return '';

  const helpers = new Set([...body.matchAll(/this\.(\w+)\s*\(/g)].map((match) => match[1]));
  let combined = body;
  for (const helper of helpers) {
    if (helper === method) continue;
    combined += `\n${methodBody(text, helper)}`;
  }
  return combined;
}

// ── The check ────────────────────────────────────────────────────────────────

/** Files that LOOK like resource lifecycle processors by name, under the tool layer only. */
function processorFilesByName(sources) {
  return [...sources.keys()].filter((file) => file.endsWith('-lifecycle-processor.ts')).sort();
}

function check(sources, rules = RULES, handlerLocal = HANDLER_LOCAL_MUTATIONS) {
  const findings = [];
  const edges = resolveEdges(sources);

  const declared = new Set(Object.keys(rules));
  const byName = new Set(processorFilesByName(sources));
  const byEdge = new Set(edges.map((edge) => edge.processor).filter((file) => file !== null));

  // Set-equality, direction 1 — a processor nothing classifies (drift mode 3).
  for (const file of [...byName, ...byEdge].sort()) {
    if (declared.has(file)) continue;
    findings.push(
      `unclassified resource lifecycle processor: ${file} — add a RULES entry naming, per ` +
        'mutating action, what registration means for this resource'
    );
  }

  // Set-equality, direction 2 — a rule whose subject no longer exists anywhere.
  for (const file of [...declared].sort()) {
    if (byName.has(file) || byEdge.has(file)) continue;
    findings.push(
      `stale RULES entry: ${file} — no such processor is dispatched to, and no file of that ` +
        'name exists under src/mcp/tools/'
    );
  }

  // Set-equality, direction 3 — a classified processor NO dispatch edge reaches.
  //
  // Without this the gate passes vacuously on a processor it can no longer see: it stays in
  // `byName`, so it is never "unclassified", and it has no edges, so no registration is ever
  // checked. Measured on this gate's own first run — `switch (args.action)` did not match the
  // pattern, the whole gate router dropped out of the universe, and the run went green with the
  // gate's registration rules never evaluated once.
  for (const [file, rule] of Object.entries(rules)) {
    if (byEdge.has(file)) continue;
    if (!byName.has(file)) continue; // already reported as a stale rule above
    findings.push(
      `unreached processor: ${file} declares registration routes for ` +
        `[${Object.keys(rule.actions).join(', ')}] but no router dispatch resolves to it — the ` +
        'gate cannot see this file, so its rules are being evaluated zero times'
    );
  }

  // Set-equality, direction 4 — a mutating dispatch that reaches no processor at all.
  const declaredLocal = new Map(
    handlerLocal.map((entry) => [`${entry.router}:${entry.action}`, entry])
  );
  for (const edge of edges) {
    if (edge.processor !== null) continue;
    const key = `${edge.router}:${edge.action}`;
    if (declaredLocal.has(key)) continue;
    findings.push(
      `undeclared handler-local mutation: ${key} dispatches to ` +
        `${edge.method === null ? '(unresolvable)' : `this.${edge.method}()`} and reaches no ` +
        'lifecycle processor — declare it in HANDLER_LOCAL_MUTATIONS or route it to a processor'
    );
  }

  // The registration requirement itself, per resolved edge.
  for (const edge of edges) {
    if (edge.processor === null) continue;
    const rule = rules[edge.processor];
    if (rule === undefined) continue; // already reported as unclassified above

    const patterns = rule.actions[edge.action];
    if (patterns === undefined) {
      findings.push(
        `${rule.resource}:${edge.action} — dispatched to ${edge.method}() but the RULES entry ` +
          `for ${edge.processor} declares no registration route for '${edge.action}'`
      );
      continue;
    }

    const text = sources.get(edge.processor);
    if (text === undefined) {
      findings.push(
        `${rule.resource}:${edge.action} — processor source not readable: ${edge.processor}`
      );
      continue;
    }

    const reachable = reachableText(text, edge.method);
    if (reachable === '') {
      findings.push(
        `${rule.resource}:${edge.action} — the router dispatches to ${edge.method}(), which is ` +
          `not declared in ${edge.processor}`
      );
      continue;
    }

    if (!patterns.some((pattern) => reachable.includes(pattern))) {
      findings.push(
        `${rule.resource}:${edge.action} — ${edge.method}() writes but does not register: none ` +
          `of [${patterns.join(', ')}] is reachable from it (own body + one hop). ` +
          // No fixed claim about onRefresh here: for prompts `onRefresh` IS the registration, so
          // the old prefix rendered as "Awaiting onRefresh() is NOT registration here — For
          // PROMPTS ONLY, `onRefresh` IS the registration." Let the rule's own `why` speak.
          `Registration here means one of those patterns — ${rule.why}`
      );
    }
  }

  // Every rule must say why its route counts. An entry without one cannot be reviewed.
  for (const [file, rule] of Object.entries(rules)) {
    if (typeof rule.why !== 'string' || rule.why.trim() === '') {
      findings.push(
        `RULES entry ${file} has no \`why\` — the asymmetry it encodes is unreviewable`
      );
    }
  }

  return { findings, edges, byName: [...byName].sort(), byEdge: [...byEdge].sort() };
}

/** Exception hygiene for HANDLER_LOCAL_MUTATIONS (drift mode 2b). */
function auditHandlerLocal(sources, handlerLocal = HANDLER_LOCAL_MUTATIONS) {
  const edges = resolveEdges(sources);
  const localKeys = new Set(
    edges.filter((edge) => edge.processor === null).map((edge) => `${edge.router}:${edge.action}`)
  );
  const routedKeys = new Set(
    edges.filter((edge) => edge.processor !== null).map((edge) => `${edge.router}:${edge.action}`)
  );

  return auditExceptions({
    gate: 'validate-registry-coherence',
    entries: handlerLocal,
    describe: (entry) => `${entry.router}:${entry.action}`,
    closedBy: (entry) => entry.closedBy,
    classify: (entry) => {
      const key = `${entry.router}:${entry.action}`;
      if (routedKeys.has(key)) {
        return {
          verdict: VERDICT.SATISFIED,
          detail: 'this action now dispatches to a lifecycle processor, so RULES covers it',
        };
      }
      if (!sources.has(entry.router)) {
        return { verdict: VERDICT.SUBJECT_MISSING, detail: 'no such router file' };
      }
      if (!localKeys.has(key)) {
        return { verdict: VERDICT.SUBJECT_MISSING, detail: 'no such mutating dispatch edge' };
      }
      return { verdict: VERDICT.LOAD_BEARING };
    },
  });
}

// ── Self-test (drift mode: the gate itself stops detecting) ──────────────────

/** Every rule must be shown to fail on its own mutation before any of them is trusted to pass. */
function selfTest() {
  console.log(
    '\nvalidate:registry-coherence self-test — every rule must fail on its own mutation\n'
  );
  let failures = 0;

  const clean = loadToolSources();

  const record = (label, ok, detail) => {
    if (ok) console.log(`  ✓ ${label}${detail === undefined ? '' : ` — ${detail}`}`);
    else {
      console.error(`  ✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`);
      failures += 1;
    }
  };

  // 0. A clean tree reports nothing. Without this, every case below could pass on a gate that
  //    fires unconditionally.
  {
    const { findings, byEdge } = check(clean);
    record('a clean tree reports no findings', findings.length === 0, findings.join(' | '));
    record(
      'the dispatch scan resolves every declared processor',
      byEdge.length === Object.keys(RULES).length,
      `resolved: ${byEdge.join(', ')}`
    );
  }

  // 1. Removing a real registration call reds it — once per resource that requires an explicit
  //    one, so neither the gate nor the framework rule can quietly stop firing.
  for (const [file, marker] of [
    [
      'src/mcp/tools/gate-manager/services/gate-lifecycle-processor.ts',
      'this.ctx.gateManager.reload(id)',
    ],
    [
      'src/mcp/tools/framework-manager/services/framework-lifecycle-processor.ts',
      'await this.reregister(id)',
    ],
  ]) {
    const original = clean.get(file);
    if (original === undefined || !original.includes(marker)) {
      record(`removed-registration fixture: ${file}`, false, `marker not found: ${marker}`);
      continue;
    }
    const mutated = new Map(clean);
    mutated.set(file, original.split(marker).join('await Promise.resolve(true)'));
    const { findings } = check(mutated);
    record(
      `removing '${marker}' reds the gate`,
      findings.some((finding) => finding.includes('writes but does not register')),
      findings.length === 0 ? 'no findings at all' : findings[0]
    );
  }

  // 2. A NEW, unclassified lifecycle processor reds it — drift mode 3, the case this gate exists
  //    for. Both enumerations are exercised: by NAME here, by EDGE in case 3.
  {
    const mutated = new Map(clean);
    mutated.set(
      'src/mcp/tools/style-manager/services/style-lifecycle-processor.ts',
      'export class StyleLifecycleProcessor { async handleCreate() { return null; } }'
    );
    const { findings } = check(mutated);
    record(
      'an unclassified *-lifecycle-processor.ts file reds the gate',
      findings.some((finding) => finding.includes('unclassified resource lifecycle processor')),
      findings.join(' | ') || 'no findings'
    );
  }

  // 3. A 4th resource dispatched from a router, in a file the NAME glob does not match. Caught by
  //    the edge enumeration alone — which is the half that survives a rename.
  {
    const mutated = new Map(clean);
    mutated.set(
      'src/mcp/tools/style-manager/core/manager.ts',
      [
        "import { StyleCrud } from '../services/style-crud.js';",
        'export class StyleToolHandler {',
        '  private readonly styles: StyleCrud;',
        '  constructor() { this.styles = new StyleCrud(); }',
        '  async handleAction(args) {',
        '    switch (action) {',
        "      case 'create':",
        '        return await this.styles.makeStyle(args);',
        '      default:',
        '        return null;',
        '    }',
        '  }',
        '}',
      ].join('\n')
    );
    mutated.set(
      'src/mcp/tools/style-manager/services/style-crud.ts',
      'export class StyleCrud { async makeStyle() { return null; } }'
    );
    const { findings } = check(mutated);
    record(
      'a 4th resource whose processor file is NOT named *-lifecycle-processor.ts still reds',
      findings.some((finding) =>
        finding.includes(
          'unclassified resource lifecycle processor: src/mcp/tools/style-manager/services/style-crud.ts'
        )
      ),
      findings.join(' | ') || 'no findings'
    );
  }

  // 3b. A processor the dispatch scan can no longer REACH must red, not pass vacuously. This is
  //     the gate's own first-run failure, encoded: `switch (args.action)` did not match the
  //     pattern, the gate router vanished from the universe, and the run reported success with
  //     the gate rules evaluated zero times.
  //
  //     The fixture reads whichever spelling the gate router currently uses rather than pinning
  //     one, because the spelling has now moved twice. It became `switch (action)` when `preview`
  //     was added (P2.2) and the resolved dispatch target had to be bound to a local — and the
  //     fixture, pinned to the other spelling, failed CLOSED with 'not found', which is the right
  //     direction but still an unrun case. Reading the live spelling keeps the case exercised;
  //     failing when NEITHER is present keeps it honest.
  {
    const file = 'src/mcp/tools/gate-manager/core/manager.ts';
    const original = clean.get(file);
    //     Anchored to STATEMENT position (start of line), not to the bare substring. Replacing
    //     the first textual occurrence hit a doc comment that quoted the anchor while explaining
    //     it, so the real switch survived, the gate found everything, and the case reported
    //     'no findings' — a mutation test that mutated nothing.
    const STATEMENT = /^(\s*)switch \((?:args\.)?action\) \{/m;
    if (original === undefined || !STATEMENT.test(original)) {
      record(
        'unreached-processor fixture',
        false,
        'no switch (action) statement found in the gate router'
      );
    } else {
      const mutated = new Map(clean);
      mutated.set(file, original.replace(STATEMENT, '$1switch (someOtherThing) {'));
      const { findings } = check(mutated);
      record(
        'a processor no dispatch edge reaches reds the gate (no vacuous pass)',
        findings.some((finding) => finding.includes('unreached processor')),
        findings.join(' | ') || 'no findings'
      );
    }
  }

  // 4. A router that handles a mutating action inline, undeclared.
  {
    const mutated = new Map(clean);
    mutated.set(
      'src/mcp/tools/style-manager/core/manager.ts',
      [
        'export class StyleToolHandler {',
        '  async handleAction(args) {',
        '    switch (action) {',
        "      case 'delete':",
        '        return await this.deleteStyleInline(args);',
        '      default:',
        '        return null;',
        '    }',
        '  }',
        '}',
      ].join('\n')
    );
    const { findings } = check(mutated);
    record(
      'an undeclared handler-local mutating dispatch reds the gate',
      findings.some((finding) => finding.includes('undeclared handler-local mutation')),
      findings.join(' | ') || 'no findings'
    );
  }

  // 5. The prompt rule must be REAL, not a rubber stamp: strip prompt create's refresh and it
  //    reds too. Otherwise `onRefresh` as a sanctioned route would be indistinguishable from an
  //    exemption, and the asymmetry this file documents would be unenforced on one side.
  {
    const file = 'src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts';
    const original = clean.get(file);
    const marker = 'await this.context.dependencies.onRefresh();';
    if (original === undefined || !original.includes(marker)) {
      record('prompt-refresh fixture', false, `marker not found: ${marker}`);
    } else {
      const mutated = new Map(clean);
      mutated.set(file, original.split(marker).join('await Promise.resolve();'));
      const { findings } = check(mutated);
      record(
        'removing the prompt refresh reds the gate too (the prompt rule is enforced, not exempt)',
        findings.some((finding) => finding.includes('writes but does not register')),
        findings.join(' | ') || 'no findings'
      );
    }
  }

  // 6. Exception hygiene fires when an entry stops being true, in both directions.
  {
    const audit = auditHandlerLocal(clean);
    record(
      'every declared handler-local exception is currently load-bearing',
      audit.problems.length === 0,
      audit.problems.map((problem) => problem.message).join(' | ')
    );

    const bogus = [
      {
        router: 'src/mcp/tools/nope/handler.ts',
        action: 'create',
        method: 'x',
        reason: 'r',
        closedBy: 'c',
      },
    ];
    record(
      'an exception naming a router that does not exist is reported',
      auditHandlerLocal(clean, bogus).problems.length > 0
    );

    const noExit = [{ ...HANDLER_LOCAL_MUTATIONS[0], closedBy: '' }];
    record(
      'an exception with no closedBy is reported',
      auditHandlerLocal(clean, noExit).problems.some((problem) =>
        problem.message.includes('no closedBy')
      )
    );
  }

  // 7. The two non-resource `*lifecycle*` files stay structurally out of the universe. Asserted
  //    against their real paths so the claim is falsifiable, and asserted as EXCLUSION rather than
  //    as an allowlist entry — an allowlist would be one more thing to rot.
  {
    const decoys = [
      'src/engine/execution/pipeline/stages/02-execution-lifecycle-stage.ts',
      'src/runtime/telemetry-lifecycle.ts',
    ];
    const present = decoys.filter((file) => existsSync(path.join(SERVER, file)));
    record(
      'both naive-glob decoys still exist on disk (the exclusion has a subject)',
      present.length === decoys.length,
      `found: ${present.join(', ')}`
    );
    const { byName, byEdge } = check(clean);
    record(
      'neither decoy is in the universe',
      decoys.every((file) => !byName.includes(file) && !byEdge.includes(file))
    );
  }

  if (failures > 0) {
    console.error(`\n❌ self-test: ${failures} case(s) failed`);
    process.exit(1);
  }
  console.log(
    '\n✅ self-test: every rule fails on its own mutation, and none fires on a clean tree'
  );
}

// ── Entry point ──────────────────────────────────────────────────────────────

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const sources = loadToolSources();
  const { findings, byEdge, edges } = check(sources);
  const audit = auditHandlerLocal(sources);

  // `--list` prints the resolved universe. A gate whose scan silently narrows reads as coverage,
  // so what it saw must be inspectable without editing it.
  if (process.argv.includes('--list')) {
    for (const edge of edges) {
      console.log(
        `${edge.router} :: ${edge.action} -> ${edge.method ?? '(unresolved)'} @ ${edge.processor ?? '(handler-local)'}`
      );
    }
  }

  if (findings.length > 0) {
    // Deliberately generic. This header used to read 'a lifecycle handler writes without
    // registering', which is true of ONE of the five finding classes — the others are stale
    // rules, unclassified processors, unreached processors and missing `why`s, none of which
    // involve a handler writing anything. A gate that mislabels its own result is the defect one
    // layer up from the one it checks for.
    console.error(`❌ Registry coherence: ${findings.length} finding(s)`);
    for (const finding of findings) console.error(`  • ${finding}`);
    if (findings.some((finding) => finding.includes('writes but does not register'))) {
      console.error(
        '\nA resource written to disk and not registered is unreachable to every subsequent ' +
          'action in the process that made it, while the handler reports success. Register the ' +
          'id you just wrote, or declare the route in RULES with a `why`. If the write is ' +
          'handled on the router rather than a processor, declare it in ' +
          'HANDLER_LOCAL_MUTATIONS with a `closedBy`.'
      );
    }
  }

  const auditProblems = reportExceptionAudit('validate-registry-coherence', audit);

  if (findings.length > 0 || auditProblems > 0) process.exit(1);

  // Names the scope rather than claiming "every mutating edge". The unqualified phrasing was
  // true only under MUTATING_ACTIONS' own definition of mutating, and that constant excluded
  // `rollback` while a rollback handler wrote files and claimed a refresh it never performed.
  console.log(
    `✅ Registry coherence: ${byEdge.length} lifecycle processors; every ` +
      `${MUTATING_ACTIONS.join('/')} edge reaching a processor registers by its declared route ` +
      `(${Object.keys(HANDLER_LOCAL_MUTATIONS).length} declared handler-local edge(s), which are ` +
      'declared rather than verified)'
  );
}

main();
