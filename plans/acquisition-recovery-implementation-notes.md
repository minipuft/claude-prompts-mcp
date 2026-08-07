---
title: "Acquisition Recovery Plan — Listings, Metadata, README Content Pass — Implementation Notes"
plan: acquisition-recovery.md
date: 2026-08-06
status: active
tags: []
---

# Implementation Notes

Deviations, discovered constraints, unknowns, and re-measurements found while
executing the plan. Conservative option taken, logged, work continued.

## Deviations

- **2026-08-06 · G2 execution touched CHANGELOG.md** (not foreseen by the plan text): folding the
  phantom `## [3.1.2]` section into `## [Unreleased]` was required by the version reset — the
  section documented a release that never happened, and `validate:versions` reads the changelog for
  the core version's entry. One bullet moved; no content lost.
- **2026-08-06 · Unplanned CI hygiene fix in the PR range**: `git diff --check` in the classify job
  failed on markdown two-space hard breaks in three OLDER plan files
  (`cli-distribution-release-integration-2026-08-02.md`,
  `downstream-standards-federation-2026-08-02{,-implementation-notes}.md`) — not this plan's files,
  but they blocked G4 for the whole PR. Trailing whitespace stripped (`e0d32557`); prettier accepts
  the stripped form. Rendering cost: those header lines lose their hard-break, acceptable in plan
  docs.
- **2026-08-06 · Lockfile version fields synced by hand** (`npm install --package-lock-only`, root +
  server) after the 3.1.1 reset — `sync-versions.js` does not touch lockfiles (deliberately, per
  the validate-versions comment), so a manual reset like this leaves them stale unless done.

- **2026-08-06 · G4 blocker fixed in the CLI package's test fixtures**: `2d838276` (CLI stops
  creating state.db schema) updated the server-side tests but not `cli/tests/integration/`
  — whose python seeder still created the pre-scope-column `version_history` shape with
  `tenant_id='default'`. The scoped CLI reads returned empty ("No version history") and CI's
  CLI job failed 7 tests; pre-push never sees it (CLI tests are CI-only). Seeder now mirrors
  the engine DDL and pins the scope via `identity.launchDefaults.workspaceId` in the fixture
  workspace's config.json. CLI suite 75/75 locally.

- **2026-08-06 · Second G4 blocker: stale MCP tool-schema snapshot** (`validate:tool-schemas`,
  Build job). The branch's SDK/zod-4 upgrade moved all three tools' published inputSchemas from
  draft-07 to 2020-12 and added the structured `gate_verdict` object + chain `agentType`; the
  committed snapshot predated them. Re-captured against a fresh build with repo runtime-state
  moved aside (snapshot-environment lesson: the schema union depends on gate/framework state),
  verified green, committed `1d4f2e29`. Pre-commit prettier reformats the generated snapshot but
  the check compares structure, not bytes — no `.prettierignore` entry needed.

## Unknowns / gaps found during execution

- **RP behavior with a never-released manifest version** (the trap G2 closed): a manifest stating a
  version with no matching tag makes release-please's commit-range derivation undefined — the
  reason the reset went back to 3.1.1 rather than forward to 3.2.0. If a future manual publish
  pre-stages again, the manifest is the file that must NOT be pre-staged.
- **`sync-versions.js` cannot set `server/package.json` itself** — it reads its target FROM that
  file; a full reset needs `npm pkg set version=X --prefix server` first. Candidate small fix:
  accept the server package in the manifest list when a CLI version is passed.

## G4 run log

- 2026-08-06 · run 1: classify failed (PR-range trailing whitespace) → fixed `e0d32557`
- 2026-08-06 · run 2: CLI job failed (stale history fixtures) → fixed `3e7b7306`; classify/lint green
- 2026-08-06 · run 3: Build failed (stale tool-schema snapshot) → fixed `1d4f2e29`; CLI green
- 2026-08-06 · run 4 (head `a2db54cf`): in flight — first run with all three fixes; Test Suite matrix
  has not yet completed on any run of this PR

## Release-PR phase (post-merge, 2026-08-06/07)

- Merge `9029fb4d` landed as a MERGE COMMIT deliberately — release-please reads conventional
  commits and the `Release-As: 3.2.0` footer from main history; a squash would have collapsed both.
- RP opened #197 titled `chore(main): release 3.2.0` — the Release-As pin held; every version
  surface bumps 3.1.1→3.2.0 including BOTH server.json fields (G3 wiring proven live). RP merged
  its generated commit list into the hand-written Unreleased sections and retitled the block.
