# Telemetry & Observability Guide

OpenTelemetry-based tracing for the Claude Prompts MCP server. Provides production-grade observability with data safety guarantees.

## Quick Start

Add to `config.jsonc` (`config.json` is also still read):

```json
{
  "telemetry": {
    "enabled": true,
    "mode": "traces",
    "exporterEndpoint": "http://localhost:4318",
    "samplingRate": 1.0
  }
}
```

Requires an OTLP-compatible collector (e.g., [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)) running at the configured endpoint.

## Configuration

| Key                                         | Type                              | Default                 | Description                                                               |
| ------------------------------------------- | --------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `telemetry.enabled`                         | boolean                           | `false`                 | Master switch. No SDK initialized when false.                             |
| `telemetry.mode`                            | `"off"` \| `"traces"` \| `"full"` | `"off"`                 | `traces` = spans only. `full` = spans + metrics (future).                 |
| `telemetry.exporterEndpoint`                | string                            | `http://localhost:4318` | OTLP HTTP endpoint URL.                                                   |
| `telemetry.samplingRate`                    | number                            | `1.0`                   | Head sampling rate (0.0-1.0). Use collector tail sampling for production. |
| `telemetry.attributePolicy.businessContext` | boolean                           | `true`                  | Include safe business attributes (prompt ID, execution mode, etc.).       |
| `telemetry.attributePolicy.rawCommands`     | boolean                           | `false`                 | Include raw command text. **Warning: may contain sensitive data.**        |
| `telemetry.attributePolicy.rawResponses`    | boolean                           | `false`                 | Include raw user responses. **Warning: may contain sensitive data.**      |
| `telemetry.attributePolicy.allowlist`       | string[]                          | —                       | Custom attribute names to include.                                        |

### CLI Configuration

```bash
# Enable telemetry
system_control set telemetry.enabled true
system_control set telemetry.mode traces

# Set collector endpoint
system_control set telemetry.exporterEndpoint http://collector:4318

# Adjust sampling
system_control set telemetry.samplingRate 0.1
```

Note: `telemetry.mode` and `telemetry.exporterEndpoint` changes require server restart.

## Trace Model

### Spans

| Span Name                    | Type  | Description                                                  |
| ---------------------------- | ----- | ------------------------------------------------------------ |
| `prompt_engine.request`      | Root  | Wraps entire pipeline execution                              |
| `pipeline.stage.<StageName>` | Child | Per-stage timing (18-22 stages depending on pipeline config) |

### Events

Events are attached to the active root span via the hook system:

| Event Name              | Source          | Status | Description                             |
| ----------------------- | --------------- | ------ | --------------------------------------- |
| `gate.passed`           | Gate evaluation | Active | Gate passed validation                  |
| `gate.failed`           | Gate evaluation | Active | Gate failed validation                  |
| `gate.retry_exhausted`  | Gate system     | Active | All retry attempts consumed             |
| `gate.response_blocked` | Gate system     | Active | Response blocked due to gate failure    |
| `chain.step_complete`   | Step capture    | Active | A chain step's real output was captured |
| `chain.complete`        | Chain run store | Active | A run reached `completed`               |
| `chain.failed`          | Chain run store | Active | A run reached `failed` or `cancelled`   |

Each chain event fires once, where the owning service records the fact and after its persist
resolves: `StepCaptureService` for a captured step, and `ChainSessionStore` for the run's
terminal status. A placeholder capture — the STDIO stand-in for output that has not arrived —
emits nothing, so `chain.step_complete` counts real step results only.

Clients also receive these as MCP notifications: `notifications/chain/step_complete`,
`notifications/chain/complete` (whose `status` names the terminal state — `completed`,
`failed` or `cancelled`) and `notifications/framework/changed`. `validate:hook-producers`
fails the build if any registerable event loses its producer again.

