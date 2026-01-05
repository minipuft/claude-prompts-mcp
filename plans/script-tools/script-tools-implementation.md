# Prompt-Scoped Script Tools Implementation Plan

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Data Model & Types | **COMPLETE** |
| Phase 2 | Loading System | **COMPLETE** |
| Phase 3 | Execution System | **COMPLETE** |
| Phase 4 | Smart Detection | **COMPLETE** |
| Phase 5 | Pipeline Integration | **COMPLETE** |
| Phase 6 | Hot-Reload | **COMPLETE** |

**All phases implemented.** See files:
- `server/src/scripts/types.ts` - Type definitions
- `server/src/scripts/core/script-schema.ts` - Zod schema validation
- `server/src/scripts/core/script-definition-loader.ts` - YAML loader
- `server/src/scripts/execution/script-executor.ts` - Subprocess executor
- `server/src/scripts/detection/tool-detection-service.ts` - Smart detection
- `server/src/execution/pipeline/stages/04b-script-execution-stage.ts` - Pipeline stage
- `server/src/runtime/script-hot-reload.ts` - Hot-reload integration

**Example tool created:** `server/prompts/general/test_prompt/tools/word_count/`

---

## Executive Summary

Add prompt-scoped script tools to claude-prompts-mcp, enabling prompts to declare external executable scripts that are invoked via smart detection and integrated into template rendering.

**User Flow:**
```
prompt_engine(">>data_analyzer file='data.csv'")
    ↓
1. Prompt resolved → tools discovered: [analyze_csv]
    ↓
2. Smart detection: "file='data.csv'" matches analyze_csv
    ↓
3. Script executed via subprocess
    ↓
4. Template rendered with {{tool_analyze_csv}} context
```

---

## Phase 1: Data Model & Types (Day 1)

### New Files

**`server/src/scripts/types.ts`**
```typescript
export interface ScriptToolDefinition {
  id: string;
  name: string;
  description: string;
  scriptPath: string;
  runtime?: 'python' | 'node' | 'shell' | 'auto';
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  timeout?: number;
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface LoadedScriptTool extends ScriptToolDefinition {
  toolDir: string;
  absoluteScriptPath: string;
  promptId: string;
  descriptionContent: string;
}

export interface ScriptExecutionRequest {
  toolId: string;
  promptId: string;
  inputs: Record<string, unknown>;
  timeout?: number;
}

export interface ScriptExecutionResult {
  success: boolean;
  output: unknown;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  error?: string;
}

export interface ToolDetectionMatch {
  toolId: string;
  promptId: string;
  confidence: number;
  matchReason: 'name_match' | 'parameter_match';
  extractedInputs: Record<string, unknown>;
}
```

### Modifications

**`server/src/prompts/types.ts`** - Add to PromptData:
```typescript
export interface PromptData {
  // ... existing ...
  tools?: string[];  // Tool IDs declared by this prompt
}
```

**`server/src/prompts/prompt-schema.ts`** - Add to PromptYamlSchema:
```typescript
tools: z.array(z.string()).optional(),
```

**`server/src/execution/types.ts`** - Add to ConvertedPrompt:
```typescript
scriptTools?: LoadedScriptTool[];
```

---

## Phase 2: Loading System (Day 1-2)

### Directory Structure

```
server/prompts/{category}/{prompt_id}/
├── prompt.yaml           # tools: [analyze_csv, generate_chart]
├── user-message.md
└── tools/
    └── {tool_id}/
        ├── tool.yaml     # runtime, timeout, env
        ├── schema.json   # JSON Schema for inputs
        ├── description.md
        └── script.py     # Executable
```

### New Files

**`server/src/scripts/core/script-schema.ts`**
```typescript
export const ScriptToolYamlSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  runtime: z.enum(['python', 'node', 'shell', 'auto']).default('auto'),
  script: z.string().min(1),
  timeout: z.number().positive().default(30000),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
});
```

**`server/src/scripts/core/script-definition-loader.ts`**

Mirror `GateDefinitionLoader` pattern:
- `loadTool(promptDir, toolId)` - Load single tool
- `discoverTools(promptDir)` - Find all tools under `tools/` dir
- `loadToolsForPrompt(promptDir, toolIds)` - Load multiple
- Cache with stats tracking
- Inline `description.md` content
- Validate `schema.json` against JSON Schema Draft-07

### Modifications

**`server/src/prompts/loader.ts`** - In `loadYamlPrompt()`:
```typescript
if (yamlData.tools?.length) {
  const tools = this.scriptToolLoader.loadToolsForPrompt(baseDir, yamlData.tools);
  // Attach to returned data
}
```

---

## Phase 3: Execution System (Day 2-3)

### New Files

**`server/src/scripts/execution/script-executor.ts`**
```typescript
export class ScriptExecutor {
  async execute(request: ScriptExecutionRequest): Promise<ScriptExecutionResult>;
  validateInputs(inputs: unknown, schema: JSONSchema): ValidationResult;
  private resolveRuntime(tool: LoadedScriptTool): string;
  private buildArgs(tool: LoadedScriptTool, inputs: Record<string, unknown>): string[];
  private parseOutput(stdout: string): unknown;
}
```

