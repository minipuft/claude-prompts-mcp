#!/usr/bin/env node

/**
 * Flags optional fields on pipeline state interfaces that have readers and no writers.
 *
 * THE DECLARED-BUT-NEVER-CONSUMED FAMILY. This gate is one of three covering the same failure
 * shape at different layers. A declaration exists, its consumers are reachable, and nothing ever
 * supplies it — so the feature looks implemented, is measured as covered, and silently does
 * nothing. Keep them cross-referenced; a new instance of the shape belongs in whichever member
 * owns that layer rather than in a fourth script:
 *   - `validate:no-phantom-columns`   — a DB column declared and indexed, with no writer
 *   - `validate:state-field-writers`  — THIS: an optional TS field with readers and no writer,
 *                                       including optional dependency seams that default to no-op
 *   - `validate:knip-ratchet`         — an export declared and never imported
 *
 * NONE of them catches runtime unreachability: code that is wired, imported and written, but sits
 * on a branch the live path never takes. That class is what the `reached` pre-flight probe in
 * `~/.claude/rules/refactoring.md` exists for, and it is why a green suite is not evidence a new
 * path runs. Measured 2026-08-17: a feature passed 2619 unit tests on a path that never executed.
 *
 * The shape this catches is worse than dead code, because the readers are reachable: they
 * run on every request and silently take the `undefined` branch, so the feature they gate
 * looks implemented and is measured as covered. Three instances were found by hand before
 * this existed — `enhancedGateConfiguration` on `ExecutionPlan` (1 declaration, 6 reads, 0
 * writes, 2026-07-29) and `clientOverride` / `clientSelectedGates` on the pipeline state
 * (8 and 4 reads, 0 writes, 2026-08-02). Each needed someone to happen to look.
 *
 * WHAT COUNTS AS A WRITE, and why it resolves symbols rather than matching names:
 *
 *   1. `x.field = ...` and compound forms — a property access on the left of an assignment
 *   2. `{ field: ... }` / `{ field }` — a property in an object literal typed as the interface
 *
 * References are resolved through the type checker, so a same-named property on an
 * unrelated type is not counted. A first cut matched names instead, and it missed
 * `clientOverride` in back-testing: the phantom state field existed to feed a same-named
 * field on `FrameworkDecisionInput`, and `decisionInput.clientOverride = ...` made the
 * state field look written. That is not an edge case — a phantom channel usually has a
 * same-named consumer being written, so name matching misses the exact shape this targets.
 *
 * Required fields are out of scope: TypeScript already requires them at every construction
 * site, so "declared and never written" cannot arise without a type error.
 *
 * KNOWN BLIND SPOT — writes routed through a structural alias:
 *
 *   type Target = { field?: string[] };            // a second declaration of `field`
 *   function write(t: Target) { t.field = [...]; } // resolves to Target.field
 *   write(realStep);                               // ...not to ChainStepPrompt.field
 *
 * Symbol resolution is what makes the name-matching failure above impossible, and it is also
 * what makes this one possible: the assignment resolves to the alias's own declaration, so the
 * real interface shows no writer. `ChainStepPrompt.inlineGateIds` was reported unwritten for
 * exactly this reason while a producer had been running on every chain step carrying
 * `:: "criteria"` syntax (`inline-gate-processor.ts`).
 *
 * The fix belongs at the call site, not here: name the concrete types the parameter actually
 * receives (`ChainStepPrompt | ParsedCommand`) instead of their shared shape. Widening this
 * script to chase structurally-assignable types would reintroduce the false positives that
 * symbol resolution exists to prevent, and an allowlist entry would silence one instance while
 * leaving the class live. If a finding here looks wrong, check whether the writer goes through
 * a structural alias before concluding the field is dead.
 *
 * RETIREMENT CONDITION: none expected. This encodes an invariant, not a migration.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const BASELINE_PATH = path.join(scriptDir, 'state-field-writers-baseline.json');

/**
 * State-carrying interfaces in scope.
 *
 * Each entry is here because instances of the shared mutable object it describes are
 * threaded through many stages, so a field can acquire readers in one place and never
 * acquire a writer anywhere. Interfaces that describe a value constructed and consumed in
 * one place are deliberately out: a phantom field there is visible in a single file.
 */
