import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds a zip of the source that is safe to hand to somebody else.
 *
 * The exclusions are the point: `.env` and `.qase/config.json` hold an API key,
 * and `.qase/sessions.json` holds every site that has been tested. Zipping the
 * folder as it stands ships all three.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'qase-share.zip');

const EXCLUDE = [
	'node_modules/*',
	'.qase/*',
	'.env',
	'.git/*',
	'.DS_Store',
	'*/.DS_Store',
	'qase-share.zip',
	'.claude/*'
];

fs.rmSync(output, { force: true });

execFileSync(
	'zip',
	['-r', '-q', output, '.', '-x', ...EXCLUDE],
	{ cwd: root, stdio: 'inherit' }
);

// Verify rather than trust: a leaked key is not something to find out about
// later, so the archive is read back and checked before it is handed over.
const listing = execFileSync('unzip', ['-Z1', output], { cwd: root, encoding: 'utf8' })
	.split('\n')
	.filter(Boolean);

const leaked = listing.filter(entry =>
	entry === '.env' || entry.startsWith('.qase/') || entry.startsWith('node_modules/')
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
