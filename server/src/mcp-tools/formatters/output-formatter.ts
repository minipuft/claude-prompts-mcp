/**
 * Standardized Output Formatter
 *
 * Provides consistent output formatting across all MCP tools with support
 * for multiple formats (compact, detailed, JSON, markdown) and metadata.
 */

import { ToolResponse } from '../../types/index.js';
import { OutputOptions, EnhancedToolResponse } from '../types/shared-types.js';
import { TOOL_NAMES } from '../constants.js';

/**
 * Standardized output formatter for all MCP tools
 */
export class OutputFormatter {
  private static readonly MAX_DESCRIPTION_LENGTH = 100;
  private static readonly TRUNCATION_SUFFIX = '...';

  /**
   * Format response with specified options
   */
  static formatResponse(
    data: unknown,
    options: OutputOptions = {
      format: 'detailed',
      includeMetadata: true
    },
    context: {
      tool: string;
      action: string;
      executionTime?: number;
    }
  ): ToolResponse {
    const timestamp = new Date().toISOString();

    switch (options.format) {
      case 'compact':
        return this.formatCompact(data, context, timestamp);
      case 'json':
        return this.formatJSON(data, context, timestamp, options.includeMetadata);
      case 'markdown':
        return this.formatMarkdown(data, context, timestamp, options.includeMetadata);
      case 'detailed':
      default:
        return this.formatDetailed(data, context, timestamp, options.includeMetadata);
    }
  }

  /**
   * Format prompt list for display
   */
  static formatPromptList(
    prompts: Array<{
      id: string;
      name?: string;
      description?: string;
      category?: string;
      type?: string;
      arguments?: Array<{ name: string; required: boolean }>;
    }>,
    options: OutputOptions = { format: 'detailed', includeMetadata: true },
    metadata?: {
      totalMatches: number;
      filterSummary?: string;
      suggestions?: string[];
    }
  ): ToolResponse {
    const context = {
      tool: TOOL_NAMES.PROMPT_MANAGER,
      action: 'list'
    };

    switch (options.format) {
      case 'compact':
        return this.formatPromptListCompact(prompts, context);
      case 'json':
        return this.formatPromptListJSON(prompts, context, metadata);
      case 'markdown':
        return this.formatPromptListMarkdown(prompts, context, metadata);
      case 'detailed':
      default:
        return this.formatPromptListDetailed(prompts, context, metadata);
    }
  }

  /**
   * Format system status for display
   */
  static formatSystemStatus(
    status: {
      system: Record<string, unknown>;
      framework?: Record<string, unknown>;
      performance?: Record<string, unknown>;
      health?: Record<string, unknown>;
    },
    options: OutputOptions = { format: 'detailed', includeMetadata: true }
  ): ToolResponse {
    const context = {
      tool: TOOL_NAMES.SYSTEM_CONTROL,
      action: 'status'
    };

    switch (options.format) {
      case 'compact':
        return this.formatSystemStatusCompact(status, context);
      case 'json':
        return this.formatSystemStatusJSON(status, context);
      case 'markdown':
        return this.formatSystemStatusMarkdown(status, context);
      case 'detailed':
      default:
        return this.formatSystemStatusDetailed(status, context);
    }
  }

  /**
   * Format compact output (minimal, script-friendly)
   */
  private static formatCompact(
    data: unknown,
    context: { tool: string; action: string },
    timestamp: string
  ): ToolResponse {
    let content: string;

    if (typeof data === 'string') {
      content = data;
    } else if (Array.isArray(data)) {
      content = data.map(item => String(item)).join('\n');
    } else {
      content = JSON.stringify(data);
    }

    return {
      content: [{
        type: "text",
        text: content
      }]
    };
  }

  /**
   * Format detailed output (human-readable with structure)
   */
  private static formatDetailed(
    data: unknown,
    context: { tool: string; action: string; executionTime?: number },
    timestamp: string,
    includeMetadata: boolean = true
  ): ToolResponse {
    let content = '';

    // Add metadata header if requested
    if (includeMetadata) {
      content += `🔧 **${context.tool}** • ${context.action} • ${new Date(timestamp).toLocaleTimeString()}`;
      if (context.executionTime) {
        content += ` • ${context.executionTime}ms`;
      }
      content += '\n\n';
    }

    // Format main content
    if (typeof data === 'string') {
      content += data;
    } else if (Array.isArray(data)) {
      content += this.formatArrayDetailed(data);
    } else if (typeof data === 'object' && data !== null) {
      content += this.formatObjectDetailed(data as Record<string, unknown>);
    } else {
      content += String(data);
    }

    return {
      content: [{
        type: "text",
        text: content
      }]
    };
  }

