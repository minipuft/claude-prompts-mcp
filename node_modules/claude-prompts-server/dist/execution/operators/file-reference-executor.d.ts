import { Logger } from "../../logging/index.js";
import type { FileReferenceOperator } from "../parsers/types/operator-types.js";
export declare class FileReferenceExecutor {
    private readonly logger;
    constructor(logger: Logger);
    loadFileContent(operator: FileReferenceOperator, basePath?: string): Promise<{
        content: string;
        resolvedPath: string;
    }>;
}
