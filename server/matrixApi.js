/**
 * Matrix run API routes (#14633 NI02 Phase 1).
 *
 * POST /api/matrix-runs                 create + (optionally) start
 * GET  /api/matrix-runs                 list
 * GET  /api/matrix-runs/:id             full run incl. items
 * POST /api/matrix-runs/:id/start       start execution of a pending run
 *
 * The orchestrator is wired by app.js (it needs the session-creation
 * machinery — startTurn, probeTargetReachability — that lives there).
 */

import { MatrixValidationError } from './matrixService.js';
import { TestCaseValidationError } from './testCaseService.js';

export function createMatrixRoutes({ matrix, orchestrator, onError }) {
	return (app) => {
		app.post('/api/matrix-runs', async (request, response) => {
			try {
				const record = await matrix.create(request.body, { ownerUserId: request.auth?.userId ?? null });
				if (request.body?.start !== false && orchestrator) {
					const started = orchestrator.start(record.id);
					if (!started.ok) {
						response.status(409).json({ error: started.error });
						return;
					}
				}
				response.status(201).json(await matrix.get(record.id));
			} catch (error) {
				if (error instanceof MatrixValidationError || error instanceof TestCaseValidationError) {
					response.status(422).json({ error: error.message });
					return;
				}
				onError?.(error, response);
			}
		});

		app.get('/api/matrix-runs', async (_request, response) => {
			try {
				const runs = await matrix.list();
				// Summaries only — items are fetched per-run (they can be large).
				response.json({
					runs: runs.map(({ items, ...summary }) => ({
						...summary,
						statusCounts: countByStatus(items)
					}))
				});
			} catch (error) {
				onError?.(error, response);
			}
		});

		app.get('/api/matrix-runs/:id', async (request, response) => {
			try {
				const run = await matrix.get(request.params.id);
				if (!run) {
					response.status(404).json({ error: 'Matrix run not found.' });
					return;
				}
				response.json({ run, orchestratorActive: orchestrator ? orchestrator.isActive(run.id) : false });
			} catch (error) {
				onError?.(error, response);
			}
		});

		app.post('/api/matrix-runs/:id/start', async (request, response) => {
			try {
				const run = await matrix.get(request.params.id);
				if (!run) {
					response.status(404).json({ error: 'Matrix run not found.' });
					return;
				}
				// `error` runs swept by resume recovery (container restart) keep
				// their PENDING items — they may be restarted. `running`/`done`
				// runs may not.
				const restartable = run.status === 'pending'
					|| (run.status === 'error' && run.items.some((item) => item.status === 'PENDING'));
				if (!restartable) {
					response.status(409).json({ error: `Matrix run is ${run.status} with no pending profiles; only pending (or interrupted-with-pending) runs can start.` });
					return;
				}
				const started = orchestrator.start(run.id);
				if (!started.ok) {
					response.status(409).json({ error: started.error });
					return;
				}
				response.json({ ok: true });
			} catch (error) {
				onError?.(error, response);
			}
		});
	};
}

function countByStatus(items) {
	const counts = {};
	for (const item of items ?? []) {
		counts[item.status] = (counts[item.status] ?? 0) + 1;
	}
	return counts;
}
