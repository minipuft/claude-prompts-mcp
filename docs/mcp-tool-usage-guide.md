# MCP Tool Usage Guide

## Overview

This guide explains the **correct way** to interact with the Claude Prompts MCP server. The server provides structured MCP tools that should be used instead of direct file manipulation.

## ❌ Wrong Approach (What NOT to do)

**Never use these tools directly:**
- `Update()` - Direct file modification
- `Write()` - Creating files directly
- `Edit()` - Direct file editing
- `MultiEdit()` - Direct file operations
- Direct filesystem manipulation via `Bash` commands

**Example of INCORRECT usage from logFail.txt:**
```
● Update(~/Applications/claude-prompts-mcp/server/prompts/chains/notes_modular/chain.json)
● Write(~/Applications/claude-prompts-mcp/server/prompts/chains/notes_modular/steps/step_5.md)
● Write(~/Applications/claude-prompts-mcp/server/prompts/analysis/notes_step_5.md)
```

This bypasses the MCP system and leads to:
- MCP protocol violations
- Missing structured content errors
- Data inconsistency
- Broken hot-reloading
- Registry desynchronization

## ✅ Correct Approach (MCP Tools)

### 1. Prompt Manager Tool

The `prompt_manager` tool is your primary interface for all prompt operations:

#### Available Actions:
- `create` - Create new prompts (auto-detects type)
- `create_prompt` - Create basic variable-substitution prompts
- `create_template` - Create framework-aware templates
- `update` - Update existing prompts
- `delete` - Delete prompts with safety checks
- `modify` - Modify specific sections of prompts
- `reload` - Hot-reload all prompts
- `list` - List and search prompts
- `analyze_type` - Analyze prompt execution type
- `migrate_type` - Convert between prompt/template types

### 2. System Control Tool

The `system_control` tool manages server state and frameworks:

#### Available Actions:
- `status` - Get system status and health
- `switch_framework` - Change active methodology framework
- `list_frameworks` - List available frameworks
- `analytics` - Get execution analytics
- `config` - Configuration management
- `restart` - Server restart (with confirmation)

### 3. Prompt Engine Tool

The `prompt_engine` tool executes prompts and chains:

#### Command Formats:
- `>>prompt_name arguments` - Execute simple prompts
- `chain://chain_name` - Execute chains via URI
- `scaffold chain_name template:custom` - Create new chains
- `convert source_prompt` - Convert prompts to chains

## Correct Chain Modification Workflow

### Scenario: Adding a vault search step to notes chain

**The RIGHT way to do this:**

```bash
# 1. First, check what exists
prompt_manager(action: "list", filter: "notes")

# 2. Check if vault_related_notes_finder exists
prompt_manager(action: "list", filter: "vault")

# 3. If the vault finder doesn't exist, create it
prompt_manager(action: "create", id: "vault_related_notes_finder",
  name: "Vault Related Notes Finder",
  category: "content_processing",
  description: "Searches vault for relevant related notes",
  user_message_template: "Find related notes in {{vault_path}} for: {{note_topic}}")

# 4. Update the notes chain to include the new step
prompt_manager(action: "update", id: "notes_modular",
  chain_steps: [
    // existing steps...
    {
      "id": "step_4",
      "name": "Vault Related Notes Search",
      "promptId": "vault_related_notes_finder",
      "order": 3,
      "dependencies": ["step_3"],
      "inputMapping": {
        "note_topic": "content",
        "vault_path": "/path/to/vault"
      },
      "outputMapping": {
        "result": "related_notes"
      }
    },
    // updated final step...
  ])

# 5. Reload to apply changes
prompt_manager(action: "reload")

# 6. Test the updated chain
prompt_engine(command: ">>notes_modular content:'Test content'")
```

## Common Usage Patterns

### Pattern 1: Creating New Prompts

```bash
# Basic prompt (simple variable substitution)
prompt_manager(action: "create_prompt",
  id: "my_prompt",
  name: "My Simple Prompt",
  user_message_template: "Analyze: {{content}}")

# Framework-aware template
prompt_manager(action: "create_template",
  id: "my_template",
  name: "My Smart Template",
  user_message_template: "Using systematic methodology: {{input}}")
```

### Pattern 2: Modifying Existing Prompts

```bash
# Update entire prompt
prompt_manager(action: "update", id: "existing_prompt",
  name: "Updated Name",
  user_message_template: "New template: {{input}}")

# Modify specific section
prompt_manager(action: "modify", id: "existing_prompt",
  section_name: "user_message_template",
  new_content: "Modified template: {{input}}")
```

### Pattern 3: Working with Chains

```bash
# List chains
prompt_manager(action: "list", filter: "type:chain")

# Execute chain
prompt_engine(command: ">>chain_name input:'data'")

# Create new chain using scaffolding
prompt_engine(command: "scaffold new_chain template:custom name:'My Chain'")
```

### Pattern 4: System Management

```bash
# Check system status
system_control(action: "status")

# Switch framework methodology
system_control(action: "switch_framework", framework: "CAGEERF",
  reason: "Better for complex analysis")

# Get analytics
system_control(action: "analytics", include_history: true)
```

## Advanced Search and Discovery

The prompt_manager supports advanced filtering:

```bash
# Search by category
prompt_manager(action: "list", filter: "category:analysis")

# Search by type
prompt_manager(action: "list", filter: "type:chain")

# Search by intent
prompt_manager(action: "list", filter: "intent:debugging")

# Combined filters
prompt_manager(action: "list", filter: "category:code type:template confidence:>80")

# Text search
prompt_manager(action: "list", filter: "notes vault")
```

## Error Recovery

If you encounter MCP protocol errors:

1. **Check tool response structure**:
   - All tools return structured responses with `content` and `structuredContent`
   - Error responses include proper error metadata

2. **Use reload to fix state issues**:
   ```bash
   prompt_manager(action: "reload")
   ```

3. **Check system health**:
   ```bash
   system_control(action: "diagnostics")
   ```

4. **Restart if needed**:
   ```bash
   system_control(action: "restart", confirm: true, reason: "Fix protocol errors")
   ```

## Best Practices

### ✅ DO:
- Always use MCP tools for prompt/chain management
- Use `prompt_manager(action: "list")` to explore available prompts
- Test changes with `prompt_manager(action: "reload")`
- Use structured search filters to find relevant prompts
- Check system status with `system_control(action: "status")`

### ❌ DON'T:
- Never use direct file manipulation (Update, Write, Edit, MultiEdit)
- Don't bypass the MCP tool interface
- Don't create files directly in the prompts directory
- Don't modify JSON files manually
- Don't skip the reload step after changes

## Troubleshooting

### "MCP error -32602: Tool has output schema but no structured content"
This indicates a tool isn't returning properly structured responses. This has been fixed in recent versions, but if encountered:
- Update to the latest server version
- Use the MCP tools instead of direct file operations

### "Resource not found" errors
- Use `prompt_manager(action: "list")` to see available prompts
- Check that the prompt ID exists before trying to modify it
- Use reload to refresh the registry

### Chain execution failures
- Validate chain structure with `prompt_manager(action: "list", filter: "type:chain")`
- Check step dependencies and input/output mappings
- Use `system_control(action: "diagnostics")` for debugging

## Summary

The MCP server provides a structured, consistent interface for managing prompts and chains. Always use the MCP tools (`prompt_manager`, `system_control`, `prompt_engine`) instead of direct file manipulation. This ensures data consistency, proper error handling, and maintains the MCP protocol compliance.