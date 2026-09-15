// @lifecycle canonical - Service-layer gate file writes with verification and rollback guarantees.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { FileContentChange } from '../../resource-manager/prompt/analysis/object-diff-generator.js';
import type { GateCreationData } from '../core/types.js';

import { GATE_YAML_DECLARED_KEYS } from '#engine/gates/core/gate-yaml-keys.js';
import {
  ResourceMutationTransaction,
  ResourceVerificationService,
  type ResourceVerificationFailurePayload,
  type ResourceWriteCommitOptions,
} from '#modules/resources/services/index.js';
import { resolveContainedPath } from '#shared/utils/path-containment.js';
import { parseYaml, serializeYaml } from '#shared/utils/yaml/yaml-parser.js';

/**
 * gate.yaml keys `buildGateYaml` writes directly from `GateCreationData` — always
 * (`id`/`name`/`type`/`description`/`guidanceFile`) or conditionally when the caller/fallback
 * supplied a value (`pass_criteria`/`activation`/`retry_config`). Never candidates for the
 * generic carry-forward below — the code above already decides their fate.
 */
const GATE_YAML_PROJECTED_KEYS = [
  'id',
  'name',
  'type',
  'description',
  'guidanceFile',
  'pass_criteria',
  'activation',
  'retry_config',
] as const;

/**
 * Schema keys deliberately NOT carried forward generically. `guidance` is the only member:
 * inline `guidance:` YAML content is always superseded by the `guidance.md` file this writer
 * produces (referenced via `guidanceFile`), so preserving a stale inline value would create two
 * disagreeing guidance sources instead of one.
 */
const GATE_YAML_EXCLUDED_KEYS = ['guidance'] as const;

/**
 * Authorable gate.yaml keys `GateFileWriter` builds no value for — carried forward from the
 * on-disk file when the caller didn't supply a value. Without this, ANY `resource_manager`
 * update on a hand-authored gate setting these silently strips them back to loader defaults.
 * Same class of bug already fixed for prompts via `PRESERVED_PROMPT_YAML_KEYS`
 * (`resource-manager/prompt/operations/file-operations.ts`).
 *
 * Derived from `GATE_YAML_DECLARED_KEYS` (`gate-yaml-keys.ts`'s engine-side walk of
 * `GateDefinitionSchema`'s declared object keys), minus the projected and excluded sets above
 * (currently `severity`, `enforcementMode`, `gate_type`, `evaluation`, `blockResponseOnFail`). A
 * future schema field lands here automatically — nothing to update by hand.
 *
 * `GateCreationData` carries `severity` and `enforcementMode` since P4.4, so the "caller supplied
 * a value" branch of `resolvePreservedGateYamlFields` is reachable for those two: supplied, they
 * are written; omitted, they still resolve from the existing on-disk file. That separation is the
 * whole point of routing them through preservation rather than projection — settability did not
 * cost the carry-forward.
 *
 * `gate_type` remains resolvable only from disk, because its name is already taken on the tool
 * surface by a parameter that maps to the YAML key `type`. Not an oversight: resolving it means
 * renaming that parameter, which is breaking. Tracked as P4.10.
 */
export const PRESERVED_GATE_YAML_KEYS = GATE_YAML_DECLARED_KEYS.filter(
  (key) =>
    !(GATE_YAML_PROJECTED_KEYS as readonly string[]).includes(key) &&
    !(GATE_YAML_EXCLUDED_KEYS as readonly string[]).includes(key)
);

export { GATE_YAML_PROJECTED_KEYS, GATE_YAML_EXCLUDED_KEYS };

/**
 * `GateCreationData` keys whose value lives in `gate.yaml` — the gate-side counterpart of
 * `PROMPT_YAML_RESIDENT_KEYS` (`resource-manager/prompt/operations/file-operations.ts`). A key
 * here does NOT mean `buildGateYaml` unconditionally emits it (its own conditionals and
 * `resolvePreservedGateYamlFields`'s precedence still apply); it means: if a write supplies this
 * key, `gate.yaml` is one of the files that write is allowed to touch.
 *
 * Derived from `GATE_YAML_PROJECTED_KEYS` and `PRESERVED_GATE_YAML_KEYS` rather than listed by
 * hand, for the same reason `PRESERVED_GATE_YAML_KEYS` derives from the schema walk above: a
 * future gate.yaml field lands here automatically. `id` and `guidanceFile` are excluded — `id`
 * addresses the gate rather than describing an editable field, and `guidanceFile` is a constant
 * the writer derives, never something a caller supplies.
 */
