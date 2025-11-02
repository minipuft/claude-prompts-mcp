
# Framework Operator Comprehensive Test Implementation Plan

## Overview

This document provides a detailed implementation plan for comprehensive testing of the Framework Operator functionality, following the priority order outlined in the original test plan. Each test case includes specific scenarios, expected outcomes, and implementation details.

## Priority Order
1. **High Priority (Day 1)**: Phase 1 (Parser Unit Tests), Phase 3 (Multi-step Chain Persistence), Phase 5 (Error Handling)
2. **Medium Priority (Day 2)**: Phase 2 (Executor Edge Cases), Phase 4 (Complex Compositions)
3. **Low Priority (If Time)**: Phase 6 (CLI Validation)

---

## Phase 1: Parser Unit Tests (Extend existing symbolic-command-parser.test.ts)

**File**: `server/tests/unit/symbolic-command-parser.test.ts`
**Estimated Time**: 2 hours
**Current Coverage**: Basic framework detection exists, missing comprehensive edge cases

### 1.1 Framework Prefix Detection Tests (3 test cases)

#### Test Case 1.1.1: Basic @FRAMEWORK Detection
```typescript
test('detects @FRAMEWORK prefix at start of command', () => {
  const result = parser.detectOperators('@REACT >>analyze');
  
  expect(result.hasOperators).toBe(true);
  expect(result.operatorTypes).toContain('framework');
  const frameworkOp = result.operators.find((op) => op.type === 'framework');
  expect(frameworkOp).toBeDefined();
  if (frameworkOp && frameworkOp.type === 'framework') {
    expect(frameworkOp.frameworkId).toBe('REACT');
    expect(frameworkOp.normalizedId).toBe('REACT');
  }
});
```

#### Test Case 1.1.2: Framework Prefix with Whitespace Variations
```typescript
test('detects @FRAMEWORK with various whitespace patterns', () => {
  const testCases = [
    '@REACT>>analyze',           // no space
    '@REACT >>analyze',          // single space
    '@REACT  >>analyze',         // multiple spaces
    '@REACT\t>>analyze',         // tab character
    '@REACT \t >>analyze',       // mixed whitespace
  ];

  testCases.forEach(command => {
    const result = parser.detectOperators(command);
    expect(result.operatorTypes).toContain('framework');
    const frameworkOp = result.operators.find((op) => op.type === 'framework');
    if (frameworkOp && frameworkOp.type === 'framework') {
      expect(frameworkOp.frameworkId).toBe('REACT');
    }
  });
});
```

#### Test Case 1.1.3: No Framework Prefix Detection
```typescript
test('does not detect framework when @ prefix is absent', () => {
  const result = parser.detectOperators('>>analyze --> summarize');
  
  expect(result.operatorTypes).not.toContain('framework');
  const frameworkOp = result.operators.find((op) => op.type === 'framework');
  expect(frameworkOp).toBeUndefined();
});
```

### 1.2 Framework ID Extraction and Normalization Tests (3 test cases)

#### Test Case 1.2.1: Uppercase Normalization
```typescript
test('normalizes framework ID to uppercase', () => {
  const testCases = [
    { input: '@react', expected: 'REACT' },
    { input: '@React', expected: 'REACT' },
    { input: '@REACT', expected: 'REACT' },
    { input: '@ReAcT', expected: 'REACT' },
  ];

  testCases.forEach(({ input, expected }) => {
    const result = parser.detectOperators(input);
    const frameworkOp = result.operators.find((op) => op.type === 'framework');
    if (frameworkOp && frameworkOp.type === 'framework') {
      expect(frameworkOp.normalizedId).toBe(expected);
    }
  });
});
```

#### Test Case 1.2.2: Framework ID with Numbers and Underscores
```typescript
test('handles framework IDs with numbers and underscores', () => {
  const testCases = [
    { input: '@framework_v2', expected: 'FRAMEWORK_V2' },
    { input: '@test123', expected: 'TEST123' },
    { input: '@my_framework_1', expected: 'MY_FRAMEWORK_1' },
  ];

  testCases.forEach(({ input, expected }) => {
    const result = parser.detectOperators(input);
    const frameworkOp = result.operators.find((op) => op.type === 'framework');
    if (frameworkOp && frameworkOp.type === 'framework') {
      expect(frameworkOp.normalizedId).toBe(expected);
      expect(frameworkOp.frameworkId).toBe(input.substring(1).split(' ')[0]);
    }
  });
});
```

#### Test Case 1.2.3: Framework ID Boundary Detection
```typescript
test('correctly identifies framework ID boundaries', () => {
  const result = parser.detectOperators('@REACT-SPECIAL >>analyze');
  const frameworkOp = result.operators.find((op) => op.type === 'framework');
  
  if (frameworkOp && frameworkOp.type === 'framework') {
    expect(frameworkOp.frameworkId).toBe('REACT-SPECIAL');
    expect(frameworkOp.normalizedId).toBe('REACT-SPECIAL');
  }
});
```

### 1.3 Case-Insensitive Input Handling Tests (2 test cases)

#### Test Case 1.3.1: Mixed Case Framework Names
```typescript
test('handles mixed case framework names consistently', () => {
  const commands = [
    '@react >>step1',
    '@React >>step1', 
    '@REACT >>step1',
    '@ReAcT >>step1',
  ];

  const results = commands.map(cmd => parser.detectOperators(cmd));
  
  // All should produce the same normalized result
  results.forEach(result => {
    const frameworkOp = result.operators.find((op) => op.type === 'framework');
    if (frameworkOp && frameworkOp.type === 'framework') {
      expect(frameworkOp.normalizedId).toBe('REACT');
      expect(frameworkOp.temporary).toBe(true);
      expect(frameworkOp.scopeType).toBe('execution');
    }
  });
});
```

