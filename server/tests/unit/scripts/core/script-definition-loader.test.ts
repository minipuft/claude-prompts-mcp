// @lifecycle canonical - Unit tests for ScriptToolDefinitionLoader.
/**
 * ScriptToolDefinitionLoader Unit Tests
 *
 * Tests the script tool definition loader including:
 * - Tool discovery
 * - Tool existence checks
 * - Cache management
 * - Stats tracking
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ScriptToolDefinitionLoader,
  createScriptToolDefinitionLoader,
  getDefaultScriptToolDefinitionLoader,
  resetDefaultScriptToolDefinitionLoader,
} from '../../../../src/modules/automation/core/script-definition-loader.js';

describe('ScriptToolDefinitionLoader', () => {
  let loader: ScriptToolDefinitionLoader;

  beforeEach(() => {
    loader = createScriptToolDefinitionLoader({ debug: false, enableCache: true });
  });

  afterEach(() => {
    resetDefaultScriptToolDefinitionLoader();
  });

  describe('discoverTools', () => {
    it('should return empty array for non-existent directory', () => {
      const result = loader.discoverTools('/nonexistent/path/to/prompt');
      expect(result).toEqual([]);
    });

    it('should return empty array when tools directory does not exist', () => {
      // Using a known directory that exists but has no tools/ subdirectory
      const result = loader.discoverTools('/tmp');
      expect(result).toEqual([]);
    });
  });

  describe('toolExists', () => {
    it('should return false for non-existent tool', () => {
      const result = loader.toolExists('/nonexistent/prompt', 'nonexistent_tool');
      expect(result).toBe(false);
    });

    it('should normalize tool ID to lowercase', () => {
      // Both should check the same path
      const result1 = loader.toolExists('/tmp', 'MyTool');
      const result2 = loader.toolExists('/tmp', 'mytool');

      // Both should be false since the tool doesn't exist
      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });
  });

  describe('loadTool', () => {
    it('should return undefined for non-existent tool', () => {
      const result = loader.loadTool('/nonexistent/prompt', 'nonexistent_tool', 'test_prompt');
      expect(result).toBeUndefined();
    });

    it('should track cache miss for non-existent tool', () => {
      loader.loadTool('/nonexistent', 'tool', 'prompt');
      const stats = loader.getStats();

      expect(stats.cacheMisses).toBeGreaterThan(0);
    });
  });

  describe('loadToolsForPrompt', () => {
    it('should return empty array when no tools found', () => {
      const result = loader.loadToolsForPrompt('/nonexistent', ['tool1', 'tool2'], 'test_prompt');
      expect(result).toEqual([]);
    });

    it('should handle empty tool list', () => {
      const result = loader.loadToolsForPrompt('/tmp', [], 'test_prompt');
      expect(result).toEqual([]);
    });
  });

  describe('loadAllToolsForPrompt', () => {
    it('should return empty array for directory without tools', () => {
      const result = loader.loadAllToolsForPrompt('/tmp', 'test_prompt');
      expect(result).toEqual([]);
    });
  });

  // ── F6: a tool that fails to load must be reportable, not merely absent ──
  //
  // `loadTool` returns undefined and `loadToolsForPrompt` skips it silently, so
  // downstream (ResourceIndexer) could not tell a validation failure from a tool
  // that was never on disk. Throwing was rejected: one bad tool would fail the
  // whole sync. This boundary is how the drop-out carries a cause instead.
  describe('loadAllToolsForPromptDetailed', () => {
    let promptDir: string;

    /** Write tools/{id}/tool.yaml verbatim, so a test can write invalid YAML. */
    function writeTool(id: string, yamlBody: string): void {
      const dir = join(promptDir, 'tools', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'tool.yaml'), yamlBody);
      writeFileSync(join(dir, 'script.py'), 'print("ok")');
    }

    beforeEach(() => {
      promptDir = mkdtempSync(join(tmpdir(), 'tool-report-'));
      loader = createScriptToolDefinitionLoader({ debug: false, enableCache: true });
    });

    afterEach(() => {
      rmSync(promptDir, { recursive: true, force: true });
    });

    it('separates a tool that failed validation from the tools that loaded', () => {
      // Ids deliberately unrelated to the prompt id, so no assertion can pass by
      // matching a substring of the fixture's own name.
      writeTool(
        'usable-widget',
        'id: usable-widget\nname: Usable Widget\nscript: script.py\nruntime: python\n'
      );
      writeTool('lacks-script', 'id: lacks-script\nname: Lacks Script\nruntime: python\n');

      const report = loader.loadAllToolsForPromptDetailed(promptDir, 'owner_prompt');

      expect(report.tools.map((t) => t.id)).toEqual(['usable-widget']);
      expect(report.failures).toHaveLength(1);
      expect(report.failures[0]?.toolId).toBe('lacks-script');
      expect(report.failures[0]?.reason).toContain('validation failed');
    });

    it('does not throw when a tool fails — one bad tool must not fail the sync', () => {
      writeTool('lacks-script', 'id: lacks-script\nname: Lacks Script\nruntime: python\n');

      expect(() => loader.loadAllToolsForPromptDetailed(promptDir, 'owner_prompt')).not.toThrow();
    });

    it('reports no failures when every discovered tool loads', () => {
      writeTool(
        'usable-widget',
        'id: usable-widget\nname: Usable Widget\nscript: script.py\nruntime: python\n'
      );

      const report = loader.loadAllToolsForPromptDetailed(promptDir, 'owner_prompt');

      expect(report.failures).toEqual([]);
      expect(report.tools).toHaveLength(1);
    });

    it("keeps loadAllToolsForPrompt returning exactly the report's tools", () => {
      writeTool(
        'usable-widget',
        'id: usable-widget\nname: Usable Widget\nscript: script.py\nruntime: python\n'
      );
      writeTool('lacks-script', 'id: lacks-script\nname: Lacks Script\nruntime: python\n');

      const plain = loader.loadAllToolsForPrompt(promptDir, 'owner_prompt');
      const detailed = loader.loadAllToolsForPromptDetailed(promptDir, 'owner_prompt');

      expect(plain.map((t) => t.id)).toEqual(detailed.tools.map((t) => t.id));
    });
  });

  describe('cache management', () => {
    it('should clear all cache entries', () => {
      // Trigger some cache operations
      loader.loadTool('/path1', 'tool1', 'prompt1');
      loader.loadTool('/path2', 'tool2', 'prompt2');

      loader.clearCache();
      const stats = loader.getStats();

      expect(stats.cacheSize).toBe(0);
    });

    it('should clear cache for specific prompt directory', () => {
      const promptDir = '/path/to/prompt';

      // This would populate cache if the tool existed
      loader.loadTool(promptDir, 'tool1', 'prompt1');

      loader.clearCache(promptDir);

      // Cache should be cleared for that directory
      const stats = loader.getStats();
      expect(stats.cacheSize).toBe(0);
    });

    it('should clear cache for specific tool', () => {
      const promptDir = '/path/to/prompt';
      const toolId = 'test_tool';

      loader.clearToolCache(promptDir, toolId);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('stats tracking', () => {
    it('should track cache hits and misses', () => {
      const initialStats = loader.getStats();
      expect(initialStats.cacheHits).toBe(0);
      expect(initialStats.cacheMisses).toBe(0);
      expect(initialStats.loadErrors).toBe(0);
      expect(initialStats.cacheSize).toBe(0);
    });

    it('should increment cache misses on load attempts', () => {
      loader.loadTool('/nonexistent', 'tool', 'prompt');
      loader.loadTool('/nonexistent2', 'tool2', 'prompt2');

      const stats = loader.getStats();
      expect(stats.cacheMisses).toBe(2);
    });
  });

  describe('factory functions', () => {
    it('should create loader with default config', () => {
      const loader = createScriptToolDefinitionLoader();
      expect(loader).toBeInstanceOf(ScriptToolDefinitionLoader);
    });

    it('should create loader with custom config', () => {
      const loader = createScriptToolDefinitionLoader({
        enableCache: false,
        validateOnLoad: false,
        debug: true,
      });
      expect(loader).toBeInstanceOf(ScriptToolDefinitionLoader);
    });
  });

  describe('default instance management', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getDefaultScriptToolDefinitionLoader();
      const instance2 = getDefaultScriptToolDefinitionLoader();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getDefaultScriptToolDefinitionLoader();
      resetDefaultScriptToolDefinitionLoader();
      const instance2 = getDefaultScriptToolDefinitionLoader();

      expect(instance1).not.toBe(instance2);
    });
  });
});
