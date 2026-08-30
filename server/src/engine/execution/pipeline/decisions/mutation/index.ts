// @lifecycle canonical - Public exports for the P4 adaptive chain-mutation decision.

export { decideMutation } from './mutation-policy.js';
export {
  decideInterrupt,
  isInterruptResolutionAction,
  isUnknownInterruptPending,
} from './interrupt-policy.js';

export { MAX_INSERTIONS_PER_RUN, UNKNOWN_INTERRUPT_GATE_ID } from './types.js';
export type {
  ChainInterrupt,
  ChainMutation,
  DecideInterruptInput,
  DecideMutationInput,
  InterruptResolutionAction,
  InterruptNodeSummary,
  MutationNoneReason,
} from './types.js';