**Input Passing:**
- Pass inputs as JSON via stdin: `echo '{"file": "data.csv"}' | python script.py`
- Or via CLI arg: `python script.py --input '{"file": "data.csv"}'`

**Output Parsing:**
- Attempt `JSON.parse(stdout)`
- If valid JSON: use structured output
- Otherwise: wrap as `{ output: stdout }`

**Security (Phase 1):**
- `child_process.spawn()` with timeout
- Working directory sandboxed to tool directory
- No network restrictions (trust prompt authors)

---

## Phase 4: Smart Detection (Day 3)

### New Files

**`server/src/scripts/detection/tool-detection-service.ts`**
```typescript
export class ToolDetectionService {
  detectTools(
    input: string,
    args: Record<string, unknown>,
    availableTools: LoadedScriptTool[]
  ): ToolDetectionMatch[];

  extractInputs(
    args: Record<string, unknown>,
    tool: LoadedScriptTool
  ): Record<string, unknown>;
}
```

**Detection Strategies:**

1. **Name Match (confidence: 1.0)**
   - Check if any arg key/value contains tool ID
   - Check if `tool_id` or `tool` arg matches

2. **Parameter Match (confidence: 0.8)**
   - User args contain required schema parameters
   - Example: Tool requires `file_path`, user provides `file='data.csv'`

---

## Phase 5: Pipeline Integration (Day 3-4)

### New Stage

**`server/src/execution/pipeline/stages/04b-script-execution-stage.ts`**

Insert after Planning Stage (04), before Gate Enhancement (05):

```typescript
export class ScriptExecutionStage extends BasePipelineStage {
  readonly name = 'ScriptExecution';

  async execute(context: ExecutionContext): Promise<void> {
    const prompt = context.getConvertedPrompt();
    if (!prompt?.scriptTools?.length) return;

    // Detect matching tools
    const matches = this.toolDetectionService.detectTools(
      context.mcpRequest.command ?? '',
      context.getPromptArgs(),
      prompt.scriptTools
    );

    // Execute matched tools with confidence >= 0.8
    for (const match of matches.filter(m => m.confidence >= 0.8)) {
      const tool = prompt.scriptTools.find(t => t.id === match.toolId);
      const result = await this.scriptExecutor.execute({
        toolId: match.toolId,
        promptId: prompt.id,
        inputs: match.extractedInputs,
        timeout: tool?.timeout
      });

      context.state.scriptResults ??= new Map();
      context.state.scriptResults.set(match.toolId, result);
    }
  }
}
```

### Pipeline Constructor Update

**`server/src/execution/pipeline/prompt-execution-pipeline.ts`**

Add `scriptExecutionStage` parameter and insert in stage order.

### Template Context

**`server/src/execution/pipeline/stages/09-execution-stage.ts`**

Add script results to template context:
```typescript
const context = {
  ...args,
  // Script tool outputs
  ...(scriptResults ? Object.fromEntries(
    Array.from(scriptResults).map(([id, r]) => [`tool_${id}`, r.output])
  ) : {})
};
```

---

## Phase 6: Hot-Reload (Day 4)

### Modifications

**`server/src/prompts/file-observer.ts`**
- Add pattern: `**/tools/*/tool.yaml`, `**/tools/*/schema.json`

**`server/src/prompts/hot-reload-manager.ts`**
- Add `tool_changed` event type
- Clear script loader cache on tool file change

---

## Critical Files to Modify

| File | Change |
|------|--------|
| `server/src/prompts/types.ts:97` | Add `tools?: string[]` to PromptData |
| `server/src/prompts/prompt-schema.ts` | Add `tools` field to Zod schema |
| `server/src/prompts/loader.ts` | Integrate ScriptToolDefinitionLoader |
| `server/src/execution/types.ts` | Add `scriptTools` to ConvertedPrompt |
| `server/src/execution/pipeline/prompt-execution-pipeline.ts` | Add ScriptExecutionStage |
| `server/src/execution/pipeline/stages/09-execution-stage.ts` | Add script results to template |
| `server/src/runtime/module-initializer.ts` | Initialize ScriptExecutor service |

## New Files to Create

```
server/src/scripts/
├── index.ts
├── types.ts
├── core/
│   ├── script-schema.ts
│   └── script-definition-loader.ts
├── detection/
│   └── tool-detection-service.ts
└── execution/
    └── script-executor.ts

server/src/execution/pipeline/stages/
└── 04b-script-execution-stage.ts
```

---

## Testing Strategy

### Unit Tests
- `script-definition-loader.test.ts` - Tool discovery, loading, caching
- `script-executor.test.ts` - Subprocess spawning, timeout, output parsing
- `tool-detection-service.test.ts` - Name matching, parameter matching

