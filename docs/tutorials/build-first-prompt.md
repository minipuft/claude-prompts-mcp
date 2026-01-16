# Tutorial: Build Your First Prompt

> Status: canonical

Stop copy-pasting the same instructions into Claude. Define them once, invoke them anywhere.

## Why This Matters

| Problem | Solution | Result |
|---------|----------|--------|
| **Repetitive Typing** | Defined Templates | Zero copy-pasting |
| **Inconsistent Output** | Structured Arguments | Reliable results every time |
| **Slow Iteration** | Hot Reload | Edit → Run instantly (no restart) |

---

## 1. The Single-File Pattern (Simple)

Best for short, simple prompts. Everything lives in one `.yaml` file.

### Create the file

`resources/prompts/general/hello/prompt.yaml`:

```yaml
id: hello
name: Hello World
description: A simple greeting prompt

# Inline template
userMessageTemplate: |
  Hello {{name}}! Welcome to the system.
  Current time: {{now}}

arguments:
  - name: name
    type: string
    required: true
```

### Run it

```bash
prompt_engine(command: ">>hello name='Developer'")
```

**Output**:
```text
Hello Developer! Welcome to the system.
Current time: ...
```

---

## 2. The Directory Pattern (Scalable)

Best for complex prompts with long templates or system instructions. Splits config from content.

### Create the structure

```text
resources/prompts/general/code_review/
├── prompt.yaml          # Config only
└── user-message.md      # Content only
```

### `prompt.yaml`

```yaml
id: code_review
name: Code Review
description: Analyze code for quality issues
userMessageTemplateFile: user-message.md  # Points to file

arguments:
  - name: code
    required: true
  - name: language
    defaultValue: "typescript"
```

### `user-message.md`

```markdown
# Code Review: {{language}}

Please review the following code:

```{{language}}
{{code}}
```

Check for:
- Logic errors
- Performance bottlenecks
- Security risks
```

### Run it

```bash
prompt_engine(command: ">>code_review code='function x() {}'")
```

---

## 3. Hot Reload in Action

You don't need to restart the server to see changes.

1. Run `>>hello name='Dev'`
2. Edit `prompt.yaml`: Change "Hello" to "Greetings"
3. Run `>>hello name='Dev'` again
4. **Result**: "Greetings Dev!" appears instantly.

---

## Next Steps

- **[Add Validation](../how-to/add-validation.md)**: Ensure arguments match patterns (e.g., valid URLs).
- **[Template Syntax](../reference/template-syntax.md)**: Use loops, conditionals, and script calls.
- **[Configuration](../reference/prompt-yaml-schema.md)**: Full reference for `prompt.yaml` options.
