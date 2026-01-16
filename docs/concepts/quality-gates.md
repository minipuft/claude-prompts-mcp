# Quality Gates: Concepts

> Status: canonical

Gates inject specific acceptance criteria into the prompt execution loop.

## Why This Matters

| Problem | Solution | Result |
|---------|----------|--------|
| **Inconsistency** | Explicit Criteria | Every output meets baseline standards |
| **Manual Review** | Self-Correction | Claude fixes its own mistakes before you see them |
| **Forgetfulness** | Automated Injection | "No secrets in logs" enforced on every run |

---

## 3 Ways to Apply Gates

Choose the tool that fits your workflow.

| Method | Syntax | Best For |
|--------|--------|----------|
| **Inline** | `:: 'under 200 words'` | Ad-hoc constraints (length, tone) |
| **Registered** | `gates: ["code-quality"]` | Team-wide standards |
| **Quick** | `gates: [{name: "Style", ...}]` | Custom checks without file editing |

---

## Precedence Ladder

When multiple sources define gates, who wins?

1.  **Inline (`::`)** — *Highest Priority*. Overrides everything else.
2.  **Template** — Defined in `prompt.yaml` (`inline_gate_definitions`).
3.  **Category** — Auto-applied by folder (e.g., `prompts/code/` → `code-quality`).
4.  **Framework** — Applied by methodology (e.g., `@CAGEERF`).
5.  **Fallback** — Default gates if nothing else matches.

---

## Verification vs. Evaluation

We support two distinct types of gates:

### 1. LLM Self-Evaluation
Claude reflects on its output: *"Did I include error handling?"*
- **Pros**: Fast, flexible, understands semantics.
- **Cons**: Can hallucinate compliance.

### 2. Shell Verification (`:: verify:"cmd"`)
Runs a real command: `npm test`
- **Pros**: Ground truth. Code actually runs.
- **Cons**: Slower, requires executable environment.
