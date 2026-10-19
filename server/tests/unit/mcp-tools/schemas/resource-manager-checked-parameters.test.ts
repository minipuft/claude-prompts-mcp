/**
 * Eight `resource_manager` parameters were published as `unknown[]` or `Record<string, unknown>`
 * while the router and processors read them as typed shapes. Measured over Streamable HTTP on
 * 2026-10-19, before this check existed: `retry_config.improvement_hints: 5` was written as
 * `false`, a phase with no `name` was dropped and the create reported success,
 * `activation.frameworks` (a key no reader looks up) was written to `gate.yaml`, and
 * `execution_type_enhancements.chain: 5` reached `phases.yaml` verbatim.
 *
 * `resourceManagerInputSchema` now checks each one. Every case below sends one wrongly shaped
 * value and asserts the refusal names the parameter, the way a client reads it: the SDK and
 * `getResourceManagerHandler` both render an issue as `<path>: <message>`.
 */
import { describe, expect, it } from '@jest/globals';
import { z } from 'zod/v4';

import {
  GateActivationSchema,
  GateRetryConfigSchema,
} from '../../../../src/engine/gates/core/gate-schema.js';
import { FrameworkSchema } from '../../../../src/engine/frameworks/definitions/framework-schema.js';
import { resourceManagerInputSchema } from '../../../../src/mcp/tools/schemas/resource-manager.schema.js';

const BASE = {
  gate: { resource_type: 'gate', action: 'create', id: 'probe-gate' },
  framework: { resource_type: 'framework', action: 'create', id: 'probe_fw' },
  prompt: { resource_type: 'prompt', action: 'create', id: 'probe_prompt' },
} as const;

