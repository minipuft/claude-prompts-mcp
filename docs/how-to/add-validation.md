# How-To: Add Argument Validation

Ensure bad inputs fail fast—before they reach the LLM.

## Why This Matters

| Problem            | Solution          | Result                         |
| ------------------ | ----------------- | ------------------------------ |
| **Wasted Tokens**  | Pre-flight Checks | Garbage inputs never send      |
| **Security Risks** | Regex Patterns    | Prevent injection/bad URLs     |
| **User Confusion** | Actionable Errors | "Must be HTTPS" vs silent fail |

> [!TIP]
> **New to prompts?** Start with the [Build Your First Prompt](../tutorials/build-first-prompt.md) tutorial to set up a working prompt before adding validation.

---

## 1. Edit `prompt.yaml`

Add a `validation` block to any argument definition.

```yaml
arguments:
  - name: topic
    type: string
    validation:
      minLength: 10
      maxLength: 200

  - name: source_url
    type: string
    validation:
      pattern: "^https://"
```

## 2. Supported Rules

| Rule        | Type     | Description                        |
| ----------- | -------- | ---------------------------------- |
| `minLength` | `number` | Fails if string is too short.      |
| `maxLength` | `number` | Fails if string is too long.       |
| `pattern`   | `string` | Regex pattern (JavaScript syntax). |

## 3. Test It

Run the prompt with invalid input to see the error.

```bash
>>analyze source_url="http://insecure.com"
```

**Output**:

```text
Argument validation failed:
  - source_url: Value must match pattern ^https://

Retry with:
  >>analyze source_url="https://..."
```

## Common Patterns

**GitHub URL Only**:

```yaml
pattern: "^https://github\\.com/"
```

**Non-Empty String**:

```yaml
minLength: 1
```

**Limit Token Usage** (approximate):

```yaml
maxLength: 1000 # ~250 tokens
```

---

## See Also

- **[Prompt YAML Schema](../reference/prompt-yaml-schema.md)** — Full reference for all `prompt.yaml` fields including argument types
- **[Template Syntax](../reference/template-syntax.md)** — Conditionals, loops, and filters for dynamic templates
- **[Gates Guide](../guides/gates.md)** — Validate output quality (validation checks input; gates check output)
