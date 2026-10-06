## Project Scaffold - File Generation

Generate all files for the project based on this configuration:

```json
{{config}}
```

---

## Generation Rules

1. **Output each file** with a clear header showing the path
2. **Use modern patterns**: ES modules, strict TypeScript, type hints in Python
3. **Include LLM-friendly patterns**: CLAUDE.md, .claude/rules/, clear structure
4. **Follow the feature flags** from the config

---

## Required Files

### Core Structure

#### `CLAUDE.md` (Project Instructions)

```markdown
# {{name}}

[Brief project description based on type]

## Quick Start

[Language-specific setup commands]

## Development

[Key commands: build, test, lint]

## Architecture

[Brief overview of project structure]
```

#### `.claude/rules/` (Auto-loaded Rules)

Create rules based on language and type:

**For TypeScript projects:**

- `.claude/rules/typescript.md` - Strict typing, ES modules
- `.claude/rules/testing.md` - Jest patterns, integration-first

**For Python projects:**

- `.claude/rules/python.md` - Type hints, pytest patterns
- `.claude/rules/testing.md` - Pytest patterns, fixtures

---

### Language-Specific Files

#### TypeScript Projects

**`package.json`**

```json
{
  "name": "{{name}}",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  }
}
```

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**`eslint.config.js`** (if linting feature enabled)

**`.prettierrc`** (if linting feature enabled)

#### Python Projects

**`pyproject.toml`**

```toml
[project]
name = "{{name}}"
version = "0.1.0"
requires-python = ">=3.11"

[tool.ruff]
line-length = 100
select = ["E", "F", "I", "N", "W"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

**`ruff.toml`** (if linting feature enabled)

#### Hybrid Projects

Include both TypeScript and Python structures:

- `server/` - TypeScript code
- `hooks/` - Python hooks with shared lib

---

### Feature-Specific Files

#### If `hooks` feature enabled:

**`.husky/pre-commit`** (TypeScript)

```bash
#!/usr/bin/env sh
npm run lint:staged
```

**`.husky/pre-push`** (TypeScript)

```bash
#!/usr/bin/env sh
npm run typecheck && npm run test
```

**`.pre-commit-config.yaml`** (Python)

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.1.0
    hooks:
      - id: ruff
```

#### If `testing` feature enabled:

**`tests/` directory structure**
**Test configuration files**

#### If `versioning` feature enabled:

**`scripts/sync-versions.js`** (TypeScript)
**Version validation scripts**

---

## Output Format

For each file, output:

```
### `path/to/file.ext`

\`\`\`[language]
[file contents]
\`\`\`
```

Generate ALL files needed for a complete, working project scaffold.
