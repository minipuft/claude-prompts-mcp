# Intelligent Command Routing Implementation Plan

## Overview
Create an intelligent command router that extends the existing parser infrastructure to route commands to appropriate tools, enabling simplified LLM interfaces without introducing unnecessary complexity.

## Current Architecture Analysis

### Existing Integration Points
1. **Primary Entry**: `prompt_engine.executePromptCommand()` (lines 406-445)
2. **Parsing Hook**: `parseCommandUnified()` already handles chain management detection (lines 638-650)
3. **Parser System**: `UnifiedCommandParser` with unified parsing system in place
4. **Tool References**: All tools accessible via `ConsolidatedMcpToolsManager`

### Current Flow
```
LLM → prompt_engine → parseCommandUnified() → UnifiedCommandParser → prompt execution
                    → chainExecutor (if chain management)
```

### Proposed Enhanced Flow
```
LLM → prompt_engine → parseCommandUnified() → CommandRouter (NEW) → prompt_manager
                                            → UnifiedCommandParser → prompt execution
                                            → chainExecutor (if chain management)
                                            → system_control
```

## Implementation Strategy: Minimal Complexity Integration

### Phase 1: Extend Existing Parser (Zero Breaking Changes)

#### 1.1 Enhance parseCommandUnified() Method
**File**: `src/mcp-tools/prompt-engine/core/engine.ts` (lines 629-708)

**Current Structure**:
```typescript
// Phase 1: Smart chain management command detection (lines 638-650)
if (this.chainExecutor) {
  const chainCommand = this.chainExecutor.detectChainManagementCommand(command);
  if (chainCommand.isChainManagement) { /* ... */ }
}
// Use new unified command parser (lines 652-707)
```

**Enhanced Structure**:
```typescript
// Phase 1: Smart chain management command detection (EXISTING)
if (this.chainExecutor) { /* ... */ }

// Phase 2: Smart tool routing detection (NEW)
const toolRoute = await this.detectToolRoutingCommand(command);
if (toolRoute.requiresRouting) {
  return await this.routeToTool(toolRoute.targetTool, toolRoute.translatedParams);
}

// Phase 3: Use unified command parser for prompt execution (EXISTING)
```

#### 1.2 Add Tool Routing Detection
**New Method**: `detectToolRoutingCommand(command: string)`

**Routing Rules**:
```typescript
const ROUTING_PATTERNS = {
  // Built-in commands that should route to prompt_manager
  'listprompts|list prompts': { tool: 'prompt_manager', action: 'list' },
  'help|commands': { tool: 'system_control', action: 'status', show_details: true },

  // System commands that should route to system_control
  'status|health': { tool: 'system_control', action: 'status' },
  'framework (switch|change) (.+)': { tool: 'system_control', action: 'framework', operation: 'switch', framework: '$2' },
  'analytics|metrics': { tool: 'system_control', action: 'analytics' },

  // Prompt management commands that should route to prompt_manager
  'create prompt (.+)': { tool: 'prompt_manager', action: 'create', name: '$1' },
  'delete prompt (.+)': { tool: 'prompt_manager', action: 'delete', id: '$1' },
  'update prompt (.+)': { tool: 'prompt_manager', action: 'update', id: '$1' },

  // Default: let existing parser handle >>prompt_name patterns
};
```

#### 1.3 Add Tool Router Method
**New Method**: `routeToTool(targetTool: string, params: any)`

```typescript
private async routeToTool(targetTool: string, params: any): Promise<ToolResponse> {
  switch (targetTool) {
    case 'prompt_manager':
      if (this.mcpToolsManager?.promptManagerTool) {
        return await this.mcpToolsManager.promptManagerTool.handleAction(params, {});
      }
      break;
    case 'system_control':
      if (this.mcpToolsManager?.systemControl) {
        return await this.mcpToolsManager.systemControl.handleAction(params, {});
      }
      break;
  }
  throw new Error(`Tool routing failed: ${targetTool} not available`);
}
```

### Phase 2: Extend Parser with Built-in Commands

#### 2.1 Enhance UnifiedCommandParser
**File**: `src/execution/parsers/unified-command-parser.ts` (lines 317-324)

**Current Error Handling**:
```typescript
private async validatePromptExists(promptId: string, availablePrompts: PromptData[]): Promise<void> {
  const found = availablePrompts.find(p => p.id === promptId || p.name === promptId);
  if (!found) {
    // Error: "Use >>listprompts to see all available prompts."
  }
}
```

**Enhanced with Built-in Detection**:
```typescript
private async validatePromptExists(promptId: string, availablePrompts: PromptData[]): Promise<void> {
  // Check built-in commands first
  if (this.isBuiltinCommand(promptId)) {
    return; // Valid built-in command, no validation needed
  }

  const found = availablePrompts.find(p => p.id === promptId || p.name === promptId);
  if (!found) {
    const suggestions = this.generatePromptSuggestions(promptId, availablePrompts);
    throw new PromptError(
      `Unknown prompt: "${promptId}". ${suggestions}\n\nTry: >>listprompts, >>help, >>status`
    );
  }
}

private isBuiltinCommand(promptId: string): boolean {
  const builtinCommands = ['listprompts', 'help', 'status', 'analytics'];
  return builtinCommands.includes(promptId);
}
```

