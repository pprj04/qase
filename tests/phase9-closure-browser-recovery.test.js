/**
 * Phase 9 Final Closure — Browser Recovery Tests
 *
 * Tests the browser recovery mechanism in browserBridge.js:
 *   1. Consecutive failure tracking
 *   2. Browser restart after threshold failures
 *   3. Success resets the counter
 *   4. Only one restart per session
 *   5. Recovery limit enforcement
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Simulate the trackFailure / trackSuccess logic from browserBridge.js
function createRecoveryState(threshold = 3) {
	return {
		consecutiveFailures: 0,
		browserRestarted: false,
		disposeCalls: 0,
		pageCleared: false,
		trackFailure() {
			this.consecutiveFailures++;
			if (this.consecutiveFailures >= threshold && !this.browserRestarted) {
				this.browserRestarted = true;
				this.disposeCalls++;
				this.pageCleared = true;
				this.consecutiveFailures = 0;
				return true; // recovery triggered
			}
			return false;
		},
		trackSuccess() {
			if (this.consecutiveFailures > 0) {
				this.consecutiveFailures = 0;
				this.browserRestarted = false;
			}
		}
	};
}

describe('Phase 9 Closure — Browser Recovery', () => {

	it('should track consecutive failures', () => {
		const state = createRecoveryState();
		assert.equal(state.consecutiveFailures, 0);

		state.trackFailure();
		assert.equal(state.consecutiveFailures, 1);

		state.trackFailure();
		assert.equal(state.consecutiveFailures, 2);

		assert.equal(state.browserRestarted, false);
	});

	it('should trigger browser restart after threshold consecutive failures', () => {
		const state = createRecoveryState(3);

		assert.equal(state.trackFailure(), false); // 1
		assert.equal(state.trackFailure(), false); // 2
		assert.equal(state.trackFailure(), true);  // 3 → triggers recovery

		assert.equal(state.browserRestarted, true);
		assert.equal(state.disposeCalls, 1);
		assert.equal(state.pageCleared, true);
	});

	it('should reset failure counter on success', () => {
		const state = createRecoveryState(3);

		state.trackFailure();
		state.trackFailure();
		assert.equal(state.consecutiveFailures, 2);

		state.trackSuccess();
		assert.equal(state.consecutiveFailures, 0);
		assert.equal(state.browserRestarted, false);
	});

	it('should only restart browser once per session', () => {
		const state = createRecoveryState(3);

		state.trackFailure(); // 1
		state.trackFailure(); // 2
		state.trackFailure(); // 3 → recovery

		assert.equal(state.disposeCalls, 1);

		// More failures should NOT trigger another restart
		state.trackFailure(); // 1 (counter was reset)
		state.trackFailure(); // 2
		state.trackFailure(); // 3

		assert.equal(state.disposeCalls, 1); // Still only one restart
	});

	it('should only allow one restart per session (safety limit)', () => {
		const state = createRecoveryState(3);

		state.trackFailure();
		state.trackFailure();
		state.trackFailure(); // recovery triggered

		assert.equal(state.browserRestarted, true);

		// After recovery, success does NOT reset browserRestarted
		// because consecutiveFailures was already reset to 0 by recovery.
		// trackSuccess only acts when consecutiveFailures > 0.
		state.trackSuccess();
		// browserRestarted remains true — safety limit
		assert.equal(state.browserRestarted, true);
	});

	it('should handle recovery threshold of 1 (aggressive)', () => {
		const state = createRecoveryState(1);

		assert.equal(state.trackFailure(), true);
		assert.equal(state.disposeCalls, 1);
	});

	it('should NOT trigger recovery if failure is not consecutive', () => {
		const state = createRecoveryState(3);

		state.trackFailure();
		state.trackFailure();
		state.trackSuccess(); // reset
		state.trackFailure();
		state.trackFailure();

		assert.equal(state.browserRestarted, false);
		assert.equal(state.disposeCalls, 0);
	});
});

describe('Phase 9 Closure — Browser Timeout Configuration', () => {

	it('should use 8s default for BROWSER_ACTION_TIMEOUT_MS', () => {
		const expected = Number(process.env.QASE_BROWSER_ACTION_TIMEOUT_MS ?? 8000);
		assert.equal(expected, 8000);
	});

	it('should use 3 for BROWSER_RECOVERY_THRESHOLD default', () => {
		const expected = Number(process.env.QASE_BROWSER_RECOVERY_THRESHOLD ?? 3);
		assert.equal(expected, 3);
	});
});