#### Test Case 1.3.2: Case Preservation in Original ID
```typescript
test('preserves original case in frameworkId property', () => {
  const testCases = [
    { input: '@react', original: 'react' },
    { input: '@React', original: 'React' },
    { input: '@REACT', original: 'REACT' },
  ];

  testCases.forEach(({ input, original }) => {
    const result = parser.detectOperators(input);
    const frameworkOp = result.operators.find((op) => op.type === 'framework');
    if (frameworkOp && frameworkOp.type === 'framework') {
      expect(frameworkOp.frameworkId).toBe(original);
      expect(frameworkOp.normalizedId).toBe('REACT');
    }
  });
});
```

### 1.4 Combined Operators Parsing Tests (3 test cases)

#### Test Case 1.4.1: Framework + Chain + Gate Combination
```typescript
test('parses framework + chain + gate combination correctly', () => {
  const command = '@CAGEERF >>step1 input="test" --> step2 :: "quality check"';
  const result = parser.detectOperators(command);
  
  expect(result.operatorTypes).toEqual(expect.arrayContaining(['framework', 'chain', 'gate']));
  expect(result.operators).toHaveLength(3);
  
  const frameworkOp = result.operators.find((op) => op.type === 'framework');
  const chainOp = result.operators.find((op) => op.type === 'chain');
  const gateOp = result.operators.find((op) => op.type === 'gate');
  
  // Framework validation
  if (frameworkOp && frameworkOp.type === 'framework') {
    expect(frameworkOp.normalizedId).toBe('CAGEERF');
  }
  
  // Chain validation
  if (chainOp && chainOp.type === 'chain') {
    expect(chainOp.steps).toHaveLength(2);
    expect(chainOp.steps[0].promptId).toBe('step1');
    expect(chainOp.steps[1].promptId).toBe('step2');
  }
  
  // Gate validation
  if (gateOp && gateOp.type === 'gate') {
    expect(gateOp.criteria).toBe('quality check');
    expect(gateOp.parsedCriteria).toEqual(['quality check']);
  }
});
```

#### Test Case 1.4.2: Framework with Complex Chain Arguments
```typescript
test('handles framework with complex chain arguments containing special chars', () => {
  const command = '@REACT >>analyze text="data --> analysis" --> summarize criteria="comprehensive"';
  const result = parser.detectOperators(command);
  
  const chainOp = result.operators.find((op) => op.type === 'chain');
  if (chainOp && chainOp.type === 'chain') {
    expect(chainOp.steps).toHaveLength(2);
    expect(chainOp.steps[0].args).toBe('text="data --> analysis"');
    expect(chainOp.steps[1].args).toBe('criteria="comprehensive"');
  }
});
```

#### Test Case 1.4.3: Multiple Framework Detection (Error Case)
```typescript
test('handles multiple framework prefixes gracefully', () => {
  const command = '@REACT @CAGEERF >>analyze';
  
  // Should detect first framework only
  const result = parser.detectOperators(command);
  const frameworkOps = result.operators.filter((op) => op.type === 'framework');
  expect(frameworkOps).toHaveLength(1);
  expect(frameworkOps[0] && frameworkOps[0].type === 'framework' ? frameworkOps[0].normalizedId : undefined).toBe('REACT');
});
```

### 1.5 Framework Prefix Stripping Tests (2 test cases)

#### Test Case 1.5.1: Framework Prefix Removal in Chain Parsing
```typescript
test('strips framework prefix before chain parsing', () => {
  const parser = createSymbolicCommandParser(mockLogger);
  const chainOp = parser['parseChainOperator']('@REACT >>step1 --> step2');
  
  expect(chainOp.steps).toHaveLength(2);
  expect(chainOp.steps[0].promptId).toBe('step1');
  expect(chainOp.steps[1].promptId).toBe('step2');
  // Should not include @REACT in any step
  expect(chainOp.steps[0].promptId).not.toContain('@');
  expect(chainOp.steps[1].promptId).not.toContain('@');
});
```

#### Test Case 1.5.2: Framework Prefix with Arguments
```typescript
test('strips framework prefix with arguments correctly', () => {
  const parser = createSymbolicCommandParser(mockLogger);
  const chainOp = parser['parseChainOperator']('@REACT >>analyze data="test" --> summarize');
  
  expect(chainOp.steps[0].promptId).toBe('analyze');
  expect(chainOp.steps[0].args).toBe('data="test"');
  expect(chainOp.steps[1].promptId).toBe('summarize');
});
```

### 1.6 Quoted Arguments Preservation Tests (2 test cases)

#### Test Case 1.6.1: Special Characters in Quoted Arguments
```typescript
test('preserves quoted arguments containing special characters', () => {
  const command = '@REACT >>analyze text="data --> contains --> arrows" :: "check --> arrows"';
  const result = parser.detectOperators(command);
  
  const chainOp = result.operators.find((op) => op.type === 'chain');
  if (chainOp && chainOp.type === 'chain') {
    expect(chainOp.steps[0].args).toBe('text="data --> contains --> arrows"');
    // Should not split on quoted arrows
    expect(chainOp.steps).toHaveLength(1);
  }
  
  const gateOp = result.operators.find((op) => op.type === 'gate');
  if (gateOp && gateOp.type === 'gate') {
    expect(gateOp.criteria).toBe('check --> arrows');
  }
});
```

