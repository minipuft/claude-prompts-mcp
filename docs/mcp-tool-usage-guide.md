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

### Pattern 5: Quality Gates (Simplified)

Use the simplified hybrid interface to combine built-in gates with quick custom checks.

#### Discover Available Gates

```javascript
// List all configured gates
system_control({
  action: "gates",
  operation: "list"
})
```

#### Basic Usage: Built-in Gates

```javascript
prompt_engine({
  command: ">>code_review code='...'",
  quality_gates: ["gate-name-1", "gate-name-2"],
  gate_mode: "enforce"
})
```

#### Advanced: Custom Checks

```javascript
prompt_engine({
  command: ">>my_prompt",
  quality_gates: ["gate-name"],
  custom_checks: [
    { name: "production-ready", description: "Include error handling and logging" }
  ],
  gate_mode: "enforce"
})
```

#### Gate Modes

- **enforce**: Validates output, retries on failure with improvement hints (default when gates provided)
- **advise**: Provides guidance without blocking execution
- **report**: Runs validation once and includes pass/fail status in the response

> Need full control? `gate_configuration.temporary_gates` remains available for advanced scenarios, but prefer `quality_gates` and `custom_checks` for most workflows.

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

### Common Parameter Mistakes

#### ❌ "Missing required fields: id, name, description, user_message_template"

**Problem**: Trying to create a prompt without all required parameters.

**Solution**: All create actions require 4 essential parameters:
```bash
prompt_manager(
  action: "create",
  id: "unique_identifier",           # ⚠️ REQUIRED
  name: "Human Readable Name",        # ⚠️ REQUIRED
  description: "What it does",        # ⚠️ REQUIRED
  user_message_template: "{{input}}"  # ⚠️ REQUIRED
)
```

**Common variations**:
- ❌ `userMessageTemplate` → ✅ `user_message_template` (snake_case)
- ❌ Missing `id` → ✅ Always include unique identifier
- ❌ Empty string → ✅ Provide meaningful content

#### ❌ "Missing required fields: id"

**Problem**: Trying to update/delete/modify without specifying which prompt.

**Solution**: Most operations need the `id` parameter:
```bash
# Update
prompt_manager(action: "update", id: "my_prompt", description: "New description")

# Delete
prompt_manager(action: "delete", id: "my_prompt")

# Analyze
prompt_manager(action: "analyze_type", id: "my_prompt")
```

#### ❌ "Prompt ID must contain only alphanumeric characters, underscores, and hyphens"

**Problem**: Using invalid characters in prompt ID.

**Solution**: IDs must match pattern `^[a-zA-Z0-9_-]+$`:
```bash
# ❌ Bad IDs
id: "my prompt"        # spaces not allowed
id: "my.prompt"        # dots not allowed
id: "my/prompt"        # slashes not allowed

# ✅ Good IDs
id: "my_prompt"        # underscores OK
id: "my-prompt"        # hyphens OK
id: "MyPrompt123"      # alphanumeric OK
```

### Parameter Quick Reference

| Action | Required Parameters | Optional Parameters |
|--------|-------------------|-------------------|
| `create` | `id`, `name`, `description`, `user_message_template` | `category`, `system_message`, `arguments`, `gate_configuration` |
| `create_prompt` | `id`, `name`, `description`, `user_message_template` | `category`, `system_message`, `arguments`, `gate_configuration` |
| `create_template` | `id`, `name`, `description`, `user_message_template` | `category`, `system_message`, `arguments`, `gate_configuration` |
| `update` | `id` | Any field to update |
| `delete` | `id` | - |
| `modify` | `id`, `section_name`, `new_content` | - |
| `analyze_type` | `id` | - |
| `migrate_type` | `id`, `target_type` | - |
| `analyze_gates` | `id` | - |
| `suggest_temporary_gates` | `execution_context` | - |
| `reload` | - | `full_restart`, `reason` |
| `list` | - | `search_query` |

### MCP Protocol Errors

#### "MCP error -32602: Tool has output schema but no structured content"
This indicates a tool isn't returning properly structured responses. This has been fixed in recent versions, but if encountered:
- Update to the latest server version
- Use the MCP tools instead of direct file operations

#### "Resource not found" errors
- Use `prompt_manager(action: "list")` to see available prompts
- Check that the prompt ID exists before trying to modify it
- Use reload to refresh the registry

### Chain Execution Failures
- Validate chain structure with `prompt_manager(action: "list", filter: "type:chain")`
- Check step dependencies and input/output mappings
- Use `system_control(action: "diagnostics")` for debugging

## Summary

The MCP server provides a structured, consistent interface for managing prompts and chains. Always use the MCP tools (`prompt_manager`, `system_control`, `prompt_engine`) instead of direct file manipulation. This ensures data consistency, proper error handling, and maintains the MCP protocol compliance.
