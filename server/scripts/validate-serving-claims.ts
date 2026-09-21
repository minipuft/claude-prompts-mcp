#!/usr/bin/env tsx
/**
 * An operator-facing string may not promise that a write will SERVE without naming what it beat.
 *
 * WHY THIS EXISTS. When workspace overlays started outranking the writable root (P4.27), every
 * sentence in this codebase that said "your copy takes precedence" stopped being derivable from
 * the fact of the write: a `resource_manager` write lands in the PRIMARY, and the primary is
 * neither the top of the order nor the bottom. P4.34 fixed five such sentences and closed on the
 * claim that it had enumerated the class. It had not — P4.39 found four more, one of them
 * outright false (`category-manager`'s `inspect` told an operator their copy would take
 * precedence while the overlay that declared the category went on declaring it). The class has
 * produced this defect faster than two rows could list it, so the deliverable is the predicate,
 * not the edits.
 *
 * THE SHAPE. A promise phrase — "takes precedence", "now serves", "is served again" — asserts a
 * ranking outcome. It is honest in exactly two situations: the string NAMES the thing it outranks
 * ("takes precedence over the bundled one", "X outranks Y"), so a reader can check it; or the
 * string is produced by {@link SANCTIONED_RENDERER}, whose whole contract is that its caller
 * hands it the root the loader actually served the id from. Anything else is a rank asserted from
 * the fact of writing, which is the defect.
 *
 * WHAT IT READS, AND WHAT IT CANNOT SEE. String and template literals under `src/`, via the
 * TypeScript AST. Three blind spots, stated so nobody rediscovers them:
 *
 *   1. COMMENTS ARE OUT OF SCOPE, deliberately. `src/` carries several TRUE comments about
 *      unrelated precedence ("Directory takes precedence over file with same ID",
 *      "Prompt-level override takes precedence"), and a check that flagged those would be turned
 *      off inside a week. P4.34's falsifier did name comments; this narrows that to the half a
 *      machine can decide, and the docstrings that quote the removed wording are why.
 *   2. A SUBSTITUTION IS OPAQUE. `${outranksClause}` could carry the qualifier and this gate
 *      would not see it, so such a string reports. That is a false ALARM, which is cheap — spell
 *      the comparand out in the literal, or route through the renderer.
 *   3. IT CANNOT TELL A TRUE UNQUALIFIED CLAIM FROM A FALSE ONE. It requires the comparand to be
 *      NAMED, not that the naming be correct. `takes precedence over the moon` passes. Naming is
 *      the property that makes the claim checkable by a reader, and checkable is as far as a
 *      lexical gate reaches.
 *
 * `--self-test` drives the predicate over the pre-fix text of every site that motivated it — the
 * two P4.34 repair responses, the category `inspect` line, and both bundled-delete refusals — and
 * over each one's fixed form. A gate that does not report its own motivating instances is not a
 * gate, so those cases are the file's own falsifier and they run on every invocation of it.
 *
 * MECHANISM: script — relation — compares string literals across every file under `src/` against
 * one predicate; no linter rule can express "this literal must name its comparand".
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = path.join(SERVER_ROOT, 'src');

/**
 * Phrases that assert a ranking or serving OUTCOME to an operator.
 *
 * Lower-cased substring matches. Every entry was observed in this repository as a shipped
 * sentence; none is speculative. "serves" alone is deliberately absent — "Nothing currently
 * serves `<id>`" is a report, not a promise, and keying on the bare verb would flag it.
 */
const PROMISE_PHRASES: readonly string[] = [
  'takes precedence',
  'take precedence',
  'now serves',
  'serves your copy',
  'served from your copy',
  'is served again',
  'will serve',
  'then serves',
];

/**
 * Tokens that make a promise checkable, by naming the other side of the comparison.
 *
 * `precedence over ` (with the trailing space) rather than a list of specific comparands: the
 * property is that SOMETHING is named, and enumerating the legitimate comparands would turn this
 * into a vocabulary list that goes stale the first time a fourth root kind appears.
 */
const QUALIFIER_TOKENS: readonly string[] = ['precedence over ', 'outranks', 'outranked'];

/**
 * The one function allowed to state a serving outcome without naming a comparand in the literal.
 *
 * Its input IS the measurement — `formatRepairServingLine(id, writtenRoot, servedFrom)` receives
 * the root the loader stamped on the definition it served, read back after the reload — so its
 * strings are derived from what happened rather than from the fact of writing. Anchored by NAME
 * and asserted to exist: renaming it without updating this constant fails loudly rather than
 * silently widening the exemption to nothing.
 */
const SANCTIONED_RENDERER = 'formatRepairServingLine';

/** Where the sanctioned renderer must live, relative to `server/`. */
const SANCTIONED_RENDERER_FILE = path.join('src', 'mcp', 'tools', 'shared', 'quarantine-report.ts');

