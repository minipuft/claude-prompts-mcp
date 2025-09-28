#!/usr/bin/env node

/**
 * Quick test script to verify enhanced chain step parsing with gate support
 */

import { createLogger } from "../dist/logging/index.js";
import { PromptLoader } from "../dist/prompts/loader.js";

async function testEnhancedParsing() {
  console.log("🧪 Testing Enhanced Chain Step Parsing with Gate Support...\n");

  const logger = createLogger({ level: "info" });
  const loader = new PromptLoader(logger);

  try {
    // Test parsing the enhanced notes.md file
    const result = await loader.loadPromptFile(
      "analysis/notes.md",
      "/home/minipuft/Applications/claude-prompts-mcp/server/prompts"
    );

    console.log("✅ Successfully parsed notes.md");
    console.log(`📋 Found ${result.chainSteps?.length || 0} chain steps`);

    if (result.chainSteps) {
      console.log("\n📊 Chain Steps Analysis:");
      result.chainSteps.forEach((step, index) => {
        console.log(`\n  Step ${index + 1}:`);
        console.log(`    - promptId: ${step.promptId}`);
        console.log(`    - stepName: ${step.stepName}`);
        console.log(
          `    - gates: ${step.gates ? JSON.stringify(step.gates) : "none"}`
        );
        console.log(
          `    - inputMapping: ${
            Object.keys(step.inputMapping || {}).length
          } inputs`
        );
        console.log(
          `    - outputMapping: ${
            Object.keys(step.outputMapping || {}).length
          } outputs`
        );
      });

      // Verify expected gates
      const step1Gates = result.chainSteps[0]?.gates || [];
      const step2Gates = result.chainSteps[1]?.gates || [];
      const step3Gates = result.chainSteps[2]?.gates || [];
      const step4Gates = result.chainSteps[3]?.gates || [];

      console.log("\n🔍 Gate Configuration Verification:");
      console.log(
        `  Step 1 gates: ${JSON.stringify(step1Gates)} ${
          step1Gates.includes("research-quality") ? "✅" : "❌"
        }`
      );
      console.log(
        `  Step 2 gates: ${JSON.stringify(step2Gates)} ${
          step2Gates.includes("research-quality") ? "✅" : "❌"
        }`
      );
      console.log(
        `  Step 3 gates: ${JSON.stringify(step3Gates)} ${
          step3Gates.includes("content-structure") ? "✅" : "❌"
        }`
      );
      console.log(
        `  Step 4 gates: ${JSON.stringify(step4Gates)} ${
          step4Gates.includes("content-structure") ? "✅" : "❌"
        }`
      );

      const allCorrect =
        step1Gates.includes("research-quality") &&
        step2Gates.includes("research-quality") &&
        step3Gates.includes("content-structure") &&
        step4Gates.includes("content-structure");

      console.log(
        `\n🎯 Gate Configuration: ${
          allCorrect ? "✅ ALL CORRECT" : "❌ NEEDS ATTENTION"
        }`
      );
    }

    console.log("\n✅ Enhanced parsing test completed successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

testEnhancedParsing();