  /**
   * Format JSON output (machine-readable)
   */
  private static formatJSON(
    data: unknown,
    context: { tool: string; action: string; executionTime?: number },
    timestamp: string,
    includeMetadata: boolean = true
  ): ToolResponse {
    const response = {
      data,
      ...(includeMetadata && {
        metadata: {
          tool: context.tool,
          action: context.action,
          timestamp,
          executionTime: context.executionTime
        }
      })
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  /**
   * Format markdown output (rich formatting)
   */
  private static formatMarkdown(
    data: unknown,
    context: { tool: string; action: string; executionTime?: number },
    timestamp: string,
    includeMetadata: boolean = true
  ): ToolResponse {
    let content = '';

    // Add metadata header if requested
    if (includeMetadata) {
      content += `## ${context.tool} - ${context.action}\n\n`;
      content += `**Timestamp:** ${new Date(timestamp).toLocaleString()}\n`;
      if (context.executionTime) {
        content += `**Execution Time:** ${context.executionTime}ms\n`;
      }
      content += '\n---\n\n';
    }

    // Format main content
    if (typeof data === 'string') {
      content += data;
    } else if (Array.isArray(data)) {
      content += this.formatArrayMarkdown(data);
    } else if (typeof data === 'object' && data !== null) {
      content += this.formatObjectMarkdown(data as Record<string, unknown>);
    } else {
      content += `\`${String(data)}\``;
    }

    return {
      content: [{
        type: "text",
        text: content
      }]
    };
  }

  /**
   * Format prompt list in compact format
   */
  private static formatPromptListCompact(
    prompts: Array<{ id: string; name?: string }>,
    context: { tool: string; action: string }
  ): ToolResponse {
    const content = prompts.map(p => `${p.id}${p.name ? ` (${p.name})` : ''}`).join('\n');

    return {
      content: [{
        type: "text",
        text: content
      }]
    };
  }

  /**
   * Format prompt list in detailed format
   */
  private static formatPromptListDetailed(
    prompts: Array<{
      id: string;
      name?: string;
      description?: string;
      category?: string;
      type?: string;
      arguments?: Array<{ name: string; required: boolean }>;
    }>,
    context: { tool: string; action: string },
    metadata?: {
      totalMatches: number;
      filterSummary?: string;
      suggestions?: string[];
    }
  ): ToolResponse {
    let content = '';

    // Add filter summary if available
    if (metadata?.filterSummary) {
      content += `📊 **${metadata.filterSummary}**\n\n`;
    }

    // Add suggestions if available
    if (metadata?.suggestions && metadata.suggestions.length > 0) {
      content += `💡 **Suggestions:**\n${metadata.suggestions.map(s => `- ${s}`).join('\n')}\n\n`;
    }

    if (prompts.length === 0) {
      content += '📭 No prompts found matching your criteria.\n\n';
      content += '**Try:**\n';
      content += '- Broadening your search terms\n';
      content += '- Using different filter criteria\n';
      content += '- Checking category names and types\n';
    } else {
      prompts.forEach((prompt, index) => {
        content += `**${index + 1}. ${prompt.name || prompt.id}**\n`;
        content += `   ID: \`${prompt.id}\`\n`;

        if (prompt.category) {
          content += `   Category: ${prompt.category}\n`;
        }

        if (prompt.type) {
          content += `   Type: ${prompt.type}\n`;
        }

        if (prompt.description) {
          const truncatedDesc = this.truncateText(prompt.description, this.MAX_DESCRIPTION_LENGTH);
          content += `   Description: ${truncatedDesc}\n`;
        }

        if (prompt.arguments && prompt.arguments.length > 0) {
          const requiredArgs = prompt.arguments.filter(arg => arg.required);
          const optionalArgs = prompt.arguments.filter(arg => !arg.required);

          if (requiredArgs.length > 0) {
            content += `   Required: ${requiredArgs.map(arg => arg.name).join(', ')}\n`;
          }

          if (optionalArgs.length > 0) {
            content += `   Optional: ${optionalArgs.map(arg => arg.name).join(', ')}\n`;
          }
        }

        content += '\n';
      });
    }

    return {
      content: [{
        type: "text",
        text: content
      }]
    };
  }

  /**
   * Format prompt list as JSON
   */
  private static formatPromptListJSON(
    prompts: Array<Record<string, unknown>>,
    context: { tool: string; action: string },
    metadata?: Record<string, unknown>
  ): ToolResponse {
    const response = {
      prompts,
      count: prompts.length,
      ...(metadata && { metadata })
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  /**
   * Format prompt list as markdown table
   */
  private static formatPromptListMarkdown(
    prompts: Array<{
      id: string;
      name?: string;
      description?: string;
      category?: string;
      type?: string;
    }>,
    context: { tool: string; action: string },
    metadata?: {
      totalMatches: number;
      filterSummary?: string;
    }
  ): ToolResponse {
    let content = '';

    if (metadata?.filterSummary) {
      content += `## Prompt Search Results\n\n${metadata.filterSummary}\n\n`;
    }

    if (prompts.length === 0) {
      content += '*No prompts found matching your criteria.*\n';
    } else {
      content += '| ID | Name | Category | Type | Description |\n';
      content += '|----|----|----------|------|-------------|\n';

      prompts.forEach(prompt => {
        const name = prompt.name || '';
        const category = prompt.category || '';
        const type = prompt.type || '';
        const description = prompt.description
          ? this.truncateText(prompt.description, 50)
          : '';

        content += `| \`${prompt.id}\` | ${name} | ${category} | ${type} | ${description} |\n`;
      });
    }

    return {
      content: [{
        type: "text",
        text: content
      }]
    };
  }

  /**
   * Format system status in compact format
   */
  private static formatSystemStatusCompact(
    status: Record<string, unknown>,
    context: { tool: string; action: string }
  ): ToolResponse {
    const uptime = (status.system as any)?.uptime || 'unknown';
    const framework = (status.framework as any)?.active || 'none';
    const health = (status.health as any)?.status || 'unknown';

    const content = `uptime=${uptime} framework=${framework} health=${health}`;

    return {
      content: [{
        type: "text",
        text: content
      }]
    };
  }

  /**
   * Format system status in detailed format
   */
  private static formatSystemStatusDetailed(
    status: {
      system?: Record<string, unknown>;
      framework?: Record<string, unknown>;
      performance?: Record<string, unknown>;
      health?: Record<string, unknown>;
    },
    context: { tool: string; action: string }
  ): ToolResponse {
    let content = '⚙️ **System Status**\n\n';

    // System information
    if (status.system) {
      content += '**System:**\n';
      Object.entries(status.system).forEach(([key, value]) => {
        content += `- ${key}: ${String(value)}\n`;
      });
      content += '\n';
    }

    // Framework information
    if (status.framework) {
      content += '**Framework:**\n';
      Object.entries(status.framework).forEach(([key, value]) => {
        content += `- ${key}: ${String(value)}\n`;
      });
      content += '\n';
    }

    // Performance information
    if (status.performance) {
      content += '**Performance:**\n';
      Object.entries(status.performance).forEach(([key, value]) => {
        content += `- ${key}: ${String(value)}\n`;
      });
      content += '\n';
    }

    // Health information
    if (status.health) {
      content += '**Health:**\n';
      Object.entries(status.health).forEach(([key, value]) => {
        content += `- ${key}: ${String(value)}\n`;
      });
    }

    return {
      content: [{
        type: "text",
        text: content
      }]
    };
  }

  /**
   * Format system status as JSON
   */
  private static formatSystemStatusJSON(
    status: Record<string, unknown>,
    context: { tool: string; action: string }
  ): ToolResponse {
    return {
      content: [{
        type: "text",
        text: JSON.stringify(status, null, 2)
      }]
    };
  }

  /**
   * Format system status as markdown
   */
  private static formatSystemStatusMarkdown(
    status: Record<string, unknown>,
    context: { tool: string; action: string }
  ): ToolResponse {
    let content = '# System Status Report\n\n';

    Object.entries(status).forEach(([section, data]) => {
      content += `## ${section.charAt(0).toUpperCase() + section.slice(1)}\n\n`;

      if (typeof data === 'object' && data !== null) {
        Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
          content += `- **${key}:** ${String(value)}\n`;
        });
      } else {
        content += String(data);
      }

      content += '\n';
    });

    return {
      content: [{
        type: "text",
        text: content
      }]
    };
  }

  /**
   * Format array in detailed format
   */
  private static formatArrayDetailed(data: unknown[]): string {
    if (data.length === 0) {
      return '*(empty)*';
    }

    return data.map((item, index) => {
      if (typeof item === 'object' && item !== null) {
        return `**${index + 1}.** ${this.formatObjectDetailed(item as Record<string, unknown>)}`;
      } else {
        return `**${index + 1}.** ${String(item)}`;
      }
    }).join('\n\n');
  }

  /**
   * Format object in detailed format
   */
  private static formatObjectDetailed(data: Record<string, unknown>): string {
    return Object.entries(data)
      .map(([key, value]) => `- **${key}:** ${String(value)}`)
      .join('\n');
  }

  /**
   * Format array as markdown
   */
  private static formatArrayMarkdown(data: unknown[]): string {
    if (data.length === 0) {
      return '*Empty list*';
    }

    return data.map((item, index) => {
      if (typeof item === 'object' && item !== null) {
        return `${index + 1}. ${this.formatObjectMarkdown(item as Record<string, unknown>)}`;
      } else {
        return `${index + 1}. \`${String(item)}\``;
      }
    }).join('\n');
  }

  /**
   * Format object as markdown
   */
  private static formatObjectMarkdown(data: Record<string, unknown>): string {
    return Object.entries(data)
      .map(([key, value]) => `- **${key}:** \`${String(value)}\``)
      .join('\n');
  }

  /**
   * Truncate text with ellipsis
   */
  private static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxLength - this.TRUNCATION_SUFFIX.length) + this.TRUNCATION_SUFFIX;
  }

  /**
   * Create pagination info
   */
  static createPaginationInfo(
    currentPage: number,
    pageSize: number,
    totalItems: number
  ): {
    page: number;
    pageSize: number;
    total: number;
    hasNext: boolean;
    hasPrevious: boolean;
    totalPages: number;
  } {
    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      page: currentPage,
      pageSize,
      total: totalItems,
      hasNext: currentPage < totalPages,
      hasPrevious: currentPage > 1,
      totalPages
    };
  }
}