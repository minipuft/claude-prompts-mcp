# SQLite Storage Layer - Comprehensive Implementation Plan

**Created**: 2025-01-19
**Status**: Planning
**Priority**: High - Foundation for User Data Management & Versioning
**Impact**: Enables change history, user data separation, scalable storage, no-fork user experience

## Executive Summary

**Strategic Goal**: Migrate from JSON file-based storage to SQLite database with versioning capabilities, while maintaining backwards compatibility and enabling user data separation from the server codebase.

**Core Requirements**:
- **Change history** - Track all modifications with rollback capability
- **User data separation** - User prompts/gates/frameworks stored in `~/.claude-prompts-mcp/` not in repo
- **Modification workflow** - Enhanced MCP tool integration for seamless CRUD operations
- **Scale to hundreds** - Handle 100-500 items efficiently
- **Profile support** - Built-in foundation for work/life/code separation (UI comes later)
- **Git-optional** - Users don't need to fork repo, but can export to JSON for Git backup
- **Zero breaking changes** - Gradual migration with adapter pattern

**Key Principle**: This is a **storage layer enhancement**, not a database system. Users never interact with SQL directly - all operations through existing MCP tools (`prompt_manager`, `system_control`).

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Architecture Design](#architecture-design)
3. [Storage Abstraction Layer](#storage-abstraction-layer)
4. [SQLite Schema Design](#sqlite-schema-design)
   - [Profile Support Architecture](#profile-support-architecture)
5. [Migration Strategy](#migration-strategy)
6. [User Data Separation](#user-data-separation)
7. [Versioning & History System](#versioning--history-system)
8. [MCP Tool Integration](#mcp-tool-integration)
9. [Implementation Phases](#implementation-phases)
10. [Testing Strategy](#testing-strategy)
11. [Rollback & Recovery](#rollback--recovery)
12. [Performance Considerations](#performance-considerations)
13. [Future Enhancements](#future-enhancements)
    - [Profile Management Features (Phase 6+)](#profile-management-features-phase-6)

---

## Current State Analysis

### Existing Storage System

**Current Architecture**:
```
server/prompts/
├── promptsConfig.json          # Main configuration
├── category-name/
│   ├── prompts.json            # Category prompt registry
│   ├── prompt-1.md             # Individual prompt files
│   └── prompt-2.md
└── another-category/
    └── ...

Storage Mechanism:
- JSON files for metadata and registry
- Markdown files for prompt content
- Hot-reload via file watching
- Git version control for server defaults
```

**Current Statistics** (measured):
- **Files**: 48 total (JSON + Markdown)
- **Storage**: 300KB total
- **Categories**: 18 categories
- **Scale**: Dozens of items (appropriate for file-based)

**Pain Points Identified**:
1. **No change history** - Can't see previous versions or rollback changes
2. **Modification workflow** - Manual JSON editing required (though MCP tools help)
3. **User data in repo** - Users need to fork to customize, or modify in-place
4. **Limited querying** - File-based filtering is basic
5. **No audit trail** - Can't track who changed what and why
6. **No profile separation** - At 500+ items, need work/life/code separation (future concern)

### Framework & Gates Current Storage

**Frameworks**:
```typescript
// Location: server/src/frameworks/framework-manager.ts
// Storage: In-memory Map<string, FrameworkDefinition>
// Source: Generated from methodology guides (code-based)
// Future need: User-customizable frameworks stored persistently
```

**Gates**:
```typescript
// Location: server/src/gates/core/gate-loader.ts
// Storage: YAML/JSON files in server/src/gates/definitions/
// Caching: In-memory Map with file watching
// Future need: User-defined gates with versioning
```

### What Works Well (Keep)

1. **Hot-reload system** - File watching works great for development
2. **MCP tool interface** - `prompt_manager` provides good CRUD interface
3. **Category organization** - Logical grouping system is solid
4. **Markdown content** - Human-readable, easy to edit
5. **Git integration** - Works well for server defaults

### What Needs Enhancement

1. **Storage backend** - Add SQLite for versioning and querying
2. **User data location** - Move to `~/.claude-prompts-mcp/` for user customizations
3. **History tracking** - Automatic versioning on every change
4. **Migration path** - Smooth transition from JSON to SQLite
5. **Backup system** - Automatic backups before modifications

---

## Architecture Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Tools Layer                          │
│  (prompt_manager, system_control - User Interface)          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               Storage Abstraction Layer                      │
│                  (IStorageAdapter)                           │
└─────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌──────────────────────┐    ┌──────────────────────────┐
│  JSONStorageAdapter  │    │  SQLiteStorageAdapter    │
│  (Legacy/Defaults)   │    │  (User Data/History)     │
└──────────────────────┘    └──────────────────────────┘
          │                              │
          ▼                              ▼
┌──────────────────────┐    ┌──────────────────────────┐
│   JSON Files         │    │   SQLite Database        │
│   /server/defaults/  │    │   ~/.claude-prompts-mcp/ │
└──────────────────────┘    └──────────────────────────┘
```

### Directory Structure (Post-Migration)

```
Server Installation:
/server/
├── src/
│   ├── storage/                    # NEW: Storage layer
│   │   ├── interfaces/
│   │   │   └── IStorageAdapter.ts  # Storage interface
│   │   ├── adapters/
│   │   │   ├── json-adapter.ts     # JSON implementation
│   │   │   └── sqlite-adapter.ts   # SQLite implementation
│   │   ├── migrations/
│   │   │   ├── json-to-sqlite.ts   # Migration utilities
│   │   │   └── schema-versions.ts  # Schema versioning
│   │   ├── versioning/
│   │   │   ├── history-manager.ts  # Change history
│   │   │   └── backup-manager.ts   # Automatic backups
│   │   └── index.ts
│   └── ...
├── defaults/                        # MOVED: Server default prompts
│   ├── prompts/
│   │   ├── analysis/
│   │   ├── development/
│   │   └── ...
│   ├── gates/
│   └── frameworks/
└── prompts/                         # KEPT: Legacy location (symlink to defaults)

User Environment:
~/.claude-prompts-mcp/
├── storage.db                       # SQLite database (all entities)
├── config.json                      # User preferences
├── backups/                         # Automatic backups
│   ├── storage-2025-01-19-143020.db
│   └── storage-2025-01-18-091533.db
└── exports/                         # Optional JSON exports
    └── prompts-export-2025-01-19.json
```

### Hybrid Storage Strategy

**Two-Tier Storage System**:

1. **Server Defaults** (JSON in Git)
   - Location: `/server/defaults/`
   - Format: JSON + Markdown (current structure)
   - Purpose: Shipped defaults, tracked in Git
   - Loaded: On server startup, imported to user DB if missing
   - Modification: Via Git commits, server updates

2. **User Data** (SQLite in Home Directory)
   - Location: `~/.claude-prompts-mcp/storage.db`
   - Format: SQLite with full versioning
   - Purpose: User customizations, overrides, new items
   - Loaded: Hot-reload from database
   - Modification: Via MCP tools with automatic history

**Resolution Order**:
```
User requests prompt "analyze_code"
  → Check user database first (customizations)
  → If not found, check server defaults
  → Merge defaults with user overrides
```

---

## Storage Abstraction Layer

### Interface Design

```typescript
// server/src/storage/interfaces/IStorageAdapter.ts

export interface IStorageAdapter {
  // ==================== LIFECYCLE ====================
  initialize(): Promise<void>;
  close(): Promise<void>;
  health(): Promise<StorageHealthStatus>;

  // ==================== PROMPTS ====================
  // Basic CRUD
  getPrompt(id: string): Promise<PromptData | null>;
  savePrompt(prompt: PromptData, reason?: string): Promise<void>;
  updatePrompt(id: string, updates: Partial<PromptData>, reason?: string): Promise<void>;
  deletePrompt(id: string, reason?: string): Promise<void>;
  listPrompts(filter?: FilterOptions): Promise<PromptData[]>;

  // Versioning
  getPromptHistory(id: string): Promise<PromptVersion[]>;
  getPromptVersion(id: string, version: number): Promise<PromptData | null>;
  rollbackPrompt(id: string, version: number): Promise<void>;

  // ==================== FRAMEWORKS ====================
  // Future: When framework dynamic creation is implemented
  getFramework(id: string): Promise<FrameworkDefinition | null>;
  saveFramework(framework: FrameworkDefinition, reason?: string): Promise<void>;
  listFrameworks(): Promise<FrameworkDefinition[]>;
  getFrameworkHistory(id: string): Promise<FrameworkVersion[]>;

  // ==================== GATES ====================
  // Future: When gate dynamic creation is implemented
  getGate(id: string): Promise<GateDefinition | null>;
  saveGate(gate: GateDefinition, reason?: string): Promise<void>;
  listGates(): Promise<GateDefinition[]>;
  getGateHistory(id: string): Promise<GateVersion[]>;

  // ==================== UTILITIES ====================
  // Backup & Export
  backup(reason?: string): Promise<string>; // Returns backup file path
  exportToJSON(path: string): Promise<void>;
  importFromJSON(path: string): Promise<ImportResult>;

  // Statistics
  getStats(): Promise<StorageStats>;

  // Search & Query
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

// Supporting Types
export interface StorageHealthStatus {
  healthy: boolean;
  storageType: 'json' | 'sqlite';
  location: string;
  size: number;
  itemCount: number;
  lastBackup?: number;
  errors?: string[];
}

export interface PromptVersion {
  version: number;
  prompt: PromptData;
  changedAt: number;
  changeReason?: string;
  changedBy?: string; // Future: multi-user support
}

export interface FilterOptions {
  category?: string;
  type?: 'prompt' | 'template' | 'chain' | 'workflow';
  tags?: string[];
  searchText?: string;
  createdAfter?: number;
  updatedAfter?: number;
  limit?: number;
  offset?: number;
}

export interface StorageStats {
  totalPrompts: number;
  totalFrameworks: number;
  totalGates: number;
  totalVersions: number;
  storageSize: number;
  oldestItem: number;
  newestItem: number;
  categories: { [key: string]: number };
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: Array<{ item: string; error: string }>;
}
```

### Adapter Factory Pattern

```typescript
// server/src/storage/index.ts

import { IStorageAdapter } from './interfaces/IStorageAdapter.js';
import { JSONStorageAdapter } from './adapters/json-adapter.js';
import { SQLiteStorageAdapter } from './adapters/sqlite-adapter.js';
import { Logger } from '../logging/index.js';

export class StorageFactory {
  static async createAdapter(
    config: StorageConfig,
    logger: Logger
  ): Promise<IStorageAdapter> {
    const storageType = config.type || 'sqlite'; // Default to SQLite

    switch (storageType) {
      case 'json':
        logger.info('Initializing JSON storage adapter (legacy mode)');
        return new JSONStorageAdapter(config.jsonPath, logger);

      case 'sqlite':
        logger.info('Initializing SQLite storage adapter');
        const sqliteAdapter = new SQLiteStorageAdapter(
          config.sqlitePath || '~/.claude-prompts-mcp/storage.db',
          logger
        );

        // Load server defaults on first run
        if (config.defaultsPath && await sqliteAdapter.isEmpty()) {
          logger.info('First run detected, importing server defaults');
          await this.importDefaults(sqliteAdapter, config.defaultsPath);
        }

        return sqliteAdapter;

      default:
        throw new Error(`Unknown storage type: ${storageType}`);
    }
  }

  private static async importDefaults(
    adapter: IStorageAdapter,
    defaultsPath: string
  ): Promise<void> {
    // Import server defaults from JSON files
    const jsonAdapter = new JSONStorageAdapter(defaultsPath);
    await jsonAdapter.initialize();

    const prompts = await jsonAdapter.listPrompts();
    for (const prompt of prompts) {
      await adapter.savePrompt(prompt, 'Imported from server defaults');
    }
  }
}

export interface StorageConfig {
  type: 'json' | 'sqlite';
  jsonPath?: string;      // For JSON adapter
  sqlitePath?: string;    // For SQLite adapter
  defaultsPath?: string;  // Server defaults location
}
```

---

## SQLite Schema Design

### Database Schema

```sql
-- ==================== CORE TABLES ====================

-- Prompts table (current state)
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  content TEXT NOT NULL,           -- Full prompt content (markdown)
  content_type TEXT DEFAULT 'markdown',  -- 'markdown' | 'nunjucks'

  -- Metadata
  metadata TEXT,                   -- JSON: { arguments, systemMessage, tags, etc. }

  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,     -- Unix timestamp
  updated_at INTEGER NOT NULL,     -- Unix timestamp

  -- Source tracking
  source TEXT DEFAULT 'user',      -- 'user' | 'server_default' | 'imported'
  is_default BOOLEAN DEFAULT 0,    -- From server defaults?

  -- Status
  deleted BOOLEAN DEFAULT 0,       -- Soft delete
  deleted_at INTEGER
);

-- Prompt history (all versions)
CREATE TABLE prompt_history (
  prompt_id TEXT NOT NULL,
  version INTEGER NOT NULL,

  -- Snapshot of prompt at this version
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  content TEXT NOT NULL,
  metadata TEXT,

  -- Change tracking
  changed_at INTEGER NOT NULL,
  change_reason TEXT,
  previous_version INTEGER,

  PRIMARY KEY (prompt_id, version),
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
);

-- Frameworks table (future)
CREATE TABLE frameworks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  methodology TEXT NOT NULL,       -- JSON: Full methodology guide

  -- Metadata
  metadata TEXT,

  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- Source tracking
  source TEXT DEFAULT 'user',
  is_default BOOLEAN DEFAULT 0,

  -- Status
  deleted BOOLEAN DEFAULT 0,
  deleted_at INTEGER
);

-- Framework history
CREATE TABLE framework_history (
  framework_id TEXT NOT NULL,
  version INTEGER NOT NULL,

  name TEXT NOT NULL,
  description TEXT,
  methodology TEXT NOT NULL,
  metadata TEXT,

  changed_at INTEGER NOT NULL,
  change_reason TEXT,
  previous_version INTEGER,

  PRIMARY KEY (framework_id, version),
  FOREIGN KEY (framework_id) REFERENCES frameworks(id) ON DELETE CASCADE
);

-- Gates table (future)
CREATE TABLE gates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  gate_type TEXT NOT NULL,         -- 'validation' | 'quality' | 'approval' | 'condition'
  definition TEXT NOT NULL,        -- JSON: Full gate definition

  -- Metadata
  metadata TEXT,

  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- Source tracking
  source TEXT DEFAULT 'user',
  is_default BOOLEAN DEFAULT 0,

  -- Status
  deleted BOOLEAN DEFAULT 0,
  deleted_at INTEGER
);

-- Gate history
CREATE TABLE gate_history (
  gate_id TEXT NOT NULL,
  version INTEGER NOT NULL,

  name TEXT NOT NULL,
  description TEXT,
  gate_type TEXT NOT NULL,
  definition TEXT NOT NULL,
  metadata TEXT,

  changed_at INTEGER NOT NULL,
  change_reason TEXT,
  previous_version INTEGER,

  PRIMARY KEY (gate_id, version),
  FOREIGN KEY (gate_id) REFERENCES gates(id) ON DELETE CASCADE
);

-- ==================== INDEXES ====================

-- Prompts indexes
CREATE INDEX idx_prompts_category ON prompts(category);
CREATE INDEX idx_prompts_updated ON prompts(updated_at);
CREATE INDEX idx_prompts_source ON prompts(source);
CREATE INDEX idx_prompts_deleted ON prompts(deleted);
CREATE INDEX idx_prompts_name ON prompts(name);

-- History indexes
CREATE INDEX idx_prompt_history_changed ON prompt_history(changed_at);
CREATE INDEX idx_prompt_history_prompt ON prompt_history(prompt_id);

-- Frameworks indexes
CREATE INDEX idx_frameworks_updated ON frameworks(updated_at);
CREATE INDEX idx_frameworks_source ON frameworks(source);
CREATE INDEX idx_frameworks_deleted ON frameworks(deleted);

-- Gates indexes
CREATE INDEX idx_gates_type ON gates(gate_type);
CREATE INDEX idx_gates_updated ON gates(updated_at);
CREATE INDEX idx_gates_source ON gates(source);
CREATE INDEX idx_gates_deleted ON gates(deleted);

-- ==================== TRIGGERS ====================

-- Automatic history archiving on update
CREATE TRIGGER archive_prompt_on_update
AFTER UPDATE ON prompts
WHEN NEW.version > OLD.version
BEGIN
  INSERT INTO prompt_history (
    prompt_id, version, name, description, category,
    content, metadata, changed_at, change_reason, previous_version
  ) VALUES (
    OLD.id, OLD.version, OLD.name, OLD.description, OLD.category,
    OLD.content, OLD.metadata, NEW.updated_at,
    'Automatic archive on update', OLD.version
  );
END;

-- Update timestamp trigger
CREATE TRIGGER update_prompt_timestamp
AFTER UPDATE ON prompts
BEGIN
  UPDATE prompts SET updated_at = strftime('%s', 'now') * 1000
  WHERE id = NEW.id;
END;

-- Similar triggers for frameworks and gates (future)
```

### Schema Versioning

```sql
-- Schema version tracking
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

-- Initial version
INSERT INTO schema_version (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial schema with prompts, frameworks, gates and profile support');
```

### Profile Support Architecture

**Design Decision**: Build profile support into schema from day one, enable UI features later.

**Rationale**: At 500+ items, users need work/life/code separation. Adding profiles later requires painful schema migration. Adding now costs +1 day but avoids future migration and enables seamless profile features when needed.

**Strategy**: Single database with `profile_id` column, not separate database files.

#### Enhanced Schema with Profiles

```sql
-- ==================== PROFILES MANAGEMENT ====================

-- Profiles table
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,                          -- Optional: emoji like 💼, 🏠, 💻
  color TEXT,                         -- Optional: hex color for UI

  settings TEXT,                      -- JSON: Profile-specific settings

  is_default BOOLEAN DEFAULT 0,
  is_active BOOLEAN DEFAULT 1,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);

-- Active profile tracking (single row table)
CREATE TABLE active_profile (
  id INTEGER PRIMARY KEY DEFAULT 1,
  profile_id TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id),
  CHECK (id = 1)
);

-- Profile-aware prompts (enhanced)
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',  -- NEW: Profile association
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  content TEXT NOT NULL,
  content_type TEXT DEFAULT 'markdown',
  metadata TEXT,

  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  source TEXT DEFAULT 'user',
  is_default BOOLEAN DEFAULT 0,
  original_profile_id TEXT,           -- NEW: If shared from another profile

  deleted BOOLEAN DEFAULT 0,
  deleted_at INTEGER,

  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Enhanced indexes for profile-aware queries
CREATE INDEX idx_prompts_profile ON prompts(profile_id);
CREATE INDEX idx_prompts_profile_category ON prompts(profile_id, category);
CREATE INDEX idx_prompts_profile_deleted ON prompts(profile_id, deleted);

-- Profile-aware history
CREATE INDEX idx_prompt_history_profile ON prompt_history(profile_id);

-- Initial default profile
INSERT INTO profiles (id, name, description, is_default, is_active, created_at, updated_at, last_used_at)
VALUES (
  'default',
  'Default',
  'Default profile for all prompts',
  1,
  1,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);

INSERT INTO active_profile (profile_id, changed_at)
VALUES ('default', strftime('%s', 'now') * 1000);
```

#### Profile-Aware Adapter Implementation

**Phase 1 Implementation** (default profile only):
```typescript
export class SQLiteStorageAdapter implements IStorageAdapter {
  private activeProfileId: string = 'default';

  async initialize(): Promise<void> {
    this.initializeSchema(); // Creates profiles table + default profile
    this.activeProfileId = await this.loadActiveProfile(); // 'default'
  }

  async getPrompt(id: string): Promise<PromptData | null> {
    // Automatically scoped to active profile
    const row = this.db.prepare(`
      SELECT * FROM prompts
      WHERE id = ? AND profile_id = ? AND deleted = 0
    `).get(id, this.activeProfileId);

    return row ? this.rowToPromptData(row) : null;
  }

  async savePrompt(prompt: PromptData, reason?: string): Promise<void> {
    // Automatically associates with active profile
    this.db.prepare(`
      INSERT INTO prompts (
        id, profile_id, name, description, category, content, metadata,
        version, created_at, updated_at, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      prompt.id,
      this.activeProfileId,  // Always 'default' in Phase 1
      prompt.name,
      // ... other fields
    );
  }
}
```

**User Experience in Phase 1**:
- Single "default" profile created automatically
- All queries scoped to default profile (invisible to users)
- Zero complexity, works exactly like no profiles
- Foundation ready for future profile features

**Server Defaults Handling**:
- Server defaults marked with `is_default = 1`
- Accessible from all profiles via SQL view or query filter
- Not duplicated across profiles (efficient)

```sql
-- View: Prompts for active profile + shared defaults
CREATE VIEW profile_prompts_with_defaults AS
SELECT p.*
FROM prompts p
WHERE p.profile_id = (SELECT profile_id FROM active_profile WHERE id = 1)
   OR p.is_default = 1;
```

#### Future Profile Features (Phase 6+)

**MCP Tool Commands** (deferred until needed):
```bash
# Create profiles
>>system_control action="create_profile" profile='{"id":"work","name":"Work Projects","icon":"💼"}'

# List profiles
>>system_control action="list_profiles"
# Output: 💼 Work (127 prompts, active) | 🏠 Life (43 prompts) | 💻 Code (89 prompts)

# Switch profiles
>>system_control action="switch_profile" profile_id="work"

# Cross-profile operations
>>prompt_manager action="copy_to_profile" id="analyze_code" target_profile="work"
>>prompt_manager action="share_prompt" id="research_template" profiles='["work","code"]'
```

**Cost-Benefit**:
- **Cost Now**: +1 day to Phase 1 (add profile tables, scoped queries)
- **Cost Later**: 0 days (no migration needed)
- **Benefit**: Seamless profile features when users hit 500+ items
- **Risk**: None (hidden from users, default profile only)

---

## Migration Strategy

### Phase 1: Storage Abstraction Layer (Non-Breaking)

**Goal**: Introduce adapter pattern without changing storage backend

**Implementation**:

1. **Create interface and JSON adapter**:
```typescript
// server/src/storage/adapters/json-adapter.ts
export class JSONStorageAdapter implements IStorageAdapter {
  // Wraps existing file-based system
  // No changes to actual storage
  // Just provides IStorageAdapter interface
}
```

2. **Update existing code to use adapter**:
```typescript
// server/src/prompts/loader.ts
// BEFORE:
const prompts = await loadPromptsFromJSON(configPath);

// AFTER:
const storage = await StorageFactory.createAdapter(config, logger);
const prompts = await storage.listPrompts();
```

3. **Update MCP tools**:
```typescript
// server/src/mcp-tools/prompt-manager.ts
// Replace direct file operations with storage adapter calls
const prompt = await storage.getPrompt(id);
await storage.savePrompt(updatedPrompt);
```

**Testing**:
- All existing tests should pass
- No user-visible changes
- Storage still JSON files

**Duration**: 2-3 days

---

### Phase 2: SQLite Adapter Implementation

**Goal**: Implement SQLite adapter with feature parity

**Implementation**:

1. **SQLite adapter skeleton**:
```typescript
// server/src/storage/adapters/sqlite-adapter.ts
import Database from 'better-sqlite3';

export class SQLiteStorageAdapter implements IStorageAdapter {
  private db: Database.Database;

  constructor(dbPath: string, logger: Logger) {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Execute schema.sql
  }

  async getPrompt(id: string): Promise<PromptData | null> {
    const row = this.db.prepare(
      'SELECT * FROM prompts WHERE id = ? AND deleted = 0'
    ).get(id);

    return row ? this.rowToPromptData(row) : null;
  }

  async savePrompt(prompt: PromptData, reason?: string): Promise<void> {
    const exists = this.db.prepare(
      'SELECT id FROM prompts WHERE id = ?'
    ).get(prompt.id);

    if (exists) {
      await this.updatePrompt(prompt.id, prompt, reason);
    } else {
      this.insertPrompt(prompt, reason);
    }
  }

  private insertPrompt(prompt: PromptData, reason?: string): void {
    this.db.prepare(`
      INSERT INTO prompts (
        id, name, description, category, content, metadata,
        version, created_at, updated_at, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      prompt.id,
      prompt.name,
      prompt.description,
      prompt.category,
      prompt.content,
      JSON.stringify(prompt.metadata),
      1,
      Date.now(),
      Date.now(),
      'user'
    );
  }

  async updatePrompt(
    id: string,
    updates: Partial<PromptData>,
    reason?: string
  ): Promise<void> {
    // Archive current version first (manual, trigger handles auto)
    const current = await this.getPrompt(id);
    if (!current) throw new Error(`Prompt not found: ${id}`);

    this.db.prepare(`
      INSERT INTO prompt_history (
        prompt_id, version, name, description, category,
        content, metadata, changed_at, change_reason
      ) SELECT
        id, version, name, description, category,
        content, metadata, ?, ?
      FROM prompts WHERE id = ?
    `).run(Date.now(), reason || 'Update', id);

    // Update with incremented version
    this.db.prepare(`
      UPDATE prompts SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        category = COALESCE(?, category),
        content = COALESCE(?, content),
        metadata = COALESCE(?, metadata),
        version = version + 1,
        updated_at = ?
      WHERE id = ?
    `).run(
      updates.name,
      updates.description,
      updates.category,
      updates.content,
      updates.metadata ? JSON.stringify(updates.metadata) : null,
      Date.now(),
      id
    );
  }

  async getPromptHistory(id: string): Promise<PromptVersion[]> {
    const rows = this.db.prepare(`
      SELECT * FROM prompt_history
      WHERE prompt_id = ?
      ORDER BY version DESC
    `).all(id);

    return rows.map(row => this.rowToPromptVersion(row));
  }

  async rollbackPrompt(id: string, version: number): Promise<void> {
    // Get the historical version
    const historical = this.db.prepare(`
      SELECT * FROM prompt_history
      WHERE prompt_id = ? AND version = ?
    `).get(id, version);

    if (!historical) {
      throw new Error(`Version ${version} not found for prompt ${id}`);
    }

    // Archive current before rollback
    await this.updatePrompt(id, {
      name: historical.name,
      description: historical.description,
      category: historical.category,
      content: historical.content,
      metadata: JSON.parse(historical.metadata)
    }, `Rollback to version ${version}`);
  }

  // ... other methods
}
```

2. **Configuration support**:
```typescript
// server/config.json
{
  "storage": {
    "type": "sqlite",  // "json" for legacy
    "sqlitePath": "~/.claude-prompts-mcp/storage.db",
    "defaultsPath": "./defaults/prompts",
    "backupOnStartup": true,
    "autoBackup": {
      "enabled": true,
      "intervalHours": 24,
      "keepCount": 7
    }
  }
}
```

**Testing**:
- Unit tests for all adapter methods
- Migration tests (JSON → SQLite)
- Performance benchmarks
- Concurrent access tests

**Duration**: 3-4 days

---

### Phase 3: User Data Separation

**Goal**: Move user data to home directory, keep server defaults in Git

**Implementation**:

1. **Data location setup**:
```typescript
// server/src/storage/paths.ts
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

export class StoragePaths {
  static async getUserDataPath(): Promise<string> {
    const homeDir = os.homedir();
    const dataDir = path.join(homeDir, '.claude-prompts-mcp');

    // Ensure directory exists
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(path.join(dataDir, 'backups'), { recursive: true });
    await fs.mkdir(path.join(dataDir, 'exports'), { recursive: true });

    return dataDir;
  }

  static async getStoragePath(): Promise<string> {
    const dataDir = await this.getUserDataPath();
    return path.join(dataDir, 'storage.db');
  }

  static getServerDefaultsPath(): string {
    // Server installation defaults
    return path.join(__dirname, '../../defaults');
  }
}
```

2. **First-run initialization**:
```typescript
// server/src/storage/initialization.ts
export class StorageInitializer {
  static async initializeUserStorage(logger: Logger): Promise<void> {
    const dbPath = await StoragePaths.getStoragePath();
    const defaultsPath = StoragePaths.getServerDefaultsPath();

    // Check if database exists
    const isFirstRun = !(await this.fileExists(dbPath));

    if (isFirstRun) {
      logger.info('First run detected, creating user database');

      // Create SQLite database
      const storage = new SQLiteStorageAdapter(dbPath, logger);
      await storage.initialize();

      // Import server defaults
      logger.info('Importing server defaults to user database');
      await this.importDefaults(storage, defaultsPath, logger);

      logger.info('User storage initialized successfully');
    }
  }

  private static async importDefaults(
    storage: IStorageAdapter,
    defaultsPath: string,
    logger: Logger
  ): Promise<void> {
    // Load defaults from JSON
    const jsonAdapter = new JSONStorageAdapter(defaultsPath, logger);
    await jsonAdapter.initialize();

    const prompts = await jsonAdapter.listPrompts();

    for (const prompt of prompts) {
      await storage.savePrompt({
        ...prompt,
        source: 'server_default',
        isDefault: true
      }, 'Imported from server defaults');
    }

    logger.info(`Imported ${prompts.length} default prompts`);
  }
}
```

3. **Update server startup**:
```typescript
// server/src/runtime/application.ts
async startupPhase1_Foundation(): Promise<void> {
  // ... existing code ...

  // Initialize user storage
  await StorageInitializer.initializeUserStorage(this.logger);

  // Create storage adapter
  const config: StorageConfig = {
    type: 'sqlite',
    sqlitePath: await StoragePaths.getStoragePath(),
    defaultsPath: StoragePaths.getServerDefaultsPath()
  };

  this.storage = await StorageFactory.createAdapter(config, this.logger);
  await this.storage.initialize();
}
```

**Migration for Existing Users**:
```typescript
// One-time migration script
export async function migrateExistingUserData(): Promise<void> {
  const oldPath = path.join(__dirname, '../../prompts');
  const newPath = await StoragePaths.getStoragePath();

  // Check if user has modified prompts in old location
  const hasCustomPrompts = await detectUserModifications(oldPath);

  if (hasCustomPrompts) {
    console.log('Migrating user prompts to ~/.claude-prompts-mcp/');

    // Create SQLite database
    const storage = new SQLiteStorageAdapter(newPath, logger);
    await storage.initialize();

    // Import existing prompts
    const jsonAdapter = new JSONStorageAdapter(oldPath, logger);
    const prompts = await jsonAdapter.listPrompts();

    for (const prompt of prompts) {
      await storage.savePrompt(prompt, 'Migrated from server location');
    }

    console.log('Migration complete!');
  }
}
```

**Testing**:
- First-run experience
- Migration from old location
- Default import verification
- Path resolution cross-platform

**Duration**: 2 days

---

### Phase 4: Versioning & History Features

**Goal**: Expose history features through MCP tools

**Implementation**:

1. **Enhanced MCP tool commands**:
```typescript
// server/src/mcp-tools/prompt-manager.ts

// Add new actions to PromptManagerAction enum
export enum PromptManagerAction {
  // ... existing actions ...
  HISTORY = 'history',
  GET_VERSION = 'get_version',
  ROLLBACK = 'rollback',
  COMPARE_VERSIONS = 'compare_versions'
}

// Implementation
async handleHistoryAction(id: string): Promise<ToolResponse> {
  const history = await this.storage.getPromptHistory(id);

  if (history.length === 0) {
    return {
      success: false,
      message: `No history found for prompt: ${id}`
    };
  }

  // Format for LLM consumption
  const formatted = history.map(v => ({
    version: v.version,
    changedAt: new Date(v.changedAt).toISOString(),
    reason: v.changeReason || 'No reason provided',
    summary: this.summarizeChanges(v)
  }));

  return {
    success: true,
    data: {
      promptId: id,
      currentVersion: history[0].version,
      totalVersions: history.length,
      history: formatted
    },
    message: `Retrieved ${history.length} versions for prompt: ${id}`
  };
}

async handleRollbackAction(
  id: string,
  version: number
): Promise<ToolResponse> {
  try {
    // Get current state
    const current = await this.storage.getPrompt(id);
    if (!current) {
      return { success: false, message: `Prompt not found: ${id}` };
    }

    // Automatic backup before rollback
    await this.storage.backup(`Before rollback of ${id} to v${version}`);

    // Perform rollback
    await this.storage.rollbackPrompt(id, version);

    return {
      success: true,
      message: `Rolled back prompt "${id}" from v${current.version} to v${version}`,
      data: {
        previousVersion: current.version,
        newVersion: version,
        backupCreated: true
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Rollback failed: ${error.message}`
    };
  }
}
```

2. **Usage examples for LLM**:
```typescript
// Add to tool descriptions
const examples = `
View change history:
>>prompt_manager action="history" id="analyze_code"

Output:
Version 5 (2025-01-19 14:30) - Updated argument descriptions
Version 4 (2025-01-18 10:15) - Added error handling guidance
Version 3 (2025-01-17 09:00) - Refactored structure
Version 2 (2025-01-16 15:45) - Initial refinements
Version 1 (2025-01-15 11:20) - Initial creation

Rollback to previous version:
>>prompt_manager action="rollback" id="analyze_code" version="4"

Output:
✓ Rolled back "analyze_code" from v5 to v4
✓ Automatic backup created

Compare versions:
>>prompt_manager action="compare_versions" id="analyze_code" version1="4" version2="5"

Output:
Changes in v5:
+ Added argument: "error_handling_level"
~ Modified: System message instructions
- Removed: Legacy compatibility note
`;
```

3. **Automatic backup manager**:
```typescript
// server/src/storage/versioning/backup-manager.ts
export class BackupManager {
  private backupDir: string;
  private maxBackups: number;

  async createBackup(
    dbPath: string,
    reason: string
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `storage-${timestamp}.db`;
    const backupPath = path.join(this.backupDir, backupName);

    // Copy database file
    await fs.copyFile(dbPath, backupPath);

    // Write backup metadata
    await fs.writeFile(
      backupPath + '.meta.json',
      JSON.stringify({
        reason,
        timestamp: Date.now(),
        originalPath: dbPath
      })
    );

    // Cleanup old backups
    await this.cleanupOldBackups();

    return backupPath;
  }

  private async cleanupOldBackups(): Promise<void> {
    const backups = await this.listBackups();

    if (backups.length > this.maxBackups) {
      // Delete oldest backups
      const toDelete = backups
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, backups.length - this.maxBackups);

      for (const backup of toDelete) {
        await fs.unlink(backup.path);
        await fs.unlink(backup.path + '.meta.json');
      }
    }
  }
}
```

**Testing**:
- History retrieval accuracy
- Rollback correctness
- Backup creation and restoration
- Concurrent modification handling

**Duration**: 2-3 days

---

## MCP Tool Integration

### Enhanced Prompt Manager Tool

**New Schema Extensions**:
```typescript
const promptManagerSchema = z.object({
  action: z.enum([
    'create', 'update', 'delete', 'list', 'analyze',
    'history', 'get_version', 'rollback', 'compare_versions',  // NEW
    'export', 'import', 'backup'  // NEW
  ]),
  id: z.string().optional(),
  version: z.number().optional(),  // For version-specific operations
  version1: z.number().optional(), // For comparisons
  version2: z.number().optional(),
  // ... existing fields ...
});
```

**Command Examples**:
```bash
# View history
>>prompt_manager action="history" id="analyze_code"

# Get specific version
>>prompt_manager action="get_version" id="analyze_code" version="3"

# Rollback
>>prompt_manager action="rollback" id="analyze_code" version="4"

# Compare versions
>>prompt_manager action="compare_versions" id="analyze_code" version1="4" version2="5"

# Create backup
>>prompt_manager action="backup" reason="Before major refactor"

# Export to JSON (for Git backup)
>>prompt_manager action="export" format="json" path="./my-prompts-backup/"

# Import from JSON
>>prompt_manager action="import" path="./my-prompts-backup/prompts.json"
```

### System Control Enhancements

**Storage status command**:
```typescript
// Add to system_control tool
async handleStorageStatus(): Promise<ToolResponse> {
  const health = await this.storage.health();
  const stats = await this.storage.getStats();

  return {
    success: true,
    data: {
      storage: {
        type: health.storageType,
        location: health.location,
        size: this.formatBytes(health.size),
        healthy: health.healthy,
        lastBackup: health.lastBackup
          ? new Date(health.lastBackup).toISOString()
          : 'Never'
      },
      statistics: {
        totalPrompts: stats.totalPrompts,
        totalFrameworks: stats.totalFrameworks,
        totalGates: stats.totalGates,
        totalVersions: stats.totalVersions,
        categories: stats.categories
      }
    }
  };
}
```

**Usage**:
```bash
>>system_control action="storage_status"

Output:
Storage Status:
  Type: SQLite
  Location: ~/.claude-prompts-mcp/storage.db
  Size: 2.4 MB
  Health: ✓ Healthy
  Last Backup: 2025-01-19 14:30:00

Statistics:
  Prompts: 127 (892 versions)
  Frameworks: 4 (12 versions)
  Gates: 23 (67 versions)
  Categories: 18
```

---

## Implementation Phases

### Phase 1: Storage Abstraction (Week 1)

**Deliverables**:
- ✅ `IStorageAdapter` interface defined
- ✅ `JSONStorageAdapter` wrapping existing system
- ✅ `StorageFactory` for adapter creation
- ✅ Updated MCP tools to use adapter
- ✅ All existing tests passing

**Testing**:
- Unit tests for adapter interface
- Integration tests with existing system
- No regressions in functionality

**Success Criteria**:
- Zero breaking changes
- All existing features work
- Adapter pattern validated

---

### Phase 2: SQLite Implementation (Week 2)

**Deliverables**:
- ✅ `SQLiteStorageAdapter` fully implemented
- ✅ Schema creation with profile support (default profile only)
- ✅ Profile-aware CRUD operations (auto-scoped to default)
- ✅ Basic CRUD operations working
- ✅ Migration utility (JSON → SQLite)
- ✅ Configuration support

**Profile Support Note**:
- Profile tables created, default profile initialized
- All queries automatically scoped to 'default' profile
- Zero user-visible changes (single profile mode)
- Foundation ready for future multi-profile features

**Testing**:
- Unit tests for all SQL operations
- Profile-scoped query tests
- Migration tests
- Performance benchmarks (<10ms with profile filtering)
- Concurrent access tests

**Success Criteria**:
- Feature parity with JSON adapter
- <10ms query performance (with profile_id filter)
- Successful migrations from JSON
- Profile foundation validated

---

### Phase 3: User Data Separation (Week 3)

**Deliverables**:
- ✅ User data path management (`~/.claude-prompts-mcp/`)
- ✅ First-run initialization
- ✅ Server defaults import
- ✅ Migration script for existing users
- ✅ Documentation updated

**Testing**:
- First-run experience
- Migration from old location
- Cross-platform path resolution
- Default import accuracy

**Success Criteria**:
- User data isolated from server
- Server defaults tracked in Git
- Smooth upgrade path for existing users

---

### Phase 4: Versioning & History (Week 4)

**Deliverables**:
- ✅ History tracking implemented
- ✅ Version retrieval methods
- ✅ Rollback functionality
- ✅ Automatic backup system
- ✅ MCP tool history commands

**Testing**:
- History accuracy tests
- Rollback correctness
- Backup/restore verification
- Concurrent modification handling

**Success Criteria**:
- Full change history for all entities
- Safe rollback with automatic backups
- Performance: <50ms for history queries

---

### Phase 5: Polish & Documentation (Week 5)

**Deliverables**:
- ✅ Export/import features
- ✅ Storage statistics and health monitoring
- ✅ Comprehensive error handling
- ✅ User documentation
- ✅ Migration guide

**Testing**:
- End-to-end testing
- Performance validation
- Edge case coverage
- User acceptance testing

**Success Criteria**:
- All features documented
- Migration guide complete
- Performance targets met

---

## Testing Strategy

### Unit Tests

**Storage Adapter Tests**:
```typescript
// tests/storage/sqlite-adapter.test.ts
describe('SQLiteStorageAdapter', () => {
  let adapter: SQLiteStorageAdapter;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(tmpdir(), `test-${Date.now()}.db`);
    adapter = new SQLiteStorageAdapter(testDbPath, logger);
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
    await fs.unlink(testDbPath);
  });

  describe('getPrompt', () => {
    it('should retrieve existing prompt', async () => {
      const prompt = createTestPrompt();
      await adapter.savePrompt(prompt);

      const retrieved = await adapter.getPrompt(prompt.id);

      expect(retrieved).toEqual(prompt);
    });

    it('should return null for non-existent prompt', async () => {
      const result = await adapter.getPrompt('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('savePrompt', () => {
    it('should create new prompt', async () => {
      const prompt = createTestPrompt();
      await adapter.savePrompt(prompt, 'Initial creation');

      const retrieved = await adapter.getPrompt(prompt.id);
      expect(retrieved).toBeTruthy();
      expect(retrieved.version).toBe(1);
    });

    it('should update existing prompt and increment version', async () => {
      const prompt = createTestPrompt();
      await adapter.savePrompt(prompt);

      const updated = { ...prompt, name: 'Updated Name' };
      await adapter.savePrompt(updated, 'Name change');

      const retrieved = await adapter.getPrompt(prompt.id);
      expect(retrieved.name).toBe('Updated Name');
      expect(retrieved.version).toBe(2);
    });
  });

  describe('getPromptHistory', () => {
    it('should track all versions', async () => {
      const prompt = createTestPrompt();
      await adapter.savePrompt(prompt);

      // Make 3 updates
      for (let i = 0; i < 3; i++) {
        await adapter.updatePrompt(
          prompt.id,
          { name: `Version ${i + 2}` },
          `Update ${i + 1}`
        );
      }

      const history = await adapter.getPromptHistory(prompt.id);

      expect(history).toHaveLength(4); // Original + 3 updates
      expect(history[0].version).toBe(4);
      expect(history[3].version).toBe(1);
    });
  });

  describe('rollbackPrompt', () => {
    it('should restore previous version', async () => {
      const prompt = createTestPrompt();
      await adapter.savePrompt(prompt);

      await adapter.updatePrompt(prompt.id, { name: 'V2' });
      await adapter.updatePrompt(prompt.id, { name: 'V3' });

      await adapter.rollbackPrompt(prompt.id, 1);

      const current = await adapter.getPrompt(prompt.id);
      expect(current.name).toBe(prompt.name);
    });
  });
});
```

### Integration Tests

**Migration Tests**:
```typescript
// tests/storage/migration.test.ts
describe('JSON to SQLite Migration', () => {
  it('should migrate all prompts correctly', async () => {
    // Setup JSON data
    const jsonPath = setupTestJSONStorage();
    const jsonAdapter = new JSONStorageAdapter(jsonPath, logger);
    const originalPrompts = await jsonAdapter.listPrompts();

    // Migrate to SQLite
    const sqlitePath = path.join(tmpdir(), 'migrated.db');
    const sqliteAdapter = new SQLiteStorageAdapter(sqlitePath, logger);

    for (const prompt of originalPrompts) {
      await sqliteAdapter.savePrompt(prompt, 'Migrated from JSON');
    }

    // Verify
    const migratedPrompts = await sqliteAdapter.listPrompts();
    expect(migratedPrompts).toHaveLength(originalPrompts.length);

    for (const original of originalPrompts) {
      const migrated = await sqliteAdapter.getPrompt(original.id);
      expect(migrated).toMatchObject(original);
    }
  });
});
```

### Performance Tests

**Benchmark Suite**:
```typescript
// tests/storage/performance.test.ts
describe('Storage Performance', () => {
  it('should retrieve prompts in <10ms', async () => {
    const adapter = new SQLiteStorageAdapter(dbPath, logger);

    // Insert test data
    for (let i = 0; i < 100; i++) {
      await adapter.savePrompt(createTestPrompt(`prompt-${i}`));
    }

    // Benchmark retrieval
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await adapter.getPrompt(`prompt-${i}`);
    }
    const duration = performance.now() - start;
    const avgTime = duration / 100;

    expect(avgTime).toBeLessThan(10);
  });

  it('should list prompts with filtering in <50ms', async () => {
    // Insert 500 prompts across categories
    for (let i = 0; i < 500; i++) {
      await adapter.savePrompt({
        ...createTestPrompt(`prompt-${i}`),
        category: `category-${i % 10}`
      });
    }

    // Benchmark filtered listing
    const start = performance.now();
    const results = await adapter.listPrompts({
      category: 'category-5',
      searchText: 'test'
    });
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(50);
    expect(results.length).toBeGreaterThan(0);
  });
});
```

---

## Rollback & Recovery

### Automatic Backup System

**Backup Triggers**:
1. **Before major operations**:
   - Rollback
   - Bulk import
   - Mass deletion

2. **Scheduled backups**:
   - Daily at midnight
   - Configurable interval

3. **Manual backups**:
   - Via MCP tool command
   - Before user-initiated migrations

**Implementation**:
```typescript
// server/src/storage/versioning/backup-manager.ts
export class AutomaticBackupSystem {
  private backupInterval: NodeJS.Timer;

  startAutoBackup(adapter: IStorageAdapter, intervalHours: number): void {
    this.backupInterval = setInterval(
      async () => {
        await adapter.backup('Scheduled automatic backup');
      },
      intervalHours * 60 * 60 * 1000
    );
  }

  async backupBeforeRiskyOperation(
    adapter: IStorageAdapter,
    operation: string
  ): Promise<string> {
    return await adapter.backup(`Before ${operation}`);
  }
}
```

### Recovery Procedures

**Restore from Backup**:
```typescript
async restoreFromBackup(backupPath: string): Promise<void> {
  // Close current database connection
  await this.storage.close();

  // Get current database path
  const dbPath = await StoragePaths.getStoragePath();

  // Archive current database
  const archivePath = `${dbPath}.before-restore-${Date.now()}`;
  await fs.rename(dbPath, archivePath);

  // Restore from backup
  await fs.copyFile(backupPath, dbPath);

  // Reinitialize storage
  this.storage = new SQLiteStorageAdapter(dbPath, this.logger);
  await this.storage.initialize();

  this.logger.info(`Restored from backup: ${backupPath}`);
}
```

**MCP Tool Command**:
```bash
>>system_control action="list_backups"
# Shows available backups with timestamps and reasons

>>system_control action="restore_backup" backup="storage-2025-01-19-143020.db"
# Restores from specified backup
```

---

## Performance Considerations

### Query Optimization

**Indexed Queries**:
```sql
-- Fast category filtering (indexed)
SELECT * FROM prompts
WHERE category = ? AND deleted = 0;

-- Fast date range queries (indexed)
SELECT * FROM prompts
WHERE updated_at > ? AND deleted = 0;

-- Full-text search (consider FTS5 extension)
CREATE VIRTUAL TABLE prompts_fts USING fts5(
  id, name, description, content,
  content=prompts
);
```

**Prepared Statements**:
```typescript
// Pre-compile frequently used queries
class SQLiteStorageAdapter {
  private preparedQueries = {
    getPrompt: null as Database.Statement | null,
    savePrompt: null as Database.Statement | null,
    listByCategory: null as Database.Statement | null
  };

  initialize() {
    // Compile once, reuse many times
    this.preparedQueries.getPrompt = this.db.prepare(
      'SELECT * FROM prompts WHERE id = ? AND deleted = 0'
    );

    this.preparedQueries.listByCategory = this.db.prepare(
      'SELECT * FROM prompts WHERE category = ? AND deleted = 0'
    );
  }

  async getPrompt(id: string): Promise<PromptData | null> {
    // Use pre-compiled statement
    const row = this.preparedQueries.getPrompt.get(id);
    return row ? this.rowToPromptData(row) : null;
  }
}
```

### Transaction Batching

**Bulk Operations**:
```typescript
async bulkSave(prompts: PromptData[]): Promise<void> {
  // Use transaction for atomic bulk insert
  const transaction = this.db.transaction((prompts: PromptData[]) => {
    for (const prompt of prompts) {
      this.insertPrompt(prompt);
    }
  });

  transaction(prompts);
}
```

### Memory Management

**Streaming Large Results**:
```typescript
async *streamPrompts(filter?: FilterOptions): AsyncGenerator<PromptData> {
  const stmt = this.db.prepare('SELECT * FROM prompts WHERE deleted = 0');

  for (const row of stmt.iterate()) {
    yield this.rowToPromptData(row);
  }
}

// Usage
for await (const prompt of adapter.streamPrompts()) {
  // Process one at a time, memory efficient
}
```

### Performance Targets

**Benchmarks**:
- **Single prompt retrieval**: <10ms
- **List 100 prompts**: <50ms
- **History query (50 versions)**: <30ms
- **Rollback operation**: <100ms
- **Backup creation**: <500ms for 10MB database
- **Database size**: <1KB per prompt with history

---

## Future Enhancements

### Phase 6+: Advanced Features

**1. Full-Text Search**:
```sql
-- SQLite FTS5 extension
CREATE VIRTUAL TABLE prompts_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  content,
  tokenize='porter unicode61'
);

-- Trigger to keep FTS in sync
CREATE TRIGGER prompts_fts_insert AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts(id, name, description, content)
  VALUES (new.id, new.name, new.description, new.content);
END;
```

**2. Change Diffs**:
```typescript
async getPromptDiff(
  id: string,
  version1: number,
  version2: number
): Promise<PromptDiff> {
  const v1 = await this.getPromptVersion(id, version1);
  const v2 = await this.getPromptVersion(id, version2);

  return {
    contentDiff: diffLines(v1.content, v2.content),
    metadataDiff: diffJSON(v1.metadata, v2.metadata),
    summary: summarizeChanges(v1, v2)
  };
}
```

**3. Remote Sync** (Optional):
```typescript
// Future: Sync user data across machines
interface IRemoteSyncProvider {
  push(localDb: Database): Promise<void>;
  pull(): Promise<Database>;
  resolveConflicts(local: PromptData, remote: PromptData): PromptData;
}
```

**4. Profile Management Features (Phase 6+)**:

When users accumulate 500+ items and need organization:

```typescript
// MCP Tool Interface
interface ProfileManagement {
  // Profile CRUD
  createProfile(profile: Profile): Promise<void>;
  listProfiles(): Promise<Profile[]>;
  switchProfile(profileId: string): Promise<void>;
  deleteProfile(profileId: string): Promise<void>;

  // Cross-profile operations
  copyPromptToProfile(promptId: string, targetProfileId: string): Promise<void>;
  movePromptToProfile(promptId: string, targetProfileId: string): Promise<void>;
  sharePromptBetweenProfiles(promptId: string, targetProfileIds: string[]): Promise<void>;

  // Profile analytics
  getProfileStats(profileId: string): Promise<ProfileStats>;
}

// Usage examples
>>system_control action="create_profile" profile='{"id":"work","name":"Work","icon":"💼"}'
>>system_control action="switch_profile" profile_id="work"
>>prompt_manager action="list" profile_id="*"  // All profiles
>>prompt_manager action="copy_to_profile" id="template" target_profile="work"
```

**Implementation Ready**:
- Schema already supports profiles (Phase 2)
- Add MCP tool commands (2-3 days)
- Add profile switching UI (1-2 days)
- Zero migration needed (foundation built-in)

**5. Framework & Gate Storage**:
- Once dynamic creation is implemented, use same storage pattern
- Same versioning and history capabilities
- Same MCP tool integration patterns
- Same profile support

**6. Analytics & Insights**:
```typescript
interface StorageAnalytics {
  mostModifiedPrompts: Array<{ id: string; modifications: number }>;
  recentActivity: Array<{ date: string; changes: number }>;
  categoryDistribution: { [category: string]: number };
  averageVersionsPerPrompt: number;
}
```

---

## Appendix A: Configuration Reference

### Complete Configuration Example

```json
{
  "storage": {
    "type": "sqlite",
    "sqlitePath": "~/.claude-prompts-mcp/storage.db",
    "defaultsPath": "./defaults/prompts",

    "backup": {
      "enabled": true,
      "automatic": {
        "intervalHours": 24,
        "keepCount": 7
      },
      "beforeRiskyOperations": true
    },

    "performance": {
      "cacheSize": 100,
      "prepareStatements": true,
      "enableWAL": true
    },

    "features": {
      "fullTextSearch": true,
      "autoVersioning": true,
      "softDelete": true
    }
  }
}
```

---

## Appendix B: Migration Checklist

**Pre-Migration**:
- [ ] Backup current JSON files
- [ ] Test SQLite adapter with sample data
- [ ] Document current prompt count and structure
- [ ] Prepare rollback plan

**Migration**:
- [ ] Create SQLite database in user directory
- [ ] Import server defaults
- [ ] Migrate existing user customizations
- [ ] Verify data integrity
- [ ] Test MCP tool functionality

**Post-Migration**:
- [ ] Verify all prompts accessible
- [ ] Test history functionality
- [ ] Validate backup system
- [ ] Update documentation
- [ ] Monitor performance

**Rollback Plan**:
- [ ] Keep JSON files for 30 days
- [ ] Provide export-to-JSON tool
- [ ] Document recovery procedure
- [ ] Test restoration process

---

## Appendix C: Performance Benchmarks

**Target Performance** (SQLite vs JSON):

| Operation | JSON | SQLite | Improvement |
|-----------|------|--------|-------------|
| Get single prompt | 5ms | 2ms | 2.5x faster |
| List 100 prompts | 80ms | 15ms | 5.3x faster |
| Filter by category | 100ms | 10ms | 10x faster |
| Get history | N/A | 25ms | New feature |
| Rollback | N/A | 80ms | New feature |
| Search text | 200ms | 30ms | 6.7x faster |

**Memory Usage**:
- JSON: ~2MB for 100 prompts (full in-memory)
- SQLite: ~500KB baseline + query cache (streaming capable)

---

## Conclusion

This implementation plan provides a comprehensive roadmap for migrating from JSON-based storage to SQLite while maintaining backwards compatibility, enabling versioning features, and separating user data from the server codebase.

**Key Success Factors**:
1. **Gradual migration** - No breaking changes, users opt-in
2. **Storage abstraction** - Clean adapter pattern enables flexibility
3. **User-centric design** - Data lives in user's home directory
4. **Git-optional** - Users don't need to fork, but can export to JSON
5. **Versioning built-in** - Automatic history tracking and rollback
6. **Performance optimized** - SQLite provides significant speed improvements
7. **Profile support** - Built-in from day one, enables work/life/code separation at scale
8. **Future-ready** - Extensible to frameworks and gates

**Timeline**: 5 weeks for full implementation
**Team Size**: 1-2 developers
**Risk Level**: Low (gradual migration, extensive testing, rollback capabilities)

---

**Next Steps**:
1. Review and approve this plan
2. Begin Phase 1: Storage Abstraction Layer
3. Set up testing infrastructure
4. Prepare user communication materials
5. Implement according to phased approach

**Questions for Consideration**:
- Should we support remote sync in the future? (Multi-machine)
- Do we need multi-user support? (Collaboration)
- Should we add prompt templates marketplace? (Import from community)
- Performance targets acceptable? (Can optimize further if needed)
