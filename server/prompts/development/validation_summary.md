# Neural Workbench Validation Summary

## Description
Validate neural workbench setup and provide comprehensive status report

## User Message Template
Validate neural workbench setup for project at {{project_path}}

Status Inputs:
- CLAUDE.md Generated: {{generated_claude_md}}
- Context Memory Setup: {{context_memory_setup}}
- Validation Setup: {{validation_setup}}

Validation Tasks:
1. Check existence of required directories (context-memory/, plans/)
2. Verify memory files are initialized and properly formatted
3. Validate CLAUDE.md includes and references
4. Check neural integration configuration
5. Verify CAGEERF validation checkpoints
6. Test command detection accuracy
7. Assess overall project health

Return validation report with:
- ✅ Passed checks
- ⚠️ Warnings
- ❌ Failed checks
- 📊 Completeness percentage
- 🎯 Recommended fixes
