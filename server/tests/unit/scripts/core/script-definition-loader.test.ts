// @lifecycle canonical - Unit tests for ScriptToolDefinitionLoader.
/**
 * ScriptToolDefinitionLoader Unit Tests
 *
 * Tests the script tool definition loader including:
 * - Tool discovery
 * - Tool existence checks
 * - Cache management
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
  });

  // Cache state has no public accessor since `getStats()` was removed (nothing in src/ read
  // it — P4.52). These tests observe caching through behavior instead: a cached tool keeps
  // resolving after its file is deleted from disk; clearing the cache forces a re-read that
  // then sees the file is gone.
  describe('cache management', () => {
    let promptDir: string;

    function writeTool(id: string): void {
      const dir = join(promptDir, 'tools', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'tool.yaml'),
        `id: ${id}\nname: ${id}\nscript: script.py\nruntime: python\n`
      );
      writeFileSync(join(dir, 'script.py'), 'print("ok")');
    }

    beforeEach(() => {
      promptDir = mkdtempSync(join(tmpdir(), 'tool-cache-'));
      loader = createScriptToolDefinitionLoader({ debug: false, enableCache: true });
    });

    afterEach(() => {
      rmSync(promptDir, { recursive: true, force: true });
    });

    it('clearCache() forces a re-read that observes a since-deleted tool file', () => {
      writeTool('cached-widget');
      expect(loader.loadTool(promptDir, 'cached-widget', 'owner_prompt')).toBeDefined();

      rmSync(join(promptDir, 'tools', 'cached-widget'), { recursive: true, force: true });

      // Still cached: the deleted file is not observed yet.
      expect(loader.loadTool(promptDir, 'cached-widget', 'owner_prompt')).toBeDefined();

      loader.clearCache();

      expect(loader.loadTool(promptDir, 'cached-widget', 'owner_prompt')).toBeUndefined();
    });

    it('clearCache(promptDir) scopes the re-read to that prompt only', () => {
      writeTool('scoped-widget');
      const otherDir = mkdtempSync(join(tmpdir(), 'tool-cache-other-'));
      try {
        mkdirSync(join(otherDir, 'tools', 'scoped-widget'), { recursive: true });
        writeFileSync(
          join(otherDir, 'tools', 'scoped-widget', 'tool.yaml'),
          'id: scoped-widget\nname: scoped-widget\nscript: script.py\nruntime: python\n'
        );
        writeFileSync(join(otherDir, 'tools', 'scoped-widget', 'script.py'), 'print("ok")');

        expect(loader.loadTool(promptDir, 'scoped-widget', 'owner_prompt')).toBeDefined();
        expect(loader.loadTool(otherDir, 'scoped-widget', 'other_prompt')).toBeDefined();

        rmSync(join(promptDir, 'tools', 'scoped-widget'), { recursive: true, force: true });
        rmSync(join(otherDir, 'tools', 'scoped-widget'), { recursive: true, force: true });

        loader.clearCache(promptDir);

        expect(loader.loadTool(promptDir, 'scoped-widget', 'owner_prompt')).toBeUndefined();
        // Untouched prompt directory keeps serving its cached entry.
        expect(loader.loadTool(otherDir, 'scoped-widget', 'other_prompt')).toBeDefined();
      } finally {
        rmSync(otherDir, { recursive: true, force: true });
      }
    });

    it('clearToolCache() forces a re-read of that one tool only', () => {
      writeTool('tool-a');
      writeTool('tool-b');
      expect(loader.loadTool(promptDir, 'tool-a', 'owner_prompt')).toBeDefined();
      expect(loader.loadTool(promptDir, 'tool-b', 'owner_prompt')).toBeDefined();

      rmSync(join(promptDir, 'tools', 'tool-a'), { recursive: true, force: true });
      rmSync(join(promptDir, 'tools', 'tool-b'), { recursive: true, force: true });

      loader.clearToolCache(promptDir, 'tool-a');

      expect(loader.loadTool(promptDir, 'tool-a', 'owner_prompt')).toBeUndefined();
      // tool-b's cache entry was untouched.
      expect(loader.loadTool(promptDir, 'tool-b', 'owner_prompt')).toBeDefined();
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
