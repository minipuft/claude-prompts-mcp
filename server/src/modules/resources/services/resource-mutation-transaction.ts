// @lifecycle canonical - Transaction helper for resource writes with snapshot rollback guarantees.
import { cp, copyFile, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  ResourceVerificationError,
  ResourceVerificationService,
  type ResourceVerificationFailurePayload,
  type ResourceVerificationResult,
} from './resource-verification-service.js';

export interface ResourceMutationTarget {
  path: string;
  kind?: 'file' | 'directory';
}

/**
 * What a resource WRITER accepts so its caller can put a durable record inside the write's
 * transaction. One shared shape across the prompt, gate and framework writers, because P4.2's
 * finding was that the same split existed in all three and a per-writer option would let them
 * drift apart again.
 */
export interface ResourceWriteCommitOptions {
  commit?: () => Promise<void>;
}

export interface ResourceMutationTransactionOptions<T, C = void> {
  targets: ResourceMutationTarget[];
  mutate: () => Promise<T> | T;
  validate?: () => Promise<ResourceVerificationResult> | ResourceVerificationResult;
  /**
   * Durable bookkeeping that must succeed or the files go back — the version record, above all.
   *
   * WHY THIS IS NOT THE CALLER'S BUSINESS ANY MORE (P4.2 / SF-3). A resource write and the
   * version row describing it were two sequential steps, and a sequential two-step can only
   * CHOOSE which way it breaks: record-first leaves a phantom row for a write that failed,
   * write-first leaves a file no version row describes, which is unrecoverable because nothing
   * regenerates `version_history`. Both orderings were tried here; the second was reverted.
   *
   * Running the record INSIDE the transaction is what dissolves the choice. It runs after the
   * files are written and verified, so a write or validation failure never reaches it and the
   * ledger stays untouched; and it throws on failure into the same catch that restores every
   * snapshot, so a record failure leaves the files byte-identical. Neither half depends on the
   * other having been ordered correctly.
   *
   * Runs LAST on purpose. Committing before `validate` would record a state the transaction is
   * about to roll back — the phantom row under a different name.
   */
  commit?: () => Promise<C> | C;
}

export interface ResourceMutationTransactionResult<T, C = void> {
  success: boolean;
  result?: T;
  validation?: ResourceVerificationResult;
  verificationFailure?: ResourceVerificationFailurePayload;
  /** Present only on success — a failed `commit` rolls the whole mutation back. */
  commitResult?: C | undefined;
  rolledBack: boolean;
  error?: string;
}

interface TargetSnapshot {
  target: ResourceMutationTarget;
  existed: boolean;
  kind: 'file' | 'directory';
  snapshotPath?: string;
}

export class ResourceMutationTransaction {
  /**
   * Formatting only — `ResourceVerificationService` holds no state and opens no connection, and
   * the two methods used here (`toFailurePayload`, `formatFailurePayload`) are pure. Defaulted
   * rather than required so every existing `new ResourceMutationTransaction()` call site is
   * unchanged, and injectable so a test can assert the wiring rather than the wording.
   */
  constructor(
    private readonly verificationService: ResourceVerificationService = new ResourceVerificationService()
  ) {}

  async run<T, C = void>(
    options: ResourceMutationTransactionOptions<T, C>
  ): Promise<ResourceMutationTransactionResult<T, C>> {
    const snapshotRoot = await mkdtemp(join(tmpdir(), 'cpm-resource-txn-'));
    let snapshots: TargetSnapshot[] = [];
    let rolledBack = false;

    try {
      snapshots = await this.captureSnapshots(snapshotRoot, options.targets);
      const result = await options.mutate();

      let validation: ResourceVerificationResult | undefined;
      if (options.validate !== undefined) {
        validation = await options.validate();
        if (!validation.valid) {
          await this.restoreSnapshots(snapshots);
          rolledBack = true;

          // The exact sentence the caller needs is computed right here and used to be dropped on
          // the floor: this branch held a fully specific `ResourceVerificationResult` — one issue
          // naming `frameworkGates.0.name` and `expected string, received undefined` — and
          // returned a fixed string saying only that the state was invalid. An operator who hit
          // it could not tell a malformed field from a disk failure, which is how a
          // writer/verifier disagreement survived undiagnosed. Generic over every resource type,
          // so prompts, gates, frameworks, styles and tools all gain the detail.
          const verificationFailure = this.verificationService.toFailurePayload(
            validation,
            rolledBack
          );

          return {
            success: false,
            result,
            validation,
            verificationFailure,
            rolledBack,
            error:
              'Mutation produced invalid resource state; restored previous files.\n' +
              this.verificationService.formatFailurePayload(verificationFailure),
          };
        }
      }

      // Last, and inside the `try` — a throw here lands in the catch below, which restores every
      // snapshot. That is the whole mechanism: the caller writes `commit` as an ordinary await and
      // gets file-level atomicity across it without ordering anything.
      const commitResult = options.commit !== undefined ? await options.commit() : undefined;

      return { success: true, result, validation, commitResult, rolledBack };
    } catch (error) {
      if (snapshots.length > 0) {
        await this.restoreSnapshots(snapshots);
        rolledBack = true;
      }

      const verificationFailure =
        error instanceof ResourceVerificationError
          ? {
              ...error.payload,
              rolledBack,
            }
          : undefined;

      return {
        success: false,
        verificationFailure,
        rolledBack,
        error:
          error instanceof ResourceVerificationError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error),
      };
    } finally {
      await rm(snapshotRoot, { recursive: true, force: true });
    }
  }

  private async captureSnapshots(
    snapshotRoot: string,
    targets: ResourceMutationTarget[]
  ): Promise<TargetSnapshot[]> {
    const snapshots: TargetSnapshot[] = [];

    for (const [index, target] of targets.entries()) {
      const normalizedKind = target.kind ?? (await this.detectTargetKind(target.path));
      const snapshot: TargetSnapshot = {
        target,
        existed: false,
        kind: normalizedKind,
      };

      try {
        const stats = await lstat(target.path);
        snapshot.existed = true;
        snapshot.kind = stats.isDirectory() ? 'directory' : 'file';
      } catch {
        snapshots.push(snapshot);
        continue;
      }

      const snapshotPath = join(snapshotRoot, `${index}-${snapshot.kind}`);
      if (snapshot.kind === 'directory') {
        await cp(target.path, snapshotPath, { recursive: true });
      } else {
        await mkdir(dirname(snapshotPath), { recursive: true });
        await copyFile(target.path, snapshotPath);
      }

      snapshot.snapshotPath = snapshotPath;
      snapshots.push(snapshot);
    }

    return snapshots;
  }

  private async restoreSnapshots(snapshots: TargetSnapshot[]): Promise<void> {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index];
      if (snapshot === undefined) {
        continue;
      }

      if (!snapshot.existed) {
        await rm(snapshot.target.path, { recursive: true, force: true });
        continue;
      }

      if (snapshot.snapshotPath === undefined) {
        continue;
      }

      await rm(snapshot.target.path, { recursive: true, force: true });
      await mkdir(dirname(snapshot.target.path), { recursive: true });

      if (snapshot.kind === 'directory') {
        await cp(snapshot.snapshotPath, snapshot.target.path, { recursive: true });
      } else {
        await copyFile(snapshot.snapshotPath, snapshot.target.path);
      }
    }
  }

  private async detectTargetKind(targetPath: string): Promise<'file' | 'directory'> {
    try {
      const stats = await lstat(targetPath);
      return stats.isDirectory() ? 'directory' : 'file';
    } catch {
      return 'directory';
    }
  }
}
