/**
 * matrixColumns — browser-brand column renderer for the device & browser
 * matrix (M4 #14423).
 *
 * Renders M2's buildBrowserColumns output into #mx-columns: one column per
 * compatible browser brand with an inline SVG brand icon, name, scrollable
 * version list (channel labels via the browserChannels mirror), favorite star
 * per version, More control, honest availability/execution labels.
 *
 * Brand glyphs are simplified inline SVG approximations of the official marks
 * in official brand colors — CSP-safe (no CDN, no runtime fetch).
 */

import { channelFor } from './browserChannels.js';

const CHANNEL_LABEL = { stable: 'STABLE', beta: 'BETA', dev: 'DEV', canary: 'CANARY', nightly: 'NIGHTLY' };

/** Brand icons: simplified official-shape approximations, official colors. */
function brandIcon(code, size = 18) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', String(size));
	svg.setAttribute('height', String(size));
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('mx-brand-icon');
	switch (code) {
		case 'chrome':
			svg.innerHTML = '<circle cx="12" cy="12" r="10" fill="#fff"/><circle cx="12" cy="12" r="10" fill="none" stroke="#4285F4" stroke-width="0"/><path d="M12 2a10 10 0 0 1 8.66 5H12a5 5 0 0 0-4.9 6.05L3.4 7.5A10 10 0 0 1 12 2Z" fill="#EA4335"/><path d="M20.66 7A10 10 0 0 1 12 22l4.66-8.06A5 5 0 0 0 17.5 7Z" fill="#FBBC05"/><path d="M12 22A10 10 0 0 1 3.4 7.5l4.66 8.07A5 5 0 0 0 16.66 14Z" fill="#34A853"/><circle cx="12" cy="12" r="4.2" fill="#4285F4"/>';
			break;
		case 'firefox':
			svg.innerHTML = '<circle cx="12" cy="12" r="10" fill="#FF7139"/><path d="M12 4c-4.4 0-8 3.6-8 8 0 3.1 1.8 5.8 4.4 7.1-.9-1.6-1.1-3.5-.3-5.3.7-1.7 2.2-3 4-3.4-1.5.6-2.5 2-2.5 3.6 0 2.2 1.8 4 4 4s4-1.8 4-4c0-.5-.1-1-.3-1.5 1.1 1 1.8 2.4 1.9 3.9.5-1.1.8-2.3.8-3.6 0-4.4-3.6-8-8-8Z" fill="#FFCF00" opacity=".9"/><circle cx="12" cy="13" r="2.6" fill="#FF3860" opacity=".55"/>';
			break;
		case 'edge':
			svg.innerHTML = '<path d="M18.9 13.6c.1-.5.1-1 .1-1.6 0-4-3-6.9-7-6.9-2.8 0-5.2 1.6-6.4 3.9 1-.6 2.2-.9 3.5-.9 3.2 0 5.9 1.7 7.1 4.4.8 1.8 2.4 1.6 2.7.1Z" fill="#35B5F0"/><path d="M3.4 9.6C2.5 10.8 2 12.3 2 14c0 3.9 3.1 7 7 7h9.4c1.7 0 3.2-1.1 3.7-2.7-1.7 1.1-3.9 1.2-5.7.1-2.6-1.5-4.5-3.9-5.4-6.6-.9-2.6-4.1-3.5-6.1-1.7l-1.5 1.5Z" fill="#0F7EBE"/><path d="M11 11.8c.9 2.7 2.8 5.1 5.4 6.6 1.8 1.1 4 1 5.7-.1.1-.3.1-.6.1-.9 0-1.6-.5-3-1.4-4.2-.3 1.5-1.9 1.7-2.7-.1C16.9 10.5 14.2 8.8 11 8.8c-1.3 0-2.5.3-3.5.9.9-.5 2.4-1 3.5.2Z" fill="#42C68B"/>';
			break;
		case 'opera':
			svg.innerHTML = '<circle cx="12" cy="12" r="10" fill="#FF1B2D"/><path d="M12 4.5c-2.6 0-4.7 3.4-4.7 7.5s2.1 7.5 4.7 7.5c1.4 0 2.7-1.1 3.5-2.9-1.9 1.2-4.9.3-4.9-4.6s3-5.8 4.9-4.6c-.8-1.8-2.1-2.9-3.5-2.9Z" fill="#fff" opacity=".92"/><circle cx="12" cy="12" r="7.4" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/>';
			break;
		case 'brave':
			svg.innerHTML = '<path d="M12 3.2 14.6 2l2.9 1.3 3.4 1.5-1 3.1.7 2.1-2.6 7.6c-.4 1.1-1 1.5-2 1.8l-2.3.8-1.7.8-1.7-.8-2.3-.8c-1-.3-1.6-.7-2-1.8L3.4 10l.7-2.1-1-3.1L6.5 3.3 9.4 2 12 3.2Z" fill="#FB542B"/><path d="M12 6.2c-2.4 0-4.2 1.9-4.2 4.4 0 2.9 2 5.9 4.2 7.2 2.2-1.3 4.2-4.3 4.2-7.2 0-2.5-1.8-4.4-4.2-4.4Zm0 2.1c1.2 0 2.1 1 2.1 2.3s-.9 2.3-2.1 2.3-2.1-1-2.1-2.3.9-2.3 2.1-2.3Z" fill="#fff"/>';
			break;
		case 'duckduckgo':
			svg.innerHTML = '<circle cx="12" cy="12" r="10" fill="#DE5833"/><circle cx="12" cy="12" r="9.2" fill="#fff"/><path d="M14.7 5.7c1.9.7 3.1 2.5 3.4 4.6.2 1.9-.3 3.9-1.6 5.1.2-1.6-.3-3.1-1.4-3.8.5 1.7.2 3.6-1 4.9-1.9 2-5.1 2.3-7.2.7 1.5.2 3.1-.4 3.9-1.5-1.2.2-2.5-.4-3-1.4 1.3.3 2.7-.4 3.2-1.5-1.4-.4-2.3-1.7-2.2-3 .6 1 1.8 1.5 2.9 1.3-.9-1.5-.4-3.5 1.2-4.2-.5 1.1 0 2.4 1 3-.3-2.3 1.3-4.4 3.6-4.5-.9.6-1.3 1.7-1 2.7.1-.6.7-1.1 1.4-1 .6.1 1.1.6 1.1 1.2-.8-1.7-2.8-2.5-4.3-1.6Z" fill="#DE5833"/>';
			break;
		case 'safari':
			svg.innerHTML = '<circle cx="12" cy="12" r="10" fill="#19B5F1"/><circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width=".9"/><path d="M16.8 7.2 10.2 10.2 7.2 16.8 13.8 13.8 16.8 7.2Z" fill="#fff"/><path d="M16.8 7.2 13.8 13.8 7.2 16.8 10.2 10.2 16.8 7.2Z" fill="#F6283C" transform="rotate(180 12 12)"/>';
			break;
		default:
			svg.innerHTML = '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>';
	}
	return svg;
}

