/**
 * AST-aware symbol rename script using ts-morph.
 *
 * Usage:
 *   npx tsx scripts/rename-symbols.ts [--dry-run] [--tier N]
 *
 * - --dry-run: Show what would be renamed without writing files
 * - --tier N: Only run renames for the specified tier (1-5)
 *
 * ts-morph's .rename() propagates across all files in the project:
 * imports, type annotations, variable declarations, re-exports.
 *
 * What this does NOT handle (fix manually after):
 * - File renames (manager.ts → store.ts)
 * - String literals in logs/errors
 * - Test files (excluded from tsconfig)
 * - Python hooks, docs, CLAUDE.md
 */

import { Project } from 'ts-morph';

interface RenameEntry {
  oldName: string;
  newName: string;
  kind: 'class' | 'interface' | 'type';
  tier: number;
}

const RENAMES: RenameEntry[] = [
  // Tier 1: Chain Session (proof of concept)
  { oldName: 'ChainSessionManager', newName: 'ChainSessionStore', kind: 'class', tier: 1 },
  { oldName: 'ChainSessionService', newName: 'ChainSessionStore', kind: 'interface', tier: 1 },

  // Tier 2: Registries
  { oldName: 'FrameworkManager', newName: 'FrameworkRegistry', kind: 'class', tier: 2 },
  { oldName: 'GateManager', newName: 'GateRegistry', kind: 'class', tier: 2 },
  { oldName: 'StyleManager', newName: 'StyleRegistry', kind: 'class', tier: 2 },
  { oldName: 'PromptAssetManager', newName: 'PromptAssetLoader', kind: 'class', tier: 2 },
  { oldName: 'CategoryManager', newName: 'CategoryAssigner', kind: 'class', tier: 2 },

  // Tier 3: State Stores
  // FrameworkStateStore / GateStateStore / TextReferenceStore / ConversationStore were listed
  // here renaming to themselves. An identity entry is not a no-op: ts-morph still resolves and
  // rewrites every reference, so each one was real risk buying nothing. Removed 2026-07-29.
  {
    oldName: 'VerifyActiveStateManager',
    newName: 'VerifyActiveStateStore',
    kind: 'class',
    tier: 3,
  },

  // Tier 4: Infrastructure
  { oldName: 'ServerManager', newName: 'ServerLifecycle', kind: 'class', tier: 4 },
  { oldName: 'TransportManager', newName: 'TransportRouter', kind: 'class', tier: 4 },
  { oldName: 'ApiManager', newName: 'ApiRouter', kind: 'class', tier: 4 },
  { oldName: 'HotReloadManager', newName: 'HotReloadObserver', kind: 'class', tier: 4 },
  { oldName: 'ServiceManager', newName: 'ServiceOrchestrator', kind: 'class', tier: 4 },
  { oldName: 'SessionOverrideManager', newName: 'SessionOverrideResolver', kind: 'class', tier: 4 },
  { oldName: 'ToolDescriptionManager', newName: 'ToolDescriptionLoader', kind: 'class', tier: 4 },

  // Tier 5: MCP Tool Orchestrators
  {
    oldName: 'ConsolidatedFrameworkManager',
    newName: 'FrameworkToolHandler',
    kind: 'class',
    tier: 5,
  },
  { oldName: 'ConsolidatedGateManager', newName: 'GateToolHandler', kind: 'class', tier: 5 },
  { oldName: 'ConsolidatedMcpToolsManager', newName: 'McpToolRouter', kind: 'class', tier: 5 },
  {
    oldName: 'ConsolidatedCheckpointManager',
    newName: 'CheckpointToolHandler',
    kind: 'class',
    tier: 5,
  },
  { oldName: 'BaseResourceManager', newName: 'BaseResourceHandler', kind: 'class', tier: 5 },

  // Tier 6: MCP Tool Service → Specific Suffix
  // Action-group processors (lifecycle/discovery/versioning)
  {
    oldName: 'PromptLifecycleService',
    newName: 'PromptLifecycleProcessor',
    kind: 'class',
    tier: 6,
  },
  {
    oldName: 'PromptDiscoveryService',
    newName: 'PromptDiscoveryProcessor',
    kind: 'class',
    tier: 6,
  },
  {
    oldName: 'PromptVersioningService',
    newName: 'PromptVersioningProcessor',
    kind: 'class',
    tier: 6,
  },
  { oldName: 'GateLifecycleService', newName: 'GateLifecycleProcessor', kind: 'class', tier: 6 },
  { oldName: 'GateDiscoveryService', newName: 'GateDiscoveryProcessor', kind: 'class', tier: 6 },
  { oldName: 'GateVersioningService', newName: 'GateVersioningProcessor', kind: 'class', tier: 6 },
  {
    oldName: 'FrameworkLifecycleService',
    newName: 'FrameworkLifecycleProcessor',
    kind: 'class',
    tier: 6,
  },
  {
    oldName: 'FrameworkDiscoveryService',
    newName: 'FrameworkDiscoveryProcessor',
    kind: 'class',
    tier: 6,
  },
  {
    oldName: 'FrameworkVersioningService',
    newName: 'FrameworkVersioningProcessor',
    kind: 'class',
    tier: 6,
  },
  // Specific-behavior classes
  {
    oldName: 'MethodologyValidationService',
    newName: 'MethodologyValidator',
    kind: 'class',
    tier: 6,
  },
  { oldName: 'GateFileService', newName: 'GateFileWriter', kind: 'class', tier: 6 },
  { oldName: 'MethodologyFileService', newName: 'MethodologyFileWriter', kind: 'class', tier: 6 },
  { oldName: 'TextDiffService', newName: 'ObjectDiffGenerator', kind: 'class', tier: 6 },
  { oldName: 'PromptExecutionService', newName: 'PromptExecutor', kind: 'class', tier: 6 },
  // Port interfaces (rename BEFORE manual class renames that use implements)
  {
    oldName: 'ChainManagementServicePort',
    newName: 'ChainSessionRouterPort',
    kind: 'interface',
    tier: 6,
  },
  {
    oldName: 'PromptResourceServicePort',
    newName: 'PromptResourceHandlerPort',
    kind: 'interface',
    tier: 6,
  },
  // Dependency interfaces
  {
    oldName: 'GateFileServiceDependencies',
    newName: 'GateFileWriterDependencies',
    kind: 'interface',
    tier: 6,
  },
  {
    oldName: 'MethodologyFileServiceDependencies',
    newName: 'MethodologyFileWriterDependencies',
    kind: 'interface',
    tier: 6,
  },
];

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const tierIdx = args.indexOf('--tier');
  const tierFilter = tierIdx !== -1 ? parseInt(args[tierIdx + 1], 10) : undefined;

  const entries = tierFilter ? RENAMES.filter((r) => r.tier === tierFilter) : RENAMES;

  if (entries.length === 0) {
    console.log(`No renames for tier ${tierFilter}`);
    process.exit(0);
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Loading project...`);
  const project = new Project({ tsConfigFilePath: 'tsconfig.json' });

  // Also add test files so renames propagate there
  project.addSourceFilesAtPaths('tests/**/*.ts');

  const sourceFiles = project.getSourceFiles();
  console.log(`Loaded ${sourceFiles.length} source files`);

  let totalRenamed = 0;

  for (const entry of entries) {
    let found = false;

    for (const sourceFile of sourceFiles) {
      if (entry.kind === 'class' || entry.kind === 'type') {
        for (const cls of sourceFile.getClasses()) {
          if (cls.getName() === entry.oldName) {
            console.log(
              `  ${dryRun ? 'Would rename' : 'Renaming'} class ${entry.oldName} → ${entry.newName} (${sourceFile.getBaseName()})`
            );
            if (!dryRun) cls.rename(entry.newName);
            found = true;
            totalRenamed++;
          }
        }
      }

      if (entry.kind === 'interface' || entry.kind === 'type') {
        for (const iface of sourceFile.getInterfaces()) {
          if (iface.getName() === entry.oldName) {
            console.log(
              `  ${dryRun ? 'Would rename' : 'Renaming'} interface ${entry.oldName} → ${entry.newName} (${sourceFile.getBaseName()})`
            );
            if (!dryRun) iface.rename(entry.newName);
            found = true;
            totalRenamed++;
          }
        }
      }
    }

    if (!found) {
      console.warn(`  ⚠ Not found: ${entry.kind} ${entry.oldName}`);
    }
  }

  if (!dryRun && totalRenamed > 0) {
    console.log(`\nSaving ${totalRenamed} renames...`);
    project.saveSync();
    console.log('Done. Run typecheck to verify.');
  } else {
    console.log(`\n${dryRun ? 'Would rename' : 'Renamed'} ${totalRenamed} symbols.`);
  }

  // Report remaining manual work
  console.log('\n--- Manual fixups needed ---');
  console.log('1. File renames (manager.ts → store.ts etc.)');
  console.log('2. String literals in log messages / error strings');
  console.log('3. Python hooks (hooks/lib/*.py)');
  console.log('4. Docs and CLAUDE.md references');
  console.log('5. Test descriptions (describe/it strings)');
}

main();
