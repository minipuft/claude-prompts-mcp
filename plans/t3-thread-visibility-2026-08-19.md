---
title: "T3 thread visibility — make >> resolution legible, and right-size the t3-code MCP surface"
date: 2026-08-19
status: active
tags: []
---

# T3 thread visibility — make `>>` resolution legible, and right-size the t3-code MCP surface

**Work type**: fix (hook output routing) + config (MCP tool surface)
**Ruling this plan exists to execute**: the `>>` visibility gap is a **routing** defect in
`prompt-suggest.py`, not a T3 rendering gap and not a fork item. The human-readable line is
already computed — it is emitted on the one channel T3 discards. Move it; do not build a renderer.

## Problem

Using `>>prompt` inside a T3 thread shows the user nothing about what was resolved: which prompt
matched, what argument values bound, or — on a miss — what was suggested instead. The same
invocation in the Claude Code CLI shows all of it. Separately, T3 injects a 14-tool MCP server
into every session, most of which is never wanted.

## Discovery evidence (probe-backed, 2026-08-19)

Read from T3's shipped sourcemaps (`sourcesContent` present) and a read-only snapshot of
`~/.t3/userdata/state.sqlite`.

- **The hook emits two channels, and they diverge on the hit path.** `hooks/prompt-suggest.py`
  returns `systemMessage` (human-readable: `[>> prompt_engine] <id> | args…` plus chain preview)
  and `hookSpecificOutput.additionalContext` (the `<CALL-TOOL>` directive for the model).
  On the **unknown-prompt** path both fields are assigned the _same_ string
  (`prompt-suggest.py`, unknown-prompt early return) — which is exactly why `>>test_defult`
  surfaced its "Did you mean" and a successful invocation surfaces nothing.
- **T3 never renders hook output — at all.** `ClaudeAdapter.ts:3146-3175` emits `hook.started`,
  `hook.progress`, `hook.completed` runtime events. The web client has no consumer for any of
  them (only `hookName` matches are git hooks in `GitActionsControl.tsx`). Empirically:
  `select … where kind like '%hook%'` over `projection_thread_activities` returns **0 rows**
  against 723 activity rows. Nothing is stored, so nothing can render.
- **`additionalContext` does reach the thread**, because it is injected into the conversation
  rather than carried as a hook event. That is the working channel, and it is already proven by
  the miss path.
- **The t3-code MCP token is per-session and expiring.** `McpSessionRegistry.ts:124,146` mints
  `crypto.randomBytes(32)` → `Bearer <token>`, stores only its SHA-256 hash, and ages entries by
  `lastAliveAt`. `ClaudeAdapter.ts:4181` injects `{ "t3-code": { type: "http", url, headers:
{ Authorization } } }` into each spawned session.
- **`strictMcpConfig: true` is probe-only.** It appears in `ClaudeProvider.ts:616` on the
  capabilities health check (which also sets `disableAllHooks`), not on real sessions — so
  user-scope MCP config is not suppressed in normal threads.
- **The server exposes 14 tools, one toolkit** (`src/mcp/toolkits/preview/tools.ts`):
  `preview_status, _open, _navigate, _resize, _set_appearance, _snapshot, _click, _type, _press,
_scroll, _evaluate, _wait_for, _recording_start, _recording_stop`.

## Rows

### ✗ 1 — Install t3-code MCP globally

`✗ KILLED (2026-08-19 · the bearer token does not exist until T3 opens a session, is 32 random
bytes stored only as a hash, and expires on liveness — a static global registration has nothing
valid to write. Inside T3 the server is already auto-injected per session, so there is nothing to
install; outside T3 there is no browser tab for the tools to drive. · revives if T3 ships a
stable/long-lived token or a non-preview toolkit worth reaching from plain CLI sessions)`

Replacement action, one line: confirm presence rather than install — in a T3 thread, `preview_status`
resolving proves the injection worked.

### ✓ 2 — Cut the t3-code tool surface to what is wanted

`~/.claude/settings.json` → `permissions.deny`. Keep the five that serve the plan-viewer workflow;
deny the nine that are page-driving automation:

