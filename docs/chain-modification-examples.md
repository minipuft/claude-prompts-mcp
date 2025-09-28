# Chain Modification Workflow Examples

This document provides practical examples of the **correct way** to modify chains using the MCP tools, based on real scenarios.

## Example 1: Adding Vault Search to Notes Chain

### The Request
> "Currently our note does not actually pull from relevant related notes in our vault, it just makes some up. Find the relevant step in our prompt chain, and refine it so it does look for, and valuable relevant notes in our vault"

### ❌ Wrong Approach (from logFail.txt)
The agent incorrectly tried to:
1. Use `Update()` to modify chain.json files directly
2. Use `Write()` to create new step files
3. Bypass the MCP tool system entirely

### ✅ Correct Approach

#### Step 1: Analyze Current Chain
```bash
# List all notes-related prompts
prompt_manager(action: "list", filter: "notes")

# Get details about the notes chain
prompt_manager(action: "list", filter: "type:chain notes", verbose: true)
```

#### Step 2: Check for Vault-Related Components
```bash
# Search for existing vault functionality
prompt_manager(action: "list", filter: "vault")

# Search for related notes functionality
prompt_manager(action: "list", filter: "related notes")
```

#### Step 3: Create Missing Components (if needed)
```bash
# If vault_related_notes_finder doesn't exist, create it
prompt_manager(action: "create",
  id: "vault_related_notes_finder",
  name: "Vault Related Notes Finder",
  category: "content_processing",
  description: "Searches vault for actual related notes using content analysis",
  system_message: "You are an expert at finding related notes in a knowledge vault. Search for notes that are thematically and conceptually related to the given content.",
  user_message_template: "Search in vault path: {{vault_path}}\n\nFind notes related to this topic: {{note_topic}}\n\nContent areas to analyze:\n{{content_areas}}\n\nReturn actual related notes from the vault, not fictional ones.",
  arguments: [
    {"name": "vault_path", "description": "Path to the vault directory", "required": true},
    {"name": "note_topic", "description": "Main topic/content to find related notes for", "required": true},
    {"name": "content_areas", "description": "Specific content areas to analyze", "required": false}
  ])
```

#### Step 4: Update the Chain Structure
```bash
# Update the notes_modular chain to include vault search step
prompt_manager(action: "update",
  id: "notes_modular",
  description: "Enhanced analysis chain: processes content through initial analysis, deep analysis, structured markdown creation, vault-based related notes discovery, and final refinement with actual cross-references.",
  chain_steps: [
    {
      "id": "step_1",
      "name": "Initial Content Analysis (Step 1 of 5)",
      "description": "Initial analysis of provided content",
      "promptId": "content_analysis",
      "order": 0,
      "dependencies": [],
      "inputMapping": {
        "content": "content"
      },
      "outputMapping": {
        "result": "content_analysis_output"
      }
    },
    {
      "id": "step_2",
      "name": "Deep Analysis (Step 2 of 5)",
      "description": "Deep analysis building on initial analysis",
      "promptId": "deep_analysis",
      "order": 1,
      "dependencies": ["step_1"],
      "inputMapping": {
        "content": "content",
        "initial_analysis": "content_analysis_output"
      },
      "outputMapping": {
        "result": "deep_analysis_output"
      }
    },
    {
      "id": "step_3",
      "name": "Markdown Notebook Creation (Step 3 of 5)",
      "description": "Convert analysis into structured markdown notebook",
      "promptId": "markdown_notebook",
      "order": 2,
      "dependencies": ["step_2"],
      "inputMapping": {
        "content": "content",
        "analysis": "deep_analysis_output"
      },
      "outputMapping": {
        "result": "notebook_output"
      }
    },
    {
      "id": "step_4",
      "name": "Vault Related Notes Search (Step 4 of 5)",
      "description": "Search vault for actual related notes using content analysis",
      "promptId": "vault_related_notes_finder",
      "order": 3,
      "dependencies": ["step_3"],
      "inputMapping": {
        "note_topic": "content",
        "content_areas": "deep_analysis_output",
        "vault_path": "/mnt/c/Users/legoj/Notes/Notion"
      },
      "outputMapping": {
        "result": "related_notes"
      },
      "timeout": 300000,
      "optional": false
    },
    {
      "id": "step_5",
      "name": "Note Refinement with Related Notes (Step 5 of 5)",
      "description": "Final refinement incorporating actual vault-searched related notes",
      "promptId": "note_refinement_with_vault",
      "order": 4,
      "dependencies": ["step_3", "step_4"],
      "inputMapping": {
        "notes": "notebook_output",
        "related_notes": "related_notes"
      },
      "outputMapping": {
        "result": "result"
      },
      "timeout": 300000,
      "optional": false
    }
  ])
```

