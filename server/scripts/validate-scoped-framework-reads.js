#!/usr/bin/env node

/**
 * Fails a framework-state or gate-state read that names no scope where a request's scope exists.
 *
 * THE CLASS. Under Streamable HTTP a workspace header makes the request its own tenant (owner
 * ruling R94, rows P4.129–P4.132): its own active framework, enabled flag and switch history.
 * `FrameworkStateStore` answers every read for a scope, and falls back to the LAUNCH workspace when
 * a caller passes none. So a scope-less read never fails — it silently answers for the wrong
 * tenant. That is exactly how `prompt_engine` rendered the launch workspace's framework under every
 * header while `status` reported the header's own (measured 2026-09-22): about ten reads on the
 * execution path passed no scope, each correct under STDIO, where there is only one workspace.
 *
 * Gate state is the same class (row C.6, 2026-10-05): `GateStateStore` answers the gate master
 * switch per scope with the same launch-workspace fallback, and the shell verify executor's switch
 * resolver passed none, so a workspace that ran `system_control gates disable` still had its
 * `:: verify:` commands and `shell_verify` criteria executed. The executor and the two runners that
 * hand it a scope are listed, so each hop from a pipeline stage to the store must carry one.
 *
 * WHAT COUNTS AS A FINDING: a call to one of the scoped reads below that omits its scope argument,
 * or passes an object literal with no `scope` key where the scope travels inside an options
 * object. The callee is resolved through the type checker, not by name, so a same-named method on
 * another class (`GateStateStore.getCurrentState`, `PromptGuidanceService`'s private
 * `getActiveFramework`) is neither a finding nor a false pass.
 *
 * WHAT IS NOT SCANNED: `FrameworkStateStore`'s and `GateStateStore`'s own files. Their internal
 * reads run at startup and on behalf of the process's own workspace, where the launch scope is the
 * correct answer.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH (as of 2026-09-22 · flips when any of these shapes appears):
 *   - a scope argument that is present but wrong (e.g. `undefined` passed explicitly, or the launch
 *     scope handed over where the request's was available). The predicate is presence, not value;
 *     the e2e `http-workspace-header-scope` drives the values.
 *   - an options object built across statements and passed as a variable. Accepted as-is: the
 *     predicate only reads literals.
 *   - a call through a function VALUE (a callback parameter, a destructured method). Only a method
 *     on a named class or interface, or a named function declaration, resolves; a callback whose
 *     type takes the scope as a REQUIRED parameter is left to the compiler (see below).
 *
 * A green run is not a run that reached nothing: the scan fails closed unless each family below
 * saw at least its `MINIMUM_SCOPED_CALLS` compliant calls.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'validate:scoped-framework-reads';

const STORE_FILES = new Set([
  path.join('src', 'engine', 'frameworks', 'framework-state-store.ts'),
  path.join('src', 'engine', 'gates', 'gate-state-store.ts'),
]);

/**
 * `Owner.method` (or a bare function name) → how its scope is passed. `arg` is the argument index;
 * `inOptions` means that argument is an options object whose `scope` key carries it. `family`
 * groups the reads for the fail-closed minimum.
 */
