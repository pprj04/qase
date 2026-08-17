'use strict';

/**
 * Phase 18 — Validation Executor (public surface).
 * Implementation lives in validationExecutorCore.js; this module keeps the
 * original import path (server/validationExecutor.js) stable for index.js.
 */

export { executeValidation, buildValidationTestCase, VALIDATION_ATTEMPTS } from './validationExecutorCore.js';