#### Step 5: Create Enhanced Note Refinement Prompt
```bash
# Create the final refinement prompt that incorporates actual related notes
prompt_manager(action: "create",
  id: "note_refinement_with_vault",
  name: "Note Refinement with Vault Integration",
  category: "analysis",
  description: "Final step in the notes chain that integrates actual vault-discovered related notes with refined markdown formatting",
  system_message: "You are an expert at organizing and refining knowledge notes with proper cross-referencing. Your task is to take markdown notes and enhance them with actual related notes found in the vault, creating a polished, interconnected knowledge artifact.",
  user_message_template: "Please refine and enhance these markdown notes by integrating the actual related notes that were found in the vault:\n\n## Original Notes:\n{{notes}}\n\n## Related Notes Found in Vault:\n{{related_notes}}\n\n## Task:\n1. Review the original notes and related notes\n2. Integrate relevant information from the related notes\n3. Add proper cross-references and links\n4. Improve the structure and formatting\n5. Ensure the final output is a cohesive, well-organized knowledge artifact\n\nReturn the refined notes with actual cross-references to the vault notes.",
  arguments: [
    {"name": "notes", "description": "Original markdown notes to refine", "required": true},
    {"name": "related_notes", "description": "Related notes found in the vault", "required": true}
  ])
```

#### Step 6: Apply Changes and Test
```bash
# Reload to apply all changes
prompt_manager(action: "reload")

# Test the updated chain
prompt_engine(command: ">>notes_modular content:'Test content to see if vault search works'")

# Verify the chain structure
prompt_manager(action: "list", filter: "notes_modular", verbose: true)
```

## Example 2: Adding a Step to Existing Chain

### Scenario: Add validation step to a processing chain

```bash
# 1. Check current chain structure
prompt_manager(action: "list", filter: "processing_chain", verbose: true)

# 2. Create validation prompt if needed
prompt_manager(action: "create",
  id: "content_validator",
  name: "Content Validator",
  category: "validation",
  description: "Validates processed content for quality and completeness",
  user_message_template: "Validate this content: {{content}}\n\nCheck for:\n- Completeness\n- Accuracy\n- Format compliance\n\nReturn validation results.")

# 3. Update chain to insert validation step
prompt_manager(action: "update",
  id: "processing_chain",
  chain_steps: [
    // ... existing steps up to where validation should be inserted ...
    {
      "id": "validation_step",
      "name": "Content Validation",
      "promptId": "content_validator",
      "order": 2, // Insert at appropriate position
      "dependencies": ["previous_step"],
      "inputMapping": {
        "content": "processed_content"
      },
      "outputMapping": {
        "result": "validation_results"
      }
    },
    // ... remaining steps with updated dependencies and order numbers ...
  ])

# 4. Apply and test
prompt_manager(action: "reload")
prompt_engine(command: ">>processing_chain input:'test data'")
```

## Example 3: Modifying Chain Step Parameters

### Scenario: Update timeout and input mappings for a step

```bash
# 1. Get current chain definition
prompt_manager(action: "list", filter: "my_chain", verbose: true)

# 2. Update with modified parameters
prompt_manager(action: "update",
  id: "my_chain",
  chain_steps: [
    {
      "id": "slow_step",
      "name": "Processing Step",
      "promptId": "heavy_processor",
      "order": 1,
      "dependencies": ["step_0"],
      "inputMapping": {
        "input_data": "raw_data",
        "processing_mode": "thorough", // New parameter
        "batch_size": 100 // New parameter
      },
      "outputMapping": {
        "result": "processed_data"
      },
      "timeout": 600000, // Increased from 300000
      "optional": false
    }
    // ... other steps ...
  ])

# 3. Apply changes
prompt_manager(action: "reload")
```

## Key Principles

### 1. Always Use MCP Tools
- ✅ `prompt_manager(action: "update", ...)`
- ❌ `Update(~/prompts/chain.json)`

### 2. Check Before Creating
- Use `prompt_manager(action: "list")` to see what exists
- Avoid duplicating existing functionality

### 3. Reload After Changes
- Always call `prompt_manager(action: "reload")` after modifications
- This ensures hot-reloading picks up changes

### 4. Test Changes
- Use `prompt_engine(command: ">>chain_name ...")` to test
- Verify with `prompt_manager(action: "list", verbose: true)`

### 5. Structured Data Approach
- Define complete chain_steps arrays with all required fields
- Use proper dependency management (order, dependencies arrays)
- Include all metadata (timeouts, optional flags, etc.)

## Common Pitfalls to Avoid

1. **Direct File Editing**: Never use Update(), Edit(), Write() on prompt files
2. **Partial Updates**: Always provide complete chain_steps array, not partial modifications
3. **Missing Dependencies**: Ensure step dependencies are correctly specified
4. **Skipping Reload**: Changes won't take effect without reload
5. **Wrong Order Numbers**: Step order affects execution sequence
6. **Missing Error Handling**: Consider timeout and optional settings for reliability

## Advanced Patterns

### Conditional Chain Steps
```bash
# Use optional: true for steps that may fail
{
  "id": "optional_enhancement",
  "name": "Enhancement Step",
  "promptId": "enhancer",
  "optional": true, // Won't fail chain if this step fails
  "timeout": 30000   // Shorter timeout for optional steps
}
```

### Parallel Processing
```bash
# Steps with same order number execute in parallel
{
  "id": "parallel_step_a",
  "order": 2,
  "dependencies": ["step_1"]
},
{
  "id": "parallel_step_b",
  "order": 2,
  "dependencies": ["step_1"]
}
```

### Data Transformation
```bash
# Use inputMapping to transform data between steps
{
  "inputMapping": {
    "prompt_input_name": "previous_step_output_key",
    "static_value": "constant_data",
    "computed_value": "{{dynamic_expression}}"
  }
}
```