#### Test Case 1.6.2: Escaped Quotes in Arguments
```typescript
test('handles escaped quotes in arguments', () => {
  const command = '@REACT >>analyze text="He said \\"hello\\" to the world"';
  const result = parser.detectOperators(command);
  
  const chainOp = result.operators.find((op) => op.type === 'chain');
  if (chainOp && chainOp.type === 'chain') {
    expect(chainOp.steps[0].args).toBe('text="He said \\"hello\\" to the world"');
  }
});
```

---

## Phase 2: Executor Unit Tests (Extend existing framework-operator-executor.test.ts)

**File**: `server/tests/unit/framework-operator-executor.test.ts`
**Estimated Time**: 1.5 hours
**Current Coverage**: Basic apply/restore, error handling exists

### 2.1 No-op Case When Framework Manager Unavailable (2 test cases)

#### Test Case 2.1.1: Framework Manager Null/Undefined
```typescript
test('handles null/undefined framework manager gracefully', async () => {
  const executor = new FrameworkOperatorExecutor(null as any, logger);
  
  await expect(
    executor.executeWithFramework(frameworkOperator, async () => 'result')
  ).rejects.toThrow(/Cannot read properties of null/);
});
```

#### Test Case 2.1.2: Framework Manager Methods Missing
```typescript
test('handles framework manager with missing methods', async () => {
  const incompleteManager = {} as FrameworkStateManager;
  const executor = new FrameworkOperatorExecutor(incompleteManager, logger);
  
  await expect(
    executor.executeWithFramework(frameworkOperator, async () => 'result')
  ).rejects.toThrow(/isFrameworkSystemEnabled/);
});
```

### 2.2 Guard Condition Tests (2 test cases)

#### Test Case 2.2.1: Skip Restore If Never Applied
```typescript
test('skips restoration if framework was never applied', async () => {
  // Mock framework system disabled during apply
  isFrameworkSystemEnabledMock.mockReturnValueOnce(false);
  
  const executor = new FrameworkOperatorExecutor(frameworkStateManager, logger);
  
  await expect(
    executor.executeWithFramework(frameworkOperator, async () => 'result')
  ).rejects.toThrow('Framework overrides are disabled');
  
  // Should not attempt restoration
  expect(switchFrameworkMock).toHaveBeenCalledTimes(0);
});
```

#### Test Case 2.2.2: Skip Restore If No Original Framework
```typescript
test('skips restoration if no original framework exists', async () => {
  getActiveFrameworkMock.mockReturnValueOnce(null); // No original framework
  
  const executor = new FrameworkOperatorExecutor(frameworkStateManager, logger);
  
  const result = await executor.executeWithFramework(frameworkOperator, async () => 'success');
  
  expect(result).toBe('success');
  
  // Should apply framework but not restore
  expect(switchFrameworkMock).toHaveBeenCalledTimes(1);
  expect(switchFrameworkMock).toHaveBeenCalledWith(
    expect.objectContaining({ targetFramework: 'REACT' })
  );
});
```

### 2.3 State Cleanup Tests (2 test cases)

#### Test Case 2.3.1: State Cleanup on Successful Execution
```typescript
test('cleans up state after successful execution', async () => {
  const executor = new FrameworkOperatorExecutor(frameworkStateManager, logger);
  
  await executor.executeWithFramework(frameworkOperator, async () => 'success');
  
  // Access private state through type assertion for testing
  const privateExecutor = executor as any;
  expect(privateExecutor.originalFramework).toBeNull();
  expect(privateExecutor.overrideActive).toBe(false);
});
```

#### Test Case 2.3.2: State Cleanup on Failed Execution
```typescript
test('cleans up state after failed execution', async () => {
  const executor = new FrameworkOperatorExecutor(frameworkStateManager, logger);
  
  await expect(
    executor.executeWithFramework(frameworkOperator, async () => {
      throw new Error('Execution failed');
    })
  ).rejects.toThrow('Execution failed');
  
  // State should still be cleaned up
  const privateExecutor = executor as any;
  expect(privateExecutor.originalFramework).toBeNull();
  expect(privateExecutor.overrideActive).toBe(false);
});
```

### 2.4 Concurrent Execution Scenarios (2 test cases)

#### Test Case 2.4.1: Multiple Concurrent Framework Overrides
```typescript
test('handles concurrent framework overrides correctly', async () => {
  const executor = new FrameworkOperatorExecutor(frameworkStateManager, logger);
  
  const reactOperator: FrameworkOperator = {
    type: 'framework',
    frameworkId: 'react',
    normalizedId: 'REACT',
    temporary: true,
    scopeType: 'execution'
  };
  
  const vueOperator: FrameworkOperator = {
    type: 'framework',
    frameworkId: 'vue',
    normalizedId: 'VUE',
    temporary: true,
    scopeType: 'execution'
  };
  
  // Execute both concurrently
  const [reactResult, vueResult] = await Promise.all([
    executor.executeWithFramework(reactOperator, async () => 'react-result'),
    executor.executeWithFramework(vueOperator, async () => 'vue-result')
  ]);
  
  expect(reactResult).toBe('react-result');
  expect(vueResult).toBe('vue-result');
  
  // Each should have proper apply/restore cycles
  expect(switchFrameworkMock).toHaveBeenCalledTimes(4); // 2 applies + 2 restores
});
```

