/**
 * Deterministic test case replay engine.
 *
 * Executes a saved test case's steps in a real Playwright Chromium browser —
 * no agent loop, no LLM cost. Each step is performed in sequence, assertions
 * are validated after execution, and failures capture screenshots for evidence.
 *
 * Credential placeholders ({{QA_PASSWORD}} etc.) are resolved from either a
 * provided credentials map or the session's secret vault.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getConfig, resolveViewport } from './config.js';
import { getBaseline, setBaseline, autoCaptureBaselines } from './baselines.js';
import { isSelectorFailure, capturePageDom, analyzeFailure, patchTestCase, createHealRecord } from './selfHeal.js';
import { updateTestCase } from './testCases.js';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(__dirname, '..', '.qase', 'artifacts');

const STEP_TIMEOUT_MS = Number(process.env.QASE_REPLAY_STEP_TIMEOUT ?? 10_000);
const NAV_TIMEOUT_MS = Number(process.env.QASE_REPLAY_NAV_TIMEOUT ?? 15_000);

/* ── Artifact persistence ───────────────────────────────────────── */

/**
 * Saves a screenshot buffer to disk as a JPEG file.
 * Returns both the relative file path (for persistence) and the data URL
 * (for immediate display in the current run).
 */
function saveScreenshot(runId, stepIndex, buf) {
	const dir = join(ARTIFACTS_DIR, runId);
	mkdirSync(dir, { recursive: true });
	const filename = `step-${stepIndex}.jpeg`;
	writeFileSync(join(dir, filename), buf);
	const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
	return { filename, path: `${runId}/${filename}`, dataUrl };
}

/* ── Credential resolution ──────────────────────────────────────── */

const PLACEHOLDER = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

/**
 * Resolves {{PLACEHOLDER}} patterns in a string using a provided credentials
 * map (from the API request body) or an external resolver function.
 */
function resolveValue(value, credentials) {
	if (typeof value !== 'string' || !credentials) {
		return value;
	}
	return value.replace(PLACEHOLDER, (match, name) => {
		const key = name.toUpperCase();
		return credentials[key] ?? credentials[name] ?? match;
	});
}

/* ── Browser launch ─────────────────────────────────────────────── */

const BROWSERSTACK_OS_MAP = {
	chrome: { browser: 'chrome', os: 'OS X', os_version: 'Sonoma' },
	firefox: { browser: 'firefox', os: 'OS X', os_version: 'Sonoma' },
	safari: { browser: 'Safari', os: 'OS X', os_version: 'Sonoma' }
};

