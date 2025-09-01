# MCP Tools Reference (v1.3.0 - Consolidated Tools)

> ⚠️ **Note**: This documentation describes legacy tools. The server now uses **3 consolidated tools**: `prompt_engine`, `prompt_manager`, and `system_control`. For current tool reference, see the [Execution Architecture Guide](./execution-architecture-guide.md).

This document provides a reference for MCP (Model Context Protocol) tools. The primary way to interact with the server is through these consolidated tools via compatible MCP clients (like Claude Desktop or Cursor Windsurf).

## Interaction Model

Clients execute server capabilities by sending `tool_code` requests. Each tool has a unique name and a defined set of arguments based on a Zod schema, ensuring type safety and validation.

---

## Core Tools (Enhanced v1.1.0)

These tools provide the main functionality for prompt discovery and execution with enhanced reliability and quality assurance.

### `execute_prompt` 🎯 **NEW PRIMARY TOOL**

**Universal Prompt Executor**: Intelligently executes prompts, chains, and workflows with built-in validation gates. Automatically detects execution type and handles step-by-step progression with quality assurance.

**Description**: "🎯 UNIVERSAL PROMPT EXECUTOR: Intelligently executes prompts, chains, and workflows with built-in validation gates. Automatically detects execution type and handles step-by-step progression with quality assurance."

**Parameters**:

- `command` (string, required): Command to execute (>>prompt_name args). For chains/workflows, this tool will automatically execute each step and validate completion before proceeding to the next step. Use '>>' or '/' prefix followed by prompt name and arguments.
  - Example: `">>content_analysis Hello world"`
  - Example: `">>notes my research content"`

- `execution_mode` (enum, optional): Execution mode: 'auto' (default - auto-detect), 'template' (return template info), 'chain' (execute as chain), 'workflow' (execute with full gate validation)
  - Default: `"auto"`
  - Options: `"auto"`, `"template"`, `"chain"`, `"workflow"`

- `gate_validation` (boolean, optional): Enable gate validation for quality assurance (default: true for chains/workflows, false for single prompts)
  - Default: Auto-determined based on execution mode

- `step_confirmation` (boolean, optional): Require confirmation between chain steps (default: false)
  - Default: `false`

**Enhanced Behavior**:

- **Automatic Mode Detection**: Intelligently detects if prompt is a template, chain, or workflow
- **Gate Validation**: Applies quality gates to ensure reliable output
- **Step-by-Step Execution**: For chains, validates each step before proceeding
- **Retry Mechanisms**: Intelligent retry for failed validations with improvement guidance
- **Progress Tracking**: Real-time execution state monitoring

**Example Usage**:
```json
// Basic execution with auto-detection
{"command": ">>content_analysis my data", "execution_mode": "auto"}

// Workflow execution with gate validation
{"command": ">>content_analysis my data", "execution_mode": "workflow", "gate_validation": true}

// Chain execution with step confirmation
{"command": ">>notes my content", "execution_mode": "chain", "step_confirmation": true}
```


### `listprompts`

Lists all available commands/prompts, grouped by category, with descriptions and usage examples.

**Description**: "Optional filter text to show only matching commands"

**Parameters**:

- `command` (string, optional): A filter to show only commands matching the text. (Note: The schema shows an optional `command` arg, which seems to be for parsing the filter text from the command itself, e.g., `/listprompts myfilter`).

**Example Invocation**: A client would invoke the `listprompts` tool, often without arguments, to get a full list of available prompts to display to the user.

### `execution_analytics` 📊 **NEW ANALYTICS TOOL**

**Execution Analytics**: View execution analytics and performance metrics for the enhanced prompt execution system.

**Description**: "📊 View execution analytics and performance metrics for the enhanced prompt execution system"

**Parameters**:

- `include_history` (boolean, optional): Include recent execution history (default: false)
  - Default: `false`

- `reset_analytics` (boolean, optional): Reset analytics counters (default: false)
  - Default: `false`

**Analytics Provided**:

- **Overall Performance**: Total executions, success rate, failed executions, retries, average execution time
- **Execution Modes**: Usage statistics for auto, template, chain, and workflow modes
- **Gate Validation**: Gate usage statistics and adoption rates
- **Current State**: Active execution status and history size
- **Recent History** (optional): Last 10 executions with duration and status

**Example Usage**:
```json
// Basic analytics view
{"include_history": false}

// Analytics with execution history
{"include_history": true}

// Reset all analytics
{"reset_analytics": true}
```

**Sample Output**:
```
📊 **EXECUTION ANALYTICS REPORT**

## 📈 Overall Performance
- **Total Executions**: 45
- **Success Rate**: 95.6%
- **Failed Executions**: 2
- **Retried Executions**: 3
- **Average Execution Time**: 1.23s

## 🎯 Execution Modes
- **Auto Mode**: 25 executions
- **Template Mode**: 5 executions
- **Chain Mode**: 8 executions
- **Workflow Mode**: 7 executions

## 🛡️ Gate Validation
- **Gate Validation Usage**: 15 executions
- **Gate Adoption Rate**: 33.3%
```

---

## Prompt Management Tools

These tools allow for dynamic, real-time management of prompts directly from an MCP client, triggering the server's hot-reload or restart functionality.

### `update_prompt`

Creates a new prompt or updates an existing one. This involves creating/updating the prompt's `.md` file and ensuring it's correctly registered in the category's `prompts.json`.

**Parameters**:

- `id` (string, required): Unique identifier (e.g., `analysis/code_review`).
- `name` (string, required): Display name (e.g., "Code Review").
- `category` (string, required): The ID of the category it belongs to.
- `description` (string, required): A description of what the prompt does.
- `userMessageTemplate` (string, required): The Nunjucks template for the user message.
- `arguments` (array, required): An array of objects defining the prompt's arguments. Each object has `name` (string), `description` (string, optional), and `required` (boolean).
- `systemMessage` (string, optional): The system message for the prompt.
- `isChain` (boolean, optional): Whether this is a prompt chain.
- `chainSteps` (array, optional): The steps for a prompt chain.
- `onEmptyInvocation` (enum, optional): Either `"return_template"` or `"execute_if_possible"`.
- `fullServerRestart` (boolean, optional): If `true`, performs a full server restart instead of a hot-reload. Defaults to `false`.

### `delete_prompt`

Deletes an existing prompt file and removes its entry from the category's `prompts.json`.

**Parameters**:

- `id` (string, required): The ID of the prompt to delete.
- `fullServerRestart` (boolean, optional): If `true`, performs a full server restart. Defaults to `false`.

### `modify_prompt_section`

Modifies a specific section of an existing prompt's `.md` file (e.g., its `System Message` or `User Message Template`).

**Parameters**:

- `id` (string, required): The ID of the prompt to modify.
- `section_name` (string, required): The name of the section to modify (e.g., "System Message").
- `new_content` (string, required): The new content for the section.
- `fullServerRestart` (boolean, optional): If `true`, performs a full server restart. Defaults to `false`.

### `reload_prompts`

Manually triggers the server's hot-reload or full restart mechanism.

**Parameters**:

- `reason` (string, optional): A reason for the reload, for logging purposes.
- `fullServerRestart` (boolean, optional): If `true`, performs a full server restart. Defaults to `false` (hot-reload).
