// @lifecycle canonical - Single owner for gate-set resolution (ADR 0001).

import { GATE_SOURCE_PRIORITY } from '../../execution/pipeline/state/types.js';

import type { Logger } from '../../../infra/logging/index.js';
import type { GateSource } from '../../execution/pipeline/state/types.js';
import type { GateConfigurationInfo } from '../../execution/planning/category-extractor.js';
import type { ConvertedPrompt, ExecutionModifiers } from '../../execution/types.js';
import type { GateDefinitionProvider } from '../core/gate-loader.js';
import type { GateManager } from '../gate-manager.js';

/**
 * Inputs to one gate-set resolution. Stateless: every field arrives per request.
 *
 * `frameworkId` and `frameworkInjected` are INPUTS, deliberately. This module lives in
 * `engine/gates`, and `no-frameworks-in-gates` (dependency-cruiser, error severity) forbids
 * reaching into `engine/frameworks` to compute them. The caller resolves them and passes them
 * down — the same shape `GateEnhancementService` already uses when it reads the framework id
 * off the execution context instead of off `FrameworkManager`.
 */
export interface GateResolutionInput {
  readonly prompt: ConvertedPrompt;
  readonly category: string;
  /** Category-level gate config, from `CategoryExtractor.extractCategory()`. */
  readonly categoryGateConfig?: GateConfigurationInfo | undefined;
  readonly modifiers?: ExecutionModifiers | undefined;
  /** Active framework id, or undefined when none is active. Never derived here. */
  readonly frameworkId?: string | undefined;
  /**
   * Whether a methodology system prompt is actually injected for this execution, resolved by
   * the injection hierarchy. Drives the nesting veto: scoring adherence to a methodology that
   * was not injected is incoherent, so those gates are withheld.
   */
  readonly frameworkInjected: boolean;
  /** Rank 100 — `::` operator typed in the command. */
  readonly inlineOperatorGateIds?: readonly string[] | undefined;
  /** Rank 90 — gate chosen during a judge phase. */
  readonly clientSelectedGateIds?: readonly string[] | undefined;
  /** Rank 80 — caller-supplied spec via the MCP `gates` parameter. */
  readonly callerGateIds?: readonly string[] | undefined;
  /**
   * Rank 60 — gate ids the planner already resolved into the execution plan. Unioned with the
   * ids derived from the prompt itself; resolution is idempotent, so re-deriving and re-vetoing
   * an already-resolved plan yields the same set.
   */
  readonly plannedGateIds?: readonly string[] | undefined;
  /**
   * Rank 60 — canonical ids for the prompt's `inline_gate_definitions`, after registration.
   *
   * Registration is a side effect over `TemporaryGateRegistry`, so it happens before resolution
   * and the ids arrive here as data — this resolver stays stateless. Rank 60 is the prompt
   * author's tier, deliberately not 80: an inline definition must not outrank a gate the caller
   * invoking the prompt asked for.
   */
  readonly inlineDefinitionGateIds?: readonly string[] | undefined;
  /** Rank 50 — a chain's `finalValidation`. */
  readonly chainGateIds?: readonly string[] | undefined;
  /** Rank 40 — the active framework's methodology gates. */
  readonly methodologyGateIds?: readonly string[] | undefined;
  /** Whether to auto-assign category gates (rank 20). Defaults to true. */
  readonly autoAssignCategoryGates?: boolean | undefined;
  /**
   * Operator-level switch (`gatesConfig.enableMethodologyGates`). `false` withholds methodology
   * gates server-wide and binds every rank — it is operator configuration, not a preference.
   * Defaults to enabled.
   */
  readonly frameworkGatesEnabled?: boolean | undefined;
  /**
   * Methodology gate ids the caller has already loaded. Supplying them avoids a second registry
   * read; omitting them makes the resolver load its own.
   */
  readonly knownMethodologyGateIds?: readonly string[] | undefined;
}

/** One accepted gate and the source it is attributed to. */
export interface ResolvedGate {
  readonly id: string;
  readonly source: GateSource;
  readonly rank: number;
}

