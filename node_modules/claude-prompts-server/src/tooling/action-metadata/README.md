# Action Metadata & Telemetry

This module provides runtime metadata for MCP tools, used by guides, validation, and telemetry.

## Architecture

```
tooling/contracts/*.json          ← SSOT for parameters (manually maintained)
        ↓
contracts/_generated/*.ts         ← Generated TypeScript types + constants
        ↓
action-metadata/definitions/*.ts  ← Adds actions, operations, usage patterns
        ↓
Runtime (guides, validators, telemetry)
```

## Files

| File | Purpose |
|------|---------|
| `definitions/prompt-engine.ts` | Prompt engine metadata (parameters from contracts + usage patterns) |
| `definitions/prompt-manager.ts` | Prompt manager metadata (parameters from contracts + actions) |
| `definitions/system-control.ts` | System control metadata (parameters from contracts + operations) |
| `definitions/types.ts` | TypeScript interfaces for metadata structures |
| `usage-tracker.ts` | Runtime telemetry for action invocations and parameter issues |

## Metadata Structure

Each tool's metadata includes:

| Field | Description |
|-------|-------------|
| `tool` | Tool identifier (`prompt_manager`, `prompt_engine`, `system_control`) |
| `version` | Matches contract version for consistency |
| `notes` | Free-form annotations about the metadata |
| `data.parameters` | Parameter descriptors (sourced from contracts) |
| `data.actions/operations` | Tool-specific action inventory (manually maintained) |
| `data.usagePatterns` | Example usage patterns for guides (prompt_engine only) |

## Update Process

1. **Parameter changes**: Update `tooling/contracts/*.json`, then run `npm run generate:contracts`
2. **Action/operation changes**: Edit `definitions/*.ts` directly
3. **Verify**: Run `npm run validate:metadata` to ensure metadata matches implementation
4. **Build**: TypeScript definitions are compiled with the main build

## Validation

The `verify:action-metadata` script checks that:
- All switch-case actions in handlers are listed in metadata
- All McpToolRequest fields have corresponding parameter entries

Run with: `npm run validate:metadata`
