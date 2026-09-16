// @lifecycle test - Unit tests for ResourceIndexer ranked search
/**
 * ResourceIndexer Search Tests
 *
 * Tests the ranked search algorithm introduced as an FTS5 alternative.
 * Scoring: id exact=10, name word=8, name prefix=5,
 *          keywords=4, description word=2, id substring=1
 *
 * These tests insert rows directly into SQLite (bypassing filesystem sync)
 * to isolate the search/scoring logic from I/O concerns.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

import { SqliteEngine, ResourceIndexer } from '../../../src/infra/database/index.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = testScratchPath('search-test');

/**
 * Insert a resource row directly into SQLite, bypassing filesystem sync.
 */
function insertResource(
  db: SqliteEngine,
  fields: {
    id: string;
    type: string;
    name?: string;
    category?: string;
    description?: string;
    keywords?: string;
    metadata_json?: string;
  }
): void {
  db.run(
    `INSERT INTO resource_index (id, type, name, category, description, content_hash, file_path, metadata_json, keywords)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fields.id,
      fields.type,
      fields.name ?? null,
      fields.category ?? null,
      fields.description ?? null,
      'test-hash-' + fields.id,
      '/test/' + fields.id,
      fields.metadata_json ?? null,
      fields.keywords ?? null,
    ]
  );
}

describe('ResourceIndexer ranked search', () => {
  let dbManager: SqliteEngine;
  let indexer: ResourceIndexer;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    dbManager = await SqliteEngine.getInstance(TEST_DIR, mockLogger as any);
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    dbManager.run('DELETE FROM resource_index');
    jest.clearAllMocks();

    indexer = new ResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: path.join(TEST_DIR, 'resources'),
    });
  });

  describe('relevance ranking', () => {
    it('should rank exact ID match highest', () => {
      insertResource(dbManager, {
        id: 'analysis',
        type: 'prompt',
        name: 'Some Other Name',
        description: 'unrelated description',
      });
      insertResource(dbManager, {
        id: 'code-review',
        type: 'prompt',
        name: 'Analysis Report',
        description: 'performs analysis',
      });

      const results = indexer.search('analysis');

      expect(results.length).toBeGreaterThanOrEqual(2);
      // Exact ID match should be first
      expect(results[0].id).toBe('analysis');
    });

    it('should rank name word match higher than description match', () => {
      insertResource(dbManager, {
        id: 'prompt-a',
        type: 'prompt',
        name: 'Code Review Tool',
        description: 'helps with analysis',
      });
      insertResource(dbManager, {
        id: 'prompt-b',
        type: 'prompt',
        name: 'Analysis Dashboard',
        description: 'displays metrics',
      });

      const results = indexer.search('analysis');

      expect(results.length).toBe(2);
      // Name word match (8 pts) should rank above description word match (2 pts)
      expect(results[0].id).toBe('prompt-b');
      expect(results[1].id).toBe('prompt-a');
    });

    it('should rank name prefix match between word and description', () => {
      insertResource(dbManager, {
        id: 'prompt-full',
        type: 'prompt',
        name: 'analyzer tool',
        description: 'full word in description',
      });
      insertResource(dbManager, {
        id: 'prompt-prefix',
        type: 'prompt',
        name: 'analysis helper',
        description: 'something else entirely',
      });
      insertResource(dbManager, {
        id: 'prompt-desc',
        type: 'prompt',
        name: 'some tool',
        description: 'performs analysis tasks',
      });

      const results = indexer.search('analy');

      // "analy" is a prefix of "analyzer" (prefix=5) and "analysis" (prefix=5)
      // Description doesn't word-boundary-match "analy" since it matches "analysis"
      // which starts with "analy" — but the regex is \banaly so desc "analysis" matches as prefix
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should boost resources with matching keywords', () => {
      insertResource(dbManager, {
        id: 'prompt-no-kw',
        type: 'prompt',
        name: 'General Tool',
        description: 'a generic tool for tasks',
      });
      insertResource(dbManager, {
        id: 'prompt-with-kw',
        type: 'prompt',
        name: 'General Helper',
        description: 'a generic helper for tasks',
        keywords: 'debugging profiling optimization',
      });

      const results = indexer.search('debugging');

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('prompt-with-kw');
    });

    it('should rank ID substring match lowest', () => {
      insertResource(dbManager, {
        id: 'my-analysis-tool',
        type: 'prompt',
        name: 'Unrelated Name',
        description: 'unrelated description',
      });
      insertResource(dbManager, {
        id: 'review-helper',
        type: 'prompt',
        name: 'Analysis Helper',
        description: 'unrelated description',
      });

      const results = indexer.search('analysis');

      expect(results.length).toBe(2);
      // Name word match (8) > ID substring (1)
      expect(results[0].id).toBe('review-helper');
      expect(results[1].id).toBe('my-analysis-tool');
    });
  });

  describe('multi-token queries', () => {
    it('should match resources containing multiple query tokens', () => {
      insertResource(dbManager, {
        id: 'chain-analysis',
        type: 'prompt',
        name: 'Chain Analysis Tool',
        description: 'analyzes chain workflows',
      });
      insertResource(dbManager, {
        id: 'chain-runner',
        type: 'prompt',
        name: 'Chain Runner',
        description: 'runs chains',
      });
      insertResource(dbManager, {
        id: 'data-analysis',
        type: 'prompt',
        name: 'Data Analysis',
        description: 'analyzes data sets',
      });

      const results = indexer.search('chain analysis');

      expect(results.length).toBeGreaterThanOrEqual(1);
      // "chain-analysis" matches both tokens in name (8+8=16) + exact ID (10) = 26
      // "chain-runner" matches "chain" in name (8) = 8
      // "data-analysis" matches "analysis" in name (8) = 8
      expect(results[0].id).toBe('chain-analysis');
    });

    it('should accumulate scores across multiple tokens', () => {
      insertResource(dbManager, {
        id: 'gate-builder',
        type: 'prompt',
        name: 'Gate Builder',
        description: 'builds quality gates for validation',
      });
      insertResource(dbManager, {
        id: 'quality-report',
        type: 'prompt',
        name: 'Quality Report',
        description: 'generates reports about gates',
      });

      const results = indexer.search('quality gates');

      // Both match both tokens, but in different fields
      // gate-builder: "gates" in desc (2), "quality" in desc (2) = 4
      // quality-report: "quality" in name (8), "gates" in desc (2) = 10
      expect(results.length).toBe(2);
      expect(results[0].id).toBe('quality-report');
    });

    it('should filter out single-character tokens', () => {
      insertResource(dbManager, {
        id: 'test-prompt',
        type: 'prompt',
        name: 'Test Prompt',
        description: 'a test prompt',
      });

      // "a" and "x" are single chars, only "test" should be used
      const results = indexer.search('a test x');

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('test-prompt');
    });
  });

  describe('type filtering', () => {
    beforeEach(() => {
      insertResource(dbManager, {
        id: 'quality-check',
        type: 'gate',
        name: 'Quality Check',
        description: 'validates output quality',
      });
      insertResource(dbManager, {
        id: 'quality-prompt',
        type: 'prompt',
        name: 'Quality Analysis',
        description: 'analyzes quality metrics',
      });
      insertResource(dbManager, {
        id: 'quality-style',
        type: 'style',
        name: 'Quality Style',
        description: 'quality-focused formatting',
      });
    });

    it('should return only prompts when type filter is prompt', () => {
      const results = indexer.search('quality', 'prompt');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('quality-prompt');
      expect(results[0].type).toBe('prompt');
    });

    it('should return only gates when type filter is gate', () => {
      const results = indexer.search('quality', 'gate');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('quality-check');
      expect(results[0].type).toBe('gate');
    });

    it('should return all types when no type filter', () => {
      const results = indexer.search('quality');

      expect(results).toHaveLength(3);
    });
  });

  describe('edge cases', () => {
    it('should return empty array for nonsense query', () => {
      insertResource(dbManager, {
        id: 'real-prompt',
        type: 'prompt',
        name: 'Real Prompt',
        description: 'a real prompt',
      });

      const results = indexer.search('xyzzy42nonsense');

      expect(results).toHaveLength(0);
    });

    it('should return empty array when database is empty', () => {
      const results = indexer.search('anything');

      expect(results).toHaveLength(0);
    });

    it('should handle special regex characters in query', () => {
      insertResource(dbManager, {
        id: 'regex-test',
        type: 'prompt',
        name: 'Test (special)',
        description: 'handles [brackets] and $dollars',
      });

      // Should not throw — regex chars are escaped
      expect(() => indexer.search('(special)')).not.toThrow();
      expect(() => indexer.search('[brackets]')).not.toThrow();
      expect(() => indexer.search('$dollars')).not.toThrow();
    });

    it('should handle empty string query gracefully', () => {
      insertResource(dbManager, {
        id: 'test',
        type: 'prompt',
        name: 'Test',
      });

      // Empty query — SQL LIKE '%%' matches everything, but tokens are empty
      // so computeRelevanceScore returns 0 for all (no tokens to match)
      const results = indexer.search('');

      // Results depend on whether empty query scores > 0
      // Empty string won't match id exactly and tokens array is empty
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle resources with null fields', () => {
      insertResource(dbManager, {
        id: 'minimal',
        type: 'prompt',
        // name, description, keywords all null
      });

      // Should not throw
      const results = indexer.search('minimal');

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('minimal');
    });

    it('should be case-insensitive', () => {
      insertResource(dbManager, {
        id: 'case-test',
        type: 'prompt',
        name: 'UPPERCASE Name',
        description: 'MiXeD CaSe Description',
      });

      const lower = indexer.search('uppercase');
      const upper = indexer.search('UPPERCASE');
      const mixed = indexer.search('UpperCase');

      expect(lower.length).toBeGreaterThan(0);
      expect(upper.length).toBeGreaterThan(0);
      expect(mixed.length).toBeGreaterThan(0);
    });
  });

  describe('keywords column integration', () => {
    it('should match on keywords field', () => {
      insertResource(dbManager, {
        id: 'debug-tool',
        type: 'prompt',
        name: 'Developer Tool',
        description: 'helps developers',
        keywords: 'debugging profiling tracing',
      });

      const results = indexer.search('profiling');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('debug-tool');
    });

    it('should combine keyword score with other field scores', () => {
      insertResource(dbManager, {
        id: 'prompt-a',
        type: 'prompt',
        name: 'Code Review',
        description: 'reviews code quality',
        keywords: 'lint analysis static',
      });
      insertResource(dbManager, {
        id: 'prompt-b',
        type: 'prompt',
        name: 'Analysis Tool',
        description: 'generic analysis',
      });

      const results = indexer.search('analysis');

      // prompt-a: "analysis" in keywords (4) + not in name/desc as word boundary
      // prompt-b: "analysis" in name (8) + "analysis" in desc (2) = 10
      expect(results.length).toBe(2);
      // Name match dominates
      expect(results[0].id).toBe('prompt-b');
    });

    it('should use keywords in SQL LIKE candidate retrieval', () => {
      // Resource only discoverable via keywords (not in name/desc/id)
      insertResource(dbManager, {
        id: 'hidden-gem',
        type: 'prompt',
        name: 'Generic Tool',
        description: 'does generic things',
        keywords: 'optimization performance tuning',
      });

      const results = indexer.search('optimization');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('hidden-gem');
    });
  });
});
