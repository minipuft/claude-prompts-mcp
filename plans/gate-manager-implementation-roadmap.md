# Gate Management System Expansion - Comprehensive Implementation Roadmap

**Status**: Ready for Implementation
**Created**: 2025-01-23
**Estimated Time**: 20-25 hours
**Priority**: High

---

## Executive Summary

Expand the gate system with a new `gate_manager` MCP tool that mirrors `prompt_manager` architecture, enabling dynamic CRUD operations on gates while maintaining 100% backward compatibility with existing gate definitions.

### What This Achieves

- **Dynamic Gate Management**: Create, update, delete gates via MCP tool (like prompts)
- **Intelligent Search**: Filter gates by category, type, framework, usage patterns
- **Template System**: Quick gate creation from pre-built templates
- **Safety Validation**: Comprehensive validation and safety checks before gate changes
- **Hot-Reload Support**: Update gates without server restart
- **Usage Analytics**: Track which prompts use which gates, success rates, common failures

### Architecture Principles

1. **Mirror prompt_manager**: Use proven modular architecture pattern
2. **Zero Breaking Changes**: All existing gates continue working unchanged
3. **Progressive Enhancement**: New features are opt-in, existing workflows unaffected
4. **Integration First**: Seamless integration with existing GateLoader, GateSystemManager, GateAnalyzer

---

## Architecture Alignment

### Existing Patterns to Follow

**Modular Architecture** (from prompt_manager):
```
core/           - Manager orchestration, type definitions
operations/     - File I/O, registry updates
search/         - Filter parsing, matching logic
analysis/       - Gate analysis and recommendations
utils/          - Validation, category management
```

**MCP Tool Registration** (from index.ts):
- Zod schema validation for all inputs
- ToolResponse interface for consistent outputs
- Centralized registration in ConsolidatedMcpToolsManager
- Error handling with structured error responses

**File Operations** (from prompt_manager):
- JSON-based definitions with hot-reload support
- Registry synchronization (gatesConfig.json ← prompts.json pattern)
- Atomic writes with backup/rollback
- Safe file operations with validation

**State Management** (existing):
- GateSystemManager for runtime enable/disable (already exists)
- Event-driven architecture for state changes
- Persistent state storage in runtime-state/

### Integration Points

**Existing Components to Leverage:**
- ✅ `GateLoader` - Loading, caching, hot-reload (server/src/gates/core/gate-loader.ts)
- ✅ `GateSystemManager` - Runtime state management (server/src/gates/gate-state-manager.ts)
- ✅ `GateAnalyzer` - Gate analysis (server/src/mcp-tools/prompt-manager/analysis/gate-analyzer.ts)
- ✅ `GateSelectionEngine` - Intelligent gate selection (server/src/gates/intelligence/GateSelectionEngine.ts)

**New Components to Create:**
- ❌ ConsolidatedGateManager - Main orchestration (mirror prompt_manager structure)
- ❌ GateFileOperations - File I/O operations
- ❌ GateFilterParser - Filter parsing and validation
- ❌ GateMatcher - Search and matching logic
- ❌ GateValidator - Definition validation
- ❌ GateCategoryManager - Category management
- ❌ GateTemplateManager - Template system

---

## Phase 1: Gate Registry & Configuration System

**Estimated Time**: 2-3 hours
**Priority**: Critical (Foundation)
**Dependencies**: None

### Objective

Create centralized gate configuration without breaking existing gate definitions.

### 1.1 Create Gate Registry

**File**: `/server/src/gates/gatesConfig.json`

```json
{
  "version": "1.0.0",
  "description": "Central gate registry for MCP gate management",
  "categories": ["validation", "quality", "security", "performance", "framework"],
  "registrationMode": "ID",
  "gates": [
    {
      "id": "code-quality",
      "name": "Code Quality Standards",
      "category": "quality",
      "type": "validation",
      "file": "definitions/code-quality.json",
      "description": "Ensures generated code follows best practices",
      "activation": {
        "prompt_categories": ["code", "development"],
        "frameworks": [],
        "auto_activate": true
      },
      "metadata": {
        "created": "2024-01-01T00:00:00Z",
        "lastModified": "2024-01-01T00:00:00Z",
        "version": "1.0.0"
      }
    },
    {
      "id": "technical-accuracy",
      "name": "Technical Accuracy Gate",
      "category": "validation",
      "type": "validation",
      "file": "definitions/technical-accuracy.json",
      "description": "Validates technical accuracy and citation quality",
      "activation": {
        "prompt_categories": ["research", "analysis", "technical"],
        "frameworks": ["CAGEERF"],
        "auto_activate": true
      },
      "metadata": {
        "created": "2024-01-01T00:00:00Z",
        "lastModified": "2024-01-01T00:00:00Z",
        "version": "1.0.0"
      }
    },
    {
      "id": "security-awareness",
      "name": "Security Awareness Gate",
      "category": "security",
      "type": "validation",
      "file": "definitions/security-awareness.json",
      "description": "Ensures security best practices are followed",
      "activation": {
        "prompt_categories": ["code", "development", "security"],
        "frameworks": [],
        "auto_activate": true
      },
      "metadata": {
        "created": "2024-01-01T00:00:00Z",
        "lastModified": "2024-01-01T00:00:00Z",
        "version": "1.0.0"
      }
    },
    {
      "id": "research-quality",
      "name": "Research Quality Gate",
      "category": "quality",
      "type": "validation",
      "file": "definitions/research-quality.json",
      "description": "Validates research quality and source credibility",
      "activation": {
        "prompt_categories": ["research", "analysis"],
        "frameworks": ["CAGEERF"],
        "auto_activate": true
      },
      "metadata": {
        "created": "2024-01-01T00:00:00Z",
        "lastModified": "2024-01-01T00:00:00Z",
        "version": "1.0.0"
      }
    },
    {
      "id": "educational-clarity",
      "name": "Educational Clarity Gate",
      "category": "quality",
      "type": "validation",
      "file": "definitions/educational-clarity.json",
      "description": "Ensures educational content is clear and accessible",
      "activation": {
        "prompt_categories": ["education", "documentation"],
        "frameworks": [],
        "auto_activate": true
      },
      "metadata": {
        "created": "2024-01-01T00:00:00Z",
        "lastModified": "2024-01-01T00:00:00Z",
        "version": "1.0.0"
      }
    },
    {
      "id": "framework-compliance",
      "name": "Framework Compliance Gate",
      "category": "framework",
      "type": "validation",
      "file": "definitions/framework-compliance.json",
      "description": "Validates compliance with active framework methodology",
      "activation": {
        "prompt_categories": [],
        "frameworks": ["CAGEERF", "ReACT", "5W1H", "SCAMPER"],
        "auto_activate": false
      },
      "metadata": {
        "created": "2024-01-01T00:00:00Z",
        "lastModified": "2024-01-01T00:00:00Z",
        "version": "1.0.0"
      }
    },
    {
      "id": "content-structure",
      "name": "Content Structure Gate",
      "category": "validation",
      "type": "validation",
      "file": "definitions/content-structure.json",
      "description": "Validates content organization and structure",
      "activation": {
        "prompt_categories": ["content", "documentation"],
        "frameworks": [],
        "auto_activate": true
      },
      "metadata": {
        "created": "2024-01-01T00:00:00Z",
        "lastModified": "2024-01-01T00:00:00Z",
        "version": "1.0.0"
      }
    }
  ]
}
```

### 1.2 Create Categories Configuration

**File**: `/server/src/gates/categories.json`

```json
{
  "version": "1.0.0",
  "categories": [
    {
      "id": "validation",
      "name": "Validation Gates",
      "description": "Content and format validation gates that check basic requirements",
      "icon": "✓",
      "color": "#4CAF50"
    },
    {
      "id": "quality",
      "name": "Quality Gates",
      "description": "Quality standards and best practices enforcement",
      "icon": "⭐",
      "color": "#FFC107"
    },
    {
      "id": "security",
      "name": "Security Gates",
      "description": "Security checks and compliance validation",
      "icon": "🔒",
      "color": "#F44336"
    },
    {
      "id": "performance",
      "name": "Performance Gates",
      "description": "Performance requirements and optimization checks",
      "icon": "⚡",
      "color": "#2196F3"
    },
    {
      "id": "framework",
      "name": "Framework Gates",
      "description": "Framework methodology compliance and adherence",
      "icon": "🧩",
      "color": "#9C27B0"
    }
  ]
}
```

### 1.3 Update GateLoader for Registry Support

**File**: `/server/src/gates/core/gate-loader.ts`

**Changes Required:**

```typescript
// Add new imports
import type { GateRegistry, GateRegistryEntry, GateCategory } from '../types.js';

export class GateLoader {
  // Add new properties
  private gateRegistry: GateRegistry | null = null;
  private categories: GateCategory[] = [];
  private registryPath: string;

  constructor(logger: Logger, gatesDirectory?: string) {
    // Existing constructor code...

    // Set registry path
    this.registryPath = path.join(path.dirname(this.gatesDirectory), 'gatesConfig.json');
  }

  /**
   * Load gate registry from gatesConfig.json
   */
  async loadGateRegistry(): Promise<GateRegistry | null> {
    try {
      const registryContent = await fs.readFile(this.registryPath, 'utf-8');
      this.gateRegistry = JSON.parse(registryContent);
      this.logger.info(`✅ Loaded gate registry: ${this.gateRegistry.gates.length} gates`);
      return this.gateRegistry;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        this.logger.debug('Gate registry not found, using file-based discovery');
        return null;
      }
      this.logger.error('Failed to load gate registry:', error);
      return null;
    }
  }

  /**
   * Get gate metadata from registry
   */
  async getGateMetadata(gateId: string): Promise<GateRegistryEntry | null> {
    if (!this.gateRegistry) {
      await this.loadGateRegistry();
    }

    return this.gateRegistry?.gates.find(g => g.id === gateId) || null;
  }

  /**
   * List gates by category
   */
  async listGatesByCategory(category: string): Promise<string[]> {
    if (!this.gateRegistry) {
      await this.loadGateRegistry();
    }

    return this.gateRegistry?.gates
      .filter(g => g.category === category)
      .map(g => g.id) || [];
  }

  /**
   * Load all gate categories
   */
  async loadCategories(): Promise<GateCategory[]> {
    try {
      const categoriesPath = path.join(path.dirname(this.gatesDirectory), 'categories.json');
      const categoriesContent = await fs.readFile(categoriesPath, 'utf-8');
      const categoriesData = JSON.parse(categoriesContent);
      this.categories = categoriesData.categories;
      return this.categories;
    } catch (error) {
      this.logger.error('Failed to load gate categories:', error);
      return [];
    }
  }

  /**
   * Reload registry from file (for hot-reload)
   */
  async reloadRegistry(): Promise<void> {
    this.gateRegistry = null;
    await this.loadGateRegistry();
    this.logger.info('🔥 Gate registry hot-reloaded');
  }
}
```