export interface GateResolutionResult {
  /** Accepted gate ids, in the order their source tier contributed them. */
  readonly gateIds: readonly string[];
  /** Provenance per accepted gate — replayed into `GateAccumulator` by the caller. */
  readonly accepted: readonly ResolvedGate[];
  /** Removed gate id → name of the veto that removed it. Diagnostics only. */
  readonly vetoed: ReadonlyMap<string, string>;
}

/**
 * A Stage 2 veto. Removes gates and nothing else, which is what makes the veto set
 * order-independent: `applyVetoes` asks whether ANY veto rejects a gate, and existential
 * quantification over a set does not depend on iteration order.
 *
 * `bindsUpToRank` is the highest source rank this veto may remove. A veto whose scope went
 * unstated would default to removing everything, which is how a prompt author would silently
 * overrule the person invoking the prompt.
 */
interface GateVeto {
  readonly name: string;
  readonly bindsUpToRank: number;
  readonly rejects: (gateId: string) => boolean;
}

const RANK = GATE_SOURCE_PRIORITY;

/**
 * Resolves the gate set for one execution, per ADR 0001.
 *
 * Two stages. Stage 1 unions ranked ID sources; rank decides only which source a duplicate id
 * is attributed to, never whether it survives. Stage 2 applies an order-independent set of
 * vetoes, each declaring the highest rank it binds.
 *
 * This class exists because the contract it implements was previously encoded in three places
 * that disagreed, two of which were unreachable: a provenance table in the pipeline
 * accumulator, a pair of zero-caller methods on `CategoryExtractor`, and a filter in
 * `ExecutionPlanner` reading a field with no writer. Consolidating them is the point — adding
 * a fourth encoding was the alternative.
 */
export class GateSetResolver {
  private readonly logger: Logger;
  private readonly gateManager: GateManager | undefined;
  private readonly gateLoader: GateDefinitionProvider | undefined;

  constructor(
    logger: Logger,
    gateManager?: GateManager | undefined,
    gateLoader?: GateDefinitionProvider | undefined
  ) {
    this.logger = logger;
    this.gateManager = gateManager;
    this.gateLoader = gateLoader;
  }

  /**
   * Resolve the gate set. Stage 1 (additive union) then Stage 2 (veto set).
   */
  async resolve(input: GateResolutionInput): Promise<GateResolutionResult> {
    const accumulated = this.accumulate(input);
    const vetoes = await this.buildVetoes(input);
    return this.applyVetoes(accumulated, vetoes);
  }

  // ==========================================================================
  // Stage 1 — additive union (pure apart from the category-gate query)
  // ==========================================================================

  private accumulate(input: GateResolutionInput): Map<string, ResolvedGate> {
    const accumulated = new Map<string, ResolvedGate>();

    this.addAll(accumulated, input.inlineOperatorGateIds, 'inline-operator');
    this.addAll(accumulated, input.clientSelectedGateIds, 'client-selection');
    this.addAll(accumulated, input.callerGateIds, 'temporary-request');
    this.addAll(
      accumulated,
      [
        ...collectPromptConfigGateIds(input),
        ...(input.plannedGateIds ?? []),
        ...(input.inlineDefinitionGateIds ?? []),
      ],
      'prompt-config'
    );
    this.addAll(accumulated, input.chainGateIds, 'chain-level');
    this.addAll(accumulated, input.methodologyGateIds, 'framework-guide');

    if (input.autoAssignCategoryGates !== false) {
      this.addAll(accumulated, this.registryGateIds(input), 'registry-auto');
    }

    return accumulated;
  }

  /**
   * Add ids from one source. On a duplicate, the higher-ranked source takes over the
   * attribution and the lower-ranked one is dropped; equal ranks keep the first arrival.
   * The gate itself is never removed here — Stage 2 owns removal.
   */
  private addAll(
    accumulated: Map<string, ResolvedGate>,
    gateIds: readonly string[] | undefined,
    source: GateSource
  ): void {
    if (!Array.isArray(gateIds)) {
      return;
    }

    const rank = RANK[source];
    for (const rawId of gateIds) {
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (id.length === 0) {
        continue;
      }

      const existing = accumulated.get(id);
      if (existing !== undefined && rank <= existing.rank) {
        continue;
      }
      accumulated.set(id, { id, source, rank });
    }
  }

