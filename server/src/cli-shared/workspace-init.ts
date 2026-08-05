/**
 * Workspace initialization — extracted from server/src/index.ts.
 *
 * Pure function using only node:fs and node:path.
 * No runtime, config, or logging dependencies.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type StarterPrompt = {
  id: string;
  category: string;
  description: string;
  userMessageTemplate: string;
  arguments: Array<{ name: string; type: 'string'; description: string }>;
};

export type WorkspaceInitResult = {
  success: boolean;
  message: string;
};

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: 'quick_review',
    category: 'development',
    description: 'Fast review focusing on bugs and security issues.',
    userMessageTemplate:
      'Review this code for bugs, security issues, and obvious improvements. Be concise and actionable.\n\n```\n{{code}}\n```',
    arguments: [{ name: 'code', type: 'string', description: 'Code to review.' }],
  },
  {
    id: 'explain',
    category: 'development',
    description: 'Clear explanation of how code works.',
    userMessageTemplate:
      'Explain how this code works. Start with a one-sentence summary, then break down the key parts.\n\n```\n{{code}}\n```',
    arguments: [{ name: 'code', type: 'string', description: 'Code to explain.' }],
  },
  {
    id: 'improve',
    category: 'development',
    description: 'Actionable suggestions to improve code quality.',
    userMessageTemplate:
      'Suggest improvements for this code. Focus on:\n- Readability\n- Performance\n- Best practices\n\nProvide before/after examples where helpful.\n\n```\n{{code}}\n```',
    arguments: [{ name: 'code', type: 'string', description: 'Code to improve.' }],
  },
];

export function formatStarterPromptYaml(prompt: StarterPrompt): string {
  const descriptionLines = prompt.description.split('\n').map((line) => `  ${line}`);
  const argsLines = prompt.arguments.flatMap((arg) => [
    `  - name: ${arg.name}`,
    `    type: ${arg.type}`,
    `    description: ${arg.description}`,
  ]);

  return [
    `id: ${prompt.id}`,
    `name: ${prompt.id}`,
    `category: ${prompt.category}`,
    `description: >-`,
    ...descriptionLines,
    `userMessageTemplateFile: user-message.md`,
    `arguments:`,
    ...argsLines,
    '',
  ].join('\n');
}

/**
 * Initialize a new workspace with starter prompts.
 */
export function initWorkspace(targetPath: string): WorkspaceInitResult {
  try {
    const workspacePath = resolve(targetPath);
    const promptsDir = join(workspacePath, 'resources', 'prompts');

    // Check if workspace already exists (check both new and legacy paths)
    const legacyPromptsDir = join(workspacePath, 'prompts');
    if (
      (existsSync(promptsDir) && readdirSync(promptsDir).length > 0) ||
      (existsSync(legacyPromptsDir) && readdirSync(legacyPromptsDir).length > 0)
    ) {
      return {
        success: false,
        message: `Workspace already exists at ${workspacePath}\nFound prompts directory (non-empty)`,
      };
    }

    // Create directories
    mkdirSync(promptsDir, { recursive: true });

    const createdFiles: string[] = [];
    for (const prompt of STARTER_PROMPTS) {
      const promptDir = join(promptsDir, prompt.category, prompt.id);
      mkdirSync(promptDir, { recursive: true });

      const promptYamlPath = join(promptDir, 'prompt.yaml');
      writeFileSync(promptYamlPath, formatStarterPromptYaml(prompt), 'utf8');
      createdFiles.push(promptYamlPath);

      const userMessagePath = join(promptDir, 'user-message.md');
      writeFileSync(userMessagePath, `${prompt.userMessageTemplate.trimEnd()}\n`, 'utf8');
      createdFiles.push(userMessagePath);
    }

    return {
      success: true,
      message: `
\u2705 Workspace created at: ${workspacePath}

Created files:
  ${createdFiles.map((f) => `\n  ${f}`).join('')}

Next steps:

1. Add to your Claude Desktop config (~/.config/claude/claude_desktop_config.json):

   {
     "mcpServers": {
       "claude-prompts": {
         "command": "npx",
         "args": ["-y", "claude-prompts@latest"],
         "env": {
           "MCP_WORKSPACE": "${workspacePath}"
         }
       }
     }
   }

2. Restart Claude Desktop

3. Test with: resource_manager(resource_type: "prompt", action: "list")

4. Edit prompts directly or ask Claude:
   "Update the quick_review prompt to also check for TypeScript errors"

   Claude will use resource_manager to update your prompts automatically!

\ud83d\udcd6 Full docs: https://github.com/minipuft/claude-prompts
`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create workspace: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
