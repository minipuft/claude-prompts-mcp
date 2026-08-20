---
title: "Programmatic Tool Calling Implementation Plan"
date: 2025-11-26
status: backlog
tags: []
---

# Programmatic Tool Calling Implementation Plan

**Status:** Future / Deferred
**Priority:** Low - Requires Claude Desktop to support Code Execution Beta
**Goal:** Enable true LLM-as-judge functionality via Anthropic's Programmatic Tool Calling

> **Note:** This plan is deferred because it requires **direct Anthropic API integration**, not just MCP tool registration. Claude Desktop would need to explicitly support the Code Execution Beta for this to work with MCP servers.

## Architecture Clarification

**How Programmatic Tool Calling Actually Works:**

```
┌─────────────────────────────────────────────────────────────────┐
│              Your Application (Direct API Client)               │
│         Makes API calls with betas: ["code-execution-..."]      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1. API Request with tools
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Anthropic API                                 │
│   Claude writes code → Sandbox runs it → PAUSES on tool call    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 2. Returns tool_use request
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Your Application                                    │
│        Executes tool → Returns result to API                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 3. Tool result
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Anthropic API                                 │
│        Sandbox resumes → Continues script → Returns final        │
└─────────────────────────────────────────────────────────────────┘
```

**Key Points:**

- This is a **direct Anthropic API pattern**, NOT automatic MCP behavior
- The `allowed_callers` field is an **authorization mechanism** controlling which contexts can invoke tools
- Claude Desktop would need to **explicitly support this beta** and handle the tool execution loop
- Until Claude Desktop adds support, this only works via custom API integrations

**What This Means for MCP Servers:**

- Adding `allowed_callers` to MCP tools does nothing by itself
- Claude Desktop must enable `betas: ["code-execution-2025-08-25"]` in API calls
- Claude Desktop must handle the pause → execute → resume loop
- This is a **Claude Desktop feature request**, not an MCP server change

## Problem Statement

The current `%guided` modifier uses an "instruction-embedding" pattern where guidance instructions are visible in the response. This isn't true LLM-as-judge because:

- Instructions are visible to the user
- No actual LLM decision-making occurs - just presenting a menu
- Claude doesn't programmatically select resources before prompt execution

## Target Architecture (When Claude Desktop Supports It)

If/when Claude Desktop supports the Code Execution Beta, the flow would become:

```
User Request → Claude writes code → Calls resource_judge → Gets selections → Calls prompt_engine → Returns final result
```

Only final results would enter context (invisible intermediate calls).

### Requirements from Anthropic

1. **Beta Header**: `betas: ["code-execution-2025-08-25"]` (must be enabled by Claude Desktop)
2. **Callable Tools**: MCP tools marked with `"allowed_callers": ["code_execution_20250825"]`
3. **Judge Tool**: New `resource_judge` tool that analyzes prompts and returns selections

## Implementation Phases (When Prerequisites Met)

### Phase 1: Create Resource Judge MCP Tool

**New File:** `server/src/mcp-tools/resource-judge.ts`

```typescript
{
  name: "resource_judge",
  description: "Analyze a prompt and recommend appropriate guidance resources",
  input_schema: {
    type: "object",
    properties: {
      prompt_command: { type: "string" },
      prompt_content: { type: "string" }
    },
    required: ["prompt_command"]
  },
  allowed_callers: ["code_execution_20250825"]
}
```

### Phase 2: Add allowed_callers to Existing Tools

Update tool registrations in `server/src/mcp-tools/index.ts`:

```typescript
{
  name: "prompt_engine",
  ...,
  allowed_callers: ["code_execution_20250825"]
}
```

### Phase 3-8: See Full Implementation Details

Remaining phases cover:

- Implement judge logic (reusing existing resource collection)
- Update prompt_engine to accept `selected_resources` param
- Replace %guided modifier logic
- Update MCP SDK configuration
- Comprehensive testing
- Cleanup unused logic

## Current Interim Solution

The `%guided` modifier with instruction-embedding pattern is functional:

- Embeds a `<guidance_context>` block with resource menu
- Claude (user's session) reads instructions and selects resources
- Selection happens within the same response (visible but works)

## Reusable Components from %guided Implementation

These components built for the current approach are reusable:

- `collectAllResources()` - Gathers styles, frameworks, gates
- `formatResourceMenuForClaude()` - Menu formatting
- `listAvailableGateDefinitions()` - Gate enumeration
- Resource metadata structures
- Pipeline stage infrastructure

## Prerequisites for Implementation

1. **Claude Desktop must support Code Execution Beta** - This is a Claude Desktop feature, not MCP
2. **MCP SDK may need updates** - To support `allowed_callers` field serialization
3. **No server-side API key needed** - Execution happens in user's session via Claude Desktop

## Sources

- [Advanced Tool Use - Anthropic Engineering](https://www.anthropic.com/engineering/advanced-tool-use)
- [Code Execution Tool Documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
- [Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook)