const GATE_YAML_RESIDENT_KEYS: readonly string[] = [
  ...GATE_YAML_PROJECTED_KEYS.filter((key) => key !== 'id' && key !== 'guidanceFile'),
  ...PRESERVED_GATE_YAML_KEYS,
];

/**
 * Every `GateCreationData` key any write path can touch. `writeGateFiles`/`projectGateWrite`
 * default to this when no `suppliedKeys` argument is given — `handleCreate` and rollback each own
 * the WHOLE state being written, not an edit to a subset of it, so neither has a narrower scope to
 * compute (mirrors `ALL_PROMPT_DATA_KEYS`'s role for prompts).
 */
const ALL_GATE_DATA_KEYS: ReadonlySet<string> = new Set([...GATE_YAML_RESIDENT_KEYS, 'guidance']);

/**
 * Decide what each preserved key should carry into the rewritten YAML: an explicitly supplied
 * value if the caller had one, otherwise whatever the file itself already declared, otherwise
 * nothing. Mirrors `resolvePreservedPromptYamlFields` exactly.
 */
export function resolvePreservedGateYamlFields(
  gateData: Record<string, unknown>,
  existingYaml: Record<string, unknown> | undefined
): Record<string, unknown> {
  const preserved: Record<string, unknown> = {};

  for (const key of PRESERVED_GATE_YAML_KEYS) {
    const supplied = gateData[key];
    if (supplied !== undefined) {
      preserved[key] = supplied;
      continue;
    }
    const declared = existingYaml?.[key];
    if (declared !== undefined) {
      preserved[key] = declared;
    }
  }

  return preserved;
}

/**
 * Ends non-empty guidance with a newline when it has none. Create, update and rollback all write
 * through here, so a version saved while the loader trimmed guidance restores a newline-terminated
 * file. Content that already ends with a newline is left as it is, so an update that does not
 * touch guidance keeps `guidance.md` byte-identical.
 *
 * Exported for `GateLifecycleProcessor`'s create-path version snapshot: the recorded
 * state must match what a disk read-back produces, or the first update bridges a "mismatch" that
 * is really just this same newline this function already applies at write time.
 */
export function ensureTrailingNewline(guidance: string): string {
  if (guidance === '' || guidance.endsWith('\n')) {
    return guidance;
  }
  return `${guidance}\n`;
}

export interface GateFileWriterDependencies {
  logger: Logger;
  configManager: ConfigManager;
  resourceVerificationService?: ResourceVerificationService;
  resourceMutationTransaction?: ResourceMutationTransaction;
}

export interface GateFileWriteResult {
  success: boolean;
  paths?: string[];
  error?: string;
  verificationFailure?: ResourceVerificationFailurePayload;
}

/**
 * Everything one gate write puts on disk, resolved before anything is written.
 *
 * `writeGateFiles` applies it and `projectGateWrite` reports it. A diff built any other way — the
 * gate's fields rendered as one `gate.yaml`, say — hides the `guidance.md` the write also lands and
 * shows `gate.yaml` lines the file never holds (tutorial-rework B.20).
 */
interface GateWritePlan {
  gatesDir: string;
  gateDir: string;
  /** `gate.yaml` then `guidance.md`, as the exact bytes the write leaves. */
  files: Array<{ relativePath: string; content: string }>;
}

export class GateFileWriter {
  private readonly logger: Logger;
  private readonly configManager: ConfigManager;
  private readonly verificationService: ResourceVerificationService;
  private readonly mutationTransaction: ResourceMutationTransaction;

  constructor(dependencies: GateFileWriterDependencies) {
    this.logger = dependencies.logger;
    this.configManager = dependencies.configManager;
    this.verificationService =
      dependencies.resourceVerificationService ?? new ResourceVerificationService();
    this.mutationTransaction =
      dependencies.resourceMutationTransaction ?? new ResourceMutationTransaction();
  }

