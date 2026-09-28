#!/usr/bin/env node

/**
 * Fails when the documented pipeline stage order stops matching the code.
 *
 * WHY THIS EXISTS
 * `docs/architecture/overview.md` carried two ASCII diagrams that said the pipeline had 23 stages
 * for weeks while the `stages` array in `pipeline-builder.ts` held 21. Nothing read the doc, so
 * nothing noticed: the stage table, the stage files and the "N stages" numerals scattered across
 * the handbooks were four hand-kept copies of one fact, each drifting on its own schedule.
 *
 * WHAT IT READS — the array is the contract, every other site is checked against it
 *   (a) `server/src/mcp/tools/prompt-engine/core/pipeline-builder.ts`: the
 *       `const stages: readonly PipelineStage[] = [ … ];` block, one identifier per line, each
 *       resolved in the same file through `const <id> = new <Class>(` or
 *       `const <id> = [this.]create<Name>Stage(`. A factory defined as a method in the same file
 *       resolves through its `return new <Class>(`; any other factory resolves to its name minus
 *       `create`. This yields N and the ordered class names.
 *   (b) the fenced box under a `### Stage Execution Order` or `#### Stage Execution Order`
 *       heading in `docs/architecture/overview.md`: N rows numbered 1…N in order, each naming its
 *       class with the `Stage` suffix stripped. The heading level itself is not checked — only
 *       that it is H3 or H4 and its text matches exactly.
 *   (c) `server/src/engine/execution/pipeline/stages/`: exactly N `NN-*.ts` files with contiguous
 *       prefixes 01…N, file NN exporting class NN or its `create<Class>` factory.
 *   (d) every "N stage(s)" / "(N stg)" numeral in CLAUDE.md, AGENTS.md, README.md and
 *       docs/**\/*.md equals N, except the sites in NUMERAL_ALLOWLIST, each with a reason. An
 *       allowlist entry that no longer matches anything is itself a violation. The same file read
 *       for (a) — pipeline-builder.ts's own comments — is checked too, widened to "N+ stage(s)"
 *       ("23+ stages" is still a numeral claim about the array's length, just phrased as a floor).
 *
 * REFUSES RATHER THAN PASSES
 * This is a text parser over a bounded shape, not a TypeScript parser. If the array is missing,
 * holds fewer than MIN_STAGES identifiers, or any identifier fails to resolve, the script exits 1
 * with a REFUSED message instead of comparing — a parser collapse must never read as
 * "0 stages, 0 mismatches". A refactor that builds `stages` some other way fails loudly here.
 *
 * ZERO DEPENDENCIES, ON PURPOSE
 * A hand edit to the stage table classifies as `docs` (scripts/classify-validation-scope.js), and
 * ci.yml guards "Install dependencies" on `scope == 'full'`, so the lightweight routes have no
 * node_modules. Node builtins only, same posture as validate-readme.js and
 * validate-contributing.js. Keep it that way.
 *
 * DECLARED BLIND SPOTS
 *   - A stage class renamed consistently in the code and the doc passes: this checks agreement,
 *     not that a name is apt.
 *   - A stage whose behavior changed passes: the row descriptions are prose and are not read.
 *   - Numerals are matched only in the two shapes above. "twenty-one stages" or "21-stage" is not
 *     seen, and files outside the four roots (plans/, CHANGELOG.md, source comments) are not read.
 *   - Factory-method bodies are located by the first `{` after the method name; a return type
 *     containing braces would mislocate the body. The refusal above catches the case where that
 *     leaves an identifier unresolved.
 *
 * Usage: node server/scripts/validate-pipeline-stage-table.js [--self-test]
 * Exit: 0 = consistent, 1 = violations or refusal (or a failed self-test), 2 = invalid args
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const BUILDER_PATH = 'server/src/mcp/tools/prompt-engine/core/pipeline-builder.ts';
const OVERVIEW_PATH = 'docs/architecture/overview.md';
const STAGES_DIR = 'server/src/engine/execution/pipeline/stages';
const NUMERAL_ROOT_FILES = ['CLAUDE.md', 'AGENTS.md', 'README.md'];
const NUMERAL_DOCS_DIR = 'docs';

/** Below this many identifiers the parser is assumed to have collapsed, not the pipeline. */
const MIN_STAGES = 10;

