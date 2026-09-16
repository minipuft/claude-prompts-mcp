/**
 * P4.11 — gate `inspect` reads `severity`/`enforcementMode` from the definition
 * (`GateGuide.getDefinition()`), not from `gate.severity`/`gate.enforcementMode`.
 *
 * Each fixture is authored the way a `gate.yaml` is and then run through
 * `GateDefinitionSchema.parse`, so every double is an object `GateDefinitionLoader` could
 * actually hand back: `severity` carries the schema default when the file omits it, while
 * `enforcementMode` has no default and stays absent. Inspect therefore reports the EFFECTIVE
 * severity — the value the engine acts on — and there is no "author set it" vs "loader
 * defaulted it" distinction left to read off a parsed object. These tests drive
 * `GateDiscoveryProcessor.handleInspect`, the real render path, not a copy of its logic.
 */
import { describe, expect, it } from '@jest/globals';

import { GateDefinitionSchema } from '../../../../src/engine/gates/core/gate-schema.js';
import { GenericGateGuide } from '../../../../src/engine/gates/registry/generic-gate-guide.js';
import { GateDiscoveryProcessor } from '../../../../src/mcp/tools/gate-manager/services/index.js';
import { EMPTY_QUARANTINE_VIEW } from '../../../../src/shared/utils/resource-quarantine.js';

import type { GateDefinitionYaml } from '../../../../src/engine/gates/types/index.js';
import type { GateManager } from '../../../../src/engine/gates/gate-manager.js';
import type { GateResourceContext } from '../../../../src/mcp/tools/gate-manager/core/context.js';
import type { GateManagerInput } from '../../../../src/mcp/tools/gate-manager/core/types.js';

function buildProcessor(definitions: Map<string, GateDefinitionYaml>): GateDiscoveryProcessor {
  const guides = new Map(
    Array.from(definitions.entries()).map(([id, def]) => [
      id,
      // Through the schema, not around it: the loader parses, so a double built any other way
      // could assert about a definition no gate.yaml can produce.
      new GenericGateGuide(GateDefinitionSchema.parse(def)),
    ])
  );
  const gateManager = {
    get: (id: string) => guides.get(id),
    // `handleInspect` appends the shadowed-file note (P4.15), which reads the loader's quarantine
    // through the manager. An empty view is what a healthy process has, so these cases still
    // measure only the severity/enforcementMode read-back they were written for.
    getQuarantine: () => EMPTY_QUARANTINE_VIEW,
  } as unknown as GateManager;
  const ctx = { gateManager } as unknown as GateResourceContext;
  return new GateDiscoveryProcessor(ctx);
}

const baseDefinition: GateDefinitionYaml = {
  id: 'test-gate',
  name: 'Test Gate',
  type: 'validation',
  description: 'a gate used only to prove read-back',
};

describe('GateDiscoveryProcessor.handleInspect — P4.11 severity/enforcementMode rendering', () => {
  it('renders severity and enforcementMode when the definition sets them', async () => {
    const processor = buildProcessor(
      new Map([['test-gate', { ...baseDefinition, severity: 'low', enforcementMode: 'blocking' }]])
    );

    const result = await processor.handleInspect({
      action: 'inspect',
      id: 'test-gate',
    } satisfies GateManagerInput);
    const text = (result.content[0] as { text: string }).text;

    // MUTATION KILLED: dropping `${severityLine}` from the template in
    // gate-discovery-processor.ts makes this assertion fail. Confirmed by applying the deletion,
    // re-running this file (red), and reverting.
    expect(text).toContain('Severity: low');
    expect(text).toContain('Enforcement Mode: blocking');
  });

  it('renders the defaulted severity, and still omits enforcementMode, when the gate.yaml sets neither', async () => {
    const processor = buildProcessor(new Map([['test-gate', baseDefinition]]));

    const result = await processor.handleInspect({
      action: 'inspect',
      id: 'test-gate',
    } satisfies GateManagerInput);
    const text = (result.content[0] as { text: string }).text;

    // 'medium' is the schema default, not a literal in the fixture above — inspect shows the
    // severity the engine will use.
    expect(text).toContain('Severity: medium');
    // MUTATION KILLED: inverting `definition.enforcementMode !== undefined` to `=== undefined`
    // makes this print 'Enforcement Mode: undefined'. Confirmed by applying the inversion,
    // re-running this file (red), and reverting.
    expect(text).not.toContain('Enforcement Mode:');
  });
});
