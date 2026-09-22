// @lifecycle canonical - Barrel exports for gate-manager service layer.
export {
  ALL_GATE_DATA_KEYS,
  callerSuppliedGateKeys,
  GateFileWriter,
  type GateFileWriterDependencies,
  type GateFileWriteResult,
} from './gate-file-writer.js';
export { GateLifecycleProcessor } from './gate-lifecycle-processor.js';
export { GateDiscoveryProcessor } from './gate-discovery-processor.js';
export { GateVersioningProcessor } from './gate-versioning-processor.js';
