/**
 * Prompt Resources Handler
 *
 * Registers MCP resources for token-efficient prompt discovery and content retrieval.
 *
 * URI Patterns:
 * - resource://prompt/          → List all prompts (minimal metadata)
 * - resource://prompt/{id}      → Prompt metadata + template content
 * - resource://prompt/{id}/template → Raw template content only
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ResourceNotFoundError, RESOURCE_URI_PATTERNS } from '../types.js';

import type { PromptResourceMetadata, ResourceDependencies } from '../types.js';
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
 * Register prompt-related MCP resources.
 *
 * Resources read from the promptManager at request time to ensure
 * hot-reload compatibility - changes are visible immediately.
 */
export function registerPromptResources(
  server: McpServer,
  dependencies: ResourceDependencies
): void {
  const { logger, promptManager } = dependencies;

  if (promptManager === undefined) {
    logger.warn('[PromptResources] PromptManager not available, skipping registration');
    return;
  }

  // Resource: List all prompts (minimal metadata for token efficiency)
  server.registerResource(
    'prompts',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.PROMPT_LIST, {
      list: async () => {
        const prompts = promptManager.getConvertedPrompts();
        logger.debug(`[PromptResources] Listing ${prompts.length} prompts`);

        const resources: PromptResourceMetadata[] = prompts.map((p) => ({
          uri: buildUri(RESOURCE_URI_PATTERNS.PROMPT_ITEM, p.id),
          name: p.id,
          title: p.name,
          description: p.description.slice(0, 80),
          mimeType: 'text/markdown',
          type: p.chainSteps !== undefined && p.chainSteps.length > 0 ? 'chain' : 'single',
          argumentCount: p.arguments.length,
          category: p.category,
        }));

        return { resources };
      },
    }),
    {
      description: 'List of all available prompts with minimal metadata',
      mimeType: 'text/plain',
    },
    async (): Promise<ReadResourceResult> => {
      // When reading the list resource itself, return compact text format
      // Format: id: title - args (4x more token-efficient than JSON)
      const prompts = promptManager.getConvertedPrompts();
      const lines = prompts.map((p) => {
        const args =
          p.arguments.length > 0 ? ` - ${p.arguments.map((a) => a.name).join(', ')}` : '';
        return `${p.id}: ${p.name}${args}`;
      });

      return {
        contents: [
          {
            uri: buildUri(RESOURCE_URI_PATTERNS.PROMPT_LIST),
            mimeType: 'text/plain',
            text: `Prompts (${prompts.length}):\n${lines.join('\n')}`,
          },
        ],
      };
    }
  );

  // Resource: Individual prompt with full metadata and template
  server.registerResource(
    'prompt',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.PROMPT_ITEM, {
      list: undefined, // Individual items discovered via list resource
    }),
    {
      description: 'Individual prompt with metadata and template content',
      mimeType: 'text/markdown',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const id = variables['id'] as string;
      const prompts = promptManager.getConvertedPrompts();
      const prompt = prompts.find((p) => p.id === id);

      if (prompt === undefined) {
        throw new ResourceNotFoundError('Prompt', id);
      }

      logger.debug(`[PromptResources] Reading prompt: ${id}`);

      // Build full prompt content with metadata header
      const content = buildPromptContent(prompt);

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

  // Resource: Raw template content only (for minimal token usage)
  server.registerResource(
    'prompt-template',
    new ResourceTemplate(RESOURCE_URI_PATTERNS.PROMPT_TEMPLATE, {
      list: undefined, // Discovered via prompt/{id} resource
    }),
    {
      description: 'Raw prompt template content only',
      mimeType: 'text/markdown',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const id = variables['id'] as string;
      const prompts = promptManager.getConvertedPrompts();
      const prompt = prompts.find((p) => p.id === id);

      if (prompt === undefined) {
        throw new ResourceNotFoundError('Prompt', id);
      }

      logger.debug(`[PromptResources] Reading template for: ${id}`);

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'text/markdown',
            text: prompt.userMessageTemplate,
          },
        ],
      };
    }
  );

  logger.info('[PromptResources] Registered prompt resources');
}

/**
 * Build formatted prompt content with metadata header and template
 */
function buildPromptContent(prompt: {
  id: string;
  name: string;
  description: string;
  category: string;
  systemMessage?: string;
  userMessageTemplate: string;
  arguments: Array<{ name: string; type?: string; description?: string; required?: boolean }>;
  chainSteps?: Array<{ promptId: string; stepName: string }>;
}): string {
  const lines: string[] = [];

  // Metadata header
  lines.push(`# ${prompt.name}`);
  lines.push('');
  lines.push(`**ID:** \`${prompt.id}\``);
  lines.push(`**Category:** ${prompt.category}`);
  lines.push(
    `**Type:** ${prompt.chainSteps !== undefined && prompt.chainSteps.length > 0 ? 'chain' : 'single'}`
  );

  if (prompt.description !== '') {
    lines.push('');
    lines.push(`> ${prompt.description}`);
  }

  // Arguments section
  if (prompt.arguments.length > 0) {
    lines.push('');
    lines.push('## Arguments');
    lines.push('');
    for (const arg of prompt.arguments) {
      const required = arg.required !== false ? '(required)' : '(optional)';
      const desc = arg.description ?? arg.type ?? 'string';
      lines.push(`- **${arg.name}** ${required}: ${desc}`);
    }
  }

  // Chain steps summary (if chain)
  if (prompt.chainSteps !== undefined && prompt.chainSteps.length > 0) {
    lines.push('');
    lines.push('## Chain Steps');
    lines.push('');
    lines.push(
      `${prompt.chainSteps.length} steps: ${prompt.chainSteps.map((s) => s.stepName).join(' → ')}`
    );
  }

  // System message (if present)
  if (prompt.systemMessage !== undefined && prompt.systemMessage !== '') {
    lines.push('');
    lines.push('## System Message');
    lines.push('');
    lines.push('```');
    lines.push(prompt.systemMessage);
    lines.push('```');
  }

  // Template
  lines.push('');
  lines.push('## Template');
  lines.push('');
  lines.push('```markdown');
  lines.push(prompt.userMessageTemplate);
  lines.push('```');

  return lines.join('\n');
}