- **Retracted trap (2026-08-07): "RP's PR gets no CI" was a misdiagnosis.** The
  `RELEASE_PLEASE_TOKEN` PAT (set 2026-01-14) already makes RP's PRs trigger workflows — #197 was
  authored by minipuft and its CI run started 4s after open. What looked like "no CI" was the
  window before the classify job registered the four check contexts: `gh pr checks` lists only
  REGISTERED check runs, and BLOCKED means "required checks pending", not "never coming". The
  close/reopen was unnecessary churn that cancelled a healthy run. Real lesson: before declaring
  a workflow untriggered, check `gh run list` for the head branch — not `gh pr checks`.
- **Trap: `gh pr merge` on a BLOCKED PR exits 0** while printing an --auto/--admin hint — it
  no-ops without failing, so any merge automation must verify `state == MERGED` afterward, not
  trust the exit code. Bit twice before the loop verified state.
- Release PR merged as SQUASH to match the 3.1.1 precedent (`chore(main): release 3.1.1 (#191)`,
  single parent).

## Token audit (2026-08-07, on owner question)

- `RELEASE_PLEASE_TOKEN` proven live today (#197 authored under it, CI triggered);
  `NPM_TOKEN` proven live 2026-08-03 (v3.1.1/v3.1.0 publishes). Both set 2026-01-14 → no 30/90-day
  expiry, long-lived. Repo side cannot see future expiry — only the owner's token settings pages
  can. Failure mode to watch: an expired PAT makes release-please silently fall back to
  `github.token`, and THEN release PRs genuinely get no CI (the thing 2026-08-06 misdiagnosed).

## Release-PR unblock #2 + process corrections (2026-08-07)

- **Release PR blocked by validate:format**: the new retire-finished-plans release step moved the
  oscillating sqlite plan to `plans/reference/` but `.prettierignore`'s exemption was pinned to the
  old path — un-ignored, the file oscillates and fails format. Fixed on the RP branch (`59c0951b`,
  ignore entry follows the file); durable fix `e747c1a3` teaches retire-done-plans.js to follow
  .prettierignore path entries (self-test green).
- **Merge loop retired**: replaced watch-and-merge shell loops with `gh pr merge --squash --auto`
  — GitHub merges server-side when checks pass; the earlier loop also silently spun because
  `gh pr checks --json` errored into its retry branch.
- **Owner correction (process)**: plan/notes flushes are EDITS, not commits — batch doc commits at
  milestones (tier close / PR / release), never one per stop-hook firing. Root cause of the firing
  loop fixed in `~/.claude/hooks/planning/plan-sync-stop.py`: the tracker only saw Edit/Write tool
  calls, so Bash-mediated notes writes never cleared the tripwire; the hook now takes disk truth
  (notes mtime vs pending source mtimes) and self-clears. 32 hook tests pass.

## G5 blocker — npm trusted publishing vs the rename (2026-08-07, OWNER ACTION)

- v3.2.0 publish failed: npm-publish.yml uses OIDC Trusted Publishing (NOT the NPM_TOKEN secret —
  the earlier token audit was wrong about which credential this path uses), and npm's trusted
  publisher binding still names `minipuft/claude-prompts`. Post-rename the OIDC claim says
  `claude-prompts-mcp` → npm answers 404 on PUT by design.
- Owner fix: npmjs.com → package claude-prompts → Access → Trusted Publisher → repository =
  `minipuft/claude-prompts-mcp` (workflow npm-publish.yml, environment npm). Then re-run the
  failed workflow run — release/tag/tarball are all correct.
- Rename lesson for the funnel: the repo-rename blast-radius list must include EXTERNAL bindings
  keyed to the repo identity (npm trusted publisher; anything OIDC-bound), not just URLs in files.

## Release completion fixes (2026-08-07, PR #198)

- **G5 CLOSED**: npm latest = 3.2.0, `mcpName` verified inside the published tarball (unpacked
  `npm pack claude-prompts@3.2.0`). Trusted-publisher binding fixed by owner on npmjs.com.
- **G7 blocker was a caught landmine**: `resolvePackageRoot()` (3c2bd7ff) requires package.json
  beside dist/ for identity; the plugin-dist staging never shipped one, so the dist smoke test
  failed the extension publish — and would otherwise have shipped a 3.2.0 plugin failing on every
  marketplace install. Fix: stage server/package.json + assert it in both validate blocks.
- **G6 regression**: Dependabot REOPENED 11 protobufjs alerts (4 high, GHSA ≤8.0.1 code injection)
  on merge — the OTel exporter chain resolves protobufjs@8.0.1. Fix: range-keyed override
  `protobufjs@^8.0.0 → ^8.0.2` (resolves 8.7.1 ×11); the ^7 copy under otlp-transformer 0.213
  keeps its major. Lesson: reopened alert numbers BELOW the known set mean a merge re-introduced
  a previously-resolved range — check `npm ls` paths, and local `npm audit` can lag Dependabot's DB.
- **PR #198** carries both; auto-merge armed as MERGE COMMIT (squash on a long-lived branch
  strands its commits and hides the fix() types from release-please's next changelog).
- After merge: `gh workflow run extension-publish.yml -f version=3.2.0` re-attaches .mcpb + CLI
  assets to the existing release (its workflow_dispatch exists for exactly this).

## 3.2.1 finalize (2026-08-07) — the actual ship event

- Chain: #198 (dist layout + protobufjs) merged → RP #199 → v3.2.1 tagged → npm publish ✓ (trusted
  publisher rebound by owner) → extensions ✓ after two more fixes:
  - **Downstream sync "propagation" error was a script bug**: `npm install --package-lock-only`
    never re-resolves a range-satisfying lock; six retries were idempotent no-ops reading
    "resolved 3.1.1". Fix `npm update <pkg>` (#200), proven live on gemini-prompts. All three
    downstream syncs green on the recovery dispatch.
  - **Third staging location missing package.json**: dispatch-only `claude-code-plugin` job failed
    its smoke the same way plugin-dist had; fixed (cb9faf8b).
  - **Second rename-identity casualty**: minipuft-plugins' consumer contract pinned
    `claude-prompts.git` as the required marketplace source; sync PR #8 blocked until the contract
    followed the rename (fixed on the PR branch). Rename blast-radius rule: enumerate EXTERNAL and
    cross-repo bindings keyed to repo identity (npm trusted publisher, consumer contracts), not
    just in-file URLs.
- Gates G1-G7 ✓ (see plan table); G8 ✓ pending only raw.githubusercontent cache expiry after
  marketplace sync PR #8 merged with all downstream mains at 3.2.1.

## Validation runs

- 2026-08-06 20:23 · `python3 - <<'EOF' p = 'plans/acquisition-recovery.md' s = open(p).read() s = s.replace("""| G8 | **Distribution check gr` · ran
- 2026-08-06 19:14 · `cd ~/.claude/hooks && python3 -m pytest tests/ -q 2>&1 | tail -2; echo '{"session_id": "1618e512-748b-4fd2-8c06-097a2513` · ran
- 2026-08-06 18:40 · `WT=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1618e512-748b-4fd2-8c06-097a25130316/scratchpad/rp-wt` · ran
- 2026-08-06 18:38 · `echo '{"session_id": "1618e512-748b-4fd2-8c06-097a25130316"}' | python3 ~/.claude/hooks/planning/plan-sync-stop.py; echo` · ran

- 2026-08-06 17:49 · `npm run build >/dev/null 2>&1 && NODE_OPTIONS="--experimental-vm-modules" npx jest --config jest.config.cjs 2>&1 | tail ` · ran
- 2026-08-06 17:48 · `cd cli && NODE_OPTIONS="--experimental-vm-modules" npx jest --config jest.config.cjs tests/integration/new-commands.test` · ran
- 2026-08-06 17:45 · `npm test 2>&1 | grep -E "✕|FAIL|● " | head -20` · ran
- 2026-08-06 17:45 · `grep -A6 '"scripts"' package.json && npm test 2>&1 | tail -12` · ran
- 2026-08-06 17:45 · `cd /home/minipuft/Applications/claude-prompts-mcp/cli && npx jest tests/integration/new-commands.test.ts 2>&1 | tail -15` · ran

- 2026-08-06 17:42 · `for f in plans/cli-distribution-release-integration-2026-08-02.md plans/downstream-standards-federation-2026-08-02-imple` · ran

- 2026-08-07 · Plan-sync marker: the `cli/tests/integration/new-commands.test.ts` edit is fully
  flushed (logged above, committed `3e7b7306`); no further chat-only state pends against it.

- 2026-08-07 · Not plan-tracked: plan-sync hook message compressed to dynamic-facts + one-line action (owner: stable protocol text should not re-print per firing).

- 2026-08-07 · QUEUED (post-3.2.1, owner-agreed direction): retire the standalone CLI release asset + Node ≥18.18 surface. Evidence: bundled cpm.js crashes on Node 20 at startup (ERR_UNKNOWN_BUILTIN_MODULE, node:sqlite — proven in docker node:20-slim); the surface has shipped broken since the node:sqlite migration with zero reports. Plan: align cli floor to >=22.13, drop release-asset steps + prepare:release-artifacts + curl docs section + CLAUDE.md boundary row; cpm stays as the npm-delivered scripting/CI layer (validate, history/rollback, rename/move — things direct YAML edits cannot do).
