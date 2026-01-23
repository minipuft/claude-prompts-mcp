## Project Scaffold - Requirements Gathering

You are helping the user scaffold a new project with LLM-friendly patterns.

### Provided Information

{% if name %}**Project Name**: `{{name}}`{% else %}**Project Name**: _Not provided_{% endif %}
{% if language %}**Language**: `{{language}}`{% else %}**Language**: _Not provided_{% endif %}
{% if type %}**Project Type**: `{{type}}`{% else %}**Project Type**: _Not provided_{% endif %}
{% if features %}**Features**: `{{features}}`{% else %}**Features**: _Not provided_{% endif %}
{% if package_manager %}**Package Manager**: `{{package_manager}}`{% else %}**Package Manager**: _Not provided_{% endif %}

---

## Your Task

### Step 1: Gather Missing Information

**Use `AskUserQuestion` to gather any missing information.** Ask all missing items in a single call with multiple questions.

{% if not name %}

- **Project Name**: Suggest kebab-case format (e.g., `my-awesome-project`)
  {% endif %}

{% if not language %}

- **Language**: Options are:
  - `typescript` - Node.js/TypeScript with modern ES modules
  - `python` - Python with type hints, pytest, ruff
  - `hybrid` - TypeScript server + Python hooks (like MCP servers)
    {% endif %}

{% if not type %}

- **Project Type**: Options depend on language:
  - `mcp-server` - Model Context Protocol server (recommended for AI tools)
  - `cli` - Command-line application
  - `library` - Reusable package/module
  - `api` - REST/GraphQL backend server
  - `webapp` - Frontend or full-stack web application
    {% endif %}

{% if not features %}

- **Features**: Suggest defaults based on project type:
  - For `mcp-server`: linting, testing, hooks, contracts
  - For `cli`: linting, testing
  - For `library`: linting, testing, versioning
  - For `api`/`webapp`: linting, testing, hooks
    {% endif %}

{% if not package_manager %}

- **Package Manager**: Suggest based on language:
  - TypeScript: `npm` (default), `pnpm`, `yarn`
  - Python: `uv` (recommended), `poetry`, `pip`
    {% endif %}

### Step 2: Output Configuration

Once all information is gathered, output a JSON configuration block:

```json
{
  "name": "<project-name>",
  "language": "<typescript|python|hybrid>",
  "type": "<mcp-server|cli|library|api|webapp>",
  "features": ["linting", "testing", ...],
  "package_manager": "<npm|pnpm|yarn|pip|poetry|uv>",
  "paths": {
    "src": "<src/ or src/{name}/>",
    "tests": "tests/",
    "config": "<root config files>"
  }
}
```

This configuration will be passed to the next step for file generation.

---

{% if name and language and type %}
**All required information provided.** Proceed directly to output the configuration JSON.
{% else %}
**Missing information detected.** Use AskUserQuestion now to gather the missing details before proceeding.
{% endif %}
