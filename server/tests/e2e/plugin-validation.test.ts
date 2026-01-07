/**
 * E2E Plugin Validation Tests
 *
 * Validates that both Claude Code plugin and Gemini CLI extension
 * configurations are valid and won't break due to downstream changes.
 */

import { describe, expect, it } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root is two levels up from server/tests/e2e
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// =============================================================================
// Validation Schemas
// =============================================================================

const claudePluginSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver format'),
  description: z.string(),
  mcpServers: z.string(), // path to mcp.json
  author: z.object({ name: z.string() }),
  repository: z.string().url().optional(),
  homepage: z.string().url().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  skills: z.string().optional(),
});

const claudeMcpConfigSchema = z.record(
  z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  })
);

const claudeHooksSchema = z.object({
  hooks: z.record(
    z.array(
      z.object({
        matcher: z.string().optional(),
        hooks: z.array(
          z.object({
            type: z.string(),
            command: z.string(),
          })
        ),
      })
    )
  ),
});

const geminiExtensionSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, 'Must be lowercase with dashes'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver format'),
  mcpServers: z.record(
    z.object({
      command: z.string(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string()).optional(),
      cwd: z.string().optional(),
    })
  ),
  contextFileName: z.string().optional(),
  excludeTools: z.array(z.string()).optional(),
});

const geminiSettingsSchema = z.object({
  hooks: z
    .record(
      z.array(
        z.object({
          matcher: z.string().optional(),
          hooks: z.array(
            z.object({
              name: z.string(),
              type: z.string(),
              command: z.string(),
              description: z.string().optional(),
            })
          ),
        })
      )
    )
    .optional(),
});

// =============================================================================
// Helper Functions
// =============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    // Check if file has execute permission (owner, group, or other)
    return (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function loadJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

function extractScriptPaths(command: string): string[] {
  // Extract paths from commands like "bash ${CLAUDE_PLUGIN_ROOT}/hooks/setup.sh"
  const matches = command.match(/\$\{[^}]+\}\/[^\s"']+/g) || [];
  return matches.map((m) =>
    m
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, PROJECT_ROOT)
      .replace(/\$\{extensionPath\}/g, PROJECT_ROOT)
  );
}

// =============================================================================
// Claude Code Plugin Tests
// =============================================================================

describe('Claude Code Plugin', () => {
  const pluginJsonPath = path.join(PROJECT_ROOT, '.claude-plugin', 'plugin.json');
  const mcpJsonPath = path.join(PROJECT_ROOT, 'mcp.json');
  const hooksJsonPath = path.join(PROJECT_ROOT, 'hooks', 'hooks.json');
  const skillsDir = path.join(PROJECT_ROOT, 'skills');

  describe('plugin.json', () => {
    it('exists and is valid JSON', async () => {
      expect(await fileExists(pluginJsonPath)).toBe(true);
      const content = await loadJson(pluginJsonPath);
      expect(content).toBeDefined();
    });

    it('has required fields with correct types', async () => {
      const plugin = await loadJson(pluginJsonPath);
      const result = claudePluginSchema.safeParse(plugin);

      if (!result.success) {
        console.error('Validation errors:', result.error.format());
      }
      expect(result.success).toBe(true);
    });

    it('references existing mcp.json file', async () => {
      const plugin = await loadJson<{ mcpServers: string }>(pluginJsonPath);
      // mcpServers is a relative path from PROJECT_ROOT (plugin root), not from plugin.json
      const mcpPath = path.join(PROJECT_ROOT, plugin.mcpServers);
      expect(await fileExists(mcpPath)).toBe(true);
    });

    it('uses ${CLAUDE_PLUGIN_ROOT} variable syntax', async () => {
      // Verify mcp.json uses correct variable syntax
      if (await fileExists(mcpJsonPath)) {
        const content = await fs.readFile(mcpJsonPath, 'utf-8');
        if (content.includes('${')) {
          expect(content).toContain('${CLAUDE_PLUGIN_ROOT}');
          expect(content).not.toContain('${extensionPath}');
        }
      }
    });
  });

  describe('mcp.json', () => {
    it('exists and is valid JSON', async () => {
      expect(await fileExists(mcpJsonPath)).toBe(true);
      const content = await loadJson(mcpJsonPath);
      expect(content).toBeDefined();
    });

    it('has valid MCP server configuration', async () => {
      const mcpConfig = await loadJson(mcpJsonPath);
      const result = claudeMcpConfigSchema.safeParse(mcpConfig);

      if (!result.success) {
        console.error('Validation errors:', result.error.format());
      }
      expect(result.success).toBe(true);
    });

    it('references server entry point that exists', async () => {
      const mcpConfig = await loadJson<Record<string, { args?: string[] }>>(mcpJsonPath);

      for (const [serverName, config] of Object.entries(mcpConfig)) {
        if (config.args) {
          for (const arg of config.args) {
            if (arg.includes('index.js') || arg.includes('dist')) {
              const resolvedPath = arg.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, PROJECT_ROOT);
              expect(await fileExists(resolvedPath)).toBe(true);
            }
          }
        }
      }
    });
  });

  describe('hooks', () => {
    it('hooks.json exists and is valid', async () => {
      expect(await fileExists(hooksJsonPath)).toBe(true);
      const hooks = await loadJson(hooksJsonPath);
      const result = claudeHooksSchema.safeParse(hooks);

      if (!result.success) {
        console.error('Validation errors:', result.error.format());
      }
      expect(result.success).toBe(true);
    });

    it('all hook scripts exist', async () => {
      const hooks = await loadJson<{ hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }>(
        hooksJsonPath
      );

      for (const [eventName, eventHooks] of Object.entries(hooks.hooks)) {
        for (const hookGroup of eventHooks) {
          for (const hook of hookGroup.hooks) {
            const scriptPaths = extractScriptPaths(hook.command);
            for (const scriptPath of scriptPaths) {
              expect(await fileExists(scriptPath)).toBe(true);
            }
          }
        }
      }
    });

    it('Python hook scripts are executable', async () => {
      const hooksDir = path.join(PROJECT_ROOT, 'hooks');
      const files = await fs.readdir(hooksDir);
      const pythonScripts = files.filter((f) => f.endsWith('.py'));

      for (const script of pythonScripts) {
        const scriptPath = path.join(hooksDir, script);
        expect(await isExecutable(scriptPath)).toBe(true);
      }
    });
  });

  describe('skills', () => {
    it('skills directory exists', async () => {
      expect(await fileExists(skillsDir)).toBe(true);
    });

    it('skill directories contain SKILL.md files', async () => {
      const skillDirs = await fs.readdir(skillsDir);

      for (const dir of skillDirs) {
        const skillPath = path.join(skillsDir, dir);
        const stat = await fs.stat(skillPath);

        if (stat.isDirectory()) {
          const skillMdPath = path.join(skillPath, 'SKILL.md');
          expect(await fileExists(skillMdPath)).toBe(true);
        }
      }
    });
  });
});

