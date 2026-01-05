# Unified Resource Manager Integration Plan

## Goal

Consolidate `prompt_manager`, `gate_manager`, and `framework_manager` into a single unified `resource_manager` MCP tool with a `resource_type` parameter that routes to the appropriate handler.

## Current State

```
┌─────────────────────────────────────────────────────────────────────┐
│                     5 SEPARATE MCP TOOLS                            │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│ prompt_manager  │ gate_manager    │ framework_manager               │
│ (prompts CRUD)  │ (gates CRUD)    │ (methodologies CRUD)            │
├─────────────────┴─────────────────┴─────────────────────────────────┤
│ prompt_engine   │ system_control                                    │
│ (execution)     │ (system ops)                                      │
└─────────────────┴───────────────────────────────────────────────────┘
```

## Target State

```
┌─────────────────────────────────────────────────────────────────────┐
│                     3 MCP TOOLS                                     │
├─────────────────────────────────────────────────────────────────────┤
│                      resource_manager                               │
│   resource_type: "prompt" | "gate" | "methodology"                  │
│   action: create | update | delete | list | inspect | reload        │
│   + methodology-specific: switch                                    │
├─────────────────────────────────────────────────────────────────────┤
│ prompt_engine   │ system_control                                    │
│ (execution)     │ (system ops)                                      │
└─────────────────┴───────────────────────────────────────────────────┘
```

---

## Architecture Design

### 1. Router Pattern

```typescript
// resource_manager routes based on resource_type
handleAction(args: ResourceManagerInput): Promise<ToolResponse> {
  const { resource_type, action, ...resourceArgs } = args;

  switch (resource_type) {
    case 'prompt':
      return this.promptHandler.handleAction({ action, ...resourceArgs });
    case 'gate':
      return this.gateHandler.handleAction({ action, ...resourceArgs });
    case 'methodology':
      return this.methodologyHandler.handleAction({ action, ...resourceArgs });
    default:
      return this.createErrorResponse(`Unknown resource_type: ${resource_type}`);
  }
}
```

### 2. Unified Parameter Schema

```typescript
type ResourceType = 'prompt' | 'gate' | 'methodology';

type UnifiedAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'list'
  | 'inspect'
  | 'reload'
  | 'switch'        // methodology only
  | 'analyze_type'  // prompt only
  | 'analyze_gates' // prompt only
  | 'guide';        // prompt only

interface ResourceManagerInput {
  // Router parameter (REQUIRED)
  resource_type: ResourceType;

  // Common parameters
  action: UnifiedAction;
  id?: string;
  name?: string;
  description?: string;
  enabled_only?: boolean;
  confirm?: boolean;
  reason?: string;

  // Prompt-specific
  category?: string;
  user_message_template?: string;
  system_message?: string;
  arguments?: PromptArgument[];
  chain_steps?: ChainStep[];
  gate_configuration?: GateConfiguration;
  search_query?: string;

  // Gate-specific
  type?: 'validation' | 'guidance';
  guidance?: string;
  pass_criteria?: string[];
  activation?: GateActivation;
  retry_config?: RetryConfig;

  // Methodology-specific
  methodology?: string;
  system_prompt_guidance?: string;
  phases?: PhaseDefinition[];
  gates?: string[];
  tool_descriptions?: Record<string, string>;
  persist?: boolean;
}
```

### 3. File Structure

```
server/src/mcp-tools/
├── resource-manager/
│   ├── index.ts                    # Public exports
│   ├── core/
│   │   ├── router.ts               # ResourceManagerRouter (main entry)
│   │   ├── types.ts                # Unified types
│   │   └── index.ts
│   ├── handlers/
│   │   ├── prompt-handler.ts       # Delegates to ConsolidatedPromptManager
│   │   ├── gate-handler.ts         # Delegates to ConsolidatedGateManager
│   │   ├── methodology-handler.ts  # Delegates to ConsolidatedFrameworkManager
│   │   └── index.ts
│   └── validation/
│       ├── schema.ts               # Unified Zod schema
│       └── index.ts
├── prompt-manager/                  # Keep for backward compat (deprecated)
├── gate-manager/                    # Keep for backward compat (deprecated)
└── framework-manager/               # Keep for backward compat (deprecated)
```

---

## Implementation Phases

### Phase 1: Create Unified Contract

**Files to create/modify:**
- `server/tooling/contracts/resource-manager.json`

