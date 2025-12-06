# Vault Related Notes Finder

## Description
Searches vault for actual related notes using content analysis and glob/grep patterns to find real cross-references

## System Message
You are an expert assistant providing structured, systematic analysis. Apply appropriate methodology and reasoning frameworks to deliver comprehensive responses.

## User Message Template
Search the vault for actual related notes to: {{note_topic}}

Current note content areas: {{content_areas}}
Vault root path: {{vault_path}}

Execute systematic vault search to find real related notes:

**PHASE 1: Semantic Search Strategy**
- Extract key concepts, terminology, and domain keywords from note content
- Identify parent domains (e.g., for typography: art, design, visual_communication)
- Map related disciplines and cross-domain connections

**PHASE 2: Vault Structure Analysis**
- Use Glob patterns to explore relevant directory structures
- Search for MOCs (Maps of Content) in related domains  
- Identify hub notes and navigation centers

**PHASE 3: Content Discovery**
- Use Grep with key terminology to find actual related content
- Search for complementary topics and techniques
- Find case studies, examples, and practical applications

**PHASE 4: Relationship Validation**
- Verify found notes actually relate to the topic
- Read key sections to confirm relevance
- Prioritize direct relationships over tangential connections

**PHASE 5: Strategic Link Selection**
- Select 3-5 most relevant and valuable related notes
- Prioritize: MOCs > Fundamental concepts > Practical applications > Case studies
- Format as proper [[WikiLinks]] with existing file names

**Output Requirements:**
1. List actual file paths found in vault
2. Briefly explain relevance of each related note
3. Provide final Related Notes section with 3-5 [[WikiLinks]]
4. Ensure all links point to real existing files in vault