/**
 * Directories whose contents nobody may edit at the site a finding would name.
 *
 * `_generated/` is written by `npm run generate:contracts` from `tooling/contracts/*.json`, and
 * this repository's second core principle forbids hand-editing it — so a finding there is
 * unactionable where it is reported and would sit red until someone turned the gate off.
 *
 * THE BLIND SPOT THAT BUYS. The contract JSON those files are generated FROM is not scanned, and
 * it carries at least one unqualified precedence claim today: `prompt-engine.json`'s `options`
 * description says "inline command arguments take precedence" without naming `options` as what
 * they beat. That is an argument-precedence claim rather than a root-precedence one, so it is not
 * the defect class this gate was built for — but it is the same shape, it is operator-facing, and
 * closing it means scanning `tooling/contracts/` and regenerating. Stated here rather than
 * silently excluded, so the next pass finds it written down instead of rediscovering it.
 */
const UNEDITABLE_DIRS: readonly string[] = [
  path.join('src', 'mcp', 'contracts', 'schemas', '_generated'),
];

export interface ServingClaimFinding {
  readonly file: string;
  readonly line: number;
  readonly phrase: string;
  readonly text: string;
}

function typescriptFilesUnder(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...typescriptFilesUnder(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** True for the node kinds that contribute literal text to a message. */
function isMessagePart(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

/** True when `node` is a `a + b` expression, which is how every multi-line message here is built. */
function isConcatenation(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;
}

/**
 * The literal text under one node, with `${...}` substitutions dropped.
 *
 * Substitutions are dropped rather than rendered as a placeholder token, so a qualifier can never
 * be satisfied by punctuation this function invented — see blind spot 2 in the header.
 */
function literalText(node: ts.Node): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => span.literal.text).join(' ');
  }
  if (isConcatenation(node)) return `${literalText(node.left)} ${literalText(node.right)}`;
  return '';
}

/**
 * Whether this node is the OUTERMOST part of one message.
 *
 * A message assembled as `'a' + 'b' + 'c'` must be judged whole: the promise can sit in one
 * literal and its qualifier in the next, and judging each literal alone would report a sentence
 * that names its comparand one line down. So a part whose parent is also a concatenation is
 * skipped, and the root of the chain carries the whole text.
 */
function isMessageRoot(node: ts.Node): boolean {
  if (!isMessagePart(node) && !isConcatenation(node)) return false;
  return node.parent === undefined || !isConcatenation(node.parent);
}

/** True when `node` sits inside the sanctioned renderer's body. */
function insideSanctionedRenderer(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) &&
      current.name !== undefined &&
      current.name.getText(current.getSourceFile()) === SANCTIONED_RENDERER
    ) {
      return true;
    }
  }
  return false;
}

