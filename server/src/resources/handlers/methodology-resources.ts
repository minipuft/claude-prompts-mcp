/**
 * Methodology Resources Handler
 *
 * Registers MCP resources for token-efficient methodology/framework discovery and content retrieval.
 *
 * URI Patterns:
 * - resource://methodology/              → List all methodologies (minimal metadata)
 * - resource://methodology/{id}          → Methodology definition + guidelines
 * - resource://methodology/{id}/system-prompt → Raw system prompt template only
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ResourceNotFoundError, RESOURCE_URI_PATTERNS } from '../types.js';

import type { MethodologyResourceMetadata, ResourceDependencies } from '../types.js';
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
 * Register methodology-related MCP resources.
 *
 * Resources read from the frameworkManager at request time to ensure
 * hot-reload compatibility - changes are visible immediately.
 */
export function registerMethodologyResources(
  server: McpServer,
  dependencies: ResourceDependencies
): void {
  const { logger, frameworkManager } = dependencies;

  if (frameworkManager === undefined) {
    logger.warn('[MethodologyResources] FrameworkManager not available, skipping registration');
    return;
  }

  // Resource: List all methodologies (minimal metadata for token efficiency)
  server.registerResource(
    'methodologies',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.METHODOLOGY_LIST, {
      list: async () => {
        const frameworks = frameworkManager.listFrameworks(false); // Include disabled
        logger.debug(`[MethodologyResources] Listing ${frameworks.length} methodologies`);

        const resources: MethodologyResourceMetadata[] = frameworks.map((f) => ({
          uri: buildUri(RESOURCE_URI_PATTERNS.METHODOLOGY_ITEM, f.id),
          name: f.id,
          title: f.name,
          description: f.description.slice(0, 80),
          mimeType: 'text/markdown',
          type: f.type,
          enabled: f.enabled,
          priority: f.priority,
        }));

        return { resources };
      },
    }),
    {
      description: 'List of all available methodologies/frameworks with minimal metadata',
      mimeType: 'text/plain',
    },
    async (): Promise<ReadResourceResult> => {
      // When reading the list resource itself, return compact text format
      // Format: id: name [disabled] - 4x more token-efficient than JSON
      const frameworks = frameworkManager.listFrameworks(false);
      const lines = frameworks.map((f) => {
        const status = f.enabled ? '' : ' [disabled]';
        return `${f.id}: ${f.name}${status}`;
      });

      return {
        contents: [
          {
            uri: buildUri(RESOURCE_URI_PATTERNS.METHODOLOGY_LIST),
            mimeType: 'text/plain',
            text: `Methodologies (${frameworks.length}):\n${lines.join('\n')}`,
          },
        ],
      };
    }
  );

  // Resource: Individual methodology with full definition and guidelines
  server.registerResource(
    'methodology',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.METHODOLOGY_ITEM, {
      list: undefined, // Individual items discovered via list resource
    }),
    {
      description: 'Individual methodology with definition and execution guidelines',
      mimeType: 'text/markdown',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const id = variables['id'] as string;

      const framework = frameworkManager.getFramework(id);

      if (framework === undefined) {
        throw new ResourceNotFoundError('Methodology', id);
      }

      logger.debug(`[MethodologyResources] Reading methodology: ${id}`);

      // Build full methodology content with metadata header
      const content = buildMethodologyContent(framework);

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

  // Resource: Raw system prompt template only (for minimal token usage)
  server.registerResource(
    'methodology-system-prompt',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.METHODOLOGY_SYSTEM_PROMPT, {
      list: undefined, // Discovered via methodology/{id} resource
    }),
    {
      description: 'Raw methodology system prompt template only',
      mimeType: 'text/markdown',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const id = variables['id'] as string;

      const framework = frameworkManager.getFramework(id);

      if (framework === undefined) {
        throw new ResourceNotFoundError('Methodology', id);
      }

      logger.debug(`[MethodologyResources] Reading system prompt for: ${id}`);

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'text/markdown',
            text:
              framework.systemPromptTemplate.length > 0
                ? framework.systemPromptTemplate
                : '(No system prompt template)',
          },
        ],
      };
    }
  );

  logger.info('[MethodologyResources] Registered methodology resources');
}

/**
 * Build formatted methodology content with metadata header and guidelines
 */
function buildMethodologyContent(framework: {
  id: string;
  name: string;
  description: string;
  type: string;
  systemPromptTemplate: string;
  executionGuidelines: string[];
  priority: number;
  enabled: boolean;
}): string {
  const lines: string[] = [];

  // Metadata header
  lines.push(`# ${framework.name}`);
  lines.push('');
  lines.push(`**ID:** \`${framework.id}\``);
  lines.push(`**Type:** ${framework.type}`);
  lines.push(`**Priority:** ${framework.priority}`);
  lines.push(`**Enabled:** ${framework.enabled ? 'Yes' : 'No'}`);

  if (framework.description.length > 0) {
    lines.push('');
    lines.push(`> ${framework.description}`);
  }

  // Execution guidelines
  if (framework.executionGuidelines.length > 0) {
    lines.push('');
    lines.push('## Execution Guidelines');
    lines.push('');
    for (const guideline of framework.executionGuidelines) {
      lines.push(`- ${guideline}`);
    }
  }

  // System prompt template (truncated preview)
  if (framework.systemPromptTemplate !== '') {
    lines.push('');
    lines.push('## System Prompt Template');
    lines.push('');
    const preview =
      framework.systemPromptTemplate.length > 500
        ? framework.systemPromptTemplate.slice(0, 500) + '...'
        : framework.systemPromptTemplate;
    lines.push('```markdown');
    lines.push(preview);
    lines.push('```');
    if (framework.systemPromptTemplate.length > 500) {
      lines.push('');
      lines.push(
        `*Full template available at \`resource://methodology/${framework.id}/system-prompt\`*`
      );
    }
  }

  return lines.join('\n');
}
