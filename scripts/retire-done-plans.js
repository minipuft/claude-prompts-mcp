#!/usr/bin/env node
/**
 * Retires finished plans at release time, sorting them out of the working set.
 *
 * The queue is the frontmatter, not a separate list: `status: done` IS the tag meaning
 * "retire at the next release". The convention it reads — four fields, the status vocabulary,
 * and the done/reference test below — is defined at:
 *
 *   https://github.com/minipuft/repository-standards/blob/main/conventions/plan-frontmatter.md
 *
 * That citation is public deliberately. This script is destined for that repository, where a
 * path into any one consumer's docs would resolve for nobody. `docs/guides/release-process.md`
 * still owns how THIS repo runs it — the workflow step, the placement on the release PR.
 *
 * WHY A PLAN LEAVES THE WORKING SET, and why that is not just "it is finished":
 *
 *   done      → executed to completion, nothing points at it → plans/archive/ (gitignored;
 *               git history is the archive, which is why a plan must be COMMITTED before it
 *               is retired — archiving an untracked file destroys it)
 *   reference → finished, but something still points at it (an ADR, a successor plan, a doc)
 *               → plans/reference/ (tracked, because its citers need it to resolve)
 *
 * Both are finished work. Neither belongs beside `active` and `backlog` plans, which is what
 * this script exists to prevent — but they leave by different doors, because an inbound link
 * makes a plan load-bearing for a document that outlives it. Archiving one would break that
 * document, which is why `--check` fails on a `done` plan that has an inbound link: that plan
 * is misclassified and belongs at `reference`, not in the archive.
 *
 * That is the whole gate. It does NOT fail merely because the queue is non-empty — `done`
 * plans exist legitimately between releases, and a check that fired on their existence
 * would be red almost always and therefore ignored.
 *
 * Usage:
 *   node scripts/retire-done-plans.js            # check: report the queue, fail on misclassification
 *   node scripts/retire-done-plans.js --apply    # move done → archive/, reference → reference/
 *   node scripts/retire-done-plans.js --self-test
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const PLANS_DIR = path.join(REPO_ROOT, "plans");
const ARCHIVE_DIRNAME = "archive";
const REFERENCE_DIRNAME = "reference";

/**
 * Directories already OUTSIDE the working set — never a source for a move.
 *
 * `archive/` and `reference/` are this script's own destinations; re-processing them would
 * nest `plans/reference/reference/`. `future/` is a deliberate holding area for speculative
 * work and is gitignored, so relocating a plan out of it into tracked `plans/reference/`
 * would silently commit a file the repo had chosen not to carry. The point of a move is to
 * clear the working set, and none of these three is in it.
 */
const SEGREGATED_DIRNAMES = [ARCHIVE_DIRNAME, REFERENCE_DIRNAME, "future"];

/** Directories scanned for inbound links. A plan cited anywhere here is load-bearing. */
const LINK_SOURCES = [
  "plans",
  "docs",
  "server/src",
  "server/scripts",
  ".github",
];

/** The published vocabulary — exactly four. `ready`, `wip`, `archived` are not statuses. */
const STATUSES = ["active", "backlog", "done", "reference"];
const REQUIRED_FIELDS = ["title", "date", "status", "tags"];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Parse the frontmatter block, reporting every way it fails the convention.
 *
 * A missing or malformed block is an ERROR, never a silent skip. Returning null here and
 * moving on — which this did until 2026-08-05 — makes a plan invisible to retirement: it is
 * never queued, never checked, and never archived, so it accumulates in the working set
 * looking exactly like a live plan. Eight plans had drifted into that state, several of them
 * finished. Absence of configuration must fail loudly, for the same reason a link scan that
 * finds nothing must not be read as "nothing is cited".
 */
function readFrontmatter(file) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.startsWith("---")) {
    return { status: null, problems: ["no frontmatter block"] };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return { status: null, problems: ["unterminated frontmatter block"] };
  }

  const block = text.slice(0, end);
  const problems = [];

  const missing = REQUIRED_FIELDS.filter(
    (field) => !new RegExp(`^${field}:`, "m").test(block),
  );
  if (missing.length > 0)
    problems.push(`missing field(s): ${missing.join(", ")}`);

  const match = block.match(/^status:\s*(\S+)\s*$/m);
  const status = match ? match[1] : null;
  if (status && !STATUSES.includes(status)) {
    problems.push(`status \`${status}\` is not one of: ${STATUSES.join(", ")}`);
  }

  return { status, problems };
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
  const base = path.basename(planFile, ".md");
  const self = path.resolve(planFile);
  const hits = [];
  for (const file of corpus) {
    if (path.resolve(file) === self) continue;
    if (fs.readFileSync(file, "utf8").includes(base))
      hits.push(path.relative(REPO_ROOT, file));
  }
  return hits;
}

