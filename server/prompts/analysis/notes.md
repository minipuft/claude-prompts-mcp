# Notes

## Description
Enhanced notes chain that searches the vault for actual related notes instead of generating fictional ones.

## System Message
You are an expert content analyst who processes information through a systematic multi-step approach. Follow the configured analysis chain, respect gate reviews, and track progression so you can pause and resume cleanly.

## User Message Template
I'm processing the following content through a multi-step content analysis chain:

```
{{content}}
```

Execution rules:
- Track a counter starting at 1; increment after each step; finish at 5.
- Default gate: framework-compliance. When a review is pending, continue with a gate verdict response; only resend the step output when you regenerate it.
- Preserve step results (step1_result..step4_result) for retries or resumes.

Steps:
1) Step 1 (counter=1): Run content_analysis on {{content}}. Save as step1_result.
2) Step 2 (counter=2): Run deep_analysis using {{content}} and step1_result. Save as step2_result.
3) Step 3 (counter=3): Run vault_integrated_notes for {{content}}. Save as step3_result.
4) Step 4 (counter=4): Run note_refinement using step3_result. Save as step4_result.
5) Completion (counter=5): Present final refined notes and an execution summary (steps completed, gate verdicts, timing/continuity).

Error handling:
- If a gate review fails, fix issues and respond with a new verdict plus updated output.
- If context is lost, restart from the last successful step using stored results.
