// @lifecycle canonical - Pure bounded validation of a submitted Workflow IR (P6 Tier 4).
/**
 * Workflow IR validator.
 *
 * Pure: every fact about the outside world arrives through {@link WorkflowValidatorDeps}. The
 * result is a discriminated `{ok:true, order} | {ok:false, rejections[]}` mirroring
 * `TemplatePatchResult` (P7) and `MutationNoneReason` (P4) — a named vocabulary, never a boolean
 * plus a message.
 *
 * ALL rejections are collected, not the first one. A client fixing a submission one error per
 * round trip is the failure mode "actionable" (acceptance clause b) is supposed to prevent.
 *
 * Order of checks is load-bearing exactly once: node-id uniqueness runs before everything that
 * addresses a node by id, because with duplicate ids "the node named X" is not a well-formed
 * address and every later rejection would be ambiguous about which one it meant.
 */

import { linearize } from './linearizer.js';
import {
  DEFAULT_WORKFLOW_CAPS,
  WORKFLOW_NODE_ID_PATTERN,
  WORKFLOW_VISIBILITY_ITEMS,
  type WorkflowCaps,
  type WorkflowIR,
  type WorkflowNode,
  type WorkflowPromptInfo,
  type WorkflowRejection,
  type WorkflowValidation,
} from './types.js';

/** Everything the validator needs from outside itself. Injected, never imported. */
export interface WorkflowValidatorDeps {
  /** Resolve a prompt id. `undefined` means the id does not exist → `unknown-prompt`. */
  readonly lookupPrompt: (promptId: string) => WorkflowPromptInfo | undefined;
  /** Server caps. A submission's `budget` may narrow these, never widen. */
  readonly caps?: WorkflowCaps;
}

/**
 * Validate a submitted IR and, when it is valid, return its linearization.
 *
 * Returning the order from the validator rather than making the caller run the linearizer
 * separately is deliberate: an IR is only "valid" if it HAS an order, so a caller holding
 * `{ok:true}` without one could still be holding a cyclic graph.
 */
export function validateWorkflowIR(
  ir: WorkflowIR,
  deps: WorkflowValidatorDeps
): WorkflowValidation {
  const serverCaps = deps.caps ?? DEFAULT_WORKFLOW_CAPS;
  const rejections: WorkflowRejection[] = [];

  if (ir.nodes.length === 0) {
    return {
      ok: false,
      rejections: [
        {
          reason: 'empty-workflow',
          detail: 'A workflow must declare at least one node',
        },
      ],
    };
  }

  const duplicates = collectIdRejections(ir.nodes, rejections);
  if (duplicates) {
    // Every remaining check addresses nodes by id. Reporting them against an ambiguous address
    // would produce rejections the client cannot act on.
    return { ok: false, rejections };
  }

  const nodeIds = new Set(ir.nodes.map((node) => node.id));

  collectCapRejections(ir, serverCaps, rejections);
  collectNodeRejections(ir.nodes, deps, rejections);
  collectEdgeRejections(ir, nodeIds, rejections);
  collectGateTargetRejections(ir, nodeIds, rejections);

  if (rejections.length > 0) {
    return { ok: false, rejections };
  }

  const linearization = linearize(ir.nodes, ir.edges ?? []);
  if (!linearization.ok) {
    return { ok: false, rejections: linearization.rejections };
  }
  return { ok: true, order: linearization.order };
}

/**
 * Node-id shape and uniqueness.
 *
 * @returns true when an id problem was found — the caller stops, see {@link validateWorkflowIR}.
 */
function collectIdRejections(
  nodes: readonly WorkflowNode[],
  rejections: WorkflowRejection[]
): boolean {
  const before = rejections.length;
  const seen = new Set<string>();

  for (const node of nodes) {
    if (!WORKFLOW_NODE_ID_PATTERN.test(node.id)) {
      rejections.push({
        reason: 'invalid-node-id',
        nodeId: node.id,
        detail: `Node id "${node.id}" must be kebab-case (lowercase alphanumeric, hyphen-separated)`,
      });
      continue;
    }
    if (seen.has(node.id)) {
      rejections.push({
        reason: 'duplicate-node-id',
        nodeId: node.id,
        detail: `Node id "${node.id}" is declared more than once; node ids must be unique within a workflow`,
      });
      continue;
    }
    seen.add(node.id);
  }

  return rejections.length > before;
}

/**
 * Structural caps.
 *
 * A declared budget may only narrow a server cap, never widen it — but that constraint is
 * enforced at the MCP tool boundary (`workflowBudgetSchema`'s `.max(DEFAULT_WORKFLOW_CAPS.*)`),
 * not here: every real ingress into this validator has already passed that schema, so a
 * `declaredValue > serverValue` widening attempt can never reach this function (MEASURED
 * 2026-08-17, `tests/e2e/conformance/workflow-ir.yaml`'s `workflow-rejects-cap-widening` case
 * asserts the Zod-layer rejection instead). What remains here is the one reachable failure: the
 * submission itself, measured against the effective (narrowed) cap, exceeds it.
 */