### 1.4 Extend Gate Types

**File**: `/server/src/gates/types.ts` (add to existing file)

```typescript
/**
 * Gate registry entry (metadata only)
 */
export interface GateRegistryEntry {
  id: string;
  name: string;
  category: string;
  type: 'validation' | 'quality' | 'approval' | 'condition' | 'guidance';
  file: string; // Relative path from gates directory
  description: string;
  activation?: {
    prompt_categories?: string[];
    frameworks?: string[];
    auto_activate?: boolean;
  };
  metadata?: {
    created?: string;
    lastModified?: string;
    version?: string;
    author?: string;
  };
}

/**
 * Gate registry structure
 */
export interface GateRegistry {
  version: string;
  description: string;
  categories: string[];
  registrationMode?: 'ID' | 'NAME' | 'BOTH';
  gates: GateRegistryEntry[];
}

/**
 * Gate category definition
 */
export interface GateCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  color?: string;
}

/**
 * Gate creation request
 */
export interface GateCreationRequest {
  id: string;
  name: string;
  category: string;
  type: 'validation' | 'quality' | 'approval' | 'condition' | 'guidance';
  description: string;
  guidance: string;
  pass_criteria: any[];
  retry_config?: {
    max_attempts: number;
    improvement_hints?: boolean;
    preserve_context?: boolean;
  };
  activation?: {
    prompt_categories?: string[];
    frameworks?: string[];
    auto_activate?: boolean;
  };
}
```

### 1.5 Validation Steps

```bash
# Type check
npm run typecheck

# Build
npm run build

# Test gate loading
node -e "
const { createGateLoader } = require('./dist/gates/core/gate-loader.js');
const { Logger } = require('./dist/logging/index.js');
const logger = new Logger({ level: 'info' });
const loader = createGateLoader(logger);
loader.loadGateRegistry().then(registry => {
  console.log('Registry:', registry ? registry.gates.length + ' gates' : 'not found');
});
"

# Verify existing gates still load
npm run test:integration
```

**Success Criteria:**
- ✅ gatesConfig.json and categories.json created
- ✅ GateLoader loads registry successfully
- ✅ Existing gate definitions unchanged and still work
- ✅ TypeScript compilation passes
- ✅ All existing tests pass

---

## Phase 2: Gate Manager Core Module

**Estimated Time**: 4-5 hours
**Priority**: Critical (Core Functionality)
**Dependencies**: Phase 1

### Objective

Create core gate management operations mirroring prompt_manager structure.

### 2.1 Directory Structure

Create the following structure:

```
/server/src/mcp-tools/gate-manager/
├── core/
│   ├── index.ts                   # Exports
│   ├── manager.ts                 # ConsolidatedGateManager class
│   └── types.ts                   # Gate manager type definitions
├── operations/
│   └── gate-file-operations.ts   # File I/O operations
├── search/
│   ├── gate-filter-parser.ts     # Filter parsing
│   └── gate-matcher.ts           # Search/matching logic
├── analysis/
│   └── index.ts                  # Re-export existing gate-analyzer
├── utils/
│   ├── gate-validation.ts        # Gate definition validation
│   └── category-manager.ts       # Category management
└── index.ts                      # Main export
```

### 2.2 Create Gate Manager Types

**File**: `/server/src/mcp-tools/gate-manager/core/types.ts`

```typescript
import { Logger } from '../../../logging/index.js';
import { ConfigManager } from '../../../config/index.js';
import { GateLoader } from '../../../gates/core/gate-loader.js';
import { GateSystemManager } from '../../../gates/gate-state-manager.js';
import type {
  LightweightGateDefinition,
  GateCategory,
  GateRegistryEntry,
  GateCreationRequest
} from '../../../gates/types.js';
import type { ToolResponse } from '../../../types/index.js';

/**
 * Gate manager dependencies
 */
export interface GateManagerDependencies {
  logger: Logger;
  configManager: ConfigManager;
  gateLoader: GateLoader;
  gateSystemManager: GateSystemManager;
}

/**
 * Gate manager data references
 */
export interface GateManagerData {
  gates: LightweightGateDefinition[];
  categories: GateCategory[];
}

/**
 * Gate operation result
 */
export interface GateOperationResult {
  success: boolean;
  message: string;
  affectedFiles: string[];
  gateId?: string;
  errors?: string[];
}

/**
 * Gate filter options
 */
export interface GateFilterOptions {
  category?: string;
  type?: 'validation' | 'quality' | 'approval' | 'condition' | 'guidance';
  activation?: 'auto' | 'manual' | 'conditional';
  frameworks?: string[];
  usedBy?: string; // Prompt ID
  complexity?: 'low' | 'medium' | 'high';
  search?: string; // Fuzzy text search
}

/**
 * Parsed gate filter
 */
export interface ParsedGateFilter {
  category?: string[];
  type?: string[];
  activation?: string[];
  frameworks?: string[];
  usedBy?: string;
  complexity?: string[];
  searchTerms?: string[];
}

/**
 * Gate validation result
 */
export interface GateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Gate template customization
 */
export interface GateTemplateCustomization {
  gate_id: string;
  gate_name: string;
  description: string;
  min_length?: number;
  required_patterns?: string[];
  forbidden_patterns?: string[];
  prompt_categories?: string[];
  frameworks?: string[];
  max_attempts?: number;
}

/**
 * Gate usage information
 */
export interface GateUsageInfo {
  gateId: string;
  usedByPrompts: string[];
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  averageExecutionTime: number;
  lastUsed: Date | null;
}
```

### 2.3 Implement Core Manager Class

**File**: `/server/src/mcp-tools/gate-manager/core/manager.ts`

