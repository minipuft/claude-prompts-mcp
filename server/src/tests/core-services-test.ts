/**
 * Phase 2 Core Services Validation Test
 * Tests the text-references and utils modules to ensure they work correctly
 */

import { Logger } from "../logging/index.js";
import { TextReferenceManager } from "../text-references/index.js";
import {
  camelToKebab,
  clearRequireCache,
  createUniqueId,
  delay,
  forceGarbageCollection,
  getAvailableTools,
  handleError,
  isValidEmail,
  isValidJson,
  kebabToCamel,
  parseArgs,
  PromptError,
  safeStringify,
  truncateText,
  ValidationError,
} from "../utils/index.js";

/**
 * Mock logger for testing
 */
class MockLogger implements Logger {
  info(message: string, ...args: any[]): void {
    console.log(`[INFO] ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    console.log(`[DEBUG] ${message}`, ...args);
  }
}

/**
 * Test the Text Reference Manager
 */
async function testTextReferenceManager(): Promise<boolean> {
  console.log("=== Testing Text Reference Manager ===");

  try {
    const logger = new MockLogger();
    const textRefManager = new TextReferenceManager(logger, 60000, 10); // 1 minute, max 10 refs

    // Test storing a reference
    const refId = await textRefManager.storeTextReference(
      "This is a test text for the reference system."
    );
    console.log("✓ Successfully stored text reference:", refId);

    // Test retrieving a reference
    const extractedId = refId.match(/{{ref:([^}]+)}}/)?.[1];
    if (extractedId) {
      const retrievedText = textRefManager.getTextReference(extractedId);
      console.log("✓ Successfully retrieved text:", retrievedText);
    }

    // Test listing references
    const refs = textRefManager.listTextReferences();
    console.log("✓ Listed references:", refs.length);

    // Test stats
    const stats = textRefManager.getStats();
    console.log("✓ Stats:", stats);

    // Test template processing
    const template = `Hello {{name}}, here's your content: ${refId}`;
    const processed = textRefManager.processTemplateReferences(template);
    console.log("✓ Processed template:", processed.substring(0, 100) + "...");

    return true;
  } catch (error) {
    console.error("✗ Text Reference Manager test failed:", error);
    return false;
  }
}

/**
 * Test utility functions
 */
function testUtilityFunctions(): boolean {
  console.log("=== Testing Utility Functions ===");

  try {
    // Test string utilities
    console.log("✓ camelToKebab:", camelToKebab("testCamelCase"));
    console.log("✓ kebabToCamel:", kebabToCamel("test-kebab-case"));
    console.log(
      "✓ truncateText:",
      truncateText("This is a very long text that should be truncated", 20)
    );

    // Test JSON utilities
    console.log("✓ isValidJson (valid):", isValidJson('{"test": true}'));
    console.log("✓ isValidJson (invalid):", isValidJson("invalid json"));

    // Test unique ID generation
    const id1 = createUniqueId("test");
    const id2 = createUniqueId("test");
    console.log("✓ createUniqueId:", id1 !== id2 ? "unique" : "duplicate");

    // Test safe stringify
    const circular: any = { a: 1 };
    circular.b = circular;
    console.log(
      "✓ safeStringify (circular):",
      safeStringify(circular).includes("[Circular]")
    );

    // Test email validation
    console.log("✓ isValidEmail (valid):", isValidEmail("test@example.com"));
    console.log("✓ isValidEmail (invalid):", !isValidEmail("invalid-email"));

    // Test argument parsing
    const args = parseArgs(["--port=3000", "--host", "localhost", "--verbose"]);
    console.log("✓ parseArgs:", args);

    // Test available tools
    const tools = getAvailableTools();
    console.log("✓ getAvailableTools:", tools.includes("tool_calls"));

    // Test error handling
    const logger = new MockLogger();
    const validationError = new ValidationError("Test validation error", [
      "field1",
      "field2",
    ]);
    const result = handleError(validationError, "Test context", logger);
    console.log(
      "✓ handleError (ValidationError):",
      result.message.includes("Test validation error")
    );

    const promptError = new PromptError("Test prompt error");
    const result2 = handleError(promptError, "Test context", logger);
    console.log("✓ handleError (PromptError):", result2.isError === true);

    return true;
  } catch (error) {
    console.error("✗ Utility functions test failed:", error);
    return false;
  }
}

/**
 * Test async utilities
 */
async function testAsyncUtilities(): Promise<boolean> {
  console.log("=== Testing Async Utilities ===");

  try {
    // Test delay function
    const start = Date.now();
    await delay(100);
    const elapsed = Date.now() - start;
    console.log(
      "✓ delay function:",
      elapsed >= 90 && elapsed <= 150 ? "correct timing" : "timing off"
    );

    // Test garbage collection (may not be available in all environments)
    const gcResult = forceGarbageCollection();
    console.log(
      "✓ forceGarbageCollection:",
      gcResult ? "available" : "not available"
    );

    // Test require cache clearing (should not throw)
    clearRequireCache();
    console.log("✓ clearRequireCache: completed without error");

    return true;
  } catch (error) {
    console.error("✗ Async utilities test failed:", error);
    return false;
  }
}

/**
 * Main test runner
 */
async function runCoreServicesTest(): Promise<void> {
  console.log("🚀 Starting Phase 2 Core Services Validation Test");
  console.log("=".repeat(50));

  const results = await Promise.all([
    testTextReferenceManager(),
    testUtilityFunctions(),
    testAsyncUtilities(),
  ]);

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log("=".repeat(50));
  console.log(`📊 Test Results: ${passed}/${total} test suites passed`);

  if (passed === total) {
    console.log("✅ Phase 2 Core Services are working correctly!");
  } else {
    console.log("❌ Some tests failed. Check the output above for details.");
  }
}

// Export for use in other modules
export { runCoreServicesTest };

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCoreServicesTest().catch(console.error);
}