const WATCHED = [
  {
    file: 'src/engine/execution/context/internal-state.ts',
    interfaces: ['PipelineInternalState', 'ScriptState'],
    reason: 'The pipeline state object, mutated across 22 stages. Held 2 of the 3 known instances.',
  },
  {
    file: 'src/shared/types/core-config.ts',
    interfaces: ['ExecutionPlan'],
    reason: 'Built once by the planner, read by most stages. Held enhancedGateConfiguration.',
  },
  {
    file: 'src/engine/execution/types.ts',
    interfaces: ['ConvertedPrompt'],
    reason: 'Threaded through parsing, planning, and every stage. Held enhancedGateConfiguration.',
  },
  {
    file: 'src/engine/execution/pipeline/decisions/framework/framework-decision-authority.ts',
    interfaces: ['FrameworkDecisionInput'],
    reason: 'Assembled by several callers; a field no caller sets is a channel with no producer.',
  },
  {
    file: 'src/shared/types/chain-execution.ts',
    interfaces: ['StepMetadata'],
    reason:
      'Per-step lifecycle record persisted to chain_run_nodes and read back on resume. A field ' +
      'declared here with no writer is a column that reads NULL on every row while the feature ' +
      'it backs looks implemented — the same failure this gate catches in memory, one layer down.',
  },
  {
    file: 'src/engine/execution/operators/chain-operator-executor.ts',
    interfaces: ['ChainOperatorCollaborators'],
    reason:
      'Optional dependency seams that default to no-op. This is the third member of the ' +
      'declared-but-never-consumed family (columns with no writer, exports with no importer, ' +
      'seams with no wiring): omit the wiring and the code compiles, every test passes, and ' +
      'behavior silently keeps the old path. Named rather than an inline literal so this gate ' +
      'has a symbol to resolve.',
  },
  {
    file: 'src/engine/execution/operators/types.ts',
    interfaces: ['ChainStepPrompt', 'ChainStepRenderResult'],
    reason:
      'Built by two independent step builders (symbolic-command-builder and 04-parsing-stage), ' +
      'so a field wired in one and missed in the other has a producer on only one entry path. ' +
      '`agentType` was declared and read here with no writer at all through Tier 15B, surviving ' +
      'that sweep because the watched set stopped at ConvertedPrompt — the sibling half of the ' +
      'same field.',
  },
];

/**
 * Collect optional properties, descending into nested type literals.
 *
 * A nested object is only descended into when at least one of its own members is
 * individually assigned somewhere. When none are, the object is only ever written
 * wholesale — `decisionInput.modifiers = executionPlan.modifiers` — and its members have no
 * individual writer by construction, not by defect. Descending there produced 7 of the 15
 * findings on the first measured run, all noise.
 */
function collectOptionalProperties(node, out, trail) {
  for (const property of node.getProperties()) {
    const name = property.getName();
    const nested = property.getFirstDescendantByKind(SyntaxKind.TypeLiteral);

    if (property.hasQuestionToken()) {
      out.push({
        name,
        path: [...trail, name].join('.'),
        line: property.getStartLineNumber(),
        declaration: property,
      });
    }

    if (nested && nested.getProperties().some((member) => hasWriter(member))) {
      collectOptionalProperties(nested, out, [...trail, name]);
    }
  }
}

/**
 * True when `reference` — an identifier resolved to a watched property — sits in a
 * position that assigns to it.
 */
function isWritePosition(reference) {
  const parent = reference.getParent();
  if (!parent) {
    return false;
  }

  const kind = parent.getKind();

  // `{ field: value }` and `{ field }` both construct a value for the property.
  if (kind === SyntaxKind.PropertyAssignment || kind === SyntaxKind.ShorthandPropertyAssignment) {
    return true;
  }

  // `x.field = ...`, `x.field ??= ...`, and friends.
  if (kind === SyntaxKind.PropertyAccessExpression || kind === SyntaxKind.ElementAccessExpression) {
    const expression = parent.getParent();
    if (expression?.getKind() !== SyntaxKind.BinaryExpression) {
      return false;
    }
    const operator = expression.getOperatorToken().getKind();
    const assigns =
      operator === SyntaxKind.EqualsToken ||
      operator === SyntaxKind.PlusEqualsToken ||
      operator === SyntaxKind.QuestionQuestionEqualsToken ||
      operator === SyntaxKind.BarBarEqualsToken ||
      operator === SyntaxKind.AmpersandAmpersandEqualsToken;
    return assigns && expression.getLeft() === parent;
  }

  return false;
}

/**
 * True when any reference to this property declaration assigns to it.
 *
 * Declarations in `tests/` are excluded: a field written only by a test fixture has no
 * production producer, which is the condition being detected.
 */
