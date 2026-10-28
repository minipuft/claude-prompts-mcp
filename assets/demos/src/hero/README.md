# Hero demo — source

The README's hero clip is a **real Claude Code session**, recorded once with asciinema and
rendered as often as needed. Nothing here is a screen capture, and no render re-runs the model.

| File                        | Role                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fixture/`                  | The `greeter` project the session works in. Its tests describe behaviour `src/greeter.js` does not implement, so `npm test` is red by construction                                                                                                                                                                                               |
| `env.sh`                    | Isolated environment: fresh `MCP_WORKSPACE` and `MCP_RUNTIME_ROOT` under `/tmp/cpm-hero`, shell-verify allowlist of exactly `npm test`, `MCP_RESOURCES_PATH` unset so the operator's own library never leaks into the take                                                                                                                       |
| `record.sh`                 | Builds the demo root, generates `mcp.json` (this checkout's `server/dist`) and `settings.json` (the plugin's `hooks.json` with the root resolved and every hook wrapped by `hooktrace.sh`), starts Claude Code in a sized tmux pane and the trace pane in a second one, records both with `asciinema3 rec --headless`, injects markers into both |
| `drive.sh`                  | Types the storyboard into the session pane and waits on **screen content**, never on fixed sleeps. Drops one marker per beat; the `verdict` marker fires when the server's own `shell_verify` line reaches the trace                                                                                                                             |
| `hooktrace.sh` + `trace.py` | The trace pane. The wrapper passes each hook through untouched and appends what went in and out to `trace.jsonl`; `record.sh` appends the server's `shell_verify` log lines; `trace.py` prints one plain line per event                                                                                                                          |
| `markers.mjs`               | Writes the beat markers into a cast as asciicast v3 `m` events; the trace cast gets the same markers through its own start-time offset                                                                                                                                                                                                           |
| `beats.json` + `warp.mjs`   | Per-beat speed and idle cap, the title card, one caption per beat, and the scenes where the trace pane slides in. The session cast is re-timed once and writes a time map; the trace cast is mapped through it, so both stay on one clock                                                                                                        |
| `compose.mjs` + `render.sh` | `hero.cast` → `hero.warped.cast` → `session.mp4`; `trace.cast` → `trace.warped.cast` → `trace.mp4`; compose lays the trace beside the session (slide-in scenes, captions, title) → `assets/demos/hero-demo.mp4`, `.gif`                                                                                                                          |
| `hero.cast` + `trace.cast`  | The committed sources. Re-render from them; re-record only when the UI or the story changes                                                                                                                                                                                                                                                      |

## Storyboard — one take, every primitive

| #   | Beat (marker) | On screen                                                                                                           | Speed                        | Shows                                             |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| 1   | `open`        | `!npm test` in Claude Code: three red tests                                                                         | 1x                           | the stakes, no model turn                         |
| 2   | `status`      | `>>status` typed in chat; the hook routes it to `system_control`; the server answers with prompts, framework, gates | 2x                           | `>>` routing, `system_control`, hooks             |
| 3   | `author`      | one sentence asks for a new prompt; `resource_manager` creates `implement_feature` v1                               | 3x, hold on the confirmation | authoring through MCP, no file edits              |
| 4   | `run`         | `>>implement_feature … @ReACT :: verify:"npm test" --> >>review`; the model implements from the description         | 3x                           | prompt args, `@framework`, `::` gate, `-->` chain |
| 5   | `verdict`     | the shell gate runs `npm test`; FAIL bounces back, the model fixes, PASS                                            | 1x                           | ground-truth verification, self-correction        |
| 6   | `complete`    | step 2 reviews the diff with the code-quality gate, chain complete                                                  | 1.5x                         | chain lifecycle end                               |

Target length after warp: 40–60 s. If the model passes the gate on the first attempt, that is
the take; nothing is staged (the hasscheck rule: no fabricated output). The caption names the
model that was recorded.

## Two tracks: the session and what happens under it

The session pane keeps tool results collapsed (`verbose: false`), so the chat reads as a chat.
What the hooks and the server did is a second recording, the trace pane, laid beside the session
only where a feature is the point: it slides in from the right for the beats `beats.json`
names under `scenes`, holds for `hold` seconds, and slides out. Each scene carries its own
caption on the panel, and each beat a caption on the session (`captions`), so a viewer sees
what the moment is before reading the screen. The clip opens on a title card (`title`) that
says what the recording is.

The trace pane's lines come from two sources, both real: `hooktrace.sh` wraps every plugin hook
and writes its input and output to `trace.jsonl`; the server logs one `shell_verify` line per
gate run (`pipeline-builder.ts`, `onExecuted`), which `record.sh` tails into the same file.
Nothing on that pane is typed.

## The take loop

Every take, rehearsal or final, goes round the same loop. The loop is the standard; the
storyboard is the input.

1. **Storyboard** names the beats and, for each, the screen text that proves it happened
   (the driver's `wait_for` regexes are those lines; a beat without one cannot be waited on).
2. **Record** with `record.sh`. The driver drops a marker per beat and keeps its own trace.
3. **Grade from frames, not from the log.** Render each beat (`agg --select marker:a..marker:b`),
   extract one frame per beat, and look at it. Every defect in this harness was found in a frame
   and invisible in the driver trace.
4. **Fix the harness or the product, never the recording.** A wrong wait, a hidden result, a
   model guessing because a hook misreported: change the script or the code, then retake. The
   cast is never edited by hand.
5. **Review bundle** for the owner: one `evidence.json` per take under `.grade/<date>/<slice>/`
   with a beat timeline, the old/new pair, the size measurement and an interview; serve it with
   the evidence-report renderer and record the answers beside it.
6. **Ship** when the interview says so: `render.sh`, swap the README caption, commit cast and
   GIF together. For a playing video in the README, `publish.sh` uploads the mp4 the way the
   web editor does (GitHub plays only `user-attachments` URLs; a repo-relative mp4 or a release
   asset is a download link) and prints the URL to paste into the `<video src>`; the asset is
   private to the uploader until the README references it, and each run mints a new URL.

Rehearse on haiku (five rounds for this take), record the shipped take on the model the caption
names.

## Record

```bash
MODEL=sonnet bash assets/demos/src/hero/record.sh          # full take → hero.cast
MODEL=haiku  bash assets/demos/src/hero/record.sh --smoke  # boots, routes >>status, quits
bash assets/demos/src/hero/render.sh                        # GIF + MP4, no API calls
bash assets/demos/src/hero/publish.sh                       # upload hero-demo.mp4 to GitHub user-attachments, print the URL
```

Needs on PATH: `claude`, `tmux`, `asciinema3` (asciinema ≥ 3.0 musl build), `agg` (musl build;
the gnu build wants glibc 2.38), `vhs` ≥ 0.10, `ffmpeg`, `jq`, `node` ≥ 22, Fira Code installed.

## Cutting without re-recording

- MP4 is transcoded from the agg GIF. Replaying the cast inside a VHS tape rendered scrambled text:
  VHS sizes the terminal in pixels, so the 120x36 grid did not survive. Keep it for
  deterministic CLI tapes, not for cast playback.
- Per-feature clips: `agg --select marker:run..marker:complete hero.warped.cast gate-loop.gif`.
- Re-pace: edit `beats.json` (speed factor and idle cap per beat), run `render.sh`.
- Drop a beat: `"author": {"drop": true}`.
- Move or re-word a scene or caption: `scenes` / `captions` in `beats.json`, run `render.sh`.
- A scene with `freeze: true` holds the session on its marker frame for `hold` seconds, dimmed to
  `sceneDim`, while the pane plays the trace's next `spread` real seconds through the pause; the
  session resumes when the pane leaves. Without `freeze` the pane slides over the running session
  (the 2026-10-21 cut), which pulled the reader off the client mid-read and hid what ran under it.
- A scene's `highlights` tie the two tracks together: `{"track":"session","match":"Review verdict:","rows":4}`
  keeps those rows at full brightness inside the dim (a spotlight) and outlines them; a `trace`
  highlight outlines the pane's matching line for as long as it is on screen, following it as
  the pane scrolls. Rows come from `screen.py` (pyte, with tmux's scroll sequences added), so a
  match is text as rendered, not a pixel guess; `last: true` picks the last occurrence and
  `before: n` extends the span upward. A match that finds nothing warns and is skipped.
- Colour by kind: `highlightColors` maps `prompt`, `framework`, `gate`, `chain` to a colour and a
  highlight names its `kind` (or a literal `color`); `text: true` boxes only the matched
  characters, so one command line can carry all four. `legend: true` prints the colour key on
  the pane. `highlightStyle` draws the kind marks as `marker` (translucent fill, chosen 2026-10-27
  over underline, outline and box), and `rowStyle` the primary row marks as `box`. The chain
  command is marked as four whole blocks, arguments included (owner ruling 2026-10-27: the line
  reads as its grammar). The status beat plays as a flash (`speed` 12): the chain command shows routing
  better than `>>status` did, and the hook only routes it, the server still answers it.
- Render a rehearsal without touching the README assets:
  `CAST=/tmp/cpm-hero/smoke.cast TRACE_CAST=/tmp/cpm-hero/smoke-trace.cast OUT=/tmp/out bash render.sh`.

## Measured while building (2026-10-20)

- Claude Code's trust dialog defaults to **No, exit**; the driver presses Down then Enter.
- Typing `npm test` as chat makes the model explore the repo with an arbitrary Bash command and
  hit a permission prompt. `!npm test` (shell passthrough) runs it in the terminal directly.
- `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` must be unset when the recorder itself runs inside
  a Claude Code session, or the nested launch is refused.
- The operator's statusline and the "Update installed" banner render in the take; set
  `DISABLE_AUTOUPDATER=1` and an empty `statusLine` in the generated settings for a clean frame.
- `set -o pipefail` with `pane | grep -q` reports every match as a miss: `grep -q` exits on the
  first hit, tmux gets SIGPIPE, and pipefail returns tmux's status. Three smoke takes timed out on
  text that was on screen. The driver greps a captured string instead.
- `--settings` adds to the operator's user settings; the global gate-pointer hooks fired inside
  the demo session and the model narrated them. `--setting-sources project` excludes user
  settings while the `--settings` file still loads.
- Sending `!npm test` with `tmux send-keys -l` does not enter Claude Code's shell passthrough;
  the model received it as a message and implemented the fix unasked. The opening beat now runs
  `npm test` in the plain shell before `claude` is launched.
- The `>>` hook answered `>>status` with "Unknown prompt" because built-ins have no catalog row,
  and the model ran `git status` instead. Fixed in `hooks/lib/builtin_commands.py` (pinned to
  the server parser by `hooks/tests/test_builtin_commands_parity.py`); the demo exposed it.
- `wait_for` must `return 0` after its `until` loop: an until-loop's status is its body's last
  command, the false timeout test, so every successful wait read as a failure.
- ctrl+o opens Claude Code's full-screen transcript view, which does not accept input; the
  driver stalled a whole take there. The first take used `"verbose": true` to put tool results
  on screen; that filled the frame with JSON receipts and the operator's home paths, so the
  shipped take keeps results collapsed and shows the inner workings on the trace pane instead.
- With tool results collapsed, the `verdict` beat cannot be waited on from the session pane. The
  driver waits for the server's own `shell_verify` log line in `trace.jsonl`, which is also the
  frame the viewer should hold on.
- A backgrounded `tail -F` that inherits the recorder's stdout keeps the caller's pipe open after
  the take; a tool invoking `record.sh` then never sees it finish. The tailer runs under `setsid`
  with its output detached and is killed as a group.
- `asciinema3 rec --idle-time-limit` compresses idle at RECORD time, per cast, so two casts of
  one session drift apart and wall-clock markers land late. Record without it; `warp.mjs` caps
  idle once, after both casts carry the same markers.
- Claude Code prints "tmux focus-events off · add 'set -g focus-events on'" into the frame unless
  the session has `focus-events on`.
- Under WSL2 the wall clock is corrected in forward jumps of about 3 s (ten seconds lost over
  one take) while asciinema timestamps monotonically, so `date`-based markers landed late and the
  two casts disagreed. Markers and cast start times read `/proc/uptime` (`now_mono` in `env.sh`).
- `agg --idle-time-limit` caps idle again at render time, per cast; the trace pane is idle most
  of the take, so its video ran ahead of the session's. Idle is capped once, in `warp.mjs`; agg
  renders with the limit effectively off.
- The first sonnet take showed the chain's gate review asking for a verdict but never the gate
  running: a reply carrying `user_response` and `gate_verdict` in one call opened the review
  without running its checks (`plans/chain-step-gates-dropped-by-script-tools-2026-10-15.md`,
  second shape). Fixed in `gate-verdict-processor.ts` on 2026-10-21; the demo is what made the
  gap visible.
- `record.sh` wipes `/tmp/cpm-hero` on every run; keep frames, renders and kept casts under a
  different directory (`/tmp/cpm-hero-scratch` while iterating).
- Rehearsal timings on haiku (2026-10-21, take 5): open 0 s · status 7 s · author 16 s · run 27 s
  · verdict 47 s · complete 69 s · end 74 s, before warping.
