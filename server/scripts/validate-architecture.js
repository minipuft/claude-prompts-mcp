#!/usr/bin/env node
/**
 * Architecture Validation Script
 * 
 * Validates proper dependency hierarchy and detects architectural violations.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define proper dependency hierarchy (lower layers cannot import from higher layers)
const LAYER_HIERARCHY = [
  { layer: 1, name: "utils", paths: ["utils/"] },
  { layer: 2, name: "types", paths: ["types/"] },
  { layer: 3, name: "config", paths: ["config/"] },
  { layer: 4, name: "logging", paths: ["logging/"] },
  { layer: 5, name: "analysis", paths: ["analysis/"] },
  { layer: 6, name: "frameworks", paths: ["frameworks/"] },
  { layer: 7, name: "gates", paths: ["gates/"] },
  { layer: 8, name: "prompts", paths: ["prompts/"] },
  { layer: 9, name: "execution", paths: ["execution/"] },
  { layer: 10, name: "mcp-tools", paths: ["mcp-tools/"] },
  { layer: 11, name: "runtime", paths: ["runtime/"] }
];

function getLayerForFile(filePath) {
  for (const layer of LAYER_HIERARCHY) {
    if (layer.paths.some(p => filePath.startsWith(p))) {
      return layer;
    }
  }
  return null;
}

function validateArchitecturalLayers() {
  console.log("🏗️  Validating architectural layers...\n");
  
  const srcDir = path.join(__dirname, '..', 'src');
  const violations = [];
  
  function scanDirectory(dir, relativePath = '') {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const itemRelativePath = path.join(relativePath, item);
      
      if (fs.statSync(fullPath).isDirectory()) {
        scanDirectory(fullPath, itemRelativePath);
      } else if (item.endsWith('.ts') && !item.endsWith('.d.ts')) {
        validateFile(fullPath, itemRelativePath);
      }
    }
  }
  
  function validateFile(fullPath, relativePath) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const currentLayer = getLayerForFile(relativePath);
    
    if (!currentLayer) return; // Skip files not in defined layers
    
    // Extract import statements
    const imports = content.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g) || [];
    
    for (const importStatement of imports) {
      const match = importStatement.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      
      let importPath = match[1];
      
      // Skip external dependencies
      if (!importPath.startsWith('.')) continue;
      
      // Resolve relative imports
      const importDir = path.dirname(relativePath);
      const resolvedImport = path.normalize(path.join(importDir, importPath)).replace(/\\/g, '/');
      const importLayer = getLayerForFile(resolvedImport + '.ts');
      
      // Check for layer violations
      if (importLayer && importLayer.layer > currentLayer.layer) {
        violations.push({
          file: relativePath,
          currentLayer: currentLayer.name,
          importPath: resolvedImport,
          importLayer: importLayer.name,
          violation: `Layer ${currentLayer.layer} (${currentLayer.name}) importing from Layer ${importLayer.layer} (${importLayer.name})`
        });
      }
    }
  }
  
  scanDirectory(srcDir);
  
  if (violations.length > 0) {
    console.log("❌ ARCHITECTURAL VIOLATIONS DETECTED:\n");
    for (const violation of violations) {
      console.log(`   File: ${violation.file}`);
      console.log(`   Issue: ${violation.violation}`);
      console.log(`   Import: ${violation.importPath}\n`);
    }
    
    console.log("🚨 FIX REQUIRED: Lower layers cannot import from higher layers!");
    console.log("   See CLAUDE.md 'Dependency Direction Enforcement' for guidance.");
    process.exit(1);
  } else {
    console.log("✅ All architectural layers properly structured!");
  }
}

validateArchitecturalLayers();