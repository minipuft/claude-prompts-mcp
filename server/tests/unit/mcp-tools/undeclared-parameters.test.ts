/**
 * One refusal, three tools: an argument key no contract declares (P4.93 / R50).
 *
 * The defect this pins is a SILENT SUCCESS. Measured on `f711401b` over both transports,
 * `prompt_engine {command, force_restrt:true}` and `system_control {action:"status", previw:true}`
 * both answered `isError:false` with a normal result, because zod strips an unknown key before the
 * registered callback runs. A caller that misspells a safety flag — `dry_run`, `preview`,
 * `confirm` — therefore gets a success reply while the server performed the unguarded action.
 *
 * Every assertion here names WHICH half answered (undeclared / declared-but-unavailable) rather
 * than checking for a non-null string, so a refusal whose cause moves cannot keep these green.
 *
 * The control is enumerated from the contract JSON, not from a hand-kept list: a refusal that
 * rejected a declared parameter would be the same defect pointed the other way, and a control
 * built from the same table the implementation reads could not see that.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import {
  DECLARED_PARAMETERS_BY_TOOL,
  GATE_PARAMETERS_UNAVAILABLE,
  describeUndeclaredParameterRefusal,
  nearestDeclaredParameter,
  type ContractToolName,
} from '../../../src/mcp/tools/shared/undeclared-parameters.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONTRACT_FILE: Readonly<Record<ContractToolName, string>> = {
  prompt_engine: 'prompt-engine.json',
  system_control: 'system-control.json',
  resource_manager: 'resource-manager.json',
};

/** Parameter names straight out of the contract JSON — the client-visible surface. */
function contractParameterNames(tool: ContractToolName): string[] {
  const raw = readFileSync(
    path.join(SERVER_ROOT, 'tooling', 'contracts', CONTRACT_FILE[tool]),
    'utf8'
  );
  const parsed = JSON.parse(raw) as { parameters?: { name: string }[] };
  return (parsed.parameters ?? []).map((parameter) => parameter.name);
}

const TOOLS = Object.keys(CONTRACT_FILE) as ContractToolName[];

describe('undeclared parameter refusal', () => {
  describe.each(TOOLS)('%s', (tool) => {
    it('refuses a planted key BY NAME, and says it is not a parameter of this tool', () => {
      const message = describeUndeclaredParameterRefusal(tool, { totally_made_up_key: 1 });

      expect(message).toContain("'totally_made_up_key'");
      expect(message).toContain(`is not a parameter of ${tool}`);
    });

    it('CONTROL: every parameter the contract declares still passes', () => {
      // Enumerated from the JSON so a refusal narrower than the published surface fails here.
      const args = Object.fromEntries(contractParameterNames(tool).map((name) => [name, 'value']));

      expect(describeUndeclaredParameterRefusal(tool, args)).toBeNull();
    });

    it('CONTROL: the declared set is the contract, both directions', () => {
      const declared = [...DECLARED_PARAMETERS_BY_TOOL[tool]].sort();

      expect(declared).toEqual(contractParameterNames(tool).sort());
    });

    it('ignores a key that was never SENT (an in-process `undefined`)', () => {
      // JSON has no `undefined`, so nothing over MCP reaches here this way; an in-process caller
      // building its argument object with an unset optional field does, and refusing that would
      // refuse a key nobody sent. A JSON `null` IS a value, which the next case pins.
      expect(describeUndeclaredParameterRefusal(tool, { made_up: undefined })).toBeNull();
      expect(describeUndeclaredParameterRefusal(tool, { made_up: null })).toContain("'made_up'");
    });
  });

  it('names EVERY undeclared key in one message, in the order they were sent', () => {
    const message = describeUndeclaredParameterRefusal('system_control', {
      action: 'status',
      first_bogus: 1,
      second_bogus: 2,
    });

    expect(message).toContain(
      "'first_bogus' and 'second_bogus' are not parameters of system_control"
    );
  });

  describe('nearest declared name', () => {
    it('suggests the contract spelling of a camelCase key (enforcementMode)', () => {
      // The case R50 names. `gate_builder/script.py` already remaps this by hand, which is what a
      // silent strip cost the last time: the tool had to learn the correction out of band.
      expect(
        nearestDeclaredParameter('enforcementMode', DECLARED_PARAMETERS_BY_TOOL.resource_manager)
      ).toBe('enforcement_mode');
    });

    it('suggests across a one-character typo, inside the refusal message', () => {
      const message = describeUndeclaredParameterRefusal('prompt_engine', {
        command: '>>demo',
        force_restrt: true,
      });

      expect(message).toContain("Did you mean 'force_restart'?");
    });

    it('offers NOTHING when no declared name is close', () => {
      // A wrong guess sends the caller to re-send under a name they never wanted, so the
      // suggestion has to be able to decline.
      const message = describeUndeclaredParameterRefusal('prompt_engine', { zzzzzzzzzzzz: 1 });

      expect(message).not.toContain('Did you mean');
      expect(
        nearestDeclaredParameter('zzzzzzzzzzzz', DECLARED_PARAMETERS_BY_TOOL.prompt_engine)
      ).toBeUndefined();
    });
  });

  describe('declared but not advertised (the prompt_engine union)', () => {
    it('says the gate system is off — NOT "not a parameter"', () => {
      // `gate_verdict` IS in the contract (CLAUDE.md §Public API Contract: the tool surface is a
      // union, and the gate trio is a member advertised only while gates are enabled). Telling its
      // sender it is not a parameter would be false, and would send them to fix a spelling that is
      // already right.
      const message = describeUndeclaredParameterRefusal(
        'prompt_engine',
        { command: '>>demo', gate_verdict: 'GATE_REVIEW: PASS - ok' },
        GATE_PARAMETERS_UNAVAILABLE
      );

      expect(message).toContain("'gate_verdict' is a parameter of prompt_engine");
      expect(message).toContain('the gate system is disabled');
      expect(message).not.toContain('is not a parameter');
    });

    it('CONTROL: the same key passes once the state advertises it', () => {
      expect(
        describeUndeclaredParameterRefusal('prompt_engine', {
          command: '>>demo',
          gate_verdict: 'GATE_REVIEW: PASS - ok',
        })
      ).toBeNull();
    });

    it('every unavailable name is a DECLARED one', () => {
      // An "unavailable" key the contract does not name would be a second undeclared class wearing
      // the wrong message.
      for (const name of GATE_PARAMETERS_UNAVAILABLE.keys()) {
        expect(DECLARED_PARAMETERS_BY_TOOL.prompt_engine.has(name)).toBe(true);
      }
    });
  });
});