**Contract structure:**
```json
{
  "tool": "resource_manager",
  "version": "1.0.0",
  "description": "Unified resource management for prompts, gates, and methodologies",
  "parameters": {
    "resource_type": {
      "type": "string",
      "enum": ["prompt", "gate", "methodology"],
      "required": true,
      "description": "Type of resource to manage"
    },
    "action": {
      "type": "string",
      "enum": ["create", "update", "delete", "list", "inspect", "reload", "switch", "analyze_type", "analyze_gates", "guide"],
      "required": true
    },
    // ... common and resource-specific parameters
  },
  "conditionalRequirements": {
    "switch": { "resource_type": "methodology" },
    "analyze_type": { "resource_type": "prompt" },
    "analyze_gates": { "resource_type": "prompt" },
    "guide": { "resource_type": "prompt" }
  }
}
```

### Phase 2: Create Router Implementation

**Files to create:**
- `server/src/mcp-tools/resource-manager/core/router.ts`
- `server/src/mcp-tools/resource-manager/core/types.ts`
- `server/src/mcp-tools/resource-manager/core/index.ts`
- `server/src/mcp-tools/resource-manager/index.ts`

**Router implementation:**
```typescript
export class ResourceManagerRouter {
  private promptHandler: ConsolidatedPromptManager;
  private gateHandler: ConsolidatedGateManager;
  private methodologyHandler: ConsolidatedFrameworkManager;

  async handleAction(args: ResourceManagerInput): Promise<ToolResponse> {
    const { resource_type } = args;

    // Validate resource_type
    if (!resource_type) {
      return this.createErrorResponse(
        'resource_type is required. Use: "prompt", "gate", or "methodology"'
      );
    }

    // Validate action is valid for resource_type
    const validationError = this.validateActionForResourceType(args);
    if (validationError) {
      return this.createErrorResponse(validationError);
    }

    // Route to appropriate handler
    switch (resource_type) {
      case 'prompt':
        return this.promptHandler.handleAction(args, {});
      case 'gate':
        return this.gateHandler.handleAction(args, {});
      case 'methodology':
        return this.methodologyHandler.handleAction(args, {});
      default:
        return this.createErrorResponse(
          `Invalid resource_type: "${resource_type}". Use: "prompt", "gate", or "methodology"`
        );
    }
  }

  private validateActionForResourceType(args: ResourceManagerInput): string | null {
    const { resource_type, action } = args;

    // Actions only valid for specific resource types
    const methodologyOnlyActions = ['switch'];
    const promptOnlyActions = ['analyze_type', 'analyze_gates', 'guide'];

    if (methodologyOnlyActions.includes(action) && resource_type !== 'methodology') {
      return `Action "${action}" is only valid for resource_type: "methodology"`;
    }

    if (promptOnlyActions.includes(action) && resource_type !== 'prompt') {
      return `Action "${action}" is only valid for resource_type: "prompt"`;
    }

    return null;
  }
}
```

### Phase 3: Register Unified Tool

**Files to modify:**
- `server/src/mcp-tools/index.ts`

**Changes:**
1. Add `ResourceManagerRouter` initialization
2. Register `resource_manager` tool
3. Mark `prompt_manager`, `gate_manager`, `framework_manager` as deprecated
4. Keep deprecated tools working for backward compatibility

```typescript
// In registerAllTools()
this.mcpServer.registerTool(
  'resource_manager',
  {
    title: 'Resource Manager',
    description: resourceManagerDescription,
    inputSchema: resourceManagerSchema,
  },
  async (args: ResourceManagerInput) => {
    return this.resourceManagerRouter.handleAction(args, context);
  }
);

// Deprecated tools still registered but with deprecation notice in description
this.mcpServer.registerTool(
  'prompt_manager',
  {
    title: 'Prompt Manager [DEPRECATED]',
    description: '⚠️ DEPRECATED: Use resource_manager(resource_type:"prompt", ...) instead.\n\n' + promptManagerDescription,
    // ...
  }
);
```

### Phase 4: Update Tool Descriptions

**Files to modify:**
- `server/tooling/contracts/resource-manager.json` (toolDescription block)
- Methodology guides' `getToolDescriptions()` methods

**Description structure:**
```markdown
Unified resource management for prompts, gates, and methodologies.

## Usage

resource_manager(resource_type:"prompt|gate|methodology", action:"...", ...)

## Resource Types

### Prompts (resource_type:"prompt")
Actions: create, update, delete, list, inspect, reload, analyze_type, analyze_gates, guide

### Gates (resource_type:"gate")
Actions: create, update, delete, list, inspect, reload

### Methodologies (resource_type:"methodology")
Actions: create, update, delete, list, inspect, reload, switch

## Examples

Create a prompt:
resource_manager(resource_type:"prompt", action:"create", id:"my_prompt", ...)

Create a gate:
resource_manager(resource_type:"gate", action:"create", id:"my_gate", ...)

Switch methodology:
resource_manager(resource_type:"methodology", action:"switch", id:"cageerf")
```

