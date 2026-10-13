import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [markup, workspaceStyles, embedStyles] = await Promise.all([
	readFile(new URL('./index.html', import.meta.url), 'utf8'),
	readFile(new URL('./studio-workspace.css', import.meta.url), 'utf8'),
	readFile(new URL('./studio-embed.css', import.meta.url), 'utf8')
]);

test('preview identity, state and appearance share one right-panel toolbar', () => {
	const viewerHead = markup.slice(markup.indexOf('<header class="panel-head" data-path="~/qase/browser.preview">'), markup.indexOf('<div class="stage" id="stage">'));
	assert.match(viewerHead, /class="viewer-head-identity"/);
	assert.match(viewerHead, /class="viewer-head-actions"/);
	assert.match(viewerHead, /id="ldv-live"/);
	assert.match(viewerHead, /id="theme-toggle"/);
	assert.doesNotMatch(markup.slice(markup.indexOf('<main class="panel chat"'), markup.indexOf('<section class="run-summary"')), /id="theme-toggle"/);
});

test('address and preview-size controls form one compact row', () => {
	assert.match(markup, /class="viewer-address-row"[\s\S]+class="urlbar"[\s\S]+id="stage-toggle"/);
	assert.match(workspaceStyles, /\.viewer-address-row[\s\S]*?display: flex/);
	assert.match(workspaceStyles, /\.viewer \.preview-toggle \{ flex: 0 0 36px/);
});

test('right-panel controls retain mobile touch targets', () => {
	assert.match(workspaceStyles, /@media \(max-width: 720px\)[\s\S]+\.viewer \.theme-toggle[^{]*\{[^}]+width: 44px[^}]+min-height: 44px/s);
	assert.match(workspaceStyles, /@media \(max-width: 720px\)[\s\S]+\.viewer \.preview-toggle[^{]*\{[^}]+width: 44px[^}]+height: 44px/s);
});

test('Studio host keeps the sole embedded theme control', () => {
	assert.match(markup, /id="studio-theme-select"[^>]+data-theme-control/);
	assert.match(embedStyles, /data-qase-layout="studio-mock"[^}]+\.viewer \.theme-toggle[^{]*\{[^}]+display: none/s);
});
