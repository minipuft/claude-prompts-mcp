#!/usr/bin/env tsx
/**
 * Every consumer that re-derives the catalog from disk must be handed the loaders' refusal record.
 *
 * WHY THIS EXISTS. `ResourceIndexer` and `ResourceChangeTracker` each run their own filesystem
 * walk and accept any file whose YAML parses. Neither consults the loader, so both used to report
 * resources the catalog had dropped: `resource_index` — which every Python hook reads — pointed at
 * unloadable files, and the change log recorded `added` for a prompt that never entered the
 * catalog (P4.14). The fix hands each of them a live `QuarantineView`.
 *
 * THE PROPERTY THIS PROTECTS IS INVISIBLE TO EVERY OTHER GATE. `quarantine` is an OPTIONAL config
 * field, deliberately — an indexer built without one indexes every parseable file, which is what
 * the existing callers and their tests depend on. The cost of that choice is that DELETING the
 * wiring at either call site typechecks, passes both ratchets, passes `validate:all`, and passes
 * every unit, integration and e2e test, because the consumer suites construct their own indexer
 * and pass their own view. Measured 2026-09-11: the P4.14 tests are thorough about the consumers'
 * BEHAVIOUR and cannot observe whether production reaches it. That is the gap this closes, and it
 * is the `feedback_unwired_validator_launders_absence` shape — a capability with no call site
 * reads as coverage.
 *
 * WHAT IT CHECKS. Under `src/`:
 *   - every CALL to `createResourceIndexer(...)` passes a `quarantine` property in its config
 *     object literal;
 *   - every CALL to `compareResourceBaseline(...)` passes the quarantine argument.
 *
 * Parsed with the TypeScript AST rather than matched by text. A regex cannot tell a `quarantine`
 * inside the config object from one in a comment beside it or in an unrelated call on the next
 * line — and a false PASS here is exactly the outcome this check exists to prevent.
 *
 * `--self-test` proves the predicate reports each unwired shape and stays silent on the wired one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = path.join(SERVER_ROOT, 'src');

/** The config property that carries the refusal record into `ResourceIndexer`. */
const QUARANTINE_PROPERTY = 'quarantine';

/**
 * Each catalog-re-deriving consumer, and where its refusal record has to appear.
 *
 * A table rather than two hand-written checks: a third consumer is an entry, and an entry cannot
 * be silently omitted the way a third `if` block can — the same argument P4.13 made for
 * `toFrameworkCreationData`, where fifteen hand-written blocks lost two of eleven fields.
 */
interface ConsumerRule {
  /** Function whose call sites must be wired. */
  readonly callee: string;
  /**
   * `config-property` — the view rides a property of an object-literal argument.
   * `positional`    — the view is an argument in its own right.
   */
  readonly carrier: 'config-property' | 'positional';
  /** Argument index holding the config object, or the argument the view must occupy. */
  readonly argIndex: number;
  /** What a reader should do about a finding. */
  readonly remedy: string;
}

const CONSUMERS: readonly ConsumerRule[] = [
  {
    callee: 'createResourceIndexer',
    carrier: 'config-property',
    argIndex: 2,
    remedy: `pass \`${QUARANTINE_PROPERTY}\` in the config object — without it this indexer writes a \`resource_index\` row for every file that merely parses, including ones no loader would serve`,
  },
  {
    callee: 'compareResourceBaseline',
    carrier: 'positional',
    argIndex: 3,
    remedy:
      'pass the quarantine view as the fourth argument — without it the baseline logs `added` for a file that never entered the catalog',
  },
];

export interface UnwiredConsumer {
  file: string;
  line: number;
  callee: string;
  reason: string;
}

