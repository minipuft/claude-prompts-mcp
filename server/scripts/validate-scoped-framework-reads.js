#!/usr/bin/env node

/**
 * Fails a framework-state read that names no scope where a request's scope exists.
 *
 * THE CLASS. Under Streamable HTTP a workspace header makes the request its own tenant (owner
 * ruling R94, rows P4.129–P4.132): its own active framework, enabled flag and switch history.
 * `FrameworkStateStore` answers every read for a scope, and falls back to the LAUNCH workspace when
 * a caller passes none. So a scope-less read never fails — it silently answers for the wrong
 * tenant. That is exactly how `prompt_engine` rendered the launch workspace's framework under every
 * header while `status` reported the header's own (measured 2026-09-22): about ten reads on the
 * execution path passed no scope, each correct under STDIO, where there is only one workspace.
 *
 * WHAT COUNTS AS A FINDING: a call to one of the scoped reads below that omits its scope argument,
 * or passes an object literal with no `scope` key where the scope travels inside an options
 * object. The callee is resolved through the type checker, not by name, so a same-named method on
 * another class (`GateStateStore.getCurrentState`, `PromptGuidanceService`'s private
 * `getActiveFramework`) is neither a finding nor a false pass.
 *
 * WHAT IS NOT SCANNED: `FrameworkStateStore`'s own file. Its internal reads run at startup and on
 * behalf of the process's own workspace, where the launch scope is the correct answer.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH (as of 2026-09-22 · flips when any of these shapes appears):
 *   - a scope argument that is present but wrong (e.g. `undefined` passed explicitly, or the launch
 *     scope handed over where the request's was available). The predicate is presence, not value;
 *     the e2e `http-workspace-header-scope` drives the values.
 *   - an options object built across statements and passed as a variable. Accepted as-is: the
 *     predicate only reads literals.
 *
 * A green run is not a run that reached nothing: the scan fails closed unless it saw at least
 * `MINIMUM_SCOPED_CALLS` compliant calls.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'validate:scoped-framework-reads';

const STORE_FILE = path.join('src', 'engine', 'frameworks', 'framework-state-store.ts');

/**
 * `Owner.method` → how its scope is passed. `arg` is the argument index; `inOptions` means that
 * argument is an options object whose `scope` key carries it.
 */
const SCOPED_READS = new Map([
  ...['FrameworkStateStore', 'FrameworkStateAccessor'].flatMap((owner) => [
    [`${owner}.getActiveFramework`, { arg: 0 }],
    [`${owner}.isFrameworkSystemEnabled`, { arg: 0 }],
    [`${owner}.getCurrentState`, { arg: 0 }],
    [`${owner}.getSystemHealth`, { arg: 0 }],
    [`${owner}.getSwitchHistory`, { arg: 1 }],
  ]),
  ['FrameworkManager.selectFramework', { arg: 0, inOptions: true }],
  ['FrameworkManager.generateExecutionContext', { arg: 1, inOptions: true }],
  ['PromptGuidanceService.applyGuidance', { arg: 1, inOptions: true }],
  ['ChainOperatorExecutor.renderStep', { arg: 0, inOptions: true }],
]);

/*
 * The stage-07/12 enabled check and `GateEnhancementService`'s active-framework lookup are
 * provider callbacks, not listed here: their types take the scope as a REQUIRED parameter
 * (`(scope: StateStoreOptions | undefined) => …`), so the compiler already refuses a caller that
 * omits it.
 */

/**
 * Reads that answer for the launch workspace on purpose. Each states why no request scope exists
 * there, and what would retire it.
 */
const ACCEPTED = [
  {
    subject: 'src/engine/frameworks/framework-manager.ts',
    fn: 'getResourceStats',
    reason:
      '`BaseResourceHandler` statistics: a process-wide summary its protocol computes with no ' +
      'caller in hand.',
    closedBy:
      'Delete when resource handler stats take a scope, or stop reporting the active framework.',
  },
  {
    subject: 'src/engine/frameworks/framework-manager.ts',
    fn: 'isSystemEnabled',
    reason:
      'Overrides `BaseResourceHandler.isSystemEnabled()`, a zero-argument protocol method shared ' +
      'with `GateManager`; no execution-path caller reaches it (stage 07/12 read the scoped provider).',
    closedBy: 'Delete when the base protocol method takes a scope.',
  },
  {
    subject: 'src/mcp/tools/tool-description-loader.ts',
    fn: 'getActiveFrameworkContext',
    reason:
      'Feeds a process-wide description cache rebuilt on framework events. Per-request ' +
      'descriptions come from `McpToolRouter.registerAllTools(target, scope)`, which reads the ' +
      "serving unit's own scope and overlays the framework per call.",
    closedBy:
      'Delete when the description cache is keyed by scope (or removed in favour of the per-call overlay).',
  },
];

/** Below this, the scan is not reaching the code it governs. */
const MINIMUM_SCOPED_CALLS = 15;

