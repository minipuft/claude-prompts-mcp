# readme_improver

## Description
Rewrites documentation to align with the project's 'Builder/Hacker' ethos: practical, concise, quick-start focused, and free of enterprise jargon.

## User Message Template
Refactor or generate a README based on the following content and context, strictly adhering to the project's "Builder/Hacker" style guide.

**Context/Location:** {{context}}
**Input Content:**
{{content}}

## Style Guidelines

### 1. Core Philosophy: "Builder/Hacker" Tone
- **Anti-Pattern**: "Enterprise Marketing" (e.g., "Leveraging orchestrated synergy for performance-forward solutions").
- **Pattern**: Direct, active, practical (e.g., "Hot-reloads prompts instantly. No restarts required.").
- **Rule**: Focus on *utility*. Tell the user what it does and how it solves their specific problem (e.g., "Stop copy-pasting prompts").

### 2. Structure Priorities
**For Root/User-Facing READMEs:**
1.  **Hook**: One sentence. What is it?
2.  **Value**: Two sentences. Why do I need it?
3.  **Quick Start**: **Crucial**. The first major section must be code to install/connect.
4.  **Visuals**: Add a placeholder `![Demo GIF/Screenshot]` where a visual proof of value (like hot-reload) belongs.
5.  **Features**: Bullet points only.
6.  **Links**: direct links to `docs/` for deep dives. Don't bury the docs.

**For Internal/Dev-Facing READMEs:**
1.  **Purpose**: What part of the system is this?
2.  **Dev Loop**: How do I build, test, and modify *this specific part*?
3.  **Architecture**: Brief explanation of how it fits into the larger system.

### 3. Formatting & Content
- **Tables**: Use tables for comparisons (e.g., "Prompt vs Chain" execution).
- **Real Examples**: Use concrete scenarios (e.g., "Generating a Unit Test") rather than generic placeholders (`{{var}}`).
- **Commands**: Show the command *and* what it outputs (or describes the effect).

## Task
Rewrite the input content into a polished Markdown README following these rules. Ensure the "Quick Start" is prominent and the tone is crisp.