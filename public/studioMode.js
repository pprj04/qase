/*
 * Optional Studio presentation shell.
 *
 * `?studio=mock` changes layout only. It does not invent run state, bypass
 * authentication, or replace any Qase API. Project/target values are bounded
 * presentation context and are written with textContent / safe URL parsing.
 */
(function configureStudioMode() {
	const params = new URLSearchParams(window.location.search);
	const enabled = params.get('studio') === 'mock';
	document.documentElement.dataset.qaseLayout = enabled ? 'studio-mock' : 'standalone';
	const sidebarPreferenceKey = 'qase.studio.sidebar';
	if (enabled) {
		let sidebarPreference = 'expanded';
		try {
			sidebarPreference = localStorage.getItem(sidebarPreferenceKey) === 'collapsed' ? 'collapsed' : 'expanded';
		} catch {
			// Storage can be unavailable in hardened or private browser contexts.
		}
		document.documentElement.dataset.qaseSidebar = sidebarPreference;
	}

	const bounded = (value, fallback, maximum) => {
		const normalized = String(value ?? '').trim();
		return (normalized || fallback).slice(0, maximum);
	};
	const safeTarget = value => {
		try {
			const target = new URL(value);
			return ['http:', 'https:'].includes(target.protocol) ? target.href : 'https://studio.drytis.ai/';
		} catch {
			return 'https://studio.drytis.ai/';
		}
	};

	const context = enabled ? Object.freeze({
		mode: 'mock-studio',
		project: bounded(params.get('project'), 'Drytis Studio', 120),
		targetUrl: safeTarget(params.get('target') ?? 'https://studio.drytis.ai/')
	}) : undefined;
	window.qaseStudioContext = context;

	if (!enabled) return;
	window.addEventListener('DOMContentLoaded', () => {
		const project = document.getElementById('studio-project-name');
		const target = document.getElementById('studio-project-target');
		const contextPanel = document.getElementById('studio-context');
		const toggle = document.getElementById('studio-context-toggle');
		const sidebarToggle = document.getElementById('sidebar-collapse-toggle');
		const advancedTools = document.getElementById('sidebar-tools');
		const setSidebarState = (nextState, persist = true) => {
			const collapsed = nextState === 'collapsed';
			if (collapsed && advancedTools?.open) advancedTools.open = false;
			document.documentElement.dataset.qaseSidebar = collapsed ? 'collapsed' : 'expanded';
			if (sidebarToggle) {
				sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
				sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand recent tests sidebar' : 'Collapse recent tests sidebar');
				sidebarToggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
			}
			if (persist) {
				try { localStorage.setItem(sidebarPreferenceKey, collapsed ? 'collapsed' : 'expanded'); } catch {}
			}
		};
		setSidebarState(document.documentElement.dataset.qaseSidebar, false);
		sidebarToggle?.addEventListener('click', () => {
			setSidebarState(document.documentElement.dataset.qaseSidebar === 'collapsed' ? 'expanded' : 'collapsed');
		});
		advancedTools?.addEventListener('toggle', () => {
			if (advancedTools.open && document.documentElement.dataset.qaseSidebar === 'collapsed') {
				setSidebarState('expanded');
			}
		});
		if (project) project.textContent = context.project;
		if (target) {
			target.href = context.targetUrl;
			target.textContent = new URL(context.targetUrl).host;
		}
		if (!contextPanel || !toggle) return;
		toggle.addEventListener('click', () => {
			const collapsed = document.documentElement.dataset.studioContext === 'collapsed';
			document.documentElement.dataset.studioContext = collapsed ? 'expanded' : 'collapsed';
			toggle.setAttribute('aria-expanded', String(collapsed));
			toggle.textContent = collapsed ? 'Hide context' : 'Show context';
		});
	});
})();
