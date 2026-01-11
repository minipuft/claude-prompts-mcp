# Chain Authoring: Documentation-to-Skill Pipeline

> Status: example

Build a 4-phase chain that researches library docs and outputs Claude Code skills.

---

## The Request

```
run >>create_prompt then we will begin crafting a prompt that acts as a
scraper for creating skills... search for the latest information, scrape
docs comprehensively, read backlinks, then create a well-organized skill.md
```

Natural language → structured chain. Four phases emerged:

| Phase | Purpose |
|-------|---------|
| Discovery | Find latest version, map essential docs |
| Scraping | Fetch docs, extract APIs, follow backlinks |
| Analysis | Identify patterns, prioritize content |
| Synthesis | Create token-efficient skill files |

---

## Step 1: Create Step Prompts

Each phase becomes its own prompt. Create them first—the chain references them.

```bash
prompt_engine(command:">>create_prompt", options:{
  "id": "doc_discovery",
  "name": "Documentation Discovery",
  "category": "knowledge-capture",
  "description": "Find latest version, map essential docs, create prioritized inventory",
  "userMessageTemplate": "# Documentation Discovery: {{library_name}}\n\n**Use Context:** {{use_context}}\n\n## Tasks\n\n### 1. Version Detection\n- Search for latest stable version\n- Identify breaking changes\n\n### 2. Documentation Mapping\n- Main docs URL\n- API reference\n- Migration guides\n\n### 3. Backlinks\n- GitHub repo\n- Changelog\n- Ecosystem integrations",
  "arguments": [
    {"name": "library_name", "type": "string", "description": "Target library"},
    {"name": "use_context", "type": "string", "description": "Primary use case"}
  ]
})
```

Repeat for `doc_scraper`, `doc_analyzer`, `skill_synthesizer`. Each has focused instructions for its phase.

---

## Step 2: Create the Chain

Reference step prompts in `chainSteps`. Add gates for quality checkpoints.

```bash
prompt_engine(command:">>create_prompt", options:{
  "id": "skill_from_docs",
  "name": "Skill From Documentation",
  "category": "knowledge-capture",
  "description": "4-phase workflow: Discovery → Scraping → Analysis → Synthesis",
  "userMessageTemplate": "# Skill Creation Pipeline: {{library_name}}\n\n| Field | Value |\n|-------|-------|\n| Library | {{library_name}} |\n| Use Context | {{use_context}} |\n| Output Type | {{skill_type}} |\n| Scope | {{scope}} |\n\n## Begin Phase 1\n\nStart with documentation discovery for **{{library_name}}**.\n\nUse:\n- `WebSearch` for official docs and version\n- `context7` MCP if library indexed\n- `WebFetch` to verify URLs",
  "arguments": [
    {"name": "library_name", "type": "string", "description": "Target library"},
    {"name": "use_context", "type": "string", "description": "Primary use case"},
    {"name": "skill_type", "type": "string", "defaultValue": "skill"},
    {"name": "scope", "type": "string", "defaultValue": "global"}
  ],
  "chainSteps": [
    {"promptId": "doc_discovery", "stepName": "Phase 1: Documentation Discovery"},
    {"promptId": "doc_scraper", "stepName": "Phase 2: Comprehensive Scraping"},
    {"promptId": "doc_analyzer", "stepName": "Phase 3: Pattern Analysis"},
    {"promptId": "skill_synthesizer", "stepName": "Phase 4: Skill Synthesis"}
  ],
  "gateConfiguration": {
    "inline_gate_definitions": [
      {
        "name": "Version Verified",
        "description": "Latest version confirmed before scraping",
        "pass_criteria": ["Version number stated", "Release date verified"],
        "apply_to_steps": [1]
      },
      {
        "name": "Token Efficient",
        "description": "Output is dense and actionable",
        "pass_criteria": ["Tables over prose", "No redundant content"],
        "apply_to_steps": [4]
      }
    ]
  }
})
```

---

## Step 3: Execute

Run the chain with arguments:

```bash
prompt_engine(command:">>skill_from_docs library_name=\"Zod\" use_context=\"form validation in Next.js\"")
```

**Phase 1 output:**

```
Chain: chain-skill_from_docs#1
→ Progress 1/4
```

Execute the phase—research docs, build inventory:

```markdown
## Version Info
| Field | Value |
|-------|-------|
| Latest Stable | 4.3.5 |
| Release Date | July 2025 |
| Breaking Changes | v3→v4: String validators top-level |

## Priority 1 Docs
| Doc | URL | Purpose |
|-----|-----|---------|
| Official | https://zod.dev | Overview |
| API | https://zod.dev/api | Schema reference |
| Migration | https://zod.dev/v4/changelog | v3→v4 changes |
```

**Pass the gate and continue:**

```bash
prompt_engine(
  chain_id: "chain-skill_from_docs#1",
  gate_verdict: "GATE_REVIEW: PASS - Version 4.3.5 confirmed, 6 priority docs mapped",
  user_response: "[Phase 1 inventory output]"
)
```

```
→ Progress 2/4
```

Repeat for each phase. Gate verdicts validate quality at checkpoints.

---

## Step 4: Final Output

After Phase 4 synthesis:

```
→ Progress 4/4
✓ Chain complete
```

**Generated skill structure:**

```
skills/zod/
├── SKILL.md           # Index, quick ref, v4 gotchas
├── api-reference.md   # Primitives, composites, modifiers
└── patterns.md        # Form validation, error handling
```

**SKILL.md excerpt:**

```markdown
# Zod Skill

TypeScript-first schema validation. v4.3.5 (July 2025)

## Quick Reference
| Task | Code |
|------|------|
| Define schema | `z.object({ name: z.string() })` |
| Validate | `schema.parse(data)` or `.safeParse(data)` |
| Get TS type | `type T = z.infer<typeof schema>` |
| Email (v4) | `z.email()` NOT `z.string().email()` |

## v4 Breaking Changes
| v3 | v4 |
|----|-----|
| `z.string().email()` | `z.email()` |
| `{ message: "..." }` | `{ error: "..." }` |
```

---

## Key Patterns

| Pattern | Why |
|---------|-----|
| Step prompts first | Chain references them by `promptId` |
| Focused step instructions | Each phase has clear scope |
| Gates at checkpoints | Validate before proceeding |
| `user_response` carries output | Model context has history |
| `gate_verdict` advances chain | Self-evaluation against criteria |

---

## When to Use Chains

| Scenario | Single Prompt | Chain |
|----------|---------------|-------|
| One-shot task | ✓ | |
| Multi-phase workflow | | ✓ |
| Quality gates between phases | | ✓ |
| Reusable step prompts | | ✓ |
| Progress visibility | | ✓ |

---

## Related

- [Chains Reference](chains.md) — Schema, session management, troubleshooting
- [Gates Guide](gates.md) — Gate configuration and validation
- [Prompt Authoring](prompt-authoring-guide.md) — Creating prompts
