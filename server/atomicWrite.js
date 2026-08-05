/**
 * Atomic file writer — writes to a temp file then renames.
 *
 * `fs.writeFileSync` is non-atomic: if the process is interrupted
 * mid-write (container pause, signal, crash), the destination file
 * is left truncated or partially written.  For JSON state files this
 * means permanent corruption that silently destroys data.
 *
 * This helper writes to `<path>.tmp` first, then `fs.renameSync` to
 * the final path.  `rename` is atomic on the same filesystem, so the
 * destination either contains the complete previous content or the
 * complete new content — never a partial write.
 */

import { writeFileSync, renameSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @param {string} filePath  Absolute path to the destination file.
 * @param {string} data      Complete file content.
 * @param {object} [options] Optional { mode } to set on the file.
 */
export function atomicWrite(filePath, data, options = {}) {
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const tmp = filePath + '.tmp';
	const writeOpts = options.mode ? { mode: options.mode } : {};
	writeFileSync(tmp, data, writeOpts);

	// Preserve file mode on rename if requested.
	if (options.mode) {
		try {
			// On Linux, rename preserves the source file's mode.
			// writeOpts.mode already set it on the tmp file.
		} catch {
			// Non-fatal.
		}
	}

	renameSync(tmp, filePath);
}
