import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export class FileReferenceExecutor {
    constructor(logger) {
        this.logger = logger;
    }
    async loadFileContent(operator, basePath) {
        const { filePath, isRelative } = operator;
        let resolvedPath;
        if (filePath.startsWith('~/')) {
            // Handle home directory expansion
            const homeDir = process.env.HOME || process.env.USERPROFILE;
            if (!homeDir) {
                throw new Error(`Unable to resolve home directory for path: ${filePath}`);
            }
            resolvedPath = resolve(homeDir, filePath.slice(2));
        }
        else if (isRelative) {
            // Resolve relative to base path (working directory or server root)
            const base = basePath || process.cwd();
            resolvedPath = resolve(base, filePath);
        }
        else {
            // Absolute path
            resolvedPath = resolve(filePath);
        }
        this.logger.info('[FileReference] Loading file content', {
            originalPath: filePath,
            resolvedPath,
            isRelative,
        });
        try {
            const content = await readFile(resolvedPath, 'utf-8');
            this.logger.debug('[FileReference] File loaded successfully', {
                resolvedPath,
                contentLength: content.length,
            });
            return {
                content,
                resolvedPath,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error('[FileReference] Failed to load file', {
                resolvedPath,
                error: message,
            });
            throw new Error(`[FileReference] Unable to load file '@${filePath}': ${message}`);
        }
    }
}
//# sourceMappingURL=file-reference-executor.js.map