const STAGES_OPEN = /const\s+stages\s*:\s*readonly\s+PipelineStage\[\]\s*=\s*\[/;
const TABLE_HEADING = /^#{3,4}\s+Stage Execution Order\s*$/;
const TABLE_ROW = /^│\s*(\d+)\.\s+([A-Za-z][A-Za-z0-9]*)\*?(?:\s|│)/;
const STAGE_FILE = /^(\d{2})-.*\.ts$/;
const TEST_FILE = /\.(test|spec)\.ts$/;
const NUMERAL_SHAPES = [/\b(\d+) stages?\b/g, /\((\d+) stg\)/g];
/** Widened for BUILDER_PATH only: "23+ stages" is still a numeral claim about the array length. */
const BUILDER_NUMERAL_SHAPES = [/\b(\d+)\+? stages?\b/g, /\((\d+) stg\)/g];

/**
 * Numeral sites that are not claims about the length of the `stages` array.
 * Each entry: `file` (repo-relative), `contains` (a substring of the offending line), `reason`.
 * Empty on purpose today: the one candidate (telemetry-observability.md, "18-22 stages") was a
 * false claim about spans and was corrected rather than excused.
 */
const NUMERAL_ALLOWLIST = [];

class Refusal extends Error {}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The identifiers of the `stages` array, in order. Throws Refusal when the shape is absent. */
function parseStageIdentifiers(builderSource) {
  const open = STAGES_OPEN.exec(builderSource);
  if (open === null) {
    throw new Refusal(
      `${BUILDER_PATH}: no \`const stages: readonly PipelineStage[] = [\` block found — the ` +
        'stage contract moved or changed shape; update this validator, do not skip it'
    );
  }
  const bodyStart = open.index + open[0].length;
  const close = builderSource.indexOf('];', bodyStart);
  if (close === -1) {
    throw new Refusal(`${BUILDER_PATH}: the \`stages\` array is never closed with \`];\``);
  }
  const identifiers = builderSource
    .slice(bodyStart, close)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.replace(/,$/, ''));
  const malformed = identifiers.filter((id) => !/^[A-Za-z_$][\w$]*$/.test(id));
  if (malformed.length > 0) {
    throw new Refusal(
      `${BUILDER_PATH}: \`stages\` array holds non-identifier entries (${malformed.join(', ')}) — ` +
        'this validator reads one identifier per line'
    );
  }
  if (identifiers.length < MIN_STAGES) {
    throw new Refusal(
      `${BUILDER_PATH}: parser collapse suspected — the \`stages\` array yielded ` +
        `${identifiers.length} identifier(s), fewer than ${MIN_STAGES}. Refusing to compare ` +
        'rather than report a vacuous pass'
    );
  }
  return identifiers;
}

/** The body of a same-file method named `name`, or null when no such method is defined. */
function methodBody(source, name) {
  const decl = new RegExp(
    `^\\s*(?:(?:private|public|protected|static|async)\\s+)*${escapeRegExp(name)}\\s*\\(`,
    'm'
  );
  const match = decl.exec(source);
  if (match === null) return null;
  const open = source.indexOf('{', match.index + match[0].length);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  return null;
}

