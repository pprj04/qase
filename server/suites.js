/**
 * Test suite CRUD and persistence.
 *
 * A Suite groups test cases by feature area (e.g. "Checkout", "Auth").
 * Suites support nesting up to 2 levels (parent → child). Test cases
 * reference a suite via `suiteId`; unassigned cases appear at root level.
 *
 * Persistence: `.qase/suites.json`
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITES_FILE = join(__dirname, '..', '.qase', 'suites.json');

const MAX_DEPTH = 2;

let suites = [];
let saveTimer = null;

function load() {
	try {
		if (existsSync(SUITES_FILE)) {
			suites = JSON.parse(readFileSync(SUITES_FILE, 'utf-8'));
		}
	} catch {
		suites = [];
	}
}

function persistSoon() {
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		flush();
	}, 250);
}

function flush() {
	try {
		atomicWrite(SUITES_FILE, JSON.stringify(suites, null, '\t'));
	} catch (error) {
		console.error('Failed to persist suites:', error.message);
	}
}

load();

/* ── Helpers ────────────────────────────────────────────────────── */

/**
 * Returns the depth of a suite (1 = root, 2 = nested).
 */
function suiteDepth(id) {
	let depth = 0;
	let current = suites.find(s => s.id === id);
	while (current) {
		depth++;
		current = suites.find(s => s.id === current.parentId);
	}
	return depth;
}

/* ── CRUD ───────────────────────────────────────────────────────── */

export function createSuite(data) {
	const parentId = data.parentId ?? null;

	// Enforce max depth of 2.
	if (parentId) {
		const parent = suites.find(s => s.id === parentId);
		if (!parent) {
			throw new Error('Parent suite not found');
		}
		if (suiteDepth(parentId) >= MAX_DEPTH) {
			throw new Error(`Cannot nest beyond ${MAX_DEPTH} levels`);
		}
	}

	const suite = {
		id: randomUUID(),
		projectId: data.projectId ?? undefined,
		parentId,
		name: data.name?.trim() || 'Untitled suite',
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
	suites.push(suite);
	persistSoon();
	return suite;
}

export function listSuites({ projectId } = {}) {
	return [...suites]
		.filter(s => !projectId || s.projectId === projectId)
		.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function getSuite(id) {
	return suites.find(s => s.id === id);
}

export function updateSuite(id, patch) {
	const suite = suites.find(s => s.id === id);
	if (!suite) return undefined;

	if (typeof patch.name === 'string') suite.name = patch.name.trim();
	if (patch.parentId !== undefined) {
		// Prevent circular references and depth violations.
		if (patch.parentId === null) {
			suite.parentId = null;
		} else if (patch.parentId !== id) {
			const newParent = suites.find(s => s.id === patch.parentId);
			if (!newParent) throw new Error('Parent suite not found');
			// Check we're not creating a cycle.
			let ancestor = newParent;
			while (ancestor) {
				if (ancestor.id === id) throw new Error('Cannot move suite under its own descendant');
				ancestor = suites.find(s => s.id === ancestor.parentId);
			}
			// Check depth.
			const newDepth = suiteDepth(patch.parentId) + 1;
			if (newDepth > MAX_DEPTH) throw new Error(`Cannot nest beyond ${MAX_DEPTH} levels`);
			suite.parentId = patch.parentId;
		}
	}

	suite.updatedAt = Date.now();
	persistSoon();
	return suite;
}

export function deleteSuite(id) {
	const index = suites.findIndex(s => s.id === id);
	if (index === -1) return false;

	// Move child suites to parent (or root).
	const suite = suites[index];
	const children = suites.filter(s => s.parentId === id);
	for (const child of children) {
		child.parentId = suite.parentId;
	}

	suites.splice(index, 1);
	persistSoon();
	return true;
}

/** Immediately persist the in-memory suites array to disk. */
export function saveSuitesRaw() {
	flush();
}

/**
 * Backfill: assign defaultId to every suite missing a projectId.
 * Returns the number updated.
 */
export function backfillProjectId(defaultId) {
	let count = 0;
	for (const s of suites) {
		if (!s.projectId) {
			s.projectId = defaultId;
			count++;
		}
	}
	if (count > 0) flush();
	return count;
}

/**
 * Reassign: move all suites from fromProjectId to toProjectId.
 * Returns the number moved.
 */
export function reassignProjectId(fromProjectId, toProjectId) {
	let count = 0;
	for (const s of suites) {
		if (s.projectId === fromProjectId) {
			s.projectId = toProjectId;
			count++;
		}
	}
	if (count > 0) flush();
	return count;
}
