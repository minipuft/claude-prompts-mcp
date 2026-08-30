#!/usr/bin/env node

/**
 * Requires every resource-writing module to assert path containment.
 *
 * WHAT IT PROTECTS. Tier 2 of the 2026-08-24 security review closed two arbitrary-file-write
 * traversal vectors by routing every resource directory construction through
 * `assertPathInside` (`#shared/utils/path-containment.js`). Six call sites across five files.
 * Nothing enforced that they stay, which by `dev-workflow.md` ("a fix at the sites you found is
 * not a fix of the class") means the class was never closed.
 *
 * WHY IT IS NOT PARANOIA. Measured 2026-08-28 while testing whether this branch could land
 * beside concurrent work: `feat/settability-parity` independently rewrote
 * `FrameworkFileWriter.getFrameworkDir` to resolve its root from
 * `configManager.getFrameworksDirectory()`. That change is COMPLEMENTARY to the containment
 * assertion — both belong in the merged result — but the two edits collide in the same three
 * lines, and the obvious "take theirs" resolution deletes the security guard with no test
 * failing and no reviewer prompt. A guard that a merge conflict can silently drop is not a
 * guard; this gate is what makes that resolution fail loudly.
 *
 * THE PROPERTY MEASURED, stated exactly because a probe that measures something adjacent
 * answers a different question: every file in the declared resource-WRITE surface must contain
 * at least one call to `assertPathInside`. Not "imports it" — a call. An import with no call is
 * the shape a careless merge leaves behind.
 *
 * KNOWN BLIND SPOT, stated rather than discovered later: this is per-FILE, not per-resolver. A
 * file that already guards one resolver and gains a second, unguarded one passes. Closing that
 * needs the resolver-level analysis `validate:scope-producers` does for scope objects, and is
 * worth building the first time a file carries two independent resolvers — today none does.
 * The per-file check is what catches deletion and what catches a brand-new writer with no guard
 * at all, which are the two ways this control has actually been at risk.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'validate:resource-path-containment';
const GUARD = 'assertPathInside';

/**
 * The resource-WRITE surface: modules that turn a caller-supplied id or category into a
 * filesystem path under a resource root. Matched by filename role rather than listed
 * individually, so a new writer is covered the day it is added rather than the day someone
 * remembers to append it here.
 */
const SURFACE = [/file-writer\.ts$/, /lifecycle-processor\.ts$/, /file-operations\.ts$/];

/** Files matching the surface that legitimately construct no resource path. */
const ACCEPTED = [];

function collect() {
  const project = new Project({
    tsConfigFilePath: path.join(SERVER_ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const inSurface = [];
  const unguarded = [];

  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(SERVER_ROOT, sourceFile.getFilePath());
    if (!rel.startsWith('src' + path.sep)) continue;
    if (!SURFACE.some((pattern) => pattern.test(rel))) continue;

    inSurface.push(rel);

    const guarded = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some((call) => call.getExpression().getText() === GUARD);

    // A file that builds no FILESYSTEM path has nothing to contain.
    //
    // Resolved through the import, not by name. A first cut matched any call whose text ended
    // in `join`, and immediately reported `prompt-lifecycle-processor.ts` — where all ten hits
    // are `Array.prototype.join` building response strings. Measuring "calls something named
    // join" answers a different question than "builds a filesystem path", and a gate that
    // cries wolf on its first run teaches the next reader to skim past it.
    const importsPathJoin = sourceFile.getImportDeclarations().some((decl) => {
      const from = decl.getModuleSpecifierValue();
      if (from !== 'node:path' && from !== 'path') return false;
      return decl
        .getNamedImports()
        .some((named) => (named.getAliasNode() ?? named.getNameNode()).getText() === 'join');
    });
    const buildsPath = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
      const text = call.getExpression().getText();
      if (text === 'path.join' || text === 'nodePath.join') return true;
      return text === 'join' && importsPathJoin;
    });

    if (buildsPath && !guarded) unguarded.push(rel);
  }
  return { inSurface, unguarded };
}

const { inSurface, unguarded } = collect();

// A surface that matched nothing is a broken scan reported as cleanliness.
if (inSurface.length === 0) {
  console.error(`❌ ${GATE}: the resource-write surface matched ZERO files — the scan is broken.`);
  process.exit(1);
}

const audit = auditExceptions({
  gate: GATE,
  entries: ACCEPTED,
  describe: (entry) => entry.subject,
  closedBy: (entry) => entry.closedBy,
  classify: (entry) => ({
    verdict: unguarded.includes(entry.subject) ? VERDICT.LOAD_BEARING : VERDICT.SATISFIED,
  }),
});

for (const file of unguarded.filter((f) => !ACCEPTED.some((e) => e.subject === f))) {
  console.error(`❌ ${file} — builds paths but never calls ${GUARD}()`);
  console.error(`     Resource writes must be contained: import assertPathInside from`);
  console.error(`     #shared/utils/path-containment.js and assert the joined directory.`);
}

const auditProblems = reportExceptionAudit(GATE, audit);
const failures = unguarded.filter((f) => !ACCEPTED.some((e) => e.subject === f)).length;

if (failures === 0 && auditProblems === 0) {
  console.log(
    `[validate-resource-path-containment] OK: ${inSurface.length} resource-write file(s) scanned, all contained`
  );
  process.exit(0);
}
process.exit(1);
