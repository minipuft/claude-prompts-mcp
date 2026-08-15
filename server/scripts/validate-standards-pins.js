#!/usr/bin/env node

/**
 * Every live reference to `minipuft/repository-standards` must name the SAME version.
 *
 * This repository consumes the standards upstream through four independent references, each
 * written in a different syntax, in a different file, updated by a different act:
 *
 *   server/package.json                    npm tarball dep      .../archive/refs/tags/vX.Y.Z.tar.gz
 *   .github/workflows/release-please.yml   pinned action        .../retire-plans@<sha> # vX.Y.Z
 *   plan-retirement.config.json            `$schema`            raw.../repository-standards/vX.Y.Z/...
 *   docs/guides/release-process.md         doc link             .../blob/vX.Y.Z/conventions/...
 *
 * Nothing compared them. Measured 2026-08-15: the tarball and the action were on v1.3.0 while the
 * `$schema` and the documentation still pointed at v1.2.0 — so the schema the config declared
 * itself against was not the schema shipped with the executable validating it, and the convention
 * a reader was sent to was not the one the tool enforced.
 *
 * That was harmless ONLY by luck: `contracts/plan-retirement.schema.json` is byte-identical
 * between v1.2.0 and v1.3.0 (sha256 verified against both tags). Harmlessness that depends on an
 * upstream file happening not to change is not a property, it is a coincidence with a deadline.
 * The next schema edit turns a stale `$schema` into a config validated against the wrong contract,
 * silently, because a JSON Schema reference that resolves is never questioned.
 *
 * WHY A VERSION AND NOT A SHA EVERYWHERE. The action is SHA-pinned because GitHub Actions
 * resolves a tag at run time and a moved tag is executable supply chain. The other three resolve
 * content, not code, and a SHA there would be unreadable. So the gate compares the DECLARED
 * version — including the `# vX.Y.Z` comment beside the SHA, which is why that comment is
 * mandatory here rather than decorative: without it the pin states nothing a human or this gate
 * can check against the other three.
 *
 * WHAT IS DELIBERATELY OUT OF SCOPE. `plans/**` and `CHANGELOG.md` are historical records — they
 * cite the version that was current when they were written and MUST NOT be rewritten to match
 * (`cleanup-standards.md` names both as exceptions). A gate that dragged them along would either
 * falsify the record or fail forever.
 *
 * RESIDUAL, stated rather than hidden: this compares declarations offline. It cannot prove the
 * SHA actually IS the commit its `# vX.Y.Z` comment claims — that needs the network. It catches
 * the drift that has actually happened here (four references, three versions, no comparison), not
 * a mislabelled pin.
 *
 * MECHANISM: script — relation — compares four unrelated file formats against each other; no
 * linter reads more than one of them, and none of them reads another
 *
 * Usage:
 *   node scripts/validate-standards-pins.js
 *   node scripts/validate-standards-pins.js --self-test
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { trackedFilesUnder } from './lib/tracked-scope.js';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const UPSTREAM = 'repository-standards';

/** Historical records: they cite the version current when written and are not brought forward. */
const EXCLUDED = [/^plans\//, /^CHANGELOG\.md$/];

/**
 * Each way a version can be declared. `kind` is reported so a failure names the syntax that
 * disagreed, not just the file — the four are edited by four different acts.
 */
const PATTERNS = [
  {
    kind: 'npm tarball',
    re: new RegExp(`${UPSTREAM}/archive/refs/tags/(v[\\d.]+)\\.tar\\.gz`, 'g'),
  },
  { kind: 'doc link', re: new RegExp(`${UPSTREAM}/blob/(v[\\d.]+)/`, 'g') },
  {
    kind: '$schema',
    re: new RegExp(`githubusercontent\\.com/minipuft/${UPSTREAM}/(v[\\d.]+)/`, 'g'),
  },
  {
    kind: 'pinned action',
    re: new RegExp(`${UPSTREAM}/\\S*@[0-9a-f]{40}\\s*#\\s*(v[\\d.]+)`, 'g'),
  },
];

/** A SHA pin with no `# vX.Y.Z` beside it declares nothing this gate or a reader can compare. */
const UNLABELLED_ACTION = new RegExp(`${UPSTREAM}/\\S*@[0-9a-f]{40}(?!\\s*#\\s*v[\\d.]+)`, 'g');

export function collectReferences(files) {
  const references = [];
  const unlabelled = [];
  for (const { file, content } of files) {
    if (EXCLUDED.some((pattern) => pattern.test(file))) continue;
    for (const line of content.split(/\r?\n/)) {
      for (const { kind, re } of PATTERNS) {
        for (const match of line.matchAll(new RegExp(re.source, 'g'))) {
          references.push({ file, kind, version: match[1] });
        }
      }
      for (const _ of line.matchAll(new RegExp(UNLABELLED_ACTION.source, 'g'))) {
        unlabelled.push({ file, line: line.trim().slice(0, 90) });
      }
    }
  }
  return { references, unlabelled };
}

export function findViolations({ references, unlabelled }) {
  const violations = [];
  // Unlabelled pins are reported FIRST, before the empty-set guard below. An unlabelled SHA pin
  // contributes no version, so a repository whose only reference is one would fall into "found
  // nothing" and be told its consumption path moved — burying the actual defect under a wrong
  // diagnosis. Caught by this file's own self-test, which is the point of having one.
  for (const entry of unlabelled) {
    violations.push(`${entry.file}: SHA pin carries no '# vX.Y.Z' comment — ${entry.line}`);
  }
  // A gate that passes when it found nothing is reporting on a repository other than this one.
  if (references.length === 0) {
    violations.push(
      `no ${UPSTREAM} references found — the consumption path moved and this gate now checks nothing`
    );
    return violations;
  }
  const versions = [...new Set(references.map((reference) => reference.version))];
  if (versions.length > 1) {
    violations.push(
      `${UPSTREAM} is referenced at ${versions.length} versions: ${versions.join(', ')}`
    );
    for (const reference of references) {
      violations.push(`  ${reference.version}  ${reference.kind.padEnd(14)} ${reference.file}`);
    }
  }
  return violations;
}

function trackedContents() {
  return trackedFilesUnder(['.'], { cwd: REPO })
    .filter((file) => !file.endsWith('.png') && !file.endsWith('.gif'))
    .map((file) => {
      try {
        return { file, content: readFileSync(path.join(REPO, file), 'utf8') };
      } catch {
        return { file, content: '' };
      }
    });
}

function runSelfTest() {
  const agreeing = [
    {
      file: 'server/package.json',
      content: `"https://x/${UPSTREAM}/archive/refs/tags/v1.3.0.tar.gz"`,
    },
    {
      file: '.github/workflows/release-please.yml',
      content: `uses: minipuft/${UPSTREAM}/actions/retire-plans@${'a'.repeat(40)} # v1.3.0`,
    },
    {
      file: 'plan-retirement.config.json',
      content: `"https://raw.githubusercontent.com/minipuft/${UPSTREAM}/v1.3.0/contracts/x.json"`,
    },
    {
      file: 'docs/g.md',
      content: `https://github.com/minipuft/${UPSTREAM}/blob/v1.3.0/conventions/x.md`,
    },
  ];
  const cases = [
    {
      rule: 'four references at one version pass',
      run: () => findViolations(collectReferences(agreeing)).length === 0,
    },
    {
      rule: 'a doc link left on an older version is reported',
      run: () => {
        const drifted = agreeing.map((entry) =>
          entry.file === 'docs/g.md'
            ? { ...entry, content: entry.content.replace('v1.3.0', 'v1.2.0') }
            : entry
        );
        return findViolations(collectReferences(drifted)).some((v) => /2 versions/.test(v));
      },
    },
    {
      rule: 'a $schema left on an older version is reported',
      run: () => {
        const drifted = agreeing.map((entry) =>
          entry.file === 'plan-retirement.config.json'
            ? { ...entry, content: entry.content.replace('v1.3.0', 'v1.2.0') }
            : entry
        );
        return findViolations(collectReferences(drifted)).some((v) => /2 versions/.test(v));
      },
    },
    {
      rule: 'a SHA pin with no version comment is reported',
      run: () =>
        findViolations(
          collectReferences([
            { file: 'w.yml', content: `uses: minipuft/${UPSTREAM}/actions/x@${'b'.repeat(40)}` },
          ])
        ).some((v) => /no '# vX\.Y\.Z' comment/.test(v)),
    },
    {
      rule: 'a stale version inside plans/ does NOT fail — historical records are excluded',
      run: () =>
        findViolations(
          collectReferences([
            ...agreeing,
            { file: 'plans/old.md', content: `${UPSTREAM}/blob/v1.0.0/conventions/x.md` },
          ])
        ).length === 0,
    },
    {
      rule: 'a stale version inside CHANGELOG.md does NOT fail',
      run: () =>
        findViolations(
          collectReferences([
            ...agreeing,
            { file: 'CHANGELOG.md', content: `${UPSTREAM}/blob/v1.0.0/x.md` },
          ])
        ).length === 0,
    },
    {
      rule: 'finding no references at all is a failure, not a vacuous pass',
      run: () =>
        findViolations(collectReferences([{ file: 'a.md', content: 'nothing' }])).length > 0,
    },
    {
      rule: 'the real repository resolves at least the four known references',
      run: () => collectReferences(trackedContents()).references.length >= 4,
    },
  ];
  let failures = 0;
  for (const { rule, run } of cases) {
    let passed = false;
    try {
      passed = run() === true;
    } catch (error) {
      console.error(`    ${error.message}`);
    }
    console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${rule}`);
    if (!passed) failures += 1;
  }
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const collected = collectReferences(trackedContents());
  const violations = findViolations(collected);
  if (violations.length) {
    for (const violation of violations) console.error(`ERROR: ${violation}`);
    process.exitCode = 1;
    return;
  }
  const version = collected.references[0].version;
  console.log(
    `PASSED: ${collected.references.length} ${UPSTREAM} reference(s) all name ${version}`
  );
}

main();