  async writeGateFiles(
    data: GateCreationData,
    suppliedKeys: ReadonlySet<string> = ALL_GATE_DATA_KEYS,
    options: ResourceWriteCommitOptions = {}
  ): Promise<GateFileWriteResult> {
    // Every byte this write lands is decided here, before the transaction opens; the mutation
    // below applies the plan and decides nothing of its own, which is what keeps
    // `projectGateWrite` reporting the same files and contents.
    const plan = await this.planGateWrite(data, suppliedKeys);
    const { gateDir } = plan;
    const yamlPath = path.join(gateDir, 'gate.yaml');

    const transactionResult = await this.mutationTransaction.run({
      targets: [{ path: gateDir, kind: 'directory' }],
      mutate: async () => {
        const paths: string[] = [];
        await mkdir(gateDir, { recursive: true });
        paths.push(gateDir);

        for (const file of plan.files) {
          const filePath = path.join(gateDir, file.relativePath);
          await writeFile(filePath, file.content, 'utf8');
          paths.push(filePath);
        }

        return { paths };
      },
      validate: () => this.verificationService.validateFile('gates', data.id, yamlPath),
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
    });

    if (!transactionResult.success) {
      const verificationFailure =
        transactionResult.verificationFailure ??
        (transactionResult.validation !== undefined && !transactionResult.validation.valid
          ? this.verificationService.toFailurePayload(
              transactionResult.validation,
              transactionResult.rolledBack
            )
          : undefined);

      if (transactionResult.verificationFailure !== undefined) {
        this.logger.warn(
          `[GateFileWriter] Verification failed for gate '${data.id}' (rolledBack=${String(
            transactionResult.verificationFailure.rolledBack
          )})`
        );
      }

      return {
        success: false,
        verificationFailure,
        error: transactionResult.error,
      };
    }

    return { success: true, paths: transactionResult.result?.paths ?? [] };
  }

  /**
   * What `writeGateFiles(data, suppliedKeys)` would change on disk, file by file, without writing
   * anything.
   *
   * Resolves the plan that method applies, so the files and contents are exactly that call's.
   * Paths are relative to the gates root. A gate with no directory under that root yet — a create,
   * or a gate served from the bundled tree — has no prior content, because the write creates its
   * files there rather than editing the bundled ones.
   */
  async projectGateWrite(
    data: GateCreationData,
    suppliedKeys: ReadonlySet<string> = ALL_GATE_DATA_KEYS
  ): Promise<FileContentChange[]> {
    const plan = await this.planGateWrite(data, suppliedKeys);
    const prefix = path.relative(plan.gatesDir, plan.gateDir);

    const changes: FileContentChange[] = [];
    for (const file of plan.files) {
      const priorPath = path.join(plan.gateDir, file.relativePath);
      const relativePath = path.join(prefix, file.relativePath).split(path.sep).join('/');
      changes.push({
        path: relativePath,
        previousPath: relativePath,
        before: existsSync(priorPath) ? await readFile(priorPath, 'utf8') : null,
        after: file.content,
      });
    }
    return changes;
  }

