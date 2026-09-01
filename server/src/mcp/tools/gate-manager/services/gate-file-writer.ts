// @lifecycle canonical - Service-layer gate file writes with verification and rollback guarantees.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { GateCreationData } from '../core/types.js';

import { GATE_YAML_DECLARED_KEYS } from '#engine/gates/core/gate-yaml-keys.js';
import {
  ResourceMutationTransaction,
  ResourceVerificationService,
  type ResourceVerificationFailurePayload,
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
 * Two sources feed this list:
 *  - Derived from `GATE_YAML_DECLARED_KEYS` (`gate-yaml-keys.ts`'s engine-side walk of
 *    `GateDefinitionSchema`'s declared object keys), minus the projected and excluded sets above
 *    (currently `severity`, `enforcementMode`, `gate_type`). A future schema field lands here
 *    automatically — nothing to update by hand.
 *  - `evaluation` and `blockResponseOnFail` are appended manually. Both are real, load-bearing
 *    gate.yaml keys read at runtime (`gate-loader.ts` `toLightweightGate`), but
 *    `GateDefinitionSchema` accepts them only via `.passthrough()` — it does not declare them as
 *    object keys, so the derivation above cannot see them. The schema-coverage test
 *    (`manager.test.ts` "update preservation") only walks `GateDefinitionSchema`'s DECLARED
 *    keys; it cannot catch a third passthrough-only field the way it catches a new declared one
 *    — that gap is the one still open here.
 *
 * `GateCreationData` never carries any of these fields (settability is a separate, out-of-scope
 * initiative), so the "caller supplied a value" branch of `resolvePreservedGateYamlFields` is
 * presently unreachable in practice — every one of these keys resolves purely from the existing
 * on-disk file.
 */
export const PRESERVED_GATE_YAML_KEYS = [
  ...GATE_YAML_DECLARED_KEYS.filter(
    (key) =>
      !(GATE_YAML_PROJECTED_KEYS as readonly string[]).includes(key) &&
      !(GATE_YAML_EXCLUDED_KEYS as readonly string[]).includes(key)
  ),
  'evaluation',
  'blockResponseOnFail',
] as const;

export { GATE_YAML_PROJECTED_KEYS, GATE_YAML_EXCLUDED_KEYS };

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

  async writeGateFiles(data: GateCreationData): Promise<GateFileWriteResult> {
    // `data.id` is caller-supplied and unvalidated for path segments. Measured 2026-08-30:
    // `id: '../../ESCAPED_GATE'` wrote gate.yaml and guidance.md outside the resources root, and
    // the tool reported the write. Contained before the directory is created.
    const gateDir = resolveContainedPath(this.configManager.getGatesDirectory(), data.id);
    const yamlPath = path.join(gateDir, 'gate.yaml');
    const guidancePath = path.join(gateDir, 'guidance.md');

    // Read BEFORE the mutation starts — an update overwrites this same path, and a create has
    // nothing here yet (readExistingGateYaml returns undefined either way it can't read).
    const existingYaml = await this.readExistingGateYaml(yamlPath);

    const transactionResult = await this.mutationTransaction.run({
      targets: [{ path: gateDir, kind: 'directory' }],
      mutate: async () => {
        const paths: string[] = [];
        await mkdir(gateDir, { recursive: true });
        paths.push(gateDir);

        const yamlData = this.buildGateYaml(data, existingYaml);
        const yamlContent = serializeYaml(yamlData, { sortKeys: false });
        await writeFile(yamlPath, yamlContent, 'utf8');
        paths.push(yamlPath);

        await writeFile(guidancePath, data.guidance, 'utf8');
        paths.push(guidancePath);

        return { paths };
      },
      validate: () => this.verificationService.validateFile('gates', data.id, yamlPath),
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