/** Every `.ts` file below a directory, skipping declaration files. */
function typescriptFilesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...typescriptFilesUnder(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

/** True when an object literal assigns or shorthands `quarantine`. */
function carriesQuarantineProperty(node: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((property) => {
    if (ts.isShorthandPropertyAssignment(property)) {
      return property.name.text === QUARANTINE_PROPERTY;
    }
    if (ts.isPropertyAssignment(property)) {
      return (
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === QUARANTINE_PROPERTY
      );
    }
    // A spread could supply it, and this check cannot see through one. Reported rather than
    // assumed either way — see `run()`, where an unresolvable shape is a finding, not a pass.
    return false;
  });
}

/**
 * Findings for one source file, and how many wired call sites it held.
 *
 * The count travels with the findings because silence from a scan that saw no call site at all is
 * not evidence — see the `sitesSeen` guard in `run()`.
 */
export function findUnwiredConsumers(
  file: string,
  source: string
): { findings: UnwiredConsumer[]; sitesSeen: number } {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const findings: UnwiredConsumer[] = [];
  let sitesSeen = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const rule = CONSUMERS.find((candidate) => candidate.callee === node.expression.getText());
      if (rule !== undefined) {
        sitesSeen += 1;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const argument = node.arguments[rule.argIndex];

        if (argument === undefined) {
          findings.push({
            file,
            line,
            callee: rule.callee,
            reason:
              rule.carrier === 'positional'
                ? 'no quarantine argument'
                : 'no config argument to carry the quarantine view',
          });
        } else if (rule.carrier === 'config-property' && !carriesQuarantineProperty(argument)) {
          findings.push({
            file,
            line,
            callee: rule.callee,
            reason: ts.isObjectLiteralExpression(argument)
              ? `config object omits \`${QUARANTINE_PROPERTY}\``
              : 'config is not an object literal here, so the wiring cannot be read',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { findings, sitesSeen };
}

const WIRED_SHAPE = `
const indexer = createResourceIndexer(dbManager, logger, {
  resourcesDir,
  resourceRoots: indexerResourceRoots(pathResolver),
  toolLoader: (dir, id) => scriptLoader.loadAllToolsForPromptDetailed(dir, id),
  quarantine,
});
await compareResourceBaseline(tracker, configManager, logger, quarantine);
`;

const UNWIRED_INDEXER_SHAPE = `
const indexer = createResourceIndexer(dbManager, logger, {
  resourcesDir,
  resourceRoots: indexerResourceRoots(pathResolver),
  toolLoader: (dir, id) => scriptLoader.loadAllToolsForPromptDetailed(dir, id),
});
await compareResourceBaseline(tracker, configManager, logger, quarantine);
`;

const UNWIRED_BASELINE_SHAPE = `
const indexer = createResourceIndexer(dbManager, logger, { resourcesDir, quarantine });
await compareResourceBaseline(tracker, configManager, logger);
`;

/**
 * The laundering case: `quarantine` is in scope, named on the line above, and passed to something
 * else. A text search for the identifier near the call would call this wired.
 */
const NEARBY_QUARANTINE_SHAPE = `
const quarantine = promptManager.getQuarantine();
logger.debug(\`quarantine holds \${quarantine.size}\`);
const indexer = createResourceIndexer(dbManager, logger, { resourcesDir });
`;

function selfTest(): number {
  const cases: {
    name: string;
    source: string;
    expect: (_f: UnwiredConsumer[]) => boolean;
  }[] = [
    {
      name: 'both consumers wired reports nothing',
      source: WIRED_SHAPE,
      expect: (f) => f.length === 0,
    },
    {
      name: 'an indexer built without a quarantine is reported (the motivating instance)',
      source: UNWIRED_INDEXER_SHAPE,
      expect: (f) => f.length === 1 && f[0]?.callee === 'createResourceIndexer',
    },
    {
      name: 'a baseline comparison missing its fourth argument is reported',
      source: UNWIRED_BASELINE_SHAPE,
      expect: (f) => f.length === 1 && f[0]?.callee === 'compareResourceBaseline',
    },
    {
      name: 'a quarantine named beside the call does not launder an unwired config',
      source: NEARBY_QUARANTINE_SHAPE,
      expect: (f) => f.length === 1 && f[0]?.callee === 'createResourceIndexer',
    },
  ];

  let failed = 0;
  for (const testCase of cases) {
    const ok = testCase.expect(findUnwiredConsumers('probe.ts', testCase.source).findings);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`);
    if (!ok) failed += 1;
  }

  // The real tree must be clean — the check the gate exists to make.
  const live = run(true);
  console.log(`${live === 0 ? 'PASS' : 'FAIL'}  this checkout wires every catalog consumer`);
  if (live !== 0) failed += 1;

  return failed === 0 ? 0 : 1;
}

function run(quiet = false): number {
  const files = typescriptFilesUnder(SCAN_ROOT);
  const findings: UnwiredConsumer[] = [];
  let sitesSeen = 0;

  for (const file of files) {
    const relative = path.relative(SERVER_ROOT, file);
    const result = findUnwiredConsumers(relative, readFileSync(file, 'utf8'));
    sitesSeen += result.sitesSeen;
    findings.push(...result.findings);
  }

  // A null result needs a positive control. If either function were renamed or the scan root
  // moved, every file would read clean and this gate would pass having observed nothing at all.
  if (sitesSeen === 0) {
    console.error(
      `✖ No call to ${CONSUMERS.map((consumer) => consumer.callee).join(' or ')} found under ` +
        `${path.relative(SERVER_ROOT, SCAN_ROOT)} — the probe cannot observe, so its silence is ` +
        `not evidence.`
    );
    return 1;
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      const rule = CONSUMERS.find((consumer) => consumer.callee === finding.callee);
      console.error(
        `✖ ${finding.file}:${finding.line} calls ${finding.callee}() — ${finding.reason}; ` +
          `${rule?.remedy ?? 'wire the quarantine view'}`
      );
    }
    console.error(
      `\n\`quarantine\` is optional by design, so an unwired call site typechecks and every suite ` +
        `stays green: the consumer tests build their own view and never observe production's ` +
        `wiring. This gate is the only thing that does.`
    );
    return 1;
  }

  if (!quiet) {
    console.log(
      `✅ Refusal-aware consumers: ${sitesSeen} catalog-re-deriving call site(s) across ` +
        `${files.length} files, all handed the loaders' refusal record.`
    );
  }
  return 0;
}

// Guarded: `findUnwiredConsumers` is exported, and a module-scope exit would terminate any
// process that imported it rather than running it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
