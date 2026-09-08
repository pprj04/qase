import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds a zip of the source that is safe to hand to somebody else.
 *
 * Two things make this safe:
 *  1. A staging copy with explicit code-controlled rules (below) — no reliance
 *     on zip's glob semantics, which are surprising ('/*.png' matches
 *     subdirectory paths too).
 *  2. A read-back verification step that refuses to hand over an archive
 *     containing secrets or runtime state.
 *
 * The rules mirror .gitignore plus the corrupt-ext4 workarounds:
 *  - .env / .qase/ hold the API key and every site ever tested
 *  - .drytis scratch (cred.json, notes/, *.js/*.mjs/*.txt, findings-recovered*,
 *    backup-*) contains literal login passwords and test tokens
 *  - tests/ has a corrupt ext4 dentry (EUCLEN) — walking it crashes archivers;
 *    tests-real/ is the current suite and ships instead
 *  - root *.png are session screenshots; the real image assets live in
 *    userDocs/ and DO ship
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'qase-share.zip');

/** Directory names (at any depth) that are skipped entirely. */
const SKIP_DIRS = new Set([
	'node_modules',
	'.qase',
	'.qase-old-corrupted',
	'.git',
	'.claude',
	'.playwright-mcp',
	'corrupt-husk-aws',
	'.corrupt-husk-aws',
	'tests',        // corrupt ext4 dentry — unwalkable; tests-real ships instead
	'tests_old',    // superseded scratch (gitignored: "never publish")
	'downloads'     // public/downloads — served downloads, not source
]);

/** Top-level directory names whose *contents* are skipped (dir itself too). */
const SKIP_TOP_DIRS = [
	'.qase-test-scratch',
	'.drytis/notes',
	'.drytis/backup',
	'.drytis/memory',
	'.drytis/specs',
	'.drytis/benchmark-apps',
	'.drytis/demo-seed',
	'.drytis/benchmarks',
	'.drytis/reviews'
];

/** Exact file basenames never shipped, at any depth. */
const SKIP_FILES = new Set(['.env', '.DS_Store', 'qase-share.zip', 'cred.json']);

function isSkipped(relPath, basename, isDir) {
	if (SKIP_FILES.has(basename)) return true;
	if (relPath.split('/').some(part => SKIP_DIRS.has(part))) return true;
	if (SKIP_TOP_DIRS.some(dir => relPath === dir || relPath.startsWith(dir + '/'))) return true;

	// .gitignore: Drytis scratch at .drytis root — "contain literal test tokens"
	if (/^\.drytis\/[^/]+\.(js|mjs|txt)$/.test(relPath)) return true;
	if (/^\.drytis\/findings-recovered[^/]*\.json$/.test(relPath)) return true;

	// Logs anywhere.
	if (basename.endsWith('.log')) return true;

	// Root-level only (files in subdirectories are untouched):
	const top = !relPath.includes('/');
	if (top) {
		if (basename.endsWith('.png')) return true;          // session screenshots
		if (/^qase-project.*\.(zip|tar\.gz)$/.test(basename)) return true; // old exports
		if (/^(1\.txt|transcript5\.txt|resp-body-root\.txt|styles-inspect\.txt|phase17-docs\.zip)$/.test(basename)) return true;
		if (/^check1-.*\.yml$/.test(basename)) return true;
		if (/^mtg-/.test(basename)) return true;
	}
	return false;
}

fs.rmSync(output, { force: true });
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'qase-pkg-'));

function copyTree(srcDir, destDir, relPrefix) {
	fs.mkdirSync(destDir, { recursive: true });
	// Sort for deterministic archive ordering.
	const entries = fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
		// Wrap the stat calls: a corrupt dentry throws EUCLEN — skip, don't die.
		let isDir;
		try {
			isDir = entry.isDirectory();
		} catch {
			continue;
		}
		if (isSkipped(rel, entry.name, isDir)) continue;
		const src = path.join(srcDir, entry.name);
		const dest = path.join(destDir, entry.name);
		try {
			if (isDir) {
				copyTree(src, dest, rel);
			} else if (entry.isSymbolicLink()) {
				const target = fs.readlinkSync(src);
				if (path.isAbsolute(target)) continue; // absolute symlinks won't resolve elsewhere
				fs.symlinkSync(target, dest);
			} else {
				fs.copyFileSync(src, dest);
			}
		} catch (error) {
			// Corrupt/unreadable entry (known ext4 issue) — skip it, keep packaging.
			console.warn(`  skipping unreadable ${rel}: ${error.code ?? error.message}`);
		}
	}
}

copyTree(root, stage, '');

execFileSync('zip', ['-r', '-q', output, '.'], { cwd: stage, stdio: 'inherit' });
fs.rmSync(stage, { recursive: true, force: true });

// Verify rather than trust: a leaked key is not something to find out about
// later, so the archive is read back and checked before it is handed over.
const listing = execFileSync('unzip', ['-Z1', output], { cwd: root, encoding: 'utf8' })
	.split('\n')
	.filter(Boolean);

// Anything that looks like a secret or runtime state must not ship.
const leaked = listing.filter(entry =>
	entry === '.env' ||
	entry.startsWith('.qase/') ||
	entry.startsWith('node_modules/') ||
	entry.startsWith('.drytis/cred') ||
	entry.startsWith('.drytis/notes/') ||
	entry.startsWith('tests/')
);

if (leaked.length > 0) {
	fs.rmSync(output, { force: true });
	console.error('Refusing to package — these should not be in the archive:');
	for (const entry of leaked) {
		console.error(`  ${entry}`);
	}
	process.exit(1);
}

const size = (fs.statSync(output).size / 1024).toFixed(0);
console.log(`\n  qase-share.zip  ${size} KB  ${listing.length} files`);
console.log('  No API key, no run history, no node_modules.\n');
console.log('  They run:  npm install && npm run install-browser && npm start\n');
