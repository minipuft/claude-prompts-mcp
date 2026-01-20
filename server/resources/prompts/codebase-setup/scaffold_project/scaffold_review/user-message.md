## Project Scaffold - Review & Confirm

Review the generated scaffold and provide a summary for user confirmation.

---

## Generated Files

{{generated_files}}

---

## Your Task

### 1. Summarize What Will Be Created

Provide a concise overview:

```
## Project Summary

**Name**: [project name]
**Type**: [project type]
**Language**: [language(s)]

### Files to Create

| Directory | Files | Purpose |
|-----------|-------|---------|
| `/` | CLAUDE.md, README.md | Documentation |
| `.claude/rules/` | *.md | LLM auto-loaded rules |
| `src/` | *.ts / *.py | Source code |
| `tests/` | *.test.ts / test_*.py | Test files |
| ... | ... | ... |

### Enabled Features

- [x] Linting (ESLint/Ruff)
- [x] Testing (Jest/Pytest)
- [ ] Git hooks
- ...
```

### 2. Highlight Key Decisions

Note any important choices made:

- Package manager selected
- Test framework configured
- Linting strictness level
- Any deviations from defaults

### 3. Ask for Confirmation

End with:

```
## Ready to Create?

The above files will be created in `./<project-name>/`.

**Options:**
1. **Proceed** - Create all files as shown
2. **Modify** - Request changes to specific files
3. **Cancel** - Abort scaffold creation

Which would you like to do?
```

Use `AskUserQuestion` to get the user's choice before proceeding.
