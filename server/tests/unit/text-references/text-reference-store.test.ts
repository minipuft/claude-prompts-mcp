import { createLogger } from '../../../src/infra/logging/index.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';

const logger = createLogger({
  logFile: '/tmp/text-reference-manager.log',
  transport: 'stdio',
  enableDebug: false,
  configuredLevel: 'error',
});

describe('TextReferenceStore.buildChainVariables', () => {
  test('exposes step results and chain metadata', () => {
    const manager = new TextReferenceStore(logger);
    manager.storeChainStepResult('chain-1', 'n1', 'draft summary');
    manager.storeChainStepResult('chain-1', 'n2', 'final answer');

    const variables = manager.buildChainVariables('chain-1');

    expect(variables.step1_result).toBe('draft summary');
    expect(variables.step2_result).toBe('final answer');
    expect(variables.previous_step_result).toBe('final answer');
    expect(variables.chain_id).toBe('chain-1');
    expect(variables.step_results).toEqual({ 0: 'draft summary', 1: 'final answer' });
  });

  test('the supplied ordinal, not insertion order, names the step variables', () => {
    const manager = new TextReferenceStore(logger);
    // Results keyed by node id but stored out of run order — which is exactly what P4's
    // insertions and retries produce. The rendered names must follow the run's positions.
    manager.storeChainStepResult('chain-2', 'review', 'reviewed', undefined, 2);
    manager.storeChainStepResult('chain-2', 'draft', 'drafted', undefined, 1);

    const variables = manager.buildChainVariables('chain-2');

    // `step${ordinal + 1}_result` reproduces the pre-node-identity naming exactly, where the
    // container key WAS the 1-based ordinal. (That it starts at step2_result for step 1 is a
    // pre-existing quirk this deliberately preserves rather than silently renumbering.)
    expect(variables.step2_result).toBe('drafted');
    expect(variables.step3_result).toBe('reviewed');
    expect(variables.step_results).toEqual({ 1: 'drafted', 2: 'reviewed' });
  });

  test('a stored result is addressable by node id, not by position', () => {
    const manager = new TextReferenceStore(logger);
    manager.storeChainStepResult('chain-3', 'draft', 'drafted', { note: 'first' }, 1);

    expect(manager.getChainStepResult('chain-3', 'draft')).toBe('drafted');
    expect(manager.getChainStepMetadata('chain-3', 'draft')).toEqual({ note: 'first' });
    expect(manager.getChainStepResult('chain-3', 'nope')).toBeNull();
  });
});

/**
 * P6 Tier 3 — the reserved `outputs.<name>` namespace (OQ-P6-5, owner ruled the ALTERNATIVE).
 *
 * Asserted against the BARE name as well as the namespaced one on every case: publishing under
 * `outputs` while ALSO leaving the flat alias behind would satisfy a namespace-only assertion
 * and would be exactly the dual-read parallel system the ruling forbids.
 */
describe('TextReferenceStore named outputs — reserved namespace', () => {
  test('an outputMapping key is published under outputs.<name> and NOT as a bare alias', () => {
    const manager = new TextReferenceStore(logger);
    manager.storeChainStepResult('chain-ns', 'analyze', 'ANALYSIS_BODY', {
      outputMapping: { findings: 'output' },
    });

    const variables = manager.buildChainVariables('chain-ns');

    expect(variables.outputs).toEqual({ findings: 'ANALYSIS_BODY' });
    expect(variables.findings).toBeUndefined();
    expect(Object.keys(variables)).not.toContain('findings');
  });

  test('the namespace is absent, not empty, when no step declares an outputMapping', () => {
    const manager = new TextReferenceStore(logger);
    manager.storeChainStepResult('chain-plain', 'analyze', 'ANALYSIS_BODY');

    const variables = manager.buildChainVariables('chain-plain');

    // Absence, not `{}`: matches `previous_step_results` / `unknowns_ledger`, so a template can
    // branch on presence and a chain declaring nothing renders as it did before the namespace.
    expect(Object.keys(variables)).not.toContain('outputs');
  });

  test('every key of a mapping receives the WHOLE step content — the values are not read (P6-F2)', () => {
    const manager = new TextReferenceStore(logger);
    // `verdict` reads like a sub-content selector. Nothing implements one, so it must not be
    // silently honoured — the two keys carry identical bytes and the doc says so.
    manager.storeChainStepResult('chain-two-key', 'audit', 'AUDIT_BODY', {
      outputMapping: { security_audit: 'output', security_verdict: 'verdict' },
    });

    const outputs = manager.buildChainVariables('chain-two-key').outputs as Record<string, string>;

    expect(outputs.security_audit).toBe('AUDIT_BODY');
    expect(outputs.security_verdict).toBe('AUDIT_BODY');
  });

  test('later steps merge into one namespace object; a repeated name is overwritten', () => {
    const manager = new TextReferenceStore(logger);
    manager.storeChainStepResult(
      'chain-merge',
      'first',
      'FIRST_BODY',
      { outputMapping: { findings: 'output' } },
      0
    );
    manager.storeChainStepResult(
      'chain-merge',
      'second',
      'SECOND_BODY',
      { outputMapping: { summary: 'output', findings: 'output' } },
      1
    );

    expect(manager.buildChainVariables('chain-merge').outputs).toEqual({
      findings: 'SECOND_BODY',
      summary: 'SECOND_BODY',
    });
  });

  test('the published namespace is a copy — mutating it cannot corrupt stored results', () => {
    const manager = new TextReferenceStore(logger);
    manager.storeChainStepResult('chain-copy', 'analyze', 'ANALYSIS_BODY', {
      outputMapping: { findings: 'output' },
    });

    const first = manager.buildChainVariables('chain-copy').outputs as Record<string, string>;
    first.findings = 'TAMPERED';

    expect(manager.buildChainVariables('chain-copy').outputs).toEqual({
      findings: 'ANALYSIS_BODY',
    });
  });

  test('clearing a chain removes its namespace', () => {
    const manager = new TextReferenceStore(logger);
    manager.storeChainStepResult('chain-clear', 'analyze', 'ANALYSIS_BODY', {
      outputMapping: { findings: 'output' },
    });
    manager.clearChainStepResults('chain-clear');

    expect(Object.keys(manager.buildChainVariables('chain-clear'))).not.toContain('outputs');
  });
});
