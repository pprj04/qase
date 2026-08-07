/**
 * Autonomy Pipeline (Phase 12) — now powered by the Capability Orchestrator
 *
 * The original monolithic linear pipeline has been refactored into a
 * Capability Registry + Orchestrator (see server/capabilities.js). Each
 * pipeline stage is now a registered capability with formal contracts
 * (dependencies, evidence, confidence).
 *
 * This file re-exports the orchestrator's runAutonomyPipeline for backward
 * compatibility — existing imports from qaTools.js and index.js continue
 * to work unchanged.
 *
 * For the capability definitions and orchestrator logic, see capabilities.js.
 */

export { runAutonomyPipeline } from './capabilities.js';
export { defaultRegistry, defaultOrchestrator, STAGE_INFO } from './capabilities.js';