function hasWriter(property) {
  for (const reference of property.findReferencesAsNodes()) {
    if (reference.getSourceFile().getFilePath().includes('/tests/')) {
      continue;
    }
    if (isWritePosition(reference)) {
      return true;
    }
  }
  return false;
}

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const selfTest = args.includes('--self-test');
  // Back-testing against a historical commit: the watched set names files that may not exist
  // there yet. Skipping them keeps the back-test honest rather than requiring a forked script.
  const allowMissing = args.includes('--allow-missing');
  const updateBaseline = args.includes('--update-baseline');

  if (selfTest) {
    return runSelfTest();
  }

  const project = new Project({
    tsConfigFilePath: path.join(serverDir, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const findings = [];
  const scanned = [];

  for (const watched of WATCHED) {
    const absolute = path.join(serverDir, watched.file);
    const sourceFile = project.getSourceFile(absolute);
    if (!sourceFile) {
      if (allowMissing) {
        continue;
      }
      console.error(`[state-field-writers] Watched file missing: ${watched.file}`);
      process.exitCode = 1;
      return;
    }

    for (const interfaceName of watched.interfaces) {
      const declaration = sourceFile.getInterface(interfaceName);
      if (!declaration) {
        if (allowMissing) {
          continue;
        }
        console.error(
          `[state-field-writers] Watched interface missing: ${interfaceName} in ${watched.file}`
        );
        process.exitCode = 1;
        return;
      }

      const properties = [];
      collectOptionalProperties(declaration, properties, [interfaceName]);
      scanned.push({ interfaceName, count: properties.length });

      for (const property of properties) {
        if (!hasWriter(property.declaration)) {
          findings.push({ ...property, file: watched.file, interfaceName });
        }
      }
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ scanned, findings }, null, 2));
    process.exitCode = findings.length > 0 ? 1 : 0;
    return;
  }

  const total = scanned.reduce((sum, entry) => sum + entry.count, 0);
  const found = findings.map((finding) => finding.path).sort();

  if (updateBaseline) {
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({ known: found }, null, 2)}\n`);
    console.log(`[state-field-writers] Baseline written: ${found.length} known finding(s).`);
    return;
  }

  const baseline = fs.existsSync(BASELINE_PATH)
    ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).known
    : [];

  const added = found.filter((entry) => !baseline.includes(entry));
  const fixed = baseline.filter((entry) => !found.includes(entry));

  if (added.length > 0) {
    console.error('[state-field-writers] NEW state field(s) with no writer:\n');
    for (const finding of findings.filter((entry) => added.includes(entry.path))) {
      console.error(`  ${finding.path}`);
      console.error(`    declared: ${finding.file}:${finding.line}`);
    }
    console.error(
      '\nEach field above is declared and read but never assigned anywhere in src/, so every' +
        '\nreader takes the undefined branch on every request. Either wire the producer, or' +
        '\ndelete the field and its readers — the user-facing interface decides which.\n'
    );
    process.exitCode = 1;
    return;
  }

  if (fixed.length > 0) {
    console.error(
      `[state-field-writers] ${fixed.length} baselined finding(s) are now written or gone:\n` +
        fixed.map((entry) => `  ${entry}`).join('\n') +
        '\n\nRun with --update-baseline to lower the ratchet.\n'
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `validate:state-field-writers OK — ${total} optional field(s) across ` +
      `${scanned.length} watched interface(s); ${found.length} known finding(s), none new.`
  );
}

/**
 * Prove the checks still fire, using synthetic sources rather than the real tree.
 *
 * A guard that cannot fail is indistinguishable from one that passes, and this one would
 * silently stop working if the write-detection stopped recognising a syntax form.
 */
function runSelfTest() {
  const project = new Project({ useInMemoryFileSystem: true });

  project.createSourceFile(
    'state.ts',
    `export interface Fixture {
       phantom?: string;
       assigned?: string;
       viaLiteral?: string;
       viaShorthand?: string;
       viaNullish?: string;
       required: string;
       nested?: { phantomChild?: string; assignedChild?: string };
     }
     export interface Decoy {
       /** Same name as Fixture.phantom, and written — must not mask the phantom. */
       phantom?: string;
     }`
  );
  project.createSourceFile(
    'writers.ts',
    `import type { Fixture, Decoy } from './state';
     declare const target: Fixture;
     declare const decoy: Decoy;
     declare const viaShorthand: string;
     target.assigned = 'x';
     target.viaNullish ??= 'x';
     const literal: Fixture = { required: 'r', viaLiteral: 'x' };
     const shorthand: Fixture = { required: 'r', viaShorthand };
     const child: Fixture = { required: 'r', nested: { assignedChild: 'x' } };
     decoy.phantom = 'must not count as a write to Fixture.phantom';
     void literal; void shorthand; void child;`
  );
  project.createSourceFile(
    'readers.ts',
    `import type { Fixture } from './state';
     declare const target: Fixture;
     export const reads = [target.phantom, target.nested?.phantomChild];`
  );

  const properties = [];
  collectOptionalProperties(project.getSourceFile('state.ts').getInterface('Fixture'), properties, [
    'Fixture',
  ]);

  const flagged = properties
    .filter((property) => !hasWriter(property.declaration))
    .map((property) => property.path)
    .sort();
  const expected = ['Fixture.nested.phantomChild', 'Fixture.phantom'];

  const failures = [];
  if (JSON.stringify(flagged) !== JSON.stringify(expected)) {
    failures.push(`expected ${JSON.stringify(expected)}, flagged ${JSON.stringify(flagged)}`);
  }
  if (properties.some((property) => property.name === 'required')) {
    failures.push('required (non-optional) property was collected; it should be out of scope');
  }

  if (failures.length > 0) {
    console.error('[state-field-writers] SELF-TEST FAILED:');
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    'validate:state-field-writers self-test OK — flags an unwritten field and an unwritten ' +
      'nested one, counts assignment/nullish/object-literal/shorthand writes, and is not ' +
      'fooled by a same-named written property on another interface.'
  );
}

main();