const SCOPED_READS = new Map([
  ...['FrameworkStateStore', 'FrameworkStateAccessor'].flatMap((owner) => [
    [`${owner}.getActiveFramework`, { family: 'framework', arg: 0 }],
    [`${owner}.isFrameworkSystemEnabled`, { family: 'framework', arg: 0 }],
    [`${owner}.getCurrentState`, { family: 'framework', arg: 0 }],
    [`${owner}.getSystemHealth`, { family: 'framework', arg: 0 }],
    [`${owner}.getSwitchHistory`, { family: 'framework', arg: 1 }],
  ]),
  ['FrameworkManager.selectFramework', { family: 'framework', arg: 0, inOptions: true }],
  ['FrameworkManager.generateExecutionContext', { family: 'framework', arg: 1, inOptions: true }],
  ['PromptGuidanceService.applyGuidance', { family: 'framework', arg: 1, inOptions: true }],
  ['ChainOperatorExecutor.renderStep', { family: 'framework', arg: 0, inOptions: true }],
  ['GateStateStore.isGateSystemEnabled', { family: 'gate', arg: 0 }],
  ['GateStateStore.getSystemHealth', { family: 'gate', arg: 0 }],
  ['GateStateStore.getCurrentState', { family: 'gate', arg: 0 }],
  ['GateStateStore.recordValidation', { family: 'gate', arg: 2 }],
  ['LightweightGateSystem.isGateSystemEnabled', { family: 'gate', arg: 0 }],
  // The shell path to the gate switch: a stage hands the request's scope to a runner, the runner
  // to the executor, the executor to its resolver. A hop that drops it reads the launch workspace.
  ['ShellVerifyExecutor.execute', { family: 'gate', arg: 1 }],
  ['runGateShellVerifications', { family: 'gate', arg: 4 }],
  ['runGateReviewEvidence', { family: 'gate', arg: 4 }],
]);

/*
 * The stage-07/12 enabled check, `GateEnhancementService`'s active-framework lookup, stage 11's
 * gate switch, the shell executor's `gateSystemEnabled` resolver and `GateVerdictProcessor`'s
 * `runReviewChecks` are callbacks, not listed here: their types take the scope as a REQUIRED
 * parameter (`(scope: StateStoreOptions | undefined) => …`), so the compiler already refuses a
 * caller that omits it. What the compiler cannot refuse is a callback BODY that ignores its
 * parameter and calls a listed read with none, and that call is a finding here.
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
  {
    subject: 'src/engine/gates/gate-manager.ts',
    fn: 'isSystemEnabled',
    reason:
      'Overrides `BaseResourceHandler.isSystemEnabled()`, the same zero-argument protocol method ' +
      "as `FrameworkManager`'s; no execution-path caller reaches it (stage 11 and the shell " +
      'executor read `LightweightGateSystem.isGateSystemEnabled(scope)`).',
    closedBy: 'Delete when the base protocol method takes a scope.',
  },
];

/** Below these, per family, the scan is not reaching the code it governs. */
const MINIMUM_SCOPED_CALLS = { framework: 15, gate: 8 };

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

/** The bare name of a function declaration a plain call resolves to, if it is a listed read. */
function resolveFunctionCallee(expression) {
  let symbol = expression.getSymbol();
  if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol();
  const name = expression.getText();
  const declared = (symbol?.getDeclarations() ?? []).some(
    (declaration) => declaration.getKind() === SyntaxKind.FunctionDeclaration
  );
  return declared && SCOPED_READS.has(name) ? name : undefined;
}

/** `Owner.method` (or a function name) for the declaration a call resolves to, or undefined. */
function resolveCallee(call) {
  const expression = call.getExpression();
  if (expression.getKind() === SyntaxKind.Identifier) return resolveFunctionCallee(expression);
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
  const scoped = { framework: 0, gate: 0 };

  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(SERVER_ROOT, sourceFile.getFilePath());
    if (!rel.startsWith('src' + path.sep) || STORE_FILES.has(rel)) continue;

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const key = resolveCallee(call);
      if (key === undefined) continue;
      const rule = SCOPED_READS.get(key);
      const reason = unscopedReason(call, rule);
      if (reason === undefined) {
        scoped[rule.family] += 1;
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

const starved = Object.entries(MINIMUM_SCOPED_CALLS).filter(
  ([family, minimum]) => scoped[family] < minimum
);
for (const [family, minimum] of starved) {
  console.error(
    `❌ [${GATE}] saw only ${scoped[family]} scoped ${family} call(s); expected at least ` +
      `${minimum}. The scan is not reaching the code it governs — check SCOPED_READS.`
  );
}
if (starved.length > 0) process.exit(1);

if (unaccepted.length > 0 || auditProblems > 0) process.exit(1);

console.log(
  `[${GATE}] OK: ${scoped.framework} scoped framework read(s) and ${scoped.gate} scoped gate ` +
    `read(s), 0 unscoped outside ${ACCEPTED.length} accepted exception(s)`
);
process.exit(0);