```typescript
import { Logger } from '../../../logging/index.js';
import { ConfigManager } from '../../../config/index.js';
import type { ToolResponse } from '../../../types/index.js';
import type {
  LightweightGateDefinition,
  GateCategory,
  GateCreationRequest
} from '../../../gates/types.js';
import {
  GateManagerDependencies,
  GateOperationResult,
  GateTemplateCustomization,
  GateUsageInfo
} from './types.js';
import { createPromptResponse, createErrorResponse } from '../../shared/structured-response-builder.js';
import { GateFileOperations } from '../operations/gate-file-operations.js';
import { GateFilterParser } from '../search/gate-filter-parser.js';
import { GateMatcher } from '../search/gate-matcher.js';
import { GateValidator } from '../utils/gate-validation.js';
import { GateCategoryManager } from '../utils/category-manager.js';

/**
 * Consolidated Gate Manager - Modular Architecture
 *
 * Mirrors the structure and patterns of ConsolidatedPromptManager
 */
export class ConsolidatedGateManager {
  private logger: Logger;
  private configManager: ConfigManager;
  private gateLoader;
  private gateSystemManager;

  // Modular components
  private fileOperations: GateFileOperations;
  private filterParser: GateFilterParser;
  private gateMatcher: GateMatcher;
  private gateValidator: GateValidator;
  private categoryManager: GateCategoryManager;

  // Data references
  private gates: LightweightGateDefinition[] = [];
  private categories: GateCategory[] = [];

  constructor(dependencies: GateManagerDependencies) {
    this.logger = dependencies.logger;
    this.configManager = dependencies.configManager;
    this.gateLoader = dependencies.gateLoader;
    this.gateSystemManager = dependencies.gateSystemManager;

    // Initialize modular components
    this.fileOperations = new GateFileOperations(dependencies);
    this.filterParser = new GateFilterParser(this.logger);
    this.gateMatcher = new GateMatcher(this.logger);
    this.gateValidator = new GateValidator(this.logger);
    this.categoryManager = new GateCategoryManager(this.logger);

    this.logger.debug('ConsolidatedGateManager initialized with modular architecture');
  }

  /**
   * Main action handler - Routes to appropriate modules
   */
  async handleAction(args: {
    action: 'create' | 'update' | 'delete' | 'list' | 'analyze' |
            'test' | 'reload' | 'create_from_template' | 'list_templates' | 'usage';
    [key: string]: any;
  }, context: any): Promise<ToolResponse> {
    this.logger.info(`[GATE MANAGER] Handling action: ${args.action}`);

    try {
      switch (args.action) {
        case 'create':
          return await this.createGate(args.definition);

        case 'update':
          return await this.updateGate(args.gate_id, args.definition);

        case 'delete':
          return await this.deleteGate(args.gate_id);

        case 'list':
          return await this.listGates(args.filters);

        case 'analyze':
          return await this.analyzeGate(args.gate_id);

        case 'test':
          return await this.testGate(args.gate_id, args.test_content);

        case 'reload':
          return await this.reloadGates();

        case 'create_from_template':
          return await this.createFromTemplate(args.template_name, args.customization);

        case 'list_templates':
          return await this.listTemplates();

        case 'usage':
          return await this.getGateUsage(args.gate_id);

        default:
          return createErrorResponse(
            `Unknown action: ${args.action}`,
            'gate_manager'
          );
      }
    } catch (error) {
      this.logger.error(`[GATE MANAGER] Error in action ${args.action}:`, error);
      return createErrorResponse(
        error instanceof Error ? error.message : String(error),
        'gate_manager'
      );
    }
  }

  /**
   * Create a new gate
   */
  async createGate(definition: GateCreationRequest): Promise<ToolResponse> {
    this.logger.info(`[GATE MANAGER] Creating gate: ${definition.id}`);

    // Validate definition
    const validationResult = await this.gateValidator.validateGateDefinition(definition);
    if (!validationResult.valid) {
      return createErrorResponse(
        `Gate validation failed:\n${validationResult.errors.join('\n')}`,
        'gate_manager'
      );
    }

    // Create gate file and update registry
    const result = await this.fileOperations.createGateFile(definition);

    if (result.success) {
      // Clear cache and reload
      this.gateLoader.clearCache(definition.id);

      return createPromptResponse(
        `✅ Gate created successfully: ${definition.id}\n\n${result.message}`,
        'gate_manager'
      );
    } else {
      return createErrorResponse(result.message, 'gate_manager');
    }
  }

  /**
   * Update an existing gate
   */
  async updateGate(gateId: string, updates: Partial<GateCreationRequest>): Promise<ToolResponse> {
    this.logger.info(`[GATE MANAGER] Updating gate: ${gateId}`);

    // Load existing gate
    const existingGate = await this.gateLoader.loadGate(gateId);
    if (!existingGate) {
      return createErrorResponse(`Gate not found: ${gateId}`, 'gate_manager');
    }

    // Merge updates
    const mergedDefinition = { ...existingGate, ...updates };

    // Validate merged definition
    const validationResult = await this.gateValidator.validateGateDefinition(mergedDefinition);
    if (!validationResult.valid) {
      return createErrorResponse(
        `Gate validation failed:\n${validationResult.errors.join('\n')}`,
        'gate_manager'
      );
    }

    // Update gate file and registry
    const result = await this.fileOperations.updateGateFile(gateId, mergedDefinition);

    if (result.success) {
      // Clear cache and reload
      this.gateLoader.clearCache(gateId);

      return createPromptResponse(
        `✅ Gate updated successfully: ${gateId}\n\n${result.message}`,
        'gate_manager'
      );
    } else {
      return createErrorResponse(result.message, 'gate_manager');
    }
  }

  /**
   * Delete a gate
   */
  async deleteGate(gateId: string): Promise<ToolResponse> {
    this.logger.info(`[GATE MANAGER] Deleting gate: ${gateId}`);

    // Check if gate exists
    const existingGate = await this.gateLoader.loadGate(gateId);
    if (!existingGate) {
      return createErrorResponse(`Gate not found: ${gateId}`, 'gate_manager');
    }

    // Safety check: is gate in use?
    const usageInfo = await this.getGateUsageInfo(gateId);
    if (usageInfo.usedByPrompts.length > 0) {
      return createErrorResponse(
        `⚠️ Cannot delete gate in use by ${usageInfo.usedByPrompts.length} prompts:\n` +
        usageInfo.usedByPrompts.map(p => `  - ${p}`).join('\n') +
        '\n\nRemove gate from prompts first or use force=true to override.',
        'gate_manager'
      );
    }

    // Delete gate file and update registry
    const result = await this.fileOperations.deleteGateFile(gateId);

    if (result.success) {
      // Clear cache
      this.gateLoader.clearCache(gateId);

      return createPromptResponse(
        `✅ Gate deleted successfully: ${gateId}\n\n${result.message}`,
        'gate_manager'
      );
    } else {
      return createErrorResponse(result.message, 'gate_manager');
    }
  }

  /**
   * List gates with optional filtering
   */
  async listGates(filterString?: string): Promise<ToolResponse> {
    this.logger.info(`[GATE MANAGER] Listing gates with filters: ${filterString || 'none'}`);

    // Load registry
    const registry = await this.gateLoader.loadGateRegistry();
    if (!registry) {
      return createErrorResponse('Gate registry not found', 'gate_manager');
    }

    // Parse filters
    const filters = filterString
      ? this.filterParser.parseFilterString(filterString)
      : undefined;

    // Load all gates
    const allGateIds = registry.gates.map(g => g.id);
    const gates = await this.gateLoader.loadGates(allGateIds);

    // Apply filters
    const filteredGates = filters
      ? this.gateMatcher.matchGates(gates, filters)
      : gates;

    // Format response
    const gateList = filteredGates.map(gate => {
      const metadata = registry.gates.find(g => g.id === gate.id);
      return `**${gate.name}** (${gate.id})\n` +
             `  Category: ${metadata?.category || 'unknown'}\n` +
             `  Type: ${gate.type}\n` +
             `  Description: ${gate.description || 'No description'}\n`;
    }).join('\n');

    return createPromptResponse(
      `📋 **Gates** (${filteredGates.length} of ${gates.length}):\n\n${gateList}`,
      'gate_manager'
    );
  }

  /**
   * Analyze a gate
   */
  async analyzeGate(gateId: string): Promise<ToolResponse> {
    this.logger.info(`[GATE MANAGER] Analyzing gate: ${gateId}`);

    const gate = await this.gateLoader.loadGate(gateId);
    if (!gate) {
      return createErrorResponse(`Gate not found: ${gateId}`, 'gate_manager');
    }

    // Get usage info
    const usageInfo = await this.getGateUsageInfo(gateId);

    // Analyze gate structure
    const analysis = {
      id: gate.id,
      name: gate.name,
      type: gate.type,
      passCriteriaCount: gate.pass_criteria?.length || 0,
      hasGuidance: !!gate.guidance,
      hasRetryConfig: !!gate.retry_config,
      activationRules: gate.activation,
      usage: {
        usedByPrompts: usageInfo.usedByPrompts.length,
        totalValidations: usageInfo.totalValidations,
        successRate: usageInfo.totalValidations > 0
          ? (usageInfo.successfulValidations / usageInfo.totalValidations * 100).toFixed(1) + '%'
          : 'N/A'
      }
    };

    return createPromptResponse(
      `🔍 **Gate Analysis**: ${gate.name}\n\n` +
      `**Structure:**\n` +
      `- Pass Criteria: ${analysis.passCriteriaCount} rules\n` +
      `- Guidance: ${analysis.hasGuidance ? 'Yes' : 'No'}\n` +
      `- Retry Config: ${analysis.hasRetryConfig ? 'Yes' : 'No'}\n\n` +
      `**Usage:**\n` +
      `- Used by: ${analysis.usage.usedByPrompts} prompts\n` +
      `- Total Validations: ${analysis.usage.totalValidations}\n` +
      `- Success Rate: ${analysis.usage.successRate}`,
      'gate_manager'
    );
  }

  /**
   * Test a gate with sample content
   */
  async testGate(gateId: string, testContent: string): Promise<ToolResponse> {
    this.logger.info(`[GATE MANAGER] Testing gate: ${gateId}`);

    const gate = await this.gateLoader.loadGate(gateId);
    if (!gate) {
      return createErrorResponse(`Gate not found: ${gateId}`, 'gate_manager');
    }

    // TODO: Implement gate validation logic
    // This would integrate with the existing gate validation system

    return createPromptResponse(
      `🧪 **Gate Test**: ${gate.name}\n\n` +
      `Test content received (${testContent.length} characters)\n\n` +
      `⚠️ Gate validation testing not yet implemented`,
      'gate_manager'
    );
  }

  /**
   * Reload all gates from disk
   */
  async reloadGates(): Promise<ToolResponse> {
    this.logger.info('[GATE MANAGER] Reloading all gates');

    this.gateLoader.clearCache();
    await this.gateLoader.reloadRegistry();

    return createPromptResponse(
      '🔥 Gates hot-reloaded successfully',
      'gate_manager'
    );
  }

  /**
   * Create gate from template
   */
  async createFromTemplate(
    templateName: string,
    customization: GateTemplateCustomization
  ): Promise<ToolResponse> {
    this.logger.info(`[GATE MANAGER] Creating gate from template: ${templateName}`);

    // TODO: Implement template loading
    return createErrorResponse(
      'Template functionality not yet implemented',
      'gate_manager'
    );
  }

  /**
   * List available templates
   */
  async listTemplates(): Promise<ToolResponse> {
    this.logger.info('[GATE MANAGER] Listing templates');

    // TODO: Implement template listing
    return createPromptResponse(
      '📄 **Available Templates**:\n\n(Templates not yet implemented)',
      'gate_manager'
    );
  }

  /**
   * Get gate usage information
   */
  async getGateUsage(gateId: string): Promise<ToolResponse> {
    this.logger.info(`[GATE MANAGER] Getting usage for gate: ${gateId}`);

    const usageInfo = await this.getGateUsageInfo(gateId);

    return createPromptResponse(
      `📊 **Gate Usage**: ${gateId}\n\n` +
      `- Used by ${usageInfo.usedByPrompts.length} prompts\n` +
      `- Total validations: ${usageInfo.totalValidations}\n` +
      `- Successful: ${usageInfo.successfulValidations}\n` +
      `- Failed: ${usageInfo.failedValidations}\n` +
      `- Success rate: ${usageInfo.totalValidations > 0
        ? (usageInfo.successfulValidations / usageInfo.totalValidations * 100).toFixed(1) + '%'
        : 'N/A'}`,
      'gate_manager'
    );
  }

  /**
   * Get gate usage information (internal helper)
   */
  private async getGateUsageInfo(gateId: string): Promise<GateUsageInfo> {
    // TODO: Implement usage tracking
    return {
      gateId,
      usedByPrompts: [],
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      averageExecutionTime: 0,
      lastUsed: null
    };
  }
}
```

### 2.4 Create File Operations Module

**File**: `/server/src/mcp-tools/gate-manager/operations/gate-file-operations.ts`