  /**
   * Gates the registry activates for this context, at rank 20.
   *
   * `selectGates` is the registry's own activation query and the single definition of
   * `registry-auto` (ADR 0001). Framework-awareness comes from the context passed in, not from
   * choosing a different query: a framework gate declaring `framework_context` rules does not
   * activate when `framework` is absent, so a caller with no framework id gets category gates
   * only without having to ask for a narrower query.
   */
  private registryGateIds(input: GateResolutionInput): string[] {
    if (this.gateManager === undefined) {
      this.logger.debug('[GateSetResolver] No GateManager; skipping registry auto-assignment');
      return [];
    }

    const promptCategory = input.category.length > 0 ? input.category.toLowerCase() : 'general';
    const selectionContext: { enabledOnly: boolean; promptCategory: string; framework?: string } = {
      enabledOnly: true,
      promptCategory,
    };
    if (input.frameworkId !== undefined && input.frameworkId.length > 0) {
      selectionContext.framework = input.frameworkId;
    }

    try {
      const result = this.gateManager.selectGates(selectionContext);
      this.logger.debug('[GateSetResolver] Registry gate selection', {
        category: promptCategory,
        framework: selectionContext.framework,
        selectedCount: result.selectedIds.length,
        skippedCount: result.skippedIds.length,
      });
      return [...result.selectedIds];
    } catch (error) {
      // Degrade to no registry gates rather than failing the whole resolution — a registry read
      // is the one part of Stage 1 that can throw, and the other tiers remain valid without it.
      this.logger.warn('[GateSetResolver] Registry selection failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // ==========================================================================
  // Stage 2 — veto set (unordered)
  // ==========================================================================

  private async buildVetoes(input: GateResolutionInput): Promise<GateVeto[]> {
    const vetoes: GateVeto[] = [];

    const modifierVeto = buildModifierVeto(input.modifiers);
    if (modifierVeto !== undefined) {
      vetoes.push(modifierVeto);
    }

    const excluded = collectExcludedIds(input);
    if (excluded.size > 0) {
      vetoes.push({
        name: 'exclude',
        // Author preference, not a safety constraint: it may not remove a gate the caller
        // supplied at rank 80/90/100.
        bindsUpToRank: RANK['prompt-config'],
        rejects: (gateId) => excluded.has(gateId),
      });
    }

    vetoes.push(...(await this.buildMethodologyVetoes(input)));

    return vetoes;
  }

  /**
   * The three vetoes that key off the methodology gate set. They share one id set, so it is
   * resolved once and only when at least one of them applies.
   *
   * Their binding ranks differ on purpose: nesting is a coherence invariant and the config
   * switch is operator intent, so both bind every rank; `framework_gates: false` is an author
   * preference and stops at rank 60, like `exclude`.
   */
  private async buildMethodologyVetoes(input: GateResolutionInput): Promise<GateVeto[]> {
    const applicable: Array<{ name: string; bindsUpToRank: number }> = [];

    if (!input.frameworkInjected) {
      applicable.push({ name: 'methodology-nesting', bindsUpToRank: RANK['inline-operator'] });
    }
    if (input.frameworkGatesEnabled === false) {
      applicable.push({
        name: 'methodology-gates-disabled',
        bindsUpToRank: RANK['inline-operator'],
      });
    }
    if (input.prompt.gateConfiguration?.framework_gates === false) {
      applicable.push({ name: 'framework-gates-opt-out', bindsUpToRank: RANK['prompt-config'] });
    }

    if (applicable.length === 0) {
      return [];
    }

    const methodologyGateIds = await this.resolveMethodologyGateIds(input);
    if (methodologyGateIds.size === 0) {
      return [];
    }

    const rejects = (gateId: string): boolean => methodologyGateIds.has(gateId);
    return applicable.map((veto) => ({ ...veto, rejects }));
  }

  /** Caller-supplied ids win over a registry read; the registry is the fallback. */
  private async resolveMethodologyGateIds(input: GateResolutionInput): Promise<Set<string>> {
    if (input.knownMethodologyGateIds !== undefined) {
      return new Set(input.knownMethodologyGateIds);
    }

    if (this.gateLoader === undefined) {
      this.logger.debug('[GateSetResolver] No GateLoader; methodology gates cannot be identified');
      return new Set();
    }

    try {
      return new Set(await this.gateLoader.getMethodologyGateIds());
    } catch (error) {
      this.logger.warn('[GateSetResolver] Failed to load methodology gate ids', { error });
      return new Set();
    }
  }

  /**
   * Apply the veto set. A gate survives when no veto both binds its rank and rejects it —
   * an existential test over an unordered set, so the outcome is permutation-invariant.
   */
  private applyVetoes(
    accumulated: Map<string, ResolvedGate>,
    vetoes: readonly GateVeto[]
  ): GateResolutionResult {
    const accepted: ResolvedGate[] = [];
    const vetoed = new Map<string, string>();

    for (const gate of accumulated.values()) {
      const blocking = vetoes.find(
        (veto) => veto.bindsUpToRank >= gate.rank && veto.rejects(gate.id)
      );
      if (blocking === undefined) {
        accepted.push(gate);
      } else {
        vetoed.set(gate.id, blocking.name);
      }
    }

    return {
      gateIds: accepted.map((gate) => gate.id),
      accepted,
      vetoed,
    };
  }
}

// ============================================================================
// Pure helpers
// ============================================================================

/**
 * `%clean` and `%framework` drop every gate; `%lean` and `%judge` drop none. `%lean` keeping
 * its gates is the documented, intended behavior — what it must NOT keep is a gate that scores
 * methodology adherence, and the nesting veto handles that separately.
 */
function buildModifierVeto(modifiers: ExecutionModifiers | undefined): GateVeto | undefined {
  if (modifiers?.clean !== true && modifiers?.framework !== true) {
    return undefined;
  }

  return {
    name: modifiers.clean === true ? 'modifier-clean' : 'modifier-framework',
    bindsUpToRank: RANK['inline-operator'],
    rejects: () => true,
  };
}

/**
 * Gate ids the prompt author configured, at rank 60. Preserves the four contributors the
 * planner previously merged: declared gate definitions, pre-assigned gates, prompt-level
 * `include`, and category-level `include`.
 *
 * Split across three functions rather than one: as a single method it measured cyclomatic 12
 * against a limit of 10, and the lint ratchet did not catch it — deleting nine methods
 * elsewhere in this tier lowered the project-wide count enough to mask one new violation.
 */
function collectPromptConfigGateIds(input: GateResolutionInput): string[] {
  return [
    ...declaredGateIds(input.prompt),
    ...autoAssignedGateIds(input.prompt),
    ...(input.prompt.gateConfiguration?.include ?? []),
    ...(input.categoryGateConfig?.include ?? []),
  ];
}

/** Ids from `prompt.gates` definitions, falling back from `id` to `name`. */
function declaredGateIds(prompt: ConvertedPrompt): string[] {
  const ids: string[] = [];
  for (const gate of prompt.gates ?? []) {
    const id = gate.id ?? gate.name;
    if (id !== undefined) {
      ids.push(id);
    }
  }
  return ids;
}

/** Ids from gates pre-assigned by upstream analysis. */
function autoAssignedGateIds(prompt: ConvertedPrompt): string[] {
  const ids: string[] = [];
  for (const gate of readAutoAssignedGates(prompt)) {
    if (gate.id !== undefined) {
      ids.push(gate.id);
    }
  }
  return ids;
}

/** Prompt-level excludes, then category-level. */
function collectExcludedIds(input: GateResolutionInput): Set<string> {
  const excluded = new Set<string>();
  for (const id of input.prompt.gateConfiguration?.exclude ?? []) {
    excluded.add(id);
  }
  for (const id of input.categoryGateConfig?.exclude ?? []) {
    excluded.add(id);
  }
  return excluded;
}

/**
 * `autoAssignedGates` is attached to prompts by upstream analysis but is not part of the
 * `ConvertedPrompt` contract. Read through a narrow local shape rather than `any`.
 */
function readAutoAssignedGates(prompt: ConvertedPrompt): ReadonlyArray<{ id?: string }> {
  const candidate = (prompt as { autoAssignedGates?: unknown }).autoAssignedGates;
  return Array.isArray(candidate) ? (candidate as ReadonlyArray<{ id?: string }>) : [];
}