### Phase 5: Deprecation and Migration

**Timeline:**
1. **v1.2.0**: Add `resource_manager`, mark others deprecated
2. **v1.3.0**: Log deprecation warnings when deprecated tools used
3. **v2.0.0**: Remove deprecated tools entirely

**Migration guide:**
```markdown
## Migration from Separate Tools to resource_manager

### prompt_manager → resource_manager
Before: prompt_manager(action:"create", id:"foo", ...)
After:  resource_manager(resource_type:"prompt", action:"create", id:"foo", ...)

### gate_manager → resource_manager
Before: gate_manager(action:"create", id:"bar", ...)
After:  resource_manager(resource_type:"gate", action:"create", id:"bar", ...)

### framework_manager → resource_manager
Before: framework_manager(action:"switch", id:"cageerf")
After:  resource_manager(resource_type:"methodology", action:"switch", id:"cageerf")
```

---

## Validation Strategy

### Schema Validation

```typescript
const ResourceManagerSchema = z.object({
  resource_type: z.enum(['prompt', 'gate', 'methodology']),
  action: z.enum([
    'create', 'update', 'delete', 'list', 'inspect', 'reload',
    'switch', 'analyze_type', 'analyze_gates', 'guide'
  ]),
  // Common
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  enabled_only: z.boolean().optional(),
  confirm: z.boolean().optional(),
  reason: z.string().optional(),
  // ... resource-specific fields with .optional()
}).refine(
  (data) => {
    // Validate action is valid for resource_type
    if (data.action === 'switch' && data.resource_type !== 'methodology') {
      return false;
    }
    if (['analyze_type', 'analyze_gates', 'guide'].includes(data.action) &&
        data.resource_type !== 'prompt') {
      return false;
    }
    return true;
  },
  { message: 'Invalid action for resource_type' }
);
```

### Runtime Validation

Each handler validates its resource-specific parameters:
- Prompt handler validates `category`, `user_message_template`, etc.
- Gate handler validates `type`, `guidance`, `pass_criteria`, etc.
- Methodology handler validates `methodology`, `phases`, etc.

---

## Testing Strategy

### Unit Tests

```typescript
describe('ResourceManagerRouter', () => {
  describe('routing', () => {
    it('routes prompt resources to prompt handler', async () => {
      const result = await router.handleAction({
        resource_type: 'prompt',
        action: 'list'
      });
      expect(promptHandler.handleAction).toHaveBeenCalled();
    });

    it('routes gate resources to gate handler', async () => {
      const result = await router.handleAction({
        resource_type: 'gate',
        action: 'list'
      });
      expect(gateHandler.handleAction).toHaveBeenCalled();
    });

    it('routes methodology resources to methodology handler', async () => {
      const result = await router.handleAction({
        resource_type: 'methodology',
        action: 'list'
      });
      expect(methodologyHandler.handleAction).toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('rejects switch action for non-methodology resources', async () => {
      const result = await router.handleAction({
        resource_type: 'prompt',
        action: 'switch'
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('only valid for resource_type: "methodology"');
    });

    it('requires resource_type parameter', async () => {
      const result = await router.handleAction({
        action: 'list'
      } as any);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('resource_type is required');
    });
  });
});
```

### Integration Tests

```typescript
describe('resource_manager integration', () => {
  it('creates prompt via unified tool', async () => {
    const result = await mcpServer.callTool('resource_manager', {
      resource_type: 'prompt',
      action: 'create',
      id: 'test_prompt',
      category: 'test',
      user_message_template: 'Hello {{name}}'
    });
    expect(result.isError).toBe(false);
  });

  it('creates gate via unified tool', async () => {
    const result = await mcpServer.callTool('resource_manager', {
      resource_type: 'gate',
      action: 'create',
      id: 'test_gate',
      name: 'Test Gate',
      description: 'A test gate',
      guidance: '# Test guidance'
    });
    expect(result.isError).toBe(false);
  });
});
```

---

## Implementation Checklist

### Phase 1: Contract ✅ COMPLETE
- [x] Create `server/tooling/contracts/resource-manager.json`
- [x] Define all parameters with conditional requirements
- [x] Run `npm run generate:contracts`