function collectCapRejections(
  ir: WorkflowIR,
  serverCaps: WorkflowCaps,
  rejections: WorkflowRejection[]
): void {
  const declared = ir.budget;

  const effectiveMaxNodes = Math.min(serverCaps.maxNodes, declared?.maxNodes ?? Infinity);
  if (ir.nodes.length > effectiveMaxNodes) {
    rejections.push({
      reason: 'cap-exceeded',
      detail: `Workflow declares ${ir.nodes.length} nodes, exceeding the effective maxNodes cap of ${effectiveMaxNodes}`,
    });
  }

  const effectiveMaxFanOut = Math.min(serverCaps.maxFanOut, declared?.maxFanOut ?? Infinity);
  const fanOut = new Map<string, number>();
  for (const edge of ir.edges ?? []) {
    fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1);
  }
  for (const [from, count] of fanOut) {
    if (count > effectiveMaxFanOut) {
      rejections.push({
        reason: 'cap-exceeded',
        nodeId: from,
        detail: `Node "${from}" has ${count} outgoing edges, exceeding the effective maxFanOut cap of ${effectiveMaxFanOut}`,
      });
    }
  }
}

/**
 * Per-node checks: prompt existence, required arguments, visibility vocabulary.
 *
 * `required` enforcement here closes P7-F6 for THIS surface only. The engine-layer gap
 * (`ArgumentParser.enrichResult` runs schema validation only when some argument declares
 * `minLength`/`maxLength`/`pattern`, and `REQUIRED_ARGUMENT_MISSING` has no reader) stays open —
 * the IR is a new surface with no back-compat debt, so it can enforce without renegotiating what
 * every existing caller is allowed to omit.
 */
function collectNodeRejections(
  nodes: readonly WorkflowNode[],
  deps: WorkflowValidatorDeps,
  rejections: WorkflowRejection[]
): void {
  for (const node of nodes) {
    collectPromptRejections(node, deps, rejections);
    collectVisibilityRejections(node, rejections);
  }
}

/** Prompt existence and `required`-argument enforcement for one node. */
function collectPromptRejections(
  node: WorkflowNode,
  deps: WorkflowValidatorDeps,
  rejections: WorkflowRejection[]
): void {
  const prompt = deps.lookupPrompt(node.promptId);
  if (prompt === undefined) {
    rejections.push({
      reason: 'unknown-prompt',
      nodeId: node.id,
      detail: `Node "${node.id}" references prompt "${node.promptId}", which is not registered`,
    });
    return;
  }

  const supplied = node.args ?? {};
  for (const required of prompt.requiredArguments) {
    if (!(required in supplied)) {
      rejections.push({
        reason: 'required-argument-missing',
        nodeId: node.id,
        detail: `Node "${node.id}" omits required argument "${required}" of prompt "${node.promptId}"`,
      });
    }
  }
}

/** Visibility vocabulary for one node, checked in both directions. */
function collectVisibilityRejections(node: WorkflowNode, rejections: WorkflowRejection[]): void {
  const allowed = new Set<string>(WORKFLOW_VISIBILITY_ITEMS);

  for (const kind of ['withhold', 'expose'] as const) {
    for (const item of node.visibility?.[kind] ?? []) {
      if (!allowed.has(item)) {
        rejections.push({
          reason: 'unknown-visibility-item',
          nodeId: node.id,
          detail: `Node "${node.id}" declares visibility.${kind} item "${item}"; allowed items are ${WORKFLOW_VISIBILITY_ITEMS.join(', ')}`,
        });
      }
    }
  }
}

/** Edge endpoints must name declared nodes. Cycles are the linearizer's to report. */
function collectEdgeRejections(
  ir: WorkflowIR,
  nodeIds: ReadonlySet<string>,
  rejections: WorkflowRejection[]
): void {
  for (const edge of ir.edges ?? []) {
    for (const [end, id] of [
      ['from', edge.from],
      ['to', edge.to],
    ] as const) {
      if (!nodeIds.has(id)) {
        rejections.push({
          reason: 'edge-endpoint-missing',
          edge,
          detail: `Edge ${edge.from} -> ${edge.to} names "${id}" as its \`${end}\` endpoint, but no node declares that id`,
        });
      }
    }
  }
}

/**
 * Gate bindings must address a declared node.
 *
 * Only `target_step_id` is checked. `target_step_number` addresses a POSITION, and a position is
 * only meaningful after linearization — a submitted IR's node array is a declaration order, not
 * the run order, so validating a number here would validate against the wrong sequence. IR gate
 * bindings therefore address nodes by id, which is the channel
 * `temporary-gate-registrar.ts:378-414` already reconciles.
 */
function collectGateTargetRejections(
  ir: WorkflowIR,
  nodeIds: ReadonlySet<string>,
  rejections: WorkflowRejection[]
): void {
  for (const gate of ir.gates ?? []) {
    // A bare string gate id carries no target — the union's other two members do.
    if (typeof gate !== 'object') continue;
    const target = (gate as { target_step_id?: unknown }).target_step_id;
    if (typeof target !== 'string') continue;
    if (!nodeIds.has(target)) {
      rejections.push({
        reason: 'gate-target-missing',
        nodeId: target,
        detail: `Gate binding targets step id "${target}", but no node declares that id`,
      });
    }
  }

  for (const node of ir.nodes) {
    for (const gateId of node.inlineGateIds ?? []) {
      if (gateId.trim().length === 0) {
        rejections.push({
          reason: 'gate-target-missing',
          nodeId: node.id,
          detail: `Node "${node.id}" declares an empty inline gate id`,
        });
      }
    }
  }
}