#### Test Case 2.4.2: Nested Framework Overrides
```typescript
test('handles nested framework overrides', async () => {
  const executor = new FrameworkOperatorExecutor(frameworkStateManager, logger);
  
  const outerOperator: FrameworkOperator = {
    type: 'framework',
    frameworkId: 'react',
    normalizedId: 'REACT',
    temporary: true,
    scopeType: 'execution'
  };
  
  const innerOperator: FrameworkOperator = {
    type: 'framework',
    frameworkId: 'vue',
    normalizedId: 'VUE',
    temporary: true,
    scopeType: 'execution'
  };
  
  const result = await executor.executeWithFramework(outerOperator, async () => {
    return await executor.executeWithFramework(innerOperator, async () => 'nested-result');
  });
  
  expect(result).toBe('nested-result');
  
  // Should have proper nesting: CAGEERF -> REACT -> VUE -> REACT -> CAGEERF
  expect(switchFrameworkMock).toHaveBeenCalledTimes(4);
  expect(switchFrameworkMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ targetFramework: 'REACT' }));
  expect(switchFrameworkMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ targetFramework: 'VUE' }));
  expect(switchFrameworkMock).toHaveBeenNthCalledWith(3, expect.objectContaining({ targetFramework: 'REACT' }));
  expect(switchFrameworkMock).toHaveBeenNthCalledWith(4, expect.objectContaining({ targetFramework: 'CAGEERF' }));
});
```

---

## Phase 3: Integration Tests - Multi-Step Chains (NEW)

**File**: `server/tests/integration/framework-chain-integration.test.ts` (new file)
**Estimated Time**: 3 hours
**Critical Gap**: Currently missing tests for framework persistence across chain steps

### 3.1 Framework Persistence Across Chain Steps (2 test cases)

#### Test Case 3.1.1: Framework Context Persists Through All Chain Steps
```typescript
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createConsolidatedPromptEngine } from '../../src/mcp-tools/prompt-engine/index.js';
import { MockLogger, MockMcpServer, cleanupPromptEngine } from '../helpers/test-helpers.js';

describe('Framework Chain Integration', () => {
  let logger: MockLogger;
  let mockMcpServer: MockMcpServer;
  let promptEngine: any;
  let frameworkContextSpy: jest.Mock;

  beforeEach(() => {
    logger = new MockLogger();
    mockMcpServer = new MockMcpServer();
    
    // Mock framework manager to track context usage
    frameworkContextSpy = jest.fn();
    
    const mockFrameworkManager = {
      getCurrentFramework: () => ({ frameworkId: 'CAGEERF', frameworkName: 'CAGEERF' }),
      generateExecutionContext: (frameworkId: string) => {
        frameworkContextSpy(frameworkId);
        return {
          systemPrompt: `test system prompt for ${frameworkId}`,
          framework: frameworkId
        };
      }
    };

    const mockFrameworkStateManager = {
      switchFramework: jest.fn().mockResolvedValue(true),
      getActiveFramework: jest.fn(() => ({ id: 'CAGEERF' })),
      isFrameworkSystemEnabled: jest.fn(() => true)
    };

    // Setup prompt engine with framework mocks
    // ... (similar setup to existing integration tests)
    
    promptEngine.setFrameworkManager(mockFrameworkManager as any);
    promptEngine.setFrameworkStateManager(mockFrameworkStateManager as any);
  });

  test('framework context persists through all chain steps', async () => {
    const command = '@REACT >>step1 data="test" --> step2 --> step3';
    
    // Execute first step
    const firstResponse = await promptEngine.executePromptCommand({ command }, {});
    expect(firstResponse.isError).toBeFalsy();
    
    // Execute second step
    const secondResponse = await promptEngine.executePromptCommand(
      { command },
      { previous_step_output: 'step1 result' }
    );
    expect(secondResponse.isError).toBeFalsy();
    
    // Execute third step
    const thirdResponse = await promptEngine.executePromptCommand(
      { command },
      { previous_step_output: 'step2 result' }
    );
    expect(thirdResponse.isError).toBeFalsy();
    
    // Framework context should be used in all steps
    expect(frameworkContextSpy).toHaveBeenCalledTimes(3);
    expect(frameworkContextSpy).toHaveBeenCalledWith('REACT');
    
    // Final response should indicate completion
    expect(thirdResponse.content[0].text).toContain('✓ Chain complete (3/3).');
  });
});
```

#### Test Case 3.1.2: Framework Context Isolation Between Chains
```typescript
test('framework context is isolated between different chain sessions', async () => {
  const command1 = '@REACT >>chain1_step1 --> chain1_step2';
  const command2 = '@VUE >>chain2_step1 --> chain2_step2';
  
  // Execute first chain
  const chain1Step1 = await promptEngine.executePromptCommand({ command: command1 }, {});
  expect(chain1Step1.isError).toBeFalsy();
  
  const chain1Step2 = await promptEngine.executePromptCommand(
    { command: command1 },
    { previous_step_output: 'chain1 result' }
  );
  expect(chain1Step2.isError).toBeFalsy();
  
  // Execute second chain (different framework)
  const chain2Step1 = await promptEngine.executePromptCommand({ command: command2 }, {});
  expect(chain2Step1.isError).toBeFalsy();
  
  const chain2Step2 = await promptEngine.executePromptCommand(
    { command: command2 },
    { previous_step_output: 'chain2 result' }
  );
  expect(chain2Step2.isError).toBeFalsy();
  
  // Should have correct framework contexts
  expect(frameworkContextSpy).toHaveBeenNthCalledWith(1, 'REACT');
  expect(frameworkContextSpy).toHaveBeenNthCalledWith(2, 'REACT');
  expect(frameworkContextSpy).toHaveBeenNthCalledWith(3, 'VUE');
  expect(frameworkContextSpy).toHaveBeenNthCalledWith(4, 'VUE');
});
```

