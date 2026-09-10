import 'dotenv/config';
import { createApplication } from './app.js';
import { createInstanceAccess } from './instanceAccess.js';
import { createOperationalControls } from './operations.js';
import { createOperationalLogger } from './operationalLogger.js';
import { createConfiguredApplicationServices } from './serviceFactory.js';
import { createConfiguredDrytisIntegration } from './drytisIntegrationFactory.js';
import { closeApplicationBrowsers, drainHttpServer, installShutdownHandlers } from './processLifecycle.js';
import { createRunKeepalive, isRunStatusActive } from './keepalive.js';

// Validate process-local operational limits and metrics credentials before
// opening PostgreSQL or Redis clients.
const logger = createOperationalLogger({ component: 'qase-api' });
const operations = createOperationalControls({ logger });
const port = Number(process.env.PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new TypeError('PORT must be an integer from 1 to 65535.');
const host = String(process.env.QASE_HOST ?? '127.0.0.1').trim() || '127.0.0.1';
const {
	services, mode: runStoreMode, executionMode, tenantContext, pool, executionQueue
} = await createConfiguredApplicationServices();
const access = createInstanceAccess({ tenantContext });

// Inbound-traffic keepalive: workspace containers pause after an idle window.
// During an agent run the server is busy but receives almost no inbound HTTP,
// so the container can be paused mid-run and the run dies on the next resume.
// While runs are active the keepalive self-pings /healthz over loopback.
const keepalive = createRunKeepalive({ getUrl: () => `http://127.0.0.1:${port}/healthz`, logger });
if (typeof services.runs.setStatus === 'function') {
	const setStatus = services.runs.setStatus.bind(services.runs);
	services.runs.setStatus = async (session, status, detail) => {
		await setStatus(session, status, detail);
		if (isRunStatusActive(status)) keepalive.noteActive();
	};
}
if (typeof services.events.subscribeGlobal === 'function') {
	// Run-bus events (messages, activity, live frames) only flow while a run
	// is in flight, so they are a precise liveness signal.
	services.events.subscribeGlobal((_sessionId, event) => {
		if (event?.type === 'status' ? isRunStatusActive(event.status) : true) keepalive.noteActive();
	});
}
const drytisIntegration = createConfiguredDrytisIntegration({
	services,
	tenantContext,
	pool,
	runStoreMode,
	logger
});

let shuttingDown = false;
const { app, demoEnabled } = createApplication({
	services, access, executionQueue, operations, logger,
	drytisIntegrationApi: drytisIntegration?.api,
	isDraining: () => shuttingDown
});

// Chromium is a child process; without this it can outlive the server process.
let server;
installShutdownHandlers({
	logger,
	onDraining: signal => {
		shuttingDown = true;
		logger.info('process.draining', { signal });
	},
	steps: [
		() => { keepalive.stop(); },
		() => drainHttpServer(server),
		() => closeApplicationBrowsers(services),
		() => services.lifecycle.close()
	]
});

const config = await services.configuration.getPublic();
server = app.listen(port, host, () => {
	if (process.env.NODE_ENV === 'production') {
		logger.info('process.started', {
			host, port, storeMode: runStoreMode, executionMode,
			accessMode: 'embedded-instance', drytisIntegration: Boolean(drytisIntegration),
			provider: config.provider, model: config.model
		});
		if (config.problem) logger.warn('configuration.problem', { errorName: 'ConfigurationError' });
		return;
	}
	console.log('\n  Qase — autonomous QA agent');
	console.log(`  http://${host}:${port}`);
	console.log(`  run store: ${runStoreMode}`);
	console.log(`  execution: ${executionMode}`);
	console.log('  access: Drytis-owned embedded instance');
	console.log(`  Drytis integration: ${drytisIntegration ? 'enabled' : 'disabled'}`);
	console.log(`  ${config.provider} · ${config.model}${config.baseUrl ? ` · ${config.baseUrl}` : ''}`);
	if (demoEnabled) {
		console.log(`  practice target: http://${host}:${port}/demo  (demo@qase.dev / demo1234)`);
	}
	console.log('');
	if (config.problem) {
		console.log(`  ! ${config.problem} Set it in the dashboard under Settings, or in .env.\n`);
	}
});
