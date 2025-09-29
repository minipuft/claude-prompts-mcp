r# Gate System Intelligent Selection Upgrade

## Project Overview

**Goal**: Upgrade the gate selection system to properly parse prompt categories and implement template/prompt-level gate selection for more intelligent, context-aware gate activation.

**Date Started**: 2025-09-29
**Status**: Planning Phase
**Priority**: High - Core System Enhancement

## Current System Analysis

### Problems Identified

1. **Hardcoded Category Issue**

   - Engine always uses `'development'` category regardless of actual prompt context
   - Location: `engine.ts:1625` - `category: 'development', // Could be dynamic based on prompt category`
   - Impact: All prompts get development-category gates regardless of their actual purpose

2. **Limited Category Detection**

   - `categorizePrompt()` method only checks prompt ID patterns
   - Ignores folder structure (`/analysis/`, `/education/`, `/content_processing/`)
   - Ignores prompt metadata/frontmatter
   - Location: `engine.ts:1812-1830`

3. **No Template-Level Control**

   - Prompts cannot specify their own gate preferences
   - No mechanism for prompts to include/exclude specific gates
   - Framework selection is the only gate source

4. **Inflexible Gate Selection Logic**
   - Framework-based selection doesn't consider prompt-specific needs
   - No precedence system for combining gate sources
   - Location: `getFallbackGates()` method in `engine.ts:1747-1803`

### Current Gate Activation Flow

```
1. Framework Detection (ReACT)
   ↓
2. getFallbackGates() → ['framework-compliance', 'educational-clarity']
   ↓
3. Category Processing (hardcoded 'development')
   ↓
4. shouldActivateGate() validation
   ↓
5. Gate formatting and display
```

### Example: Notes Prompt Issues

- **Prompt Location**: `/prompts/analysis/notes.md`
- **Expected Category**: `analysis` → should get `research-quality` + `technical-accuracy`
- **Actual Category**: `development` (hardcoded) → gets development-focused gates
- **Result**: Mismatched gate guidance for educational/analysis content

## Proposed Solution Architecture

### Phase 1: Enhanced Category Parsing

**Objective**: Create intelligent category detection system

**Implementation Plan**:

1. **Folder Structure Parsing**

   ```typescript
   // Extract category from file path
   const folderCategory = extractCategoryFromPath("/prompts/analysis/notes.md"); // → 'analysis'
   ```

2. **Metadata Extraction**

   ```typescript
   // Parse prompt frontmatter for category
   const metadata = parsePromptMetadata(promptContent);
   const metadataCategory = metadata.category; // e.g., 'education'
   ```

3. **Priority System**
   ```typescript
   const category =
     metadataCategory || folderCategory || patternCategory || "general";
   ```

**Files to Modify**:

- `engine.ts` - Update `categorizePrompt()` method
- Add new `parsePromptMetadata()` helper function

### Phase 2: Template-Level Gate Specification

**Objective**: Allow prompts to specify their own gate preferences

**Implementation Plan**:

1. **Frontmatter Gate Syntax**

   ```yaml
   ---
   category: education
   gates:
     include: [educational-clarity, content-structure]
     exclude: [framework-compliance]
   framework_gates: true # Include framework defaults
   ---
   ```

2. **Simple Gate List Syntax**

   ```yaml
   ---
   gates: [educational-clarity, research-quality]
   ---
   ```

3. **Gate Modifier Syntax**
   ```yaml
   ---
   gates: ["+educational-clarity", "-framework-compliance"]
   ---
   ```

**Files to Modify**:

- Add `parsePromptGates()` function
- Update gate selection logic to merge template gates

### Phase 3: Intelligent Gate Selection Logic

**Objective**: Combine multiple gate sources with proper precedence

**Implementation Plan**:

1. **Gate Source Hierarchy**

   ```
   1. Explicit template gates (highest priority)
   2. Category-based gates
   3. Framework-based gates
   4. Default fallback gates (lowest priority)
   ```

2. **Selection Algorithm**

   ```typescript
   const selectedGates = combineGateSources({
     templateGates: parsePromptGates(prompt),
     categoryGates: getCategoryGates(actualCategory),
     frameworkGates: getFrameworkGates(activeFramework),
     fallbackGates: ["content-structure"],
   });
   ```

3. **Conflict Resolution**
   - Template exclusions override framework inclusions
   - Explicit inclusions always take precedence
   - Prevent duplicate gates

**Files to Modify**:

- `engine.ts` - Replace `getFallbackGates()` with `getIntelligentGateSelection()`
- Update gate selection flow

### Phase 4: Context-Aware Gate Activation

**Objective**: Pass accurate context to gate activation system

**Implementation Plan**:

1. **Dynamic Category Context**

   ```typescript
   // Replace hardcoded 'development'
   const context = {
     framework: frameworkContext?.selectedFramework?.methodology || "CAGEERF",
     category: actualPromptCategory, // Parsed, not hardcoded
     promptId: frameworkContext?.promptId,
     templateGates: promptGatePreferences,
   };
   ```

2. **Enhanced Gate Context**
   - Include prompt-specific metadata
   - Pass template gate preferences to activation logic
   - Enable context-aware gate formatting

**Files to Modify**:

- `engine.ts` - Update gate context creation
- `gate-manager.ts` - Enhance context interface if needed

## Implementation Roadmap

### Sprint 1: Foundation (Category Parsing)

- [ ] Implement folder-based category extraction
- [ ] Add metadata parsing functionality
- [ ] Update `categorizePrompt()` method
- [ ] Test category detection with existing prompts

### Sprint 2: Template Control (Gate Specification)

