---
paths:
  - server/src/frameworks/*-state-manager.ts
  - server/src/chain-session/**/*.ts
  - server/src/runtime-state/**/*.ts
  - server/src/**/*-state*.ts
---

# State Persistence Standards

These rules apply to any code managing persisted state (files, sessions, etc.).

## Persistence Operations MUST Await and Throw

```typescript
// ❌ WRONG: Fire-and-forget or swallow errors
this.saveState().catch(e => log(e));  // No await!
try { await this.saveState(); } catch { log(); }  // Swallowed!

// ✅ RIGHT: Await and propagate
await this.saveState();  // Throws on failure, caller handles
```

## State Mutation Contract

Every state mutation operation must:

1. **Await persistence** before returning success
2. **Throw on failure** so callers know the mutation failed
3. **Log only after success** (not during error handling)

```typescript
// ✅ Correct pattern
async switchFramework(request): Promise<boolean> {
  // 1. Validate
  const target = this.getFramework(request.id);
  if (!target) throw new Error('Not found');

  // 2. Update in-memory state
  this.state = { activeFramework: request.id, ... };

  // 3. Persist (throws on failure)
  await this.saveStateToFile();

  // 4. Log success (only after persist succeeds)
  this.logger.info('Switch successful');

  return true;
}
```

## No Silent State Failures

State operations that fail silently cause:
- User sees "success" but state didn't change
- In-memory and persisted state diverge
- Bugs that are nearly impossible to debug

**Detection**:
```bash
# Find state saves that might swallow errors
grep -rn "saveState\|persist\|writeFile" --include="*.ts" src/ -A 3 | grep -B 3 "catch.*{"
```

## Runtime State Directory

Files in `runtime-state/`:
- `framework-state.json` - Active framework and switch history
- `chain-sessions.json` - Active chain sessions
- `gate-system-state.json` - Gate system state

**Never commit `runtime-state/` files** - they are per-instance state.
