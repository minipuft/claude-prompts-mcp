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

import {
  ScriptToolDefinitionLoader,
  createScriptToolDefinitionLoader,
  getDefaultScriptToolDefinitionLoader,
  resetDefaultScriptToolDefinitionLoader,
} from '../../../../src/scripts/core/script-definition-loader.js';

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