```typescript
import * as fs from 'fs/promises';
import path from 'path';
import { Logger } from '../../../logging/index.js';
import { ConfigManager } from '../../../config/index.js';
import type {
  GateCreationRequest,
  GateRegistry,
  GateRegistryEntry
} from '../../../gates/types.js';
import type { GateManagerDependencies, GateOperationResult } from '../core/types.js';

/**
 * File system operations for gate management
 */
export class GateFileOperations {
  private logger: Logger;
  private configManager: ConfigManager;
  private gatesDirectory: string;
  private registryPath: string;

  constructor(dependencies: Pick<GateManagerDependencies, 'logger' | 'configManager'>) {
    this.logger = dependencies.logger;
    this.configManager = dependencies.configManager;

    // Set paths (mirror gates directory structure)
    this.gatesDirectory = path.join(
      this.configManager.getServerRoot(),
      'src/gates/definitions'
    );
    this.registryPath = path.join(
      this.configManager.getServerRoot(),
      'src/gates/gatesConfig.json'
    );
  }

  /**
   * Create a new gate file and update registry
   */
  async createGateFile(definition: GateCreationRequest): Promise<GateOperationResult> {
    try {
      const gateFilePath = path.join(this.gatesDirectory, `${definition.id}.json`);

      // Check if gate already exists
      try {
        await fs.access(gateFilePath);
        return {
          success: false,
          message: `Gate already exists: ${definition.id}`,
          affectedFiles: []
        };
      } catch {
        // Gate doesn't exist, proceed with creation
      }

      // Create gate definition file
      const gateDefinition = this.formatGateDefinition(definition);
      await fs.writeFile(gateFilePath, JSON.stringify(gateDefinition, null, 2), 'utf-8');

      // Update registry
      await this.updateRegistry('add', {
        id: definition.id,
        name: definition.name,
        category: definition.category,
        type: definition.type,
        file: `definitions/${definition.id}.json`,
        description: definition.description,
        activation: definition.activation,
        metadata: {
          created: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          version: '1.0.0'
        }
      });

      return {
        success: true,
        message: `Gate created: ${definition.id}`,
        affectedFiles: [gateFilePath, this.registryPath],
        gateId: definition.id
      };
    } catch (error) {
      this.logger.error('Failed to create gate file:', error);
      return {
        success: false,
        message: `Failed to create gate: ${error instanceof Error ? error.message : String(error)}`,
        affectedFiles: [],
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Update an existing gate file and registry
   */
  async updateGateFile(
    gateId: string,
    definition: Partial<GateCreationRequest>
  ): Promise<GateOperationResult> {
    try {
      const gateFilePath = path.join(this.gatesDirectory, `${gateId}.json`);

      // Backup existing gate
      const backupPath = await this.backupGate(gateId);

      // Update gate definition file
      const gateDefinition = this.formatGateDefinition(definition as GateCreationRequest);
      await fs.writeFile(gateFilePath, JSON.stringify(gateDefinition, null, 2), 'utf-8');

      // Update registry
      await this.updateRegistry('update', {
        id: gateId,
        name: definition.name!,
        category: definition.category!,
        type: definition.type!,
        file: `definitions/${gateId}.json`,
        description: definition.description!,
        activation: definition.activation,
        metadata: {
          lastModified: new Date().toISOString()
        }
      });

      return {
        success: true,
        message: `Gate updated: ${gateId}\nBackup created: ${backupPath}`,
        affectedFiles: [gateFilePath, this.registryPath],
        gateId
      };
    } catch (error) {
      this.logger.error('Failed to update gate file:', error);
      return {
        success: false,
        message: `Failed to update gate: ${error instanceof Error ? error.message : String(error)}`,
        affectedFiles: [],
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Delete a gate file and update registry
   */
  async deleteGateFile(gateId: string): Promise<GateOperationResult> {
    try {
      const gateFilePath = path.join(this.gatesDirectory, `${gateId}.json`);

      // Backup before deletion
      const backupPath = await this.backupGate(gateId);

      // Delete gate file
      await fs.unlink(gateFilePath);

      // Update registry
      await this.updateRegistry('remove', { id: gateId } as GateRegistryEntry);

      return {
        success: true,
        message: `Gate deleted: ${gateId}\nBackup created: ${backupPath}`,
        affectedFiles: [gateFilePath, this.registryPath],
        gateId
      };
    } catch (error) {
      this.logger.error('Failed to delete gate file:', error);
      return {
        success: false,
        message: `Failed to delete gate: ${error instanceof Error ? error.message : String(error)}`,
        affectedFiles: [],
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Update gate registry
   */
  private async updateRegistry(
    operation: 'add' | 'remove' | 'update',
    entry: GateRegistryEntry
  ): Promise<void> {
    // Load current registry
    const registryContent = await fs.readFile(this.registryPath, 'utf-8');
    const registry: GateRegistry = JSON.parse(registryContent);

    // Perform operation
    switch (operation) {
      case 'add':
        registry.gates.push(entry);
        break;

      case 'remove':
        registry.gates = registry.gates.filter(g => g.id !== entry.id);
        break;

      case 'update':
        const index = registry.gates.findIndex(g => g.id === entry.id);
        if (index !== -1) {
          registry.gates[index] = { ...registry.gates[index], ...entry };
        }
        break;
    }

    // Write updated registry
    await fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2), 'utf-8');
  }

  /**
   * Backup a gate file
   */
  private async backupGate(gateId: string): Promise<string> {
    const gateFilePath = path.join(this.gatesDirectory, `${gateId}.json`);
    const backupPath = path.join(
      this.gatesDirectory,
      'backups',
      `${gateId}.${Date.now()}.json`
    );

    // Ensure backup directory exists
    await fs.mkdir(path.dirname(backupPath), { recursive: true });

    // Copy gate file to backup
    await fs.copyFile(gateFilePath, backupPath);

    return backupPath;
  }

  /**
   * Format gate definition for file storage
   */
  private formatGateDefinition(definition: GateCreationRequest): any {
    return {
      id: definition.id,
      name: definition.name,
      type: definition.type,
      description: definition.description,
      guidance: definition.guidance,
      pass_criteria: definition.pass_criteria,
      retry_config: definition.retry_config || {
        max_attempts: 2,
        improvement_hints: true,
        preserve_context: true
      },
      activation: definition.activation || {
        prompt_categories: [],
        auto_activate: false
      }
    };
  }
}
```

### 2.5 Create Main Export

**File**: `/server/src/mcp-tools/gate-manager/index.ts`

```typescript
import { Logger } from '../../logging/index.js';
import { ConfigManager } from '../../config/index.js';
import { GateLoader } from '../../gates/core/gate-loader.js';
import { GateSystemManager } from '../../gates/gate-state-manager.js';
import { ConsolidatedGateManager } from './core/manager.js';
import type { GateManagerDependencies } from './core/types.js';

/**
 * Create consolidated gate manager instance
 */
export function createConsolidatedGateManager(
  logger: Logger,
  configManager: ConfigManager,
  gateLoader: GateLoader,
  gateSystemManager: GateSystemManager
): ConsolidatedGateManager {
  const dependencies: GateManagerDependencies = {
    logger,
    configManager,
    gateLoader,
    gateSystemManager
  };

  return new ConsolidatedGateManager(dependencies);
}

// Exports
export { ConsolidatedGateManager } from './core/manager.js';
export * from './core/types.js';
```

### 2.6 Validation Steps

```bash
# Type check
npm run typecheck

# Build
npm run build

# Test basic operations
npm run test:unit
```

**Success Criteria:**
- ✅ ConsolidatedGateManager class created
- ✅ File operations module implemented
- ✅ All TypeScript compilation passes
- ✅ Modular architecture mirrors prompt_manager

---

## Phase 3: Gate Search & Filter System

**Estimated Time**: 3-4 hours
**Priority**: High (User Experience)
**Dependencies**: Phase 2

### Objective

Implement intelligent gate search and filtering capabilities.

### 3.1 Create Filter Parser

**File**: `/server/src/mcp-tools/gate-manager/search/gate-filter-parser.ts`

```typescript
import { Logger } from '../../../logging/index.js';
import type { ParsedGateFilter } from '../core/types.js';

/**
 * Gate filter parser
 *
 * Supported syntax:
 * - category:quality
 * - type:validation
 * - activation:auto
 * - frameworks:CAGEERF,ReACT
 * - used_by:promptId
 * - complexity:medium
 * - search terms (fuzzy match)
 */
export class GateFilterParser {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Parse filter string into structured filter object
   */
  parseFilterString(filterString: string): ParsedGateFilter {
    const filters: ParsedGateFilter = {};
    const parts = filterString.split(/\s+/);

    for (const part of parts) {
      if (part.includes(':')) {
        const [key, value] = part.split(':', 2);
        this.parseFilterPart(key.trim(), value.trim(), filters);
      } else {
        // Plain search term
        if (!filters.searchTerms) filters.searchTerms = [];
        filters.searchTerms.push(part.trim());
      }
    }

    this.logger.debug('[FILTER PARSER] Parsed filters:', filters);
    return filters;
  }

  /**
   * Parse individual filter part
   */
  private parseFilterPart(key: string, value: string, filters: ParsedGateFilter): void {
    switch (key.toLowerCase()) {
      case 'category':
        filters.category = value.split(',').map(v => v.trim());
        break;

      case 'type':
        filters.type = value.split(',').map(v => v.trim());
        break;

      case 'activation':
        filters.activation = value.split(',').map(v => v.trim());
        break;

      case 'frameworks':
        filters.frameworks = value.split(',').map(v => v.trim());
        break;

      case 'used_by':
        filters.usedBy = value;
        break;

      case 'complexity':
        filters.complexity = value.split(',').map(v => v.trim());
        break;

      default:
        this.logger.warn(`[FILTER PARSER] Unknown filter key: ${key}`);
    }
  }

  /**
   * Validate filter syntax
   */
  validateFilterString(filterString: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const parts = filterString.split(/\s+/);

    for (const part of parts) {
      if (part.includes(':')) {
        const [key] = part.split(':', 2);
        const validKeys = ['category', 'type', 'activation', 'frameworks', 'used_by', 'complexity'];

        if (!validKeys.includes(key.toLowerCase())) {
          errors.push(`Invalid filter key: ${key}. Valid keys: ${validKeys.join(', ')}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
