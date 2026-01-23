import { Config } from "@remotion/cli/config";

// Set the entry point for Remotion
Config.setEntryPoint("./src/index.ts");

// Output settings
Config.setOutputLocation("./out");

// Default codec for rendering
Config.setCodec("h264");

// Parallelism for faster renders
Config.setConcurrency(4);