/** What a client reads for `input`: one `<path>: <message>` line per issue. */
function refusal(base: keyof typeof BASE, input: Record<string, unknown>): string[] {
  const result = resourceManagerInputSchema.safeParse({ ...BASE[base], ...input });
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('resource_manager refuses a wrongly shaped value for the parameters it used to pass unchecked', () => {
  it.each([
    [
      'tools',
      'prompt',
      { tools: [{ id: 'tool_b', name: 'Tool B', script: 42 }] },
      'tools.0.script: Invalid input: expected string, received number',
    ],
    [
      'activation',
      'gate',
      { activation: { frameworks: ['CAGEERF'] } },
      "'activation.frameworks' is not a declared key",
    ],
    [
      'retry_config',
      'gate',
      { retry_config: { improvement_hints: 5 } },
      'retry_config.improvement_hints: Invalid input: expected boolean, received number',
    ],
    [
      'phases',
      'framework',
      { phases: [{ id: 'p1', description: 'no name' }] },
      'phases.0.name: Invalid input: expected string, received undefined',
    ],
    [
      'gates',
      'framework',
      { gates: { include: 'framework-compliance' } },
      'gates.include: Invalid input: expected array, received string',
    ],
    [
      'tool_descriptions',
      'framework',
      { tool_descriptions: { prompt_engine: 5 } },
      "'tool_descriptions.prompt_engine' takes string or object, not number.",
    ],
    [
      'execution_type_enhancements',
      'framework',
      { execution_type_enhancements: { chain: 5 } },
      'execution_type_enhancements.chain: Invalid input: expected object, received number',
    ],
    [
      'quality_indicators',
      'framework',
      { quality_indicators: { p1: { keywords: 'ground' } } },
      'quality_indicators.p1.keywords: Invalid input: expected array, received string',
    ],
  ] as const)('%s', (_field, base, input, expected) => {
    expect(refusal(base, input)).toEqual([expect.stringContaining(expected)]);
  });

  it('CONTROL: the well-formed value of every checked parameter still parses', () => {
    // The shapes the bundled frameworks, the conformance suite and the bundled builders send.
    expect(
      refusal('prompt', {
        tools: [{ id: 'tool_a', name: 'Tool A', script: "print('x')", runtime: 'python' }],
      })
    ).toEqual([]);
    expect(
      refusal('gate', {
        activation: { prompt_categories: ['general'], framework_context: ['CAGEERF'] },
        retry_config: { max_attempts: 2, improvement_hints: true, preserve_context: true },
      })
    ).toEqual([]);
    expect(
      refusal('framework', {
        phases: [{ id: 'p1', name: 'P1', description: 'one' }],
        gates: { include: ['framework-compliance'] },
        tool_descriptions: {
          prompt_engine: { description: 'Runs it.', parameters: { command: 'The command.' } },
          system_control: 'Status shows the phase.',
        },
        execution_type_enhancements: { chain: { advancedChain: { step: ['a line'] } } },
        quality_indicators: { p1: { keywords: ['ground'], patterns: ['ground .*'] } },
      })
    ).toEqual([]);
  });
});

/**
 * Three of the shapes mirror a loader schema. The loader strips an unknown key, so a key present
 * only on the tool side is accepted, written, and dropped at load — which is how
 * `activation.frameworks` sat in `gate.yaml` doing nothing.
 */
describe('mirrored shapes declare the loader keys', () => {
  /** The declared keys of a checked object parameter, under its `.optional()`. */
  function checkedKeys(name: 'activation' | 'retry_config' | 'gates'): string[] {
    return Object.keys(resourceManagerInputSchema.shape[name].unwrap().shape).sort();
  }

  it('activation mirrors GateActivationSchema', () => {
    expect(checkedKeys('activation')).toEqual(Object.keys(GateActivationSchema.shape).sort());
  });

  it('retry_config mirrors GateRetryConfigSchema', () => {
    expect(checkedKeys('retry_config')).toEqual(Object.keys(GateRetryConfigSchema.shape).sort());
  });

  it('gates mirrors FrameworkSchema.gates', () => {
    expect(checkedKeys('gates')).toEqual(
      Object.keys(FrameworkSchema.shape.gates.unwrap().shape).sort()
    );
  });
});

/**
 * The JSON Schema a client receives for these parameters is the shape a call is checked against,
 * not a looser stand-in: `tools/list` converts the input side of each zod schema, so a field
 * validated through `<loose>.pipe(<shape>)` would publish only `<loose>`. Converted here the way
 * the MCP SDK converts it (`io: 'input'`).
 */
describe('the published inputSchema carries the checked shapes', () => {
  const published = z.toJSONSchema(resourceManagerInputSchema, { io: 'input' }) as {
    properties: Record<string, Record<string, unknown>>;
  };
  const property = (name: string): Record<string, unknown> => {
    const schema = published.properties[name];
    if (schema === undefined) throw new Error(`'${name}' is not published`);
    return schema;
  };

  it.each(['tools', 'phases'])('%s publishes its element keys', (name) => {
    const items = property(name)['items'] as Record<string, unknown>;
    expect(items['additionalProperties']).toBe(false);
    expect(Object.keys(items['properties'] as object)).toEqual(
      expect.arrayContaining(['id', 'name'])
    );
  });

  it.each(['activation', 'retry_config', 'gates', 'execution_type_enhancements'])(
    '%s publishes its keys and refuses others',
    (name) => {
      expect(property(name)['additionalProperties']).toBe(false);
      expect(Object.keys(property(name)['properties'] as object).length).toBeGreaterThan(0);
    }
  );

  it.each(['tool_descriptions', 'quality_indicators'])('%s publishes its value shape', (name) => {
    const values = property(name)['additionalProperties'];
    expect(values).toEqual(expect.any(Object));
    expect(JSON.stringify(values)).not.toBe('{}');
  });

  it('activation publishes framework_context, not frameworks', () => {
    const keys = Object.keys(property('activation')['properties'] as object);
    expect(keys).toContain('framework_context');
    expect(keys).not.toContain('frameworks');
  });
});