```

### 3.2 Create Gate Matcher

**File**: `/server/src/mcp-tools/gate-manager/search/gate-matcher.ts`

```typescript
import { Logger } from '../../../logging/index.js';
import type { LightweightGateDefinition } from '../../../gates/types.js';
import type { ParsedGateFilter } from '../core/types.js';

/**
 * Scored match result
 */
interface ScoredMatch {
  gate: LightweightGateDefinition;
  score: number;
  matchReasons: string[];
}

/**
 * Gate matcher for search and filtering
 */
export class GateMatcher {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Match gates against filters
   */
  matchGates(
    gates: LightweightGateDefinition[],
    filters: ParsedGateFilter
  ): LightweightGateDefinition[] {
    this.logger.debug(`[GATE MATCHER] Matching ${gates.length} gates against filters`);

    let filtered = [...gates];

    // Apply category filter
    if (filters.category && filters.category.length > 0) {
      filtered = filtered.filter(gate => {
        // Gate definitions don't have category field directly
        // We'd need to cross-reference with registry
        return true; // TODO: Implement category filtering
      });
    }

    // Apply type filter
    if (filters.type && filters.type.length > 0) {
      filtered = filtered.filter(gate =>
        filters.type!.includes(gate.type)
      );
    }

    // Apply activation filter
    if (filters.activation && filters.activation.length > 0) {
      filtered = filtered.filter(gate => {
        const activation = gate.activation;
        if (!activation) return filters.activation!.includes('manual');

        if (activation.explicit_request) return filters.activation!.includes('manual');
        return filters.activation!.includes('auto');
      });
    }

    // Apply framework filter
    if (filters.frameworks && filters.frameworks.length > 0) {
      filtered = filtered.filter(gate => {
        const activation = gate.activation;
        if (!activation || !activation.framework_context) return false;

        return filters.frameworks!.some(fw =>
          activation.framework_context!.includes(fw)
        );
      });
    }

    // Apply search terms (fuzzy match on name and description)
    if (filters.searchTerms && filters.searchTerms.length > 0) {
      filtered = filtered.filter(gate => {
        const searchableText = `${gate.name} ${gate.description || ''}`.toLowerCase();
        return filters.searchTerms!.every(term =>
          searchableText.includes(term.toLowerCase())
        );
      });
    }

    this.logger.debug(`[GATE MATCHER] Matched ${filtered.length} gates`);
    return filtered;
  }

  /**
   * Fuzzy match gate names
   */
  fuzzyMatchGateName(
    query: string,
    gates: LightweightGateDefinition[]
  ): ScoredMatch[] {
    const queryLower = query.toLowerCase();
    const matches: ScoredMatch[] = [];

    for (const gate of gates) {
      const nameLower = gate.name.toLowerCase();
      const idLower = gate.id.toLowerCase();
      let score = 0;
      const matchReasons: string[] = [];

      // Exact match
      if (nameLower === queryLower || idLower === queryLower) {
        score += 100;
        matchReasons.push('exact match');
      }

      // Starts with
      if (nameLower.startsWith(queryLower) || idLower.startsWith(queryLower)) {
        score += 50;
        matchReasons.push('starts with query');
      }

      // Contains
      if (nameLower.includes(queryLower) || idLower.includes(queryLower)) {
        score += 25;
        matchReasons.push('contains query');
      }

      // Word match
      const queryWords = queryLower.split(/\s+/);
      const nameWords = nameLower.split(/\s+/);
      const matchingWords = queryWords.filter(qw =>
        nameWords.some(nw => nw.includes(qw))
      );
      score += matchingWords.length * 10;
      if (matchingWords.length > 0) {
        matchReasons.push(`${matchingWords.length} word matches`);
      }

      if (score > 0) {
        matches.push({ gate, score, matchReasons });
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    return matches;
  }

  /**
   * Filter gates by usage (which prompts use them)
   */
  filterByUsage(promptId: string, gates: LightweightGateDefinition[]): LightweightGateDefinition[] {
    // TODO: Implement usage tracking integration
    this.logger.warn('[GATE MATCHER] Usage filtering not yet implemented');
    return gates;
  }
}
```

### 3.3 Create Utility Stubs

**File**: `/server/src/mcp-tools/gate-manager/utils/gate-validation.ts`

```typescript
import { Logger } from '../../../logging/index.js';
import type { GateCreationRequest } from '../../../gates/types.js';
import type { GateValidationResult } from '../core/types.js';

/**
 * Gate definition validator
 */
export class GateValidator {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Validate gate definition
   */
  async validateGateDefinition(definition: Partial<GateCreationRequest>): Promise<GateValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Validate ID
    if (!definition.id) {
      errors.push('Gate ID is required');
    } else if (!/^[a-z0-9-]+$/.test(definition.id)) {
      errors.push('Gate ID must contain only lowercase letters, numbers, and hyphens');
    } else if (definition.id.length < 3 || definition.id.length > 50) {
      errors.push('Gate ID must be between 3 and 50 characters');
    }

    // Validate name
    if (!definition.name) {
      errors.push('Gate name is required');
    } else if (definition.name.length < 5 || definition.name.length > 100) {
      errors.push('Gate name must be between 5 and 100 characters');
    }

    // Validate type
    if (!definition.type) {
      errors.push('Gate type is required');
    } else if (!['validation', 'quality', 'approval', 'condition', 'guidance'].includes(definition.type)) {
      errors.push('Gate type must be one of: validation, quality, approval, condition, guidance');
    }

    // Validate pass criteria
    if (!definition.pass_criteria || definition.pass_criteria.length === 0) {
      errors.push('At least one pass criterion is required');
    }

    // Warnings
    if (!definition.description) {
      warnings.push('Consider adding a description for better documentation');
    }

    if (!definition.guidance) {
      warnings.push('Consider adding guidance text to help users understand requirements');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions
    };
  }
}
```

**File**: `/server/src/mcp-tools/gate-manager/utils/category-manager.ts`

```typescript
import { Logger } from '../../../logging/index.js';

/**
 * Gate category manager
 */
export class GateCategoryManager {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // TODO: Implement category management methods
}
```

### 3.4 Validation Steps

```bash
npm run typecheck
npm run build
```

**Success Criteria:**
- ✅ Filter parser handles all filter types
- ✅ Gate matcher filters correctly
- ✅ Validation logic implemented
- ✅ TypeScript compilation passes

---

## Phase 4: Gate Templates System

**Estimated Time**: 2-3 hours
**Priority**: High (Developer Experience)
**Dependencies**: Phase 2

### Objective

Create pre-built gate templates for common scenarios.

### 4.1 Create Template Directory Structure

```bash
mkdir -p /server/src/gates/templates
```

### 4.2 Create Template Files

**File**: `/server/src/gates/templates/validation-basic.json`

```json
{
  "id": "{{gate_id}}",
  "name": "{{gate_name}}",
  "type": "validation",
  "description": "{{description}}",
  "guidance": "**Basic Validation Requirements:**\n- Minimum content length: {{min_length}} characters\n- Required patterns: {{#required_patterns}}{{.}}, {{/required_patterns}}\n- Forbidden patterns: {{#forbidden_patterns}}{{.}}, {{/forbidden_patterns}}",
  "pass_criteria": [
    {
      "type": "content_check",
      "min_length": "{{min_length}}",
      "required_patterns": "{{required_patterns}}",
      "forbidden_patterns": "{{forbidden_patterns}}"
    }
  ],
  "retry_config": {
    "max_attempts": "{{max_attempts}}",
    "improvement_hints": true,
    "preserve_context": true
  },
  "activation": {
    "prompt_categories": "{{prompt_categories}}",
    "auto_activate": false
  }
}
```

**File**: `/server/src/gates/templates/code-quality.json`

```json
{
  "id": "{{gate_id}}",
  "name": "{{gate_name}}",
  "type": "validation",
  "description": "{{description}}",
  "guidance": "**Code Quality Standards:**\n- Include error handling and input validation\n- Add inline comments for complex logic\n- Follow consistent naming conventions\n- Consider edge cases and boundary conditions\n- Optimize for readability over cleverness",
  "pass_criteria": [
    {
      "type": "content_check",
      "min_length": 100,
      "required_patterns": ["try", "catch", "function", "const"],
      "forbidden_patterns": ["TODO", "FIXME", "hack"]
    },
    {
      "type": "pattern_check",
      "regex_patterns": [
        "function\\s+\\w+\\s*\\(",
        "\\/\\/.*\\w+",
        "try\\s*\\{"
      ]
    }
  ],
  "retry_config": {
    "max_attempts": 2,
    "improvement_hints": true,
    "preserve_context": true
  },
  "activation": {
    "prompt_categories": ["code", "development"],
    "auto_activate": true
  }
}
```

**File**: `/server/src/gates/templates/security-check.json`

```json
{
  "id": "{{gate_id}}",
  "name": "{{gate_name}}",
  "type": "validation",
  "description": "{{description}}",
  "guidance": "**Security Requirements:**\n- Input validation and sanitization\n- No hardcoded secrets or credentials\n- Proper authentication and authorization\n- Secure data handling practices",
  "pass_criteria": [
    {
      "type": "content_check",
      "forbidden_patterns": [
        "password123",
        "admin:admin",
        "apiKey =",
        "secret =",
        "eval(",
        "dangerouslySetInnerHTML"
      ]
    },
    {
      "type": "pattern_check",
      "regex_patterns": [
        "validate.*input",
        "sanitize",
        "escape"
      ]
    }
  ],
  "retry_config": {
    "max_attempts": 3,
    "improvement_hints": true,
    "preserve_context": true
  },
  "activation": {
    "prompt_categories": ["code", "development", "security"],
    "auto_activate": true
  }
}
```

### 4.3 Create Template Manager

**File**: `/server/src/mcp-tools/gate-manager/utils/template-manager.ts`

```typescript
import * as fs from 'fs/promises';
import path from 'path';
import { Logger } from '../../../logging/index.js';
import type { GateCreationRequest } from '../../../gates/types.js';
import type { GateTemplateCustomization } from '../core/types.js';

/**
 * Gate template definition
 */
export interface GateTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  customizableFields: string[];
  defaultValues: Record<string, any>;
  templateFile: string;
}

