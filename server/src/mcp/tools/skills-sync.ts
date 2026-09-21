// @lifecycle canonical - MCP wrapper around shared skills-sync service.
import { readFile } from 'node:fs/promises';
import { format } from 'node:util';

import * as yaml from 'js-yaml';

import type { DatabasePort, Logger, ToolResponse } from '#shared/types/index.js';

import {
  getSkillsSyncConfigPath,
  listSupportedSkillsSyncClients,
  runSkillsSyncCommand,
  type ResourceType,
  type SkillsSyncOutput,
  type SkillsSyncPaths,
  type SkillsSyncRunReport,
} from '#modules/skills-sync/service.js';

export const SKILLS_SYNC_OPERATIONS = [
  'status',
  'export',
  'sync',
  'diff',
  'pull',
  'clone',
] as const;
export type SkillsSyncOperation = (typeof SKILLS_SYNC_OPERATIONS)[number];

export interface SkillsSyncInput {
  /**
   * Named `operation`, not `action`, all the way down: `system_control` spends
   * `action` on its own dispatch, so mapping it here would be exactly the hidden
   * router transformation `mcp-contracts.md` bans.
   */
  operation: SkillsSyncOperation;
  client?: string;
  scope?: 'user' | 'project';
  resource_type?: ResourceType;
  id?: string;
  prune?: boolean;
  output?: string;
  file?: string;
  category?: string;
  preview?: boolean;
  preview_detail?: 'summary' | 'diff';
  force?: boolean;
}

interface ManifestCountRow {
  scope: string;
  count: number;
}

interface SkillsSyncStatus {
  configPath: string;
  configExists: boolean;
  selectionSource: 'registrations' | 'exports' | 'none';
  configuredCount: number;
  clients: Array<{
    id: string;
    registrationMode: 'scoped' | 'all' | 'unregistered';
    registrationCount: number;
    entryCount: number;
    scopes: ManifestCountRow[];
  }>;
}

function createStructuredResponse(
  content: string,
  isError: boolean = false,
  metadata?: Record<string, unknown>
): ToolResponse {
  const response: ToolResponse = {
    content: [{ type: 'text', text: content }],
    isError,
  };

  if (metadata != null) {
    (response as ToolResponse & { metadata?: Record<string, unknown> }).metadata = metadata;
  }

  return response;
}

export class ConsolidatedSkillsSync {
  constructor(
    private readonly logger: Logger,
    // Resolved by the caller, once per request, through the server's own `PathResolver` --
    // this class runs only inside `system_control` (see `skills-sync-action-handler.ts`), so
    // it takes the already-resolved directories rather than re-deriving them from the
    // environment the way the standalone CLI wrapper does.
    private readonly paths: SkillsSyncPaths,
    private readonly dbManager?: DatabasePort
  ) {}

  async handleAction(args: SkillsSyncInput): Promise<ToolResponse> {
    const operation = args.operation;

    if (!SKILLS_SYNC_OPERATIONS.includes(operation)) {
      return createStructuredResponse(
        `Unknown skills_sync operation: ${String(operation)}. Valid operations: ${SKILLS_SYNC_OPERATIONS.join(', ')}`,
        true,
        { action: 'invalid_operation' }
      );
    }

    if (operation === 'status') {
      return this.getStatus();
    }

    return this.executeSkillsSyncOperation(operation, args);
  }

