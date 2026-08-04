#!/usr/bin/env node
/**
 * Retires finished plans at release time by moving them into `plans/archive/`.
 *
 * The queue is the frontmatter, not a separate list: `status: done` IS the tag meaning
 * "retire at the next release" (~/knowledge-hub/meta/plan-frontmatter.md). There is no
 * fifth frontmatter field, because the convention is exactly four and the two plans that
 * invented one both fell off the hub board.
 *
 * WHY A PLAN CAN BE RETIRED, and why that is not just "it is finished":
 *
 *   done      → executed to completion, nothing points at it → archive
 *   reference → something still points at it (an ADR, a successor plan, a doc)
 *
 * An inbound link makes a plan load-bearing for a document that outlives it. Archiving it
 * would break that reference, which is why `--check` fails on a `done` plan that has one:
 * that plan is misclassified and belongs at `reference`, not in the archive.
 *
 * That is the whole gate. It does NOT fail merely because the queue is non-empty — `done`
 * plans exist legitimately between releases, and a check that fired on their existence
 * would be red almost always and therefore ignored.
 *
 * Usage:
 *   node scripts/retire-done-plans.js            # check: report the queue, fail on misclassification
 *   node scripts/retire-done-plans.js --apply    # move the queue into plans/archive/
 *   node scripts/retire-done-plans.js --self-test
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const PLANS_DIR = path.join(REPO_ROOT, 'plans');
const ARCHIVE_DIRNAME = 'archive';

/** Directories scanned for inbound links. A plan cited anywhere here is load-bearing. */
const LINK_SOURCES = ['plans', 'docs', 'server/src', 'server/scripts', '.github'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** Frontmatter status, or null when the file has no four-field block. */
function readStatus(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const match = text.slice(0, end).match(/^status:\s*(\S+)\s*$/m);
  return match ? match[1] : null;
}

/**
 * Files citing this plan by basename, excluding the plan itself.
 *
 * Basename rather than full path because plans cite each other relatively (`./sibling.md`)
 * while docs and memory cite them by name in prose. A basename hit is a deliberate
 * over-count: a false positive leaves a plan un-archived, which is recoverable, whereas a
 * false negative archives something still referenced and breaks the citing document.
 */
function inboundLinks(planFile, corpus) {
  const base = path.basename(planFile, '.md');
  const self = path.resolve(planFile);
  const hits = [];
  for (const file of corpus) {
    if (path.resolve(file) === self) continue;
    if (fs.readFileSync(file, 'utf8').includes(base)) hits.push(path.relative(REPO_ROOT, file));
  }
  return hits;
}

function collect() {
  const corpus = LINK_SOURCES.flatMap((dir) => walk(path.join(REPO_ROOT, dir)));
  const archiveRoot = path.join(PLANS_DIR, ARCHIVE_DIRNAME);

  const queue = [];
  const misclassified = [];

  for (const file of walk(PLANS_DIR)) {
    if (!file.endsWith('.md')) continue;
    if (file.startsWith(archiveRoot + path.sep)) continue;
    if (readStatus(file) !== 'done') continue;

    const inbound = inboundLinks(file, corpus);
    const record = { file, rel: path.relative(REPO_ROOT, file), inbound };
    if (inbound.length > 0) misclassified.push(record);
    else queue.push(record);
  }

  return { queue, misclassified };
}

/**
 * Rewrite relative markdown links so they still resolve from inside `plans/archive/`.
 *
 * Archiving preserves the subpath (`plans/techincal_debt/x.md` → `plans/archive/techincal_debt/x.md`),
 * so a link to a sibling that did NOT move gains one directory of depth. Without this the
 * archive becomes a graveyard of broken links, which is how "we kept it for reference" turns
 * into "we kept a file nobody can navigate".
 */
function rewriteRelativeLinks(text, fromDir, toDir) {
  return text.replace(/\]\((\.\.?\/[^)\s]+)\)/g, (whole, target) => {
    const absolute = path.resolve(fromDir, target);
    if (!fs.existsSync(absolute)) return whole;
    let rewritten = path.relative(toDir, absolute).split(path.sep).join('/');
    if (!rewritten.startsWith('.')) rewritten = './' + rewritten;
    return `](${rewritten})`;
  });
}

function apply(queue) {
  const moved = [];
  for (const { file, rel } of queue) {
    const subpath = path.relative(PLANS_DIR, file);
    const destination = path.join(PLANS_DIR, ARCHIVE_DIRNAME, subpath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });

    const rewritten = rewriteRelativeLinks(
      fs.readFileSync(file, 'utf8'),
      path.dirname(file),
      path.dirname(destination)
    );
    fs.writeFileSync(destination, rewritten);
    fs.unlinkSync(file);
    moved.push({ from: rel, to: path.relative(REPO_ROOT, destination) });
  }
  return moved;
}

function selfTest() {
  const sandbox = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'retire-plans-'));
  const fm = (status) => `---\ntitle: "t"\ndate: 2026-01-01\nstatus: ${status}\ntags: []\n---\n\n# t\n`;
  try {
    const nested = path.join(sandbox, 'techincal_debt');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'keep.md'), fm('reference'));
    fs.writeFileSync(path.join(nested, 'retire.md'), fm('done') + '\nSee [sib](../keep.md).\n');

    const source = path.join(nested, 'retire.md');
    const destination = path.join(sandbox, ARCHIVE_DIRNAME, 'techincal_debt', 'retire.md');
    const out = rewriteRelativeLinks(
      fs.readFileSync(source, 'utf8'),
      path.dirname(source),
      path.dirname(destination)
    );

    if (!out.includes('](../../keep.md)')) {
      throw new Error(`link not re-based for the extra archive depth: ${out}`);
    }
    if (readStatus(source) !== 'done' || readStatus(path.join(sandbox, 'keep.md')) !== 'reference') {
      throw new Error('status parsing failed');
    }
    const corpus = walk(sandbox);
    if (inboundLinks(path.join(sandbox, 'keep.md'), corpus).length !== 1) {
      throw new Error('inbound link from the sibling not detected');
    }
    console.log(
      'retire-done-plans self-test OK — parses status, detects an inbound citation, and re-bases a relative link for the added archive depth.'
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const { queue, misclassified } = collect();

  if (misclassified.length > 0) {
    console.error('[retire-done-plans] `status: done` but still referenced:\n');
    for (const { rel, inbound } of misclassified) {
      console.error(`  ${rel}`);
      for (const source of inbound.slice(0, 3)) console.error(`      cited by ${source}`);
    }
    console.error(
      '\nArchiving these would break the documents citing them. A finished plan something still\n' +
        'points at is `reference`, not `done` — see ~/knowledge-hub/meta/plan-frontmatter.md.'
    );
    process.exitCode = 1;
    return;
  }

  if (!args.includes('--apply')) {
    if (queue.length === 0) {
      console.log('retire-done-plans OK — retirement queue empty, no misclassified plans.');
      return;
    }
    console.log(`retire-done-plans OK — ${queue.length} plan(s) queued for retirement:\n`);
    for (const { rel } of queue) console.log(`  ${rel}`);
    console.log('\nRun with --apply (the release workflow does this) to move them to plans/archive/.');
    return;
  }

  if (queue.length === 0) {
    console.log('retire-done-plans — nothing to retire.');
    return;
  }
  for (const { from, to } of apply(queue)) console.log(`  archived ${from} -> ${to}`);
  console.log(`\nretire-done-plans — retired ${queue.length} plan(s).`);
}

main();
