// @lifecycle canonical - Contract for gate service implementations.
import type { ConvertedPrompt } from '../../execution/types.js';
import type { GateContext } from '../core/gate-definitions.js';

export interface GateEnhancementResult {
  enhancedPrompt: ConvertedPrompt;
  gateInstructionsInjected: boolean;
  injectedGateIds: string[];
  instructionLength?: number;
}

export interface GateServiceConfig {
  enabled: boolean;
}

/**
 * Gate services render guidance into a prompt. They do not evaluate it — evaluation is the
 * `%judge` path, which returns a verdict through `gate_verdict` rather than through this result.
 * `supportsValidation()` is retained because callers branch on it, and it reports `false`.
 */
export interface GateService {
  enhancePrompt(
    prompt: ConvertedPrompt,
    gateIds: string[],
    context: GateContext
  ): Promise<GateEnhancementResult>;

  supportsValidation(): boolean;

  updateConfig(config: Partial<GateServiceConfig>): void;
}
