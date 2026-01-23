/**
 * Gate Resources Handler
 *
 * Registers MCP resources for token-efficient gate discovery and guidance retrieval.
 *
 * URI Patterns:
 * - resource://gate/           → List all gates (minimal metadata)
 * - resource://gate/{id}       → Gate definition + guidance content
 * - resource://gate/{id}/guidance → Raw guidance.md content only
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ResourceNotFoundError, RESOURCE_URI_PATTERNS } from '../types.js';

import type { GateResourceMetadata, ResourceDependencies } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Build resource URI from pattern and optional ID
 * Patterns already include the full URI scheme (resource://...)
 */
function buildUri(pattern: string, id?: string): string {
  if (id !== undefined && id !== '') {
    return pattern.replace('{id}', id);
  }
  return pattern;
}

/**
 * Register gate-related MCP resources.
 *
 * Resources read from the gateManager at request time to ensure
 * hot-reload compatibility - changes are visible immediately.
 */
export function registerGateResources(server: McpServer, dependencies: ResourceDependencies): void {
  const { logger, gateManager } = dependencies;

  if (gateManager === undefined) {
    logger.warn('[GateResources] GateManager not available, skipping registration');
    return;
  }

  // Resource: List all gates (minimal metadata for token efficiency)
  server.registerResource(
    'gates',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.GATE_LIST, {
      list: async () => {
        const guides = gateManager.list(false); // Include disabled gates
        logger.debug(`[GateResources] Listing ${guides.length} gates`);

        const resources: GateResourceMetadata[] = guides.map((g) => ({
          uri: buildUri(RESOURCE_URI_PATTERNS.GATE_ITEM, g.gateId),
          name: g.gateId,
          title: g.name,
          description: g.description.slice(0, 80),
          mimeType: 'text/markdown',
          type: g.type,
          enabled: true, // All guides from list are registered
          severity: g.severity,
        }));

        return { resources };
      },
    }),
    {
      description: 'List of all available gates with minimal metadata',
      mimeType: 'text/plain',
    },
    async (): Promise<ReadResourceResult> => {
      // When reading the list resource itself, return compact text format
      // Format: id: name (type) - 4x more token-efficient than JSON
      const guides = gateManager.list(false);
      const lines = guides.map((g) => `${g.gateId}: ${g.name} (${g.type})`);

      return {
        contents: [
          {
            uri: buildUri(RESOURCE_URI_PATTERNS.GATE_LIST),
            mimeType: 'text/plain',
            text: `Gates (${guides.length}):\n${lines.join('\n')}`,
          },
        ],
      };
    }
  );

  // Resource: Individual gate with full definition and guidance
  server.registerResource(
    'gate',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.GATE_ITEM, {
      list: undefined, // Individual items discovered via list resource
    }),
    {
      description: 'Individual gate with definition and guidance content',
      mimeType: 'text/markdown',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const id = variables['id'] as string;

      const guide = gateManager.get(id);

      if (guide === undefined) {
        throw new ResourceNotFoundError('Gate', id);
      }

      logger.debug(`[GateResources] Reading gate: ${id}`);

      // Build full gate content with metadata header
      const content = buildGateContent(guide);

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'text/markdown',
            text: content,
          },
        ],
      };
    }
  );

  // Resource: Raw guidance content only (for minimal token usage)
  server.registerResource(
    'gate-guidance',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.GATE_GUIDANCE, {
      list: undefined, // Discovered via gate/{id} resource
    }),
    {
      description: 'Raw gate guidance content only',
      mimeType: 'text/markdown',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const id = variables['id'] as string;

      const guide = gateManager.get(id);

      if (guide === undefined) {
        throw new ResourceNotFoundError('Gate', id);
      }

      logger.debug(`[GateResources] Reading guidance for: ${id}`);

      const guidance = guide.getGuidance();

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'text/markdown',
            text: guidance !== '' ? guidance : '(No guidance content)',
          },
        ],
      };
    }
  );

  logger.info('[GateResources] Registered gate resources');
}

/**
 * Build formatted gate content with metadata header and guidance
 */
function buildGateContent(guide: {
  gateId: string;
  name: string;
  description: string;
  type: 'validation' | 'guidance';
  severity: 'critical' | 'high' | 'medium' | 'low';
  getGuidance(): string;
}): string {
  const lines: string[] = [];

  // Metadata header
  lines.push(`# ${guide.name}`);
  lines.push('');
  lines.push(`**ID:** \`${guide.gateId}\``);
  lines.push(`**Type:** ${guide.type}`);
  lines.push(`**Severity:** ${guide.severity}`);

  if (guide.description !== '') {
    lines.push('');
    lines.push(`> ${guide.description}`);
  }

  // Guidance content
  const guidance = guide.getGuidance();
  if (guidance !== '') {
    lines.push('');
    lines.push('## Guidance');
    lines.push('');
    lines.push(guidance);
  }

  return lines.join('\n');
}
