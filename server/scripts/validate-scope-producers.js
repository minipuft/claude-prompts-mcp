#!/usr/bin/env node

/**
 * Flags scope objects built by hand that name `continuityScopeId` and omit `workspaceId`.
 *
 * THE DECLARED-BUT-NEVER-CONSUMED FAMILY, PRODUCER LAYER. This gate is the fourth member of the
 * family cross-referenced in `validate-no-phantom-columns.ts` and `validate-state-field-writers.js`.
 * The other three ask whether a declaration ever gets a value; this one asks whether a value ever
 * reaches the key its consumer reads. Same outcome — a feature looks implemented and silently does
 * nothing — arrived at from the opposite direction.
 *
 * WHY A FOURTH SCRIPT, given the family's own charter says to prefer an existing member: that
 * instruction assumes some member owns the layer in question, and demonstrably none owned the
 * producer layer. The charter has been amended to say what to do when no member owns a layer
 * (see the family header in `validate-no-phantom-columns.ts`); this gate is the first application
 * of the amended rule, not an exception to the old one.
 *
 * WHAT WENT WRONG WITHOUT IT. Four producers each hand-rolled:
 *
 *     return scopeId !== 'default' ? { continuityScopeId: scopeId } : undefined;
 *
 * `resolveContinuityScopeId` — which `GateStateStore`, `FrameworkStateStore`, `SqliteStateStore`,
 * `version-history` and `resource-change-tracker` all key on — read `workspaceId`/`organizationId`
 * and did not read `continuityScopeId` at all. So every one of those writes landed on the literal
 * `'default'` bucket while readers used the launch-default workspace id.
 *
 * `sqlite-layer-remediation-2026-08-03` Tier 4.1 diagnosed this exactly ("stop truncating"), fixed
 * ONE site, verified with `validate:no-phantom-columns`, and retired the plan. The other three
 * kept the expression for four months. Measured consequences on 2026-08-27: `system_control` could
 * not disable the gate system, `framework switch` never persisted at all, and the advertised
 * `inputSchema` never narrowed. A per-site fix cannot generalize; this gate is what makes the
 * class stay fixed.
 *
 * WHAT COUNTS AS A FINDING: an object literal that assigns `continuityScopeId` and does not assign
 * `workspaceId`. Use `buildIdentityScope()` instead — it emits every key that was resolved.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH, stated because a blind spot documented is worth more than
 * one discovered: a producer that emits both keys but derives one wrongly, and a scope object built
 * across two statements rather than in one literal. Both are value-level defects one layer down,
 * the same relationship `validate:no-phantom-columns` has to `execution_records.workspace_id`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Scope objects that legitimately name `continuityScopeId` alone.
 *
 * Each entry must state what makes the scope NOT a workspace. "It is fine" is not a reason: the
 * whole defect class is a scope that looked fine and resolved to the wrong bucket.
 */
const ACCEPTED = [
  {
    subject: 'src/modules/chains/manager.ts',
    match: 'String(process.pid)',
    reason:
      'PID scope, not a workspace scope. `chain_sessions` isolation is per SERVER PROCESS — the ' +
      'Python hooks run `process.kill(pid, 0)` liveness against it — so a workspace id here would ' +
      'name the wrong thing entirely, and the readers of this scope use the union form that does ' +
      'read `continuityScopeId`.',
    closedBy:
      'Delete when chain_sessions stops being PID-scoped, i.e. when the hook liveness contract ' +
      'no longer reads a pid from this column.',
  },
];

/**
 * A scope producer is a function DECLARED to return `StateStoreOptions`, or a variable DECLARED
 * to hold one. Both are the shape the consumer contract applies to.
 *
 * Deliberately keyed on the declared type rather than on "any literal mentioning
 * `continuityScopeId`". A first cut did the latter and reported five findings, every one a log
 * payload or an identity-state field that no store ever reads — a probe measuring a token that
 * merely CO-OCCURS with the property answers a different question than the one asked, and would
 * have trained the next reader to skim past this gate.
 */
function collectFindings() {
  const project = new Project({
    tsConfigFilePath: path.join(SERVER_ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const findings = [];
  const record = (literal, rel) => {
    const names = literal
      .getProperties()
      .map((prop) => prop.getFirstChildByKind(SyntaxKind.Identifier)?.getText())
      .filter(Boolean);
    if (!names.includes('continuityScopeId')) return;
    if (names.includes('workspaceId')) return;
    findings.push({
      file: rel,
      line: literal.getStartLineNumber(),
      text: literal.getText().replace(/\s+/g, ' ').slice(0, 100),
    });
  };

  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(SERVER_ROOT, sourceFile.getFilePath());
    if (!rel.startsWith('src' + path.sep)) continue;
    // The canonical producer is allowed to name the keys; it is what everyone else must call.
    if (rel.endsWith(path.join('shared', 'utils', 'request-identity-scope.ts'))) continue;

    // (a) returns from a function whose declared return type is a scope
    for (const returnStatement of sourceFile.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      const owner = returnStatement.getFirstAncestor(
        (a) =>
          a.getKind() === SyntaxKind.MethodDeclaration ||
          a.getKind() === SyntaxKind.FunctionDeclaration ||
          a.getKind() === SyntaxKind.ArrowFunction ||
          a.getKind() === SyntaxKind.FunctionExpression
      );
      const returnTypeText = owner?.getReturnTypeNode?.()?.getText() ?? '';
      if (!returnTypeText.includes('StateStoreOptions')) continue;
      for (const literal of returnStatement.getDescendantsOfKind(
        SyntaxKind.ObjectLiteralExpression
      )) {
        record(literal, rel);
      }
    }

    // (b) variables and properties declared to hold a scope
    for (const declaration of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PropertyDeclaration),
    ]) {
      const typeText = declaration.getTypeNode?.()?.getText() ?? '';
      if (!typeText.includes('StateStoreOptions')) continue;
      const initializer = declaration.getInitializer?.();
      if (initializer?.getKind() === SyntaxKind.ObjectLiteralExpression) {
        record(initializer, rel);
      }
    }
  }
  return findings;
}

const findings = collectFindings();

const GATE = 'validate:scope-producers';
const audit = auditExceptions({
  gate: GATE,
  entries: ACCEPTED,
  describe: (entry) => `${entry.subject} (${entry.match})`,
  closedBy: (entry) => entry.closedBy,
  classify: (entry) => {
    if (!fs.existsSync(path.join(SERVER_ROOT, entry.subject))) {
      return { verdict: VERDICT.SUBJECT_MISSING };
    }
    const suppressed = findings.filter(
      (f) => f.file === entry.subject && f.text.includes(entry.match)
    );
    return suppressed.length > 0
      ? { verdict: VERDICT.LOAD_BEARING }
      : { verdict: VERDICT.SATISFIED, detail: 'no truncating literal left at this subject' };
  },
});

const unaccepted = findings.filter(
  (f) => !ACCEPTED.some((e) => f.file === e.subject && f.text.includes(e.match))
);

for (const f of unaccepted) {
  console.error(
    `❌ ${f.file}:${f.line} — scope object names continuityScopeId without workspaceId`
  );
  console.error(`     ${f.text}`);
  console.error(`     Use buildIdentityScope() from #shared/utils/request-identity-scope.js`);
}

const auditProblems = reportExceptionAudit(GATE, audit);

if (unaccepted.length === 0 && auditProblems === 0) {
  console.log(
    `[validate-scope-producers] OK: 0 truncating scope producers, ` +
      `${ACCEPTED.length} accepted exception(s) still load-bearing`
  );
  process.exit(0);
}
process.exit(1);