### Integration Tests
- `script-execution-stage.test.ts` - Pipeline integration, template context

### E2E Tests
- Real Python/Node script execution
- Hot-reload of tool files

---

## Sample Prompt with Tool

**`server/prompts/analysis/data_analyzer/prompt.yaml`**
```yaml
id: data_analyzer
name: Data Analyzer
description: Analyzes data files with optional script enhancement
category: analysis
tools:
  - analyze_csv
arguments:
  - name: file
    description: Path to the data file
    required: true
    type: string
```

**`server/prompts/analysis/data_analyzer/tools/analyze_csv/tool.yaml`**
```yaml
id: analyze_csv
name: CSV Analyzer
runtime: python
script: script.py
timeout: 30000
```

**`server/prompts/analysis/data_analyzer/tools/analyze_csv/schema.json`**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "file": { "type": "string", "description": "Path to CSV file" },
    "columns": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["file"]
}
```

**`server/prompts/analysis/data_analyzer/tools/analyze_csv/script.py`**
```python
import json
import sys

input_data = json.load(sys.stdin)
# Process CSV...
result = {"rows": 100, "columns": 5, "summary": "..."}
print(json.dumps(result))
```

**`server/prompts/analysis/data_analyzer/user-message.md`**
```markdown
Analyze the data file: {{file}}

{% if tool_analyze_csv %}
## Script Analysis Results
- Rows: {{tool_analyze_csv.rows}}
- Columns: {{tool_analyze_csv.columns}}
- Summary: {{tool_analyze_csv.summary}}
{% endif %}

Please provide your analysis based on this data.
```

---

## Phase Breakdown

| Phase | Scope | Effort |
|-------|-------|--------|
| **Phase 1** | Types + Schema | 0.5 day |
| **Phase 2** | Loader (mirror GateDefinitionLoader) | 1 day |
| **Phase 3** | ScriptExecutor (subprocess) | 1 day |
| **Phase 4** | ToolDetectionService | 0.5 day |
| **Phase 5** | Pipeline stage + template | 1 day |
| **Phase 6** | Hot-reload + tests | 0.5 day |
| **Total MVP** | | ~4-5 days |

---

## Future: Docker Extensibility (Phase 2)

```typescript
export interface DockerExecutionConfig {
  enabled: boolean;
  image: string;
  mounts?: { host: string; container: string; readonly?: boolean }[];
  networkMode?: 'none' | 'bridge';
  memoryLimit?: string;
}
```

Add `docker` field to `tool.yaml` for containerized execution.

---

## Status

- [x] Initial design complete
- [x] Phase 1: Data Model & Types (2025-12-13)
  - Created `server/src/scripts/types.ts` with all type definitions
  - Added `tools?: string[]` to PromptData interface
  - Added `tools` field to PromptYamlSchema and PromptDataSchema
  - Added `scriptTools?: LoadedScriptTool[]` to ConvertedPrompt
  - Created `server/src/scripts/index.ts` barrel file
  - Typecheck passes
- [x] Phase 2: Loading System (2025-12-13)
  - Created `server/src/scripts/core/script-schema.ts` with ScriptToolYamlSchema and validation
  - Created `server/src/scripts/core/script-definition-loader.ts` mirroring GateDefinitionLoader
  - Created `server/src/scripts/core/index.ts` barrel file
  - Updated main `scripts/index.ts` to export core modules
  - Typecheck passes
- [x] Phase 3: Execution System (2025-12-14)
  - Created `server/src/scripts/execution/script-executor.ts` with subprocess execution
  - Supports python/node/shell runtimes with auto-detection
  - JSON input via stdin, JSON output parsing
  - Timeout enforcement and error handling
  - Created `server/src/scripts/execution/index.ts` barrel file
  - Typecheck passes
- [x] Phase 4: Smart Detection (2025-12-14)
  - Created `server/src/scripts/detection/tool-detection-service.ts`
  - Name matching (confidence: 1.0) and parameter matching (confidence: 0.8)
  - Input extraction with naming variation support (camelCase, snake_case)
  - Created `server/src/scripts/detection/index.ts` barrel file
  - Typecheck passes
- [x] Phase 5: Pipeline Integration (2025-12-14)
  - Created `server/src/execution/pipeline/stages/04b-script-execution-stage.ts`
  - Added `scripts` state to `PipelineInternalState` in `internal-state.ts`
  - Updated `09-execution-stage.ts` to merge script results into template context
  - Script results available as `{{tool_<id>}}` in templates
  - Typecheck passes
- [x] Phase 6: Hot-Reload (2025-12-14)
  - Created `server/src/scripts/hot-reload/script-hot-reload.ts`
  - Cache invalidation for tool files (tool.yaml, schema.json)
  - Integration pattern for HotReloadManager auxiliary reloads
  - Created `server/src/scripts/hot-reload/index.ts` barrel file
  - Updated main `scripts/index.ts` with all exports
  - Typecheck passes
