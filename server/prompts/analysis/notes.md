# Content Analysis Chain

**🎯 EXECUTION TYPE**: Chain Workflow  
**⚡ EXECUTION REQUIRED**: This tool outputs a multi-step chain workflow that YOU must execute in sequence. Each step builds on the previous one.  
**🔄 LLM-DRIVEN EXECUTION**: LLM reads this template and executes steps by making individual MCP tool calls with `prompt_engine`  
**📋 EXECUTION STEPS**: Execute each analysis stage in order, process results, create structured output  
**🔗 CHAIN POSITION**: Multi-step chain workflow (execute steps 1→2→3→4 in sequence)  
**🛡️ QUALITY GATES**: Step completion validation, content quality checks, format verification  
**⚙️ TOOL INTEGRATION**: Uses MCP `prompt_engine` tool for individual template execution with gate validation

## System Message

You are an expert content analyst who processes information through a systematic multi-step approach. Your goal is to analyze content thoroughly and produce well-organized, insightful notes.

IMPORTANT: You must explicitly call the MCP `prompt_engine` tool multiple times to progress through this chain. After receiving a response from each step, you must call `prompt_engine` with the appropriate next command using template mode for individual step execution with gate validation.

IMPLEMENTATION DETAILS:

- For tracking purposes, use a counter variable to monitor which step of the chain you're on  
- Start with counter=1 and increment it after each step  
- When counter=5, you're done with all steps and should present the final output  
- Use "execution_mode": "template" for each step to enable individual template execution with gate validation
- Store step results in variables (step1_result, step2_result, etc.) for use in subsequent steps
- If any step fails gate validation, review and retry with improved parameters

## User Message Template

I'm processing the following content through a multi-step content analysis chain:

```
{{content}}
```

**ENHANCED IMPLEMENTATION INSTRUCTIONS:**

1. **Step 1** (counter=1): Call MCP tool `prompt_engine` with:
   ```json
   {
     "command": ">>content_analysis {{content}}",
     "execution_mode": "template",
     "gate_validation": true
   }
   ```
   Store result as `step1_result` (initial analysis)

2. **Step 2** (counter=2): Call MCP tool `prompt_engine` with:
   ```json
   {
     "command": ">>deep_analysis",
     "content": "{{content}}",
     "initial_analysis": "[Insert step1_result here]",
     "execution_mode": "template",
     "gate_validation": true
   }
   ```
   Store result as `step2_result` (deep analysis)

3. **Step 3** (counter=3): Call MCP tool `prompt_engine` with:
   ```json
   {
     "command": ">>markdown_notebook",
     "topic": "{{content}}",
     "analysis": "[Insert step2_result here]",
     "execution_mode": "template",
     "gate_validation": true
   }
   ```
   Store result as `step3_result` (markdown notebook)

4. **Step 4** (counter=4): Call MCP tool `prompt_engine` with:
   ```json
   {
     "command": ">>note_refinement",
     "notes": "[Insert step3_result here]",
     "execution_mode": "template",
     "gate_validation": true
   }
   ```
   Store result as `step4_result` (refined notes)

5. **Completion** (counter=5): Present final refined notes with execution summary
   - Combine all step results into a comprehensive analysis
   - Include execution summary: steps completed, validation results, total processing time
   - Format as: **Final Result**: [step4_result] + **Execution Summary**: [completion stats]

**EXECUTION BENEFITS:**
- ✅ Gate validation ensures quality at each step
- 🔄 Progress tracking shows completion status  
- ⚠️ Error recovery if any step fails validation
- 📊 Execution analytics for performance monitoring

**ERROR HANDLING PROTOCOLS:**
- **Step Failure**: If any step fails gate validation, review parameters and retry with corrections
- **Tool Unavailable**: If `prompt_engine` is unavailable, report error and wait for system recovery
- **Context Loss**: If step results are lost, restart from last successful step
- **Validation Failure**: If gate validation fails, analyze failure reason and adjust approach
- **Recovery Strategy**: Always preserve step results for potential retry/rollback scenarios

**Starting counter value**: 1

## Arguments

- content: The content to analyze

## Chain Steps

1. promptId: content_analysis
   stepName: Initial Content Analysis (Step 1 of 4)
   inputMapping:
   content: content
   outputMapping:
   analysis_output: step_0_output

2. promptId: deep_analysis
   stepName: Deep Analysis (Step 2 of 4)
   inputMapping:
   content: content
   initial_analysis: analysis_output
   outputMapping:
   deep_analysis_output: step_1_output

3. promptId: markdown_notebook
   stepName: Markdown Notebook Creation (Step 3 of 4)
   inputMapping:
   topic: content
   analysis: deep_analysis_output
   outputMapping:
   notebook_output: step_2_output

4. promptId: note_refinement
   stepName: Note Refinement (Step 4 of 4)
   inputMapping:
   notes: notebook_output
   outputMapping:
   refined_notes: step_3_output

## Output Format

After completing all four steps in the analysis chain, you will have a refined markdown notebook that:

1. Is well-organized and clearly structured
2. Presents key insights from the content analysis
3. Maintains the depth of analysis from earlier steps
4. Has improved readability and flow

The final output will be the refined markdown notebook, representing the culmination of the entire analysis chain process.