/**
 * Gate template manager
 */
export class GateTemplateManager {
  private logger: Logger;
  private templatesDirectory: string;
  private templates: GateTemplate[] = [];

  constructor(logger: Logger, templatesDirectory?: string) {
    this.logger = logger;
    this.templatesDirectory = templatesDirectory || path.join(
      process.cwd(),
      'src/gates/templates'
    );
  }

  /**
   * Load all available templates
   */
  async loadTemplates(): Promise<GateTemplate[]> {
    try {
      const files = await fs.readdir(this.templatesDirectory);
      const templateFiles = files.filter(f => f.endsWith('.json'));

      this.templates = [
        {
          id: 'validation-basic',
          name: 'Basic Validation Gate',
          description: 'Simple content validation with min length and pattern matching',
          category: 'validation',
          customizableFields: ['gate_id', 'gate_name', 'description', 'min_length', 'required_patterns', 'forbidden_patterns', 'prompt_categories', 'max_attempts'],
          defaultValues: {
            min_length: 100,
            required_patterns: [],
            forbidden_patterns: [],
            prompt_categories: [],
            max_attempts: 2
          },
          templateFile: 'validation-basic.json'
        },
        {
          id: 'code-quality',
          name: 'Code Quality Gate',
          description: 'Code quality standards and best practices enforcement',
          category: 'quality',
          customizableFields: ['gate_id', 'gate_name', 'description'],
          defaultValues: {},
          templateFile: 'code-quality.json'
        },
        {
          id: 'security-check',
          name: 'Security Validation Gate',
          description: 'Security best practices and vulnerability prevention',
          category: 'security',
          customizableFields: ['gate_id', 'gate_name', 'description'],
          defaultValues: {},
          templateFile: 'security-check.json'
        }
      ];

      this.logger.info(`✅ Loaded ${this.templates.length} gate templates`);
      return this.templates;
    } catch (error) {
      this.logger.error('Failed to load gate templates:', error);
      return [];
    }
  }

  /**
   * Get template by ID
   */
  async getTemplate(templateId: string): Promise<GateTemplate | null> {
    if (this.templates.length === 0) {
      await this.loadTemplates();
    }

    return this.templates.find(t => t.id === templateId) || null;
  }

  /**
   * Customize template with user values
   */
  async customizeTemplate(
    templateId: string,
    customization: GateTemplateCustomization
  ): Promise<GateCreationRequest> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Load template file
    const templatePath = path.join(this.templatesDirectory, template.templateFile);
    const templateContent = await fs.readFile(templatePath, 'utf-8');

    // Simple template variable replacement (Mustache-like)
    let customized = templateContent;

    // Replace placeholders
    customized = customized.replace(/\{\{gate_id\}\}/g, customization.gate_id);
    customized = customized.replace(/\{\{gate_name\}\}/g, customization.gate_name);
    customized = customized.replace(/\{\{description\}\}/g, customization.description);

    if (customization.min_length !== undefined) {
      customized = customized.replace(/\{\{min_length\}\}/g, String(customization.min_length));
    }

    if (customization.required_patterns) {
      customized = customized.replace(
        /"{{required_patterns}}"/g,
        JSON.stringify(customization.required_patterns)
      );
    }

    if (customization.forbidden_patterns) {
      customized = customized.replace(
        /"{{forbidden_patterns}}"/g,
        JSON.stringify(customization.forbidden_patterns)
      );
    }

    if (customization.prompt_categories) {
      customized = customized.replace(
        /"{{prompt_categories}}"/g,
        JSON.stringify(customization.prompt_categories)
      );
    }

    if (customization.max_attempts !== undefined) {
      customized = customized.replace(/\{\{max_attempts\}\}/g, String(customization.max_attempts));
    }

    // Parse and return
    return JSON.parse(customized) as GateCreationRequest;
  }

  /**
   * List all available templates
   */
  async listTemplates(): Promise<GateTemplate[]> {
    if (this.templates.length === 0) {
      await this.loadTemplates();
    }
    return this.templates;
  }
}
```

### 4.4 Integrate Template Manager

Update `/server/src/mcp-tools/gate-manager/core/manager.ts`:

```typescript
// Add import
import { GateTemplateManager } from '../utils/template-manager.js';

// Add to class
private templateManager: GateTemplateManager;

// Initialize in constructor
this.templateManager = new GateTemplateManager(this.logger);

// Implement createFromTemplate
async createFromTemplate(
  templateName: string,
  customization: GateTemplateCustomization
): Promise<ToolResponse> {
  this.logger.info(`[GATE MANAGER] Creating gate from template: ${templateName}`);

  try {
    // Customize template
    const gateDefinition = await this.templateManager.customizeTemplate(
      templateName,
      customization
    );

    // Create gate using customized definition
    return await this.createGate(gateDefinition);
  } catch (error) {
    return createErrorResponse(
      `Failed to create from template: ${error instanceof Error ? error.message : String(error)}`,
      'gate_manager'
    );
  }
}

// Implement listTemplates
async listTemplates(): Promise<ToolResponse> {
  this.logger.info('[GATE MANAGER] Listing templates');

  const templates = await this.templateManager.listTemplates();

  const templateList = templates.map(t =>
    `**${t.name}** (${t.id})\n` +
    `  Category: ${t.category}\n` +
    `  Description: ${t.description}\n` +
    `  Customizable: ${t.customizableFields.join(', ')}\n`
  ).join('\n');

  return createPromptResponse(
    `📄 **Available Gate Templates** (${templates.length}):\n\n${templateList}`,
    'gate_manager'
  );
}
```

### 4.5 Validation Steps

```bash
npm run typecheck
npm run build
```

**Success Criteria:**
- ✅ 3+ templates created (validation-basic, code-quality, security-check)
- ✅ Template manager loads templates successfully
- ✅ Template customization works
- ✅ Integration with gate manager complete

---

## Phase 5: Validation & Safety System

**Estimated Time**: 2-3 hours
**Priority**: Critical (Data Integrity)
**Dependencies**: Phase 2

### Objective

Ensure gate definitions are valid and safe before creating/updating.

### Implementation

Already partially implemented in Phase 2.3 and Phase 3.3.

**Enhancements needed:**

1. **ID Uniqueness Check**: Query registry before creating new gate
2. **Regex Validation**: Test regex patterns in pass_criteria
3. **Retry Loop Detection**: Ensure max_attempts is reasonable (< 10)
4. **Activation Conflict Detection**: Check for conflicting activation rules
5. **Usage Dependency Check**: Verify gate isn't in use before deletion

These enhancements will be added to `GateValidator` class.

---

## Phase 6: MCP Tool Registration

**Estimated Time**: 1-2 hours
**Priority**: Critical (User Interface)
**Dependencies**: Phases 2-5

### Objective

Register gate_manager as the 4th consolidated MCP tool.

### 6.1 Update MCP Tools Index

**File**: `/server/src/mcp-tools/index.ts`

**Changes:**

1. **Import gate manager:**

```typescript
// Add after existing imports (around line 50)
import {
  ConsolidatedGateManager,
  createConsolidatedGateManager,
} from "./gate-manager/index.js";
import { createGateLoader } from "../gates/core/gate-loader.js";
```

2. **Add gate manager instance:**

```typescript
// Add to class properties (around line 80)
private gateManagerTool!: ConsolidatedGateManager;
private gateLoader!: ReturnType<typeof createGateLoader>;
```

3. **Initialize in constructor/initialize:**

```typescript
// In initialize() method (around line 130)
// Initialize gate loader
this.gateLoader = createGateLoader(this.logger);

// Initialize gate manager tool
this.gateManagerTool = createConsolidatedGateManager(
  this.logger,
  this.configManager,
  this.gateLoader,
  this.gateSystemManager!
);
```

4. **Register tool in registerAllTools():**

```typescript
// Add after system_control registration (around line 1090)

