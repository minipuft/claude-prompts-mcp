/**
 * Mutations of isolated authoring artifacts exercise the comparator's failure directions.
 * The final case and temporary-script mutation run real Python builders; no server is spawned,
 * no resource is written, and adapter readiness is not a claim of resource validity.
 */
import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  creationFields,
  loadAuthoringResources,
  REFUSED_NAMES,
  runTool,
  semanticAuthoringInput,
  validateAuthoringContracts,
} from '../../../scripts/validate-authoring-contracts.js';
import type {
  AuthoringResource,
  CreationFields,
  ScriptOutput,
  ToolOnDisk,
} from '../../../scripts/validate-authoring-contracts.js';

import { resourceManagerInputSchema } from '../../../src/mcp/tools/schemas/resource-manager.schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIELDS = creationFields();
const FIXTURES = JSON.parse(
  readFileSync(path.join(ROOT, 'tests/unit/resources/bundled-script-tool-fixtures.json'), 'utf8')
) as Record<string, { input: Record<string, unknown> }>;

/** The camelCase spellings, flattened with the creation type that owns each. */
const REFUSED = (['prompt', 'gate'] as const).flatMap((type) =>
  Object.entries(REFUSED_NAMES[type]).map(([name, canonical]) => ({ type, name, canonical }))
);

function resources(): AuthoringResource[] {
  return (['prompt', 'gate', 'framework'] as const).map((type) => ({
    type,
    tool: { id: `${type}_builder`, dir: '', promptDir: '', runtime: 'python', script: 'script.py' },
    schema: {
      type: 'object',
      properties: {
        ...structuredClone(FIELDS[type]),
        ...Object.fromEntries(
          Object.entries(REFUSED_NAMES[type]).map(([name, canonical]) => [
            name,
            structuredClone(FIELDS[type][canonical]),
          ])
        ),
      },
    },
    arguments: [
      ...Object.entries(FIELDS[type]).map(([name, field]) => ({ name, type: String(field.type) })),
      ...Object.entries(REFUSED_NAMES[type]).map(([name, canonical]) => ({
        name,
        type: String(FIELDS[type][canonical]!.type),
      })),
    ],
    input:
      type === 'gate'
        ? semanticAuthoringInput(structuredClone(FIXTURES[`${type}_builder`]!.input))
        : structuredClone(FIXTURES[`${type}_builder`]!.input),
  }));
}

/** A projection control, deliberately not a substitute for the actual-builder cases below. */
function project(tool: ToolOnDisk, input: Record<string, unknown>): ScriptOutput {
  const type = tool.id.replace('_builder', '') as AuthoringResource['type'];
  const refused = Object.entries(REFUSED_NAMES[type]).filter(([name]) => name in input);
  if (refused.length > 0) {
    return {
      valid: false,
      errors: refused.map(
        ([name, canonical]) =>
          `'${name}' is not an argument of create_${type}; send '${canonical}'.`
      ),
    };
  }
  const params = {
    resource_type: type,
    action: type === 'prompt' ? 'validate' : 'create',
    ...input,
  };
  const call = { tool: 'resource_manager', params };
  return { valid: true, ...(type === 'prompt' ? { auto_execute: call } : { draft: call }) };
}

function mutateOutput(change: (output: ScriptOutput) => void) {
  return (tool: ToolOnDisk, input: Record<string, unknown>) => {
    const output = project(tool, input);
    change(output);
    return output;
  };
}

function params(output: ScriptOutput) {
  return (output.auto_execute ?? output.draft)!.params!;
}

function check(items = resources(), fields: CreationFields = FIELDS, execute = project) {
  return validateAuthoringContracts(items, fields, execute);
}

