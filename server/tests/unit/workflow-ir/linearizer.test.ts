import { linearize } from '../../../src/modules/workflow-ir/linearizer.js';
import type { WorkflowEdge, WorkflowNode } from '../../../src/modules/workflow-ir/types.js';

function nodes(...ids: string[]): WorkflowNode[] {
  return ids.map((id) => ({ id, promptId: `prompt_${id.replace(/-/g, '_')}` }));
}

function edge(from: string, to: string): WorkflowEdge {
  return { from, to };
}

function orderOf(result: ReturnType<typeof linearize>): readonly string[] {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.rejections)}`);
  return result.order;
}

describe('linearize — the linearization rule', () => {
  it('with no edges, emits declaration order unchanged', () => {
    // The strongest statement of the rule: the tiebreak IS the client's own declaration order,
    // so a client who wants a specific order simply writes it. This is the property that
    // replaced the authored `ambiguous-order` rejection.
    expect(orderOf(linearize(nodes('c', 'a', 'b'), []))).toEqual(['c', 'a', 'b']);
  });

  it('reorders only where an edge demands it', () => {
    // b is declared first but depends on a, so exactly one swap happens; c keeps its place
    // relative to everything it has no edge with.
    const result = linearize(nodes('b', 'a', 'c'), [edge('a', 'b')]);
    expect(orderOf(result)).toEqual(['a', 'b', 'c']);
  });

  it('linearizes a diamond deterministically by declaration order', () => {
    const diamond = nodes('root', 'left', 'right', 'join');
    const edges = [
      edge('root', 'left'),
      edge('root', 'right'),
      edge('left', 'join'),
      edge('right', 'join'),
    ];
    expect(orderOf(linearize(diamond, edges))).toEqual(['root', 'left', 'right', 'join']);
  });

  it('is a function of the IR, not of edge-array order', () => {
    // Same graph, edges listed in reverse. The tiebreak reads `nodes[]`, never the edge array,
    // so the two must agree — otherwise the "one IR, one linearization" claim is false.
    const diamond = nodes('root', 'left', 'right', 'join');
    const forward = [
      edge('root', 'left'),
      edge('root', 'right'),
      edge('left', 'join'),
      edge('right', 'join'),
    ];
    expect(orderOf(linearize(diamond, [...forward].reverse()))).toEqual(
      orderOf(linearize(diamond, forward))
    );
  });

  it('is stable across repeated calls (no hidden state)', () => {
    const declared = nodes('a', 'b', 'c', 'd');
    const edges = [edge('d', 'b'), edge('a', 'c')];
    const first = orderOf(linearize(declared, edges));
    const second = orderOf(linearize(declared, edges));
    const third = orderOf(linearize(declared, edges));
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('drains the ready set by declaration index, not by discovery order', () => {
    // `z` becomes runnable before `a` is discovered, but `a` is declared earlier, so `a` wins.
    // A naive FIFO queue passes the diamond test above and fails this one.
    const declared = nodes('a', 'gate', 'z');
    const result = linearize(declared, [edge('gate', 'z')]);
    expect(orderOf(result)).toEqual(['a', 'gate', 'z']);
  });

  it('rejects a two-node cycle, naming both nodes', () => {
    const result = linearize(nodes('a', 'b'), [edge('a', 'b'), edge('b', 'a')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.reason).toBe('cycle');
    expect(result.rejections[0]?.detail).toContain('a');
    expect(result.rejections[0]?.detail).toContain('b');
  });

  it('rejects a self-edge as a cycle', () => {
    const result = linearize(nodes('a'), [edge('a', 'a')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rejections[0]?.reason).toBe('cycle');
    expect(result.rejections[0]?.nodeId).toBe('a');
  });

  it('places every acyclic node even when a cycle exists elsewhere', () => {
    // The rejection must name the stuck set, not the whole workflow — a client fixing a cycle
    // needs to know which nodes participate.
    const result = linearize(nodes('free', 'a', 'b'), [edge('a', 'b'), edge('b', 'a')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rejections[0]?.detail).not.toContain('free');
  });

  it('ignores edges naming an undeclared endpoint (the validator owns that rejection)', () => {
    // Two producers for one reason is how rejection text drifts. Endpoint checking lives in
    // validateWorkflowIR; here the edge is simply not a constraint.
    expect(orderOf(linearize(nodes('a', 'b'), [edge('ghost', 'a')]))).toEqual(['a', 'b']);
  });

  it('handles an empty node list', () => {
    expect(orderOf(linearize([], []))).toEqual([]);
  });
});