### 3.2 Framework Context in Step Rendering (2 test cases)

#### Test Case 3.2.1: Framework System Prompt Injection
```typescript
test('framework system prompt is injected into each chain step', async () => {
  const command = '@REACT >>analyze --> summarize';
  
  const systemPromptSpy = jest.fn();
  const mockPromptManager = {
    // ... other methods
    processTemplateAsync: (template: string, context: any) => {
      systemPromptSpy(context.systemPrompt);
      return Promise.resolve('mocked template result');
    }
  };
  
  // Setup prompt engine with spy
  // ... setup code
  
  const firstResponse = await promptEngine.executePromptCommand({ command }, {});
  expect(firstResponse.isError).toBeFalsy();
  
  const secondResponse = await promptEngine.executePromptCommand(
    { command },
    { previous_step_output: 'analysis result' }
  );
  expect(secondResponse.isError).toBeFalsy();
  
  // Both steps should have REACT framework context
  expect(systemPromptSpy).toHaveBeenCalledTimes(2);
  expect(systemPromptSpy).toHaveBeenCalledWith(expect.stringContaining('REACT'));
});
```

#### Test Case 3.2.2: Framework Metadata in Response
```typescript
test('framework metadata is included in response metadata', async () => {
  const command = '@REACT >>analyze data="test"';
  
  const response = await promptEngine.executePromptCommand({ command }, {});
  expect(response.isError).toBeFalsy();
  
  // Check that framework metadata is included
  expect(response.metadata).toBeDefined();
  expect(response.metadata.frameworkOverride).toBe('REACT');
  expect(response.metadata.originalFramework).toBe('CAGEERF');
});
```

### 3.3 Restoration Timing Validation (1 test case)

#### Test Case 3.3.1: Restoration Happens After Chain Completion
```typescript
test('framework restoration happens after chain completion, not per step', async () => {
  const command = '@REACT >>step1 --> step2';
  const restoreSpy = jest.fn();
  
  const mockFrameworkStateManager = {
    switchFramework: jest.fn((params) => {
      if (params.reason.includes('Restoring')) {
        restoreSpy();
      }
      return Promise.resolve(true);
    }),
    getActiveFramework: jest.fn(() => ({ id: 'CAGEERF' })),
    isFrameworkSystemEnabled: jest.fn(() => true)
  };
  
  // Setup with spy
  // ... setup code
  
  // Execute first step
  const firstResponse = await promptEngine.executePromptCommand({ command }, {});
  expect(firstResponse.isError).toBeFalsy();
  
  // Should not have restored yet
  expect(restoreSpy).not.toHaveBeenCalled();
  
  // Execute second step (completes chain)
  const secondResponse = await promptEngine.executePromptCommand(
    { command },
    { previous_step_output: 'step1 result' }
  );
  expect(secondResponse.isError).toBeFalsy();
  
  // Should restore after chain completion
  expect(restoreSpy).toHaveBeenCalledTimes(1);
});
```

### 3.4 Session Resumption with Framework (1 test case)

#### Test Case 3.4.1: Framework Override Persists Across Session Resumption
```typescript
test('framework override persists when resuming chain session', async () => {
  const command = '@REACT >>step1 --> step2 --> step3';
  
  // Start chain and get session info
  const firstResponse = await promptEngine.executePromptCommand({ command }, {});
  expect(firstResponse.isError).toBeFalsy();
  
  const sessionMatch = firstResponse.content[0].text.match(/Session ID: ([^\n]+)/);
  const sessionId = sessionMatch ? sessionMatch[1] : '';
  
  // Simulate session pause/resume by creating new engine instance
  const resumedEngine = createConsolidatedPromptEngine(/* ... same setup ... */);
  
  // Resume with same command but different engine instance
  const resumedResponse = await resumedEngine.executePromptCommand(
    { command },
    { previous_step_output: 'resumed result', session_id: sessionId }
  );
  expect(resumedResponse.isError).toBeFalsy();
  
  // Framework context should still be active
  expect(frameworkContextSpy).toHaveBeenCalledWith('REACT');
});
```

---

## Phase 4: Integration Tests - Complex Compositions (EXTEND)

**File**: `server/tests/integration/symbolic-chain-integration.test.ts` (extend existing)
**Estimated Time**: 2 hours

### 4.1 Framework + Chain + Gate Combinations (2 test cases)

#### Test Case 4.1.1: @CAGEERF >>step1 --> step2 :: "criteria" Combination
```typescript
test('executes framework + chain + gate combination correctly', async () => {
  const gateSystem = promptEngine.getLightweightGateSystem();
  const createGateSpy = jest.spyOn(gateSystem, 'createTemporaryGate').mockReturnValue('test_gate');
  const validateSpy = jest.spyOn(gateSystem, 'validateContent').mockResolvedValue([
    { gateId: 'test_gate', passed: true, retryHints: [] },
  ]);

  const command = '@CAGEERF >>analyze data="test" --> summarize :: "comprehensive analysis"';
  
  const response = await promptEngine.executePromptCommand({ command }, {});
  expect(response.isError).toBeFalsy();
  
  // Should have framework context
  expect(frameworkContextSpy).toHaveBeenCalledWith('CAGEERF');
  
  // Should have gate validation
  expect(createGateSpy).toHaveBeenCalled();
  expect(validateSpy).toHaveBeenCalled();
  
  const structured = response.structuredContent?.gateValidation;
  expect(structured).toBeDefined();
  expect(structured.passed).toBe(true);
  
  createGateSpy.mockRestore();
  validateSpy.mockRestore();
});
```

