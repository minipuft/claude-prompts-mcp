# Integration Tests (Planned)

Integration tests validate multiple modules working together (without standing up a full MCP client/server environment).

## When To Add Integration Tests

Use integration tests when unit tests don’t give enough confidence for:

- Prompt registry + hot-reload flows
- Contract generation + runtime loaders
- Gate/framework overlays across multiple services
- Runtime startup wiring (without real transports)

## Scope Rules

- Still no real network calls.
- Filesystem reads are OK when they reflect real behavior (e.g., loading fixtures/prompts), but keep writes contained.
- Keep them fast enough to run in CI by default.

## Execution

These are not wired into CI yet. When we start adding them, we’ll introduce:

- `npm run test:integration`
- CI job(s) that run them on the Node matrix

Track the rollout under `docs/TODO.md`.