describe('creation authoring contract drift guard', () => {
  it('accepts complete declarations and mapped inputs, including falsy owner-accepted values', () => {
    expect(check()).toEqual([]);
  });

  it('uses canonically transport-valid base drafts from all three actual adapters', () => {
    for (const resource of loadAuthoringResources()) {
      const output = runTool(resource.tool, resource.input);
      const parsed = resourceManagerInputSchema.safeParse(params(output));
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    }
  });

  it('actual gate adapter retains semantic fields and opaque suite identity', () => {
    const gate = loadAuthoringResources().find((resource) => resource.type === 'gate')!;
    const output = params(runTool(gate.tool, gate.input));
    expect(output['pass_criteria']).toEqual(gate.input['pass_criteria']);
    expect(output['calibration_suite_id']).toBe('../opaque-public-association');
    expect(resourceManagerInputSchema.safeParse(output).success).toBe(true);
  });

  it.each(['calibration_suite_id', 'pass_criteria'])(
    'detects removed public semantic field %s',
    (field) => {
      expect(
        check(
          resources(),
          FIELDS,
          mutateOutput((output) => {
            delete params(output)[field];
          })
        ).some((error) => error.includes(`${field}: adapter lost`))
      ).toBe(true);
    }
  );

  it('detects a lost nested semantic question', () => {
    expect(
      check(
        resources(),
        FIELDS,
        mutateOutput((output) => {
          const criteria = params(output)['pass_criteria'];
          if (Array.isArray(criteria))
            params(output)['pass_criteria'] = criteria.map((criterion) => {
              if (criterion.type !== 'semantic_evaluation') return criterion;
              const copy = { ...criterion };
              delete copy.question;
              return copy;
            });
        })
      ).some((error) => error.includes('pass_criteria: adapter lost'))
    ).toBe(true);
  });

  it('detects missing public semantic guidance in actual builder resources', () => {
    const items = loadAuthoringResources();
    const gate = items.find((item) => item.type === 'gate')!;
    gate.guidance = gate.guidance!.replaceAll('calibration_suite_id', 'calibrationSuite');
    expect(
      validateAuthoringContracts(items, FIELDS).some((error) =>
        error.includes('calibration_suite_id: missing public semantic guidance')
      )
    ).toBe(true);
  });

  it('reports nested base shape drift using the canonical transport owner', () => {
    const items = resources();
    const budget = items[0]!.input['budget'] as Record<string, unknown>;
    budget['declaredCostCeiling'] = 0;
    expect(
      check(items).some((error) =>
        error.includes('budget.declaredCostCeiling: base draft fails canonical transport schema')
      )
    ).toBe(true);
  });

  it('fails a silently empty enumeration', () => {
    expect(check([])).toEqual(
      expect.arrayContaining([
        'create_prompt: no builder found',
        'create_gate: no builder found',
        'create_framework: no builder found',
      ])
    );
  });

  it.each(['edges', 'budget'])('detects missing modern schema field %s', (field) => {
    const items = resources();
    delete items[0]!.schema.properties![field];
    expect(check(items)).toContain(
      `create_prompt/prompt_builder/${field}: missing builder schema field`
    );
  });

  it('fails when a future canonical field joins the owner contract without an adapter declaration', () => {
    const fields = structuredClone(FIELDS);
    fields.prompt['future_input'] = { type: 'string' };
    expect(check(resources(), fields)).toContain(
      'create_prompt/prompt_builder/future_input: missing builder schema field'
    );
  });

  it('rejects removed or renamed canonical fields still exposed by resources', () => {
    const fields = structuredClone(FIELDS);
    delete fields.prompt['budget'];
    fields.prompt['run_budget'] = { type: 'object' };
    const errors = check(resources(), fields);
    expect(errors).toContain('create_prompt/prompt_builder/budget: undeclared creation field');
    expect(errors).toContain(
      'create_prompt/prompt_builder/run_budget: missing builder schema field'
    );
  });

  it('names a lost registered prompt argument', () => {
    const items = resources();
    items[0]!.arguments = items[0]!.arguments.filter((argument) => argument.name !== 'edges');
    expect(check(items)).toContain(
      'create_prompt/prompt_builder/edges: missing registered prompt argument'
    );
  });

  it.each(['schema', 'argument'])('rejects %s type drift', (surface) => {
    const items = resources();
    if (surface === 'schema') items[0]!.schema.properties!['edges'] = { type: 'object' };
    else items[0]!.arguments.find((argument) => argument.name === 'edges')!.type = 'object';
    expect(
      check(items).some(
        (error) => error.includes('edges:') && error.includes('differs from transport array')
      )
    ).toBe(true);
  });

  it('detects undeclared output, wrong resource and action, and unsafe automatic creation', () => {
    const errors = check(
      resources(),
      FIELDS,
      mutateOutput((output) => {
        const payload = params(output);
        payload['unsupported_field'] = true;
        payload['resource_type'] = 'category';
        payload['action'] = 'preview';
        if (output.draft) output.auto_execute = output.draft;
      })
    );
    expect(errors).toContain(
      'create_prompt/prompt_builder/unsupported_field: emitted undeclared creation parameter'
    );
    expect(errors).toContain(
      'create_prompt/prompt_builder/resource_type: incorrect draft resource'
    );
    expect(errors).toContain(
      'create_prompt/prompt_builder/action: expected validate, received preview'
    );
    expect(errors).toContain(
      'create_gate/gate_builder/auto_execute: gate/framework creation must require client action'
    );
  });

  it('rejects auto-create on the prompt adapter', () => {
    expect(
      check(
        resources(),
        FIELDS,
        mutateOutput((output) => {
          params(output)['action'] = 'create';
        })
      )
    ).toContain('create_prompt/prompt_builder/action: expected validate, received create');
  });

  it.each([
    'args',
    'id',
    'inlineGateIds',
    'inlineGateCriteria',
    'visibility',
    'delegated',
    'await',
    'subagentModel',
    'agentType',
  ])('detects modern nested chain field loss: %s', (field) => {
    const errors = check(
      resources(),
      FIELDS,
      mutateOutput((output) => {
        const payload = params(output);
        if (Array.isArray(payload['chain_steps']) && payload['chain_steps'][0]) {
          payload['chain_steps'] = structuredClone(payload['chain_steps']);
          delete (payload['chain_steps'] as Array<Record<string, unknown>>)[0]![field];
        }
      })
    );
    expect(errors).toContain(
      'create_prompt/prompt_builder/chain_steps: adapter lost or changed mapped value for chain_steps'
    );
  });

  it.each(['register_with_mcp', 'block_response_on_fail', 'enabled'])(
    'detects dropped false value: %s',
    (field) => {
      expect(
        check(
          resources(),
          FIELDS,
          mutateOutput((output) => {
            if (params(output)[field] === false) delete params(output)[field];
          })
        ).some((error) => error.includes(`${field}: adapter lost`))
      ).toBe(true);
    }
  );

  it('detects a scalar enum hardcoded to the baseline value', () => {
    const errors = check(
      resources(),
      FIELDS,
      mutateOutput((output) => {
        if (Object.hasOwn(params(output), 'mcp_prompt_mode'))
          params(output)['mcp_prompt_mode'] = 'launch';
      })
    );
    expect(errors).toContain(
      'create_prompt/prompt_builder/mcp_prompt_mode: adapter lost or changed mapped value for mcp_prompt_mode'
    );
  });

  describe('camelCase spellings are refused by the actual builders', () => {
    const builderFor = (type: 'prompt' | 'gate') =>
      loadAuthoringResources().find((resource) => resource.type === type)!;

    it.each(REFUSED)(
      '$type builder refuses $name and names $canonical',
      ({ type, name, canonical }) => {
        const resource = builderFor(type);
        const input = { ...resource.input, [name]: resource.input[canonical] };
        delete input[canonical];
        const output = runTool(resource.tool, input);
        expect(output.valid).toBe(false);
        expect(output.auto_execute).toBeUndefined();
        expect(output.draft).toBeUndefined();
        expect(output.errors).toEqual([
          `'${name}' is not an argument of create_${type}; send '${canonical}'.`,
        ]);
      }
    );

    it.each(REFUSED)(
      '$type builder refuses $name even beside $canonical',
      ({ type, name, canonical }) => {
        const resource = builderFor(type);
        const output = runTool(resource.tool, {
          ...resource.input,
          [name]: resource.input[canonical],
        });
        expect(output.valid).toBe(false);
        expect(output.errors).toHaveLength(1);
      }
    );

    it.each(REFUSED)('$type builder builds from $canonical', ({ type, name, canonical }) => {
      const resource = builderFor(type);
      const output = runTool(resource.tool, resource.input);
      expect(output.valid).toBe(true);
      expect(params(output)[canonical]).toEqual(resource.input[canonical]);
      expect(Object.keys(params(output))).not.toContain(name);
    });

    it('names every camelCase spelling received, one line each', () => {
      const resource = builderFor('prompt');
      const output = runTool(resource.tool, {
        ...resource.input,
        systemMessage: 'x',
        chainSteps: [],
      });
      expect(output.errors).toEqual([
        "'systemMessage' is not an argument of create_prompt; send 'system_message'.",
        "'chainSteps' is not an argument of create_prompt; send 'chain_steps'.",
      ]);
    });

    it('declares each refused name where the input has to travel to reach the builder', () => {
      for (const { type, name } of REFUSED) {
        const resource = builderFor(type);
        expect(Object.keys(resource.schema.properties ?? {})).toContain(name);
        expect(resource.arguments.map((entry) => entry.name)).toContain(name);
      }
    });
  });

  it.each(REFUSED)('detects a builder that accepts $name', ({ type, name, canonical }) => {
    const errors = check(resources(), FIELDS, (tool, input) => {
      const copy = { ...input };
      if (name in copy) {
        copy[canonical] = copy[name];
        delete copy[name];
      }
      return project(tool, copy);
    });
    expect(errors).toContain(
      `create_${type}/${type}_builder/${name}: builder did not refuse the name`
    );
  });

  it('detects a builder that refuses without naming the canonical spelling', () => {
    const errors = check(resources(), FIELDS, (tool, input) => {
      const output = project(tool, input);
      return output.valid === false ? { valid: false, errors: ['refused'] } : output;
    });
    expect(errors).toContain(
      "create_prompt/prompt_builder/systemMessage: refusal must be one line naming 'systemMessage' and 'system_message'"
    );
  });

  it('detects a refused name that is no longer declared in the builder schema', () => {
    const items = resources();
    delete items[0]!.schema.properties!['systemMessage'];
    expect(check(items)).toContain(
      'create_prompt/prompt_builder/systemMessage: refused name must be declared in the builder schema and the prompt'
    );
  });

  it('detects lost mapping in an actual isolated subprocess adapter', () => {
    const items = loadAuthoringResources();
    const prompt = items.find((resource) => resource.type === 'prompt')!;
    const dir = mkdtempSync(path.join(tmpdir(), 'authoring-adapter-mutation-'));
    try {
      // Wrap a copy of the actual script, changing only its emitted edges mapping.
      const original = readFileSync(path.join(prompt.tool.dir, prompt.tool.script), 'utf8');
      writeFileSync(
        path.join(dir, 'script.py'),
        'import json\n_original_dumps = json.dumps\ndef _mutated_dumps(value, *args, **kwargs):\n' +
          '    if isinstance(value, dict):\n' +
          '        value.get("auto_execute", {}).get("params", {}).pop("edges", None)\n' +
          '    return _original_dumps(value, *args, **kwargs)\njson.dumps = _mutated_dumps\n' +
          original.replace('#!/usr/bin/env python3\n', '')
      );
      prompt.tool = { ...prompt.tool, dir, script: 'script.py' };
      expect(validateAuthoringContracts(items, FIELDS, runTool)).toContain(
        'create_prompt/prompt_builder/edges: adapter lost or changed mapped value for edges'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(['calibration_suite_id', 'question'])(
    'actual isolated gate adapter detects lost %s',
    (field) => {
      const items = loadAuthoringResources();
      const gate = items.find((resource) => resource.type === 'gate')!;
      const dir = mkdtempSync(path.join(tmpdir(), 'semantic-adapter-mutation-'));
      try {
        const original = readFileSync(path.join(gate.tool.dir, gate.tool.script), 'utf8');
        const removal =
          field === 'question'
            ? '        for criterion in params.get("pass_criteria", []):\n            if criterion.get("type") == "semantic_evaluation": criterion.pop("question", None)\n'
            : '        params.pop("calibration_suite_id", None)\n';
        writeFileSync(
          path.join(dir, 'script.py'),
          'import json\n_original_dumps = json.dumps\ndef _mutated_dumps(value, *args, **kwargs):\n' +
            '    if isinstance(value, dict):\n        params = value.get("draft", {}).get("params", {})\n' +
            removal +
            '    return _original_dumps(value, *args, **kwargs)\njson.dumps = _mutated_dumps\n' +
            original.replace('#!/usr/bin/env python3\n', '')
        );
        gate.tool = { ...gate.tool, dir, script: 'script.py' };
        const key = field === 'question' ? 'pass_criteria' : field;
        expect(validateAuthoringContracts(items, FIELDS, runTool)).toContain(
          `create_gate/gate_builder/${key}: adapter lost or changed mapped value for ${key}`
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  it('checks the real bundled resources and subprocess adapters against their current owners', () => {
    expect(validateAuthoringContracts(loadAuthoringResources(), FIELDS)).toEqual([]);
  });
});