#### Test Case 4.1.2: Multiple Frameworks in Complex Chain
```typescript
test('handles multiple framework switches in complex chain', async () => {
  const command = '@REACT >>analyze --> @VUE >>refine --> @REACT >>finalize :: "quality check"';
  
  // This should be handled as first framework applies to entire chain
  // Subsequent @framework should be treated as arguments, not operators
  const result = parser.detectOperators(command);
  
  expect(result.operatorTypes).toEqual(['framework', 'chain', 'gate']);
  expect(result.operators.filter(op => op.type === 'framework')).toHaveLength(1);
  
  const frameworkOp = result.operators.find(op => op.type === 'framework');
  if (frameworkOp && frameworkOp.type === 'framework') {
    expect(frameworkOp.normalizedId).toBe('REACT');
  }
});
```

### 4.2 Framework Context in Gate Validation (1 test case)

#### Test Case 4.2.1: Gate Validation Uses Framework Context
```typescript
test('gate validation receives framework context', async () => {
  const gateSystem = promptEngine.getLightweightGateSystem();
  const validateSpy = jest.spyOn(gateSystem, 'validateContent').mockResolvedValue([
    { gateId: 'framework_gate', passed: true, retryHints: [] },
  ]);

  const command = '@REACT >>analyze :: "react-specific validation"';
  
  const response = await promptEngine.executePromptCommand({ command }, {});
  expect(response.isError).toBeFalsy();
  
  // Gate validation should receive framework context
  expect(validateSpy).toHaveBeenCalledWith(
    ['framework_gate'],
    expect.any(String),
    expect.objectContaining({
      metadata: expect.objectContaining({
        frameworkOverride: 'REACT',
        executionId: expect.any(String)
      })
    })
  );
  
  validateSpy.mockRestore();
});
```

### 4.3 Error Handling in Complex Compositions (2 test cases)

#### Test Case 4.3.1: Error in Chain Step Preserves Framework Restoration
```typescript
test('error in chain step still restores framework', async () => {
  const mockPromptManager = {
    processTemplateAsync: jest.fn()
      .mockResolvedValueOnce('step1 success')
      .mockRejectedValueOnce(new Error('step2 failed'))
  };
  
  // Setup with failing step
  // ... setup code
  
  const command = '@REACT >>step1 --> step2';
  
  // Execute first step successfully
  const firstResponse = await promptEngine.executePromptCommand({ command }, {});
  expect(firstResponse.isError).toBeFalsy();
  
  // Second step should fail but restore framework
  const secondResponse = await promptEngine.executePromptCommand(
    { command },
    { previous_step_output: 'step1 result' }
  );
  expect(secondResponse.isError).toBeTruthy();
  expect(secondResponse.error).toContain('step2 failed');
  
  // Framework should still be restored
  const restoreCalls = switchFrameworkMock.mock.calls.filter(call =>
    call[0].reason.includes('Restoring')
  );
  expect(restoreCalls.length).toBeGreaterThan(0);
});
```

#### Test Case 4.3.2: Invalid Framework with Chain Early Error
```typescript
test('invalid framework with chain produces early error before session start', async () => {
  const mockFrameworkStateManager = {
    switchFramework: jest.fn().mockResolvedValue(false), // Fail framework switch
    getActiveFramework: jest.fn(() => ({ id: 'CAGEERF' })),
    isFrameworkSystemEnabled: jest.fn(() => true)
  };
  
  // Setup with failing framework manager
  // ... setup code
  
  const command = '@INVALID_FRAMEWORK >>step1 --> step2';
  
  const response = await promptEngine.executePromptCommand({ command }, {});
  expect(response.isError).toBeTruthy();
  expect(response.error).toContain('INVALID_FRAMEWORK');
  
  // Should not start chain session
  expect(response.content[0].text).not.toContain('Session ID:');
  expect(response.content[0].text).not.toContain('Chain ID:');
});
```

---

## Phase 5: Error Path Tests (NEW)

**File**: `server/tests/integration/framework-error-handling.test.ts` (new file)
**Estimated Time**: 2.5 hours

### 5.1 Framework System Disabled Scenarios (1 test case)

#### Test Case 5.1.1: Clear Error Message When System Disabled
```typescript
import { describe, test, expect, beforeEach, jest } from '@jest/globals';

describe('Framework Error Handling', () => {
  let promptEngine: any;
  let logger: any;

  beforeEach(() => {
    logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    
    const mockFrameworkStateManager = {
      switchFramework: jest.fn(),
      getActiveFramework: jest.fn(() => ({ id: 'CAGEERF' })),
      isFrameworkSystemEnabled: jest.fn(() => false) // System disabled
    };
    
    // Setup prompt engine with disabled framework system
    // ... setup code
  });

  test('framework system disabled produces clear error message', async () => {
    const command = '@REACT >>analyze';
    
    const response = await promptEngine.executePromptCommand({ command }, {});
    
    expect(response.isError).toBeTruthy();
    expect(response.error).toContain('Framework overrides are disabled');
    expect(response.error).toContain('Enable the framework system');
    expect(response.error).toContain('@REACT');
  });
});
```

### 5.2 Invalid Framework Name Handling (1 test case)

