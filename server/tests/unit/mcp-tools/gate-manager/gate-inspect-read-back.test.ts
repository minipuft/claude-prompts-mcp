/**
 * P4.11 — gate `inspect` reads back `severity`/`enforcementMode` from the on-disk definition.
 *
 * WHY `getDefinition()`, NOT `gate.severity`/`gate.enforcementMode`. `GenericGateGuide` resolves
 * both to a loader default (severity → 'medium', enforcementMode → the severity-based mapping)
 * whenever gate.yaml omits them, so the guide's own properties can never distinguish "author set
 * it" from "loader defaulted it" — only the raw `GateDefinitionYaml` from `getDefinition()` still
 * carries `undefined` for an omitted key. These tests exercise both branches directly against
 * `GateDiscoveryProcessor.handleInspect`, the real render path, not a copy of its logic.
 */
import { describe, expect, it } from '@jest/globals';

import { GenericGateGuide } from '../../../../src/engine/gates/registry/generic-gate-guide.js';
import { GateDiscoveryProcessor } from '../../../../src/mcp/tools/gate-manager/services/index.js';

import type { GateDefinitionYaml } from '../../../../src/engine/gates/types/index.js';
import type { GateManager } from '../../../../src/engine/gates/gate-manager.js';
import type { GateResourceContext } from '../../../../src/mcp/tools/gate-manager/core/context.js';
import type { GateManagerInput } from '../../../../src/mcp/tools/gate-manager/core/types.js';

function buildProcessor(definitions: Map<string, GateDefinitionYaml>): GateDiscoveryProcessor {
  const guides = new Map(
    Array.from(definitions.entries()).map(([id, def]) => [id, new GenericGateGuide(def)])
  );
  const gateManager = {
    get: (id: string) => guides.get(id),
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

describe('GateDiscoveryProcessor.handleInspect — P4.11 severity/enforcementMode read-back', () => {
  it('renders severity and enforcementMode when the definition sets them', async () => {
    const processor = buildProcessor(
      new Map([['test-gate', { ...baseDefinition, severity: 'low', enforcementMode: 'blocking' }]])
    );

    const result = await processor.handleInspect({
      action: 'inspect',
      id: 'test-gate',
    } satisfies GateManagerInput);
    const text = (result.content[0] as { text: string }).text;

    // MUTATION KILLED: inverting `definition.severity !== undefined` to `=== undefined` in
    // gate-discovery-processor.ts makes this assertion fail (the line disappears). Confirmed by
    // applying the inversion, re-running this file (red), and reverting.
    expect(text).toContain('Severity: low');
    expect(text).toContain('Enforcement Mode: blocking');
  });

  it('omits both lines when the definition has neither field — never a printed default', async () => {
    const processor = buildProcessor(new Map([['test-gate', baseDefinition]]));

    const result = await processor.handleInspect({
      action: 'inspect',
      id: 'test-gate',
    } satisfies GateManagerInput);
    const text = (result.content[0] as { text: string }).text;

    // MUTATION KILLED: the same inversion above makes THIS assertion fail too — it would start
    // printing 'Severity: undefined' / an always-present line. Confirmed alongside the case above.
    expect(text).not.toContain('Severity:');
    expect(text).not.toContain('Enforcement Mode:');
  });
});
