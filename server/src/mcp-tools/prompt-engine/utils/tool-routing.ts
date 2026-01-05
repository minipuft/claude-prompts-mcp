// @lifecycle canonical - Routes MCP tool invocations to implementations.
export interface ToolRoutingResult {
  requiresRouting: boolean;
  targetTool?: string;
  translatedParams?: Record<string, any>;
  originalCommand?: string;
}

const LIST_PROMPTS_PATTERN = /^(>>|\/)?listprompts?(\s.+)?$/i;
const HELP_PATTERN = /^(>>|\/)?help(?:\s+(.*))?$/i;
const STATUS_PATTERN = /^(>>|\/)?status$/i;
const FRAMEWORK_PATTERN = /^(>>|\/)?framework\s+(switch|change)\s+(.+)$/i;
const ANALYTICS_PATTERN = /^(>>|\/)?analytics?$/i;
const GUIDE_PATTERN = /^(>>|\/)?guide(?:\s+(.*))?$/i;
const GATES_PATTERN = /^(>>|\/)?gates?(?:\s+(.*))?$/i;
const ALLOWED_PREFIX_TOKENS = ['@', '%judge', '%clean', '%lean'];

function isPlausiblePromptId(token: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_\/-]*$/.test(token);
}

/**
 * Detects whether a raw command string should be routed to an internal handler
 * (prompt manager, system control, etc.) before the prompt engine attempts to
 * parse it as a template/chain instruction.
 */
export function detectToolRoutingCommand(command: string): ToolRoutingResult {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    return { requiresRouting: false };
  }

  if (LIST_PROMPTS_PATTERN.test(trimmedCommand)) {
    const args = trimmedCommand.replace(/^(?:>>|\/)?listprompts?\s?/i, '').trim();
    return {
      requiresRouting: true,
      targetTool: 'prompt_manager',
      translatedParams: {
        action: 'list',
        ...(args && { search_query: args }),
      },
      originalCommand: command,
    };
  }

  const guideMatch = trimmedCommand.match(GUIDE_PATTERN);
  if (guideMatch) {
    const goal = (guideMatch[2] ?? '').trim();
    return {
      requiresRouting: true,
      targetTool: 'prompt_engine_guide',
      translatedParams: { goal },
      originalCommand: command,
    };
  }

  const helpMatch = trimmedCommand.match(HELP_PATTERN);
  if (helpMatch) {
    const topic = (helpMatch[2] ?? '').trim();
    return {
      requiresRouting: true,
      targetTool: 'system_control',
      translatedParams: topic ? { action: 'guide', topic } : { action: 'guide' },
      originalCommand: command,
    };
  }

  if (STATUS_PATTERN.test(trimmedCommand)) {
    return {
      requiresRouting: true,
      targetTool: 'system_control',
      translatedParams: { action: 'status' },
      originalCommand: command,
    };
  }

  const frameworkMatch = trimmedCommand.match(FRAMEWORK_PATTERN);
  if (frameworkMatch?.[3]) {
    return {
      requiresRouting: true,
      targetTool: 'system_control',
      translatedParams: {
        action: 'framework',
        operation: 'switch',
        framework: frameworkMatch[3].trim(),
      },
      originalCommand: command,
    };
  }

  if (ANALYTICS_PATTERN.test(trimmedCommand)) {
    return {
      requiresRouting: true,
      targetTool: 'system_control',
      translatedParams: { action: 'analytics' },
      originalCommand: command,
    };
  }

  // >>gates command - list available canonical gates with optional search
  const gatesMatch = trimmedCommand.match(GATES_PATTERN);
  if (gatesMatch) {
    const searchTerm = (gatesMatch[2] ?? '').trim();
    return {
      requiresRouting: true,
      targetTool: 'system_control',
      translatedParams: {
        action: 'gates',
        operation: 'list',
        ...(searchTerm && { search_query: searchTerm }),
      },
      originalCommand: command,
    };
  }

  if (trimmedCommand.startsWith('>>')) {
    const rest = trimmedCommand.slice(2).trimStart();
    const firstToken = rest.split(/\s+/)[0] ?? '';
    const isAllowedPrefix = ALLOWED_PREFIX_TOKENS.some((prefix) =>
      rest.toLowerCase().startsWith(prefix)
    );

    if (!rest || (!isAllowedPrefix && !isPlausiblePromptId(firstToken))) {
      return {
        requiresRouting: true,
        targetTool: 'prompt_engine_invalid_command',
        translatedParams: {
          reason: 'missing-or-invalid-prompt-id',
        },
        originalCommand: command,
      };
    }
  }

  return { requiresRouting: false };
}
