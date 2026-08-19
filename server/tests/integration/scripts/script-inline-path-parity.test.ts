/**
 * Script Tools — Inline vs Declarative Path Parity (Tier 2 reproductions)
 *
 * Two safety controls are enforced on the declarative `tools:` path and absent
 * on the inline `{{script:id}}` path. This file pins the declarative control as
 * a passing baseline and reproduces both gaps.
 *
 * 2.1 (GREEN on current code) — the declarative path refuses to run a
 *     `confirm: true` tool that the invocation did not name.
 * 2.2 (RED on current code, F1) — the inline path runs the same tool anyway.
 * 2.3 (RED on current code, F9) — script stdout is spliced into the template
 *     and then rendered by Nunjucks, so template syntax in a script's output is
 *     evaluated. Arguments carrying the same syntax are escaped by
 *     processTemplate; script output routes around that control.
 *
 * The reproductions construct their own reference deliberately: swept
 * 2026-08-18, no prompt in this repo, the sibling workspaces, or ~/.claude uses
 * `{{script:id}}`, so there is no shipped prompt to borrow.
 *
 * Classification: Integration (real detection, real filter, real resolver,
 * real subprocess, real Nunjucks)
 */

import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ScriptReferenceResolver } from '../../../src/engine/execution/reference/script-reference-resolver.js';
import { ToolDetectionService } from '../../../src/modules/automation/detection/tool-detection-service.js';
import { createScriptExecutor } from '../../../src/modules/automation/execution/script-executor.js';
import { ToolTriggerFilter } from '../../../src/modules/automation/execution/tool-trigger-filter.js';
import { processTemplateWithRefs } from '../../../src/shared/utils/jsonUtils.js';

import type { LoadedScriptTool } from '../../../src/modules/automation/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

/** A tool that requires confirmation and always matches detection. */
function confirmRequiredTool(fixture: string): LoadedScriptTool {
  return {
    id: 'guarded_tool',
    name: 'Guarded Tool',
    description: 'Requires confirmation before running',
    scriptPath: fixture,
    runtime: 'node',
    inputSchema: { type: 'object', properties: { sentinel: { type: 'string' } } },
    toolDir: FIXTURE_DIR,
    absoluteScriptPath: path.join(FIXTURE_DIR, fixture),
    promptId: 'guarded_prompt',
    descriptionContent: '',
    execution: { trigger: 'always', confirm: true },
  } as unknown as LoadedScriptTool;
}

describe('inline vs declarative path parity', () => {
  let workDir: string;
  let sentinel: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'script-parity-'));
    sentinel = path.join(workDir, 'executed.txt');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // 2.1 — the control. Must be GREEN on current code.
  describe('declarative path (control)', () => {
    test('refuses to run a confirm:true tool the invocation did not name', () => {
      const tool = confirmRequiredTool('side-effect.cjs');
      const detection = new ToolDetectionService();
      const filter = new ToolTriggerFilter();

      const matches = detection.detectTools('run it', { sentinel }, [tool]);
      expect(matches).toHaveLength(1);
      // Derived from execution.confirm by the real service, not asserted by hand.
      expect(matches[0].requiresConfirmation).toBe(true);
      expect(matches[0].explicitRequest).toBe(false);

      const result = filter.filterByTrigger(matches, [tool], 'guarded_prompt');

      expect(result.requiresConfirmation).toBe(true);
      expect(result.readyForExecution).toHaveLength(0);
      expect(result.pendingConfirmation.map((p) => p.toolId)).toContain('guarded_tool');
    });

    test('runs the same tool once the invocation names it via tool:<id>', () => {
      const tool = confirmRequiredTool('side-effect.cjs');
      const detection = new ToolDetectionService();
      const filter = new ToolTriggerFilter();

      const matches = detection.detectTools('run it', { sentinel, 'tool:guarded_tool': true }, [
        tool,
      ]);
      expect(matches[0].explicitRequest).toBe(true);

      const result = filter.filterByTrigger(matches, [tool], 'guarded_prompt');

      expect(result.requiresConfirmation).toBe(false);
      expect(result.readyForExecution.map((m) => m.toolId)).toContain('guarded_tool');
    });
  });

  // 2.2 — F1 reproduction. `test.failing` because this SHOULD pass and does not.
  // When Tier 3 lands the guard, this line starts failing and must become `test`.
  test.failing(
    'inline {{script:id}} must not run a confirm:true tool the invocation did not name',
    async () => {
      const tool = confirmRequiredTool('side-effect.cjs');
      const resolver = new ScriptReferenceResolver(
        silentLogger,
        loaderFor(tool),
        createScriptExecutor()
      );

      await processTemplateWithRefs(
        'Result: {{script:guarded_tool}}',
        { sentinel },
        {},
        undefined,
        { scriptResolver: resolver }
      ).catch(() => undefined);

      // The sentinel is the only honest observable: it proves the subprocess ran,
      // independent of what the resolver reported.
      expect(existsSync(sentinel)).toBe(false);
    },
    20000
  );

  // 2.3 — F9 reproduction. `test.failing` because this SHOULD pass and does not.
  // When Tier 3 lands the escaping, this line starts failing and must become `test`.
  test.failing(
    'script output must not be evaluated as template syntax',
    async () => {
      const tool = confirmRequiredTool('emit-template.cjs');
      const resolver = new ScriptReferenceResolver(
        silentLogger,
        loaderFor(tool),
        createScriptExecutor()
      );

      const { content } = await processTemplateWithRefs(
        'Scout says: {{script:guarded_tool.summary}}',
        { api_key: 'sk-SECRET-abc123' },
        {},
        undefined,
        { scriptResolver: resolver }
      );

      // The argument path escapes template syntax; the script path must match it.
      expect(content).not.toContain('sk-SECRET-abc123');
      expect(content).toContain('{{ api_key }}');
    },
    20000
  );
});

/** Minimal ScriptLoader over a single fixture tool. */
function loaderFor(tool: LoadedScriptTool) {
  return {
    scriptExists: (scriptId: string) => scriptId === tool.id,
    loadScript: (scriptId: string) => (scriptId === tool.id ? tool : undefined),
    getSearchedPaths: () => [FIXTURE_DIR],
  };
}