#### Test Case 5.2.1: Suggestions in Error for Invalid Framework
```typescript
test('invalid framework name provides suggestions in error', async () => {
  const mockFrameworkManager = {
    getAvailableFrameworks: jest.fn(() => [
      { id: 'REACT', name: 'React' },
      { id: 'VUE', name: 'Vue.js' },
      { id: 'CAGEERF', name: 'CAGEERF' }
    ]),
    getCurrentFramework: jest.fn(() => ({ frameworkId: 'CAGEERF' })),
    generateExecutionContext: jest.fn()
  };
  
  // Setup with framework manager that has available frameworks
  // ... setup code
  
  const command = '@REACTT >>analyze'; // Typo: REACTT instead of REACT
  
  const response = await promptEngine.executePromptCommand({ command }, {});
  
  expect(response.isError).toBeTruthy();
  expect(response.error).toContain('REACTT');
  expect(response.error).toContain('Did you mean');
  expect(response.error).toContain('REACT');
});
```

### 5.3 Restoration Failure After Success (1 test case)

#### Test Case 5.3.1: Surfaces Error When Restoration Fails After Success
```typescript
test('restoration failure after successful execution surfaces error', async () => {
  const mockFrameworkStateManager = {
    switchFramework: jest.fn()
      .mockResolvedValueOnce(true) // Apply succeeds
      .mockResolvedValueOnce(false), // Restore fails
    getActiveFramework: jest.fn(() => ({ id: 'CAGEERF' })),
    isFrameworkSystemEnabled: jest.fn(() => true)
  };
  
  // Setup with failing restoration
  // ... setup code
  
  const command = '@REACT >>analyze';
  
  const response = await promptEngine.executePromptCommand({ command }, {});
  
  expect(response.isError).toBeTruthy();
  expect(response.error).toContain('Unable to restore framework');
  expect(response.error).toContain('CAGEERF');
  
  // Should log error
  expect(logger.error).toHaveBeenCalledWith(
    expect.stringContaining('Failed to restore framework after override'),
    expect.any(Object)
  );
});
```

### 5.4 Restoration Failure After Execution Error (1 test case)

#### Test Case 5.4.1: Logs Restoration Failure But Preserves Original Error
```typescript
test('restoration failure after execution error logs but preserves original', async () => {
  const mockPromptManager = {
    processTemplateAsync: jest.fn().mockRejectedValue(new Error('Execution failed'))
  };
  
  const mockFrameworkStateManager = {
    switchFramework: jest.fn()
      .mockResolvedValueOnce(true) // Apply succeeds
      .mockResolvedValueOnce(false), // Restore fails
    getActiveFramework: jest.fn(() => ({ id: 'CAGEERF' })),
    isFrameworkSystemEnabled: jest.fn(() => true)
  };
  
  // Setup with both execution and restoration failure
  // ... setup code
  
  const command = '@REACT >>analyze';
  
  const response = await promptEngine.executePromptCommand({ command }, {});
  
  expect(response.isError).toBeTruthy();
  expect(response.error).toContain('Execution failed'); // Original error
  expect(response.error).not.toContain('restore'); // Should not surface restoration error
  
  // But should log restoration failure
  expect(logger.error).toHaveBeenCalledWith(
    expect.stringContaining('Failed to restore framework after symbolic execution'),
    expect.any(Object)
  );
});
```

### 5.5 Framework Manager Unavailable Handling (1 test case)

#### Test Case 5.5.1: Warning Logged When Framework Manager Unavailable
```typescript
test('framework manager unavailable logs warning but continues execution', async () => {
  // Setup with null framework manager
  const promptEngine = createConsolidatedPromptEngine(
    logger,
    mockMcpServer,
    mockPromptManager,
    mockConfigManager,
    mockSemanticAnalyzer,
    mockConversationManager,
    mockTextReferenceManager,
    mockMcpToolsManager
  );
  
  // Don't set framework manager - should be unavailable
  const command = '@REACT >>analyze';
  
  const response = await promptEngine.executePromptCommand({ command }, {});
  
  // Should still execute prompt but without framework override
  expect(response.isError).toBeFalsy();
  
  // Should log warning about unavailable framework manager
  expect(logger.warn).toHaveBeenCalledWith(
    expect.stringContaining('Framework manager unavailable'),
    expect.any(Object)
  );
});
```

---

## Phase 6: End-to-End CLI Tests (NEW)

**File**: `server/tests/scripts/integration-framework-operator.js` (new Node.js script)
**Estimated Time**: 2 hours

### 6.1 CLI Framework Override Execution (1 test case)

#### Test Case 6.1.1: Execute Framework Override via CLI
```javascript
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testCliFrameworkOverride() {
  console.log('Testing CLI framework override execution...');
  
  const serverProcess = spawn('node', [
    'dist/index.js',
    '--transport=stdio',
    '--quiet'
  ], {
    cwd: path.resolve(__dirname, '../..'),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  let responseData = '';
  
  serverProcess.stdout.on('data', (data) => {
    responseData += data.toString();
  });
  
  // Send MCP request for framework override
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'prompt_manager',
      arguments: {
        command: '@REACT >>analyze data="CLI test data"'
      }
    }
  };
  
  serverProcess.stdin.write(JSON.stringify(request) + '\n');
  
  await new Promise((resolve) => {
    serverProcess.on('close', resolve);
    setTimeout(resolve, 5000); // Timeout after 5 seconds
  });
  
  const response = JSON.parse(responseData);
  
  console.assert(response.result !== undefined, 'Should have successful response');
  console.assert(response.result.isError === false, 'Should not be error');
  console.assert(response.result.content !== undefined, 'Should have content');
  
  serverProcess.kill();
  console.log('✓ CLI framework override test passed');
}
```

### 6.2 Framework Context in Response Metadata (1 test case)

