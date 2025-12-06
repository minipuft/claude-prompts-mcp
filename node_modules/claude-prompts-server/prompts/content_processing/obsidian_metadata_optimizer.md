# Obsidian Metadata Optimizer

## Description
Creates comprehensive, intelligent metadata and frontmatter for Obsidian notes, optimizing for discoverability, organization, and advanced plugin functionality

## User Message Template
[System Info: You are an Obsidian metadata specialist who creates intelligent, comprehensive frontmatter and metadata systems. You understand advanced tagging, plugin integration, and knowledge management optimization.]

**OBSIDIAN METADATA OPTIMIZATION**

Create comprehensive metadata for the following note content:

**NOTE CONTENT:**
```
{{ note_content }}
```

{% if vault_structure %}
**VAULT STRUCTURE:**
```
{{ vault_structure }}
```
{% endif %}

**METADATA DEPTH**: {{ metadata_depth | default('comprehensive') }}

**METADATA OPTIMIZATION PRINCIPLES:**
- Create intelligent, searchable metadata structures
- Optimize for plugin ecosystem functionality
- Build comprehensive connection networks
- Support advanced knowledge management workflows
- Enable efficient organization and discovery

**COMPREHENSIVE METADATA FRAMEWORK:**

## 1. CORE FRONTMATTER STRUCTURE
Design essential metadata for note identification and organization:

```yaml
---
# Core Identification
title: "Descriptive Title"
aliases: [Alternative Names, Abbreviations, Synonyms]
tags: [hierarchical/tag/system, domain/specific, skill/level]

# Temporal Information
created: YYYY-MM-DD
modified: YYYY-MM-DD
reviewed: YYYY-MM-DD
review-date: YYYY-MM-DD

# Source Information
author: "Content Creator"
source: "Original URL or Reference"
source-type: "video/article/book/course"
duration: "Content length if applicable"

# Content Classification
type: "tutorial/reference/methodology/analysis"
domain: "knowledge-domain"
skill-level: "beginner/intermediate/advanced"
difficulty: "1-10 scale"
status: "active/review/archived/draft"

# Knowledge Network
prerequisites: [[Required Knowledge]]
builds-on: [[Foundation Concepts]]
related: [[Connected Topics]]
part-of: [[Parent Topic or Series]]
leads-to: [[Next Steps or Advanced Topics]]

# Learning Integration
learning-path: "progression-pathway"
learning-stage: "foundation/development/mastery"
practice-required: true/false
review-frequency: "weekly/monthly/quarterly"

# Vault Organization
moc: [[Map of Content]]
folder: "vault-folder-location"
connections: 5 # Number of vault connections
---
```

## 2. INTELLIGENT TAGGING SYSTEM
Create hierarchical, searchable tag structures:

**Domain Tags**: `#art/perspective`, `#programming/python`, `#business/strategy`
**Skill Level Tags**: `#skill/beginner`, `#skill/intermediate`, `#skill/advanced`
**Content Type Tags**: `#type/tutorial`, `#type/reference`, `#type/methodology`
**Status Tags**: `#status/active`, `#status/review`, `#status/mastered`
**Feature Tags**: `#has-examples`, `#has-exercises`, `#has-templates`
**Connection Tags**: `#builds-on`, `#prerequisite-for`, `#related-to`

## 3. PLUGIN ECOSYSTEM INTEGRATION
Optimize metadata for popular Obsidian plugins:

**Dataview Integration:**
```yaml
# Dataview-friendly fields
practice-time: 30 # minutes
completion-rate: 0.8 # 0-1 scale
last-practiced: YYYY-MM-DD
next-review: YYYY-MM-DD
importance: high/medium/low
```

**Templater Integration:**
```yaml
# Template variables
template-used: "note-template-name"
auto-generated: true/false
template-version: "1.0"
```

**Spaced Repetition:**
```yaml
# Learning optimization
retention-rate: 0.9
review-count: 3
mastery-level: 0.7
```

**Tasks Plugin:**
```yaml
# Task management
has-tasks: true
task-completion: 0.6
```

## 4. KNOWLEDGE MANAGEMENT METADATA
Support advanced knowledge organization:

**MOC Integration:**
```yaml
# Map of Content connections
parent-moc: [[Primary MOC]]
child-mocs: [[Subtopic MOCs]]
cross-domain-links: [[Related Field MOCs]]
```

**Learning Pathways:**
```yaml
# Progressive learning
pathway: "skill-development-path"
sequence: 3 # Position in learning sequence
prerequisites-met: true/false
ready-for-next: true/false
```

**Network Analysis:**
```yaml
# Connection metrics
in-degree: 8 # Number of incoming links
out-degree: 12 # Number of outgoing links
centrality: 0.7 # Network importance
cluster: "knowledge-cluster-name"
```

## 5. SEARCH AND DISCOVERY OPTIMIZATION
Enhance findability and discoverability:

**Search Keywords:**
```yaml
# Enhanced search terms
keywords: [search, terms, for, discovery]
concepts: [main, conceptual, themes]
synonyms: [alternative, terminology]
```

**Content Indicators:**
```yaml
# Content characteristics
has-images: true
has-code: false
has-formulas: true
has-references: true
word-count: 2500
read-time: 10 # minutes
```

## 6. WORKFLOW INTEGRATION
Support daily and review workflows:

**Daily Note Integration:**
```yaml
# Daily workflow
daily-note-mention: true
agenda-item: false
quick-capture: false
```

**Review System:**
```yaml
# Review optimization
review-type: "spaced-repetition"
review-priority: high/medium/low
review-notes: "specific areas needing attention"
```

**PROJECT INTEGRATION:**
```yaml
# Project connections
project: [[Related Project]]
milestone: "project-milestone"
deliverable: true/false
```

## 7. ADVANCED METADATA FEATURES
Utilize cutting-edge Obsidian capabilities:

**Canvas Integration:**
```yaml
# Visual organization
canvas-included: true
canvas-name: "knowledge-map-canvas"
visual-position: "center/periphery"
```

**Community Plugin Support:**
```yaml
# Extended functionality
excalidraw-diagrams: true
advanced-tables: false
mind-map-included: true
```

**METADATA OUTPUT REQUIREMENTS:**
- Comprehensive frontmatter with intelligent field selection
- Hierarchical tag system optimized for discovery
- Plugin ecosystem integration for enhanced functionality
- Knowledge management structure support
- Advanced search and organization capabilities

Generate optimized metadata that leverages Obsidian's full potential while maintaining clean organization and maximum discoverability.
