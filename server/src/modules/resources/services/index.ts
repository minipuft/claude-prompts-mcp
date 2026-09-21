// @lifecycle canonical - Barrel exports for resource mutation/verification services.
export {
  ResourceVerificationError,
  ResourceVerificationService,
  type ResourceVerificationFailurePayload,
  type ResourceVerificationIssue,
  type ResourceVerificationResult,
  type ResourceVerificationType,
} from './resource-verification-service.js';

export {
  ResourceMutationTransaction,
  type ResourceMutationTarget,
  type ResourceMutationTransactionOptions,
  type ResourceMutationTransactionResult,
  type ResourceWriteCommitOptions,
} from './resource-mutation-transaction.js';
