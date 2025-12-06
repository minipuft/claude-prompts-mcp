// @lifecycle canonical - Utility to generate action metadata artifacts.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promptManagerMetadata, promptEngineMetadata, systemControlMetadata, } from './definitions/index.js';
const OUTPUT_DIR = path.resolve('src', 'tooling', 'action-metadata');
async function writeMetadataFiles(targets) {
    await Promise.all(targets.map(async (target) => {
        const filePath = path.join(OUTPUT_DIR, target.filename);
        const contents = JSON.stringify(target.payload, null, 2) + '\n';
        await writeFile(filePath, contents, 'utf8');
    }));
}
async function main() {
    await writeMetadataFiles([
        {
            filename: 'prompt-manager.json',
            payload: {
                tool: promptManagerMetadata.tool,
                version: promptManagerMetadata.version,
                notes: promptManagerMetadata.notes,
                actions: promptManagerMetadata.data.actions,
                parameters: promptManagerMetadata.data.parameters,
                commands: promptManagerMetadata.data.commands,
            },
        },
        {
            filename: 'prompt-engine.json',
            payload: {
                tool: promptEngineMetadata.tool,
                version: promptEngineMetadata.version,
                notes: promptEngineMetadata.notes,
                issues: promptEngineMetadata.issues,
                parameters: promptEngineMetadata.data.parameters,
                commands: promptEngineMetadata.data.commands,
                usagePatterns: promptEngineMetadata.data.usagePatterns,
            },
        },
        {
            filename: 'system-control.json',
            payload: {
                tool: systemControlMetadata.tool,
                version: systemControlMetadata.version,
                notes: systemControlMetadata.notes,
                operations: systemControlMetadata.data.operations,
                parameters: systemControlMetadata.data.parameters,
                commands: systemControlMetadata.data.commands,
            },
        },
    ]);
}
main().catch((error) => {
    console.error('Failed to generate action metadata');
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=generate.js.map