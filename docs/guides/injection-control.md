# Injection Control Guide

The server can add three kinds of guidance to your prompts automatically: reasoning frameworks (like CAGEERF), validation criteria (gates), and formatting rules (styles). This guide explains how to control how often each gets injected, where, and when to tune it.

Default settings work for most cases. Customize when you're hitting token budgets or want tighter control over multi-step chains.

## Injection Types

| Type             | What It Adds                                        | Default Frequency | Default Target |
| ---------------- | --------------------------------------------------- | ----------------- | -------------- |
| `system-prompt`  | Framework phases (CAGEERF, ReACT, etc.)             | Every 2 steps     | `steps`        |
| `gate-guidance`  | Quality validation criteria and review instructions | First step only   | `both`         |
| `style-guidance` | Response formatting rules                           | First step only   | `steps`        |

> [!NOTE]
> **Standalone prompts** (non-chain) inject all enabled types once. Frequency and target settings only apply during chain execution.

**Chain execution**: Frequency controls how often each type re-injects across chain steps.

## Configuration (config.json)

All injection settings live under the `frameworks` section:

```json
{
  "frameworks": {
    "enabled": true,
    "systemPromptFrequency": 3,
    "systemPromptTarget": "steps",
    "gateGuidanceFrequency": 0,
    "gateGuidanceTarget": "both",
    "styleGuidance": true,
    "styleGuidanceFrequency": 0,
    "styleGuidanceTarget": "steps"
  }
}
```

### Frequency

Controls how often injection occurs during chain execution:

| Value | Behavior                                 | Example                               |
| ----- | ---------------------------------------- | ------------------------------------- |
| `0`   | First step only (default for gate/style) | Inject on step 1, skip steps 2+       |
| `1`   | Every step                               | Inject on every step                  |
| `2`   | Every 2 steps                            | Inject on steps 1, 3, 5, ...          |
| `N`   | Every N steps                            | Inject on step 1, then every Nth step |

**Special case**: Gate review steps always receive gate-guidance regardless of frequency setting. The frequency only controls injection on normal execution steps.

### Target

Controls which execution contexts receive injection:

| Value   | Receives Injection          | Use When                                                                                     |
| ------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `steps` | Normal chain step execution | Default for system-prompt and style — framework and formatting only needed during generation |
| `gates` | Gate review responses only  | Rarely useful alone                                                                          |
| `both`  | Both steps and gate reviews | Default for gate-guidance — criteria needed during both generation and review                |

### Enable/Disable

| Setting                    | Controls                                      |
| -------------------------- | --------------------------------------------- |
| `frameworks.enabled`       | System-prompt injection (framework on/off)    |
| `gates.enabled`            | Gate-guidance injection (follows gate system) |
| `frameworks.styleGuidance` | Style-guidance injection                      |

## Command Modifiers (Per-Request Override)

Modifiers override config.json settings for a single execution:

| Modifier     | Effect                                                             | Use Case                           |
| ------------ | ------------------------------------------------------------------ | ---------------------------------- |
| `%clean`     | Disable ALL injection                                              | Bare prompt, minimal tokens        |
| `%lean`      | Disable system-prompt and style-guidance, keep non-framework gates | Token-efficient with quality gates |
| `%guided`    | Force ALL injection                                                | Maximum guidance                   |
| `%framework` | Force system-prompt injection                                      | Framework reinforcement            |

**Usage**: Prefix the command:

```
prompt_engine(command:"%lean >>my_prompt")
prompt_engine(command:"%clean >>step1 --> >>step2")
```

<details>
<summary><strong>Resolution Hierarchy (8 Levels)</strong></summary>

When deciding whether to inject, the system checks these levels in order. **First match wins**:

```
1. Modifiers (%clean, %lean, etc.)     ← Highest priority
2. Runtime overrides (system_control)
3. Step config (per-step rules)
4. Prompt config (the prompt's own injection block)
5. Chain config (per-chain rules)
6. Category config (per-category rules)
7. Global config (config.json)
8. System defaults (hardcoded)          ← Lowest priority
```

Most users only interact with levels 1 (modifiers) and 7 (config.json). Levels 2-6 support advanced programmatic use.

Prompt config sits above chain and category because a prompt's declaration about itself is more
specific than the chain or category it happens to run inside. It sits below step config because a
chain author's step-targeted rule is the more specific statement about that particular execution.

A rule that declares no fields is skipped rather than treated as a match, so an empty block cannot
silently shadow the tiers beneath it.

</details>

### Prompt-Level Injection (per-prompt opt-out)

A prompt declares its own injection rules in `prompt.yaml`:

```yaml
id: my_prompt
name: My Prompt
description: "..."

injection:
  system-prompt:
    enabled: false # no framework for this prompt, under any active framework
  style-guidance:
    frequency:
      mode: first-only
    target: steps
```

Each of the three injection types accepts `enabled`, `frequency`, and `target`. Unknown fields are
rejected at load time, and `conditions` is deliberately unavailable here: every condition case
describes a position within a chain rather than a property of a prompt.

**Setting `system-prompt.enabled: false` also withholds gates that score framework adherence.**
Scoring adherence to a framework that was never injected is incoherent, so those gates are
withheld together with the injection — see [ADR 0001](../adr/0001-gate-resolution-precedence.md).
Gates unrelated to framework are unaffected. `%judge` overrides the opt-out, because the judge
selection phase requires the framework to be present.

<details>
<summary><strong>Runtime Overrides (system_control)</strong></summary>

For temporary session-level adjustments without modifying config.json:

```
system_control(action:"injection", operation:"override", type:"system-prompt", enabled:false)
system_control(action:"injection", operation:"status")
system_control(action:"injection", operation:"reset")
```

Overrides support scope (`session`, `chain`, `step`) and optional TTL expiration.

</details>

## Common Configurations

### Minimal tokens (gate-only)

```json
{
  "frameworks": {
    "enabled": false,
    "styleGuidance": false
  }
}
```

### Comprehensive (every step)

```json
{
  "frameworks": {
    "systemPromptFrequency": 1,
    "gateGuidanceFrequency": 1,
    "styleGuidanceFrequency": 1
  }
}
```

### Balanced (framework every 3 steps, gates first-only)

```json
{
  "frameworks": {
    "systemPromptFrequency": 3,
    "gateGuidanceFrequency": 0,
    "styleGuidanceFrequency": 0
  }
}
```

## Relationship to Phase Guards

The `phaseGuards` config (`mode: enforce|warn|off`) controls structural validation of framework phase compliance. This is separate from injection — phase guards check whether the LLM output matches expected structure, while injection controls what guidance the LLM receives.

See [Phase Guards Guide](./phase-guards.md) for details.

## Relationship to Gates

The `gates.enabled` setting controls the entire gate subsystem, which includes gate-guidance injection. When `gates.enabled: false`, gate-guidance injection is automatically disabled regardless of frequency/target settings.

See [Gates Guide](./gates.md) for details.

---

## See Also

- **[Gates Guide](./gates.md)** — Gate types, activation rules, and gate response format
- **[Phase Guards Guide](./phase-guards.md)** — Structural validation of framework phase compliance
- **[Troubleshooting](./troubleshooting.md)** — "Framework Not Injecting" and other injection-related issues
- **[MCP Tools Reference](../reference/mcp-tools.md)** — `system_control` parameters for injection overrides
