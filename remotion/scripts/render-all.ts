/**
 * Render all compositions to video files
 * Usage: npm run render:all
 */

import { execSync } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

const OUT_DIR = join(import.meta.dirname, "..", "out");

// Composition IDs and their output names
const COMPOSITIONS = [
  { id: "HeroIntro", name: "hero-intro" },
  { id: "SymbolicSyntax", name: "symbolic-syntax" },
  { id: "ChainFlow", name: "chain-flow" },
  { id: "GateSystem", name: "gate-system" },
  { id: "FrameworkInjection", name: "framework-injection" },
  { id: "TerminalDemo", name: "terminal-demo" },
];

// Ensure output directory exists
if (!existsSync(OUT_DIR)) {
  mkdirSync(OUT_DIR, { recursive: true });
}

console.log("🎬 Rendering all compositions...\n");

for (const comp of COMPOSITIONS) {
  const outputPath = join(OUT_DIR, `${comp.name}.mp4`);
  console.log(`📹 Rendering ${comp.id}...`);

  try {
    execSync(`npx remotion render ${comp.id} ${outputPath}`, {
      stdio: "inherit",
      cwd: join(import.meta.dirname, ".."),
    });
    console.log(`✅ ${comp.name}.mp4\n`);
  } catch (error) {
    console.error(`❌ Failed to render ${comp.id}`);
    process.exit(1);
  }
}

console.log("🎉 All compositions rendered successfully!");
console.log(`📁 Output: ${OUT_DIR}`);
