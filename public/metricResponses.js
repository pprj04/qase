/** Strict parsers prevent failed or malformed metric payloads becoming fake 0s. */
export function parseMetricCollection(payload, label) {
	if (!payload) throw new Error('missing ' + label + ' metrics response');
	if (!Array.isArray(payload.items)) throw new Error('invalid ' + label + ' metric items');
	if (!payload.metrics || typeof payload.metrics !== 'object') throw new Error('missing ' + label + ' metric summary');
	if (typeof payload.total !== 'number' || typeof payload.metrics.total !== 'number') {
		throw new Error('invalid ' + label + ' metric total');
	}
	if (payload.total !== payload.metrics.total) throw new Error('invalid inconsistent ' + label + ' metric total');
	return payload;
}

export function parseRegressionTrend(payload) {
	if (!payload || !Array.isArray(payload.items) || !payload.metrics
		|| !Object.prototype.hasOwnProperty.call(payload.metrics, 'passRate')) {
		throw new Error('invalid regression metrics response');
	}
	return payload;
}
