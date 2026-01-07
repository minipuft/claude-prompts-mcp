// @lifecycle canonical - Atomic file write utility for safe state persistence.
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

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
export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  options?: AtomicWriteOptions
): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);

  try {
    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write to temp file
    await fs.writeFile(tempPath, data, {
      encoding: options?.encoding ?? 'utf-8',
      mode: options?.mode ?? 0o644,
    });

    // Atomic rename to target
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Cleanup temp file on failure
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors - temp file may not exist
    }
    throw error;
  }
}

/**
 * Synchronous version for shutdown scenarios where async is not available.
 *
 * @param filePath - Target file path
 * @param data - Data to write (string or Buffer)
 * @param options - Write options
 * @throws Error if write or rename fails
 */
export function atomicWriteFileSync(
  filePath: string,
  data: string | Buffer,
  options?: AtomicWriteOptions
): void {
  // Dynamic require for sync operations

  const fsSync = require('fs') as typeof import('fs');

  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);

  try {
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(tempPath, data, {
      encoding: options?.encoding ?? 'utf-8',
      mode: options?.mode ?? 0o644,
    });
    fsSync.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fsSync.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
