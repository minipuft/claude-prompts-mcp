## Investigate: {{statement}}

Ledger id: `{{unknown_id}}`

A previous step of this run declared this unknown as **blocking** — the run inserted this step so the unknown is answered before later steps depend on a guess.

### Do

1. **Restate** what is actually unknown, in one sentence. If the statement is ambiguous, name the reading you are investigating.
2. **Gather evidence** against the codebase and the run's context so far — read the files, run the probe, check the config. An unknown closed from memory is not closed.
3. **Answer or dismiss**. Either state the answer with the evidence that supports it, or state why the unknown does not affect the remaining steps.
4. **Name the consequence** for the steps still ahead: which step (if any) changes, and which becomes unnecessary.

### Close the ledger entry

End this step by declaring the resolution through the `observations` parameter of your next `prompt_engine` call — the server will not infer it:

```
observations: [{
  type: "unknown_resolved",
  id: "{{unknown_id}}",
  statement: "<the answer, or why it does not matter>",
  resolution: "answered" | "irrelevant"
}]
```

Use `answered` when you found the answer, and `irrelevant` when the unknown turned out not to affect the run. Declare `irrelevant` only when a downstream step genuinely no longer needs to happen — the run may retire that step on the strength of it.
