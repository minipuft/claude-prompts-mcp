# Handoff Artifacts Exist

This gate reads your response, finds the `artifacts:` line under `done`, and checks that each
listed path exists relative to the server's working directory.

## What fails it

- No `artifacts:` line under `done`, or an empty one.
- A path that does not exist where the check runs.

## Operator setup

The check runs `node`, so add it to the allowlist:

```
MCP_SHELL_VERIFY_ALLOWLIST=node
```

Without it the executor refuses the command and records a failure.