function enclosingFunctionName(node) {
  const fn = node.getFirstAncestor((a) =>
    [
      SyntaxKind.MethodDeclaration,
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.Constructor,
      SyntaxKind.GetAccessor,
    ].includes(a.getKind())
  );
  if (fn === undefined) return '<module scope>';
  return fn.getKind() === SyntaxKind.Constructor
    ? 'constructor'
    : (fn.getName?.() ?? '<anonymous>');
}

/** `Owner.method` for the declaration a call resolves to, or undefined. */
function resolveCallee(call) {
  const expression = call.getExpression();
  if (expression.getKind() !== SyntaxKind.PropertyAccessExpression) return undefined;
  const name = expression.getName();
  const declarations = expression.getNameNode().getSymbol()?.getDeclarations() ?? [];
  for (const declaration of declarations) {
    const owner = declaration.getFirstAncestor(
      (a) =>
        a.getKind() === SyntaxKind.ClassDeclaration ||
        a.getKind() === SyntaxKind.InterfaceDeclaration
    );
    const key = `${owner?.getName?.() ?? '?'}.${name}`;
    if (SCOPED_READS.has(key)) return key;
  }
  return undefined;
}

function hasScopeKey(literal) {
  return literal.getProperties().some((property) => {
    const kind = property.getKind();
    if (kind === SyntaxKind.SpreadAssignment) return false;
    return property.getName?.() === 'scope';
  });
}

/** Why a call is unscoped, or undefined when it carries a scope. */
function unscopedReason(call, rule) {
  const argument = call.getArguments()[rule.arg];
  if (argument === undefined) return `no scope argument (position ${rule.arg})`;
  if (!rule.inOptions) return undefined;
  // `cond ? { userPreference } : {}` was the shape stage 12 used: every branch must carry it.
  const branches =
    argument.getKind() === SyntaxKind.ConditionalExpression
      ? [argument.getWhenTrue(), argument.getWhenFalse()]
      : [argument];
  const unscoped = branches.some(
    (branch) => branch.getKind() === SyntaxKind.ObjectLiteralExpression && !hasScopeKey(branch)
  );
  return unscoped ? 'options object literal has no `scope` key' : undefined;
}

function collect() {
  const project = new Project({
    tsConfigFilePath: path.join(SERVER_ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const findings = [];
  let scoped = 0;

  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(SERVER_ROOT, sourceFile.getFilePath());
    if (!rel.startsWith('src' + path.sep) || rel === STORE_FILE) continue;

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const key = resolveCallee(call);
      if (key === undefined) continue;
      const reason = unscopedReason(call, SCOPED_READS.get(key));
      if (reason === undefined) {
        scoped += 1;
        continue;
      }
      findings.push({
        file: rel,
        line: call.getStartLineNumber(),
        fn: enclosingFunctionName(call),
        key,
        reason,
      });
    }
  }
  return { findings, scoped };
}

const { findings, scoped } = collect();
const accepts = (entry, finding) => finding.file === entry.subject && finding.fn === entry.fn;

const audit = auditExceptions({
  gate: GATE,
  entries: ACCEPTED,
  describe: (entry) => `${entry.subject} ${entry.fn}()`,
  closedBy: (entry) => entry.closedBy,
  classify: (entry) => {
    if (!fs.existsSync(path.join(SERVER_ROOT, entry.subject))) {
      return { verdict: VERDICT.SUBJECT_MISSING };
    }
    return findings.some((finding) => accepts(entry, finding))
      ? { verdict: VERDICT.LOAD_BEARING }
      : { verdict: VERDICT.SATISFIED, detail: 'every read in it now passes a scope' };
  },
});

const unaccepted = findings.filter((finding) => !ACCEPTED.some((entry) => accepts(entry, finding)));
for (const finding of unaccepted) {
  console.error(
    `❌ ${finding.file}:${finding.line} — ${finding.fn}() calls ${finding.key}: ${finding.reason}`
  );
  console.error(
    "     Pass the request's scope (`context.getScopeOptions()` in a pipeline stage, " +
      '`this.requestScope` in a system_control handler). Omitted, the read answers for the ' +
      'launch workspace whatever header the request carries.'
  );
}

const auditProblems = reportExceptionAudit(GATE, audit);

if (scoped < MINIMUM_SCOPED_CALLS) {
  console.error(
    `❌ [${GATE}] saw only ${scoped} scoped call(s); expected at least ${MINIMUM_SCOPED_CALLS}. ` +
      'The scan is not reaching the code it governs — check SCOPED_READS.'
  );
  process.exit(1);
}

if (unaccepted.length > 0 || auditProblems > 0) process.exit(1);

console.log(
  `[${GATE}] OK: ${scoped} scoped framework read(s), 0 unscoped outside ` +
    `${ACCEPTED.length} accepted exception(s)`
);
process.exit(0);