> [!IMPORTANT]
> **Notifications reach clients over STDIO only.** `McpNotificationEmitter` pushes through the
> one server instance bound at startup, which `serveStdio` pins for the connection's lifetime.
> Streamable HTTP builds a fresh server per request and has no long-lived instance to push
> from; its only publish channel is the handler's `subscriptions/listen` notifier, which
> carries list-changed and resource-updated events and nothing else. An HTTP client sees the
> span events (telemetry is unaffected) but receives no gate, chain or framework notification.
> Giving HTTP a channel for them is open work, not a defect in this wiring. An HTTP run logs one
> `Failed to send notification` warning per event (`Not connected`) and continues serving.

> [!NOTE]
> On the final step of a gated chain, `chain/complete` is delivered **before** the last
> `chain/step_complete`: the PASS verdict advances past the last node, which latches the run
> terminal, before the step's response is captured. Treat `chain/complete` as "the run ended",
> not as "no further events". The ordering itself is a defect in advance-on-PASS, filed against
> `GateVerdictProcessor`.

### Attributes

Safe business-context attributes on trace spans (all prefixed `cpm.*`):

#### Initial Attributes (set at span creation)

| Attribute            | Type   | Description                 |
| -------------------- | ------ | --------------------------- |
| `cpm.command.type`   | string | Command type or prompt ID   |
| `cpm.execution.mode` | string | `single` or `chain`         |
| `cpm.execution.id`   | string | Unique execution identifier |

#### Wide-Event Attributes (enriched at pipeline completion)