function collect() {
  const corpus = LINK_SOURCES.flatMap((dir) => walk(path.join(REPO_ROOT, dir)));
  const segregatedRoots = SEGREGATED_DIRNAMES.map(
    (name) => path.join(PLANS_DIR, name) + path.sep,
  );
  const isSegregated = (file) =>
    segregatedRoots.some((root) => file.startsWith(root));

  const invalid = [];
  const doneCandidates = [];
  const relocations = [];
  const allReference = [];

  for (const file of walk(PLANS_DIR)) {
    if (!file.endsWith(".md")) continue;
    if (isSegregated(file)) continue;

    const rel = path.relative(REPO_ROOT, file);
    const { status, problems } = readFrontmatter(file);
    if (problems.length > 0) {
      invalid.push({ rel, problems });
      continue;
    }

    if (status === "done") {
      doneCandidates.push({ file, rel });
    } else if (status === "reference") {
      allReference.push({ file, rel });
      relocations.push({ file, rel });
    }
  }

  /*
   * Citations from plans that are THEMSELVES archiving do not block.
   *
   * A plan and its implementation-notes companion cite each other by convention. When both
   * finish, each names the other, so each reads as "still referenced" and neither can ever
   * retire — a deadlock that scales with every mutually-citing pair. They move together into
   * the archive preserving their subpaths, so the citation survives the move; what would
   * break a citing document is a citer that STAYS BEHIND, and only those count here.
   */
  const coMoving = new Set(
    doneCandidates.map((candidate) => path.resolve(candidate.file)),
  );

  const queue = [];
  const misclassified = [];
  for (const candidate of doneCandidates) {
    const inbound = inboundLinks(candidate.file, corpus).filter(
      (source) => !coMoving.has(path.resolve(REPO_ROOT, source)),
    );
    const record = { ...candidate, inbound };
    if (inbound.length > 0) misclassified.push(record);
    else queue.push(record);
  }

  // Advisory only: `reference` means "something points at it", so one that nothing points at
  // is misclassified in the opposite direction and is really `done`. Not a hard failure —
  // whether a plan is finished is a judgement the frontmatter author owns, and failing here
  // would block retirement on a call this script is not entitled to make.
  const orphanedReferences = allReference.filter(
    (candidate) => inboundLinks(candidate.file, corpus).length === 0,
  );

  return { queue, misclassified, relocations, invalid, orphanedReferences };
}

/**
 * Rewrite one file's relative markdown links, accounting for files that are moving.
 *
 * Two independent shifts have to compose: the CITING file may change depth (fromDir → toDir),
 * and the CITED file may itself be moving (moveMap). Handling only the first — which is all
 * the archive path ever needed, because a `done` plan has no inbound links by definition —
 * silently breaks every link into a relocating `reference` plan, and reference plans are
 * cited by definition. So the target's post-move location is resolved before the new relative
 * path is computed.
 */
