---
title: "Primitive rework: defects and decisions left outside the plan"
date: 2026-10-04
status: reference
tags: [gates, chains, execution, frameworks, hooks]
---

# Primitive rework: defects and decisions left outside the plan

The primitive-rework plan returned to its stated objective on 2026-10-04 (owner ruling R192 in its
implementation notes). The items below were open rows of that plan, or findings of its last slice,
that fall outside the objective. Each was measured or read as stated; "read" means read in source
and not driven. Nothing here is scheduled. An item is picked up by opening it as its own fix.

## Defects a client can observe

- **A gate's declared retry limit is ignored for most gates** (was P6.294, ruling R189). It is read
  only for gates armed automatically from the registry; gates a prompt includes, gates a step
  lists and every resumed single prompt get the built-in limit of 2. Bundled gates declare 1, 2 or
  3, so honoring it changes retry budgets across the catalog. Measured.
- **A structural review's retry answer is not stored as the step's output** (was P6.299). The step
  keeps the answer that failed while the PASS closes the review. Measured.
- **A quoted argument is tokenised for operators** (was P6.100). An arrow-chain, plus or
  double-colon operator inside a quoted value is parsed as an operator. Measured once.
- **An exhausted review's reply still prints a per-gate coverage line** (was P6.293) asking for a
  verdict it refuses. Measured.
- **A bare gate action on a run holding only a detached review passes through unanswered** (was
  P6.295). Read.
- **The delegation advisory takes its gate flag from the injection decision** (was P6.301), not
  from the next step's own gates. Read.
- **A verdict sent with an answer whose shell check bounces is dropped** (was P6.83), not refused
  by name. Measured before slices 17–37; not re-driven.
- **A chain step with its own arguments under a symbolic command does not see the request's
  `options` or `inputs`** (was P6.85). Measured before slices 17–37; not re-driven.
- **An explicit step's `subagentModel` or `agentType` is dropped on a remainder-expanded step**
  (was P6.102). Measured before slices 17–37; not re-driven.
- **A subagent's reply that renders its own chain step gets no hook directive** (was P6.64).
  Measured before slices 17–37; not re-driven.
- **A shell verification on a prompt may demote its review gates** (was P6.70). Measured before
  slices 17–37; not re-driven.
- **Phase guards do not run on a resume while gates are switched off** (slice 37 finding). The
  structural check skips with "No active framework". Measured, on both the config and the runtime
  switch.
- **A run started with gates on and switched off mid-run keeps its open review**, and the verdict
  that would close it is refused (slice 37 finding). Read.
- **The shell-verify gate switch reads the launch workspace**, not the request's (slice 37
  finding), so over HTTP it can check the wrong workspace's switch. Read.

## Smaller findings

- From slice 38: `isSameInlineGate` compares a hand-written field list over a temporary gate, the
  shape row 1.6 fixed elsewhere, so a new field is ignored when a re-declared inline gate is
  judged unchanged. `framework:switch` does not list `operation`, unlike the other `framework:*`
  commands. The published description of `skip_version` still says "on update". The new
  `scripts/lib/parameter-reads/` files have no type declarations, unlike their siblings. A server
  still running pre-v35 code against a shared `state.db` writes the old projection key until it
  restarts, and updated hooks read no pending review for those rows.

- A held-final resume may re-render the last step's template above its review (was P6.63); a
  review render after an inserted or skipped node may name the wrong step's arguments (was P6.73,
  likely closed by a later ruling). Neither re-driven.
- A token-claimed run is invisible to hooks until its first call (was P6.67). By design; unpinned.
- An exhausted review cannot be joined by a gate sent without a verdict (was P6.304). Intended;
  unpinned.
- Three edges of a run's recorded framework were read and not driven (were P6.305–P6.307): the
  guidance stage's own decision on a resume, a restart that restores a saved run, and a recorded
  framework that is later deleted.
- The held-run notice's two-hold branch is no longer reachable over the transport (was P6.298);
  `styleEnhancementApplied` has a writer and no reader (was P6.300); one test counts evaluations
  by a log line (was P6.302); one validator strips comments with a whole-file regex and reported
  a problem that did not exist (was P6.296).
- On a run's first call a chain step's normal render shows the framework as a quote with no
  heading, while a resumed step shows the heading block (slice 37 finding). A FAIL retry review
  carries no system message. `getFrameworksInGuidance` has no caller.
- A `Re-run:` line carries the command text and not the call's other tool parameters (was
  P6.205). Not driven.

## Decisions that were waiting on the owner

- Whether inline gate definitions execute by default (was P6.174). Under the shipped default they
  do not, so bundled chains describe blocking gates that never run.
- Whether to retire `frameworks.injection.gateGuidance.frequency` (was P6.297). After #430 it
  changes no chain render; it is a documented config field.
- Whether `cpm rollback` reports the same version keys as the MCP tool (was P6.8). Aligning them
  changes CLI output.
- What `step_complete` means (were P6.47 and P6.62). Since #430 "advanced past" and "passed
  review" coincide.
- Whether a shell bounce beside an exhausted review names that review (was P6.71), and what a step
  whose shell check was skipped announces once its review passes (was P6.82).
- Whether a worker's edits belong in the parent's Ralph tracker (was P6.65).
- Whether run tables carry the run's own scope (were P6.163 and P6.165). A hooks contract change
  across three downstream plugins.
- Whether the handbook's ownership table names the phase-guard grader and
  `expandChainPromptNodes` (proposal R191).
