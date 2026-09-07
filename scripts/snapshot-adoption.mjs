#!/usr/bin/env node
/**
 * Append one adoption snapshot to the ledger beside the adoption-conversion plan.
 *
 * WHY THIS EXISTS
 * GitHub's traffic API keeps 14 days and nothing else. The acquisition-recovery plan
 * (retired 2026-09-07) ended with a scorecard whose baseline row reads "not recorded",
 * because nobody snapshotted views and clones while the window was open. Every judgement
 * that plan could make about traffic was weaker for it. This script makes the 14-day
 * numbers durable, one JSON line per run, so a later comparison is against a measurement
 * and not a memory.
 *
 * CADENCE
 * Run every Sunday (owner ruling 2026-09-07). Consecutive weekly runs overlap by 7 days,
 * which is intended: a missed week still leaves no gap. The `window_end` field is the
 * last full UTC day GitHub reports, so two runs on different weekdays remain comparable.
 *
 * SOURCES — each one and what it can and cannot say
 *   gh api traffic/views, traffic/clones   14-day window; clones are dominated by CI and
 *                                          registry crawlers, so only `uniques` is read
 *   gh api traffic/popular/referrers,paths 14-day top-10; the funnel evidence
 *   gh api stargazers (star+json)          persistent; stars in the same 14-day window
 *   api.npmjs.org                          persistent; 14-day sum, aligned to window_end
 *   gh api releases                        persistent; asset download totals
 *   gh api issues + discussions (GraphQL)  persistent; opened by a non-owner in-window —
 *                                          the plan's goal metric, with clone uniques
 *
 * Requires an authenticated `gh` with push access to the repo (traffic endpoints demand it).
 *
 * Usage: node scripts/snapshot-adoption.mjs [--dry-run] [--ledger <path>]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OWNER = "minipuft";
const REPO = "claude-prompts-mcp";
const NPM_PACKAGE = "claude-prompts";
const WINDOW_DAYS = 14;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LEDGER = resolve(
  ROOT,
  "plans/adoption-conversion-2026-09-07.ledger.jsonl",
);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ledgerIdx = args.indexOf("--ledger");
const ledgerPath =
  ledgerIdx === -1 ? DEFAULT_LEDGER : resolve(args[ledgerIdx + 1]);

function gh(...ghArgs) {
  const out = execFileSync("gh", ghArgs, { encoding: "utf8" });
  return JSON.parse(out);
}

function api(path) {
  return gh(
    "api",
    path ? `repos/${OWNER}/${REPO}/${path}` : `repos/${OWNER}/${REPO}`,
  );
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function daysBefore(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return isoDay(d);
}

async function npmDownloads(start, end) {
  const res = await fetch(
    `https://api.npmjs.org/downloads/point/${start}:${end}/${NPM_PACKAGE}`,
  );
  if (!res.ok) throw new Error(`npm api ${res.status}`);
  return (await res.json()).downloads;
}

function starsInWindow(start) {
  let page = 1;
  let count = 0;
  for (;;) {
    const batch = gh(
      "api",
      `repos/${OWNER}/${REPO}/stargazers?per_page=100&page=${page}`,
      "-H",
      "Accept: application/vnd.github.star+json",
    );
    for (const s of batch) if (s.starred_at.slice(0, 10) >= start) count += 1;
    if (batch.length < 100) return count;
    page += 1;
  }
}

function isOwnerOrBot(login) {
  return login === OWNER || /bot|renovate|release-please/i.test(login);
}

function nonOwnerIssues(start) {
  const issues = gh(
    "api",
    `repos/${OWNER}/${REPO}/issues?state=all&since=${start}T00:00:00Z&per_page=100`,
  );
  return issues.filter(
    (i) =>
      !i.pull_request &&
      !isOwnerOrBot(i.user.login) &&
      i.created_at.slice(0, 10) >= start,
  ).length;
}

function nonOwnerDiscussions(start) {
  const query = `{ repository(owner:"${OWNER}", name:"${REPO}") {
    discussions(first: 50, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { createdAt author { login } }
    } } }`;
  const data = gh("api", "graphql", "-f", `query=${query}`);
  return data.data.repository.discussions.nodes.filter(
    (d) =>
      d.createdAt.slice(0, 10) >= start && !isOwnerOrBot(d.author?.login ?? ""),
  ).length;
}

function releaseAssetDownloads() {
  const releases = api("releases?per_page=30");
  let total = 0;
  let mcpb = 0;
  for (const r of releases) {
    for (const a of r.assets) {
      total += a.download_count;
      if (a.name.endsWith(".mcpb")) mcpb += a.download_count;
    }
  }
  return { total, mcpb };
}

async function snapshot() {
  const views = api("traffic/views");
  const clones = api("traffic/clones");
  const referrers = api("traffic/popular/referrers");
  const paths = api("traffic/popular/paths");
  const repo = api("");

  const lastDay =
    views.views.at(-1)?.timestamp.slice(0, 10) ?? isoDay(new Date());
  const windowStart = daysBefore(lastDay, WINDOW_DAYS - 1);
  const prefix = `/${OWNER}/${REPO}`;

  return {
    taken_at: new Date().toISOString(),
    window_start: windowStart,
    window_end: lastDay,
    views: { count: views.count, uniques: views.uniques },
    clones: { count: clones.count, uniques: clones.uniques },
    referrers: referrers.map((r) => ({
      referrer: r.referrer,
      count: r.count,
      uniques: r.uniques,
    })),
    paths: paths.map((p) => ({
      path: p.path.startsWith(prefix)
        ? p.path.slice(prefix.length) || "/"
        : p.path,
      count: p.count,
      uniques: p.uniques,
    })),
    stars: {
      total: repo.stargazers_count,
      in_window: starsInWindow(windowStart),
    },
    forks: repo.forks_count,
    npm_downloads: {
      window: await npmDownloads(windowStart, lastDay),
      last_7d: await npmDownloads(daysBefore(lastDay, 6), lastDay),
    },
    release_assets: releaseAssetDownloads(),
    community: {
      issues_by_others: nonOwnerIssues(windowStart),
      discussions_by_others: nonOwnerDiscussions(windowStart),
    },
  };
}

function previous(path) {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  return lines.length ? JSON.parse(lines.at(-1)) : null;
}

function delta(now, before) {
  if (before === undefined || before === null) return "";
  const d = now - before;
  return d === 0 ? " (=)" : ` (${d > 0 ? "+" : ""}${d})`;
}

function report(s, prev) {
  const rows = [
    [
      "views (uniques)",
      `${s.views.count} (${s.views.uniques})`,
      delta(s.views.uniques, prev?.views.uniques),
    ],
    [
      "clone uniques",
      s.clones.uniques,
      delta(s.clones.uniques, prev?.clones.uniques),
    ],
    [
      "stars total / in window",
      `${s.stars.total} / ${s.stars.in_window}`,
      delta(s.stars.total, prev?.stars.total),
    ],
    [
      "npm 14d / 7d",
      `${s.npm_downloads.window} / ${s.npm_downloads.last_7d}`,
      delta(s.npm_downloads.window, prev?.npm_downloads.window),
    ],
    [
      "mcpb downloads (all-time)",
      s.release_assets.mcpb,
      delta(s.release_assets.mcpb, prev?.release_assets.mcpb),
    ],
    [
      "issues / discussions by others",
      `${s.community.issues_by_others} / ${s.community.discussions_by_others}`,
      "",
    ],
  ];
  console.log(
    `Adoption snapshot ${s.window_start} → ${s.window_end}${prev ? ` (Δ vs ${prev.window_end})` : " (baseline)"}`,
  );
  for (const [k, v, d] of rows)
    console.log(`  ${k.padEnd(32)} ${String(v)}${d}`);
  console.log(
    "  top referrers:",
    s.referrers
      .slice(0, 5)
      .map((r) => `${r.referrer} ${r.uniques}u`)
      .join(" · "),
  );
  console.log(
    "  top paths:    ",
    s.paths
      .slice(0, 5)
      .map((p) => `${p.path} ${p.uniques}u`)
      .join(" · "),
  );
}

const snap = await snapshot();
const prev = previous(ledgerPath);
if (prev && prev.window_end === snap.window_end) {
  console.error(
    `ledger already has a snapshot ending ${snap.window_end}; not appending`,
  );
  report(snap, prev);
  process.exit(0);
}
report(snap, prev);
if (dryRun) {
  console.log("\n--dry-run: not written");
} else {
  appendFileSync(ledgerPath, `${JSON.stringify(snap)}\n`);
  console.log(`\nappended to ${ledgerPath}`);
}
