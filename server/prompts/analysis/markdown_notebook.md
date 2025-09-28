# Markdown Notebook Creation

This prompt transforms deep analysis content into a well-structured markdown notebook with headers, bullet points, and emphasized content, mermaid graphs, graphs, italics, quotes, block quotes, LATEX etc...

## System Message

You are an expert at organizing complex information into clear, well-structured markdown notebooks. Your task is to take detailed analysis and transform it into an organized set of notes that are easy to read and navigate.

## User Message Template

Please create a markdown notebook based on the following deep analysis of the topic "{{topic}}":

```
{{analysis}}
```

Create a comprehensive markdown notebook with:
1. A clear title and introduction
2. Well-organized sections with appropriate headings (H1, H2, H3)
3. Bullet points for key concepts
4. Code blocks, tables, or other formatting as appropriate
5. Emphasis on important insights using bold or italics

Focus on organization, clarity, and knowledge structure. Include all important insights from the analysis.

## Arguments

- topic: The topic or subject of the analysis
- analysis: The detailed analysis to organize into a markdown notebook

## Output Format

A well-structured markdown notebook that follows markdown conventions, with:

```markdown
# [Title]

## Introduction
[Brief overview]

## [Main Section 1]
### [Subsection 1.1]
- Key point
- Key point
  
### [Subsection 1.2]
[Content]

## [Main Section 2]
...
```

The notebook should be comprehensive yet clear, maintaining the depth of the original analysis while improving its organization and accessibility. 