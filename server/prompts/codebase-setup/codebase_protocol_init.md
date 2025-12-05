# Codebase Protocol Initialization

## Description
Bootstrap a T3-style project with full protocol setup, tooling, and documentation updates.

## System Message
You are a senior codebase-init agent. Set up the repository following best practices and document results.

## User Message Template
Set up the repository at {{repo_path}} using the {{tech_stack | default("T3 stack with Next.js App Router, Prisma, Tailwind, tRPC, NextAuth")}}. Follow this protocol:

1. **Context Scan**
   - Inspect existing docs (README, implementation plan, CLAUDE.md) for requirements and naming conventions.
   - Note any blockers or TODOs in planning docs.

2. **Scaffold & Dependencies**
   - If the T3 scaffold is missing, run `pnpm create t3-app@latest` in place (TypeScript, App Router, Tailwind, tRPC, Prisma, NextAuth).
   - Install baseline dependencies: `ai`, `@ai-sdk/react`, `@ai-sdk/openai`, `@ai-sdk/mcp`, `framer-motion`, `@formkit/auto-animate`, `zustand`, `react-markdown`, `react-syntax-highlighter`, `@upstash/ratelimit`, `@vercel/kv`, plus `@types/react-syntax-highlighter`, `@next/bundle-analyzer`.
   - Add extra packages from {{additional_dependencies | default("(none)")}}.

3. **Project Structure & Schema**
   - Ensure required directories exist under `src/` (components subfolders, lib/mcp, stores, hooks, styles, types).
   - Replace default Prisma models with User/Account/Session + Conversation/Message, Postgres datasource, indexes, and JSON content.
   - Run `pnpm prisma generate`; document if `pnpm prisma db push` is blocked (no DB).

4. **Environment & Docs**
   - Expand `src/env.js` with validation for auth, database, MCP, OpenAI, Upstash, and KV keys.
   - Rewrite `.env.example` (and copy `.env.local` if needed) with guidance and placeholders.
   - Update README quick start and quality gate sections.

5. **UI Foundations**
   - Initialize shadcn/ui (Slate base palette) and add button/input/dialog/avatar/scroll-area/separator/textarea/tooltip components.
   - Create `src/styles/tokens.css` with depth & halo palette plus motion tokens; import into `globals.css` and expose Tailwind aliases.
   - Seed a Zustand UI store for depth/motion preferences.

6. **QA & Automation**
   - Install ESLint 9 flat config, Prettier 3 with Tailwind plugin, lint-staged, Husky, and Vitest.
   - Add `eslint.config.mjs`, `.prettierrc`, `.prettierignore`.
   - Update `package.json` scripts (`lint`, `lint:fix`, `format`, `format:check`, `test`, `prepare`) and lint-staged rules (fix + prettier write).
   - Create `.husky/pre-commit` to run `pnpm lint-staged` (note `pnpm prepare` requires initialized git repo).

7. **Validation**
   - Run `pnpm format` then `pnpm format:check`.
   - Run `pnpm lint` (inject temporary env vars if necessary).
   - Run `pnpm test` (Vitest with `--passWithNoTests`).

8. **Documentation & Planning**
   - Update implementation trackers with completed checkboxes, blockers, and next actions.
   - Summarize changes and verification steps; reference modified files with line numbers.

9. **Report**
   - Provide a concise summary of changes, validation results, outstanding blockers, and suggested next steps.
   - Highlight that Husky hooks require `pnpm prepare` post `git init`.

{{notes}}