```
keep : preview_status, preview_open, preview_navigate, preview_snapshot, preview_set_appearance
deny : mcp__t3-code__preview_click,  mcp__t3-code__preview_type,
       mcp__t3-code__preview_press,  mcp__t3-code__preview_scroll,
       mcp__t3-code__preview_evaluate, mcp__t3-code__preview_wait_for,
       mcp__t3-code__preview_recording_start, mcp__t3-code__preview_recording_stop,
       mcp__t3-code__preview_resize
```

Rationale for the split: `preview_evaluate` runs arbitrary JS in the tab and `_click/_type/_press`
are annotated `Tool.Destructive` in T3's own source; none are needed to open t3-md at a plan.
Flips if a task genuinely needs page automation — then deny-list narrows to `_evaluate` only.

**✓ 2026-08-19** — nine entries appended to the existing `permissions.deny` array in
`~/.claude/settings.json` (which already held `WebFetch`; extended, not replaced). Verified: file
re-parses as JSON, `deny` now holds 10 entries, and the five keepers are absent from it.

### ✓ 3 — Echo the resolved prompt + values into the thread ← **the actual ask**

In `prompt-suggest.py`, the hit path currently sends the human-readable line only to
`systemMessage`. Prepend it to `additionalContext` as well, above the `<CALL-TOOL>` block, so it
lands on the channel T3 shows. `system_message` is already computed at that point — this is a
concatenation, not new formatting logic.

Content to surface: prompt id · bound argument values · operators (`@framework`, `#style`,
`::gate`, `*N`, `==>`) · chain preview when present · `missing:[…]` when required args are absent.

**✓ 2026-08-19** — `additionalContext` is now `f"{system_message}\n{directive}"`; `system_message`
is the value already computed one line above, so no formatting was duplicated. The directive keeps
the trailing position so the blocking instruction is read last. Live drive against the real cache:
`>>strategicImplement` renders id, the full argument list, and `missing:["task"]`;
`>>content_analysis content:"…" --> >>notes` renders the 2-step chain preview, the operator line,
and the bound value.

### ✓ 4 — Make the miss path consistent and slightly richer

The miss path already reaches the thread. Bring it to parity with row 3 by appending each
suggestion's argument signature, so a corrected re-invocation can be typed without a second
lookup. `format_arg_signature()` already exists and does exactly this.

**✓ 2026-08-19** — extracted `format_unknown_prompt_message()` beside the other `format_*`
functions rather than inlining the loop into `main()`, which keeps the miss path testable without
driving stdin. Reuses `format_arg_signature()`; no second formatter written. Live drive:
`>>test_defult` now returns `>>test_default count:number`, `>>code_review_test target*:string, …`
— required arguments carry `*`.

### ✓ 5 — Unbounded substring word-overlap makes every query match something

**REOPENED 2026-08-19 by owner ruling** ("in the future i will fix this at the source"). The kill
below was my judgement and is superseded, not deleted — it was also wrong about the mechanism.

> _Superseded:_ `✗ KILLED (2026-08-19 · `>>zzzqqq_no_such_thing` still returns three suggestions,
so the empty-suggestions branch almost never fires. Killed rather than fixed — a lenient matcher
that always offers a next move beats a dead-end message.)`

**Root cause, measured 2026-08-19** — not leniency by design. The word-overlap term scores on
unbounded substring containment in both implementations:

```
qw in iw or iw in qw          hooks/lib/cache_manager.py:246-250
iw.includes(w) || w.includes(iw)   command-parser.ts:604-606
```

No minimum word length, so any two-letter query word matches broadly. `>>zzzqqq_no_such_thing`
splits to `[zzzqqq, no, such, thing]`; `"notes".includes("no")` is true, scoring 30 and clearing
the `score > 0` filter. That is exactly the live output — `note_integration`, `note_refinement`,
`notes`. The Levenshtein term is already correctly thresholded (`max(3, len/2)`) in both; only the
word-overlap term is unbounded.

**Three implementations exist, and they are hand-mirrored** — `cache_manager.py:210` states
"Same algorithm as TypeScript generatePromptSuggestions()" in its own docstring, which is drift by
construction:

