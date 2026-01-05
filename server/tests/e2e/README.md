# E2E Tests (Planned)

End-to-end tests validate real user flows through the built server (CLI/transport surface), as close to production as practical.

## Target Flows

- Start server (`dist/index.js`) in STDIO and SSE modes
- Invoke MCP tools (`prompt_manager`, `prompt_engine`, `system_control`) with representative payloads
- Verify hot-reload behaviors (prompts/methodologies/gates) without manual steps

## Design Constraints

- Keep them hermetic and parallel-safe (each test run uses its own temp workspace).
- Avoid relying on global machine state; pin inputs via fixtures and temp directories.
- Prefer black-box assertions (outputs and side effects) over internal inspection.

## Execution

These are not wired into CI yet. When we start adding them, we’ll introduce:

- `npm run test:e2e`
- `npm run start:test` (or a dedicated harness) for deterministic startup

Track the rollout under `docs/TODO.md`.
