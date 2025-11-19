# Action Metadata & Telemetry (Phase 1)

This directory stores the Phase 1/2 deliverables for the "LLM-Aware Tool Guides & Parameter Surfacing" plan:

- **Inventory JSON files** (auto-generated) describing every surfaced action/operation/parameter for each MCP tool.
- **Usage tracker utilities** that record action invocations and parameter validation failures.

Future phases will consume these artifacts to auto-generate per-tool guide flows. The JSON schema is intentionally lightweight so the files can be hand-reviewed and version-controlled. Each document includes:

| Field | Description |
| --- | --- |
| `tool` | Tool identifier (`prompt_manager`, `prompt_engine`, `system_control`) |
| `version` | Metadata version to detect schema changes |
| `actions` / `parameters` / `operations` | Array capturing canon verbs or request fields |
| `issues` | Known defects or regressions tied to each entry |
| `notes` | Free-form annotations (routing gaps, telemetry requirements, TODOs) |

Update process (Phase 1):
1. Run the MCP tools/endpoints you’re cataloguing to confirm behavior.
2. Edit the JSON entry with the latest status (`working`, `untested`, `routing_issue`, `planned`).
3. Document reproduction hints inside `issues` so follow-up work is traceable.
4. Run `npm run generate:action-metadata` to regenerate the JSON files. They are produced from the TypeScript descriptors under `src/tooling/action-metadata/definitions/**`.
5. Commit alongside telemetry or instrumentation updates so inventory + metrics stay aligned.

Later phases will add automated generators that feed these inventories directly from the tool registries, reducing manual effort.
