/**
 * Unit tests for enhanced ConversationManager functionality
 * Testing chain context, step result management, and state validation
 */

import { ConversationManager } from '../../dist/text-references/conversation.js';
import { createSimpleLogger } from '../../dist/logging/index.js';

describe('ConversationManager - Chain Execution Enhancements', () => {
  let conversationManager;
  let logger;

  beforeEach(() => {
    logger = createSimpleLogger();
    conversationManager = new ConversationManager(logger, 50);
  });

  describe('Enhanced Step Result Management', () => {
    test('should store step results with metadata', () => {
      const chainId = 'test-chain-1';
      const stepResult = 'This is a real execution result';
      const metadata = { executionTime: 1500, framework: 'CAGEERF' };

      conversationManager.saveStepResult(chainId, 0, stepResult, false, metadata);

      const resultWithMeta = conversationManager.getStepResultWithMetadata(chainId, 0);
      expect(resultWithMeta).toEqual({
        result: stepResult,
        timestamp: expect.any(Number),
        isPlaceholder: false,
        executionMetadata: metadata
      });

      // Should also work with legacy method
      const legacyResult = conversationManager.getStepResult(chainId, 0);
      expect(legacyResult).toBe(stepResult);
    });

    test('should distinguish between placeholder and real results', () => {
      const chainId = 'test-chain-2';

      // Store a placeholder result
      conversationManager.saveStepResult(chainId, 0, '{{previous_message}}', true);
      
      // Store a real result
      conversationManager.saveStepResult(chainId, 1, 'Detailed analysis of the problem...', false);

      const placeholderMeta = conversationManager.getStepResultWithMetadata(chainId, 0);
      const realMeta = conversationManager.getStepResultWithMetadata(chainId, 1);

      expect(placeholderMeta.isPlaceholder).toBe(true);
      expect(realMeta.isPlaceholder).toBe(false);
    });

    test('should provide chain execution summary', () => {
      const chainId = 'test-chain-summary';
      
      conversationManager.setChainState(chainId, 2, 4);
      conversationManager.saveStepResult(chainId, 0, 'First step result', false);
      conversationManager.saveStepResult(chainId, 1, '{{placeholder}}', true);
      
      const summary = conversationManager.getChainSummary(chainId);
      
      expect(summary).toEqual({
        state: {
          currentStep: 2,
          totalSteps: 4,
          lastUpdated: expect.any(Number)
        },
        completedSteps: 2,
        placeholderSteps: 1,
        realSteps: 1,
        totalResults: 2
      });
    });
  });

  describe('Chain State Validation', () => {
    test('should validate healthy chain state', () => {
      const chainId = 'test-chain-healthy';
      
      conversationManager.setChainState(chainId, 2, 4);
      conversationManager.saveStepResult(chainId, 0, 'Step 0 result');
      conversationManager.saveStepResult(chainId, 1, 'Step 1 result');
      
      const validation = conversationManager.validateChainState(chainId);
      
      expect(validation.valid).toBe(true);
      expect(validation.issues).toBeUndefined();
      expect(validation.recovered).toBeFalsy();
    });

    test('should detect and recover from invalid current step', () => {
      const chainId = 'test-chain-invalid';
      
      // Manually create invalid state (currentStep > totalSteps)
      conversationManager.setChainState(chainId, 5, 3);
      
      const validation = conversationManager.validateChainState(chainId);
      
      expect(validation.valid).toBe(false);
      expect(validation.issues).toContain('Current step 5 exceeds total steps 3');
      expect(validation.recovered).toBe(true);
      
      // Should have auto-corrected the state
      const correctedState = conversationManager.getChainState(chainId);
      expect(correctedState.currentStep).toBe(3);
      expect(correctedState.totalSteps).toBe(3);
    });

    test('should detect stale chain state', () => {
      const chainId = 'test-chain-stale';
      
      // Manually set old timestamp (2 hours ago)
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      conversationManager.setChainState(chainId, 1, 3);
      conversationManager.chainStates[chainId].lastUpdated = twoHoursAgo;
      
      const validation = conversationManager.validateChainState(chainId);
      
      expect(validation.valid).toBe(false);
      expect(validation.issues).toContain('Chain state is stale (>1 hour old)');
    });

    test('should handle missing chain state gracefully', () => {
      const validation = conversationManager.validateChainState('nonexistent-chain');
      
      expect(validation.valid).toBe(false);
      expect(validation.issues).toContain('No chain state found');
    });
  });

  describe('Context Cleanup', () => {
    test('should clear all chain data when clearing context', () => {
      const chainId = 'test-chain-cleanup';
      
      conversationManager.setChainState(chainId, 1, 3);
      conversationManager.saveStepResult(chainId, 0, 'Test result', false);
      
      // Verify data exists
      expect(conversationManager.getChainState(chainId)).toBeDefined();
      expect(conversationManager.getStepResult(chainId, 0)).toBe('Test result');
      expect(conversationManager.getStepResultWithMetadata(chainId, 0)).toBeDefined();
      
      // Clear and verify cleanup
      conversationManager.clearChainContext(chainId);
      
      expect(conversationManager.getChainState(chainId)).toBeUndefined();
      expect(conversationManager.getStepResult(chainId, 0)).toBeUndefined();
      expect(conversationManager.getStepResultWithMetadata(chainId, 0)).toBeUndefined();
    });

    test('should clear all chains when clearing all contexts', () => {
      const chain1 = 'chain-1';
      const chain2 = 'chain-2';
      
      conversationManager.setChainState(chain1, 1, 2);
      conversationManager.setChainState(chain2, 2, 3);
      conversationManager.saveStepResult(chain1, 0, 'Chain 1 result');
      conversationManager.saveStepResult(chain2, 0, 'Chain 2 result');
      
      conversationManager.clearAllChainContexts();
      
      expect(conversationManager.getChainState(chain1)).toBeUndefined();
      expect(conversationManager.getChainState(chain2)).toBeUndefined();
      expect(conversationManager.getStepResult(chain1, 0)).toBeUndefined();
      expect(conversationManager.getStepResult(chain2, 0)).toBeUndefined();
    });
  });

  describe('Integration with Legacy Interface', () => {
    test('should maintain compatibility with existing saveStepResult calls', () => {
      const chainId = 'test-legacy';
      
      // Legacy call without placeholder flag
      conversationManager.saveStepResult(chainId, 0, 'Legacy result');
      
      const result = conversationManager.getStepResult(chainId, 0);
      const resultWithMeta = conversationManager.getStepResultWithMetadata(chainId, 0);
      
      expect(result).toBe('Legacy result');
      expect(resultWithMeta.result).toBe('Legacy result');
      expect(resultWithMeta.isPlaceholder).toBe(false); // Default value
    });
  });
});