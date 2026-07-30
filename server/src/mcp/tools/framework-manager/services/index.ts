// @lifecycle canonical - Barrel exports for framework-manager services.
export {
  FrameworkFileWriter,
  type FrameworkFileWriterDependencies,
  type ExistingFrameworkData,
  type FrameworkFileResult,
} from './methodology-file-writer.js';
export { FrameworkDraftValidator } from './methodology-validator.js';
export { FrameworkLifecycleProcessor } from './framework-lifecycle-processor.js';
export { FrameworkDiscoveryProcessor } from './framework-discovery-processor.js';
export { FrameworkVersioningProcessor } from './framework-versioning-processor.js';
