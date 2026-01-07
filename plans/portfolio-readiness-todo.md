# Portfolio Readiness — To-Do Notes

## Completed

- [x] Author a concise case study (`docs/portfolio/case-study.md`): task, baseline, frameworks/gates applied, before/after quality or latency metrics, screenshots/logs, and any usage counts (installs, internal users).
  - **Done**: Created `docs/portfolio/case-study.md` with recursive prompt engineering narrative
  - **Content**: Problem/Solution/Results structure, 10+ quantified metrics, demo commands, technical trade-offs
  - **Dogfooding**: Case study refined using `>>readme_improver` prompt with inline gates
- [x] Surface engagement signals despite low discussions: npm downloads, install counts, or internal usage stats; add to the case study and brief mention in `README.md`.
  - **Done**: Added GitHub stars badge + collapsible Ecosystem section linking Smithery/Playbooks
  - **Current metrics** (Dec 2025): 115 stars, 27 forks, 228 npm downloads/month
  - **Indexed on**: [Smithery](https://smithery.ai/server/@minipuft/claude-prompts-mcp), [Playbooks](https://playbooks.com/mcp/minipuft-claude-prompts), DeepWiki
  - **Case study framing**: "115 GitHub stars, 27 forks in specialized MCP ecosystem; indexed on major directories"
- [x] Create demo chains for video showcases
  - **Tech Evaluation Chain** (`>>tech_evaluation_chain`) - 4-step library/framework evaluation for developers
  - **Research Chain** (`>>research_chain`) - 4-step general research workflow for non-developers

---

## Demo Videos

### Video Strategy

| Client | Priority | Target Audience | Focus |
|--------|----------|-----------------|-------|
| **Claude Code** | Primary | Developers, Twitter trend followers | Full features: hooks, chains, gates, hot-reload |
| **Claude Desktop** | Secondary | Non-developers, enterprise | Clean MCP basics, prompt management |
| **Cursor** | Optional | IDE-focused devs | 1-click install, inline workflow |

**Skip Gemini CLI** - Hooks are Claude Code-specific, not portable.

---

### Video 1: Claude Code Demo (5-7 min)

**Target**: Developers, trending Claude Code audience

**Script Outline**:

1. **Opening (30s)**
   - "I built an MCP server that turns prompts into a programmable system—versioned, hot-reloadable, with quality gates."

2. **Quick Install (30s)**
   ```bash
   # First time: add the marketplace
   /plugin marketplace add minipuft/minipuft-plugins

   # Install the plugin
   /plugin install claude-prompts@minipuft
   ```
   - Show hook catching `>>syntax` if typed incorrectly

3. **Chain Demo: Tech Evaluation (2 min)**
   ```
   >>tech_evaluation_chain library:'zod' context:'API validation in Express'
   ```
   - Step 1: Library Overview (quick scan)
   - Step 2: Technical Deep Dive (BLOCKING gate - must verify claims)
   - Step 3: Integration Assessment
   - Step 4: Recommendation with code examples
   - **Key moment**: Show gate blocking on unverified claims

4. **Inline Gates (1 min)**
   ```
   >>readme_improver content:'...' :: 'under 500 words' :: 'include Quick Start'
   ```

5. **Framework Injection (30s)**
   ```
   @CAGEERF >>deep_research topic:'MCP protocol internals'
   ```

6. **Meta-Prompt: Create Your Own (1 min)**
   ```
   >>create_prompt name:'my_validator' purpose:'validate API responses'
   ```
   - Show wizard flow → validation → auto-creation

7. **Hot Reload (30s)**
   - Edit prompt YAML in editor
   - Run immediately without restart

8. **Closing (30s)**
   - "Prompts as code. Version controlled. Quality gated. Hot reloadable."

---

### Video 2: Claude Desktop Demo (3-4 min)

**Target**: Non-developers, enterprise users, general audience

**Script Outline**:

1. **Opening (20s)**
   - "Turn Claude into a structured research assistant with reusable prompts."

2. **Setup (30s)**
   - Show JSON config in Claude Desktop settings
   - Quick server startup

3. **Research Chain Demo (2 min)**
   ```
   >>research_chain topic:'best practices for remote team management' purpose:'policy update'
   ```
   - Step 1: Initial Scan (map the landscape)
   - Step 2: Deep Investigation (BLOCKING - must cite sources)
   - Step 3: Synthesis (reconcile findings)
   - Step 4: Action Plan (concrete recommendations)

4. **Prompt Library (30s)**
   ```
   resource_manager(resource_type:"prompt", action:"list")
   ```
   - Show available prompts by category

5. **Closing (20s)**
   - "Your prompt library, managed and versioned."

---

## Demo Chains Created

### Tech Evaluation Chain (Claude Code)

**Location**: `server/resources/prompts/development/`

| Step | Prompt | Gate | Purpose |
|------|--------|------|---------|
| 1 | `library_overview` | (advisory) | Quick health check |
| 2 | `technical_deep_dive` | **Verified Claims** (BLOCKING) | Rigorous analysis |
| 3 | `integration_assessment` | (advisory) | Compatibility check |
| 4 | `tech_recommendation` | **Actionable Output** | Go/no-go decision |

**Invoke**: `>>tech_evaluation_chain library:'zod' context:'API validation'`

### Research Chain (Claude Desktop)

**Location**: `server/resources/prompts/analysis/`

| Step | Prompt | Gate | Purpose |
|------|--------|------|---------|
| 1 | `initial_scan` | (advisory) | Map knowledge landscape |
| 2 | `deep_investigation` | **Source Citations** (BLOCKING) | Evidence gathering |
| 3 | `research_synthesis` | (advisory) | Reconcile findings |
| 4 | `action_plan` | **Actionable Recommendations** | Concrete next steps |

**Invoke**: `>>research_chain topic:'remote work' purpose:'policy update'`

---

## Pending Tasks

- [ ] Add demo video links near Quick Start in `README.md` and to résumé/LinkedIn notes (keep URLs stable)
- [ ] Record Claude Code demo video (5-7 min)
- [ ] Record Claude Desktop demo video (3-4 min)
- [ ] Test both chains end-to-end before recording
- [ ] Create thumbnail/cover images for videos
- [ ] Add video timestamps to descriptions
- [ ] Cross-post to relevant communities (MCP Discord, Claude Code discussions)

---

## Key Selling Points to Emphasize

1. **Chains** - Multi-step workflows with state passing
2. **Gates** - Blocking vs advisory quality validation
3. **Frameworks** - Methodology injection (@CAGEERF, @ReACT)
4. **Hot Reload** - Edit YAML, run immediately
5. **Meta-Prompts** - `>>create_prompt` for self-improvement
6. **Version Control** - Prompts as code in git
7. **Hooks** (Claude Code only) - Catches syntax errors, reminds about chain state
