# Path Claims Verification

This gate validates plan-author claims about file paths, line numbers, and symbol locations against filesystem ground truth.

## How It Works

Unlike `inline_guidance` gates (which render checklists for self-assessment), this gate uses **ground-truth validation** via the response-injection mechanism:

1. The agent produces a `verified_paths:` YAML block in its response (typically as part of the `## systematic_analysis` section of a Phase 2.5 verification step)
2. The gate pipes the response to `scripts/verify-path-claims.mjs` via stdin
3. The script parses each claim and runs `wc -l` / `rg` / `stat` against the actual filesystem
4. Exit code 0 = **PASS** (all claims match reality)
5. Exit code 1 = **FAIL** (at least one claim mismatches)
6. Exit code 2 = **MALFORMED** (no `verified_paths:` block found or YAML parse error)

## Expected Claim Shape

```yaml
verified_paths:
  - file: src/modules/chains/manager.ts
    exists: yes
    line_count: 1941
    target_symbols:
      - symbol: ChainSessionStore
        actual_line: 66
```

Fields the script checks: `file` (required), `exists` (yes/no), `line_count` (optional, numeric), `target_symbols[].symbol` + `target_symbols[].actual_line` (optional pair).

Other fields in `verified_paths` entries (`is_shim`, `drift`, `target_fields_exist`, etc.) are passed-through prose — the script does not validate them, only what it can deterministically check.

## On Failure

If the gate exits 1, you'll see specific mismatch messages in stderr, e.g.:

```
[path-verify] MISMATCHES:
  - file=src/modules/chains/manager.ts: claims line_count=200, actual=1941
  - file=src/modules/chains/store/chain-session-store.ts: claims exists=yes, filesystem says exists=false
```

To fix:

1. Re-run the actual commands (`wc -l <file>`, `rg -n "<symbol>" <file>`)
2. Update the `verified_paths:` block with the corrected values
3. If a path doesn't exist, search for the actual location (`fd <name>`)
4. Resubmit

If the gate exits 2 (malformed), check that your response includes a properly-formatted YAML block under the literal key `verified_paths:` with a list of entries each having `- file: <path>` etc.

## Configuration

- **Timeout**: 10 seconds (path checks should be fast — large claim sets may need more)
- **Max Attempts**: 2 (one chance to fix mismatches; further attempts indicate deeper drift requiring revision of design)
- **Activation**: planning category prompts, explicit request only (not auto-attached to verification step — opt-in)

## Best Practices

- Run `wc -l` / `rg` BEFORE writing the claim — don't guess
- Include `target_symbols` with `actual_line` for line numbers you cite in the plan
- Set `exists: no` honestly for paths that don't resolve (the gate rejects fabricated `exists: yes` for non-existent files)
- Keep claim sets small (under ~20 entries) for fast verification