/** Every unqualified serving promise in one file's string literals. */
export function findServingClaims(fileName: string, source: string): ServingClaimFinding[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const findings: ServingClaimFinding[] = [];

  const visit = (node: ts.Node): void => {
    if (isMessageRoot(node)) {
      // Whitespace collapsed BEFORE matching. Concatenated parts are joined with a space and the
      // parts themselves usually end in one, so `'…takes precedence ' + 'over the bundled…'`
      // produced a double space and `precedence over ` missed a string that plainly names its
      // comparand. Measured on this gate's own first run against a sentence written to pass it.
      const text = literalText(node).toLowerCase().replace(/\s+/g, ' ');
      const phrase = PROMISE_PHRASES.find((candidate) => text.includes(candidate));
      const qualified = QUALIFIER_TOKENS.some((token) => text.includes(token));
      if (phrase !== undefined && !qualified && !insideSanctionedRenderer(node)) {
        findings.push({
          file: fileName,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          phrase,
          text: literalText(node).replace(/\s+/g, ' ').trim().slice(0, 160),
        });
      }
      // Not returning: a nested message can sit inside a template substitution of this one, and
      // the substitution's text was dropped above, so it has to be judged on its own.
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

// ============================================================================
// Self-test — the motivating instances, in both directions
// ============================================================================

const wrap = (body: string): string => `function render(id: string, root: string) {\n${body}\n}\n`;

interface SelfTestCase {
  readonly name: string;
  readonly source: string;
  readonly reports: boolean;
}

/**
 * Every case that motivated this gate, pre-fix and post-fix.
 *
 * The pre-fix sources are the SHIPPED text, copied from the commits that removed them — not a
 * paraphrase. A predicate tuned against a paraphrase proves nothing about the sentence that was
 * actually wrong.
 */
function selfTestCases(): SelfTestCase[] {
  return [
    {
      name: 'P4.34 gate/framework repair — "which takes precedence, so <id> now serves your copy"',
      source: wrap(
        'return `\\n🚧 **The refused file was in another root and was not touched.** This repair wrote ` +\n' +
          '  `\\\\`${root}\\\\`, which takes precedence, so \\\\`${id}\\\\` now serves your copy. ` +\n' +
          '  `\\\\`${root}\\\\` stays quarantined.\\n`;'
      ),
      reports: true,
    },
    {
      name: 'P4.34 repaired branch — "<id> is served again"',
      source: wrap(
        'return `\\n🩹 **Repaired**: \\\\`${root}\\\\` now loads; its quarantine record is cleared ` +\n' +
          '  `and \\\\`${id}\\\\` is served again.\\n`;'
      ),
      reports: true,
    },
    {
      name: 'P4.39 site 1 — category inspect, "which then takes precedence"',
      source: wrap(
        'return `  - Source Root: ${root} (read-only here) — an update writes your own ` +\n' +
          '  `copy under ${root}, which then takes precedence`;'
      ),
      reports: true,
    },
    {
      name: 'P4.39 site 3 — prompt bundled-delete, bare "your copy takes precedence"',
      source: wrap(
        'return `To change how ${id} behaves for you, update it: the update copies it into your ` +\n' +
          '  `root first and your copy takes precedence. There is no way to make it stop resolving.`;'
      ),
      reports: true,
    },
    {
      name: 'P4.39 site 4 — framework protected-delete, bare "your copy takes precedence"',
      source: wrap(
        'return `Update it instead — the update copies it into your own resources root first ` +\n' +
          '  `and your copy takes precedence.`;'
      ),
      reports: true,
    },
    {
      name: 'FIXED FORM — the comparand is named on a later concatenated literal',
      source: wrap(
        'return `Update it instead: your copy is written to ` +\n' +
          '  `your own root and takes precedence over the bundled one.`;'
      ),
      reports: false,
    },
    {
      name: 'FIXED FORM — the outranking root is named',
      source: wrap(
        'return `\\\\`${id}\\\\` is still served from ${root}, which outranks ${root} — the copy ' +
          'this repair wrote is NOT what answers.`;'
      ),
      reports: false,
    },
    {
      name: `EXEMPT — the same claim inside ${SANCTIONED_RENDERER}, whose input is the measurement`,
      source: `function ${SANCTIONED_RENDERER}(id: string, root: string) {\n  return \`\\\`\${id}\\\` is served from your copy in \${root}.\`;\n}\n`,
      reports: false,
    },
    {
      name: 'EXEMPT — a report, not a promise: "Nothing currently serves <id>"',
      source: wrap(
        'return `Nothing currently serves \\\\`${id}\\\\` — no root yielded a definition.`;'
      ),
      reports: false,
    },
    {
      name: 'BLIND SPOT, asserted — a comment making the same claim is NOT reported',
      source: wrap('// Directory takes precedence over file with same ID\nreturn `ok`;'),
      reports: false,
    },
  ];
}

function selfTest(): number {
  let failed = 0;
  for (const testCase of selfTestCases()) {
    const findings = findServingClaims('probe.ts', testCase.source);
    const ok = findings.length > 0 === testCase.reports;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`);
    if (!ok) failed += 1;
  }

  // The live tree must be clean — the check the gate exists to make.
  const live = run(true);
  console.log(
    `${live === 0 ? 'PASS' : 'FAIL'}  this checkout states no unqualified serving promise`
  );
  if (live !== 0) failed += 1;

  return failed === 0 ? 0 : 1;
}

function run(quiet = false): number {
  const files = typescriptFilesUnder(SCAN_ROOT);
  const findings: ServingClaimFinding[] = [];
  let sanctionedRendererSeen = false;

  for (const file of files) {
    const relative = path.relative(SERVER_ROOT, file);
    const source = readFileSync(file, 'utf8');
    if (
      relative === SANCTIONED_RENDERER_FILE &&
      source.includes(`function ${SANCTIONED_RENDERER}`)
    ) {
      sanctionedRendererSeen = true;
    }
    if (UNEDITABLE_DIRS.some((dir) => relative.startsWith(`${dir}${path.sep}`))) continue;
    findings.push(...findServingClaims(relative, source));
  }

  // A null result needs a positive control. The exemption is keyed on a NAME, so a rename would
  // make it match nothing — the gate would go on passing while the one sanctioned way to state a
  // serving outcome had quietly become unreachable, and every future claim would be written
  // by hand again.
  if (!sanctionedRendererSeen) {
    console.error(
      `✖ \`${SANCTIONED_RENDERER}\` was not found in ${SANCTIONED_RENDERER_FILE}. That function ` +
        `is the one measured way to state a serving outcome and this gate exempts it by name, so ` +
        `its absence means the exemption matches nothing and the check is not observing what it ` +
        `claims. Update SANCTIONED_RENDERER if it moved.`
    );
    return 1;
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `✖ ${finding.file}:${finding.line} promises "${finding.phrase}" without naming what it ` +
          `outranks:\n    ${finding.text}`
      );
    }
    console.error(
      `\nA write lands in the WRITABLE root, which workspace overlays outrank ` +
        `(\`shared/utils/resource-root-lookup.ts\` §resourceRootPrecedence), so the fact of ` +
        `writing does not establish which copy serves. Either name the comparand in the literal ` +
        `("takes precedence over the bundled one", "X outranks Y"), or route the sentence ` +
        `through \`${SANCTIONED_RENDERER}\` with the root the loader actually served the id from.`
    );
    return 1;
  }

  if (!quiet) {
    console.log(
      `✅ Serving claims: ${files.length} files scanned, every precedence or serving promise ` +
        `either names its comparand or is rendered from a measured serving root.`
    );
  }
  return 0;
}

// Guarded: `findServingClaims` is exported, and a module-scope exit would terminate any process
// that imported it rather than running it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