export function createMatrixColumns({ container, emptyState, favoritesStore, recentsStore, onSelectVersion }) {
	if (!container) return null;
	const state = {
		columns: [],
		selectedEnvId: null,
		windows: new Map() // browserCode → count of revealed rows
	};

	function starButton(code, version, isFav) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = `mx-star${isFav ? ' is-fav' : ''}`;
		btn.setAttribute('aria-label', `${isFav ? 'Unfavorite' : 'Favorite'} ${code} ${version}`);
		btn.setAttribute('aria-pressed', String(Boolean(isFav)));
		btn.textContent = isFav ? '★' : '☆';
		btn.onclick = (event) => {
			event.stopPropagation();
			favoritesStore?.toggle?.(`version:${code}:${version}`);
			render();
		};
		return btn;
	}

	function renderRow(column, row) {
		const el = document.createElement('button');
		el.type = 'button';
		el.className = `mx-version${row.envId === state.selectedEnvId ? ' is-selected' : ''}${row.available ? '' : ' is-unavailable'}`;
		// Unavailable rows stay SELECTABLE (the user must see the honest
		// REAL DEVICE UNAVAILABLE state + reason); EXECUTION is what's blocked,
		// at run start via the fallback dialog and the server's availability
		// guard (#14490–R3). aria-disabled would wrongly imply the row cannot
		// even be inspected.
		const head = document.createElement('span');
		head.className = 'mx-version-head';
		const ver = document.createElement('span');
		ver.className = 'mx-version-num';
		ver.textContent = row.version;
		const channel = document.createElement('span');
		channel.className = `mx-channel mx-channel--${row.channel}`;
		channel.textContent = CHANNEL_LABEL[row.channel] ?? row.channel.toUpperCase();
		head.append(ver, channel);
		const meta = document.createElement('span');
		meta.className = 'mx-version-meta';
		const level = row.executionType ? String(row.executionType).toUpperCase().replace(/_/g, ' ') : 'VIRTUAL DEVICE';
		// #14632 (NI01 Phase 2): provider-derived browser executability wins.
		// NOT SUPPORTED (e.g. DuckDuckGo — no execution provider) and
		// ENGINE-EQUIVALENT (Opera/Brave on Chromium, Safari on WebKit
		// locally) are shown with their reason; never as plain availability.
		if (row.status === 'NOT_SUPPORTED') {
			meta.textContent = 'NOT SUPPORTED';
			el.title = row.browserSupport?.reason ?? 'No execution provider can run this browser.';
		} else if (row.browserSupport?.status === 'engine_equivalent') {
			meta.textContent = `${level} · ENGINE-EQUIVALENT (${(row.browserSupport.engine ?? 'chromium').toUpperCase()})`;
			el.title = row.browserSupport.reason;
		} else {
			meta.textContent = row.available
				? `${level}${row.status && row.status !== 'AVAILABLE' ? ` · ${row.status}` : ''}`
				: 'REAL DEVICE UNAVAILABLE';
		}
		el.append(head, meta);
		el.appendChild(starButton(column.browserCode, row.version, row.favorite));
		el.onclick = () => {
			// Selection is allowed for unavailable rows (honest state shown);
			// startEnvironmentRun blocks execution via the fallback dialog.
			state.selectedEnvId = row.envId;
			onSelectVersion?.(row.env, column, row);
			render();
		};
		return el;
	}

	function renderColumn(column) {
		const el = document.createElement('div');
		el.className = 'mx-col';
		el.setAttribute('role', 'group');
		el.setAttribute('aria-label', `${column.browser} versions`);
		const head = document.createElement('div');
		head.className = 'mx-col-head';
		head.appendChild(brandIcon(column.browserCode));
		const name = document.createElement('span');
		name.className = 'mx-col-name';
		name.textContent = column.browser;
		head.appendChild(name);
		if (column.webkitNote) {
			const note = document.createElement('span');
			note.className = 'mx-webkit-note';
			note.textContent = 'WebKit';
			note.title = 'Runs on the required WebKit engine on iOS/iPadOS';
			head.appendChild(note);
		}
		el.appendChild(head);
		const list = document.createElement('div');
		list.className = 'mx-version-list';
		const window = state.windows.get(column.browserCode) ?? 6;
		const visible = column.rows.slice(0, window);
		for (const row of visible) list.appendChild(renderRow(column, row));
		if (column.rows.length > visible.length) {
			const more = document.createElement('button');
			more.type = 'button';
			more.className = 'mx-more';
			more.textContent = `More (${column.rows.length - visible.length})`;
			more.onclick = () => {
				state.windows.set(column.browserCode, window + 8);
				render();
			};
			list.appendChild(more);
		}
		el.appendChild(list);
		return el;
	}

	function render() {
		container.textContent = '';
		if (!state.columns.length) {
			container.hidden = true;
			if (emptyState) emptyState.hidden = false;
			return;
		}
		container.hidden = false;
		if (emptyState) emptyState.hidden = true;
		for (const column of state.columns) {
			// Refresh favorite flags from the live store so a star toggle
			// re-renders immediately (state.columns is otherwise a snapshot).
			const favList = favoritesStore?.list?.() ?? [];
			for (const row of column.rows) row.favorite = favList.includes(`version:${column.browserCode}:${row.version}`);
			container.appendChild(renderColumn(column));
		}
	}

	return {
		setColumns(columns, selectedEnvId = null) {
			state.columns = columns ?? [];
			state.selectedEnvId = selectedEnvId;
			state.windows.clear();
			render();
		},
		setSelectedEnvId(envId) {
			state.selectedEnvId = envId ?? null;
			render();
		},
		render
	};
}
