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
      "frameworks/analysis/framework-consensus-engine.ts",
      "frameworks/analysis/framework-enhancement-pipeline.ts"
    ],
    warning: "Multiple analysis systems detected. Consolidate into single SemanticAnalyzer."
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
  
  if (hasViolations) {
    console.log("🚨 SYSTEM CONSOLIDATION VIOLATIONS DETECTED!");
    console.log("   See CLAUDE.md 'System Migration & Deprecation Guidelines' for resolution.");
    process.exit(1);
  } else {
    console.log("\n✅ All systems properly consolidated!");
  }
}

validateSystemConsolidation();