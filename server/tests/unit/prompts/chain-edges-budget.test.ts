// @lifecycle canonical - Tier A: YAML chains accept the IR's chain-level `edges` and `budget`.
//
// The point of row A.1 is that a knob does not have to be IR-only. `budget` reaching a template
// chain is what lets the adaptive-mutation ceiling (and, later, `pauseOnBlocking`) apply to the
// five bundled chains instead of only to submitted workflows. `edges` is the ordering vocabulary,
// resolved at LOAD — `linearize` lives in `modules/`, which `engine/` may not value-import, and
// resolving it here means no stage learns a second ordering rule.
//
// Every assertion below has a positive control: an ordering that changed, an error that fired.
import { describe, expect, it } from '@jest/globals';

import { validatePromptYaml } from '../../../src/modules/prompts/prompt-schema.js';
import { yamlToPromptData } from '../../../src/modules/prompts/yaml-prompt-loader.js';

function chain(extra: Record<string, unknown>) {
  return {
    id: 'edge_chain',
    name: 'Edge Chain',
    description: 'A chain prompt used for edge and budget coverage in Tier A',
    arguments: [],
    chainSteps: [
      { promptId: 'a', stepName: 'Alpha' },
      { promptId: 'b', stepName: 'Beta' },
      { promptId: 'c', stepName: 'Gamma' },
    ],
    ...extra,
  };
}

function stepOrder(yaml: Record<string, unknown>): string[] {
  const validation = validatePromptYaml(yaml);
  expect(validation.errors).toEqual([]);
  const data = yamlToPromptData(validation.data!, 'edge_chain/prompt.yaml');
  return (data.chainSteps ?? []).map((step) => step.stepName);
}

describe('YAML chain edges (row A.1)', () => {
  it('leaves the authored order untouched when no edges are declared', () => {
    expect(stepOrder(chain({}))).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('reorders steps under declared edges — the positive control for the case above', () => {
    // `gamma` before `alpha` is impossible in authored order, so a passing assertion here cannot
    // be the no-op the previous test measures.
    expect(
      stepOrder(
        chain({
          edges: [
            { from: 'gamma', to: 'alpha' },
            { from: 'alpha', to: 'beta' },
          ],
        })
      )
    ).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('addresses steps by minted node id, so an explicit `id` wins over the stepName slug', () => {
    const yaml = chain({
      chainSteps: [
        { promptId: 'a', stepName: 'Alpha', id: 'first' },
        { promptId: 'b', stepName: 'Beta', id: 'second' },
      ],
      edges: [{ from: 'second', to: 'first' }],
    });
    expect(stepOrder(yaml)).toEqual(['Beta', 'Alpha']);
  });

  it('rejects an edge naming a step id no chain step declares or mints', () => {
    const result = validatePromptYaml(chain({ edges: [{ from: 'alpha', to: 'delta' }] }));

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain("names step id 'delta'");
  });

  it('rejects a cycle rather than dropping the steps it cannot order', () => {
    const result = validatePromptYaml(
      chain({
        edges: [
          { from: 'alpha', to: 'beta' },
          { from: 'beta', to: 'alpha' },
        ],
      })
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('cycle');
  });
});

describe('YAML chain budget (row A.1)', () => {
  it('carries the two durable fields onto PromptData', () => {
    const validation = validatePromptYaml(
      chain({ budget: { maxInsertions: 1, declaredCostCeiling: 5000 } })
    );
    expect(validation.errors).toEqual([]);
    const data = yamlToPromptData(validation.data!, 'edge_chain/prompt.yaml');

    expect(data.budget).toEqual({ maxInsertions: 1, declaredCostCeiling: 5000 });
  });

  it('drops a purely structural budget rather than persisting write-only fields', () => {
    // `maxNodes`/`maxFanOut` are answered from the submission itself and have no reader after
    // validation — the same projection `compileWorkflowIR` performs on the IR path.
    const validation = validatePromptYaml(chain({ budget: { maxNodes: 4, maxFanOut: 2 } }));
    expect(validation.errors).toEqual([]);
    const data = yamlToPromptData(validation.data!, 'edge_chain/prompt.yaml');

    expect(data.budget).toBeUndefined();
  });

  it('refuses a declared cap that WIDENS the server default', () => {
    const result = validatePromptYaml(chain({ budget: { maxInsertions: 99 } }));

    expect(result.valid).toBe(false);
  });
});

describe('YAML chain step args (row A.1)', () => {
  it('carries step-declared args through the loader', () => {
    const validation = validatePromptYaml(
      chain({
        chainSteps: [{ promptId: 'a', stepName: 'Alpha', args: { depth: 'deep' } }],
      })
    );
    expect(validation.errors).toEqual([]);
    const data = yamlToPromptData(validation.data!, 'edge_chain/prompt.yaml');

    expect(data.chainSteps?.[0]?.args).toEqual({ depth: 'deep' });
  });
});
