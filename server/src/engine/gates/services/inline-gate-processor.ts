// @lifecycle canonical - Processes inline gate criteria from :: operator syntax.
import { namedGateBindingKey } from '../../execution/parsers/symbolic-operator-parser.js';
import { formatCriteriaAsGuidance } from '../../execution/pipeline/criteria-guidance.js';
import { loadShellPresets } from '../config/index.js';
import { SHELL_VERIFY_DEFAULTS } from '../constants.js';
import { gateInputContainsInlineContent } from './temporary-gate-registrar.js';

import type { Logger } from '#infra/logging/index.js';
import type { ChainSessionService } from '#shared/types/chain-session.js';
import type { GateScope } from '#shared/types/execution.js';
import type { GateReferenceResolver, GateReferenceResolution } from './gate-reference-resolver.js';
import type { ExecutionContext, ParsedCommand } from '../../execution/context/index.js';
import type { ChainStepPrompt } from '../../execution/operators/types.js';
import type { TemporaryGateRegistry } from '../core/temporary-gate-registry.js';
import type { PendingShellVerification, ShellVerifyGate } from '../shell/index.js';

/**
 * Scope information for inline gate creation.
 */
interface InlineGateScope {
  readonly promptId?: string;
  readonly stepNumber?: number;
}

/** A binding key -> the id this run's gate declared under it registered as, if any (R49). */
type DeclaredGateView = (key: string) => string | undefined;

/**
 * Register one of a restored run's gates under the id its blueprint recorded (R54); returns the id
 * it registered. A held id registers nothing, unless `onHeld` is `'fresh-id'`: then it registers
 * under the first free `<id>-N` (R60).
 */
type RestoreGate = (
  id: string,
  criteria: readonly string[],
  identity: { name: string; description: string; declared_key?: string },
  stepNumber?: number,
  onHeld?: 'skip' | 'fresh-id'
) => string | undefined;

/**
 * Internal result of processing gate criteria.
 */
interface GateProcessingResult {
  readonly registeredGateIds: string[];
  readonly temporaryGateId?: string;
}

/**
 * Result of processing all inline gates for a request.
 */
export interface InlineGateProcessingResult {
  /** IDs of newly created temporary gates */
  readonly createdIds: string[];
  /** IDs of existing registered gates that were referenced */
  readonly registeredIds: string[];
  /** Count of named inline gates processed */
  readonly namedCount: number;
}

/**
 * What `applyGateResult` writes onto: the parsed command itself, or one of its chain steps.
 *
 * Named as a union of the two real types rather than the structural shape
 * `{ inlineGateIds?: string[] }`. Both spellings typecheck, but the structural one makes the
 * assignment below resolve to its own declaration instead of to `ChainStepPrompt.inlineGateIds`
 * and `ParsedCommand.inlineGateIds` -- so a type-aware reference search finds no writer for
 * either, and `validate:state-field-writers` reported a live field as unwritten. Keeping the
 * concrete types keeps the write traceable from the declaration.
 */
type InlineGateTarget = ChainStepPrompt | ParsedCommand;

/**
 * Type guard for validating gate criteria.
 */
