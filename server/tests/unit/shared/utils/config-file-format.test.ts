// @lifecycle canonical - Unit tests for the config file format owner.
/**
 * Config File Format
 *
 * Row 7.1 of the 2026-09-11 config contract consolidation. This is the one owner of
 * which file is the user's config and how its text parses (rulings R66, R67, R73):
 * comments and trailing commas are accepted in `.jsonc`, nothing else beyond JSON, and
 * `.json` stays strict. The positive control proves the comment/trailing-comma text is
 * only accepted because of the declared format, not because `jsonc-parser` is lenient
 * regardless of what format callers ask for.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  configFileFormat,
  findWorkspaceConfigFiles,
  parseConfigText,
  USER_CONFIG_FILENAMES,
} from '../../../../src/shared/utils/config-file-format.js';

describe('configFileFormat', () => {
  it.each([
    ['config.jsonc', 'jsonc'],
    ['/workspace/config.jsonc', 'jsonc'],
    ['CONFIG.JSONC', 'jsonc'],
    ['/workspace/Config.JsonC', 'jsonc'],
    ['config.json', 'json'],
    ['/workspace/config.json', 'json'],
    ['config', 'json'],
    ['config.yaml', 'json'],
    ['noextension', 'json'],
  ])('%s -> %s', (filePath, expected) => {
    expect(configFileFormat(filePath)).toBe(expected);
  });
});

describe('parseConfigText', () => {
  describe('jsonc format', () => {
    it('accepts a line comment', () => {
      const text = '{\n  // a line comment\n  "enabled": true\n}';
      expect(parseConfigText(text, 'jsonc')).toEqual({ enabled: true });
    });

    it('accepts a block comment', () => {
      const text = '{\n  /* a block comment */\n  "enabled": true\n}';
      expect(parseConfigText(text, 'jsonc')).toEqual({ enabled: true });
    });

    it('keeps a "//" inside a string value literal, not a comment', () => {
      const text = '{"$schema": "https://example.com//schema.json"}';
      expect(parseConfigText(text, 'jsonc')).toEqual({
        $schema: 'https://example.com//schema.json',
      });
    });

    it('accepts a trailing comma in an object', () => {
      const text = '{\n  "a": 1,\n  "b": 2,\n}';
      expect(parseConfigText(text, 'jsonc')).toEqual({ a: 1, b: 2 });
    });

    it('accepts a trailing comma in an array', () => {
      const text = '{"list": [1, 2, 3,]}';
      expect(parseConfigText(text, 'jsonc')).toEqual({ list: [1, 2, 3] });
    });

    it('throws naming line and column on a truncated document', () => {
      const text = '{\n  "a": 1,\n  "b": 2,\n';
      expect(() => parseConfigText(text, 'jsonc')).toThrow(/line 4, column 1/);
    });

    it('rejects an unquoted key — nothing beyond comments and trailing commas', () => {
      const text = '{a: 1}';
      expect(() => parseConfigText(text, 'jsonc')).toThrow(/Invalid JSONC/);
    });

    it('rejects single-quoted strings — nothing beyond comments and trailing commas', () => {
      const text = "{'a': 1}";
      expect(() => parseConfigText(text, 'jsonc')).toThrow(/Invalid JSONC/);
    });

    it('throws on empty text rather than silently returning undefined', () => {
      expect(() => parseConfigText('', 'jsonc')).toThrow(/Invalid JSONC/);
    });

    it('names the correct line and column for an error past the first line', () => {
      const text = '{\n  "a": 1\n  "b": 2\n}';
      // Missing comma after "a": 1 — the next property starts at line 3, column 3.
      expect(() => parseConfigText(text, 'jsonc')).toThrow(/line 3, column 3/);
    });
  });

  describe('json format', () => {
    it('parses strict JSON', () => {
      expect(parseConfigText('{"a": 1}', 'json')).toEqual({ a: 1 });
    });

    it('positive control: the exact text accepted under jsonc is rejected under json', () => {
      const text = '{\n  // a line comment\n  "a": 1,\n}';
      // Prove jsonc accepts this text (the control fires)...
      expect(parseConfigText(text, 'jsonc')).toEqual({ a: 1 });
      // ...and that json — the same parser call, only the format differs — rejects it.
      expect(() => parseConfigText(text, 'json')).toThrow();
    });

    it('throws a native SyntaxError on malformed JSON', () => {
      expect(() => parseConfigText('{a: 1}', 'json')).toThrow(SyntaxError);
    });
  });
});

describe('findWorkspaceConfigFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-file-format-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty array when neither name exists', () => {
    expect(findWorkspaceConfigFiles(tmpDir)).toEqual([]);
  });

  it('returns the single existing name', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}');
    expect(findWorkspaceConfigFiles(tmpDir)).toEqual([path.resolve(tmpDir, 'config.json')]);
  });

  it('returns both names in precedence order (jsonc first) when both exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'config.jsonc'), '{}');
    expect(findWorkspaceConfigFiles(tmpDir)).toEqual([
      path.resolve(tmpDir, 'config.jsonc'),
      path.resolve(tmpDir, 'config.json'),
    ]);
  });

  it('agrees with USER_CONFIG_FILENAMES precedence', () => {
    for (const name of USER_CONFIG_FILENAMES) {
      fs.writeFileSync(path.join(tmpDir, name), '{}');
    }
    const found = findWorkspaceConfigFiles(tmpDir);
    expect(found.map((p) => path.basename(p))).toEqual([...USER_CONFIG_FILENAMES]);
  });
});