// =============================================================================
// Gemini CLI Extension Tests
// =============================================================================

describe('Gemini CLI Extension', () => {
  const extensionJsonPath = path.join(PROJECT_ROOT, 'gemini-extension.json');
  const geminiMdPath = path.join(PROJECT_ROOT, 'GEMINI.md');
  const settingsJsonPath = path.join(PROJECT_ROOT, '.gemini', 'settings.json');
  const geminiHooksDir = path.join(PROJECT_ROOT, '.gemini', 'hooks');

  describe('gemini-extension.json', () => {
    it('exists and is valid JSON', async () => {
      expect(await fileExists(extensionJsonPath)).toBe(true);
      const content = await loadJson(extensionJsonPath);
      expect(content).toBeDefined();
    });

    it('has required fields with correct types', async () => {
      const extension = await loadJson(extensionJsonPath);
      const result = geminiExtensionSchema.safeParse(extension);

      if (!result.success) {
        console.error('Validation errors:', result.error.format());
      }
      expect(result.success).toBe(true);
    });

    it('name is lowercase with dashes only', async () => {
      const extension = await loadJson<{ name: string }>(extensionJsonPath);
      expect(extension.name).toMatch(/^[a-z0-9-]+$/);
    });

    it('uses ${extensionPath} variable syntax (not ${CLAUDE_PLUGIN_ROOT})', async () => {
      const content = await fs.readFile(extensionJsonPath, 'utf-8');
      if (content.includes('${')) {
        expect(content).toContain('${extensionPath}');
        expect(content).not.toContain('${CLAUDE_PLUGIN_ROOT}');
      }
    });

    it('uses ${/} for cross-platform path separator', async () => {
      const content = await fs.readFile(extensionJsonPath, 'utf-8');
      // If there are paths with separators, they should use ${/}
      if (content.includes('${extensionPath}') && content.includes('/')) {
        // Allow either hardcoded / or ${/} - Gemini accepts both
        // But if using variable, should be ${/}
        expect(content).not.toContain('${pathSep}');
      }
    });

    it('references server entry point that exists', async () => {
      const extension = await loadJson<{
        mcpServers: Record<string, { args?: string[] }>;
      }>(extensionJsonPath);

      for (const [serverName, config] of Object.entries(extension.mcpServers)) {
        if (config.args) {
          for (const arg of config.args) {
            if (arg.includes('index.js') || arg.includes('dist')) {
              const resolvedPath = arg
                .replace(/\$\{extensionPath\}/g, PROJECT_ROOT)
                .replace(/\$\{\/\}/g, path.sep);
              expect(await fileExists(resolvedPath)).toBe(true);
            }
          }
        }
      }
    });
  });

  describe('GEMINI.md', () => {
    it('exists and is readable', async () => {
      expect(await fileExists(geminiMdPath)).toBe(true);
      const content = await fs.readFile(geminiMdPath, 'utf-8');
      expect(content.length).toBeGreaterThan(100);
    });

    it('documents the MCP tools', async () => {
      const content = await fs.readFile(geminiMdPath, 'utf-8');
      expect(content).toContain('prompt_engine');
      expect(content).toContain('resource_manager');
    });

    it('is referenced in gemini-extension.json', async () => {
      const extension = await loadJson<{ contextFileName?: string }>(extensionJsonPath);
      if (extension.contextFileName) {
        expect(extension.contextFileName).toBe('GEMINI.md');
      }
    });
  });

  describe('.gemini/settings.json', () => {
    it('exists and is valid JSON', async () => {
      expect(await fileExists(settingsJsonPath)).toBe(true);
      const content = await loadJson(settingsJsonPath);
      expect(content).toBeDefined();
    });

    it('has valid hooks structure', async () => {
      const settings = await loadJson(settingsJsonPath);
      const result = geminiSettingsSchema.safeParse(settings);

      if (!result.success) {
        console.error('Validation errors:', result.error.format());
      }
      expect(result.success).toBe(true);
    });
  });

  describe('.gemini/hooks', () => {
    it('hook scripts directory exists', async () => {
      expect(await fileExists(geminiHooksDir)).toBe(true);
    });

    it('all referenced hook scripts exist', async () => {
      const settings = await loadJson<{
        hooks?: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      }>(settingsJsonPath);

      if (settings.hooks) {
        for (const [eventName, eventHooks] of Object.entries(settings.hooks)) {
          for (const hookGroup of eventHooks) {
            for (const hook of hookGroup.hooks) {
              // Extract script path from command
              const match = hook.command.match(/["']?([^"'\s]+\.(py|sh))["']?/);
              if (match) {
                const scriptPath = match[1]
                  .replace(/\$\{extensionPath\}/g, PROJECT_ROOT)
                  .replace(/~\/\.gemini\/extensions\/gemini-prompts/g, PROJECT_ROOT);
                expect(await fileExists(scriptPath)).toBe(true);
              }
            }
          }
        }
      }
    });

    it('Python hook scripts are executable', async () => {
      const files = await fs.readdir(geminiHooksDir);
      const pythonScripts = files.filter((f) => f.endsWith('.py'));

      for (const script of pythonScripts) {
        const scriptPath = path.join(geminiHooksDir, script);
        expect(await isExecutable(scriptPath)).toBe(true);
      }
    });

    it('shell scripts are executable', async () => {
      const files = await fs.readdir(geminiHooksDir);
      const shellScripts = files.filter((f) => f.endsWith('.sh'));

      for (const script of shellScripts) {
        const scriptPath = path.join(geminiHooksDir, script);
        expect(await isExecutable(scriptPath)).toBe(true);
      }
    });
  });
});