### Phase 2: Router ✅ COMPLETE
- [x] Create `server/src/mcp-tools/resource-manager/core/types.ts`
- [x] Create `server/src/mcp-tools/resource-manager/core/router.ts`
- [x] Create `server/src/mcp-tools/resource-manager/core/index.ts`
- [x] Create `server/src/mcp-tools/resource-manager/index.ts`
- [x] Implement action validation for resource types
- [x] Wire up existing handlers

### Phase 3: Registration ✅ COMPLETE
- [x] Update `server/src/mcp-tools/index.ts`
- [x] Add `ResourceManagerRouter` initialization
- [x] Register `resource_manager` tool
- [x] Add deprecation notices to old tools

### Phase 4: Documentation ✅ COMPLETE (Dec 17, 2025)
- [x] Update `docs/reference/mcp-tools.md`
  - Added resource_manager to Quick Start section
  - Updated "The Three Tools" table
  - Added deprecation notice for prompt_manager, gate_manager, framework_manager
  - Added full resource_manager documentation section
- [x] Add migration guide
  - Added Migration Guide section with before/after examples
  - Added deprecation timeline table (v1.2.0 → v1.3.0 → v2.0.0)
- [x] Update methodology guides' tool descriptions
  - Updated `cageerf/methodology.yaml` - added resource_manager, removed prompt_manager
  - Updated `react/methodology.yaml` - added resource_manager, removed prompt_manager
  - Updated `5w1h/methodology.yaml` - added resource_manager, removed prompt_manager
  - Updated `scamper/methodology.yaml` - added resource_manager, removed prompt_manager

### Phase 5: Testing ✅ COMPLETE (Dec 17, 2025)
- [x] Add unit tests for router
  - Created `tests/unit/mcp-tools/resource-manager/router.test.ts`
  - 18 unit tests covering routing, action validation, parameter transformation, error handling
- [x] Add integration tests
  - Created `tests/integration/mcp-tools/resource-manager-workflow.test.ts`
  - 11 integration tests covering CRUD workflows, cross-resource operations, context passthrough
- [x] Run full validation suite
  - `npm run typecheck` ✅
  - `npm run lint:ratchet` ✅
  - `npm run test:ci` ✅

### Phase 6: Complete Removal of Deprecated Tools ✅ COMPLETED

Removed all references to deprecated tools (`prompt_manager`, `gate_manager`, `framework_manager`):

**Code Changes:**
- [x] Updated `mcp-tools/index.ts` - Removed deprecation logging, updated tool summary
- [x] Updated `system-control.ts` - Changed help text to reference `resource_manager`
- [x] Updated `gate-manager/core/manager.ts` - Updated help text
- [x] Updated `framework-manager/core/manager.ts` - Updated help text and default reason strings
- [x] Updated `tool-description-manager.ts` - Removed `prompt_manager` fallback, added `resource_manager`
- [x] Updated `prompt-engine/core/prompt-execution-service.ts` - Updated error messages
- [x] Updated `prompt-engine/utils/tool-routing.ts` - Updated comments
- [x] Updated `mcp-tools/constants.ts` - Replaced `PROMPT_MANAGER` with `RESOURCE_MANAGER`

**Documentation Changes:**
- [x] Updated `docs/reference/mcp-tools.md` - Removed deprecated section, updated examples
- [x] Updated `docs/guides/chains.md` - Updated all tool references
- [x] Updated `docs/guides/prompt-authoring-guide.md` - Updated all tool references

**Validation:**
- [x] `npm run typecheck` ✅
- [x] `npm run lint:ratchet` ✅
- [x] `npm run test:ci` ✅ (715 tests passed)

---

## Trade-offs

### Pros
- Single tool to learn and remember
- Consistent parameter structure across resource types
- Easier to document and explain
- Reduces MCP tool count (5 → 3)
- Future resource types easily added

### Cons
- Larger parameter schema (many optional fields)
- Validation more complex (conditional requirements)
- Error messages must be resource-type aware
- Breaking change for existing users (mitigated by deprecation period)

---

## Open Questions

1. **Tool naming**: Keep as `prompt_manager` with expanded scope, or rename to `resource_manager`?
   - Recommendation: `resource_manager` (clearer intent)

2. **Deprecation timeline**: How long to support old tools?
   - Recommendation: 2 minor versions (v1.2 → v1.4)

3. **Parameter collision**: What if `type` means different things for prompts vs gates?
   - Current: Gates use `type` for validation/guidance
   - Solution: Use `gate_type` for gates, keep `type` for future prompt types

---

*Plan Version: 1.2*
*Created: December 2025*
*Updated: December 18, 2025*
*Status: ALL PHASES COMPLETE. resource_manager is now the only resource management MCP tool.*