| Site                                                        | Algorithm                           | Can return empty? |
| ----------------------------------------------------------- | ----------------------------------- | ----------------- |
| `hooks/lib/cache_manager.py:210`                            | prefix / word-overlap / levenshtein | effectively no    |
| `server/src/engine/execution/parsers/command-parser.ts:588` | same, mirrored by hand              | effectively no    |
| `server/src/shared/utils/errorHandling.ts:584`              | pure levenshtein, hard `<= 2`       | yes               |

The third already behaves the way the fix wants and nothing routes prompt-id suggestions through
it. Fixing at the source means one scorer, not three — a minimum word length on the overlap term
(2 chars is too short; 3–4 is the likely floor), and the hook consuming that result rather than
re-deriving it.
**✓ 2026-08-19 — fixed at the source.** Falsifier met, both halves:

```
>>zzzqqq_no_such_thing  ->  Unknown prompt 'zzzqqq_no_such_thing'. No similar prompts found.
>>test_defult           ->  Did you mean: >>test_default count:number, ...
```

What shipped:

|                                      |                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `registries/suggestion-scoring.json` | **new** — SSOT for all eight scoring constants, carrying the measurement in its `rationale` field                          |
| `command-parser.ts:588`              | reads the contract by import assertion (same mechanism as `operator-patterns.ts:10`); floor applied to the overlap term    |
| `hooks/lib/suggestion_scoring.py`    | **new** — runtime loader mirroring `operators.py`, with defaults for an unreadable contract                                |
| `hooks/lib/cache_manager.py:210`     | reads the contract; the docstring's unenforceable parity claim replaced with a pointer                                     |
| `errorHandling.ts`                   | **−69 lines** — the "third implementation" had zero callers; deleted with its private Levenshtein rather than consolidated |

**Authored vs measured**: the row authored "one scorer, not three". Measured — there were **two**
live scorers, one dead, and a fourth unrelated one (`gate-reference-resolver.ts:19`, gate ids, a
different domain, untouched). The parameters are now single-source; the traversal is still written
twice on purpose, because the hook's early return deliberately avoids a server round-trip for a
prompt that does not exist.

**Coverage gap this exposed**: the pre-existing test `'no suggestions for completely unrelated
input'` used `xyzzy123` — a _single_ token, which never reaches the word-overlap term. It passed
throughout the entire lifetime of the defect. Multi-token nonsense is where the term bites, and
that case now has a test on both sides.

### ☐ 6 — The echoed prompt id is case-folded, the command is not

`[>> prompt_engine] strategicimplement` renders lowercase while the directive below it carries
`command:">>strategicImplement"`. `detect_prompt_invocation()` lowercases for cache lookup and the
display reuses that value. Cosmetic, pre-existing, and newly _visible_ because row 3 put the line
in front of the user — copying the echoed id gives a name that differs from what was typed.
Verification: `>>strategicImplement` echoes the id with its original casing while cache lookup
stays case-folded.
_(as of 2026-08-19 · flips when someone copies the echoed id and it round-trips unchanged)_

## Sequencing

Rows 3 and 4 touch one file and one function region — do them together, in that order. Row 2 is
independent config and can land any time. Row 1 is closed.

Validation for 3/4 is the same probe in both cases: run `>>` in a T3 thread and read the thread,
not the CLI. A green run in this terminal proves nothing about the surface that was broken.

## Open markers

- ☐ Row 2 keep/deny split is a judgement from tool annotations, not from observed use
  _(as of 2026-08-19, deny list now live · flips when any workflow actually needs a denied tool —
  at which point move that one tool back and leave the rest denied)_
- ☐ Whether `additionalContext` renders inline in a T3 thread as it does in the CLI transcript
  _(as of 2026-08-19 · flips on the first `>>` run in a thread after row 3 lands — if it does not
  render, the routing fix is insufficient and the ceiling is T3's, which reopens the fork question
  for `ActivityPayloadProjection.ts` only)_
  **Owner acceptance criterion, stated 2026-08-19**: carrying the line on both channels is
  acceptable _provided the lines appear and are displayed to the user_. So the check is display,
  not mechanism — duplication across channels is not itself a defect to fix.