- [ ] Design frontmatter gate syntax
- [ ] Implement `parsePromptGates()` function
- [ ] Add template gate parsing to prompt loading
- [ ] Test with sample prompts containing gate specifications

### Sprint 3: Intelligent Selection (Logic Upgrade)

- [ ] Implement `getIntelligentGateSelection()` method
- [ ] Create gate source combination logic
- [ ] Add conflict resolution and precedence rules
- [ ] Replace existing gate selection logic

### Sprint 4: Integration & Testing (Context-Aware Activation)

- [ ] Update gate context creation to use actual categories
- [ ] Enhance gate activation with template context
- [ ] Comprehensive testing across all prompt types
- [ ] Performance optimization and error handling

## Testing Strategy

### Test Cases to Validate

1. **Category Detection**

   - `/prompts/analysis/notes.md` → category: `analysis`
   - `/prompts/education/learning.md` → category: `education`
   - Prompts with frontmatter category override

2. **Template Gate Control**

   - Prompt with `gates: [educational-clarity]` → only educational gate
   - Prompt with exclusions → framework gates minus excluded ones
   - Prompt with no gate specification → framework defaults

3. **Gate Activation**

   - Analysis prompts → get research-quality, technical-accuracy gates
   - Education prompts → get educational-clarity, content-structure gates
   - Development prompts → get code-quality, security-awareness gates

4. **Framework Integration**
   - ReACT + analysis category → combined gate set
   - Template overrides → respect prompt-specific preferences
   - Fallback behavior → when category/framework unknown

## Expected Benefits

### 1. **Accurate Gate Targeting**

- Notes prompt gets analysis-appropriate gates
- Education prompts get pedagogical guidance
- Development prompts get code-quality gates

### 2. **Template-Level Flexibility**

- Prompts can specify exactly which gates they need
- Framework defaults remain while allowing customization
- Fine-grained control over gate activation

### 3. **Intelligent Context Awareness**

- Category detection from multiple sources
- Proper precedence handling
- Context-specific gate activation

### 4. **Backward Compatibility**

- Existing prompts continue to work
- Framework-based selection remains default
- Gradual migration path for enhanced prompts

## Risk Assessment

### Low Risk

- Category parsing from folder structure (safe, deterministic)
- Metadata parsing (optional, fallback to existing logic)

### Medium Risk

- Gate selection logic changes (extensive testing needed)
- Context passing modifications (potential breaking changes)

### High Risk

- None identified (changes are additive and backward-compatible)

## Success Metrics

1. **Functional Validation**

   - [ ] Notes prompt gets analysis-category gates
   - [ ] Template gate specifications work correctly
   - [ ] All existing prompts continue to function

2. **Quality Improvement**

   - [ ] More relevant gate guidance for each prompt type
   - [ ] Reduced irrelevant gate activation
   - [ ] Better user experience with targeted hints

3. **System Robustness**
   - [ ] Graceful fallback when parsing fails
   - [ ] Performance maintained or improved
   - [ ] Error handling for edge cases

## Current Gate System Architecture (After Cleanup)

### Active Implementations

#### 1. **Primary System: `gate-manager.ts` (Working)**

- **Location**: `/src/gates/gate-manager.ts`
- **Purpose**: Supplemental guidance generation with framework-specific filtering
- **Status**: ✅ **ACTIVE** - Provides working framework-specific gate filtering
- **Key Features**:
  - Framework-specific guidance filtering (ReACT-only guidance)
  - Context-aware gate activation
  - Template support for multi-framework guidance
  - Proper formatting with "Quality Enhancement Gates" section

#### 2. **Secondary System: `LightweightGateSystem` (Validation)**

- **Location**: `/src/gates/core/index.ts`
- **Purpose**: Gate validation and retry logic
- **Status**: ⚠️ **PARTIALLY USED** - Used for validation, not guidance
- **Key Features**:
  - Content validation against gate criteria
  - Retry logic for failed validations
  - Statistics and monitoring

### Removed Implementations

#### ❌ **Unused: `simple-gate-manager.ts` (REMOVED)**

- **Status**: Completely unused, no imports or references
- **Removal Date**: 2025-09-29
- **Reason**: Redundant implementation that was never integrated

### Current Usage Patterns

```typescript
// In engine.ts:
// 1. Guidance Generation (PRIMARY)
this.gateManager = createGateManager(logger, gatesDirectory);
await this.gateManager.generateSupplementalGuidance(selectedGates, context);

// 2. Validation (SECONDARY)
this.lightweightGateSystem = createLightweightGateSystem(
  logger,
  gatesDirectory
);
this.engineValidator = new EngineValidator(this.lightweightGateSystem);
```

### Architecture Analysis

**Dual System Justification**:

- **`GateManager`**: Handles supplemental guidance generation (user-facing)
- **`LightweightGateSystem`**: Handles validation and retry logic (system-facing)
- **Separation of Concerns**: Guidance vs validation are different responsibilities

**Recommendation**: Keep both systems as they serve different purposes effectively.

## Change Log

### 2025-09-29 - Architecture Cleanup and Analysis

- ✅ **Removed**: `simple-gate-manager.ts` (unused implementation)
- ✅ **Verified**: `gate-manager.ts` is the working implementation for guidance
- ✅ **Documented**: Current dual-system architecture and justification
- ✅ **Confirmed**: No references to removed implementation

### 2025-09-29 - Initial Analysis and Planning

- Identified current system problems
- Analyzed gate activation flow for notes prompt
- Designed solution architecture with 4-phase approach
- Created implementation roadmap and testing strategy

---

**Next Actions**: Proceed with Sprint 1 implementation - category parsing enhancement