function rewriteLinks(text, fromDir, toDir, moveMap = new Map()) {
  return text.replace(
    /\]\((\.\.?\/[^)\s#]+)(#[^)\s]*)?\)/g,
    (whole, target, hash) => {
      const absolute = path.resolve(fromDir, target);
      const destination =
        moveMap.get(absolute) ?? (fs.existsSync(absolute) ? absolute : null);
      if (!destination) return whole;
      let rewritten = path
        .relative(toDir, destination)
        .split(path.sep)
        .join("/");
      if (!rewritten.startsWith(".")) rewritten = "./" + rewritten;
      return `](${rewritten}${hash || ""})`;
    },
  );
}

function plannedMoves(records, destinationDirname) {
  return records.map(({ file }) => ({
    from: file,
    to: path.join(
      PLANS_DIR,
      destinationDirname,
      path.relative(PLANS_DIR, file),
    ),
  }));
}

/**
 * Perform every move as one transaction, so links are rewritten against final locations.
 *
 * Moving files one at a time would resolve each link against whatever was on disk at that
 * moment, making the result depend on iteration order: a link between two co-moving plans
 * would be re-based onto a path one of them had already left.
 */
function applyMoves(moves) {
  if (moves.length === 0) return [];

  const moveMap = new Map(
    moves.map((m) => [path.resolve(m.from), path.resolve(m.to)]),
  );

  // Markdown only. `server/src` and `.github` are scanned for CITATIONS, but rewriting a
  // `](...)` sequence inside TypeScript or YAML would be editing code on a text match.
  const candidates = new Set(
    LINK_SOURCES.flatMap((dir) => walk(path.join(REPO_ROOT, dir))).filter((f) =>
      f.endsWith(".md"),
    ),
  );
  for (const move of moves) candidates.add(move.from);

  const writes = new Map();
  for (const file of candidates) {
    const absolute = path.resolve(file);
    const destination = moveMap.get(absolute) ?? absolute;
    const text = fs.readFileSync(file, "utf8");
    const rewritten = rewriteLinks(
      text,
      path.dirname(absolute),
      path.dirname(destination),
      moveMap,
    );
    if (rewritten !== text || destination !== absolute)
      writes.set(destination, rewritten);
  }

  for (const [destination, text] of writes) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
  for (const move of moves) fs.unlinkSync(move.from);

  // .prettierignore entries are inbound path references too, just not markdown links.
  // The oscillating-file exemptions there are pinned to exact paths; moving a plan
  // without following its entry un-ignores it and validate:format blocks the release
  // PR (observed 2026-08-07, sqlite remediation plan).
  const ignorePath = path.join(REPO_ROOT, ".prettierignore");
  if (fs.existsSync(ignorePath)) {
    const original = fs.readFileSync(ignorePath, "utf8");
    let updated = original;
    for (const [from, to] of moveMap) {
      const fromRel = path.relative(REPO_ROOT, from);
      const toRel = path.relative(REPO_ROOT, to);
      updated = updated
        .split("\n")
        .map((line) => (line.trim() === fromRel ? toRel : line))
        .join("\n");
    }
    if (updated !== original) fs.writeFileSync(ignorePath, updated);
  }

  return moves.map((move) => ({
    from: path.relative(REPO_ROOT, move.from),
    to: path.relative(REPO_ROOT, move.to),
  }));
}

function selfTest() {
  const sandbox = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "retire-plans-"),
  );
  const fm = (status) =>
    `---\ntitle: "t"\ndate: 2026-01-01\nstatus: ${status}\ntags: []\n---\n\n# t\n`;
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  try {
    const nested = path.join(sandbox, "techincal_debt");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(sandbox, "keep.md"), fm("reference"));
    fs.writeFileSync(
      path.join(nested, "retire.md"),
      fm("done") + "\nSee [sib](../keep.md).\n",
    );

    const source = path.join(nested, "retire.md");
    const destination = path.join(
      sandbox,
      ARCHIVE_DIRNAME,
      "techincal_debt",
      "retire.md",
    );

    // 1. A link to a file that does NOT move is re-based for the added archive depth.
    const rebased = rewriteLinks(
      fs.readFileSync(source, "utf8"),
      path.dirname(source),
      path.dirname(destination),
    );
    assert(
      rebased.includes("](../../keep.md)"),
      `link not re-based for the extra archive depth: ${rebased}`,
    );

    // 2. A link to a file that IS moving follows it, rather than pointing at the hole it left.
    const keepDestination = path.join(sandbox, REFERENCE_DIRNAME, "keep.md");
    const followed = rewriteLinks(
      fs.readFileSync(source, "utf8"),
      path.dirname(source),
      path.dirname(destination),
      new Map([
        [
          path.resolve(path.join(sandbox, "keep.md")),
          path.resolve(keepDestination),
        ],
      ]),
    );
    assert(
      followed.includes("](../../reference/keep.md)"),
      `link did not follow the co-moving target: ${followed}`,
    );

    // 3. Anchors survive the rewrite.
    const anchored = rewriteLinks("[x](../keep.md#why)", nested, nested);
    assert(
      anchored.includes("](../keep.md#why)"),
      `anchor dropped: ${anchored}`,
    );

    // 4. Frontmatter defects are reported, not silently skipped.
    const bad = path.join(sandbox, "bad.md");
    fs.writeFileSync(bad, "# no frontmatter\n");
    assert(
      readFrontmatter(bad).problems.length === 1,
      "missing frontmatter not reported",
    );

    fs.writeFileSync(
      bad,
      '---\ntitle: "t"\ndate: 2026-01-01\nstatus: ready\ntags: []\n---\n',
    );
    assert(
      readFrontmatter(bad).problems.some((p) => p.includes("ready")),
      "out-of-vocabulary status not reported",
    );

    fs.writeFileSync(bad, '---\ntitle: "t"\ndate: 2026-01-01\n---\n');
    assert(
      readFrontmatter(bad).problems.some((p) => p.includes("status")),
      "missing status field not reported",
    );
    fs.unlinkSync(bad);

    // 5. A valid block parses.
    assert(readFrontmatter(source).status === "done", "status parsing failed");
    assert(
      readFrontmatter(path.join(sandbox, "keep.md")).status === "reference",
      "status parsing failed",
    );

    // 6. An inbound citation from a sibling is detected.
    const corpus = walk(sandbox);
    assert(
      inboundLinks(path.join(sandbox, "keep.md"), corpus).length === 1,
      "inbound link from the sibling not detected",
    );

    console.log(
      "retire-done-plans self-test OK — validates frontmatter, detects an inbound citation, " +
        "re-bases a relative link for the added archive depth, and follows a co-moving target.",
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();

  const { queue, misclassified, relocations, invalid, orphanedReferences } =
    collect();

  if (invalid.length > 0) {
    console.error(
      "[retire-done-plans] plans that do not carry valid frontmatter:\n",
    );
    for (const { rel, problems } of invalid) {
      console.error(`  ${rel}`);
      for (const problem of problems) console.error(`      ${problem}`);
    }
    console.error(
      "\nA plan without valid frontmatter is invisible to retirement — never queued, never\n" +
        "checked, never archived — so it accumulates in the working set looking live. The four\n" +
        "fields and the status vocabulary are defined at:\n" +
        "https://github.com/minipuft/repository-standards/blob/main/conventions/plan-frontmatter.md",
    );
    process.exitCode = 1;
    return;
  }

  if (misclassified.length > 0) {
    console.error("[retire-done-plans] `status: done` but still referenced:\n");
    for (const { rel, inbound } of misclassified) {
      console.error(`  ${rel}`);
      for (const source of inbound.slice(0, 3))
        console.error(`      cited by ${source}`);
    }
    console.error(
      "\nArchiving these would break the documents citing them. A finished plan something still\n" +
        "points at is `reference`, not `done`:\n" +
        "https://github.com/minipuft/repository-standards/blob/main/conventions/plan-frontmatter.md",
    );
    process.exitCode = 1;
    return;
  }

  for (const { rel } of orphanedReferences) {
    console.warn(
      `[retire-done-plans] advisory: ${rel} is \`reference\` but nothing cites it — likely \`done\`.`,
    );
  }
  if (orphanedReferences.length > 0) console.warn("");

  if (!args.includes("--apply")) {
    if (queue.length === 0 && relocations.length === 0) {
      console.log(
        "retire-done-plans OK — nothing to retire, no misclassified plans.",
      );
      return;
    }
    if (queue.length > 0) {
      console.log(
        `retire-done-plans OK — ${queue.length} plan(s) queued for archive:\n`,
      );
      for (const { rel } of queue) console.log(`  ${rel}`);
      console.log("");
    }
    if (relocations.length > 0) {
      console.log(
        `retire-done-plans OK — ${relocations.length} plan(s) queued for plans/${REFERENCE_DIRNAME}/:\n`,
      );
      for (const { rel } of relocations) console.log(`  ${rel}`);
      console.log("");
    }
    console.log(
      "Run with --apply (the release workflow does this) to move them.",
    );
    return;
  }

  const moves = [
    ...plannedMoves(queue, ARCHIVE_DIRNAME),
    ...plannedMoves(relocations, REFERENCE_DIRNAME),
  ];
  if (moves.length === 0) {
    console.log("retire-done-plans — nothing to retire.");
    return;
  }
  for (const { from, to } of applyMoves(moves))
    console.log(`  moved ${from} -> ${to}`);
  console.log(
    `\nretire-done-plans — archived ${queue.length} plan(s), relocated ${relocations.length} to plans/${REFERENCE_DIRNAME}/.`,
  );
}

main();
