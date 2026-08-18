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
  dry_run?: boolean;
  output?: string;
  file?: string;
  category?: string;
  preview?: boolean;
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
    const configPath = getSkillsSyncConfigPath();
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
      await runSkillsSyncCommand(
        {
          command: operation,
          client: args.client,
          scope: args.scope,
          resourceType: args.resource_type,
          id: args.id,
          prune: args.prune,
          dryRun: args.dry_run,
          output: args.output,
          file: args.file,
          category: args.category,
          preview: args.preview,
          force: args.force,
          dbManager: this.dbManager,
        },
        output
      );

      const text = logs.length > 0 ? logs.join('\n') : `skills_sync ${operation} completed.`;
      return createStructuredResponse(text, false, {
        action: operation,
        lines: logs,
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
}

export function createConsolidatedSkillsSync(
  logger: Logger,
  dbManager?: DatabasePort
): ConsolidatedSkillsSync {
  return new ConsolidatedSkillsSync(logger, dbManager);
}