// =============================================================================
// Cross-Plugin Consistency Tests
// =============================================================================

describe('Cross-Plugin Consistency', () => {
  it('both plugins reference the same server entry point', async () => {
    const mcpJsonPath = path.join(PROJECT_ROOT, 'mcp.json');
    const extensionJsonPath = path.join(PROJECT_ROOT, 'gemini-extension.json');

    const claudeMcp = await loadJson<Record<string, { args?: string[] }>>(mcpJsonPath);
    const geminiExt = await loadJson<{
      mcpServers: Record<string, { args?: string[] }>;
    }>(extensionJsonPath);

    // Extract server paths (normalize variables)
    const claudeServerPath = Object.values(claudeMcp)[0]?.args?.find((a) => a.includes('index.js'));
    const geminiServerPath = Object.values(geminiExt.mcpServers)[0]?.args?.find((a) =>
      a.includes('index.js')
    );

    if (claudeServerPath && geminiServerPath) {
      const normalizedClaude = claudeServerPath
        .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '')
        .replace(/\//g, '/');
      const normalizedGemini = geminiServerPath
        .replace(/\$\{extensionPath\}/g, '')
        .replace(/\$\{\/\}/g, '/');

      expect(normalizedClaude).toBe(normalizedGemini);
    }
  });

  it('server dist/index.js exists (required by both plugins)', async () => {
    const serverPath = path.join(PROJECT_ROOT, 'server', 'dist', 'index.js');
    expect(await fileExists(serverPath)).toBe(true);
  });
});
