/**
 * Minimal OpenAPI 3.1 $ref-resolving schema validator.
 * Supports: type, required, properties, items, enum, $ref, additionalProperties(ignore),
 * format checks for date-time / int64-ish strings. Enough to validate real JSON
 * responses against the schemas the spec declares — not a full JSON Schema impl.
 */
export function createValidator(spec) {
	const resolve = (schema, depth = 0) => {
		if (!schema || depth > 20) return schema;
		if (schema.$ref) {
			const path = schema.$ref.replace(/^#\/components\/schemas\//, '');
			return resolve(spec.components?.schemas?.[path], depth + 1);
		}
		return schema;
	};

	const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
	const EPOCH_MS = /^\d{10,15}$/;

	function check(value, schema, path, errors, depth = 0) {
		if (!schema) return;
		schema = resolve(schema, depth);
		if (!schema) return;

		if (schema.allOf) {
			for (const s of schema.allOf) check(value, s, path, errors, depth + 1);
		}
		if (schema.anyOf) {
			const before = errors.length;
			const trial = [];
			for (const s of schema.anyOf) {
				const t = [];
				check(value, s, path, t, depth + 1);
				if (t.length === 0) return; // one branch satisfied
			}
			if (errors.length === before) errors.push(`${path}: matched no anyOf branch`);
			return;
		}
		if (schema.enum && !schema.enum.includes(value)) {
			errors.push(`${path}: value ${JSON.stringify(value)} not in enum [${schema.enum.join(',')}]`);
		}
		if (schema.type === 'object' || schema.properties) {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) {
				errors.push(`${path}: expected object, got ${Array.isArray(value) ? 'array' : typeof value}`);
				return;
			}
			for (const req of schema.required ?? []) {
				if (!(req in value)) errors.push(`${path}.${req}: required field missing`);
			}
			for (const [k, sub] of Object.entries(schema.properties ?? {})) {
				if (k in value) check(value[k], sub, `${path}.${k}`, errors, depth + 1);
			}
		} else if (schema.type === 'array') {
			if (!Array.isArray(value)) { errors.push(`${path}: expected array, got ${typeof value}`); return; }
			(value ?? []).forEach((item, i) => check(item, schema.items, `${path}[${i}]`, errors, depth + 1));
		} else if (schema.type === 'string') {
			if (typeof value !== 'string') { errors.push(`${path}: expected string, got ${typeof value}`); return; }
			if (schema.format === 'date-time' && !ISO.test(value)) errors.push(`${path}: ${JSON.stringify(value)} not ISO date-time`);
			if (schema.format === 'epoch-ms' && !EPOCH_MS.test(value)) errors.push(`${path}: not epoch-ms`);
		} else if (schema.type === 'integer') {
			if (!Number.isInteger(value)) errors.push(`${path}: expected integer, got ${typeof value}`);
		} else if (schema.type === 'number') {
			if (typeof value !== 'number') errors.push(`${path}: expected number, got ${typeof value}`);
		} else if (schema.type === 'boolean') {
			if (typeof value !== 'boolean') errors.push(`${path}: expected boolean, got ${typeof value}`);
		} else if (schema.type === 'null') {
			if (value !== null) errors.push(`${path}: expected null`);
		}
	}

	return {
		responseSchema(path, method = 'get', status = '200') {
			const op = spec.paths?.[path]?.[method];
			if (!op) return null;
			return op.responses?.[status]?.content?.['application/json']?.schema ?? null;
		},
		validate(value, path, method = 'get', status = '200') {
			const schema = this.responseSchema(path, method, status);
			if (!schema) return { validated: false, errors: [`no schema declared for ${method.toUpperCase()} ${path} ${status}`] };
			const errors = [];
			check(value, schema, '$', errors);
			return { validated: true, errors };
		}
	};
}
