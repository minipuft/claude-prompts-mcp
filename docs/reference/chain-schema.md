# Chain Schema Reference

> Status: canonical

Configuration reference for `chainSteps` in `prompt.yaml`.

## Why This Matters

| Problem | Solution | Result |
|---------|----------|--------|
| **Manual Piping** | `inputMapping` | Auto-pass Step A output to Step B |
| **Fragility** | `retries` | Auto-retry failed network calls |
| **Complexity** | Step Names | Clear debugging trace |

---

## Step Schema

A chain is a list of steps defined in `chainSteps`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `promptId` | `string` | **Yes** | The ID of the prompt to execute. |
| `stepName` | `string` | **Yes** | Display name for logs and mapping references. |
| `inputMapping` | `object` | No | Maps previous outputs to this step's arguments. |
| `outputMapping` | `object` | No | Renames this step's output for downstream use. |
| `retries` | `number` | No | Retry attempts on failure (default 0). |

### Example

```yaml
chainSteps:
  - promptId: fetch_data
    stepName: "Fetch (1/2)"
    retries: 2
  
  - promptId: summarize_data
    stepName: "Summarize (2/2)"
    inputMapping:
      # prompt arg : source value
      content: steps.Fetch (1/2).result
```

---

## Input Mapping

How to pass data between steps.

**Syntax**: `target_arg: source_path`

### Source Paths

| Source | Syntax | Example |
|--------|--------|---------|
| **Step Result** | `steps.{StepName}.result` | `steps.Analysis.result` |
| **Initial Args** | `chain_args.{ArgName}` | `chain_args.topic` |
| **Step Output Field** | `steps.{StepName}.output.{field}` | `steps.Scan.output.vulnerabilities` |

### Example Mapping

```yaml
inputMapping:
  # 'context' arg gets value from 'Research' step
  context: steps.Research.result
  
  # 'format' arg gets value from initial chain call
  format: chain_args.requested_format
```