export function isValidGateCriteria(criteria: unknown): criteria is readonly string[] {
  return (
    Array.isArray(criteria) &&
    criteria.length > 0 &&
    criteria.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

/**
 * Type guard for validating step has inline gate criteria.
 */
export function hasInlineGateCriteria(step: ChainStepPrompt): step is ChainStepPrompt & {
  inlineGateCriteria: readonly string[];
} {
  return isValidGateCriteria(step.inlineGateCriteria);
}

/**
 * Processes inline gate criteria from symbolic command syntax.
 *
 * Creates temporary gates for anonymous criteria (`:: "criteria"`),
 * registers named gates (`:: security:"criteria"`),
 * and sets up shell verification for `:: verify:"command"` syntax.
 *
 * Extracted from InlineGateExtractionStage.
 */
export class InlineGateProcessor {
  constructor(
    private readonly temporaryGateRegistry: TemporaryGateRegistry,
    private readonly gateReferenceResolver: GateReferenceResolver,
    private readonly logger: Logger,
    private readonly runGateStore: Pick<ChainSessionService, 'remapRunGates'>,
    private readonly currentRunGateRemap?: (runId: string) => Readonly<Record<string, string>>
  ) {}

  /** Inline declarations registered after restore share the same manager-owned remap boundary. */
  async remapRegisteredGateIds(
    context: ExecutionContext,
    registered: ReadonlyMap<string, string>
  ): Promise<void> {
    const runId = context.getSessionId();
    if (runId === undefined || registered.size === 0) return;
    if (this.currentRunGateRemap === undefined)
      throw new Error('Restored inline gates require the current run gate remap');
    const composed = new Map(Object.entries(this.currentRunGateRemap(runId)));
    for (const [declared, physical] of registered) composed.set(declared, physical);
    await this.runGateStore.remapRunGates(runId, composed);
  }

  /**
   * Process all inline gate criteria from a parsed command.
   *
   * Handles named inline gates, anonymous criteria on the main command,
   * and per-step criteria on chain steps. Updates `parsedCommand.inlineGateIds`
   * and step-level `inlineGateIds` as a side effect.
   */
  async processInlineGates(
    context: ExecutionContext,
    parsedCommand: ParsedCommand
  ): Promise<InlineGateProcessingResult> {
    const createdIds: string[] = [];
    const registeredIds: string[] = [];
    // Binding key -> the id THIS run's gate registered under, read from the run's declared-id map
    // (R49) as this call sees it: a step names a folded named gate by its declared name, and another
    // live run may hold that name in the registry (R43); a name declared again in the same command
    // is keyed by its occurrence (P6.110). Stage 05 runs only on a call that parses a command,
    // which on the MCP surface starts a run, so the view is this call's own registrations.
    const runId = context.getSessionId();
    const declaredNamedGates: DeclaredGateView = (key) =>
      this.temporaryGateRegistry.resolveDeclared(key, runId, createdIds);
    const occurrences = new Map<string, number>();

    // Process named inline gates (e.g., `:: security:"no secrets"`)
    if (
      Array.isArray(parsedCommand.namedInlineGates) &&
      parsedCommand.namedInlineGates.length > 0
    ) {
      this.logger.debug('[InlineGateProcessor] Processing namedInlineGates:', {
        count: parsedCommand.namedInlineGates.length,
        gates: parsedCommand.namedInlineGates.map((g) => ({
          gateId: g.gateId,
          hasShellVerify: Boolean(g.shellVerify),
          shellVerifyCommand: g.shellVerify?.command,
          criteriaCount: g.criteria?.length,
          criteria: g.criteria,
        })),
      });

      for (const namedGate of parsedCommand.namedInlineGates) {
        this.logger.debug('[InlineGateProcessor] Processing gate:', {
          gateId: namedGate.gateId,
          shellVerifyExists: 'shellVerify' in namedGate,
          shellVerifyValue: namedGate.shellVerify,
          shellVerifyTruthy: Boolean(namedGate.shellVerify),
          willTriggerShellPath: Boolean(namedGate.shellVerify && namedGate.gateId),
        });

        // Handle shell verification gates (:: verify:"command")
        if (namedGate.shellVerify && namedGate.gateId) {
          this.logger.info('[InlineGateProcessor] Shell verify gate detected', {
            gateId: namedGate.gateId,
            command: namedGate.shellVerify.command,
            timeout: namedGate.shellVerify.timeout,
          });
          this.setupShellVerification(context, namedGate.gateId, namedGate.shellVerify);
          continue;
        }

        const occurrence = (occurrences.get(namedGate.gateId) ?? 0) + 1;
        occurrences.set(namedGate.gateId, occurrence);
        if (namedGate.gateId && isValidGateCriteria(namedGate.criteria)) {
          const bindingKey = namedGateBindingKey(namedGate.gateId, occurrence);
          const gateId =
            declaredNamedGates(bindingKey) ??
            this.createNamedInlineGate(context, namedGate.gateId, namedGate.criteria, {
              promptId: parsedCommand.promptId,
              bindingKey,
            });
          if (gateId) {
            parsedCommand.inlineGateIds = this.appendGateId(parsedCommand.inlineGateIds, gateId);
            createdIds.push(gateId);
          }
        }
      }
    }

    // Validate and create inline gate for the main command (anonymous criteria)
    if (isValidGateCriteria(parsedCommand.inlineGateCriteria)) {
      const result = await this.applyGateCriteria(
        context,
        parsedCommand.inlineGateCriteria,
        { promptId: parsedCommand.promptId },
        declaredNamedGates
      );
      this.applyGateResult(parsedCommand, result, createdIds, registeredIds);
    }

    // Validate and create inline gates for chain steps
    if (Array.isArray(parsedCommand.steps) && parsedCommand.steps.length > 0) {
      for (const step of parsedCommand.steps) {
        if (hasInlineGateCriteria(step)) {
          const result = await this.applyGateCriteria(
            context,
            step.inlineGateCriteria,
            { promptId: step.promptId, stepNumber: step.stepNumber },
            declaredNamedGates
          );
          this.applyGateResult(step, result, createdIds, registeredIds);
        }
      }
    }

    return {
      createdIds,
      registeredIds,
      namedCount: parsedCommand.namedInlineGates?.length ?? 0,
    };
  }

  /**
   * The refusals for this command's named inline gates that would register under a canonical gate
   * id (R100). A `verify:` gate registers nothing, so it is not judged.
   */
  canonicalIdCollisions(parsedCommand: ParsedCommand): Array<{ readonly detail: string }> {
    return (parsedCommand.namedInlineGates ?? []).flatMap((namedGate) => {
      if (namedGate.shellVerify !== undefined || !isValidGateCriteria(namedGate.criteria)) {
        return [];
      }
      const refusal = this.temporaryGateRegistry.canonicalIdRefusal(namedGate.gateId);
      return refusal === undefined
        ? []
        : [{ detail: `named inline gate "${namedGate.gateId}": ${refusal}` }];
    });
  }

  /**
   * Re-register the temporary gates a restored run's blueprint references and this process does
   * not hold (R54) — a run claimed from another server (the 2A handoff) is the one resume whose
   * gates were registered in a process that is not this one. Stage 05 skips processing on a
   * restored blueprint, and the registry is in memory, so without this the run's named gates, its
   * anonymous criteria and its request gates stop rendering and reviewing from the claim on.
   *
   * Each gate registers under the id the blueprint recorded (`restoreTemporaryGate`), so the
   * steps' `inlineGateIds` resolve unchanged; a held id is skipped. That makes the restore
   * idempotent by construction: on a resume in the process that registered them, every id is held
   * and nothing registers. Request gates are not referenced by the blueprint's ids: the ones the
   * start call registered ride `parsedCommand.requestGates` (stage 13), and are handed back to the
   * request-gate registrar (stage 11) when the run owns none. Returns the ids registered here.
   */
  async restoreRunGates(
    context: ExecutionContext,
    parsedCommand: ParsedCommand
  ): Promise<string[]> {
    const runId = context.getSessionId();
    if (runId === undefined) {
      return [];
    }
    const restored: string[] = [];
    const restore: RestoreGate = (id, criteria, identity, stepNumber, onHeld = 'skip') => {
      const definition = {
        ...identity,
        type: 'validation' as const,
        scope: stepNumber !== undefined ? ('step' as const) : ('execution' as const),
        guidance: formatCriteriaAsGuidance(criteria),
        pass_criteria: [...criteria],
        source: 'automatic' as const,
      };
      const scopeId = this.getScopeId(context, stepNumber);
      const registered =
        onHeld === 'fresh-id'
          ? this.temporaryGateRegistry.createTemporaryGate({ id, ...definition }, scopeId, {
              onIdCollision: 'fresh-id',
              // A run recorded before the canonical-id refusal can hold a named gate under a
              // canonical id: it restores under a fresh `<id>-N` and the remap follows (R104).
              onCanonicalId: 'fresh-id',
            })
          : this.temporaryGateRegistry.restoreTemporaryGate({ id, ...definition }, scopeId)
            ? id
            : undefined;
      if (registered !== undefined) {
        restored.push(registered);
      }
      return registered;
    };

    const remap = this.restoreNamedGates(parsedCommand, restore, runId);
    for (const [recordedId, freshId] of this.restoreRequestGates(context, parsedCommand, runId)) {
      remap.set(recordedId, freshId);
    }
    // The run's open reviews and its inline-id reads follow the remap too (R60 amended), composed
    // onto the map an earlier claimer persisted on the run (R69) — even when this one is empty.
    await this.runGateStore.remapRunGates(runId, remap);
    await this.restoreAnonymousGates(parsedCommand, restore, (key) =>
      this.temporaryGateRegistry.resolveDeclared(key, runId, restored)
    );
    return restored;
  }

  /**
   * Each named gate under the id the command recorded for it: `name`, or `name-N` (R43). When
   * that id is held here by ANOTHER run's gate (a claim onto a server running a same-named gate),
   * the gate registers under a fresh `<id>-N` with the recorded binding key, and this call's
   * restored command references the fresh id in place of the recorded one (R60): the steps carry
   * registered ids, not declared names, so nothing resolves the key for them. The blueprint keeps
   * the recorded id; every later call re-reads the run's own gate by its key. Returns the remap,
   * recorded id to registered id.
   */
  private restoreNamedGates(
    parsedCommand: ParsedCommand,
    restore: RestoreGate,
    runId: string
  ): Map<string, string> {
    const commandIds = parsedCommand.inlineGateIds ?? [];
    const remap = new Map<string, string>();
    const claimed = new Set<string>();
    const occurrences = new Map<string, number>();
    for (const namedGate of parsedCommand.namedInlineGates ?? []) {
      if (namedGate.shellVerify !== undefined || !isValidGateCriteria(namedGate.criteria)) {
        continue;
      }
      const occurrence = (occurrences.get(namedGate.gateId) ?? 0) + 1;
      occurrences.set(namedGate.gateId, occurrence);
      const recordedId = commandIds.find(
        (id) => !claimed.has(id) && isRegisteredUnder(id, namedGate.gateId)
      );
      if (recordedId === undefined) {
        continue;
      }
      claimed.add(recordedId);
      const bindingKey = namedGateBindingKey(namedGate.gateId, occurrence);
      const ownId =
        this.temporaryGateRegistry.resolveDeclared(bindingKey, runId, []) ??
        restore(
          recordedId,
          namedGate.criteria,
          {
            name: namedGate.gateId,
            description: `Named inline gate "${namedGate.gateId}" from symbolic syntax`,
            declared_key: bindingKey,
          },
          undefined,
          'fresh-id'
        );
      if (ownId !== undefined && ownId !== recordedId) {
        remap.set(recordedId, ownId);
      }
    }
    for (const target of [parsedCommand, ...(parsedCommand.steps ?? [])]) {
      if (remap.size > 0 && target.inlineGateIds !== undefined) {
        target.inlineGateIds = target.inlineGateIds.map((id) => remap.get(id) ?? id);
      }
    }
    return remap;
  }

  /**
   * Each carrier's anonymous criteria under the one generated id it references — the last, since
   * `applyGateResult` appends it after the references it resolved.
   */
  private async restoreAnonymousGates(
    parsedCommand: ParsedCommand,
    restore: RestoreGate,
    declaredNamedGates: DeclaredGateView
  ): Promise<void> {
    const carriers: Array<{ target: InlineGateTarget; stepNumber?: number }> = [
      { target: parsedCommand },
      ...(parsedCommand.steps ?? []).map((step) => ({ target: step, stepNumber: step.stepNumber })),
    ];
    for (const { target, stepNumber } of carriers) {
      const recordedId = [...(target.inlineGateIds ?? [])]
        .reverse()
        .find((id) => AUTO_GENERATED_GATE_ID.test(id));
      if (
        !isValidGateCriteria(target.inlineGateCriteria) ||
        recordedId === undefined ||
        this.temporaryGateRegistry.getTemporaryGate(recordedId) !== undefined
      ) {
        continue;
      }
      // A criterion naming another run's gate by its generated id was a reference, not text.
      const inlineCriteria = (
        await this.partitionGateCriteria(target.inlineGateCriteria, declaredNamedGates)
      ).inlineCriteria.filter((criterion) => !AUTO_GENERATED_GATE_ID.test(criterion));
      if (inlineCriteria.length > 0) {
        const description =
          stepNumber !== undefined
            ? `Inline criteria for step ${stepNumber}`
            : 'Inline criteria for symbolic command';
        restore(
          recordedId,
          inlineCriteria,
          { name: 'Inline Validation Criteria', description },
          stepNumber
        );
      }
    }
  }

  /**
   * The start call's request gates, handed back to stage 11 while the run owns none of them. One a
   * run recorded under a canonical id (before the refusal, R100) is handed back under the fresh
   * `<id>-N` it registers under, as a named gate restores (R104, R110). Returns that remap, recorded
   * id to handed-back id, for the run's reviews to follow.
   */
  private restoreRequestGates(
    context: ExecutionContext,
    parsedCommand: ParsedCommand,
    runId: string
  ): Map<string, string> {
    const remap = new Map<string, string>();
    const requestGates = parsedCommand.requestGates ?? [];
    const runOwnsRequestGates = this.temporaryGateRegistry
      .getRunGates(runId)
      .some((gate) => gate.origin === 'request');
    if (requestGates.length === 0 || runOwnsRequestGates) {
      return remap;
    }
    const handedBack = requestGates.map((gate) => {
      if (
        typeof gate !== 'object' ||
        !('id' in gate) ||
        typeof gate.id !== 'string' ||
        !this.temporaryGateRegistry.shadowsCanonicalGate(gate.id) ||
        !gateInputContainsInlineContent(gate)
      ) {
        return gate;
      }
      const freshId = remap.get(gate.id) ?? this.temporaryGateRegistry.freshIdFor(gate.id);
      remap.set(gate.id, freshId);
      return { ...gate, id: freshId };
    });
    const current = context.state.gates.requestedOverrides?.gates ?? [];
    context.state.gates.requestedOverrides = { gates: [...handedBack, ...current] };
    return remap;
  }

  private async applyGateCriteria(
    context: ExecutionContext,
    criteria: readonly string[],
    scope: InlineGateScope,
    declaredNamedGates: DeclaredGateView
  ): Promise<GateProcessingResult> {
    const partitioned = await this.partitionGateCriteria(criteria, declaredNamedGates);
    let temporaryGateId: string | undefined;

    if (partitioned.inlineCriteria.length > 0) {
      const gateId = this.createInlineGate(context, partitioned.inlineCriteria, scope);
      if (gateId) {
        temporaryGateId = gateId;
      }
    }

    if (temporaryGateId !== undefined) {
      return {
        registeredGateIds: partitioned.registeredGateIds,
        temporaryGateId,
      };
    }

    return {
      registeredGateIds: partitioned.registeredGateIds,
    };
  }

  private applyGateResult(
    target: InlineGateTarget,
    result: GateProcessingResult,
    createdIds: string[],
    registeredIds: string[]
  ): void {
    for (const gateId of result.registeredGateIds) {
      target.inlineGateIds = this.appendGateId(target.inlineGateIds, gateId);
      registeredIds.push(gateId);
    }

    if (result.temporaryGateId) {
      target.inlineGateIds = this.appendGateId(target.inlineGateIds, result.temporaryGateId);
      createdIds.push(result.temporaryGateId);
    }
  }

  private appendGateId(existing: string[] | undefined, gateId: string): string[] {
    if (!gateId) {
      return existing ?? [];
    }

    if (!Array.isArray(existing)) {
      return [gateId];
    }

    if (existing.includes(gateId)) {
      return existing;
    }

    return [...existing, gateId];
  }

  /**
   * Creates an inline gate with auto-generated ID for anonymous criteria.
   */
  private createInlineGate(
    context: ExecutionContext,
    criteria: readonly string[],
    scope: InlineGateScope
  ): string | null {
    if (!isValidGateCriteria(criteria)) {
      this.logger.warn('[InlineGateProcessor] Invalid gate criteria', {
        criteria,
        scope,
      });
      return null;
    }

    const guidance = formatCriteriaAsGuidance(criteria);
    const description = scope.stepNumber
      ? `Inline criteria for step ${scope.stepNumber}`
      : 'Inline criteria for symbolic command';

    const gateScope: GateScope = scope.stepNumber !== undefined ? 'step' : 'execution';
    const scopeId = this.getScopeId(context, scope.stepNumber);

    try {
      const gateId = this.temporaryGateRegistry.createTemporaryGate(
        {
          name: 'Inline Validation Criteria',
          type: 'validation',
          scope: gateScope,
          description,
          guidance,
          pass_criteria: [...criteria],
          source: 'automatic',
        },
        scopeId
      );

      return gateId;
    } catch (error) {
      this.logger.warn('[InlineGateProcessor] Failed to register inline gate', {
        error: error instanceof Error ? error.message : String(error),
        criteria,
        scope,
      });
      return null;
    }
  }

  /**
   * Creates a named inline gate with explicit ID from symbolic syntax.
   */
  private createNamedInlineGate(
    context: ExecutionContext,
    explicitId: string,
    criteria: readonly string[],
    scope: InlineGateScope & { readonly bindingKey: string }
  ): string | null {
    if (!explicitId || !isValidGateCriteria(criteria)) {
      this.logger.warn('[InlineGateProcessor] Invalid named gate input', {
        explicitId,
        criteria,
        scope,
      });
      return null;
    }

    const guidance = formatCriteriaAsGuidance(criteria);
    const description = `Named inline gate "${explicitId}" from symbolic syntax`;
    const gateScope: GateScope = scope.stepNumber !== undefined ? 'step' : 'execution';
    const scopeId = this.getScopeId(context, scope.stepNumber);

    try {
      const gateId = this.temporaryGateRegistry.createTemporaryGate(
        {
          id: explicitId,
          declared_key: scope.bindingKey,
          name: explicitId,
          type: 'validation',
          scope: gateScope,
          description,
          guidance,
          pass_criteria: [...criteria],
          source: 'automatic',
        } as any,
        scopeId,
        { onIdCollision: 'fresh-id' }
      );

      this.logger.debug('[InlineGateProcessor] Created named inline gate', {
        requestedId: explicitId,
        actualId: gateId,
        criteria,
      });

      return gateId;
    } catch (error) {
      this.logger.warn('[InlineGateProcessor] Failed to create named inline gate', {
        error: error instanceof Error ? error.message : String(error),
        explicitId,
        criteria,
        scope,
      });
      return null;
    }
  }

  private async partitionGateCriteria(
    criteria: readonly string[],
    declaredNamedGates: DeclaredGateView
  ): Promise<{ inlineCriteria: string[]; registeredGateIds: string[] }> {
    const inlineCriteria: string[] = [];
    const registeredGateIds: string[] = [];

    for (const entry of criteria) {
      const trimmed = typeof entry === 'string' ? entry.trim() : '';
      if (!trimmed) {
        continue;
      }

      const registryGateId = declaredNamedGates(trimmed) ?? this.lookupTemporaryGateId(trimmed);
      if (registryGateId) {
        registeredGateIds.push(registryGateId);
        continue;
      }

      try {
        const resolution = await this.gateReferenceResolver.resolve(trimmed);
        this.applyResolution(resolution, inlineCriteria, registeredGateIds);
      } catch (error) {
        this.logger.warn('[InlineGateProcessor] Failed to resolve gate reference', {
          entry: trimmed,
          error: error instanceof Error ? error.message : String(error),
        });
        inlineCriteria.push(trimmed);
      }
    }

    return {
      inlineCriteria,
      registeredGateIds: Array.from(new Set(registeredGateIds)),
    };
  }

  private lookupTemporaryGateId(reference: string): string | undefined {
    if (!reference || !this.temporaryGateRegistry) {
      return undefined;
    }

    const gate = this.temporaryGateRegistry.getTemporaryGate(reference);
    if (gate) {
      this.logger.debug('[InlineGateProcessor] Resolved inline reference to temporary gate', {
        reference,
        gateId: gate.id,
      });
      return gate.id;
    }

    return undefined;
  }

  private applyResolution(
    resolution: GateReferenceResolution,
    inlineCriteria: string[],
    registeredGateIds: string[]
  ): void {
    if (resolution.referenceType === 'registered') {
      registeredGateIds.push(resolution.gateId);
      return;
    }

    if (resolution.suggestions && resolution.suggestions.length > 0) {
      this.logger.warn(
        `[InlineGateProcessor] Unknown gate "${resolution.criteria}". ` +
          `Did you mean: ${resolution.suggestions.join(', ')}?`
      );
    }

    if (resolution.criteria) {
      inlineCriteria.push(resolution.criteria);
    }
  }

  private getScopeId(context: ExecutionContext, stepNumber?: number): string {
    const baseScope =
      context.state.session.executionScopeId ||
      context.getSessionId?.() ||
      context.mcpRequest.chain_id ||
      context.mcpRequest.command ||
      'execution';

    if (typeof stepNumber === 'number') {
      return `${baseScope}:step_${stepNumber}`;
    }

    return `${baseScope}:command`;
  }

  /**
   * Sets up shell verification state for Ralph Wiggum loops.
   * Supports presets (:fast, :full, :extended) that expand to max/timeout values.
   */
  private setupShellVerification(
    context: ExecutionContext,
    gateId: string,
    shellVerifyConfig: ShellVerifyGate
  ): void {
    const shellPresets = loadShellPresets();
    const presetValues = shellVerifyConfig.preset
      ? shellPresets[shellVerifyConfig.preset]
      : undefined;

    const resolvedMaxIterations =
      shellVerifyConfig.maxIterations ??
      presetValues?.maxIterations ??
      SHELL_VERIFY_DEFAULTS.maxAttempts;

    const resolvedTimeout =
      shellVerifyConfig.timeout ?? presetValues?.timeout ?? SHELL_VERIFY_DEFAULTS.defaultTimeout;

    const shellVerify: ShellVerifyGate = {
      command: shellVerifyConfig.command,
      timeout: resolvedTimeout,
      workingDir: shellVerifyConfig.workingDir,
      loop: shellVerifyConfig.loop,
      maxIterations: resolvedMaxIterations,
      preset: shellVerifyConfig.preset,
    };

    const originalGoal =
      context.parsedCommand?.metadata?.originalCommand ??
      context.mcpRequest.command ??
      context.parsedCommand?.promptId ??
      'Fix verification failures';

    const pending: PendingShellVerification = {
      gateId,
      shellVerify,
      attemptCount: 0,
      maxAttempts: resolvedMaxIterations,
      previousResults: [],
      originalGoal,
    };

    context.state.gates.pendingShellVerification = pending;

    // Publish the resolved budget on its own field. `pending` is cleared as soon as verification
    // completes, so it cannot carry this to the formatting stage for a command that passes.
    context.state.gates.shellVerifyBudget = {
      maxAttempts: resolvedMaxIterations,
      ...(resolvedTimeout != null ? { timeoutMs: resolvedTimeout } : {}),
      ...(shellVerifyConfig.preset != null ? { preset: shellVerifyConfig.preset } : {}),
    };

    this.logger.info('[InlineGateProcessor] Shell verification gate configured', {
      gateId,
      command: shellVerify.command,
      timeout: shellVerify.timeout,
      maxAttempts: pending.maxAttempts,
      loop: shellVerify.loop,
      preset: shellVerify.preset,
    });
  }
}

/** The auto-generated temporary gate id form (`TemporaryGateRegistry.chooseGateId`). */
const AUTO_GENERATED_GATE_ID = /^temp_\d+_[a-z0-9]+$/;

/** Whether `id` is what a named gate declared as `name` registered under: `name` or `name-N` (R43). */
function isRegisteredUnder(id: string, name: string): boolean {
  return id === name || (id.startsWith(`${name}-`) && /^\d+$/.test(id.slice(name.length + 1)));
}