  private async getStatus(): Promise<ToolResponse> {
    const configPath = getSkillsSyncConfigPath(this.paths);
    // No initializer: the try assigns true, the catch assigns false.
    let configExists: boolean;
    let selectionSource: SkillsSyncStatus['selectionSource'] = 'none';
    let configuredCount = 0;
    let registrations: Record<string, unknown> | null = null;
    let exportsConfig: Record<string, unknown> | 'all' | null = null;

    const countScopedEntries = (scoped: Record<string, unknown>): number => {
      let count = 0;
      for (const scope of ['user', 'project']) {
        const entries = scoped[scope];
        if (Array.isArray(entries)) {
          count += entries.filter((entry) => typeof entry === 'string').length;
        }
      }
      return count;
    };

    try {
      const raw = await readFile(configPath, 'utf-8');
      configExists = true;
      const parsed = yaml.load(raw) as {
        registrations?: Record<string, unknown>;
        exports?: Record<string, unknown> | 'all';
      } | null;
      if (parsed?.registrations != null && typeof parsed.registrations === 'object') {
        selectionSource = 'registrations';
        registrations = parsed.registrations;
        for (const registration of Object.values(parsed.registrations)) {
          if (registration != null && typeof registration === 'object') {
            configuredCount += countScopedEntries(registration as Record<string, unknown>);
          }
        }
      } else if (parsed?.exports != null) {
        selectionSource = 'exports';
        exportsConfig = parsed.exports;
        if (parsed.exports === 'all') {
          configuredCount = 0;
        } else if (typeof parsed.exports === 'object') {
          configuredCount = countScopedEntries(parsed.exports);
        }
      }
    } catch {
      configExists = false;
    }

    const clients = listSupportedSkillsSyncClients().map((clientId) => {
      let entryCount = 0;
      let scopes: ManifestCountRow[] = [];
      let registrationMode: 'scoped' | 'all' | 'unregistered' = 'unregistered';
      let registrationCount = 0;

      if (selectionSource === 'registrations' && registrations != null) {
        const registration = registrations[clientId];
        if (registration === 'all') {
          registrationMode = 'all';
        } else if (registration != null && typeof registration === 'object') {
          registrationMode = 'scoped';
          registrationCount = countScopedEntries(registration as Record<string, unknown>);
        }
      } else if (selectionSource === 'exports' && exportsConfig != null) {
        if (exportsConfig === 'all') {
          registrationMode = 'all';
        } else {
          registrationMode = 'scoped';
          registrationCount = countScopedEntries(exportsConfig);
        }
      } else if (selectionSource === 'none') {
        registrationMode = 'all';
      }

      if (this.dbManager?.isInitialized() === true) {
        const total = this.dbManager.queryOne<{ count: number }>(
          'SELECT COUNT(*) as count FROM skills_sync_manifests WHERE client = ?',
          [clientId]
        );
        entryCount = total?.count ?? 0;

        scopes = this.dbManager.query<ManifestCountRow>(
          'SELECT scope, COUNT(*) as count FROM skills_sync_manifests WHERE client = ? GROUP BY scope',
          [clientId]
        );
      }

      return { id: clientId, registrationMode, registrationCount, entryCount, scopes };
    });

    const status: SkillsSyncStatus = {
      configPath,
      configExists,
      selectionSource,
      configuredCount,
      clients,
    };

    const selectionLine =
      selectionSource === 'registrations'
        ? 'registrations'
        : selectionSource === 'exports'
          ? 'exports (legacy fallback)'
          : 'none (all resources eligible)';

    const lines = [
      'Skills Sync Status',
      '',
      `Config: ${configExists ? 'found' : 'missing'} (${configPath})`,
      `Selection source: ${selectionLine}`,
      `Configured registrations: ${configuredCount}`,
      '',
      'Clients:',
      ...clients.map((client) => {
        const registrationLabel =
          client.registrationMode === 'all'
            ? 'all'
            : client.registrationMode === 'scoped'
              ? `scoped (${client.registrationCount})`
              : 'unregistered';
        if (client.entryCount === 0) {
          return `- ${client.id}: ${registrationLabel}, no manifest entries`;
        }
        const scopeDetail = client.scopes.map((s) => `${s.scope}: ${s.count}`).join(', ');
        return `- ${client.id}: ${registrationLabel}, ${client.entryCount} entries (${scopeDetail})`;
      }),
    ];

    return createStructuredResponse(lines.join('\n'), false, {
      action: 'status',
      status,
    });
  }

