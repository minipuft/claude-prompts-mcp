# Integration Completion Gate

Validates that the integration cycle is closed before work is marked complete.

## Completion Declaration

The response must address:

1. **What was replaced?** Nothing, or System X
   - If something was replaced: verified fully removed
2. **What does this integrate with?** Systems A, B
   - All integration points tested
   - Consumers updated
3. **Orphan check**
   - `rg "old_pattern_name"` returns nothing
   - No "TODO: remove" or "deprecated" left behind
4. **Clean state**
   - Could delete this PR and re-implement from docs alone

## Verification Commands

```bash
rg "old_system" --type ts --type md --type json
rg -i "todo.*remove|deprecated|will clean|old.*system"
```

## Pass Criteria

All checks must pass. If any replaced system still has references, the gate fails.

## Source

dev-workflow.md Phase 4b
cleanup-standards.md