  /**
   * Resolve the files one gate write lands, reading the disk but writing nothing.
   *
   * The single place those contents are decided, so `writeGateFiles` and `projectGateWrite` share
   * one answer. `ensureTrailingNewline` shapes `guidance.md` here rather than at the write, so the
   * planned bytes are the written bytes.
   *
   * Write-scope narrowing (mirrors `planPromptFiles` in
   * `resource-manager/prompt/operations/file-operations.ts`): `gate.yaml` is planned only when a
   * field that lives in it was supplied, and `guidance.md` only when `guidance` was. Without this,
   * `buildGateYaml` — which always emits a full document — was the whole write plan, so a
   * guidance-only update re-serialized `gate.yaml` on every call: same field values, but stripped
   * of comments and re-ordered to the writer's own key order, on a file the caller never asked to
   * touch.
   */
  private async planGateWrite(
    data: GateCreationData,
    suppliedKeys: ReadonlySet<string> = ALL_GATE_DATA_KEYS
  ): Promise<GateWritePlan> {
    const gatesDir = this.configManager.getGatesDirectory();
    // `data.id` is caller-supplied and unvalidated for path segments. Measured 2026-08-30:
    // `id: '../../ESCAPED_GATE'` wrote gate.yaml and guidance.md outside the resources root, and
    // the tool reported the write. Contained before the directory is created.
    const gateDir = resolveContainedPath(gatesDir, data.id);
    const yamlPath = path.join(gateDir, 'gate.yaml');

    // A gate with no LOCAL gate.yaml yet — a genuine create, or the first local edit of a gate
    // this workspace has so far only ever served from the bundled tree — needs both files
    // regardless of what `suppliedKeys` narrows to. Without this force, a guidance-only update of
    // a bundled-only gate would write `guidance.md` alone into a directory with no local
    // `gate.yaml`, and the loader — which resolves `guidanceFile` relative to whichever
    // `gate.yaml` it actually loaded — would keep reading the bundled pair and never see it: an
    // orphaned write, not a scoped one. Same shape as prompts' `isFreshDirectory` force (P1.2,
    // `file-operations.ts`).
    const isFreshDirectory = !existsSync(yamlPath);
    const writesYaml =
      isFreshDirectory || GATE_YAML_RESIDENT_KEYS.some((key) => suppliedKeys.has(key));
    const writesGuidance = isFreshDirectory || suppliedKeys.has('guidance');

    // Read only when `gate.yaml` is actually going to be rewritten — field preservation feeds
    // ONLY that write, and reading it otherwise is I/O a scoped-out update has no use for. This is
    // also the acceptance mechanism for byte-identity: when `writesYaml` is false, `gate.yaml` is
    // never opened by this call at all.
    const existingYaml = writesYaml ? await this.readExistingGateYaml(yamlPath) : undefined;

    const files: GateWritePlan['files'] = [];
    if (writesYaml) {
      files.push({
        relativePath: 'gate.yaml',
        content: serializeYaml(this.buildGateYaml(data, existingYaml), { sortKeys: false }),
      });
    }
    if (writesGuidance) {
      files.push({ relativePath: 'guidance.md', content: ensureTrailingNewline(data.guidance) });
    }

    return { gatesDir, gateDir, files };
  }

  private buildGateYaml(
    data: GateCreationData,
    existingYaml?: Record<string, unknown>
  ): Record<string, unknown> {
    const yamlData: Record<string, unknown> = {
      id: data.id,
      name: data.name,
      type: data.type,
      description: data.description,
      guidanceFile: 'guidance.md',
    };

    if (data.pass_criteria && data.pass_criteria.length > 0) {
      yamlData['pass_criteria'] = data.pass_criteria;
    }

    if (data.activation) {
      yamlData['activation'] = data.activation;
    }

    if (data.retry_config) {
      yamlData['retry_config'] = data.retry_config;
    }

    // Carry forward the fields this writer builds no value for. Without this, every update
    // silently strips them back to loader defaults (severity, enforcementMode, gate_type, ...).
    Object.assign(
      yamlData,
      resolvePreservedGateYamlFields(data as unknown as Record<string, unknown>, existingYaml)
    );

    return yamlData;
  }

  /**
   * Read the gate.yaml already on disk, for field preservation only.
   *
   * A missing or unparseable file is not an error here: a create has no prior file, and a file
   * too broken to parse is about to be replaced wholesale by the write this feeds. Either way
   * there is nothing to preserve, and the write itself is still validated afterward by
   * `ResourceVerificationService` inside the mutation transaction.
   */
  private async readExistingGateYaml(
    gateYamlPath: string
  ): Promise<Record<string, unknown> | undefined> {
    if (!existsSync(gateYamlPath)) {
      return undefined;
    }

    try {
      const raw = await readFile(gateYamlPath, 'utf8');
      const parsed = parseYaml<Record<string, unknown> | null>(raw, { filename: gateYamlPath });
      // An empty or `null` document parses successfully to a non-object — nothing to preserve.
      if (!parsed.success || parsed.data == null || typeof parsed.data !== 'object') {
        this.logger.warn(
          `[GateFileWriter] Could not read existing gate.yaml for field preservation: ${gateYamlPath}`
        );
        return undefined;
      }
      return parsed.data;
    } catch (error) {
      this.logger.warn(
        `[GateFileWriter] Could not read existing gate.yaml for field preservation: ${gateYamlPath} (${String(error)})`
      );
      return undefined;
    }
  }
}
