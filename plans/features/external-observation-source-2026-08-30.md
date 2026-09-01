---
title: External observation source — a watcher can declare unknowns onto a running chain
date: 2026-08-30
status: backlog
tags:
  - chains
  - unknowns-ledger
  - system-control
  - http
---

# External Observation Source

Split out of `plans/features/mid-chain-unknown-surfacing-2026-08-20.md` (interview 2026-08-30).

## Idea (operator-originated)

"The server should be able to interrupt if it detects something sensitive, or a script
watching the currently running workflow should be able to." Decomposed against what exists:

| Half                                                | Existing mechanism                                                                                                                     | Status                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Server detects a condition in step output and halts | **Blocking gates** — server-side evaluation of step output, pending review, typed resolution verbs (`13-session-stage.ts`)             | Exists. Document, don't rebuild |
| An external process declares an unknown mid-run     | Observations — but `16-response-capture-stage.ts` ~258 reads them from `context.mcpRequest.observations` ONLY, i.e. the calling client | Missing: a second source        |

## Shape (to be ruled before promotion)

- A per-run **pending observations queue**, drained by stage 16 at the next step boundary and
  merged with the call's own batch before `computeUnknownLedger`. The ledger, `decideMutation`,
  and `decideInterrupt` stay unchanged — the watcher declares, the server still owns mutations.
- Enqueue path candidates: `system_control(action:"session", operation:"observe")` (today:
  list/clear/inspect/cancel) and/or an HTTP route gated by `MCP_CATALOG_WRITE_TOKEN`. Both
  need scope (`workspace_id`) and owner checks — the queue is a second writer to run state, and
  `chain_runs` is single-writer per owning PID today.
- Provenance: queued entries carry `source: 'external'` so the response and the corpus follow-on
  can tell them from the model's own declarations.

## Open questions

| #    | Question                                                                                                                          | Closes when                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | Which enqueue surface first — `system_control` (MCP client-side script) or HTTP (any process)?                                    | A concrete watcher exists and its runtime is known. ☐ (as of 2026-08-30 · flips when the first watcher script is written) |
| OQ-2 | Does a queued blocking unknown obey the same caps as a declared one, or its own?                                                  | Ruled in review against the parent plan's cap table. ☐ (as of 2026-08-30)                                                 |
| OQ-3 | Cross-process: HTTP server and STDIO server sharing one `state.db` — is the queue on the run row (visible to both) or in-process? | Decided by transport-parity review; the run row is the only cross-process option. ☐ (as of 2026-08-30)                    |

**Promotion condition**: parent plan rows 2.1-2.3 shipped AND one named watcher use case a gate
cannot express. ✗ if a release passes with no such use case.
