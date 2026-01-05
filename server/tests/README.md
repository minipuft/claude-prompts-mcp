# Tests (Server)

This folder contains the server test suite and the minimal scaffolding needed to run it.

## Run

From `server/`:

```bash
npm run test:unit
```

Common variants:

```bash
npm test
npm run test:watch
npm run test:coverage
```

## Layout

- `setup.ts`: Jest setup loaded before tests.
- `helpers/`: Shared test helpers (builders, fakes, test utilities).
- `unit/`: Unit tests, organized to mirror `src/` domains.
- `integration/`: Integration tests (planned; see README in folder).
- `e2e/`: End-to-end tests (planned; see README in folder).

## Conventions

- Prefer unit tests that cover a single module/service with minimal filesystem dependencies.
- Keep tests deterministic: no real network, no time-dependent assertions without faking time.
- When you add a new `src/` domain directory, add the matching folder under `tests/unit/` for symmetry.
