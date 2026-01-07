export interface AtomicWriteOptions {
    /** Mode for created files (default: 0o644) */
    mode?: number;
    /** Encoding for string data (default: utf-8) */
    encoding?: BufferEncoding;
}
/**
 * Write data to file atomically using temp file + rename pattern.
 *
 * This ensures that:
 * 1. A crash during write doesn't corrupt the original file
 * 2. Concurrent readers always see complete data (old or new, never partial)
 *
 * Cross-platform notes:
 * - POSIX: rename() is atomic on same filesystem
 * - Windows: rename() is mostly atomic (may fail if target is open)
 *
 * @param filePath - Target file path
 * @param data - Data to write (string or Buffer)
 * @param options - Write options
 * @throws Error if write or rename fails
 */
export declare function atomicWriteFile(filePath: string, data: string | Buffer, options?: AtomicWriteOptions): Promise<void>;
/**
 * Synchronous version for shutdown scenarios where async is not available.
 *
 * @param filePath - Target file path
 * @param data - Data to write (string or Buffer)
 * @param options - Write options
 * @throws Error if write or rename fails
 */
export declare function atomicWriteFileSync(filePath: string, data: string | Buffer, options?: AtomicWriteOptions): void;
