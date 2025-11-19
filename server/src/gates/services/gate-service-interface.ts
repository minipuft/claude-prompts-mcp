// @lifecycle canonical - Contract for gate service implementations.
import type { ConvertedPrompt } from '../../types/index.js';
import type { GateContext } from '../core/gate-definitions.js';

export interface GateValidationResult {
  gateId: string;
  passed: boolean;
  score?: number;
  feedback?: string;
  validatedBy: 'compositional' | 'semantic';
  timestamp: number;
}

export interface GateEnhancementResult {
  enhancedPrompt: ConvertedPrompt;
  gateInstructionsInjected: boolean;
  injectedGateIds: string[];
  instructionLength?: number;
  validationResults?: GateValidationResult[];
}

export interface GateServiceConfig {
  enabled: boolean;
  llmIntegration?: {
    enabled: boolean;
    apiKey?: string;
    endpoint?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
}

export interface IGateService {
  readonly serviceType: 'compositional' | 'semantic';

  enhancePrompt(
    prompt: ConvertedPrompt,
    gateIds: string[],
    context: GateContext
  ): Promise<GateEnhancementResult>;

  supportsValidation(): boolean;

  updateConfig(config: Partial<GateServiceConfig>): void;
}
