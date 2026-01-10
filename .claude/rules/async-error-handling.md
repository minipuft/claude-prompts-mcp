---
paths: server/src/**/*.ts
---

# Async Error Handling Standards

These rules prevent silent failures that caused the framework switch persistence bug.

## Rule 1: Persistence Methods MUST Throw on Failure

```typescript
// ❌ WRONG: Log and swallow
private async saveStateToFile(): Promise<void> {
  try {
    await fs.writeFile(path, data);
  } catch (error) {
    this.logger.error(`Failed: ${error}`);
    // Caller has no idea this failed!
  }
}

// ✅ RIGHT: Let errors propagate
private async saveStateToFile(): Promise<void> {
  await fs.writeFile(path, data);  // Throws on failure
}
```

## Rule 2: No Double-Catch Pattern

Never catch errors at multiple levels. Catch at ONE layer (the handler/orchestration layer).

```typescript
// ❌ WRONG: Both inner and outer catch
async inner(): Promise<void> {
  try { await persist(); } catch { log(); }
}
async outer(): Promise<void> {
  try { await inner(); } catch { log(); }  // Never triggers!
}

// ✅ RIGHT: Catch only at handler layer
async inner(): Promise<void> {
  await persist();  // Propagates errors
}
async handler(): Promise<Response> {
  try {
    await inner();
    return success();
  } catch (error) {
    return error(`Failed: ${error}`);
  }
}
```

## Rule 3: ALWAYS Check Boolean Return Values

```typescript
// ❌ WRONG: Ignore the return value
await this.service.doOperation();
return success();  // Always succeeds!

// ✅ RIGHT: Check and handle
const ok = await this.service.doOperation();
if (!ok) return error(`Operation failed`);
return success();
```

## Error Handling Decision Tree

```
Is this a persistence/state-mutation operation?
  YES → THROW on failure (let caller decide)
  NO  → Is this handler/orchestration layer?
    YES → CATCH and return appropriate response
    NO  → PROPAGATE (don't catch)
```

## Pre-Commit Validation

Run these to detect violations:

```bash
# Find log-and-swallow patterns
grep -rn "catch.*{" --include="*.ts" src/ -A 3 | grep -v "throw\|return"

# Find ignored await return values
grep -rn "await this\.[a-z]*\.[a-z]*(" --include="*.ts" src/ | grep -v "const\|let\|=\|return"
```
