// @lifecycle canonical - Registers temporary gates from normalized specifications.
import { mergeGateBody } from './gate-body-merge.js';
import { formatCriteriaAsGuidance } from '../../execution/pipeline/criteria-guidance.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateBody } from './gate-body-merge.js';
import type { GateReferenceResolver } from './gate-reference-resolver.js';
import type { RunStepViewProvider } from './run-step-view.js';
import type { ExecutionContext } from '../../execution/context/index.js';
import type { TemporaryGateInput } from '../../execution/types.js';
import type {
  TemporaryGateDefinition,
  TemporaryGateRegistry,
} from '../core/temporary-gate-registry.js';

import { nodeIdAt, ordinalOf } from '#shared/utils/node-order.js';

/**
 * Anything that may carry inline gate definitions — structurally a `ConvertedPrompt`, declared
 * narrowly so the registrar depends on the two fields it reads rather than the whole prompt type.
 */
export interface InlineDefinitionCarrier {
  readonly id?: string | undefined;
  readonly gateConfiguration?: { readonly inline_gate_definitions?: unknown } | undefined;
}

/**
 * Result of temporary gate registration.
 */
export interface RegisteredGateResult {
  readonly temporaryGateIds: string[];
  readonly canonicalGateIds: string[];
}

/**
 * Normalized gate input structure for creating temporary gates.
 */
export interface NormalizedGateInput {
  name: string;
  type: 'validation' | 'guidance';
  scope: 'execution' | 'session' | 'chain' | 'step';
  criteria?: string[];
  guidance?: string;
  description?: string;
  pass_criteria?: string[];
  source: 'manual' | 'automatic' | 'analysis';
  context?: Record<string, unknown>;
  target_step_number?: number;
  /** Stable node id of the targeted step; see `resolveStepTarget`. */
  target_step_id?: string;
  apply_to_steps?: number[];
}

/**
 * Raw gate input (flexible structure for parsing).
 * Accepts any object with at least some gate-like properties.
 */
export type RawGateInput =
  | string
  | TemporaryGateInput
  | {
      id?: string;
      name?: string;
      type?: string;
      scope?: string;
      criteria?: string[] | readonly string[];
      guidance?: string;
      description?: string;
      pass_criteria?: string[] | readonly string[];
      source?: string;
      context?: unknown;
      target_step_number?: number;
      target_step_id?: string;
    };

/**
 * Registers temporary gates from raw specifications and resolves canonical references.
 *
 * Handles:
 * - Normalizing heterogeneous gate inputs (strings, objects, TemporaryGateInput)
 * - Resolving canonical gate IDs from references
 * - Deduplication within a single batch
 * - Creating temporary gate definitions in the registry
 */
export class TemporaryGateRegistrar {
  constructor(
    private readonly temporaryGateRegistry: TemporaryGateRegistry | undefined,
    private readonly gateReferenceResolver: GateReferenceResolver | undefined,
    private readonly logger: Logger,
    /**
     * The live run's step identities, when there is a run (P4 row 4.1). Optional because gates
     * are registered at stage 11, before the session stage resolves anything — on the call that
     * STARTS a chain there is no run yet, and the parse-time node order is the run's order.
     */
    private readonly runStepViewProvider?: RunStepViewProvider
  ) {}

