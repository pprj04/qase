import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:5173';

async function api(method, path, body) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	try {
		return { status: res.status, data: JSON.parse(text) };
	} catch {
		return { status: res.status, data: text };
	}
}

describe('Phase 11A — Global Findings Store', () => {

	describe('Migration', () => {
		it('should have migrated findings from sessions', async () => {
			const { status, data } = await api('GET', '/api/findings');
			assert.equal(status, 200);
			assert.ok(data.length >= 13, `Expected >= 13 findings, got ${data.length}`);
		});

		it('should have all findings with status=open (migrated default)', async () => {
			const { data } = await api('GET', '/api/findings');
			const allOpen = data.every(f => f.status === 'open');
			assert.ok(allOpen, 'All migrated findings should have status=open');
		});

		it('should have projectId on all migrated findings', async () => {
			const { data } = await api('GET', '/api/findings');
			const allProjected = data.every(f => f.projectId);
			assert.ok(allProjected, 'All findings should have a projectId');
		});

		it('should be idempotent (no duplicates on restart)', async () => {
			const { data } = await api('GET', '/api/findings');
			const ids = data.map(f => f.id);
			const unique = new Set(ids);
			assert.equal(ids.length, unique.size, 'Duplicate finding IDs found');
		});
	});

	describe('CRUD', () => {
		let testId;

		it('should create a finding', async () => {
			const { status, data } = await api('POST', '/api/findings', {
				title: 'Phase 11A Test Bug',
				severity: 'high',
				category: 'testing',
				url: 'https://test.example.com',
				steps: ['Open the app', 'Click login'],
				expected: 'Login succeeds',
				actual: 'Login fails with 500',
				evidence: 'HTTP 500 from /api/auth'
			});
			assert.equal(status, 201);
			assert.ok(data.id);
			assert.equal(data.status, 'open');
			assert.equal(data.severity, 'high');
			testId = data.id;
		});

		it('should get a finding by id with linked tests', async () => {
			const { status, data } = await api('GET', `/api/findings/${testId}`);
			assert.equal(status, 200);
			assert.equal(data.title, 'Phase 11A Test Bug');
			assert.ok(Array.isArray(data.linkedTests));
		});

		it('should return 404 for unknown id', async () => {
			const { status } = await api('GET', '/api/findings/nonexistent-id');
			assert.equal(status, 404);
		});

		it('should update a finding', async () => {
			const { status, data } = await api('PUT', `/api/findings/${testId}`, {
				severity: 'critical',
				assignee: 'dev-team',
				tags: ['urgent', 'auth']
			});
			assert.equal(status, 200);
			assert.equal(data.severity, 'critical');
			assert.equal(data.assignee, 'dev-team');
			assert.deepEqual(data.tags, ['urgent', 'auth']);
		});

		it('should delete a finding', async () => {
			const { status } = await api('DELETE', `/api/findings/${testId}`);
			assert.equal(status, 204);
			const { status: s2 } = await api('GET', `/api/findings/${testId}`);
			assert.equal(s2, 404);
		});
	});

	describe('Lifecycle (status changes)', () => {
		let testId;

		before(async () => {
			const { data } = await api('POST', '/api/findings', {
				title: 'Lifecycle Test Bug',
				severity: 'medium'
			});
			testId = data.id;
		});

		it('should change status with history tracking', async () => {
			const { status, data } = await api('PATCH', `/api/findings/${testId}/status`, {
				status: 'in_testing',
				by: 'qa-team'
			});
			assert.equal(status, 200);
			assert.equal(data.status, 'in_testing');
			assert.ok(data.history.length >= 2);
			const lastEntry = data.history[data.history.length - 1];
			assert.equal(lastEntry.from, 'open');
			assert.equal(lastEntry.to, 'in_testing');
			assert.equal(lastEntry.by, 'qa-team');
		});

		it('should track multiple status changes', async () => {
			await api('PATCH', `/api/findings/${testId}/status`, { status: 'resolved', by: 'dev' });
			const { data } = await api('PATCH', `/api/findings/${testId}/status`, { status: 'closed', by: 'manager' });
			assert.equal(data.status, 'closed');
			assert.ok(data.history.length >= 4);
		});

		it('should reject invalid status', async () => {
			const { status } = await api('PATCH', `/api/findings/${testId}/status`, { status: 'invalid' });
			assert.equal(status, 404);
		});

		after(async () => {
			await api('DELETE', `/api/findings/${testId}`);
		});
	});

	describe('Comments', () => {
		let testId;

		before(async () => {
			const { data } = await api('POST', '/api/findings', {
				title: 'Comment Test Bug',
				severity: 'low'
			});
			testId = data.id;
		});

		it('should add a comment', async () => {
			const { status, data } = await api('POST', `/api/findings/${testId}/comments`, {
				author: 'developer',
				text: 'Investigating the root cause'
			});
			assert.equal(status, 201);
			assert.equal(data.author, 'developer');
			assert.equal(data.text, 'Investigating the root cause');
			assert.ok(data.id);
			assert.ok(data.ts);
		});

		it('should show comments in finding detail', async () => {
			const { data } = await api('GET', `/api/findings/${testId}`);
			assert.ok(data.comments.length >= 1);
			assert.equal(data.comments[0].text, 'Investigating the root cause');
		});

		it('should reject empty comment', async () => {
			const { status } = await api('POST', `/api/findings/${testId}/comments`, {
				author: 'dev',
				text: ''
			});
			assert.equal(status, 404);
		});

		after(async () => {
			await api('DELETE', `/api/findings/${testId}`);
		});
	});

	describe('Filtering', () => {
		it('should filter by severity', async () => {
			const { data } = await api('GET', '/api/findings?severity=high');
			const allHigh = data.every(f => f.severity === 'high');
			assert.ok(allHigh);
			assert.ok(data.length >= 1);
		});

		it('should filter by status', async () => {
			const { data } = await api('GET', '/api/findings?status=open');
			const allOpen = data.every(f => f.status === 'open');
			assert.ok(allOpen);
		});

		it('should filter by search query', async () => {
			const { data } = await api('GET', '/api/findings?q=Projects');
			assert.ok(data.length >= 1);
			const allMatch = data.every(f =>
				f.title.toLowerCase().includes('projects') ||
				f.category.toLowerCase().includes('projects')
			);
			assert.ok(allMatch);
		});

		it('should filter by projectId', async () => {
			const { data } = await api('GET', '/api/findings?projectId=d2ba6d1b-1a23-4347-a935-d4587f891e3e');
			assert.ok(data.length >= 1);
			const allProject = data.every(f => f.projectId === 'd2ba6d1b-1a23-4347-a935-d4587f891e3e');
			assert.ok(allProject);
		});

		it('should return stats', async () => {
			const { status, data } = await api('GET', '/api/findings/stats');
			assert.equal(status, 200);
			assert.ok(data.total >= 13);
			assert.ok(data.byStatus);
			assert.ok(data.bySeverity);
		});
	});

	describe('Export (cross-session)', () => {
		it('should export as markdown', async () => {
			const res = await fetch(`${BASE}/api/findings/export?format=markdown`);
			const text = await res.text();
			assert.ok(res.ok);
			assert.ok(text.includes('# Bug Report'));
			assert.ok(text.includes('Total bugs:'));
		});

		it('should export as GitHub format', async () => {
			const res = await fetch(`${BASE}/api/findings/export?format=github`);
			const data = await res.json();
			assert.ok(res.ok);
			assert.ok(data.length >= 1);
			assert.ok(data[0].title);
			assert.ok(data[0].body);
			assert.ok(data[0].labels);
		});

		it('should export as JIRA format', async () => {
			const res = await fetch(`${BASE}/api/findings/export?format=jira`);
			const data = await res.json();
			assert.ok(res.ok);
			assert.ok(data[0].fields.summary);
			assert.ok(data[0].fields.issuetype);
		});

		it('should export as Linear format', async () => {
			const res = await fetch(`${BASE}/api/findings/export?format=linear`);
			const data = await res.json();
			assert.ok(res.ok);
			assert.ok(data[0].title);
			assert.ok(data[0].priority);
		});
	});

	describe('Test Case Linking', () => {
		let findingId;
		let testCaseId;

		before(async () => {
			const f = await api('POST', '/api/findings', {
				title: 'Link Test Bug',
				severity: 'medium'
			});
			findingId = f.data.id;

			// Get any existing test case.
			const tc = await api('GET', '/api/test-cases?projectId=d2ba6d1b-1a23-4347-a935-d4587f891e3e');
			testCaseId = tc.data[0]?.id;
		});

		it('should link a test case to a finding', async () => {
			if (!testCaseId) return; // Skip if no test cases exist
			const { status, data } = await api('POST', `/api/findings/${findingId}/link/${testCaseId}`);
			assert.equal(status, 200);
			assert.ok(data.testCaseIds.includes(testCaseId));
		});

		it('should reflect link in test case findingIds', async () => {
			if (!testCaseId) return;
			const { data: tc } = await api('GET', `/api/test-cases/${testCaseId}`);
			assert.ok((tc.findingIds ?? []).includes(findingId));
		});

		it('should unlink a test case from a finding', async () => {
			if (!testCaseId) return;
			const { status, data } = await api('DELETE', `/api/findings/${findingId}/link/${testCaseId}`);
			assert.equal(status, 200);
			assert.ok(!data.testCaseIds.includes(testCaseId));
		});

		after(async () => {
			await api('DELETE', `/api/findings/${findingId}`);
		});
	});
});
