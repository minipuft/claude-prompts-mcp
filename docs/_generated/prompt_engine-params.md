| Name | Type | Status | Required | Description |
| --- | --- | --- | --- | --- |
| `chain_id` | string | working | no | Resume token (chain-{prompt} or chain-{prompt}#runNumber). RESUME: chain_id + user_response only. Omit command. |
| `command` | string | working | no | Prompt ID to expand. Format: >>prompt_id key="value" \| Chains: >>s1 --> >>s2 \| Modifiers first: @Framework :: "criteria" %clean/%lean \| Shell verify: :: verify:"cmd" :preset Every step needs prompt ID prefix (>> or /). Modifiers apply to whole chain. Script tools: tool:<id> to invoke; confirm:true tools need approval. Shell verification: :: verify:"cmd" with :fast/:full/:extended presets, loop:true for autonomous. REPETITION (* N): Repeats with SAME arguments. For different args per step, use explicit --> chain syntax. CONTEXT: Each chain step receives previous step's output automatically. Arguments are optional per step. |
| `force_restart` | boolean | working | no | Restart chain from step 1, ignoring cached state. |
| `gate_action` | enum | working | no | User choice after gate retry limit exhaustion. 'retry' resets attempt count for another try, 'skip' bypasses the failed gate and continues, 'abort' stops chain execution entirely. |
| `gate_verdict` | string | working | no | Gate review verdict with flexible format support. Primary: 'GATE_REVIEW: PASS\|FAIL - reason'. Also accepts: 'GATE PASS - reason', 'GATE_REVIEW: FAIL: reason', 'PASS - reason' (minimal). |
| `gates` | array<string\|{name,description}\|gate> | working | no | Quality gates for output validation. Four formats supported:

**1. Registered IDs** (strings): Use predefined gates like 'code-quality', 'research-quality'.

**2. Quick Gates** (RECOMMENDED for LLM-generated validation): `{name, description}` - Create named, domain-specific checks on the fly. Example: `{name: 'Source Quality', description: 'All sources must be official docs'}`.

**3. Full Definitions**: Complete schema with severity, criteria[], pass_criteria[], guidance for production workflows.

**4. Shell Verification** (ground-truth validation): `:: verify:"command"` runs shell commands; exit 0 = PASS.
   - **Presets**: `:fast` (1 attempt, 30s), `:full` (5 attempts, 5min), `:extended` (10 attempts, 10min)
   - **Options**: `max:N` (attempts), `timeout:N` (seconds), `loop:true` (autonomous Stop hook)
   - **Example**: `>>fix-bug :: verify:"npm test" :full loop:true` RECOMMENDED: Quick Gates {name, description} auto-default to severity:medium, type:validation. Full schema: id, name, severity, criteria[], pass_criteria[], guidance, apply_to_steps[]. Shell Verification: Use presets for common patterns. loop:true enables autonomous retry until pass. |
| `options` | record | working | no | Execution options forwarded downstream. |
| `user_response` | string | working | no | Your completed output from executing the previous step. Paste your work here when resuming a chain. Use with chain_id; do not include command when resuming. |
