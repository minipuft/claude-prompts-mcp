/**
 * Every bundled script tool's `auto_execute.params` names parameters `resource_manager` declares.
 *
 * A script tool's output is the ONE caller of `resource_manager` that nothing typechecks: the
 * auto-execute stage hands `auto_execute.params` straight to the router
 * (`09-script-auto-execute-stage.ts`), so a key the tool spells wrong never meets the published
 * schema and was, until R46, dropped in silence. Measured 2026-09-20: `gate_builder` emitted
 * `enforcementMode` for the declared `enforcement_mode`, so every `>>create_gate` run that set it
 * produced a gate whose enforcement mode was whatever the loader derived — and after R46 the same
 * run is REFUSED, which is how the defect surfaced. `framework_builder` emitted two more:
 * gate-owned `type` (refused by name since #337) and `version` as a semver string against a
 * parameter declared `z.number()`.
 *
 * The TOOLS are enumerated from disk, so a sixth one cannot join without being checked. Its input
 * is a fixture this suite owns (`bundled-script-tool-fixtures.json`) — a new tool with no fixture
 * fails here rather than being skipped, which is the closure condition: "fix the two I found" is
 * not a fix of the class.
 *
 * Vacuity is what this file has to guard hardest against, because a script that returns
 * `valid: false` emits NO params and would satisfy a naive "no refused key" assertion perfectly.
 * So each fixture must produce `valid: true`, and each must DECLARE whether the tool calls
 * `resource_manager` at all — a tool that quietly stopped emitting cannot pass by omission.
 */

import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

import {
  DECLARED_PARAMETERS,
  describeParameterRefusal,
} from '../../../src/mcp/tools/resource-manager/core/parameter-ownership.js';

import type { ResourceType } from '../../../src/mcp/tools/resource-manager/core/types.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXAMPLES_DIR = path.join(SERVER_ROOT, 'resources', 'prompts', 'examples');
const FIXTURES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'bundled-script-tool-fixtures.json'
);

interface ToolOnDisk {
  id: string;
  dir: string;
  runtime: string;
  script: string;
}

interface Fixture {
  /** Whether this tool's output drives `resource_manager`. Stated, never inferred from absence. */
  emitsResourceManagerCall: boolean;
  input: Record<string, unknown>;
}

/** Every `tools/{id}/` directory under the bundled example prompts, read from disk. */
function bundledScriptTools(): ToolOnDisk[] {
  const found: ToolOnDisk[] = [];
  for (const promptEntry of readdirSync(EXAMPLES_DIR, { withFileTypes: true })) {
    if (!promptEntry.isDirectory()) continue;
    const toolsDir = path.join(EXAMPLES_DIR, promptEntry.name, 'tools');
    if (!existsSync(toolsDir)) continue;
    for (const toolEntry of readdirSync(toolsDir, { withFileTypes: true })) {
      if (!toolEntry.isDirectory()) continue;
      const dir = path.join(toolsDir, toolEntry.name);
      const manifestPath = path.join(dir, 'tool.yaml');
      if (!existsSync(manifestPath)) continue;
      const manifest = yaml.load(readFileSync(manifestPath, 'utf8')) as {
        id?: string;
        runtime?: string;
        script?: string;
      };
      found.push({
        id: manifest.id ?? toolEntry.name,
        dir,
        runtime: manifest.runtime ?? 'python',
        script: manifest.script ?? 'script.py',
      });
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

const TOOLS = bundledScriptTools();
const FIXTURES = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as Record<string, Fixture>;

interface ScriptOutput {
  valid?: boolean;
  errors?: string[];
  auto_execute?: { tool?: string; params?: Record<string, unknown> };
}

function runTool(tool: ToolOnDisk, input: unknown): ScriptOutput {
  const interpreter = tool.runtime === 'python' ? 'python3' : 'node';
  const stdout = execFileSync(interpreter, [path.join(tool.dir, tool.script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  return JSON.parse(stdout) as ScriptOutput;
}

describe('bundled script tools emit only parameters resource_manager declares', () => {
  it('finds the tools on disk', () => {
    // The enumeration itself. `it.each` over an empty array generates zero cases and reports
    // green, so the count is asserted before anything else runs.
    expect(TOOLS.length).toBeGreaterThan(0);
  });

  it('has a fixture for every tool on disk, and no fixture for a tool that is gone', () => {
    const onDisk = TOOLS.map((tool) => tool.id).sort();
    expect(Object.keys(FIXTURES).sort()).toEqual(onDisk);
  });

  for (const tool of TOOLS) {
    describe(tool.id, () => {
      const fixture = FIXTURES[tool.id];

      it('runs its fixture to a VALID result', () => {
        // The anti-vacuity gate. `valid: false` emits no params, and every assertion below would
        // then pass having observed nothing.
        if (fixture === undefined) throw new Error(`no fixture for ${tool.id}`);
        const output = runTool(tool, fixture.input);
        expect(output.errors ?? []).toEqual([]);
        if (fixture.emitsResourceManagerCall) expect(output.valid).toBe(true);
      });

      it('agrees with its fixture about whether it calls resource_manager', () => {
        if (fixture === undefined) throw new Error(`no fixture for ${tool.id}`);
        const output = runTool(tool, fixture.input);
        const calls = output.auto_execute?.tool === 'resource_manager';
        expect(calls).toBe(fixture.emitsResourceManagerCall);
      });

      if (FIXTURES[tool.id]?.emitsResourceManagerCall === true) {
        it('emits no parameter resource_manager would refuse', () => {
          const output = runTool(tool, FIXTURES[tool.id]!.input);
          const params = output.auto_execute?.params ?? {};

          // Non-empty is part of the claim: an empty params object refuses nothing.
          expect(Object.keys(params).length).toBeGreaterThan(0);

          const undeclared = Object.keys(params).filter((name) => !DECLARED_PARAMETERS.has(name));
          expect(undeclared).toEqual([]);

          // The router's own refusal, not a re-implementation of it — this also covers the
          // declared-but-wrong-type half (#337), which a name-membership check cannot see.
          const resourceType = params['resource_type'] as ResourceType;
          expect(describeParameterRefusal(resourceType, params)).toBeNull();
        });
      }
    });
  }

  it('POSITIVE CONTROL: the refusal this suite relies on does fire', () => {
    // Without this, a `describeParameterRefusal` that always returned null would make every case
    // above green. The mutant is one key away from a real payload.
    expect(
      describeParameterRefusal('gate', {
        resource_type: 'gate',
        action: 'create',
        enforcementMode: 'advisory',
      })
    ).toContain("'enforcementMode' is not a parameter of resource_manager");
  });
});