### Phase 3: Tool Manager Integration

#### 3.1 Add Tool References to Prompt Engine
**File**: `src/mcp-tools/prompt-engine/core/engine.ts` (constructor area)

**Current**:
```typescript
// MCP Tools Manager reference for analytics flow
private mcpToolsManager?: any;
```

**Enhanced**:
```typescript
// MCP Tools Manager reference for tool routing
private mcpToolsManager?: any;

setMcpToolsManager(manager: any): void {
  this.mcpToolsManager = manager;
}
```

#### 3.2 Update MCP Tools Manager Initialization
**File**: `src/mcp-tools/index.ts` (initialization section)

**Add Reference Setup**:
```typescript
// Set tool manager reference for routing
this.promptEngine.setMcpToolsManager(this);
```

## Command Mapping Strategy

### Simple Command Translations

| LLM Input | Routed Tool | Translated Parameters |
|-----------|-------------|----------------------|
| `>>listprompts` | `prompt_manager` | `{ action: "list" }` |
| `>>listprompts category:analysis` | `prompt_manager` | `{ action: "list", search_query: "category:analysis" }` |
| `>>help` | `system_control` | `{ action: "status", show_details: true }` |
| `>>status` | `system_control` | `{ action: "status" }` |
| `>>framework switch CAGEERF` | `system_control` | `{ action: "framework", operation: "switch", framework: "CAGEERF" }` |
| `>>analytics` | `system_control` | `{ action: "analytics" }` |
| `>>create prompt test` | `prompt_manager` | `{ action: "create", name: "test" }` |

### Fallback Strategy
- If no routing pattern matches, use existing `UnifiedCommandParser` for prompt execution
- Maintains 100% backwards compatibility with existing `>>prompt_name` patterns
- Chain management commands continue to work via existing `chainExecutor` detection

## Benefits of This Approach

### 1. **Zero Breaking Changes**
- Existing tools unchanged
- Existing prompt execution flow unchanged
- Chain management continues to work
- All current functionality preserved

### 2. **Minimal Complexity**
- Extends existing parser infrastructure
- Reuses existing tool references
- No new tool registrations needed
- No new schemas or interfaces

### 3. **Progressive Enhancement**
- Phase 1: Basic routing (immediate benefit)
- Phase 2: Enhanced parser messages (better UX)
- Phase 3: Tool manager integration (full routing)

### 4. **LLM-Friendly**
- Simple `>>command` syntax for everything
- Built-in commands work as expected
- No complex schemas to remember
- Natural language patterns supported

## Implementation Timeline

### Phase 1 (Immediate): Core Routing
- [ ] Add `detectToolRoutingCommand()` method
- [ ] Add `routeToTool()` method
- [ ] Integrate into `parseCommandUnified()`
- [ ] Test basic routing: `>>listprompts`, `>>help`, `>>status`

### Phase 2 (Next): Parser Enhancement
- [ ] Add built-in command detection to `UnifiedCommandParser`
- [ ] Update error messages with better suggestions
- [ ] Test enhanced error handling

### Phase 3 (Final): Tool Manager Integration
- [ ] Add tool manager reference to prompt engine
- [ ] Update initialization sequence
- [ ] Test full routing functionality
- [ ] Validate no regression in existing features

## Testing Strategy

### Unit Tests
- Test routing pattern detection
- Test parameter translation
- Test fallback to existing parser

### Integration Tests
- Test `>>listprompts` routes to prompt_manager correctly
- Test `>>help` routes to system_control correctly
- Test existing `>>prompt_name` patterns still work
- Test chain management commands still work

### Backwards Compatibility Tests
- All existing prompt execution patterns must continue working
- All existing tool calls must continue working
- All existing chain management must continue working

## Risk Mitigation

### 1. **Routing Conflicts**
- **Risk**: Routing pattern conflicts with existing prompt names
- **Mitigation**: Routing detection only for specific built-in commands, fallback to prompt parser

### 2. **Tool Availability**
- **Risk**: Target tool not available during routing
- **Mitigation**: Graceful fallback with clear error messages

### 3. **Performance Impact**
- **Risk**: Routing detection adds latency
- **Mitigation**: Simple regex patterns, early exit for non-matches

## Success Criteria

### Primary Goals
1. `>>listprompts` works without modification to prompt_manager
2. `>>help` and `>>status` work without modification to system_control
3. All existing functionality continues to work unchanged

### Secondary Goals
1. Natural language commands like "list prompts" work
2. Complex routing like `>>framework switch CAGEERF` works
3. Enhanced error messages guide users to available commands

## Files Modified Summary

### New Files (None Required)
- All functionality added to existing files

### Modified Files
1. `src/mcp-tools/prompt-engine/core/engine.ts`
   - Add routing detection and delegation methods
   - Enhance `parseCommandUnified()` method

2. `src/execution/parsers/unified-command-parser.ts`
   - Add built-in command detection
   - Enhance error messages

3. `src/mcp-tools/index.ts`
   - Add tool manager reference setup

### Configuration Changes (None Required)
- No new configuration files or settings needed

## Conclusion

This implementation provides a clean, non-invasive way to add intelligent command routing that makes the system much more LLM-friendly while preserving all existing functionality and maintaining the current architecture. The routing layer integrates seamlessly into the existing parser infrastructure without introducing unnecessary complexity.