  private async executeSkillsSyncOperation(
    operation: Exclude<SkillsSyncOperation, 'status'>,
    args: SkillsSyncInput
  ): Promise<ToolResponse> {
    const logs: string[] = [];
    const output: SkillsSyncOutput = {
      log: (...values) => logs.push(format(...values)),
      warn: (...values) => logs.push(`[warn] ${format(...values)}`),
      error: (...values) => logs.push(`[error] ${format(...values)}`),
    };

    try {
      const report = await runSkillsSyncCommand(
        {
          command: operation,
          client: args.client,
          scope: args.scope,
          resourceType: args.resource_type,
          id: args.id,
          prune: args.prune,
          output: args.output,
          file: args.file,
          category: args.category,
          preview: args.preview,
          previewDetail: args.preview_detail,
          force: args.force,
          dbManager: this.dbManager,
        },
        output,
        this.paths
      );

      const summary = this.summarizeRunReport(operation, args, report);
      const text =
        summary.length > 0
          ? logs.length > 0
            ? `${summary}\n\n${logs.join('\n')}`
            : summary
          : logs.length > 0
            ? logs.join('\n')
            : `skills_sync ${operation} completed.`;
      return createStructuredResponse(text, false, {
        action: operation,
        lines: logs,
        report,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`skills_sync ${operation} failed: ${message}`);
      const details = logs.length > 0 ? `\n\nOutput:\n${logs.join('\n')}` : '';
      return createStructuredResponse(
        `skills_sync ${operation} failed: ${message}${details}`,
        true,
        {
          action: operation,
          lines: logs,
          error: message,
        }
      );
    }
  }

  /**
   * "Files written" plus, when the report carries one, its per-client breakdown — the shape
   * `export`, `sync`, and `pull` all render identically. Pulled out of `summarizeRunReport` so
   * that shared shape is written once rather than duplicated per branch, which is also what kept
   * the caller's cognitive complexity under the enforced limit.
   */
  private writtenLines(report: SkillsSyncRunReport, clientLabel: string): string[] {
    const lines: string[] = [
      report.preview
        ? `Files written (client: ${clientLabel}): 0 (preview — no files were written)`
        : `Files written (client: ${clientLabel}): ${report.written}`,
    ];
    if (report.writtenByClient != null) {
      for (const [client, count] of Object.entries(report.writtenByClient)) {
        lines.push(`  - ${client}: ${count}`);
      }
    }
    return lines;
  }

  /**
   * States the run's counts from the report `runSkillsSyncCommand` returns, instead of leaving
   * the caller to infer what happened from prose log lines or by inspecting folders directly.
   *
   * Renders only the fields each command actually populates: `resources` is meaningful for every
   * command that loads the canonical resource set, `pruned` only for `export` and `sync`, `drift`
   * only for `diff`, and `written` for every command that writes files — `export`/`sync`/`pull`
   * break it out by client via `writtenByClient`, `clone` does not (it parses one external file
   * rather than loading a per-client resource set, so it never populates `resources` either).
   */
  private summarizeRunReport(
    operation: Exclude<SkillsSyncOperation, 'status'>,
    args: SkillsSyncInput,
    report: SkillsSyncRunReport
  ): string {
    const lines: string[] = [];
    const clientLabel = args.client ?? 'all';

    if (operation === 'export' || operation === 'sync') {
      lines.push(`Resources loaded: ${report.resources}`);
      lines.push(...this.writtenLines(report, clientLabel));
      if (report.pruned > 0) {
        lines.push(`Managed directories pruned: ${report.pruned}`);
      }
    } else if (operation === 'diff') {
      const driftedCount = (report.drift ?? []).reduce(
        (sum, group) => sum + group.entries.length,
        0
      );
      lines.push(`Resources loaded: ${report.resources}`);
      lines.push(`Drifted resources (client: ${clientLabel}): ${driftedCount}`);
    } else if (operation === 'pull') {
      lines.push(`Resources loaded: ${report.resources}`);
      lines.push(...this.writtenLines(report, clientLabel));
    } else {
      lines.push(
        report.preview
          ? `Files written: 0 (preview — no files were written)`
          : `Files written: ${report.written}`
      );
    }

    if (report.failures.length > 0) {
      lines.push(`Failures: ${report.failures.length}`);
    }

    return lines.join('\n');
  }
}

export function createConsolidatedSkillsSync(
  logger: Logger,
  paths: SkillsSyncPaths,
  dbManager?: DatabasePort
): ConsolidatedSkillsSync {
  return new ConsolidatedSkillsSync(logger, paths, dbManager);
}