/** Resolve one identifier to its stage class name, or null. */
function resolveIdentifier(source, id) {
  const constructed = new RegExp(`const\\s+${escapeRegExp(id)}\\s*=\\s*new\\s+(\\w+)\\s*\\(`);
  const direct = constructed.exec(source);
  if (direct !== null) return { className: direct[1], via: 'new' };

  const factoryCall = new RegExp(
    `const\\s+${escapeRegExp(id)}\\s*=\\s*(?:this\\.)?(create\\w+Stage)\\s*\\(`
  );
  const factory = factoryCall.exec(source);
  if (factory === null) return null;
  const factoryName = factory[1];

  const body = methodBody(source, factoryName);
  if (body !== null) {
    const returned = [
      ...new Set([...body.matchAll(/return\s+new\s+(\w+)\s*\(/g)].map((m) => m[1])),
    ];
    if (returned.length !== 1) return null;
    return { className: returned[0], via: `${factoryName}() → return new` };
  }
  return { className: factoryName.slice('create'.length), via: `${factoryName}()` };
}

/** Ordered stage class names from the builder source. Throws Refusal on any unresolved id. */
function resolveStageClasses(builderSource) {
  const identifiers = parseStageIdentifiers(builderSource);
  const unresolved = [];
  const classes = identifiers.map((id) => {
    const resolved = resolveIdentifier(builderSource, id);
    if (resolved === null || !resolved.className.endsWith('Stage')) {
      unresolved.push(id);
      return null;
    }
    return resolved.className;
  });
  if (unresolved.length > 0) {
    throw new Refusal(
      `${BUILDER_PATH}: cannot resolve ${unresolved.length} \`stages\` identifier(s) to a ` +
        `*Stage class: ${unresolved.join(', ')}. Expected \`const <id> = new <Class>(\` or ` +
        '`const <id> = [this.]create<Name>Stage(` in the same file'
    );
  }
  return classes;
}

const stripStage = (className) => className.replace(/Stage$/, '');

/** Rows of the stage box under an H3 or H4 `Stage Execution Order` heading. Throws Refusal when absent. */
function parseDocTable(overviewSource) {
  const lines = overviewSource.split('\n');
  const heading = lines.findIndex((l) => TABLE_HEADING.test(l));
  if (heading === -1) {
    throw new Refusal(
      `${OVERVIEW_PATH}: no \`### Stage Execution Order\` / \`#### Stage Execution Order\` heading`
    );
  }
  const fenceOpen = lines.findIndex((l, i) => i > heading && /^\s*```/.test(l));
  const fenceClose = lines.findIndex((l, i) => i > fenceOpen && /^\s*```/.test(l));
  if (fenceOpen === -1 || fenceClose === -1) {
    throw new Refusal(
      `${OVERVIEW_PATH}: no fenced box under the \`Stage Execution Order\` heading`
    );
  }
  const rows = [];
  for (let i = fenceOpen + 1; i < fenceClose; i++) {
    const match = TABLE_ROW.exec(lines[i]);
    if (match !== null) rows.push({ line: i + 1, number: Number(match[1]), name: match[2] });
  }
  return rows;
}

function checkDocTable(rows, classes) {
  const violations = [];
  if (rows.length !== classes.length) {
    violations.push({
      where: `${OVERVIEW_PATH}:${rows[0]?.line ?? 1}`,
      category: 'stage-table',
      detail: `the box lists ${rows.length} stage row(s); the \`stages\` array holds ${classes.length}`,
    });
  }
  rows.forEach((row, i) => {
    if (row.number !== i + 1) {
      violations.push({
        where: `${OVERVIEW_PATH}:${row.line}`,
        category: 'stage-table',
        detail: `row "${row.number}. ${row.name}" is numbered ${row.number}; position ${i + 1} expected`,
      });
    }
    if (i < classes.length && row.name !== stripStage(classes[i])) {
      violations.push({
        where: `${OVERVIEW_PATH}:${row.line}`,
        category: 'stage-table',
        detail:
          `row ${i + 1} names "${row.name}", but stages[${i}] is ${classes[i]} ` +
          `(expected "${stripStage(classes[i])}" — class name, \`Stage\` suffix stripped)`,
      });
    }
  });
  return violations;
}

/**
 * `files` is `[{ name, source }]` for every entry of the stages directory.
 * Returns `{ violations, shapes }` where `shapes[i]` names which export form file i+1 matched.
 */
function checkStageFiles(files, classes) {
  const violations = [];
  const shapes = [];
  const stageFiles = files
    .filter((f) => STAGE_FILE.test(f.name) && !TEST_FILE.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (stageFiles.length !== classes.length) {
    violations.push({
      where: STAGES_DIR,
      category: 'stage-files',
      detail: `${stageFiles.length} NN-*.ts stage file(s); the \`stages\` array holds ${classes.length}`,
    });
  }
  stageFiles.forEach((file, i) => {
    const prefix = Number(STAGE_FILE.exec(file.name)[1]);
    if (prefix !== i + 1) {
      violations.push({
        where: `${STAGES_DIR}/${file.name}`,
        category: 'stage-files',
        detail: `prefix ${String(prefix).padStart(2, '0')} at position ${i + 1}; prefixes must run 01…${classes.length} with no gap or repeat`,
      });
    }
    const className = classes[prefix - 1];
    if (className === undefined) return;
    const cls = escapeRegExp(className);
    if (new RegExp(`export\\s+(?:abstract\\s+)?class\\s+${cls}\\b`).test(file.source)) {
      shapes[prefix - 1] = 'class';
    } else if (new RegExp(`export\\s+(?:function|const)\\s+create${cls}\\b`).test(file.source)) {
      shapes[prefix - 1] = 'factory';
    } else {
      violations.push({
        where: `${STAGES_DIR}/${file.name}`,
        category: 'stage-files',
        detail: `exports neither \`class ${className}\` nor \`create${className}\` (stages[${prefix - 1}])`,
      });
    }
  });
  return { violations, shapes };
}

/**
 * `docs` is `[{ file, text, shapes? }]` — `shapes` defaults to NUMERAL_SHAPES; the BUILDER_PATH
 * entry passes BUILDER_NUMERAL_SHAPES so a comment's "N+" phrasing is checked too. Every numeral
 * must equal `n` unless an allowlist entry covers it.
 */
function checkNumerals(docs, n, allowlist) {
  const violations = [];
  const used = new Set();
  for (const { file, text, shapes = NUMERAL_SHAPES } of docs) {
    text.split('\n').forEach((line, i) => {
      for (const shape of shapes) {
        for (const match of line.matchAll(shape)) {
          if (Number(match[1]) === n) continue;
          const excuse = allowlist.findIndex((a) => a.file === file && line.includes(a.contains));
          if (excuse !== -1) {
            used.add(excuse);
            continue;
          }
          violations.push({
            where: `${file}:${i + 1}`,
            category: 'stage-numeral',
            detail: `"${match[0]}" — the \`stages\` array holds ${n}`,
          });
        }
      }
    });
  }
  allowlist.forEach((entry, i) => {
    if (used.has(i)) return;
    violations.push({
      where: entry.file,
      category: 'stage-numeral',
      detail: `stale allowlist entry ("${entry.contains}") excuses nothing any more — delete it`,
    });
  });
  return violations;
}

function readRepo(relative) {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

function markdownUnder(relativeDir) {
  const out = [];
  const visit = (rel) => {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else if (entry.name.endsWith('.md')) out.push(child);
    }
  };
  visit(relativeDir);
  return out.sort();
}

function numeralDocs() {
  const files = [
    ...NUMERAL_ROOT_FILES.filter((f) => fs.existsSync(path.join(REPO_ROOT, f))),
    ...markdownUnder(NUMERAL_DOCS_DIR),
  ];
  return files.map((file) => ({ file, text: readRepo(file) }));
}

function stageDirEntries() {
  return fs
    .readdirSync(path.join(REPO_ROOT, STAGES_DIR))
    .map((name) => ({ name, source: readRepo(`${STAGES_DIR}/${name}`) }));
}

/** Everything the script checks, from sources handed in — the self-test drives this directly. */
function validate({ builderSource, overviewSource, stageFiles, docs, allowlist }) {
  const classes = resolveStageClasses(builderSource);
  const rows = parseDocTable(overviewSource);
  const files = checkStageFiles(stageFiles, classes);
  return {
    classes,
    shapes: files.shapes,
    violations: [
      ...checkDocTable(rows, classes),
      ...files.violations,
      ...checkNumerals(
        [...docs, { file: BUILDER_PATH, text: builderSource, shapes: BUILDER_NUMERAL_SHAPES }],
        classes.length,
        allowlist
      ),
    ],
  };
}

// --- self-test --------------------------------------------------------------------------------

const FIXTURE_NAMES = [
  'Alpha',
  'Bravo',
  'Charlie',
  'Delta',
  'Echo',
  'Foxtrot',
  'Golf',
  'Hotel',
  'India',
  'Juliet',
  'Kilo',
  'Lima',
];

function fixture(headingLevel = 3) {
  const decls = FIXTURE_NAMES.map((name, i) => {
    if (i === 2) return `    const ${name.toLowerCase()}Stage = createCharlieStage(deps);`;
    if (i === 3) return `    const ${name.toLowerCase()}Stage = this.createDeltaStage();`;
    return `    const ${name.toLowerCase()}Stage = new ${name}Stage(deps);`;
  });
  const builderSource = [
    `// Wiring produces all ${FIXTURE_NAMES.length} stages.`,
    'class Builder {',
    '  build() {',
    ...decls,
    '    const stages: readonly PipelineStage[] = [',
    ...FIXTURE_NAMES.map((name) => `      ${name.toLowerCase()}Stage,`),
    '    ];',
    '  }',
    '  private createDeltaStage(): PipelineStage {',
    "    if (!x) { return { name: 'Delta', execute: async () => {} }; }",
    '    return new DeltaResolutionStage(deps);',
    '  }',
    '}',
  ].join('\n');
  const classes = FIXTURE_NAMES.map((n, i) => (i === 3 ? 'DeltaResolutionStage' : `${n}Stage`));
  const overviewSource = [
    `${'#'.repeat(headingLevel)} Stage Execution Order`,
    '',
    '```',
    '┌──┐',
    ...classes.map((c, i) => `│${String(i + 1).padStart(2)}. ${stripStage(c)}*    Describe it │`),
    '└──┘',
    '```',
  ].join('\n');
  const stageFiles = classes.map((c, i) => ({
    name: `${String(i + 1).padStart(2, '0')}-${c.toLowerCase()}.ts`,
    source: i === 2 ? `export function create${c}() {}` : `export class ${c} {}`,
  }));
  const docs = [{ file: 'CLAUDE.md', text: `Pipeline (${classes.length} stages)` }];
  return { builderSource, overviewSource, stageFiles, docs, allowlist: [] };
}

function runSelfTest() {
  const outcome = (input) => {
    try {
      return { ...validate(input), refused: null };
    } catch (error) {
      if (error instanceof Refusal) return { violations: [], refused: error.message };
      throw error;
    }
  };
  const cases = [
    {
      label: 'consistent fixture passes (negative control; resolves new, factory, and this.method)',
      input: fixture(),
      expect: (r) => {
        assert.strictEqual(r.refused, null);
        assert.deepStrictEqual(r.violations, []);
        assert.strictEqual(r.classes[3], 'DeltaResolutionStage');
        assert.strictEqual(r.shapes[2], 'factory');
      },
    },
    {
      label: 'a reordered doc row fails, naming the row',
      input: (() => {
        const f = fixture();
        const lines = f.overviewSource.split('\n');
        [lines[4], lines[5]] = [lines[5], lines[4]];
        return { ...f, overviewSource: lines.join('\n') };
      })(),
      expect: (r) =>
        assert.ok(
          r.violations.some((v) => /row "2\. Bravo" is numbered 2; position 1/.test(v.detail))
        ),
    },
    {
      label: 'a class renamed in code only fails the doc row',
      input: (() => {
        const f = fixture();
        return {
          ...f,
          builderSource: f.builderSource.replace('new EchoStage(', 'new EchoRenamedStage('),
        };
      })(),
      expect: (r) =>
        assert.ok(
          r.violations.some((v) =>
            /names "Echo", but stages\[4\] is EchoRenamedStage/.test(v.detail)
          )
        ),
    },
    {
      label: 'a missing stage file fails',
      input: (() => {
        const f = fixture();
        return { ...f, stageFiles: f.stageFiles.filter((_, i) => i !== 6) };
      })(),
      expect: (r) =>
        assert.ok(
          r.violations.some(
            (v) => v.category === 'stage-files' && /11 NN-\*\.ts stage file/.test(v.detail)
          )
        ),
    },
    {
      label: 'a numeral off by one fails, naming file:line',
      input: { ...fixture(), docs: [{ file: 'CLAUDE.md', text: 'x\nPipeline (13 stages)' }] },
      expect: (r) => assert.ok(r.violations.some((v) => v.where === 'CLAUDE.md:2')),
    },
    {
      label: 'a "(N stg)" numeral off by one fails',
      input: { ...fixture(), docs: [{ file: 'README.md', text: 'engine (11 stg)' }] },
      expect: (r) => assert.ok(r.violations.some((v) => v.where === 'README.md:1')),
    },
    {
      label: 'a pipeline-builder.ts comment claiming N+1 stages fails, naming file:line',
      input: (() => {
        const f = fixture();
        return {
          ...f,
          builderSource: f.builderSource.replace(
            `// Wiring produces all ${FIXTURE_NAMES.length} stages.`,
            `// Wiring produces all ${FIXTURE_NAMES.length + 1}+ stages.`
          ),
        };
      })(),
      expect: (r) => assert.ok(r.violations.some((v) => v.where === `${BUILDER_PATH}:1`)),
    },
    {
      label: 'an H4 "Stage Execution Order" heading is accepted',
      input: fixture(4),
      expect: (r) => {
        assert.strictEqual(r.refused, null);
        assert.deepStrictEqual(r.violations, []);
      },
    },
    {
      label: 'an H2 "Stage Execution Order" heading is refused, not silently skipped',
      input: fixture(2),
      expect: (r) => assert.match(r.refused ?? '', /no `### Stage Execution Order`/),
    },
    {
      label: 'a stale allowlist entry fails',
      input: { ...fixture(), allowlist: [{ file: 'CLAUDE.md', contains: 'gone', reason: 'x' }] },
      expect: (r) => assert.ok(r.violations.some((v) => /stale allowlist entry/.test(v.detail))),
    },
    {
      label: 'parser collapse (3 identifiers) is refused, not passed',
      input: {
        ...fixture(),
        builderSource:
          'const a = new AStage();\nconst b = new BStage();\nconst c = new CStage();\n' +
          'const stages: readonly PipelineStage[] = [\n  a,\n  b,\n  c,\n];',
      },
      expect: (r) => assert.match(r.refused ?? '', /parser collapse suspected/),
    },
    {
      label: 'an unresolvable identifier is refused',
      input: (() => {
        const f = fixture();
        return {
          ...f,
          builderSource: f.builderSource.replace(
            'const limaStage = new LimaStage(deps);',
            'const limaStage = pick();'
          ),
        };
      })(),
      expect: (r) => assert.match(r.refused ?? '', /cannot resolve 1 .* limaStage/),
    },
  ];

  let failures = 0;
  console.log('\nvalidate:pipeline-stage-table self-test\n');
  for (const testCase of cases) {
    try {
      testCase.expect(outcome(testCase.input));
      console.log(`  PASS  ${testCase.label}`);
    } catch (error) {
      failures++;
      console.log(`  FAIL  ${testCase.label} — ${error.message.split('\n')[0]}`);
    }
  }
  const passed = cases.length - failures;
  console.log(`\n${passed}/${cases.length} cases passed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

// --- main -------------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--self-test');
  if (unknown.length > 0) {
    process.stderr.write(`Unknown argument(s): ${unknown.join(' ')}. Usage: [--self-test]\n`);
    process.exit(2);
  }
  if (args.includes('--self-test')) {
    runSelfTest();
    return;
  }

  let result;
  try {
    result = validate({
      builderSource: readRepo(BUILDER_PATH),
      overviewSource: readRepo(OVERVIEW_PATH),
      stageFiles: stageDirEntries(),
      docs: numeralDocs(),
      allowlist: NUMERAL_ALLOWLIST,
    });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    process.stderr.write(`[validate-pipeline-stage-table] REFUSED: ${error.message}\n`);
    process.exit(1);
  }

  const { classes, violations } = result;
  if (violations.length === 0) {
    process.stdout.write(
      `[validate-pipeline-stage-table] OK: ${classes.length} stages agree across ` +
        `pipeline-builder.ts, the overview stage table, ${STAGES_DIR}, and every stage numeral\n`
    );
    process.exit(0);
  }
  for (const v of violations) process.stderr.write(`${v.where}: ${v.category}: ${v.detail}\n`);
  process.stderr.write(
    `\n${violations.length} violation(s). The \`stages\` array in ${BUILDER_PATH} is the ` +
      'contract — move the doc, the files, or the numeral to it.\n'
  );
  process.exit(1);
}

main();
