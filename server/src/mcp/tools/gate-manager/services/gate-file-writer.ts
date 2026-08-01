// @lifecycle canonical - Service-layer gate file writes with verification and rollback guarantees.
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { GateCreationData } from '../core/types.js';

import {
  ResourceMutationTransaction,
  ResourceVerificationService,
  type ResourceVerificationFailurePayload,
} from '#modules/resources/services/index.js';
import { serializeYaml } from '#shared/utils/yaml/yaml-parser.js';

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
    const gateDir = path.join(this.configManager.getGatesDirectory(), data.id);
    const yamlPath = path.join(gateDir, 'gate.yaml');
    const guidancePath = path.join(gateDir, 'guidance.md');

    const transactionResult = await this.mutationTransaction.run({
      targets: [{ path: gateDir, kind: 'directory' }],
      mutate: async () => {
        const paths: string[] = [];
        await mkdir(gateDir, { recursive: true });
        paths.push(gateDir);

        const yamlData = this.buildGateYaml(data);
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

  private buildGateYaml(data: GateCreationData): Record<string, unknown> {
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

    return yamlData;
  }
}
