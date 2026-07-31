# Quality Gates: Concepts

Gates inject specific acceptance criteria into the prompt execution loop.

## Why This Matters

| Problem           | Solution            | Result                                            |
| ----------------- | ------------------- | ------------------------------------------------- |
| **Inconsistency** | Explicit Criteria   | Every output meets baseline standards             |
| **Manual Review** | Self-Correction     | Claude fixes its own mistakes before you see them |
| **Forgetfulness** | Automated Injection | "No secrets in logs" enforced on every run        |

> [!TIP]
> **Ready to use gates?** The [Gates Guide](../guides/gates.md) covers syntax, examples, and best practices for all gate types.

---

## 3 Ways to Apply Gates

Choose the tool that fits your workflow.

| Method         | Syntax                          | Best For                           |
| -------------- | ------------------------------- | ---------------------------------- |
| **Inline**     | `:: 'under 200 words'`          | Ad-hoc constraints (length, tone)  |
| **Registered** | `gates: ["code-quality"]`       | Team-wide standards                |
| **Quick**      | `gates: [{name: "Style", ...}]` | Custom checks without file editing |

---

## Precedence Ladder

When multiple sources define gates, who wins?

1.  **Inline (`::`)** — _Highest Priority_. Overrides everything else.
2.  **Template** — Defined in `prompt.yaml` (`inline_gate_definitions`).
3.  **Category** — Auto-applied by folder (e.g., `prompts/code/` → `code-quality`).
4.  **Framework** — Applied by framework (e.g., `@CAGEERF`).
5.  **Fallback** — Default gates if nothing else matches.

---

## Verification vs. Evaluation

We support two distinct types of gates:

### 1. LLM Self-Evaluation

Claude reflects on its output: _"Did I include error handling?"_

- **Pros**: Fast, flexible, understands semantics.
- **Cons**: Can hallucinate compliance.

### 2. Shell Verification (`:: verify:"cmd"`)

Runs a real command: `npm test`

- **Pros**: Ground truth. Code actually runs.
- **Cons**: Slower, requires executable environment.

> [!NOTE]
> For high-stakes evaluations, [Judge Mode](../guides/judge-mode.md) sends output to a context-isolated evaluator — preventing the LLM from rubber-stamping its own work.

---

## See Also

- **[Gates Guide](../guides/gates.md)** — Syntax, examples, canonical gates, and best practices
- **[Gate Configuration Reference](../reference/gate-configuration.md)** — Full `gate.yaml` schema and options
- **[Judge Mode](../guides/judge-mode.md)** — Context-isolated evaluation for critical checks
- **[Ralph Loops](../guides/ralph-loops.md)** — Autonomous shell verification loops
- **[Injection Control](../guides/injection-control.md)** — Control how often gate guidance injects into prompts