async function launchBrowser(opts = {}) {
	const config = getConfig();

	// ── BrowserStack CDP path ──
	if (config.browserstackEnabled && config.browserstackUser && config.browserstackKey) {
		const browserType = opts.browser || 'chrome';
		const osInfo = BROWSERSTACK_OS_MAP[browserType] || BROWSERSTACK_OS_MAP.chrome;
		const caps = {
			browser: osInfo.browser,
			os: osInfo.os,
			os_version: osInfo.os_version,
			'browserstack.user': config.browserstackUser,
			'browserstack.key': config.browserstackKey,
			'name': opts.testName || `Qase test run`,
			'browserstack.local': 'false'
		};
		const cdpUrl = `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
		try {
			const browser = await chromium.connectOverCDP(cdpUrl);
			return browser;
		} catch (error) {
			console.warn(`[BrowserStack] CDP connection failed, falling back to local: ${error.message}`);
		}
	}

	// ── Local Chromium path (default / fallback) ──
	const launchOptions = {
		headless: config.headless !== false,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
	};

	const exe = findBrowserExecutable();
	if (exe) {
		launchOptions.executablePath = exe;
	}

	return chromium.launch(launchOptions);
}

/**
 * Checks if a file is a valid ELF binary (not corrupted).
 */
function isValidElf(filePath) {
	try {
		const fd = fs.openSync(filePath, 'r');
		const header = Buffer.alloc(4);
		fs.readSync(fd, header, 0, 4, 0);
		fs.closeSync(fd);
		return header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46;
	} catch {
		return false;
	}
}

/**
 * Finds a working browser executable:
 * 1. Playwright default chromium (if valid ELF)
 * 2. chrome-headless-shell in playwright cache (if valid ELF)
 * 3. System Chrome/Chromium
 */
function findBrowserExecutable() {
	// 1. Try Playwright default.
	try {
		const defaultPath = chromium.executablePath();
		if (defaultPath && existsSyncSafe(defaultPath) && isValidElf(defaultPath)) {
			return defaultPath;
		}
	} catch { /* ignore */ }

	// 2. Scan for chrome-headless-shell in playwright cache.
	try {
		const cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright');
		if (existsSyncSafe(cacheDir)) {
			const dirs = readdirSyncSafe(cacheDir)
				.filter(name => name.startsWith('chromium_headless_shell-'))
				.sort().reverse();
			for (const dir of dirs) {
				const bin = path.join(cacheDir, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
				if (existsSyncSafe(bin) && isValidElf(bin)) {
					return bin;
				}
			}
		}
	} catch { /* ignore */ }

	// 3. System Chrome/Chromium fallback.
	// /usr/bin/google-chrome-stable and /opt/google/chrome/google-chrome are both wrapper
	// scripts — the real ELF binary is /opt/google/chrome/chrome. Resolve symlinks and
	// check known binary locations.
	const systemBinaries = [
		'/opt/google/chrome/chrome',              // Real binary (ELF)
		'/usr/bin/google-chrome-stable',           // Wrapper (symlink)
		'/usr/bin/google-chrome',                  // Wrapper (symlink)
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser'
	];
	for (const sysBin of systemBinaries) {
		if (!existsSyncSafe(sysBin)) continue;
		// Try the path directly first
		if (isValidElf(sysBin)) return sysBin;
		// Try resolving symlink
		try {
			const resolved = fs.realpathSync(sysBin);
			if (isValidElf(resolved)) return resolved;
			// The wrapper script's directory likely has the real binary
			const dir = path.dirname(resolved);
			const realBin = path.join(dir, 'chrome');
			if (isValidElf(realBin)) return realBin;
		} catch { /* ignore */ }
	}

	return undefined;
}

function existsSyncSafe(p) {
	try { return fs.existsSync(p); } catch { return false; }
}
function readdirSyncSafe(dir) {
	try { return fs.readdirSync(dir); } catch { return []; }
}

/* ── Step execution ─────────────────────────────────────────────── */

/**
 * Executes a single test step against the page.
 * Returns { status, error, durationMs }.
 */
async function executeStep(page, step, credentials, baseUrl) {
	const start = Date.now();
	const target = step.target;
	const value = resolveValue(step.value, credentials);

	try {
		switch (step.action) {
			case 'navigate': {
				let url = target || value;
				if (!url) return fail('No URL to navigate to');
				url = resolveUrl(url, baseUrl);
				await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
				break;
			}
			case 'click': {
				if (!target) return fail('No selector to click');
				await page.locator(target).first().click({ timeout: STEP_TIMEOUT_MS });
				await page.waitForTimeout(500);
				break;
			}
			case 'fill': {
				if (!target) return fail('No selector to fill');
				await page.locator(target).first().fill(value ?? '', { timeout: STEP_TIMEOUT_MS });
				break;
			}
			case 'type': {
				if (!target) return fail('No selector to type into');
				await page.locator(target).first().pressSequentially(value ?? '', { delay: 30, timeout: STEP_TIMEOUT_MS });
				break;
			}
			case 'select': {
				if (!target) return fail('No selector to select');
				await page.locator(target).first().selectOption(value ?? '', { timeout: STEP_TIMEOUT_MS });
				break;
			}
			case 'check': {
				if (!target) return fail('No selector to check');
				await page.locator(target).first().check({ timeout: STEP_TIMEOUT_MS });
				break;
			}
			case 'key': {
				await page.keyboard.press(value || target || 'Enter', { timeout: STEP_TIMEOUT_MS });
				await page.waitForTimeout(500);
				break;
			}
			case 'scroll': {
				if (target) {
					await page.locator(target).first().scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT_MS });
				} else {
					await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
				}
				break;
			}
			case 'hover': {
				if (!target) return fail('No selector to hover');
				await page.locator(target).first().hover({ timeout: STEP_TIMEOUT_MS });
				break;
			}
			case 'reload': {
				// Phase 18: original repro steps may explicitly reload the page.
				await page.reload({ timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
				break;
			}
			case 'screenshot':
			case 'snapshot':
				// No-op action — these are observational, not interactive.
				break;
			case 'diagnostics':
				// No-op — assertions will check console/network.
				break;
			case 'wait':
				await page.waitForTimeout(Number(value) || Number(step.ms) || 1000);
				break;
			default:
				return fail(`Unknown action: ${step.action}`);
		}

		return { status: 'pass', error: undefined, durationMs: Date.now() - start };
	} catch (error) {
		return { status: 'fail', error: error.message, durationMs: Date.now() - start };
	}
}

function fail(message) {
	return { status: 'fail', error: message, durationMs: 0 };
}

/**
 * Resolves a possibly-relative URL against the test case's targetUrl.
 * "/login" + "https://app.example.com" → "https://app.example.com/login"
 */
function resolveUrl(url, baseUrl) {
	if (!url) return url;
	if (/^https?:\/\//i.test(url)) return url;
	if (!baseUrl) return url;
	try {
		return new URL(url, baseUrl).href;
	} catch {
		return url;
	}
}

/* ── Assertion evaluation ───────────────────────────────────────── */

/**
 * Collects console errors and failed network requests during the run.
 */
function createCollector() {
	const consoleErrors = [];
	const failedRequests = [];

	function attach(page) {
		page.on('console', msg => {
			if (msg.type() === 'error') {
				consoleErrors.push(msg.text());
			}
		});
		page.on('requestfailed', req => {
			failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
		});
		page.on('response', res => {
			if (res.status() >= 400) {
				failedRequests.push({ url: res.url(), status: res.status() });
			}
		});
	}

	return { consoleErrors, failedRequests, attach };
}

/**
 * Evaluates a single assertion against the page + collected data.
 * Returns { passed, actual, expected }.
 */
async function evaluateAssertion(page, assertion, collector, runContext = {}) {
	const target = assertion.target;
	const expected = assertion.expected ?? '';

	try {
		switch (assertion.type) {
			case 'url_is': {
				const actual = page.url();
				return { passed: actual === expected, actual, expected };
			}
			case 'url_contains': {
				const actual = page.url();
				return { passed: actual.includes(expected), actual, expected };
			}
			case 'element_visible': {
				if (!target) return { passed: false, actual: 'no target', expected };
				const locator = page.locator(target).first();
				const visible = await locator.isVisible().catch(() => false);
				return { passed: visible, actual: visible ? 'visible' : 'not visible', expected: 'visible' };
			}
			case 'element_hidden': {
				if (!target) return { passed: false, actual: 'no target', expected };
				const locator = page.locator(target).first();
				const visible = await locator.isVisible().catch(() => false);
				return { passed: !visible, actual: visible ? 'visible' : 'hidden', expected: 'hidden' };
			}
			case 'element_text': {
				if (!target) return { passed: false, actual: 'no target', expected };
				const text = await page.locator(target).first().textContent({ timeout: STEP_TIMEOUT_MS }).catch(() => '');
				const contains = (text ?? '').includes(expected);
				return { passed: contains, actual: (text ?? '').trim().slice(0, 200), expected };
			}
			case 'element_enabled': {
				if (!target) return { passed: false, actual: 'no target', expected };
				const enabled = await page.locator(target).first().isEnabled().catch(() => false);
				return { passed: enabled, actual: enabled ? 'enabled' : 'disabled', expected: 'enabled' };
			}
			case 'no_console_errors': {
				const errors = collector.consoleErrors;
				return {
					passed: errors.length === 0,
					actual: errors.length === 0 ? 'no errors' : `${errors.length} errors: ${errors.slice(0, 3).join('; ')}`,
					expected: 'no console errors'
				};
			}
			case 'no_failed_requests': {
				const failed = collector.failedRequests;
				return {
					passed: failed.length === 0,
					actual: failed.length === 0 ? 'no failures' : `${failed.length} failed: ${failed.slice(0, 3).map(f => f.url).join('; ')}`,
					expected: 'no failed requests'
				};
			}
			case 'status_code': {
				// This checks the last navigation's response status.
				const response = await page.goto(page.url(), { timeout: NAV_TIMEOUT_MS }).catch(() => null);
				const code = response?.status() ?? 0;
				return { passed: String(code) === String(expected), actual: String(code), expected };
			}
			case 'visual_match': {
				return await evaluateVisualMatch(page, assertion, runContext);
			}
			case 'custom':
			default:
				return { passed: true, actual: 'skipped (custom)', expected };
		}
	} catch (error) {
		return { passed: false, actual: error.message, expected };
	}
}

/* ── Visual regression ──────────────────────────────────────────── */

/**
 * Evaluates a visual_match assertion by comparing the current page screenshot
 * against a stored baseline. If no baseline exists, the current screenshot
 * becomes the baseline (auto-capture) and the assertion passes.
 *
 * @param {object} page - Playwright page
 * @param {object} assertion - { type: 'visual_match', threshold: 0.001, label: 'step-0' }
 * @param {object} runContext - { runId, testCaseId }
 */
async function evaluateVisualMatch(page, assertion, runContext) {
	const { runId, testCaseId } = runContext;
	const label = assertion.label || 'visual';
	const threshold = assertion.threshold ?? 0.001; // 0.1% default

	// Capture current screenshot as PNG for pixel-accurate diffing.
	const currentPngBuf = await page.screenshot({ type: 'png' });
	const currentImg = PNG.sync.read(currentPngBuf);

	// Save the current screenshot as an artifact.
	const runDir = join(ARTIFACTS_DIR, runId);
	mkdirSync(runDir, { recursive: true });
	const currentPath = join(runDir, `${label}-current.png`);
	writeFileSync(currentPath, currentPngBuf);

	// Check for existing baseline.
	const baseline = getBaseline(testCaseId, label);

	if (!baseline) {
		// Auto-capture: promote current screenshot to baseline.
		setBaseline(testCaseId, label, `${runId}/${label}-current.png`, {
			approvedBy: 'auto',
			ts: Date.now()
		});
		return {
			passed: true,
			actual: 'baseline auto-captured',
			expected: 'visual match (new baseline)',
			visual: { pixelDiff: 0, totalPixels: 0, pctChanged: 0, isNew: true }
		};
	}

	// Load baseline image.
	const baselineAbs = join(ARTIFACTS_DIR, baseline.artifactPath);
	if (!existsSync(baselineAbs)) {
		return {
			passed: false,
			actual: 'baseline file missing',
			expected: 'visual match',
			visual: { error: 'baseline file not found' }
		};
	}

	const baselineImg = PNG.sync.read(readFileSync(baselineAbs));

	// Resize comparison: pixelmatch requires same dimensions. Resize current
	// to match baseline if they differ.
	const width = Math.min(baselineImg.width, currentImg.width);
	const height = Math.min(baselineImg.height, currentImg.height);
	const totalPixels = width * height;

	// Create diff image buffer.
	const diffImg = new PNG({ width, height });

	const pixelDiff = pixelmatch(
		baselineImg.data, currentImg.data, diffImg.data,
		width, height,
		{ threshold: 0.1 } // per-pixel color sensitivity (0-1)
	);

	const pctChanged = totalPixels > 0 ? pixelDiff / totalPixels : 0;
	const passed = pctChanged <= threshold;

	// Save diff image as artifact.
	const diffPath = join(runDir, `${label}-diff.png`);
	writeFileSync(diffPath, PNG.sync.write(diffImg));

	return {
		passed,
		actual: `${(pctChanged * 100).toFixed(2)}% changed (${pixelDiff} pixels)`,
		expected: `≤ ${(threshold * 100).toFixed(2)}% change`,
		visual: {
			pixelDiff,
			totalPixels,
			pctChanged,
			threshold,
			baselinePath: baseline.artifactPath,
			currentPath: `${runId}/${label}-current.png`,
			diffPath: `${runId}/${label}-diff.png`,
			isNew: false
		}
	};
}

/* ── Main replay function ───────────────────────────────────────── */

/**
 * Runs a single test case against the target site.
 *
 * @param {object} testCase  — the test case with steps + assertions
 * @param {object} options   — { credentials, onProgress }
 * @returns {Promise<ReplayResult>}
 */
export async function runTestCase(testCase, { credentials, onProgress, attempt = 1, viewport, browser: browserType } = {}) {
	const startTime = Date.now();
	const collector = createCollector();
	const stepResults = [];
	const assertionResults = [];
	const screenshots = [];
	const screenshotPaths = [];

	const result = {
		id: randomUUID(),
		testCaseId: testCase.id,
		testCaseName: testCase.name,
		ts: startTime,
		result: 'pass',
		flaky: false,
		attempt,
		viewport: resolveViewport(viewport ?? testCase.viewport),
		browser: browserType || 'chromium',
		durationMs: 0,
		stepResults,
		assertionResults,
		screenshots,
		tracePath: undefined,
		error: undefined
	};

	let browser;
	let context;

	try {
		browser = await launchBrowser({ testName: testCase.name, browser: browserType });
		// Use a context so we can enable trace recording.
		const vp = resolveViewport(viewport ?? testCase.viewport);
		context = await browser.newContext({
			viewport: { width: vp.width, height: vp.height }
		});
		await context.tracing.start({
			screenshots: true,
			snapshots: true,
			sources: true
		});
		const page = await context.newPage();
		collector.attach(page);

	// Execute steps.
	for (const [i, step] of (testCase.steps ?? []).entries()) {
		const stepResult = await executeStep(page, step, credentials, testCase.targetUrl);
			stepResults.push({
				stepIndex: i,
				action: step.action,
				status: stepResult.status,
				error: stepResult.error,
				durationMs: stepResult.durationMs
			});

			if (onProgress) {
				onProgress({ phase: 'step', index: i, ...stepResult });
			}

			if (stepResult.status === 'fail') {
				// Capture screenshot on failure — persist to disk.
				try {
					const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
					const saved = saveScreenshot(result.id, i, buf);
					screenshots.push({
						stepIndex: i,
						label: `Step ${i + 1}: ${step.action} failed`,
						dataUrl: saved.dataUrl,
						artifactPath: saved.path
					});
					screenshotPaths.push(saved.path);
				} catch {
					// Screenshot capture is best-effort.
				}

				// Capture DOM snapshot for potential self-healing.
				if (isSelectorFailure(stepResult)) {
					try {
						result._domSnapshot = await capturePageDom(page);
						result._failedStepIndex = i;
						result._failedStep = { ...step };
					} catch {
						// DOM capture is best-effort.
					}
				}

				result.result = 'fail';
				break;
			}
		}

		// Evaluate assertions (only if no step failed).
		if (result.result !== 'fail') {
			// Allow a short settle for async rendering.
			await page.waitForTimeout(800);

			const runContext = { runId: result.id, testCaseId: testCase.id };

			for (const [i, assertion] of (testCase.assertions ?? []).entries()) {
				const evalResult = await evaluateAssertion(page, assertion, collector, runContext);
				assertionResults.push({
					index: i,
					type: assertion.type,
					passed: evalResult.passed,
					actual: evalResult.actual,
					expected: evalResult.expected,
					description: assertion.description,
					visual: evalResult.visual
				});

				if (onProgress) {
					onProgress({ phase: 'assertion', index: i, ...evalResult });
				}

				if (!evalResult.passed) {
					result.result = 'fail';
					// Capture screenshot for assertion failure — persist to disk.
					// For visual_match failures, the diff image is already saved.
					if (assertion.type !== 'visual_match') {
						try {
							const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
							const saved = saveScreenshot(result.id, `assert-${i}`, buf);
							screenshots.push({
								stepIndex: -1,
								label: `Assertion ${i + 1}: ${assertion.type} failed`,
								dataUrl: saved.dataUrl,
								artifactPath: saved.path
							});
							screenshotPaths.push(saved.path);
						} catch {
							// Best-effort.
						}
					}
				}
			}
		}

		await page.close();
	} catch (error) {
		result.result = 'error';
		result.error = error.message;
	} finally {
		// Stop trace recording and save as artifact.
		if (context) {
			try {
				const traceDir = join(ARTIFACTS_DIR, result.id);
				mkdirSync(traceDir, { recursive: true });
				const traceFile = join(traceDir, 'trace.zip');
				await context.tracing.stop({ path: traceFile });
				result.tracePath = `${result.id}/trace.zip`;
			} catch {
				// Trace is best-effort.
			}
		}
		await browser?.close().catch(() => {});
	}

	result.durationMs = Date.now() - startTime;
	// Attach screenshot file paths for persistence (used by replayStore).
	result.screenshotPaths = screenshotPaths;

	// Auto-capture baselines for passing runs that have screenshots.
	if (result.result === 'pass' && screenshotPaths.length > 0) {
		try {
			autoCaptureBaselines(testCase.id, screenshots.map((s, i) => ({
				label: s.stepIndex >= 0 ? `step-${s.stepIndex}` : `screenshot-${i}`,
				artifactPath: s.artifactPath
			})));
		} catch {
			// Baseline auto-capture is best-effort.
		}
	}

	return result;
}

/**
 * Runs a single test case with retry logic.
 *
 * If the test fails (result='fail', not 'error'), it is retried up to
 * `retries` times. If a retry passes, the test is marked `flaky: true`
 * with `result: 'pass'`.
 *
 * @returns {Promise<object>} final result with attempt/flaky fields set.
 */
/** Removes internal healing artifacts from the result before returning. */
function cleanHealArtifacts(result) {
	if (!result) return result;
	delete result._domSnapshot;
	delete result._failedStepIndex;
	delete result._failedStep;
	return result;
}

async function runWithRetry(testCase, { credentials, onProgress, retries = 0, viewport, browser } = {}) {
	const maxAttempts = retries + 1;
	let lastResult;
	let healingApplied = false;
	let healedSteps = null;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		lastResult = await runTestCase(testCase, {
			credentials,
			onProgress,
			attempt,
			viewport,
			browser
		});

		// Pass → done. If it took more than 1 attempt, mark flaky.
		if (lastResult.result === 'pass') {
			if (attempt > 1) {
				lastResult.flaky = true;
			}
			// Persist healed selectors if healing was applied and test now passes.
			if (healingApplied && healedSteps && testCase.id) {
				try {
					updateTestCase(testCase.id, { steps: healedSteps });
					lastResult.healed = true;
					console.log(`[selfHeal] Persisted healed selectors to test case "${testCase.name}".`);
				} catch (error) {
					console.warn(`[selfHeal] Failed to persist healed selectors: ${error.message}`);
				}
			}
			cleanHealArtifacts(lastResult);
			return lastResult;
		}

		// Error → infrastructure issue, don't retry.
		if (lastResult.result === 'error') {
			cleanHealArtifacts(lastResult);
			return lastResult;
		}

		// Fail → attempt self-healing before retry (first failure only).
		if (attempt === 1 && lastResult._domSnapshot && lastResult._failedStep) {
			const config = getConfig();
			if (config.selfHealEnabled !== false) {
				try {
					console.log(`[selfHeal] Analyzing failure for "${testCase.name}" step ${lastResult._failedStepIndex}…`);
					const analysis = await analyzeFailure(
						testCase,
						lastResult._failedStep,
						lastResult._domSnapshot,
						lastResult.stepResults[lastResult._failedStepIndex]?.error || 'Unknown error'
					);

					const threshold = config.selfHealThreshold ?? 0.8;
					if (analysis.newSelector && analysis.confidence >= threshold) {
						console.log(`[selfHeal] Healed selector: "${lastResult._failedStep.target}" → "${analysis.newSelector}" (confidence: ${analysis.confidence})`);
						// Patch the test case for the retry.
						testCase = patchTestCase(testCase, lastResult._failedStepIndex, analysis.newSelector);
						// Track for persistence on success.
						healingApplied = true;
						healedSteps = testCase.steps;
						// Record the healing event.
						if (!lastResult.healRecords) lastResult.healRecords = [];
						lastResult.healRecords.push(createHealRecord(lastResult._failedStep, analysis, lastResult._failedStepIndex));
					} else {
						console.log(`[selfHeal] Confidence ${analysis.confidence} < threshold ${threshold}, skipping heal.`);
					}
				} catch (error) {
					console.warn(`[selfHeal] Healing attempt failed: ${error.message}`);
				}
			}
		}

		// Fail → retry if attempts remain.
		if (attempt < maxAttempts) {
			console.log(`[replay] "${testCase.name}" failed attempt ${attempt}/${maxAttempts}, retrying…`);
		}
	}

	// All attempts exhausted — return last failure.
	cleanHealArtifacts(lastResult);
	return lastResult;
}

/**
 * Runs multiple test cases in parallel with a configurable worker pool,
 * and retries failed tests automatically.
 *
 * @param {array} testCases — array of test case objects
 * @param {object} options
 * @param {object} [options.credentials] — credential map for {{PLACEHOLDER}} resolution
 * @param {function} [options.onProgress] — called as each test completes
 * @param {number} [options.concurrency] — parallel workers (default: QASE_PARALLEL or 3)
 * @param {number} [options.retries] — retries per failed test (default: QASE_RETRIES or 1)
 * @returns {Promise<object>} { id, total, passed, failed, errored, flaky, durationMs, results }
 */
export async function runTestSuite(testCases, { credentials, onProgress, concurrency, retries, browsers } = {}) {
	const startTime = Date.now();
	const poolSize = Math.max(1, concurrency ?? Number(process.env.QASE_PARALLEL) ?? 3);
	const retryCount = Math.max(0, retries ?? Number(process.env.QASE_RETRIES) ?? 1);

	// Resolve browser list: explicit param > config > none (local).
	const config = getConfig();
	const browserList = browsers || (config.browserstackEnabled ? (config.browserstackBrowsers || 'chrome').split(',').map(b => b.trim()).filter(Boolean) : [null]);

	// Expand test cases: if a test case has viewports[], run once per viewport.
	// Each expanded entry is { testCase, viewport, originalIndex, browser }.
	const expanded = [];
	for (let i = 0; i < testCases.length; i++) {
		const tc = testCases[i];
		const viewports = (Array.isArray(tc.viewports) && tc.viewports.length > 0) ? tc.viewports : [tc.viewport ?? null];
		for (const vp of viewports) {
			for (const br of browserList) {
				expanded.push({ testCase: tc, viewport: vp, originalIndex: i, browser: br });
			}
		}
	}

	// Pre-allocate results array to maintain stable ordering.
	const results = new Array(expanded.length);

	// Worker pool: processes indices from a shared queue.
	let nextIndex = 0;

	async function worker() {
		while (true) {
			const myIndex = nextIndex++;
			if (myIndex >= expanded.length) return;

			const entry = expanded[myIndex];
			const result = await runWithRetry(entry.testCase, {
				credentials,
				onProgress: data => onProgress?.({ testCaseIndex: entry.originalIndex, subIndex: myIndex, ...data }),
				retries: retryCount,
				viewport: entry.viewport,
				browser: entry.browser
			});
			results[myIndex] = result;
		}
	}

	// Launch `poolSize` workers and wait for all to finish.
	const workers = [];
	for (let i = 0; i < Math.min(poolSize, expanded.length); i++) {
		workers.push(worker());
	}
	await Promise.all(workers);

	// Aggregate: if a test case was expanded into multiple viewports,
	// group them into a single result with viewportResults[].
	const viewportResultsMap = new Map(); // originalIndex → results[]
	const finalResults = [];

	for (let i = 0; i < expanded.length; i++) {
		const origIdx = expanded[i].originalIndex;
		if (!viewportResultsMap.has(origIdx)) {
			viewportResultsMap.set(origIdx, []);
		}
		viewportResultsMap.get(origIdx).push(results[i]);
	}

	for (let i = 0; i < testCases.length; i++) {
		const vr = viewportResultsMap.get(i) ?? [];
		if (vr.length > 1) {
			// Multi-viewport: aggregate into a single result.
			// Overall result is fail if ANY viewport fails (conservative).
			const anyFail = vr.some(r => r.result === 'fail');
			const anyError = vr.some(r => r.result === 'error');
			const aggregated = {
				...vr[0],
				result: anyError ? 'error' : (anyFail ? 'fail' : 'pass'),
				viewportResults: vr.map(r => ({
					viewport: r.viewport,
					result: r.result,
					durationMs: r.durationMs,
					flaky: r.flaky
				}))
			};
			finalResults.push(aggregated);
		} else if (vr.length === 1) {
			finalResults.push(vr[0]);
		}
	}

	const summary = {
		id: randomUUID(),
		total: testCases.length,
		passed: finalResults.filter(r => r.result === 'pass').length,
		failed: finalResults.filter(r => r.result === 'fail').length,
		errored: finalResults.filter(r => r.result === 'error').length,
		flaky: finalResults.filter(r => r.flaky).length,
		durationMs: Date.now() - startTime,
		results: finalResults
	};

	return summary;
}
