/**
 * Multi-target project management.
 *
 * A Project groups all QA artifacts (sessions, workflows, test cases,
 * schedules, regression runs) for a single target site. On first boot,
 * a Default project is auto-created and existing orphaned entities are
 * assigned to it.
 *
 * Persistence: `.qase/projects.json`
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_FILE = join(__dirname, '..', '.qase', 'projects.json');

const DEFAULT_PROJECT_NAME = 'Default';

let projects = [];
let saveTimer = null;

function load() {
	try {
		if (existsSync(PROJECTS_FILE)) {
			projects = JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
		}
	} catch {
		projects = [];
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
		atomicWrite(PROJECTS_FILE, JSON.stringify(projects, null, '\t'));
	} catch (error) {
		console.error('Failed to persist projects:', error.message);
	}
}

load();

/* ── CRUD ───────────────────────────────────────────────────────── */

export function createProject(data) {
	const project = {
		id: data.id ?? randomUUID(),
		name: data.name?.trim() || DEFAULT_PROJECT_NAME,
		baseUrl: data.baseUrl?.trim() || '',
		// Phase 10: workspace ownership for integration authorization
		workspaceId: data.workspaceId || null,
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
	projects.push(project);
	persistSoon();
	return project;
}

export function getProject(id) {
	return projects.find(p => p.id === id);
}

export function listProjects() {
	return [...projects].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function updateProject(id, patch) {
	const project = projects.find(p => p.id === id);
	if (!project) return undefined;

	if (typeof patch.name === 'string') project.name = patch.name.trim();
	if (typeof patch.baseUrl === 'string') project.baseUrl = patch.baseUrl.trim();
	// Phase 10: workspaceId (set once during integration, not freely mutable)
	if (typeof patch.workspaceId === 'string' && patch.workspaceId.trim() && !project.workspaceId) {
		project.workspaceId = patch.workspaceId.trim();
	}

	project.updatedAt = Date.now();
	persistSoon();
	return project;
}

export function deleteProject(id) {
	// Never delete the Default project (reassign instead).
	const project = projects.find(p => p.id === id);
	if (!project || project.name === DEFAULT_PROJECT_NAME) {
		return false;
	}
	const index = projects.indexOf(project);
	projects.splice(index, 1);
	persistSoon();

	// Reassign orphaned entities to the Default project.
	const defaultId = getDefaultProjectId();
	if (defaultId) {
		reassignEntities(id, defaultId);
	}

	return true;
}

/* ── Entity reassignment & migration ─────────────────────────────── */

/**
 * One-time migration: assign entities with no projectId to the Default project.
 * Called on server boot after ensureDefaultProject().
 * Uses each store's backfillProjectId() for atomic in-place mutation + flush.
 */
export async function assignOrphanedEntities() {
	const defaultId = getDefaultProjectId();
	if (!defaultId) return;

	const store = await import('./store.js');
	const workflows = await import('./workflows.js');
	const testCases = await import('./testCases.js');
	const scheduler = await import('./scheduler.js');
	const regressionStore = await import('./regressionStore.js');
	const suites = await import('./suites.js');
	const findings = await import('./findings.js');
	const missions = await import('./missions.js');

	let orphans = 0;
	orphans += store.backfillProjectId(defaultId);
	orphans += workflows.backfillProjectId(defaultId);
	orphans += testCases.backfillProjectId(defaultId);
	orphans += scheduler.backfillProjectId(defaultId);
	orphans += regressionStore.backfillProjectId(defaultId);
	orphans += suites.backfillProjectId(defaultId);
	orphans += findings.backfillProjectId(defaultId);
	orphans += missions.backfillProjectId();

	if (orphans > 0) {
		console.log(`[projects] Assigned ${orphans} orphaned entities to Default project`);
	}
}

/**
 * Reassigns all entities belonging to `fromProjectId` to `toProjectId`.
 * Called during project deletion to prevent orphaned records.
 * Uses each store's reassignProjectId() for atomic in-place mutation + flush.
 */
async function reassignEntities(fromProjectId, toProjectId) {
	const store = await import('./store.js');
	const workflows = await import('./workflows.js');
	const testCases = await import('./testCases.js');
	const scheduler = await import('./scheduler.js');
	const regressionStore = await import('./regressionStore.js');
	const suites = await import('./suites.js');
	const findings = await import('./findings.js');
	const missions = await import('./missions.js');

	store.reassignProjectId(fromProjectId, toProjectId);
	workflows.reassignProjectId(fromProjectId, toProjectId);
	testCases.reassignProjectId(fromProjectId, toProjectId);
	scheduler.reassignProjectId(fromProjectId, toProjectId);
	regressionStore.reassignProjectId(fromProjectId, toProjectId);
	suites.reassignProjectId(fromProjectId, toProjectId);
	findings.reassignProjectId(fromProjectId, toProjectId);
	missions.reassignProjectId(fromProjectId, toProjectId);
}

/* ── Bootstrap ──────────────────────────────────────────────────── */

/**
 * Ensures a Default project exists. Returns it.
 * Called on server boot before any other store initialisation.
 */
export function ensureDefaultProject() {
	let def = projects.find(p => p.name === DEFAULT_PROJECT_NAME);
	if (!def) {
		def = createProject({ name: DEFAULT_PROJECT_NAME, baseUrl: '' });
		console.log(`[projects] Created Default project (${def.id})`);
	}
	return def;
}

/**
 * Returns the default project ID. Used as fallback when entities
 * don't specify one.
 */
export function getDefaultProjectId() {
	const def = projects.find(p => p.name === DEFAULT_PROJECT_NAME) ?? projects[0];
	return def?.id;
}
