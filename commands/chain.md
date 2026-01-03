---
name: chain
description: Execute a prompt chain with CAGEERF methodology
arguments:
  - name: steps
    type: string
    description: "Chain definition using --> syntax (e.g., '>>analyze --> >>implement --> >>test')"
---

Execute a prompt chain using the specified steps.

Use the `mcp__claude-prompts-mcp__prompt_engine` tool with:
- `command`: "{steps}"

Follow the chain execution, completing each step before resuming with the chain_id for the next step.