// Register gate_manager tool
try {
  const gateManagerDefaults = getDefaultToolDescription("gate_manager");

  const gateManagerDescription =
    this.toolDescriptionManager?.getDescription(
      "gate_manager",
      frameworkEnabled,
      activeMethodology,
      { applyMethodologyOverride: true }
    ) ??
    gateManagerDefaults?.description ??
    "Gate Manager tool for CRUD operations on quality gates";

  this.mcpServer.registerTool(
    "gate_manager",
    {
      title: "Gate Manager",
      description: gateManagerDescription,
      inputSchema: {
        action: z
          .enum([
            "create",
            "update",
            "delete",
            "list",
            "analyze",
            "test",
            "reload",
            "create_from_template",
            "list_templates",
            "usage"
          ])
          .describe("Gate management action"),

        gate_id: z.string().optional()
          .describe("Gate ID for update/delete/analyze operations"),

        definition: z.object({
          id: z.string(),
          name: z.string(),
          type: z.enum(["validation", "quality", "approval", "condition", "guidance"]),
          description: z.string(),
          guidance: z.string(),
          pass_criteria: z.array(z.any()),
          retry_config: z.object({
            max_attempts: z.number(),
            improvement_hints: z.boolean().optional(),
            preserve_context: z.boolean().optional()
          }).optional(),
          activation: z.object({
            prompt_categories: z.array(z.string()).optional(),
            frameworks: z.array(z.string()).optional(),
            auto_activate: z.boolean().optional()
          }).optional()
        }).optional(),

        filters: z.string().optional()
          .describe("Filter expression (e.g., 'category:quality type:validation')"),

        template_name: z.string().optional()
          .describe("Template name for create_from_template"),

        customization: z.object({
          gate_id: z.string(),
          gate_name: z.string(),
          description: z.string(),
          min_length: z.number().optional(),
          required_patterns: z.array(z.string()).optional(),
          forbidden_patterns: z.array(z.string()).optional(),
          prompt_categories: z.array(z.string()).optional(),
          max_attempts: z.number().optional()
        }).optional(),

        test_content: z.string().optional()
          .describe("Content to test gate against")
      }
    },
    async (args: {
      action: 'create' | 'update' | 'delete' | 'list' | 'analyze' |
              'test' | 'reload' | 'create_from_template' | 'list_templates' | 'usage';
      [key: string]: any;
    }) => {
      try {
        const toolResponse = await this.gateManagerTool.handleAction(args, {});
        return {
          content: toolResponse.content,
          isError: toolResponse.isError,
          ...(toolResponse.structuredContent && {
            structuredContent: toolResponse.structuredContent,
          }),
        };
      } catch (error) {
        this.logger.error(
          `gate_manager error: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text",
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );
  this.logger.debug("✅ gate_manager tool registered successfully");
} catch (error) {
  this.logger.error(
    `❌ Failed to register gate_manager tool: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  throw error;
}
```

5. **Update tool count logging:**

```typescript
// Update around line 1100
this.logger.info("🎉 Centralized MCP tools registered successfully!");
this.logger.info("📊 Core Tools: 4 centrally managed tools"); // Changed from 3
this.logger.info(
  "🚀 Active Tools: prompt_engine, prompt_manager, gate_manager, system_control" // Added gate_manager
);
```

### 6.2 Add Default Tool Description

**File**: `/server/src/mcp-tools/tool-description-manager.ts`

Add gate_manager to default descriptions:

```typescript
// Around line 50, add to DEFAULT_TOOL_DESCRIPTIONS
gate_manager: {
  title: "Gate Manager",
  description: "Complete gate lifecycle management with CRUD operations and intelligent filtering. Create, update, delete, and manage quality gates dynamically.",
  parameters: {
    action: "Gate management action: create, update, delete, list, analyze, test, reload, create_from_template, list_templates, usage",
    gate_id: "Gate ID for update/delete/analyze operations",
    definition: "Complete gate definition with validation rules and activation criteria",
    filters: "Filter expression (e.g., 'category:quality type:validation frameworks:CAGEERF')",
    template_name: "Template name for quick gate creation (validation-basic, code-quality, security-check)",
    customization: "Template customization parameters",
    test_content: "Content to test gate validation against"
  }
}
```

### 6.3 Validation Steps

```bash
npm run typecheck
npm run build
npm run start:test

# Test gate_manager registration
node -e "
console.log('Testing gate_manager MCP tool registration...');
// Tool should appear in MCP tool list
"
```

**Success Criteria:**
- ✅ gate_manager tool registered successfully
- ✅ Tool appears in MCP tool list (4 tools total)
- ✅ Zod schema validation works
- ✅ Server starts without errors

---

## Phase 7: Integration & Testing

**Estimated Time**: 3-4 hours
**Priority**: Critical (Quality Assurance)
**Dependencies**: Phases 1-6

### Objective

Connect gate_manager with existing systems and validate all functionality.

### 7.1 Integration Points

**GateSystemManager Integration:**
- ✅ Already integrated via constructor dependencies
- Test enable/disable events affect gate_manager operations

**GateLoader Integration:**
- ✅ Already integrated for loading and caching
- Test hot-reload triggers cache clear
- Test registry reload updates available gates

**Prompt Manager Integration:**
- Extend `analyze_gates` to use gate_manager capabilities
- Add gate suggestions based on prompt content
- Link recommended gates from gate registry

**Framework Manager Integration:**
- Auto-suggest framework-specific gates
- Filter gates by active framework
- Validate framework compatibility in gate activation rules

### 7.2 Testing Strategy

#### Unit Tests

**File**: `/server/tests/unit/gate-manager.test.ts`

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { Logger } from '../../src/logging/index.js';
import { ConsolidatedGateManager } from '../../src/mcp-tools/gate-manager/index.js';

describe('ConsolidatedGateManager', () => {
  let logger: Logger;
  let gateManager: ConsolidatedGateManager;

  beforeEach(() => {
    logger = new Logger({ level: 'error' });
    // Initialize gate manager with mocks
  });

  it('should create a new gate', async () => {
    // Test gate creation
  });

  it('should update an existing gate', async () => {
    // Test gate update
  });

  it('should delete a gate', async () => {
    // Test gate deletion
  });

  it('should list gates with filters', async () => {
    // Test gate listing and filtering
  });
});
```

#### Integration Tests

**File**: `/server/tests/integration/gate-manager-integration.test.ts`

```typescript
import { describe, it, expect } from '@jest/globals';

describe('Gate Manager Integration', () => {
  it('should integrate with GateLoader', async () => {
    // Test gate loading and caching
  });

  it('should integrate with GateSystemManager', async () => {
    // Test runtime state management
  });

  it('should hot-reload gates', async () => {
    // Test hot-reload functionality
  });
});
```

#### Manual Testing Checklist

```markdown
## Gate Manager Manual Testing

### CRUD Operations
- [ ] Create gate via gate_manager
  - [ ] Validate required fields
  - [ ] Check file creation
  - [ ] Verify registry update
- [ ] Update existing gate
  - [ ] Backup created
  - [ ] File updated
  - [ ] Registry synchronized
- [ ] Delete gate
  - [ ] Safety check if in use
  - [ ] Backup created
  - [ ] File and registry updated
- [ ] List gates
  - [ ] No filters
  - [ ] Category filter
  - [ ] Type filter
  - [ ] Complex filters

### Search & Filter
- [ ] Filter by category
- [ ] Filter by type
- [ ] Filter by framework
- [ ] Fuzzy name search
- [ ] Combined filters

### Templates
- [ ] List templates
- [ ] Create from validation-basic template
- [ ] Create from code-quality template
- [ ] Create from security-check template
- [ ] Customize template parameters

### Analysis
- [ ] Analyze gate structure
- [ ] Test gate validation
- [ ] Get gate usage statistics

### Integration
- [ ] Hot-reload gates without restart
- [ ] Gate system enable/disable
- [ ] Integration with prompt_manager
```

### 7.3 Validation Commands

```bash
# Type check
npm run typecheck

# Build
npm run build

# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run all tests
npm run test:ci

# Start server and verify
npm run start:test
```

**Success Criteria:**
- ✅ All TypeScript compilation passes
- ✅ All unit tests pass
- ✅ All integration tests pass
- ✅ Manual testing checklist complete
- ✅ No circular dependencies (`npm run validate:circular`)
- ✅ Server starts successfully

---

## Phase 8: Documentation & Examples

**Estimated Time**: 2 hours
**Priority**: Medium (User Guidance)
**Dependencies**: Phases 1-7

### Objective

Comprehensive documentation for gate_manager usage.

### 8.1 Create Gate Manager Guide

**File**: `/docs/gate-manager-guide.md`

```markdown
# Gate Manager Guide

Complete guide to managing quality gates with the `gate_manager` MCP tool.

## Quick Start

### List Available Gates

```
>>gate_manager action="list"
```

### Create a Gate

```
>>gate_manager action="create" definition={
  "id": "my-custom-gate",
  "name": "My Custom Gate",
  "type": "validation",
  "description": "Custom validation gate",
  "guidance": "Follow these rules...",
  "pass_criteria": [
    {
      "type": "content_check",
      "min_length": 50
    }
  ]
}
```

### Create from Template

```
>>gate_manager action="create_from_template" template_name="validation-basic" customization={
  "gate_id": "quick-validation",
  "gate_name": "Quick Validation",
  "description": "Quick setup validation",
  "min_length": 100
}
```

## Filter Syntax

### Available Filters

- `category:quality` - Filter by category
- `type:validation` - Filter by gate type
- `activation:auto` - Filter by activation mode
- `frameworks:CAGEERF` - Filter by framework
- `search terms` - Fuzzy match on name/description

### Examples

```
>>gate_manager action="list" filters="category:quality type:validation"
>>gate_manager action="list" filters="frameworks:CAGEERF activation:auto"
>>gate_manager action="list" filters="code quality"
```

## Template Usage

### Available Templates

1. **validation-basic** - Simple content validation
2. **code-quality** - Code quality standards
3. **security-check** - Security best practices

### Customization Options

Each template has customizable fields:

- `gate_id` - Unique identifier
- `gate_name` - Display name
- `description` - Gate description
- `min_length` - Minimum content length (validation-basic)
- `required_patterns` - Required text patterns
- `forbidden_patterns` - Forbidden text patterns
- `prompt_categories` - Auto-activation categories
- `max_attempts` - Maximum retry attempts

## Advanced Usage

### Testing Gates

```
>>gate_manager action="test" gate_id="code-quality" test_content="function test() { ... }"
```

### Analyzing Gates

```
>>gate_manager action="analyze" gate_id="code-quality"
```

### Usage Statistics

```
>>gate_manager action="usage" gate_id="code-quality"
```

### Hot-Reload

```
>>gate_manager action="reload"
```
```

### 8.2 Create Usage Examples

**File**: `/docs/examples/gate-manager-examples.md`

```markdown
# Gate Manager Examples

## Example 1: Custom Content Validation

Create a gate that validates blog post content:

```
>>gate_manager action="create" definition={
  "id": "blog-post-validation",
  "name": "Blog Post Quality Gate",
  "type": "validation",
  "description": "Ensures blog posts meet quality standards",
  "guidance": "**Blog Post Requirements:**\n- Minimum 500 words\n- Include introduction and conclusion\n- No placeholder text",
  "pass_criteria": [
    {
      "type": "content_check",
      "min_length": 500,
      "required_patterns": ["introduction", "conclusion"],
      "forbidden_patterns": ["lorem ipsum", "TODO", "placeholder"]
    }
  ],
  "retry_config": {
    "max_attempts": 3,
    "improvement_hints": true
  },
  "activation": {
    "prompt_categories": ["content", "writing"],
    "auto_activate": true
  }
}
```

## Example 2: Framework-Specific Gate

Create a gate that only activates for CAGEERF framework:

```
>>gate_manager action="create_from_template"
  template_name="validation-basic"
  customization={
    "gate_id": "cageerf-compliance",
    "gate_name": "CAGEERF Methodology Compliance",
    "description": "Validates adherence to CAGEERF methodology phases",
    "min_length": 200,
    "required_patterns": ["Context", "Analysis", "Goals", "Execution"],
    "forbidden_patterns": [],
    "prompt_categories": [],
    "frameworks": ["CAGEERF"],
    "max_attempts": 2
  }
```

## Example 3: Security Gate for Code

```
>>gate_manager action="create_from_template"
  template_name="security-check"
  customization={
    "gate_id": "api-security",
    "gate_name": "API Security Gate",
    "description": "Security validation for API code"
  }
```

## Example 4: Finding Specific Gates

Find all quality gates:
```
>>gate_manager action="list" filters="category:quality"
```

Find gates for code development:
```
>>gate_manager action="list" filters="type:validation code"
```

Find framework-specific gates:
```
>>gate_manager action="list" filters="frameworks:CAGEERF"
```
```

### 8.3 Update Main Documentation

**File**: `/CLAUDE.md` (update around line 50)

```markdown
## Available MCP Tools

The server exposes 4 consolidated MCP tools:

- **prompt_engine** - Execute prompts with intelligent analysis and semantic detection
- **prompt_manager** - Create, update, delete, and manage prompts with smart filtering
- **gate_manager** - Create, update, delete, and manage quality gates (**NEW**)
- **system_control** - Framework switching, analytics, and system management

### gate_manager Actions

- `create` - Create a new gate
- `update` - Update existing gate
- `delete` - Delete a gate (with safety checks)
- `list` - List gates with optional filters
- `analyze` - Analyze gate structure and usage
- `test` - Test gate validation with sample content
- `reload` - Hot-reload all gates
- `create_from_template` - Create from built-in template
- `list_templates` - List available templates
- `usage` - Get gate usage statistics
```

### 8.4 Validation

```bash
# Check documentation renders correctly
cat docs/gate-manager-guide.md
cat docs/examples/gate-manager-examples.md
```

**Success Criteria:**
- ✅ Gate manager guide created
- ✅ Usage examples documented
- ✅ Main documentation updated
- ✅ All examples tested and working

---

## Migration Strategy & Backward Compatibility

### Zero-Breaking-Changes Guarantee

**Existing gates continue working exactly as before:**

1. **File-Based Loading**: GateLoader still loads gates from JSON files
2. **Registry Optional**: If gatesConfig.json doesn't exist, falls back to file discovery
3. **No Schema Changes**: Gate definition structure unchanged
4. **Hot-Reload Preserved**: Existing hot-reload functionality maintained

### Migration Path

**Phase 1-3: Foundation** (No user impact)
- Registry created but optional
- GateLoader enhanced with registry support
- Existing file-based loading unchanged

**Phase 4-6: New Features** (Opt-in)
- gate_manager tool available
- Users can start managing gates dynamically
- Existing workflows continue unchanged

**Phase 7-8: Full Integration** (Seamless)
- Registry automatically populated
- Hot-reload enhanced
- Analytics integrated
- Users experience no disruption

### Rollback Strategy

If critical issues arise:

1. **Disable gate_manager**: Remove tool registration
2. **Revert GateLoader**: Remove registry support
3. **Delete registry files**: Remove gatesConfig.json and categories.json
4. **Existing gates**: Continue working from JSON files

No data loss possible - all gate definitions remain in JSON files.

---

## Success Criteria & Validation

### Functional Requirements ✅

- ✅ Create gates via gate_manager MCP tool
- ✅ Update existing gate definitions
- ✅ Delete gates with safety checks (usage validation)
- ✅ Search/filter gates with complex queries
- ✅ Create gates from templates (3+ templates)
- ✅ Test gates before deployment
- ✅ Analyze gate usage patterns

### Non-Functional Requirements ✅

- ✅ Hot-reload gates without server restart
- ✅ 100% backward compatible with existing gates
- ✅ Response time < 500ms for all operations
- ✅ Clear validation errors with actionable messages
- ✅ No data loss on failed operations (backup system)

### Quality Gates ✅

- ✅ All TypeScript compilation passes (`npm run typecheck`)
- ✅ All tests pass (`npm run test:ci`)
- ✅ No circular dependencies (`npm run validate:circular`)
- ✅ MCP protocol compliance maintained
- ✅ Performance budget met (<500ms response time)

### Integration Validation ✅

- ✅ GateLoader integration works
- ✅ GateSystemManager integration works
- ✅ Hot-reload triggers correctly
- ✅ Registry synchronization maintains consistency

---

## Implementation Timeline

| Phase | Time | Priority | Dependencies |
|-------|------|----------|--------------|
| Phase 1: Registry System | 2-3h | Critical | None |
| Phase 2: Core Manager | 4-5h | Critical | Phase 1 |
| Phase 3: Search/Filter | 3-4h | High | Phase 2 |
| Phase 4: Templates | 2-3h | High | Phase 2 |
| Phase 5: Validation | 2-3h | Critical | Phase 2 |
| Phase 6: MCP Registration | 1-2h | Critical | Phases 2-5 |
| Phase 7: Integration & Testing | 3-4h | Critical | Phases 1-6 |
| Phase 8: Documentation | 2h | Medium | Phases 1-7 |

**Total Estimated Time**: 20-25 hours

**Recommended Implementation Order**:
1 → 2 → 5 → 3 → 4 → 6 → 7 → 8

---

## Risk Mitigation

### Identified Risks

1. **Registry Sync Issues**
   - **Risk**: Registry and file definitions get out of sync
   - **Mitigation**: Atomic writes, file system locking, backup before changes
   - **Rollback**: Delete registry, use file-based loading

2. **Hot-Reload Race Conditions**
   - **Risk**: Multiple hot-reloads triggered simultaneously
   - **Mitigation**: Event-driven updates with debouncing
   - **Monitoring**: Log all reload events with timestamps

3. **Breaking Existing Gates**
   - **Risk**: Updates break gate validation
   - **Mitigation**: Validation before write, backup system, rollback capability
   - **Testing**: Comprehensive test suite with existing gates

4. **Performance Impact**
   - **Risk**: Registry loading slows down server startup
   - **Mitigation**: Lazy loading, caching, parallel loading
   - **Monitoring**: Track load times, set performance budgets

### Mitigation Strategies

**Data Integrity:**
- Backup before all destructive operations
- Atomic writes with temporary files
- Validation before file writes
- Rollback capability on errors

**Performance:**
- Cache registry in memory
- Lazy load gate definitions
- Parallel file operations where possible
- Performance budgets enforced

**User Experience:**
- Clear error messages with suggestions
- Validation feedback before operations
- Progress indicators for long operations
- Comprehensive documentation

---

## Next Steps

### Immediate Actions

1. **Review & Approve**: Stakeholder review of this roadmap
2. **Environment Setup**: Ensure development environment ready
3. **Baseline Metrics**: Capture current system performance
4. **Test Data**: Prepare test gates for validation

### Implementation Sequence

**Week 1:**
- Phase 1: Registry System (2-3h)
- Phase 2: Core Manager (4-5h)
- Phase 5: Validation (2-3h)

**Week 2:**
- Phase 3: Search/Filter (3-4h)
- Phase 4: Templates (2-3h)
- Phase 6: MCP Registration (1-2h)

**Week 3:**
- Phase 7: Integration & Testing (3-4h)
- Phase 8: Documentation (2h)
- Final validation and deployment

### Post-Implementation

- Monitor usage patterns
- Gather user feedback
- Performance optimization
- Feature enhancements based on usage

---

## Appendix

### File Checklist

**New Files to Create:**

Registry & Configuration:
- [ ] `/server/src/gates/gatesConfig.json`
- [ ] `/server/src/gates/categories.json`

Gate Manager Core:
- [ ] `/server/src/mcp-tools/gate-manager/index.ts`
- [ ] `/server/src/mcp-tools/gate-manager/core/index.ts`
- [ ] `/server/src/mcp-tools/gate-manager/core/manager.ts`
- [ ] `/server/src/mcp-tools/gate-manager/core/types.ts`

Operations:
- [ ] `/server/src/mcp-tools/gate-manager/operations/gate-file-operations.ts`

Search:
- [ ] `/server/src/mcp-tools/gate-manager/search/gate-filter-parser.ts`
- [ ] `/server/src/mcp-tools/gate-manager/search/gate-matcher.ts`

Analysis:
- [ ] `/server/src/mcp-tools/gate-manager/analysis/index.ts`

Utils:
- [ ] `/server/src/mcp-tools/gate-manager/utils/gate-validation.ts`
- [ ] `/server/src/mcp-tools/gate-manager/utils/category-manager.ts`
- [ ] `/server/src/mcp-tools/gate-manager/utils/template-manager.ts`

Templates:
- [ ] `/server/src/gates/templates/validation-basic.json`
- [ ] `/server/src/gates/templates/code-quality.json`
- [ ] `/server/src/gates/templates/security-check.json`

Tests:
- [ ] `/server/tests/unit/gate-manager.test.ts`
- [ ] `/server/tests/integration/gate-manager-integration.test.ts`

Documentation:
- [ ] `/docs/gate-manager-guide.md`
- [ ] `/docs/examples/gate-manager-examples.md`

**Files to Update:**

- [ ] `/server/src/gates/core/gate-loader.ts` - Add registry support
- [ ] `/server/src/gates/types.ts` - Add new type definitions
- [ ] `/server/src/mcp-tools/index.ts` - Register gate_manager tool
- [ ] `/server/src/mcp-tools/tool-description-manager.ts` - Add descriptions
- [ ] `/CLAUDE.md` - Update documentation

### Command Reference

```bash
# Development
npm run typecheck          # TypeScript validation
npm run build             # Compile TypeScript
npm run dev               # Watch mode development

# Testing
npm run test:unit         # Unit tests
npm run test:integration  # Integration tests
npm run test:ci           # All tests
npm run validate:circular # Check circular dependencies

# Server Operations
npm run start:test        # Test mode
npm run start:verbose     # Verbose logging
npm run start:quiet       # Production mode
```

---

**Document Version**: 1.0
**Last Updated**: 2025-01-23
**Status**: Ready for Implementation
