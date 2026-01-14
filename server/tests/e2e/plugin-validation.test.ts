/**
 * E2E Plugin Validation Tests
 *
 * Validates that Claude Code plugin configuration is valid
 * and won't break due to downstream changes.
 *
 * Note: Gemini CLI extension tests have been moved to the gemini-prompts repo.
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

// Current plugin.json schema (without mcpServers - uses .mcp.json separately)
const claudePluginSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver format'),
  description: z.string(),
  author: z.object({ name: z.string() }),
  repository: z.string().optional(),
  homepage: z.string().url().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});

// .mcp.json schema - MCP server configuration
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
  return matches.map((m) => m.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, PROJECT_ROOT));
}

// =============================================================================
// Claude Code Plugin Tests
// =============================================================================

describe('Claude Code Plugin', () => {
  const pluginJsonPath = path.join(PROJECT_ROOT, '.claude-plugin', 'plugin.json');
  const mcpJsonPath = path.join(PROJECT_ROOT, '.mcp.json'); // Note: dot prefix
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

    it('version matches server package.json', async () => {
      const plugin = await loadJson<{ version: string }>(pluginJsonPath);
      const serverPkg = await loadJson<{ version: string }>(
        path.join(PROJECT_ROOT, 'server', 'package.json')
      );
      expect(plugin.version).toBe(serverPkg.version);
    });
  });

  describe('.mcp.json', () => {
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

    it('uses ${CLAUDE_PLUGIN_ROOT} variable syntax', async () => {
      const content = await fs.readFile(mcpJsonPath, 'utf-8');
      if (content.includes('${')) {
        expect(content).toContain('${CLAUDE_PLUGIN_ROOT}');
        expect(content).not.toContain('${extensionPath}');
      }
    });

    it('references server entry point that exists', async () => {
      const mcpConfig = await loadJson<Record<string, { args?: string[] }>>(mcpJsonPath);

      for (const config of Object.values(mcpConfig)) {
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
      const hooks = await loadJson<{
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      }>(hooksJsonPath);

      for (const eventHooks of Object.values(hooks.hooks)) {
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
      const pythonScripts = files.filter((f: string) => f.endsWith('.py'));

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
// Server Validation
// =============================================================================

describe('Server Build', () => {
  it('server dist/index.js exists', async () => {
    const serverPath = path.join(PROJECT_ROOT, 'server', 'dist', 'index.js');
    expect(await fileExists(serverPath)).toBe(true);
  });
});