  /**
   * Register temporary gates from the unified `gates` parameter on the execution context.
   * Returns IDs of created temporary gates and resolved canonical gates.
   */
  async registerTemporaryGates(context: ExecutionContext): Promise<RegisteredGateResult> {
    this.logger.debug('[TemporaryGateRegistrar] registerTemporaryGates - parsedCommand structure', {
      hasOperators: Boolean(context.parsedCommand?.operators),
      format: context.parsedCommand?.format,
    });

    const overrides = context.state.gates.requestedOverrides as Record<string, any> | undefined;
    const normalizedGates = overrides?.['gates'] as
      import('#shared/types/execution.js').GateSpecification[] | undefined;

    const canonicalGateIds = new Set<string>();
    const resolvedGateIds = new Set<string>();
    const createdIds: string[] = [];

    const tempGateInputs: RawGateInput[] = normalizedGates ?? [];

    const registry = this.temporaryGateRegistry;
    const registryAvailable = registry !== undefined;
    if (!tempGateInputs.length) {
      return { temporaryGateIds: [], canonicalGateIds: [] };
    }

    const scopeId =
      context.getSessionId?.() ||
      context.mcpRequest.chain_id ||
      context.mcpRequest.command ||
      'execution';

    const isChainExecution =
      context.hasChainCommand() ||
      (context.parsedCommand?.steps !== undefined && context.parsedCommand.steps.length > 1);
    const currentStep = context.sessionContext?.currentStep ?? 1;
    // The node order a step target resolves against, LIVE run first (P4 row 4.1 / OQ-P4-3).
    //
    // A gate arriving with an ordinal is resolved to a node id once, here, and matched by that
    // id from then on — so the only thing this list decides is which node the client's ordinal
    // meant AT REGISTRATION. The client's ordinals come from the rendered footer, which counts
    // the RUN's nodes, so a run that has already been mutated must be asked rather than the
    // parse-time array, whose ordinals stopped agreeing the moment a node was inserted.
    //
    // Falls back to the parse-time order, which is the run's order on the call that starts a
    // chain (node ids are minted at parse time and handed straight to the store). Steps that
    // predate minting contribute nothing, which is why an unresolvable id is left alone rather
    // than treated as absent.
    const nodeIds =
      this.resolveRunNodeIds(context) ??
      (context.parsedCommand?.steps ?? [])
        .map((step) => step.nodeId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

    const seenStringInputs = new Set<string>();
    const seenGateSignatures = new Set<string>();

    for (const rawGate of tempGateInputs) {
      try {
        if (typeof rawGate === 'string') {
          const trimmed = rawGate.trim();
          if (!trimmed || seenStringInputs.has(trimmed)) {
            continue;
          }
          seenStringInputs.add(trimmed);

          if (this.gateReferenceResolver) {
            const resolution = await this.gateReferenceResolver.resolve(trimmed);
            if (resolution.referenceType === 'registered') {
              canonicalGateIds.add(resolution.gateId);
              resolvedGateIds.add(resolution.gateId);
              this.logger.debug(
                '[TemporaryGateRegistrar] Resolved string gate to canonical definition',
                { input: trimmed, gateId: resolution.gateId }
              );
              continue;
            }
          }

          this.logger.debug(
            '[TemporaryGateRegistrar] String gate not canonical, treating as criteria',
            { input: trimmed }
          );
        }

        if (typeof rawGate === 'object' && rawGate !== null) {
          const canonicalCandidate = await this.resolveCanonicalGateId(rawGate, resolvedGateIds);
          if (canonicalCandidate) {
            canonicalGateIds.add(canonicalCandidate);
            resolvedGateIds.add(canonicalCandidate);
            this.logger.debug(
              '[TemporaryGateRegistrar] Resolved object gate to canonical definition',
              { gateId: canonicalCandidate }
            );
            continue;
          }
        }

        const { normalized: gate, isValid } = this.normalizeGateInput(
          rawGate,
          isChainExecution,
          currentStep,
          nodeIds
        );

        if (!isValid) {
          this.logger.warn('[TemporaryGateRegistrar] Invalid gate format, skipping', {
            gate: rawGate,
          });
          continue;
        }

        const criteria = gate.criteria ?? gate.pass_criteria ?? [];
        const criteriaArray = Array.isArray(criteria)
          ? criteria.filter((c): c is string => typeof c === 'string')
          : [];

        const signatureParts = [
          gate.type ?? 'validation',
          gate.scope ?? 'execution',
          (gate.name ?? '').toLowerCase(),
          (gate.description ?? '').toLowerCase(),
          (gate.guidance ?? '').toLowerCase(),
          criteriaArray.join('|').toLowerCase(),
          (gate.apply_to_steps ?? []).join(','),
          gate.target_step_number ?? '',
          gate.target_step_id ?? '',
        ];
        const gateSignature = signatureParts.join('||');
        if (seenGateSignatures.has(gateSignature)) {
          this.logger.debug('[TemporaryGateRegistrar] Skipping duplicate temporary gate', {
            signature: gateSignature,
          });
          continue;
        }
        seenGateSignatures.add(gateSignature);

        const effectiveGuidance = this.resolveGateGuidance(gate, criteriaArray);

        if (effectiveGuidance && !gate.guidance) {
          this.logger.debug('[TemporaryGateRegistrar] Resolved guidance from fallback', {
            source: criteriaArray.length > 0 ? 'criteria' : 'description',
            guidanceLength: effectiveGuidance.length,
          });
        }

        if (!effectiveGuidance) {
          this.logger.warn('[TemporaryGateRegistrar] Skipping gate with no usable content', {
            gate,
          });
          continue;
        }

        if (!registryAvailable) {
          continue;
        }

        const gateIdCandidate =
          typeof rawGate === 'object' &&
          rawGate !== null &&
          'id' in rawGate &&
          typeof rawGate.id === 'string'
            ? rawGate.id
            : null;

        if (gateIdCandidate && registry.getTemporaryGate(gateIdCandidate)) {
          this.logger.debug('[TemporaryGateRegistrar] Skipping gate already registered', {
            gateId: gateIdCandidate,
          });
          createdIds.push(gateIdCandidate);
          continue;
        }

        const tempGateDefinition: Omit<TemporaryGateDefinition, 'id' | 'created_at'> & {
          id?: string;
        } = {
          name: gate.name,
          type: gate.type,
          scope: gate.scope,
          description: gate.description ?? effectiveGuidance.substring(0, 100),
          guidance: effectiveGuidance,
          source: gate.source,
        };

        if (gateIdCandidate) {
          tempGateDefinition.id = gateIdCandidate;
        }
        if (criteriaArray.length > 0) {
          tempGateDefinition.pass_criteria = criteriaArray;
        } else if (gate.pass_criteria !== undefined) {
          tempGateDefinition.pass_criteria = gate.pass_criteria;
        }
        if (gate.context !== undefined) {
          tempGateDefinition.context = gate.context;
        }
        if (gate.target_step_number !== undefined) {
          tempGateDefinition.target_step_number = gate.target_step_number;
        }
        if (gate.target_step_id !== undefined) {
          tempGateDefinition.target_step_id = gate.target_step_id;
        }
        if (gate.apply_to_steps !== undefined) {
          tempGateDefinition.apply_to_steps = gate.apply_to_steps;
        }

        const gateId = registry.createTemporaryGate(tempGateDefinition, scopeId);

        createdIds.push(gateId);
        this.trackTemporaryGateScope(context, gate.scope ?? 'execution', scopeId);

        this.logger.debug('[TemporaryGateRegistrar] Registered temporary gate', {
          gateId,
          name: gate.name,
          hasGuidance: !!effectiveGuidance,
          guidanceLength: effectiveGuidance.length,
          criteriaCount: criteriaArray.length,
        });
      } catch (error) {
        this.logger.warn('[TemporaryGateRegistrar] Failed to register temporary gate', {
          gate: rawGate,
          error,
        });
      }
    }

    if (registryAvailable && createdIds.length) {
      const existing = context.state.gates.temporaryGateIds ?? [];
      context.state.gates.temporaryGateIds = [...existing, ...createdIds];

      this.logger.info('[TemporaryGateRegistrar] Successfully registered temporary gates', {
        count: createdIds.length,
        gateIds: createdIds,
      });
    }

    if (canonicalGateIds.size > 0) {
      const overrides = context.state.gates.requestedOverrides;

      const existingGates = (overrides?.['gates'] as any[]) ?? [];
      const existingGateStrings = existingGates.filter((g): g is string => typeof g === 'string');
      const merged = new Set<string>(existingGateStrings);
      canonicalGateIds.forEach((gateId) => merged.add(gateId));

      if (overrides) {
        const nonStringGates = existingGates.filter((g) => typeof g !== 'string');
        overrides['gates'] = [...Array.from(merged), ...nonStringGates];
      }
      context.state.gates.canonicalGateIdsFromTemporary = Array.from(canonicalGateIds);
    }

    return {
      temporaryGateIds: registryAvailable ? createdIds : [],
      canonicalGateIds: Array.from(canonicalGateIds),
    };
  }

  /**
   * The live run's node ids, or undefined when this call has no run to ask about.
   *
   * Reached by chain id rather than session id on purpose: gates register at stage 11, and
   * `context.getSessionId()` is not populated until the session stage (13) resolves the resume
   * target, so the request's own `chain_id` is the only run handle available this early.
   */
  private resolveRunNodeIds(context: ExecutionContext): readonly string[] | undefined {
    if (this.runStepViewProvider === undefined) {
      return undefined;
    }

    const chainId = context.getRequestedChainId();
    if (chainId === undefined) {
      return undefined;
    }

    const view = this.runStepViewProvider(chainId, context.getScopeOptions());
    return view !== undefined && view.nodeIds.length > 0 ? view.nodeIds : undefined;
  }

  /**
   * Bind a gate's step target to BOTH addressing forms at registration time.
   *
   * `target_step_number` and `target_step_id` are two names for one step, and a gate may arrive
   * carrying either. Resolving both here — rather than teaching gate selection a second lookup —
   * keeps selection positional per OQ5 (`gate-enhancement-service` still matches on
   * `target_step_number`) while the identity travels with the definition for P4, when positions
   * become mutable.
   *
   * An unresolvable target is left as given rather than dropped: a gate that names a step the
   * run does not have should select nothing, not silently widen to every step.
   */
  private resolveStepTarget(
    targetStepNumber: number | undefined,
    targetStepId: string | undefined,
    nodeIds: readonly string[]
  ): { targetStepNumber: number | undefined; targetStepId: string | undefined } {
    if (nodeIds.length === 0) {
      return { targetStepNumber, targetStepId };
    }

    if (targetStepId !== undefined) {
      const ordinal = ordinalOf(nodeIds, targetStepId);
      if (ordinal === -1) {
        this.logger.warn('[TemporaryGateRegistrar] target_step_id not found in this run', {
          targetStepId,
          nodeIds,
        });
        return { targetStepNumber, targetStepId };
      }
      // The id wins when both were supplied — it is the more specific address.
      return { targetStepNumber: ordinal, targetStepId };
    }

    if (targetStepNumber !== undefined) {
      const nodeId = nodeIdAt(nodeIds, targetStepNumber);
      return { targetStepNumber, targetStepId: nodeId ?? undefined };
    }

    return { targetStepNumber, targetStepId };
  }

  /**
   * Normalize raw gate input to standard format.
   *
   * `nodeIds` is the run's frozen node order, used only to cross-resolve the two step-target
   * forms. Empty (single prompts, callers with no parsed chain) leaves both fields as given.
   */
  normalizeGateInput(
    gate: RawGateInput,
    isChainExecution: boolean = false,
    currentStep: number = 1,
    nodeIds: readonly string[] = []
  ): { normalized: NormalizedGateInput; isValid: boolean } {
    if (typeof gate === 'string') {
      return {
        normalized: {
          name: 'Inline Validation Criteria',
          type: 'validation',
          scope: 'execution',
          description: 'Inline validation criteria',
          source: 'automatic',
          ...(gate ? { criteria: [gate] } : {}),
          ...(isChainExecution ? { apply_to_steps: [currentStep] } : {}),
        },
        isValid: true,
      };
    }

    const normalizeType = (type: string | undefined): NormalizedGateInput['type'] => {
      const validTypes: NormalizedGateInput['type'][] = ['validation', 'guidance'];
      return validTypes.includes(type as NormalizedGateInput['type'])
        ? (type as NormalizedGateInput['type'])
        : 'validation';
    };

    const normalizeScope = (scope: string | undefined): NormalizedGateInput['scope'] => {
      const validScopes: NormalizedGateInput['scope'][] = ['execution', 'session', 'chain', 'step'];
      return validScopes.includes(scope as NormalizedGateInput['scope'])
        ? (scope as NormalizedGateInput['scope'])
        : 'execution';
    };

    const normalizeSource = (source: string | undefined): NormalizedGateInput['source'] => {
      const validSources: NormalizedGateInput['source'][] = ['manual', 'automatic', 'analysis'];
      return validSources.includes(source as NormalizedGateInput['source'])
        ? (source as NormalizedGateInput['source'])
        : 'automatic';
    };

    const normalizeCriteria = (
      criteria: unknown[] | readonly unknown[] | undefined
    ): string[] | undefined => {
      if (criteria === undefined || !Array.isArray(criteria)) return undefined;
      const stringCriteria = criteria.filter((c): c is string => typeof c === 'string');
      return stringCriteria.length > 0 ? stringCriteria : undefined;
    };

    const normalizeContext = (context: unknown): Record<string, unknown> | undefined => {
      if (context === undefined || context === null) return undefined;
      if (typeof context === 'object') {
        return context as Record<string, unknown>;
      }
      return undefined;
    };

    const extractedCriteria = 'criteria' in gate ? gate.criteria : undefined;
    const extractedPassCriteria = 'pass_criteria' in gate ? gate.pass_criteria : undefined;

    const { targetStepNumber, targetStepId } = this.resolveStepTarget(
      'target_step_number' in gate && typeof gate.target_step_number === 'number'
        ? gate.target_step_number
        : undefined,
      'target_step_id' in gate && typeof gate.target_step_id === 'string'
        ? gate.target_step_id
        : undefined,
      nodeIds
    );
    const applyToSteps =
      'apply_to_steps' in gate && Array.isArray(gate.apply_to_steps)
        ? gate.apply_to_steps.filter((n): n is number => typeof n === 'number')
        : undefined;

    const effectiveApplyToSteps =
      applyToSteps && applyToSteps.length > 0
        ? applyToSteps
        : targetStepNumber === undefined && isChainExecution
          ? [currentStep]
          : undefined;

    const normalized: NormalizedGateInput = {
      name: gate.name ?? gate.id ?? 'Inline Quality Criteria',
      type: normalizeType(gate.type),
      scope: normalizeScope(gate.scope),
      description: gate.description ?? 'Temporary gate criteria',
      source: normalizeSource(gate.source),
    };

    const criteria = normalizeCriteria(extractedCriteria);
    if (criteria !== undefined) {
      normalized.criteria = criteria;
    }

    if (gate.guidance !== undefined) {
      normalized.guidance = gate.guidance;
    }

    const passCriteria = normalizeCriteria(extractedPassCriteria ?? extractedCriteria);
    if (passCriteria !== undefined) {
      normalized.pass_criteria = passCriteria;
    }

    const contextValue = normalizeContext(gate.context);
    if (contextValue !== undefined) {
      normalized.context = contextValue;
    }

    if (targetStepNumber !== undefined) {
      normalized.target_step_number = targetStepNumber;
    }

    if (targetStepId !== undefined) {
      normalized.target_step_id = targetStepId;
    }

    if (effectiveApplyToSteps !== undefined) {
      normalized.apply_to_steps = effectiveApplyToSteps;
    }

    return { normalized, isValid: true };
  }

  /**
   * Resolve effective guidance using fallback chain.
   * Priority: explicit guidance > criteria-derived > description.
   */
  resolveGateGuidance(gate: NormalizedGateInput, criteria: string[]): string {
    if (gate.guidance) {
      return gate.guidance;
    }
    if (criteria.length > 0) {
      return formatCriteriaAsGuidance(criteria);
    }
    if (gate.description) {
      return gate.description;
    }
    return '';
  }

  /**
   * Register a prompt's `inline_gate_definitions` and return their canonical ids.
   *
   * Reuses the `TemporaryGateRegistry` seam rather than adding a second registration path into
   * gate selection (ADR 0001 (b), finding F5). The returned ids are contributed to resolution at
   * rank 60 `prompt-config` — the prompt author's tier — not rank 80, which belongs to the caller
   * who invoked the prompt.
   *
   * When a definition declares an id that is already registered, the body is resolved per ADR
   * 0001 (b) via `mergeGateBody`: the inline definition's declared fields replace, its omitted
   * fields inherit, and arrays and objects replace wholesale rather than appending or merging.
   * The id stays a single entry either way.
   *
   * Failures are contained per definition: one malformed or unregisterable definition is warned
   * about and skipped, leaving the rest of the prompt's gates intact. A registration failure must
   * not take a prompt out of service.
   */
  registerInlineGateDefinitions(
    context: ExecutionContext,
    prompts: ReadonlyArray<InlineDefinitionCarrier | undefined>,
    /**
     * Whether inline definitions execute this release. The check lives here rather than at the
     * call site so the calling stage stays branch-free — see ADR 0001 (d) and
     * `GatesConfig.executeInlineGateDefinitions`.
     */
    enabled: boolean
  ): string[] {
    if (!enabled) {
      return [];
    }

    const registeredIds: string[] = [];

    for (const prompt of prompts) {
      registeredIds.push(...this.registerPromptInlineDefinitions(context, prompt));
    }

    if (registeredIds.length > 0) {
      const existing = context.state.gates.temporaryGateIds ?? [];
      context.state.gates.temporaryGateIds = [...existing, ...registeredIds];

      this.logger.info('[TemporaryGateRegistrar] Registered inline gate definitions', {
        gateIds: registeredIds,
      });
    }

    return registeredIds;
  }

  /** Register one prompt's definitions. Returns the canonical ids that were created. */
  private registerPromptInlineDefinitions(
    context: ExecutionContext,
    prompt: InlineDefinitionCarrier | undefined
  ): string[] {
    const definitions = prompt?.gateConfiguration?.inline_gate_definitions;
    const registry = this.temporaryGateRegistry;

    if (!Array.isArray(definitions) || definitions.length === 0) {
      return [];
    }
    if (registry === undefined) {
      this.logger.warn(
        '[TemporaryGateRegistrar] Inline gate definitions present but no registry available',
        { promptId: prompt?.id, count: definitions.length }
      );
      return [];
    }

    const registeredIds: string[] = [];
    for (const definition of definitions as GateBody[]) {
      const gateId = this.registerOneInlineDefinition(context, registry, definition, prompt?.id);
      if (gateId !== undefined) {
        registeredIds.push(gateId);
      }
    }

    return registeredIds;
  }

  /** Register one inline definition, merging over any existing body. Returns its canonical id. */
  private registerOneInlineDefinition(
    context: ExecutionContext,
    registry: TemporaryGateRegistry,
    definition: GateBody,
    promptId: string | undefined
  ): string | undefined {
    const name = typeof definition['name'] === 'string' ? definition['name'] : undefined;
    if (name === undefined) {
      // The loader already warns and drops these; reaching here means a caller bypassed it.
      this.logger.warn('[TemporaryGateRegistrar] Skipping inline definition with no name', {
        promptId,
      });
      return undefined;
    }

    const declaredId = typeof definition['id'] === 'string' ? definition['id'] : undefined;
    const scope = readInlineScope(definition);

    try {
      const existing = declaredId === undefined ? undefined : registry.getTemporaryGate(declaredId);
      const body =
        existing === undefined
          ? definition
          : mergeGateBody(existing as unknown as GateBody, definition);

      const gateId = registry.createTemporaryGate(
        buildInlineTemporaryGate(body, name, scope, declaredId),
        inlineScopeId(context, scope)
      );

      this.trackTemporaryGateScope(context, scope, inlineScopeId(context, scope));
      return gateId;
    } catch (error) {
      this.logger.warn('[TemporaryGateRegistrar] Failed to register inline gate definition', {
        promptId,
        gate: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private trackTemporaryGateScope(
    context: ExecutionContext,
    scope: string,
    scopeId?: string
  ): void {
    if (!scopeId) {
      return;
    }

    const normalizedScope: 'execution' | 'session' | 'chain' | 'step' =
      scope === 'session' || scope === 'chain' || scope === 'step' ? scope : 'execution';

    const scopes = context.state.gates.temporaryGateScopes ?? [];

    if (!context.state.gates.temporaryGateScopes) {
      context.state.gates.temporaryGateScopes = scopes;
    }

    const exists = scopes.some(
      (entry) => entry.scope === normalizedScope && entry.scopeId === scopeId
    );
    if (!exists) {
      scopes.push({ scope: normalizedScope, scopeId });
    }
  }

  private async resolveCanonicalGateId(
    gate: RawGateInput,
    requestedQualityGates: Set<string>
  ): Promise<string | undefined> {
    const candidate = this.extractGateReferenceCandidate(gate);
    if (!candidate || requestedQualityGates.has(candidate)) {
      return undefined;
    }

    if (typeof gate === 'object' && gate !== null && this.gateInputContainsInlineContent(gate)) {
      return undefined;
    }

    if (!this.gateReferenceResolver) {
      return undefined;
    }

    const resolution = await this.gateReferenceResolver.resolve(candidate);
    if (
      resolution.referenceType === 'registered' &&
      !requestedQualityGates.has(resolution.gateId)
    ) {
      return resolution.gateId;
    }
    return undefined;
  }

  private extractGateReferenceCandidate(gate: RawGateInput): string | undefined {
    if (typeof gate === 'string') {
      const trimmed = gate.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    if (gate && typeof gate === 'object') {
      const id = 'id' in gate && typeof gate.id === 'string' ? gate.id : undefined;
      const trimmed = id?.trim();
      return trimmed && trimmed.length > 0 ? trimmed : undefined;
    }

    return undefined;
  }

  private gateInputContainsInlineContent(gate: Record<string, unknown>): boolean {
    const hasCriteria = Array.isArray(gate['criteria']) && gate['criteria'].length > 0;
    const hasPassCriteria =
      Array.isArray(gate['pass_criteria']) && gate['pass_criteria'].length > 0;
    const hasGuidance = typeof gate['guidance'] === 'string' && gate['guidance'].trim().length > 0;
    const hasDescription =
      typeof gate['description'] === 'string' && gate['description'].trim().length > 0;
    return hasCriteria || hasPassCriteria || hasGuidance || hasDescription;
  }
}

// ============================================================================
// Pure helpers for inline gate definitions
// ============================================================================

const INLINE_SCOPES = ['execution', 'session', 'chain', 'step'] as const;
type InlineScope = (typeof INLINE_SCOPES)[number];

/** The definition's declared scope, defaulting to `execution` per ADR 0001 (b). */
function readInlineScope(definition: GateBody): InlineScope {
  const scope = definition['scope'];
  return (INLINE_SCOPES as readonly string[]).includes(scope as string)
    ? (scope as InlineScope)
    : 'execution';
}

/**
 * Scope id for an inline definition.
 *
 * A `chain`-scoped definition binds to the chain so it survives across steps; everything else
 * binds to the session or the command, matching what `registerTemporaryGates` already does for
 * caller-supplied specs.
 */
function inlineScopeId(context: ExecutionContext, scope: InlineScope): string {
  // `getSessionId` is a plain method on ExecutionContext, so no optional call — the older
  // `getSessionId?.()` spelling elsewhere in this file predates the rule that flags it.
  if (scope === 'chain') {
    return context.mcpRequest.chain_id ?? context.getSessionId() ?? 'execution';
  }
  return context.getSessionId() ?? context.mcpRequest.chain_id ?? 'execution';
}

/**
 * Shape a merged body into the registry's creation input.
 *
 * `description` falls back to a guidance excerpt rather than being left empty, mirroring
 * `registerTemporaryGates`, so a gate always has something to display.
 */
function buildInlineTemporaryGate(
  body: GateBody,
  name: string,
  scope: InlineScope,
  declaredId: string | undefined
): Omit<TemporaryGateDefinition, 'id' | 'created_at'> & { id?: string } {
  const guidance = typeof body['guidance'] === 'string' ? body['guidance'] : '';
  const description =
    typeof body['description'] === 'string' && body['description'].length > 0
      ? body['description']
      : guidance.substring(0, 100);

  const definition: Omit<TemporaryGateDefinition, 'id' | 'created_at'> & { id?: string } = {
    name,
    type: body['type'] === 'guidance' ? 'guidance' : 'validation',
    scope,
    description,
    guidance,
    // Inline definitions are authored by hand in a prompt file, so the provenance is 'manual'
    // unless the definition says otherwise.
    source: readInlineGateSource(body),
  };

  if (declaredId !== undefined) {
    definition.id = declaredId;
  }

  return applyOptionalInlineFields(definition, body);
}

/**
 * Copy the optional fields a definition may carry.
 *
 * Separated from `buildInlineTemporaryGate` so neither exceeds the cyclomatic limit; each optional
 * field is one more branch, and the two together measured 11.
 */
function applyOptionalInlineFields(
  definition: Omit<TemporaryGateDefinition, 'id' | 'created_at'> & { id?: string },
  body: GateBody
): Omit<TemporaryGateDefinition, 'id' | 'created_at'> & { id?: string } {
  if (Array.isArray(body['pass_criteria'])) {
    definition.pass_criteria = body['pass_criteria'];
  }
  if (isRecord(body['context'])) {
    definition.context = body['context'];
  }
  if (typeof body['expires_at'] === 'number') {
    definition.expires_at = body['expires_at'];
  }
  if (Array.isArray(body['apply_to_steps'])) {
    definition.apply_to_steps = body['apply_to_steps'] as number[];
  }
  if (typeof body['target_step_number'] === 'number') {
    definition.target_step_number = body['target_step_number'];
  }
  if (typeof body['target_step_id'] === 'string') {
    definition.target_step_id = body['target_step_id'];
  }

  return definition;
}

/** Provenance of an inline definition, defaulting to `manual`. */
function readInlineGateSource(body: GateBody): TemporaryGateDefinition['source'] {
  const source = body['source'];
  return source === 'automatic' || source === 'analysis' || source === 'manual' ? source : 'manual';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
