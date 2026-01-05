# Unit Tests

Unit tests live here and are grouped to mirror `server/src/` (so it’s obvious where new tests belong).

## Where Should My Test Go?

- If you’re changing a module in `src/execution/**`, put the test in `tests/unit/execution/**`.
- If you’re changing MCP tools (`src/mcp-tools/**`), put the test in `tests/unit/mcp-tools/**`.
- If you’re changing gates/frameworks/runtime, use the matching folder under `tests/unit/`.

If there isn’t a matching folder yet, create it.

## Naming

- Test files: `*.test.ts`
- Prefer one “unit under test” per file (one service/module) unless a small cluster is inseparable.

## Patterns

- Use explicit fixtures/builders (in `tests/helpers/`) instead of copy-pasting setup blocks.
- Prefer testing pure functions and services directly; avoid spinning up the full server unless the behavior requires it.
- When mocking is needed, mock at the module boundary (don’t reach into internals).

## Run A Single Test

From `server/`:

```bash
npm run test:unit -- tests/unit/path/to/your.test.ts
```