#### Test Case 6.2.1: Verify Framework Context in CLI Response Metadata
```javascript
async function testCliFrameworkMetadata() {
  console.log('Testing CLI framework context in response metadata...');
  
  // Similar setup as above
  const request = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'prompt_manager',
      arguments: {
        command: '@VUE >>analyze data="metadata test"'
      }
    }
  };
  
  // Send request and get response
  // ... similar to above
  
  const response = JSON.parse(responseData);
  
  console.assert(
    response.result.metadata?.frameworkOverride === 'VUE',
    'Should have VUE framework in metadata'
  );
  
  console.assert(
    response.result.metadata?.originalFramework !== undefined,
    'Should have original framework in metadata'
  );
  
  console.log('✓ CLI framework metadata test passed');
}
```

### 6.3 Multi-step Chain with Framework via CLI (1 test case)

#### Test Case 6.3.1: Multi-step Chain Framework Persistence via CLI
```javascript
async function testCliMultiStepChainFramework() {
  console.log('Testing CLI multi-step chain with framework persistence...');
  
  const command = '@REACT >>step1 data="chain test" --> step2';
  
  // Execute first step
  const step1Request = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'prompt_manager',
      arguments: { command }
    }
  };
  
  // Send and get step 1 response
  // ... setup and execution
  
  const step1Response = JSON.parse(responseData);
  
  console.assert(
    step1Response.result.content[0].text.includes('Session ID:'),
    'Should create session for chain'
  );
  
  console.assert(
    step1Response.result.metadata?.frameworkOverride === 'REACT',
    'Should have REACT framework in step 1'
  );
  
  // Execute second step
  const step2Request = {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'prompt_manager',
      arguments: {
        command,
        previous_step_output: 'step1 result'
      }
    }
  };
  
  // Send and get step 2 response
  // ... setup and execution
  
  const step2Response = JSON.parse(responseData);
  
  console.assert(
    step2Response.result.metadata?.frameworkOverride === 'REACT',
    'Should maintain REACT framework in step 2'
  );
  
  console.assert(
    step2Response.result.content[0].text.includes('✓ Chain complete'),
    'Should complete chain successfully'
  );
  
  console.log('✓ CLI multi-step chain framework test passed');
}
```

### 6.4 CLI Error Message Validation (1 test case)

#### Test Case 6.4.1: CLI Error Messages Surface Correctly
```javascript
async function testCliErrorMessages() {
  console.log('Testing CLI error message validation...');
  
  // Test with invalid framework
  const invalidRequest = {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'prompt_manager',
      arguments: {
        command: '@INVALID_FRAMEWORK >>analyze'
      }
    }
  };
  
  // Send and get response
  // ... setup and execution
  
  const response = JSON.parse(responseData);
  
  console.assert(response.result.isError === true, 'Should be error response');
  console.assert(
    response.result.error.includes('INVALID_FRAMEWORK'),
    'Should include framework name in error'
  );
  console.assert(
    response.result.error.includes('suggestions') ||
    response.result.error.includes('Did you mean'),
    'Should provide helpful suggestions'
  );
  
  console.log('✓ CLI error message test passed');
}
```

---

## Test Coverage Analysis and Validation

### Coverage Requirements
- **Target**: 95%+ code coverage for framework operator components
- **Components to cover**:
  - `FrameworkOperatorExecutor` class
  - `SymbolicCommandParser` framework detection logic
  - Integration points with chain and gate operators

### Coverage Validation Script
```bash
# Run coverage analysis
npm run test:coverage

# Check specific framework operator files
npx nyc report --reporter=text --reporter=html \
  --include='src/execution/operators/framework-operator-executor.js' \
  --include='src/execution/parsers/symbolic-command-parser.js'

# Generate coverage report
npx nyc report --reporter=lcov > coverage.lcov
```

### Success Criteria Validation
1. **Code Coverage**: 95%+ for all framework operator components
2. **Existing Tests**: All existing tests still pass (no regressions)
3. **Multi-step Persistence**: Framework context verified across chain steps
4. **Error Messages**: Clear, user-friendly error messages in all failure scenarios
5. **Integration**: Seamless integration with chain and gate operators

---

## Documentation and Test Report Generation

### Test Documentation Structure
```
docs/
├── testing/
│   ├── framework-operator-testing-guide.md
│   ├── test-coverage-report.md
│   └── integration-test-scenarios.md
```

### Automated Test Report
```typescript
// Generate comprehensive test report
interface TestReport {
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    coverage: {
      lines: number;
      functions: number;
      branches: number;
      statements: number;
    };
  };
  phases: {
    parser: TestPhaseResult;
    executor: TestPhaseResult;
    integration: TestPhaseResult;
    errorHandling: TestPhaseResult;
    cli: TestPhaseResult;
  };
  recommendations: string[];
  nextSteps: string[];
}
```

### Implementation Timeline
- **Day 1**: Phases 1, 3, 5 (High Priority)
- **Day 2**: Phases 2, 4 (Medium Priority)
- **Day 3**: Phase 6 + Coverage Analysis + Documentation (if time permits)

### Risk Mitigation
1. **Test Isolation**: Ensure tests don't interfere with each other
2. **Mock Management**: Proper cleanup of mocks and spies
3. **Async Handling**: Proper await/async patterns for all test scenarios
4. **Error Boundaries**: Graceful handling of unexpected test failures
5. **Performance**: Keep test execution time reasonable with appropriate timeouts

---

## Conclusion

This comprehensive test implementation plan provides detailed, actionable test cases for Framework Operator functionality. The plan follows the specified priority order, includes specific scenarios and expected outcomes, and ensures thorough coverage of all critical paths including edge cases and error conditions.

The implementation will provide confidence in Framework Operator's reliability, maintainability, and integration with the broader symbolic command system.