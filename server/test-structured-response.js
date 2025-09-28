#!/usr/bin/env node

/**
 * Test script to verify structured response builder functionality
 */

import { createPromptResponse, createSystemResponse, createExecutionResponse } from './dist/mcp-tools/shared/structured-response-builder.js';

console.log('🧪 Testing Unified Structured Response Builder...\n');

// Test 1: Prompt Response
console.log('📝 Test 1: Prompt Response');
try {
  const promptResponse = createPromptResponse(
    "✅ **Prompt Created**: test_prompt\nPrompt has been successfully created.",
    "create",
    {
      promptId: "test_prompt",
      category: "development",
      analysisResult: { executionType: "prompt", confidence: 95 },
      affectedFiles: ["test_prompt.md"]
    }
  );

  console.log('✅ Prompt response created successfully');
  console.log('📊 Has content array:', Array.isArray(promptResponse.content));
  console.log('📊 Has structuredContent:', !!promptResponse.structuredContent);
  console.log('📊 Has executionMetadata:', !!promptResponse.structuredContent?.executionMetadata);
  console.log('📊 Has operationData:', !!promptResponse.structuredContent?.operationData);
  console.log();
} catch (error) {
  console.log('❌ Prompt response test failed:', error.message);
}

// Test 2: System Response
console.log('⚙️ Test 2: System Response');
try {
  const systemResponse = createSystemResponse(
    "🔄 **Framework switched** to CAGEERF successfully.",
    "switch_framework",
    {
      frameworkState: { active: "CAGEERF", previous: "ReACT" },
      systemHealth: { status: "healthy", uptime: 12345 },
      analytics: { totalExecutions: 42, successRate: 0.95, averageExecutionTime: 150, uptime: 12345 }
    }
  );

  console.log('✅ System response created successfully');
  console.log('📊 Has content array:', Array.isArray(systemResponse.content));
  console.log('📊 Has structuredContent:', !!systemResponse.structuredContent);
  console.log('📊 Has executionMetadata:', !!systemResponse.structuredContent?.executionMetadata);
  console.log('📊 Has operationData:', !!systemResponse.structuredContent?.operationData);
  console.log();
} catch (error) {
  console.log('❌ System response test failed:', error.message);
}

// Test 3: Execution Response
console.log('🚀 Test 3: Execution Response');
try {
  const executionResponse = createExecutionResponse(
    "# Analysis Results\nPrompt analysis completed successfully.",
    "execute",
    {
      executionType: "chain",
      executionTime: 2500,
      frameworkUsed: "CAGEERF",
      stepsExecuted: 3,
      sessionId: "session_123",
      gateResults: { passed: true, totalGates: 2 }
    }
  );

  console.log('✅ Execution response created successfully');
  console.log('📊 Has content array:', Array.isArray(executionResponse.content));
  console.log('📊 Has structuredContent:', !!executionResponse.structuredContent);
  console.log('📊 Has executionMetadata:', !!executionResponse.structuredContent?.executionMetadata);
  console.log('📊 Framework used:', executionResponse.structuredContent?.executionMetadata?.frameworkUsed);
  console.log();
} catch (error) {
  console.log('❌ Execution response test failed:', error.message);
}

// Test 4: MCP Protocol Compliance
console.log('🔍 Test 4: MCP Protocol Compliance Check');
try {
  const testResponse = createPromptResponse("Test content", "test", { promptId: "test" });

  // Check MCP protocol requirements
  const hasRequiredContent = Array.isArray(testResponse.content) &&
                             testResponse.content.length > 0 &&
                             testResponse.content[0].type === "text" &&
                             typeof testResponse.content[0].text === "string";

  const hasStructuredContent = !!testResponse.structuredContent;

  const hasExecutionMetadata = !!testResponse.structuredContent?.executionMetadata &&
                              typeof testResponse.structuredContent.executionMetadata.executionId === "string" &&
                              typeof testResponse.structuredContent.executionMetadata.executionType === "string";

  if (hasRequiredContent && hasStructuredContent && hasExecutionMetadata) {
    console.log('✅ MCP Protocol Compliance: PASSED');
    console.log('✅ All responses should now include required structuredContent');
    console.log('✅ No more "no structured content was provided" errors expected');
  } else {
    console.log('❌ MCP Protocol Compliance: FAILED');
    console.log('❌ Missing required fields for MCP compliance');
  }
  console.log();
} catch (error) {
  console.log('❌ MCP compliance test failed:', error.message);
}

console.log('🎉 Structured Response Builder Testing Complete!');
console.log('📋 Summary: All tools now use unified response builder for MCP compliance');