These attributes follow the [wide-event pattern](https://loggingsucks.com/) — one comprehensive event per request with full business context for incident queries.

| Attribute                     | Type    | Description                                                                          | Incident Query                            |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| `cpm.duration.total_ms`       | number  | Total pipeline duration (ms)                                                         | "Show slow requests"                      |
| `cpm.stages.executed_count`   | number  | Number of stages that ran                                                            | "Pipeline utilization"                    |
| `cpm.stages.skipped`          | string  | Comma-separated skipped stage names                                                  | "Why didn't X run?"                       |
| `cpm.stages.slowest`          | string  | Name of the slowest stage                                                            | "What's the bottleneck?"                  |
| `cpm.stages.slowest_ms`       | number  | Duration of slowest stage (ms)                                                       | "How slow was the bottleneck?"            |
| `cpm.had_early_exit`          | boolean | Whether all stages executed                                                          | "Incomplete executions"                   |
| `cpm.gates.names`             | string  | Comma-separated applied gate IDs                                                     | "Show failures by gate"                   |
| `cpm.gates.passed_count`      | number  | Gates that passed                                                                    | "Gate pass rate"                          |
| `cpm.gates.failed_count`      | number  | Gates that failed                                                                    | "Which gates fail most?"                  |
| `cpm.gates.blocked`           | boolean | Response blocked by gate                                                             | "Show blocked requests"                   |
| `cpm.gates.retry_exhausted`   | boolean | Retry attempts exhausted                                                             | "Retry exhaustion rate"                   |
| `cpm.gates.enforcement_mode`  | string  | Gate enforcement mode                                                                | "Enforcement mode distribution"           |
| `cpm.chain.is_chain`          | boolean | Whether this is a chain execution                                                    | "Chain vs single failure rate"            |
| `cpm.chain.step_index`        | number  | Current chain step number                                                            | "Which step fails?"                       |
| `cpm.chain.id`                | string  | Chain session identifier                                                             | "Chain execution timeline"                |
| `cpm.framework.id`            | string  | Active framework ID                                                                  | "Failures by framework"                   |
| `cpm.framework.enabled`       | boolean | Whether framework is active                                                          | "Framework adoption"                      |
| `cpm.scope.source`            | string  | Identity scope source (best of org/workspace)                                        | "Scope distribution"                      |
| `cpm.scope.continuity_source` | string  | Source of the workspace id that actually resolves the continuity/state-isolation key | "Was the scoping key real or a fallback?" |
| `cpm.error.type`              | string  | Error message (on failure only)                                                      | "Error grouping"                          |

#### Other Business Attributes

| Attribute                 | Type   | Description                |
| ------------------------- | ------ | -------------------------- |
| `cpm.prompt.id`           | string | Resolved prompt identifier |
| `cpm.operator.types`      | string | Applied operator types     |
| `cpm.chain.current_step`  | number | Current chain step         |
| `cpm.chain.total_steps`   | number | Total chain steps          |
| `cpm.gates.applied_count` | number | Number of applied gates    |

### Explicitly Excluded (default)

These attributes are **never** emitted unless explicitly opted in via `attributePolicy`:

- Raw command text (`cpm.command.raw`)
- Raw user responses (`cpm.user_response.raw`)
- Rendered prompt/template bodies
- Raw model outputs

## Attribute Policy

The `AttributePolicyEnforcer` applies 7 rules to every attribute before trace emission:

1. **Excluded attributes always blocked** — raw payloads never leak by default
2. **Business-context gated by config** — `attributePolicy.businessContext` flag
3. **Custom allowlist override** — explicitly listed attributes always pass
4. **Raw commands opt-in** — only if `attributePolicy.rawCommands: true`
5. **Raw responses opt-in** — only if `attributePolicy.rawResponses: true`
6. **Unknown `cpm.*` dropped** — unrecognized custom attributes rejected
7. **Non-`cpm.*` pass through** — OTel semantic conventions (http._, rpc._) are unfiltered

## Metric Label Policy

Metric labels are restricted to low-cardinality values:

**Allowed**: `stage_name`, `stage_type`, `status`, `execution_mode`, `is_chain`

**Disallowed**: `prompt_id`, `chain_id`, `continuity_scope_id`, `operator_types`, `execution_id`, `session_id`, `framework_id`

High-cardinality identifiers are trace-only attributes, not metric dimensions.

## Resource Visibility

When MCP resources are enabled, telemetry status is available at:

```
resource://telemetry/status
```

Returns: `{ enabled, mode, exporterEndpoint, samplingRate, uptimeMs }`

## Troubleshooting

| Symptom                      | Cause                 | Fix                                                                          |
| ---------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| No traces exported           | Telemetry disabled    | Set `telemetry.enabled: true` and `telemetry.mode: "traces"`                 |
| Traces don't reach collector | Wrong endpoint        | Verify `telemetry.exporterEndpoint` matches collector address                |
| Missing business attributes  | Policy disabled       | Check `telemetry.attributePolicy.businessContext: true`                      |
| Server startup failure       | Collector unreachable | Telemetry degrades gracefully — check logs for `[TelemetryRuntime]` warnings |
| Raw data in traces           | Opt-in enabled        | Set `attributePolicy.rawCommands: false` and `rawResponses: false`           |

## Architecture

```
Config (telemetry section)
    |
    v
TelemetryLifecycle (runtime/telemetry-lifecycle.ts)
    |
    +-- TelemetryRuntimeImpl (SDK init, tracer access)
    +-- AttributePolicyEnforcer (data safety)
    +-- TelemetryHookObserver (hook -> trace events)
            |
            v
        HookRegistry (event fan-out)
            ^
            |
        Pipeline (emitBeforeStage/emitAfterStage/emitStageError)
            |
            +-- Root span: prompt_engine.request
            |     +-- 3 initial attrs (creation)
            |     +-- 19 wide-event attrs (enrichRootSpan at completion)
            +-- Stage spans: pipeline.stage.<Name>
            +-- Gate events: gate.passed/failed/blocked (via hooks)
```

The root span follows the [wide-event pattern](https://loggingsucks.com/) — enriched at pipeline completion with performance, gate, chain, framework, and error attributes. See [Wide-Event Attributes](#wide-event-attributes-enriched-at-pipeline-completion) for the full list.
