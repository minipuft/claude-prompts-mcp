#!/usr/bin/env node
/**
 * Dependency Validation Script
 * 
 * Detects duplicate systems and overlapping functionality that violate
 * the "Single Source of Truth" principle.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define known system overlaps that should trigger warnings
const OVERLAP_PATTERNS = [
  {
    name: "Execution Systems",
    files: [
      "execution/engine.ts",
      "execution/execution-coordinator.ts", 
      "execution/unified-prompt-processor.ts"
    ],
    warning: "Multiple execution systems detected. Choose ONE primary system and deprecate others."
  },
  {
    name: "Analysis Systems", 
    files: [
      "analysis/semantic-analyzer.ts",
      "analysis/configurable-semantic-analyzer.ts",
      "frameworks/analysis/framework-consensus-engine.ts",
      "frameworks/analysis/framework-enhancement-pipeline.ts"
    ],
    warning: "Multiple analysis systems detected. Consolidate into single configurable analyzer."
  },
  {
    name: "Runtime/Application Systems",
    files: [
      "runtime/application.ts",
      "orchestration/application-orchestrator.ts",
      "server/server.ts"
    ],
    warning: "Multiple application runtime systems detected. Use ONE unified runtime system."
  },
  {
    name: "MCP Tools Architecture",
    files: [
      "mcp-tools/template-generation-tools.ts",
      "mcp-tools/prompt-management-tools.ts", 
      "mcp-tools/execution-tools.ts",
      "mcp-tools/analysis-tools.ts"
    ],
    warning: "Legacy fragmented MCP tools detected. Should be consolidated into 3 intelligent tools."
  }
];

// Scan for files and detect overlaps
function validateSystemConsolidation() {
  console.log("🔍 Validating system consolidation...\n");
  
  let hasViolations = false;
  
  for (const pattern of OVERLAP_PATTERNS) {
    const existingFiles = [];
    
    for (const filePath of pattern.files) {
      const fullPath = path.join(__dirname, '..', 'src', filePath);
      if (fs.existsSync(fullPath)) {
        existingFiles.push(filePath);
      }
    }
    
    if (existingFiles.length > 1) {
      hasViolations = true;
      console.log(`❌ ${pattern.name} VIOLATION:`);
      console.log(`   Found ${existingFiles.length} overlapping systems:`);
      existingFiles.forEach(file => console.log(`   - ${file}`));
      console.log(`   ${pattern.warning}\n`);
    } else if (existingFiles.length === 1) {
      console.log(`✅ ${pattern.name}: Single system detected (${existingFiles[0]})`);
    }
  }
  
  // Validate new consolidated architecture presence
  console.log("\n🔍 Validating new consolidated architecture...");
  
  const REQUIRED_ARCHITECTURE = [
    {
      name: "Consolidated MCP Tools",
      files: [
        "mcp-tools/prompt-engine/core/engine.ts",
        "mcp-tools/prompt-manager.ts",
        "mcp-tools/system-control.ts"
      ],
      required: 3
    },
    {
      name: "Methodology Guides",
      files: [
        "frameworks/adapters/cageerf-methodology-guide.ts",
        "frameworks/adapters/react-methodology-guide.ts",
        "frameworks/adapters/5w1h-methodology-guide.ts",
        "frameworks/adapters/scamper-methodology-guide.ts"
      ],
      required: 4
    },
    {
      name: "Framework System",
      files: [
        "frameworks/framework-manager.ts",
        "frameworks/framework-state-manager.ts"
      ],
      required: 2
    },
    {
      name: "Runtime System",
      files: [
        "runtime/application.ts",
        "runtime/startup.ts"
      ],
      required: 2
    }
  ];
  
  let architectureScore = 0;
  for (const archPattern of REQUIRED_ARCHITECTURE) {
    const existingFiles = [];
    
    for (const filePath of archPattern.files) {
      const fullPath = path.join(__dirname, '..', 'src', filePath);
      if (fs.existsSync(fullPath)) {
        existingFiles.push(filePath);
      }
    }
    
    if (existingFiles.length >= archPattern.required) {
      console.log(`✅ ${archPattern.name}: ${existingFiles.length}/${archPattern.required} components found`);
      architectureScore++;
    } else {
      console.log(`❌ ${archPattern.name}: ${existingFiles.length}/${archPattern.required} components found - INCOMPLETE`);
      existingFiles.forEach(file => console.log(`   - ${file}`));
      hasViolations = true;
    }
  }
  
  if (hasViolations) {
    console.log("🚨 SYSTEM CONSOLIDATION VIOLATIONS DETECTED!");
    console.log("   See CLAUDE.md 'System Migration & Deprecation Guidelines' for resolution.");
    process.exit(1);
  } else {
    console.log(`\n✅ All systems properly consolidated! (${architectureScore}/${REQUIRED_ARCHITECTURE.length} architecture patterns validated)`);
  }
}

validateSystemConsolidation();