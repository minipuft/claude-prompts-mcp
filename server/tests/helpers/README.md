# Test Helpers

Shared test utilities live here: builders, fakes, fixtures, and small harness helpers.

## Goals

- Keep individual test files focused on behavior, not boilerplate setup.
- Provide reusable builders for complex domain objects (execution plans, gate configs, framework context).
- Avoid reaching into module internals from tests (prefer public APIs + stable seams).

## What Belongs Here

- **Builders**: `createX()` / `makeX()` helpers that produce valid defaults with overrides.
- **Fakes/Stubs**: small in-memory implementations for interfaces (file loaders, registries).
- **Fixtures**: static JSON/YAML/text data used across tests (keep small and explicit).
- **Test-only utilities**: e.g., deterministic clock helpers, log capture, env var resetters.

## Conventions

- Keep helpers deterministic and side-effect-free.
- No network calls. No filesystem writes outside `server/temp/` (if absolutely needed).
- Prefer explicit options objects over positional arguments.
- If a helper grows “framework-like”, promote it into a real `src/**` utility and test it normally.

## Adding A Helper

1. Check if a similar helper already exists (avoid duplicates).
2. Add a small, typed utility with a clear name and defaults.
3. Use it in at least one test immediately (no orphan helpers).
