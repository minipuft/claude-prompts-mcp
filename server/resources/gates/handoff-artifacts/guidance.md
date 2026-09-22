# Handoff Artifacts Exist

This gate reads your response, finds the `artifacts:` line under `done`, and checks that each
listed path exists relative to the server's working directory.

## What fails it

- No `artifacts:` line under `done`, or an empty one.
- A path that does not exist where the check runs.

## Operator setup

The check runs `node` against the script that ships inside this gate's own directory, which the
server resolves to an absolute path before spawning. An allowlist entry matches the whole command,
exactly or as a `*` prefix, so the entry to add is:

```
MCP_SHELL_VERIFY_ALLOWLIST=node *
```

A bare `node` authorises the command `node` and nothing else. Without a matching entry the
executor refuses the command and records a failure.
