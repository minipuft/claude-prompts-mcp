# Documentation Refactor Plan: Diátaxis Migration

> Status: Proposed

We are restructuring `docs/guides/` to match the **Diátaxis framework**.

## Why This Matters

| Problem | Solution | Result |
|---------|----------|--------|
| **Kitchen Sink Docs** | Split into 4 distinct modes | Clearer navigation for every user type |
| **Learner Overwhelm** | Dedicated Tutorials | Step-by-step learning without noise |
| **Expert Friction** | Dedicated Reference | Fast lookup without "getting started" fluff |
| **Maintenance Drift** | Single Source of Truth | Easier updates, less duplication |

**The Core Issue**: Currently, files like `prompt-authoring-guide.md` are 900+ lines long. They mix "How to install" (Tutorial), "Why this matters" (Concept), and "YAML Schema" (Reference). Beginners get lost in tables; experts get annoyed by intro text.

**The Fix**: A strict separation of concerns based on user intent.

---

## The New Structure

We are moving from a flat `guides/` folder to four intent-based directories:

### 1. Tutorials (Learning-Oriented)
**Goal**: "I want to learn by doing."
*Focus on the lesson, not the API.*

- `tutorials/build-first-prompt.md`
- `tutorials/create-approval-chain.md`

### 2. How-To (Problem-Oriented)
**Goal**: "I have a specific problem to solve."
*Focus on the recipe, not the concepts.*

- `how-to/add-validation.md`
- `how-to/debug-chains.md`
- `how-to/configure-custom-gates.md`

### 3. Reference (Information-Oriented)
**Goal**: "I need to look up syntax/API."
*Focus on the facts, not the story.*

- `reference/prompt-yaml-schema.md`
- `reference/chain-schema.md`
- `reference/gate-configuration.md`

### 4. Concepts (Understanding-Oriented)
**Goal**: "I want to understand how it works."
*Focus on the architecture, not the code.*

- `concepts/execution-lifecycle.md`
- `concepts/quality-gates.md`
- `concepts/hot-reload.md`

---

## Migration Plan

### Phase 1: The Big Split

We will split the three largest "kitchen sink" files first.

| Current File | New Locations |
|--------------|---------------|
| `prompt-authoring-guide.md` | `tutorials/first-prompt.md`<br>`reference/prompt-schema.md`<br>`how-to/add-validation.md` |
| `chains.md` | `concepts/chains-lifecycle.md`<br>`reference/chain-schema.md` |
| `gates.md` | `concepts/quality-gates.md`<br>`reference/gate-configuration.md` |

### Phase 2: Cleanup

1. Update `docs/README.md` index.
2. Fix broken links in `server/src/`.
3. Archive old files in `guides/` (or redirect them).

---

## Quick Start (for Contributors)

To help with this migration:

```bash
# 1. Create the new structure
mkdir -p docs/{tutorials,how-to,reference,concepts}

# 2. Pick a file and start splitting (e.g., gates.md)
# Extract the "Why" section -> concepts/quality-gates.md
# Extract the "Configuration" section -> reference/gate-configuration.md
```
