/**
 * server/evidenceGraph.js — Phase 6: Evidence Graph & Causal Quality Model
 *
 * The connective layer that links:
 *
 *   Application Exploration → Evidence → Findings → Quality Assessment → Decision → Iteration
 *
 * This module is a READ-ONLY consumer of existing evidence. It does NOT:
 *   - Modify raw evidence
 *   - Fabricate findings
 *   - Execute browser actions
 *   - Replace the Decision Engine
 *   - Replace the Quality Assessment engine
 *
 * It organizes and connects evidence already produced by the existing system
 * into a queryable graph with full provenance chains.
 *
 * ── Architecture ──────────────────────────────────────────────────
 *
 *   Mission
 *     └─HAS_ITERATION→ Iteration
 *                       └─HAS_SESSION→ Session
 *                                      └─PRODUCED→ Observation
 *                                                    └─SUPPORTED_BY→ Evidence
 *                                                                      └─SUPPORTS→ Finding
 *                                                                                    └─AFFECTS→ Assessment
 *                                                                                                └─PRODUCED→ Decision
 *                                                                                                            └─BELONGS_TO→ Iteration
 *
 *   Iteration ──PRECEDES──→ Iteration
 *
 * ── Persistence ──────────────────────────────────────────────────
 *
 *   .qase/evidence-graph.json — atomic writes, debounced save.
 *   Two stores: evidence Map (evidenceId → evidence) and edges Map.
 *
 * @module server/evidenceGraph
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
// R6-T1 — one-way import is safe: findings.js does not import this module
// (verified at 4ce0803; findings.js deliberately keeps the graph at arm's length).
import { appendEvidenceIdsToFinding } from './findings.js';

/* ── Constants ──────────────────────────────────────────────────── */

/**
 * Evidence types — normalized categories for all evidence artifacts.
 */
export const EVIDENCE_TYPES = {
  SCREENSHOT:      'screenshot',
  VIDEO:           'video',
  NETWORK:         'network',
  CONSOLE:         'console',
  DOM:             'dom',
  API_RESPONSE:    'api_response',
  LOG:             'log',
  TRACE:           'trace',
  ASSERTION:       'assertion',
  OBSERVATION:     'observation',
  STEP_OUTCOME:    'step_outcome',
  FINDING_DETAIL:  'finding_detail'
};

/**
 * Evidence verification status — how well the evidence is confirmed.
 */
export const EVIDENCE_STATUS = {
  VERIFIED:            'verified',
  PARTIALLY_VERIFIED:  'partially_verified',
  UNVERIFIED:          'unverified'
};

/**
 * Node types in the evidence graph.
 */
export const NODE_TYPES = {
  MISSION:      'mission',
  ITERATION:    'iteration',
  SESSION:      'session',
  ACTION:       'action',
  OBSERVATION:  'observation',
  EVIDENCE:     'evidence',
  FINDING:      'finding',
  ASSESSMENT:   'assessment',
  DECISION:     'decision'
};

/**
 * Edge (relationship) types in the evidence graph.
 */
export const EDGE_TYPES = {
  HAS_ITERATION:    'has_iteration',
  HAS_SESSION:       'has_session',
  PRODUCED:         'produced',
  SUPPORTED_BY:     'supported_by',
  SUPPORTS:         'supports',
  AFFECTS:          'affects',
  PRODUCED_DECISION:'produced_decision',
  BELONGS_TO:       'belongs_to',
  PRECEDES:         'precedes',
  CAUSED_BY:        'caused_by',
  CORRELATES_WITH:  'correlates_with',
  DERIVED_FROM:     'derived_from',
  LINKED_TO:        'linked_to'
};

/**
 * Confidence levels for evidence — separate from finding severity.
 */
export const EVIDENCE_CONFIDENCE_LEVELS = {
  HIGH:    'high',
  MEDIUM:  'medium',
  LOW:     'low'
};

/**
 * Default confidence factors for computing evidence confidence.
 */
const CONFIDENCE_WEIGHTS = {
  SOURCE_RELIABILITY:  0.30,
  REPRODUCIBILITY:     0.25,
  SOURCE_COUNT:        0.20,
  CONSISTENCY:         0.15,
  COMPLETENESS:        0.10
};

/**
 * Source reliability scores by type.
 */
const SOURCE_RELIABILITY = {
  [EVIDENCE_TYPES.NETWORK]:       0.95,  // Network responses are objective
  [EVIDENCE_TYPES.CONSOLE]:       0.90,  // Console errors are objective
  [EVIDENCE_TYPES.DOM]:           0.85,  // DOM state is objective
  [EVIDENCE_TYPES.SCREENSHOT]:    0.80,  // Visual evidence
  [EVIDENCE_TYPES.API_RESPONSE]:  0.90,
  [EVIDENCE_TYPES.LOG]:           0.75,
  [EVIDENCE_TYPES.TRACE]:         0.85,
  [EVIDENCE_TYPES.ASSERTION]:     0.70,
  [EVIDENCE_TYPES.OBSERVATION]:   0.60,  // Agent-reported, less objective
  [EVIDENCE_TYPES.STEP_OUTCOME]:  0.75,
  [EVIDENCE_TYPES.FINDING_DETAIL]:0.65,
  [EVIDENCE_TYPES.VIDEO]:        0.80
};

/* ── Persistence ────────────────────────────────────────────────── */

const DATA_DIR = process.env.QASE_DATA_DIR ?? join(process.cwd(), '.qase');
const GRAPH_FILE = join(DATA_DIR, 'evidence-graph.json');

let evidenceStore = new Map();    // evidenceId → Evidence object
let observationStore = new Map(); // observationId → Observation object
let edges = [];                   // [{ from, to, type, metadata }]
let saveTimer = null;
let pendingSave = false;

// R6-T1 — save-failure visibility. The debounced save previously only logged
// errors; counters make evidence-loss detectable (surfaced via
// getEvidenceSaveHealth() on the evidence-integrity diagnostics path).
let saveFailures = 0;
let lastSaveError = null;
let lastSaveErrorAt = null;

// R6-T1 — last collection snapshot (attempted vs persisted), module-level
// because collection can run for several missions before a debounced save lands.
let lastCollectionStats = null;

/**
 * R6-T1 — health of the evidence-graph persistence path. Explicit null for
 * never-failed (never fabricated). Exposed on GET /api/v1/missions/:id/evidence-integrity.
 */
export function getEvidenceSaveHealth() {
  return { saveFailures, lastSaveError, lastSaveErrorAt, pendingSave };
}

/**
 * R6-T1 — counters from the most recent collectSessionEvidence() run
 * (attempted vs persisted evidence, linkage write-back count), or null.
 */
export function getEvidenceCollectionStats() {
  return lastCollectionStats;
}

/**
 * Loads the evidence graph from disk. Called on module init.
 */
function loadFromDisk() {
  try {
    if (existsSync(GRAPH_FILE)) {
      const raw = readFileSync(GRAPH_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data.evidence && Array.isArray(data.evidence)) {
        for (const e of data.evidence) evidenceStore.set(e.id, e);
      }
      if (data.observations && Array.isArray(data.observations)) {
        for (const o of data.observations) observationStore.set(o.id, o);
      }
      if (data.edges && Array.isArray(data.edges)) {
        edges = data.edges;
      }
    }
    // R6-T1 — unknown keys are ignored; health counters are runtime-only and
    // intentionally reset on every boot.
  } catch (err) {
    // M1-P3 P0-1: a corrupt graph must NEVER silently reset to empty — that
    // erases the entire evidence history with no trace. Fail LOUD (matches
    // findings.js policy) and preserve the corrupt file for recovery.
    console.error(
      '[evidence-graph] FAILED to load evidence store:', err?.message || err,
      '— evidence graph starts EMPTY. The corrupt file was preserved at',
      GRAPH_FILE + '.corrupt'
    );
    try {
      renameSync(GRAPH_FILE, GRAPH_FILE + '.corrupt');
    } catch { /* nothing to preserve */ }
  }
}

/**
 * Saves the evidence graph to disk (debounced, atomic write).
 */
function scheduleSave() {
  if (saveTimer) return;
  pendingSave = true;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      const data = {
        evidence: [...evidenceStore.values()],
        observations: [...observationStore.values()],
        edges,
        savedAt: Date.now()
      };
      // M1-P3 P0-1: write tmp then RENAME — a copy (writeFileSync of a
      // readFileSync) is non-atomic: a crash mid-copy truncates the store and
      // the loader used to silently reset to empty. renameSync is atomic on
      // the same filesystem (see server/atomicWrite.js).
      const tmp = GRAPH_FILE + '.tmp';
      writeFileSync(tmp, JSON.stringify(data, null, 0));
      renameSync(tmp, GRAPH_FILE);
      pendingSave = false;
    } catch (err) {
      // R6-T1 — count and remember save failures so evidence-loss is visible
      // in diagnostics instead of console-only.
      saveFailures++;
      lastSaveError = err?.message || String(err);
      lastSaveErrorAt = Date.now();
      console.error('[evidence-graph] Failed to save:', err.message);
    }
  }, 250);
}

/**
 * M1-P4.4 Phase 3 — retention prune. Removes ONLY zero-degree (unlinked)
 * evidence nodes and observations, oldest-first, capped at `maxEvidence`.
 * Linked evidence is NEVER pruned — a finding's evidence chain is untouchable.
 * Returns { prunedEvidence, prunedObservations } counts.
 */
export function pruneUnlinked(maxEvidence = 60_000) {
  const linked = new Set();
  for (const e of edges) {
    if (e?.from) linked.add(e.from);
    if (e?.to) linked.add(e.to);
  }
  let prunedEvidence = 0;
  let prunedObservations = 0;
  if (evidenceStore.size > maxEvidence) {
    const excess = evidenceStore.size - maxEvidence;
    const candidates = [...evidenceStore.values()]
      .filter(n => !linked.has(n.id))
      .sort((a, b) => String(a.createdAt ?? 0).localeCompare(String(b.createdAt ?? 0)));
    for (const node of candidates) {
      if (prunedEvidence >= excess) break;
      evidenceStore.delete(node.id);
      prunedEvidence++;
    }
  }
  if (observationStore.size > maxEvidence) {
    const excess = observationStore.size - maxEvidence;
    const candidates = [...observationStore.values()]
      .filter(n => !linked.has(n.id))
      .sort((a, b) => String(a.createdAt ?? 0).localeCompare(String(b.createdAt ?? 0)));
    for (const node of candidates) {
      if (prunedObservations >= excess) break;
      observationStore.delete(node.id);
      prunedObservations++;
    }
  }
  if (prunedEvidence > 0 || prunedObservations > 0) scheduleSave();
  return { prunedEvidence, prunedObservations };
}

/**
 * M1-P4.4 Phase 2 — graceful shutdown flush. Idempotent.
 */
export function flushEvidenceGraphForShutdown() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!pendingSave) return { dirty: false, ok: true };
  pendingSave = false;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const data = {
      evidence: [...evidenceStore.values()],
      observations: [...observationStore.values()],
      edges,
      savedAt: Date.now()
    };
    const tmp = GRAPH_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 0));
    renameSync(tmp, GRAPH_FILE);
    return { dirty: true, ok: true };
  } catch (err) {
    return { dirty: true, ok: false, error: err.message };
  }
}

// Load on init
loadFromDisk();

/* ── Evidence Object (Step 2) ───────────────────────────────────── */

/**
 * Creates a normalized evidence object.
 *
 * Evidence is immutable after creation. Fields that identify provenance
 * (createdAt, source, sessionId, iterationId, missionId) cannot be changed.
 *
 * @param {object} input
 * @returns {object} Normalized evidence object
 */
export function createEvidence(input = {}) {
  const id = input.id || 'ev_' + randomUUID().slice(0, 12);
  const now = Date.now();

  const evidence = {
    id,
    missionId:   input.missionId   || null,
    iterationId: input.iterationId || null,
    sessionId:   input.sessionId   || null,
    // P0-F4 — owning user inherited from the parent session/mission; null =
    // system-created or pre-F4 legacy (shared). Immutable like the other
    // provenance fields.
    ownerUserId: input.ownerUserId ?? null,

    type:        Object.values(EVIDENCE_TYPES).includes(input.type) ? input.type : EVIDENCE_TYPES.OBSERVATION,
    source:      input.source      || 'agent',        // 'agent' | 'browser' | 'network' | 'system'
    timestamp:   input.timestamp   || now,
    target:      input.target       || null,            // URL, selector, or element
    action:      input.action       || null,            // browser action that produced this
    observation: input.observation  || null,            // what was observed
    payload:     input.payload      || null,            // raw data (error text, response body, DOM snapshot)

    confidence:  input.confidence   ?? null,            // 0-1, computed separately from severity
    integrity:   null,                               // hash for mutation detection
    metadata:    input.metadata    || {},

    // Provenance
    createdAt:   input.createdAt    || now,
    createdBy:   input.createdBy    || 'system'
  };

  // Compute integrity hash
  evidence.integrity = computeIntegrityHash(evidence);

  evidenceStore.set(id, evidence);
  scheduleSave();

  return evidence;
}

/**
 * Computes a simple integrity hash for mutation detection.
 * Not cryptographic — just for detecting accidental modification.
 *
 * @param {object} evidence
 * @returns {string} Hash string
 */
function computeIntegrityHash(evidence) {
  const fields = [
    evidence.id,
    evidence.type,
    evidence.source,
    evidence.sessionId,
    evidence.iterationId,
    evidence.missionId,
    evidence.timestamp,
    evidence.target,
    String(evidence.payload || '').slice(0, 1000)
  ];
  const str = fields.join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return 'int_' + Math.abs(hash).toString(36);
}

/**
 * Verifies evidence integrity (detects accidental mutation).
 *
 * @param {string} evidenceId
 * @returns {boolean} True if integrity is intact
 */
export function verifyIntegrity(evidenceId) {
  const evidence = evidenceStore.get(evidenceId);
  if (!evidence) return false;
  const currentHash = computeIntegrityHash({ ...evidence, integrity: null });
  return evidence.integrity === currentHash;
}

/**
 * Gets evidence by ID.
 */
export function getEvidence(id) {
  return evidenceStore.get(id) || null;
}

/**
 * Gets all evidence for a mission.
 */
export function getMissionEvidence(missionId, { limit = 100, offset = 0 } = {}) {
  const results = [];
  for (const ev of evidenceStore.values()) {
    if (ev.missionId === missionId) results.push(ev);
  }
  results.sort((a, b) => a.timestamp - b.timestamp);
  return results.slice(offset, offset + limit);
}

/**
 * M1-P3 P1-1/P1-2: page + total in ONE pass. The previous route pattern
 * computed `total` from a second unbounded query (O(n) scan + sort ×2) or,
 * worse, from the sliced result (total === page size — clients could never
 * page). Keep the array-returning functions for internal callers; the HTTP
 * layer uses this.
 */
export function getMissionEvidencePage(missionId, { limit = 100, offset = 0 } = {}) {
  const results = [];
  for (const ev of evidenceStore.values()) {
    if (ev.missionId === missionId) results.push(ev);
  }
  results.sort((a, b) => a.timestamp - b.timestamp);
  return { items: results.slice(offset, offset + limit), total: results.length };
}

/**
 * Gets all evidence for a session.
 */
export function getSessionEvidence(sessionId, { limit = 100, offset = 0 } = {}) {
  const results = [];
  for (const ev of evidenceStore.values()) {
    if (ev.sessionId === sessionId) results.push(ev);
  }
  results.sort((a, b) => a.timestamp - b.timestamp);
  return results.slice(offset, offset + limit);
}

/** M1-P3 P1-1: page + total in one pass (see getMissionEvidencePage). */
export function getSessionEvidencePage(sessionId, { limit = 100, offset = 0 } = {}) {
  const results = [];
  for (const ev of evidenceStore.values()) {
    if (ev.sessionId === sessionId) results.push(ev);
  }
  results.sort((a, b) => a.timestamp - b.timestamp);
  return { items: results.slice(offset, offset + limit), total: results.length };
}

/**
 * Gets all evidence for an iteration.
 */
export function getIterationEvidence(missionId, iterationNumber, { limit = 100, offset = 0 } = {}) {
  const results = [];
  for (const ev of evidenceStore.values()) {
    if (ev.missionId === missionId && ev.iterationId === iterationNumber) results.push(ev);
  }
  results.sort((a, b) => a.timestamp - b.timestamp);
  return results.slice(offset, offset + limit);
}

/**
 * Gets evidence linked to a finding.
 */
export function getFindingEvidence(findingId) {
  const linkedIds = edges
    .filter(e => e.type === EDGE_TYPES.SUPPORTS && e.to === findingId)
    .map(e => e.from);
  return linkedIds.map(id => evidenceStore.get(id)).filter(Boolean);
}

/* ── Observation Layer (Step 5) ──────────────────────────────────── */

/**
 * Creates an observation — a factual record of what happened, separate from
 * the interpretation (finding).
 *
 * An observation is: "Clicking Submit produced HTTP 500."
 * A finding is: "Submit operation fails with server error."
 *
 * @param {object} input
 * @returns {object} Observation object
 */
export function createObservation(input = {}) {
  const id = input.id || 'obs_' + randomUUID().slice(0, 12);
  const now = Date.now();

  const observation = {
    id,
    missionId:   input.missionId   || null,
    iterationId: input.iterationId || null,
    sessionId:   input.sessionId   || null,
    // P0-F4 — owning user inherited from the parent session/mission.
    ownerUserId: input.ownerUserId ?? null,

    action:      input.action       || null,    // browser action that triggered this
    description: input.description  || '',       // factual description of what happened
    target:      input.target       || null,    // URL, selector, or element
    result:      input.result       || null,    // factual result (HTTP status, error text, etc.)

    evidenceIds: input.evidenceIds  || [],     // linked evidence IDs
    findingIds:  [],                               // findings derived from this observation

    timestamp:  input.timestamp     || now,
    createdAt:  input.createdAt     || now
  };

  observationStore.set(id, observation);
  scheduleSave();

  return observation;
}

/**
 * Gets an observation by ID.
 */
export function getObservation(id) {
  return observationStore.get(id) || null;
}

/**
 * Gets all observations for a session.
 */
export function getSessionObservations(sessionId, { limit = 100, offset = 0 } = {}) {
  const results = [];
  for (const obs of observationStore.values()) {
    if (obs.sessionId === sessionId) results.push(obs);
  }
  results.sort((a, b) => a.timestamp - b.timestamp);
  return results.slice(offset, offset + limit);
}

/** M1-P3 P1-1: page + total in one pass (see getMissionEvidencePage). */
export function getSessionObservationsPage(sessionId, { limit = 100, offset = 0 } = {}) {
  const results = [];
  for (const obs of observationStore.values()) {
    if (obs.sessionId === sessionId) results.push(obs);
  }
  results.sort((a, b) => a.timestamp - b.timestamp);
  return { items: results.slice(offset, offset + limit), total: results.length };
}

/* ── Graph Edges (Step 1, 3, 6) ──────────────────────────────────── */

/**
 * Adds an edge (relationship) to the graph.
 * Idempotent — duplicate edges are silently ignored.
 *
 * @param {string} from - Source node ID
 * @param {string} to - Target node ID
 * @param {string} type - One of EDGE_TYPES
 * @param {object} metadata - Optional edge metadata
 */
export function addEdge(from, to, type, metadata = {}) {
  // Check for existing edge
  const exists = edges.some(e =>
    e.from === from && e.to === to && e.type === type
  );
  if (exists) return; // Idempotent

  edges.push({ from, to, type, metadata, addedAt: Date.now() });
  scheduleSave();
}

/**
 * Gets all edges of a specific type from a node.
 */
export function getEdges(from, type) {
  return edges.filter(e => e.from === from && (type === undefined || e.type === type));
}

/**
 * Gets all edges pointing TO a node (reverse lookup).
 */
export function getEdgesTo(to, type) {
  return edges.filter(e => e.to === to && (type === undefined || e.type === type));
}

/**
 * Links evidence to a finding.
 */
export function linkEvidenceToFinding(evidenceId, findingId) {
  addEdge(evidenceId, findingId, EDGE_TYPES.SUPPORTS);
}

/**
 * Links an observation to evidence.
 */
export function linkObservationToEvidence(observationId, evidenceId) {
  addEdge(observationId, evidenceId, EDGE_TYPES.SUPPORTED_BY);
}

/**
 * Links a finding to an observation (the observation that led to the finding).
 */
export function linkFindingToObservation(findingId, observationId) {
  addEdge(findingId, observationId, EDGE_TYPES.CAUSED_BY);
}

/**
 * Links a finding to an assessment.
 */
export function linkFindingToAssessment(findingId, assessmentId) {
  addEdge(findingId, assessmentId, EDGE_TYPES.AFFECTS);
}

/**
 * Links an assessment to a decision.
 */
export function linkAssessmentToDecision(assessmentId, decisionId) {
  addEdge(assessmentId, decisionId, EDGE_TYPES.PRODUCED_DECISION);
}

/**
 * Links a decision to an iteration.
 */
export function linkDecisionToIteration(decisionId, iterationId) {
  addEdge(decisionId, iterationId, EDGE_TYPES.BELONGS_TO);
}

/**
 * Links iteration N to iteration N+1 (precedence).
 */
export function linkIterationPrecedence(fromIteration, toIteration) {
  addEdge(fromIteration, toIteration, EDGE_TYPES.PRECEDES);
}

/**
 * Links evidence to evidence (cross-source correlation, Step 7).
 */
export function linkEvidenceCorrelation(evidenceId1, evidenceId2) {
  addEdge(evidenceId1, evidenceId2, EDGE_TYPES.CORRELATES_WITH);
  addEdge(evidenceId2, evidenceId1, EDGE_TYPES.CORRELATES_WITH);
}

/* ── Evidence Provenance Chain (Step 3, 14) ──────────────────────── */

/**
 * Builds a deterministic provenance chain for a finding.
 *
 *   Finding → Observation → Evidence → Action → Session → Iteration → Mission → Decision
 *
 * This is the "Why does QASE believe this finding is real?" chain.
 * It does NOT use an LLM — the graph is the source of truth.
 *
 * @param {string} findingId - The finding ID
 * @param {object} context - Optional context { missionId, sessionId, iterations }
 * @returns {object} Provenance chain
 */
export function getEvidenceChain(findingId, context = {}) {
  const chain = {
    findingId,
    finding: null,
    observations: [],
    evidence: [],
    actions: [],
    session: null,
    iteration: null,
    mission: null,
    decision: null,
    assessment: null
  };

  // 1. Find the finding — from context (mission) or edges
  if (context.mission && context.mission.findings) {
    chain.finding = context.mission.findings.find(f => f.id === findingId) || null;
  }
  if (!chain.finding && context.findings) {
    chain.finding = context.findings.find(f => f.id === findingId) || null;
  }

  // 2. Find observations linked to this finding (CAUSED_BY edges)
  // linkFindingToObservation creates {from: findingId, to: observationId}
  // So we need outgoing edges FROM the finding
  const obsEdges = getEdges(findingId, EDGE_TYPES.CAUSED_BY);
  for (const edge of obsEdges) {
    const obs = getObservation(edge.to);
    if (obs) {
      chain.observations.push(obs);
      // 3. Find evidence linked to each observation
      for (const evId of obs.evidenceIds) {
        const ev = getEvidence(evId);
        if (ev) {
          chain.evidence.push(ev);
          // 4. Find actions from evidence
          if (ev.action) {
            chain.actions.push({
              action: ev.action,
              target: ev.target,
              timestamp: ev.timestamp,
              sessionId: ev.sessionId
            });
          }
        }
      }
      // Also check for SUPPORTED_BY edges from observation to evidence
      const obsEvidenceEdges = getEdges(obs.id, EDGE_TYPES.SUPPORTED_BY);
      for (const oeEdge of obsEvidenceEdges) {
        const ev = getEvidence(oeEdge.to);
        if (ev && !chain.evidence.find(e => e.id === ev.id)) {
          chain.evidence.push(ev);
        }
      }
    }
  }

  // 5. Also find evidence directly linked to the finding (SUPPORTS edges)
  const supportsEdges = getEdgesTo(findingId, EDGE_TYPES.SUPPORTS);
  for (const edge of supportsEdges) {
    const ev = getEvidence(edge.from);
    if (ev && !chain.evidence.find(e => e.id === ev.id)) {
      chain.evidence.push(ev);
    }
  }

  // 6. Find session from evidence or context
  if (chain.evidence.length > 0 && chain.evidence[0].sessionId) {
    chain.session = { id: chain.evidence[0].sessionId };
  } else if (context.sessionId) {
    chain.session = { id: context.sessionId };
  }

  // 7. Find iteration from context
  if (context.iteration) {
    chain.iteration = context.iteration;
  } else if (context.mission && context.mission.iterations) {
    // Find the iteration that contains this session
    const session = chain.session;
    if (session) {
      const iter = context.mission.iterations.find(i => i.sessionId === session.id);
      if (iter) chain.iteration = iter;
    }
  }

  // 8. Find mission from context
  if (context.mission) {
    chain.mission = {
      id: context.mission.id,
      name: context.mission.name,
      targetUrl: context.mission.targetUrl
    };
  }

  // 9. Find decision linked to this finding/iteration
  if (context.decision) {
    chain.decision = context.decision;
  }
  if (!chain.decision && context.mission) {
    // Check iteration metadata for decisions
    if (context.mission.iterationMetadata) {
      const session = chain.session;
      if (session) {
        const meta = context.mission.iterationMetadata.find(m => m.sessionId === session.id);
        if (meta && meta.decision) chain.decision = meta.decision;
      }
    }
  }

  // 10. Find assessment
  if (context.quality) {
    chain.assessment = {
      qualityScore: context.quality.score,
      verdict: context.quality.verdict,
      releaseReady: context.quality.releaseReady,
      confidence: context.quality.confidence,
      risk: context.quality.risk
    };
  }

  return chain;
}

/**
 * Gets a simplified, deterministic chain for API responses.
 */
export function getEvidenceChainForApi(findingId, context = {}) {
  const chain = getEvidenceChain(findingId, context);
  return {
    findingId: chain.findingId,
    finding: chain.finding ? {
      id: chain.finding.id,
      title: chain.finding.title,
      severity: chain.finding.severity,
      category: chain.finding.category,
      url: chain.finding.url,
      evidenceStatus: chain.finding.evidenceStatus || determineEvidenceStatus(chain.evidence.length),
      confidence: chain.finding.confidence
    } : null,
    observationCount: chain.observations.length,
    observations: chain.observations.map(o => ({
      id: o.id,
      description: o.description,
      target: o.target,
      timestamp: o.timestamp
    })),
    evidenceCount: chain.evidence.length,
    evidence: chain.evidence.map(e => ({
      id: e.id,
      type: e.type,
      source: e.source,
      target: e.target,
      timestamp: e.timestamp,
      confidence: e.confidence,
      integrity: e.integrity
    })),
    session: chain.session,
    iteration: chain.iteration ? {
      number: chain.iteration.number,
      sessionId: chain.iteration.sessionId,
      qualityScore: chain.iteration.qualityScore,
      verdict: chain.iteration.verdict
    } : null,
    mission: chain.mission,
    decision: chain.decision ? {
      decision: chain.decision.decision,
      reason: chain.decision.reason,
      confidence: chain.decision.confidence,
      policyVersion: chain.decision.policyVersion
    } : null,
    assessment: chain.assessment
  };
}

/* ── Finding Evidence Status (Step 4) ────────────────────────────── */

/**
 * Determines the evidence verification status for a finding.
 *
 * VERIFIED:            2+ evidence items from independent sources
 * PARTIALLY_VERIFIED:  1 evidence item, or 2+ from same source
 * UNVERIFIED:          0 evidence items
 *
 * @param {number} evidenceCount
 * @param {string[]} sources - unique source types
 * @returns {string} One of EVIDENCE_STATUS
 */
export function determineEvidenceStatus(evidenceCount, sources = []) {
  if (evidenceCount === 0) return EVIDENCE_STATUS.UNVERIFIED;
  const uniqueSources = new Set(sources.map(s => s.toLowerCase()));
  if (evidenceCount >= 2 && uniqueSources.size >= 2) {
    return EVIDENCE_STATUS.VERIFIED;
  }
  return EVIDENCE_STATUS.PARTIALLY_VERIFIED;
}

/* ── Evidence Confidence (Step 10) ──────────────────────────────── */

/**
 * Computes evidence confidence — separate from finding severity.
 *
 * Factors:
 *   - Source reliability (network=0.95, console=0.90, dom=0.85, etc.)
 *   - Reproducibility (confirmed > unconfirmed)
 *   - Number of supporting sources (more = higher confidence)
 *   - Consistency (do all sources agree?)
 *   - Completeness (is the payload non-empty?)
 *
 * @param {object[]} evidenceItems - Array of evidence objects
 * @returns {object} { score: 0-1, level: 'high'|'medium'|'low', factors: {} }
 */
export function computeEvidenceConfidence(evidenceItems = []) {
  if (!evidenceItems || evidenceItems.length === 0) {
    return { score: 0, level: EVIDENCE_CONFIDENCE_LEVELS.LOW, factors: {} };
  }

  // 1. Source reliability — average reliability of all evidence types
  const reliabilities = evidenceItems.map(e => SOURCE_RELIABILITY[e.type] ?? 0.5);
  const sourceReliability = reliabilities.reduce((a, b) => a + b, 0) / reliabilities.length;

  // 2. Reproducibility — if evidence was reproduced (same finding seen in multiple iterations)
  const reproducibility = evidenceItems.length >= 2 ? 0.8 : 0.5;

  // 3. Source count — more independent sources = higher confidence
  const uniqueTypes = new Set(evidenceItems.map(e => e.type));
  const sourceCount = Math.min(uniqueTypes.size / 3, 1); // normalize to 0-1, cap at 3 types

  // 4. Consistency — all evidence items should support the same conclusion
  const consistency = 0.8; // Default high since evidence linked to same finding

  // 5. Completeness — evidence with payload is more complete
  const completeCount = evidenceItems.filter(e => e.payload != null && e.payload !== '').length;
  const completeness = completeCount / evidenceItems.length;

  const score = Math.min(1, Math.max(0,
    sourceReliability * CONFIDENCE_WEIGHTS.SOURCE_RELIABILITY +
    reproducibility  * CONFIDENCE_WEIGHTS.REPRODUCIBILITY +
    sourceCount      * CONFIDENCE_WEIGHTS.SOURCE_COUNT +
    consistency      * CONFIDENCE_WEIGHTS.CONSISTENCY +
    completeness     * CONFIDENCE_WEIGHTS.COMPLETENESS
  ));

  const level = score >= 0.75 ? EVIDENCE_CONFIDENCE_LEVELS.HIGH
    : score >= 0.45 ? EVIDENCE_CONFIDENCE_LEVELS.MEDIUM
    : EVIDENCE_CONFIDENCE_LEVELS.LOW;

  return {
    score: Math.round(score * 100) / 100,
    level,
    factors: {
      sourceReliability: Math.round(sourceReliability * 100) / 100,
      reproducibility,
      sourceCount: uniqueTypes.size,
      consistency,
      completeness: Math.round(completeness * 100) / 100
    }
  };
}

/* ── Evidence Coverage (Step 16) ────────────────────────────────── */

/**
 * Computes evidence coverage — the percentage of findings that have
 * supporting evidence.
 *
 * Formula:
 *
 *   evidenceCoverage = findingsWithEvidence / totalFindings × 100
 *
 * Where "findingsWithEvidence" = findings with at least 1 evidence item
 * linked via SUPPORTS edges OR findings with non-empty evidence field.
 *
 * Findings with severity 'info' are excluded (they are informational, not
 * defects requiring evidence).
 *
 * @param {object[]} findings - All findings
 * @returns {object} { coverage: 0-100, verified: N, partiallyVerified: N, unverified: N, total: N }
 */
export function computeEvidenceCoverage(findings = []) {
  const relevantFindings = findings.filter(f =>
    f.severity !== 'info' && !f.isDuplicate
  );
  const total = relevantFindings.length;

  if (total === 0) {
    return { coverage: 100, verified: 0, partiallyVerified: 0, unverified: 0, total: 0 };
  }

  let verified = 0;
  let partiallyVerified = 0;
  let unverified = 0;

  for (const finding of relevantFindings) {
    const evidence = getFindingEvidence(finding.id);
    const evidenceCount = evidence.length;
    const sources = evidence.map(e => e.source);
    const status = determineEvidenceStatus(evidenceCount, sources);

    // Also check if the finding has an evidence field (free-text evidence)
    const hasEvidenceField = Boolean(finding.evidence) && finding.evidence.length > 0;
    if (evidenceCount === 0 && hasEvidenceField) {
      // Has free-text evidence but no structured links → partially verified
      partiallyVerified++;
    } else if (status === EVIDENCE_STATUS.VERIFIED) {
      verified++;
    } else if (status === EVIDENCE_STATUS.PARTIALLY_VERIFIED) {
      partiallyVerified++;
    } else {
      unverified++;
    }
  }

  const findingsWithEvidence = verified + partiallyVerified;
  const coverage = Math.round((findingsWithEvidence / total) * 100);

  return { coverage, verified, partiallyVerified, unverified, total };
}

/* ── Orphan Detection (Step 17) ──────────────────────────────────── */

/**
 * Detects graph integrity problems — orphaned or broken references.
 *
 * Does NOT delete orphans. Exposes them as integrity warnings.
 *
 * @param {object} context - { missions: Map, sessions: Map }
 * @returns {object} { orphans: [], warnings: [] }
 */
export function detectOrphans(context = {}) {
  const orphans = [];
  const warnings = [];

  // 1. Evidence without session
  for (const ev of evidenceStore.values()) {
    if (ev.sessionId && context.sessions) {
      const session = context.sessions.get?.(ev.sessionId);
      if (!session) {
        orphans.push({
          type: 'evidence_without_session',
          evidenceId: ev.id,
          sessionId: ev.sessionId
        });
      }
    }
    if (ev.missionId && context.missions) {
      const mission = context.missions.get?.(ev.missionId);
      if (!mission) {
        orphans.push({
          type: 'evidence_without_mission',
          evidenceId: ev.id,
          missionId: ev.missionId
        });
      }
    }
  }

  // 2. Observation without evidence
  for (const obs of observationStore.values()) {
    if (obs.evidenceIds.length === 0) {
      warnings.push({
        type: 'observation_without_evidence',
        observationId: obs.id,
        description: obs.description
      });
    }
  }

  // 3. Broken edges — references to non-existent nodes
  for (const edge of edges) {
    const fromExists = evidenceStore.has(edge.from) || observationStore.has(edge.from) ||
                       edge.from?.startsWith('finding_') || edge.from?.startsWith('mission_') ||
                       edge.from?.startsWith('iter_') || edge.from?.startsWith('dec_') ||
                       edge.from?.startsWith('session_') || edge.from?.startsWith('assess_');
    const toExists = evidenceStore.has(edge.to) || observationStore.has(edge.to) ||
                     edge.to?.startsWith('finding_') || edge.to?.startsWith('mission_') ||
                     edge.to?.startsWith('iter_') || edge.to?.startsWith('dec_') ||
                     edge.to?.startsWith('session_') || edge.to?.startsWith('assess_');

    if (!fromExists) {
      warnings.push({
        type: 'broken_edge_from',
        edge
      });
    }
    if (!toExists) {
      warnings.push({
        type: 'broken_edge_to',
        edge
      });
    }
  }

  return { orphans, warnings };
}

/* ── Graph Integrity Validator (Step 18) ─────────────────────────── */

/**
 * Validates the evidence graph integrity.
 *
 * Detects:
 *   - Broken references
 *   - Missing relationships
 *   - Duplicate relationships
 *   - Impossible lifecycle states
 *   - Missing provenance
 *
 * @param {object} context - { missions: Map, sessions: Map, findings: Array }
 * @returns {object} { healthy: boolean, errors: [], warnings: [] }
 */
export function validateGraphIntegrity(context = {}) {
  const errors = [];
  const warnings = [];

  // 1. Duplicate edges
  const edgeKeys = new Set();
  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (edgeKeys.has(key)) {
      errors.push({
        type: 'duplicate_edge',
        from: edge.from,
        to: edge.to,
        edgeType: edge.type
      });
    } else {
      edgeKeys.add(key);
    }
  }

  // 2. Evidence with missing provenance
  for (const ev of evidenceStore.values()) {
    if (!ev.missionId && !ev.sessionId) {
      warnings.push({
        type: 'evidence_missing_provenance',
        evidenceId: ev.id,
        detail: 'Evidence has no missionId or sessionId'
      });
    }
    if (!ev.createdAt) {
      errors.push({
        type: 'evidence_missing_timestamp',
        evidenceId: ev.id
      });
    }
  }

  // 3. Findings without evidence (unverified)
  if (context.findings) {
    for (const finding of context.findings) {
      if (finding.severity !== 'info' && !finding.isDuplicate) {
        const evidence = getFindingEvidence(finding.id);
        const hasEvidenceField = Boolean(finding.evidence) && finding.evidence.length > 0;
        if (evidence.length === 0 && !hasEvidenceField) {
          warnings.push({
            type: 'finding_without_evidence',
            findingId: finding.id,
            title: finding.title,
            severity: finding.severity,
            status: EVIDENCE_STATUS.UNVERIFIED
          });
        }
      }
    }
  }

  // 4. Orphan detection
  const orphanResults = detectOrphans(context);
  for (const o of orphanResults.orphans) warnings.push(o);
  for (const w of orphanResults.warnings) warnings.push(w);

  return {
    healthy: errors.length === 0,
    errors,
    warnings
  };
}

/* ── Evidence Collection from Session (Step 7) ──────────────────── */

/**
 * Extracts evidence from a session's captured steps and findings.
 *
 * This is the bridge between the existing exploration data and the
 * evidence graph. It creates normalized evidence objects and observations
 * from the raw session data, then links them to findings.
 *
 * @param {object} session - The session object
 * @param {object} mission - The mission object
 * @param {number} iterationNumber - Which iteration this session belongs to
 * @returns {object} { evidenceCreated: N, observationsCreated: N, linksCreated: N }
 */
export function collectSessionEvidence(session, mission, iterationNumber = null) {
  if (!session) return { evidenceCreated: 0, observationsCreated: 0, linksCreated: 0 };

  const missionId = mission?.id || null;
  const sessionId = session.id;
  // P0-F4 — evidence inherits the owning user of the session that produced
  // it (falling back to the mission), so per-user scoping reaches evidence.
  const ownerUserId = session.ownerUserId ?? mission?.ownerUserId ?? null;
  const iterId = iterationNumber;
  let evidenceCreated = 0;
  let observationsCreated = 0;
  let linksCreated = 0;
  // R6-T2 — screenshot artifact attempted-vs-persisted counters (same
  // convention as the R6-T1 evidence counters).
  let screenshotsAttempted = 0;
  let screenshotsPersisted = 0;

  // 1. Extract evidence from captured steps (browser actions)
  const steps = session.capturedSteps || [];
  // R6-T2 — idempotency guard: a step already collected (re-finalize,
  // fix-validation re-link, boot-recovery re-run) must never mint a second
  // step_outcome node. Step identity = step.id (stable across runs; the
  // agent assigns it at capture time), falling back to toolCallId, then to
  // index for legacy steps with neither.
  const sessionStepKey = (step, idx) => step.id || step.toolCallId || `idx:${idx}`;
  const collectedStepKeys = new Set(
    [...evidenceStore.values()]
      .filter(e => e.sessionId === sessionId && e.type === EVIDENCE_TYPES.STEP_OUTCOME && e.metadata?.stepKey)
      .map(e => e.metadata.stepKey)
  );
  for (const [stepIndex, step] of steps.entries()) {
    if (!step.outcome) continue;
    const stepKey = sessionStepKey(step, stepIndex);
    if (collectedStepKeys.has(stepKey)) {
      // Counters stay truthful on re-collection: the step's screenshot was
      // attempted/persisted on the ORIGINAL pass — report it again per-run
      // without minting a node.
      if (step.screenshot) {
        screenshotsAttempted += 1;
        if (step.screenshot.persisted === true) screenshotsPersisted += 1;
      }
      continue;
    }

    const ev = createEvidence({
      missionId,
      ownerUserId,
      iterationId: iterId,
      sessionId,
      type: EVIDENCE_TYPES.STEP_OUTCOME,
      source: 'browser',
      timestamp: step.ts || Date.now(),
      target: step.url || step.target || null,
      action: step.action || null,
      observation: step.label || step.displayLabel || null,
      payload: {
        status: step.outcome.status,
        urlAfter: step.outcome.urlAfter,
        titleAfter: step.outcome.titleAfter,
        error: step.outcome.error,
        consoleErrors: step.outcome.consoleErrors,
        networkErrors: step.outcome.networkErrors,
        elementsFound: step.outcome.elementsFound
      },
      // R6-T2 — screenshot artifact reference ON THE EXISTING step_outcome
      // node's metadata (createEvidence has a closed field list; metadata is
      // the free-form channel). No duplicate evidence node is created for
      // persistence. Explicit artifact:null when capture was attempted but
      // nothing persisted — never a phantom ref, never a silent success.
      metadata: {
        stepId: step.id,
        toolCallId: step.toolCallId,
        // R6-T2 — stable re-collection identity (see guard above).
        stepKey: sessionStepKey(step, stepIndex),
        ...(step.screenshot ? {
          artifact: step.screenshot.artifactId ? {
            id: step.screenshot.artifactId,
            sessionId,
            mimeType: 'image/jpeg',
            bytes: step.screenshot.bytes ?? null,
            capturedAt: step.screenshot.capturedAt ?? null
          } : null,
          screenshotAttempted: true,
          screenshotPersisted: step.screenshot.persisted === true,
          screenshotStatus: step.screenshot.status ?? null,
          screenshotError: step.screenshot.error ?? null
        } : {})
      }
    });
    if (step.screenshot?.persisted) {
      screenshotsPersisted = (screenshotsPersisted || 0) + 1;
    }
    if (step.screenshot) {
      screenshotsAttempted = (screenshotsAttempted || 0) + 1;
    }
    evidenceCreated++;
  }

  // 2. Extract evidence from findings (each finding's evidence field)
  const findings = session.findings || [];
  // R6-T1 — linkage write-back tracking (evidenceIds persisted onto findings).
  let evidenceIdsPersisted = 0;
  for (const finding of findings) {
    if (finding.evidence) {
      const ev = createEvidence({
        missionId,
        iterationId: iterId,
        sessionId,
        type: EVIDENCE_TYPES.FINDING_DETAIL,
        source: 'agent',
        timestamp: finding.ts || Date.now(),
        target: finding.url || null,
        observation: finding.observed || finding.actual || null,
        payload: finding.evidence,
        metadata: { findingId: finding.id }
      });
      evidenceCreated++;

      // Link evidence to finding
      linkEvidenceToFinding(ev.id, finding.id);
      linksCreated++;

      // R6-T1 — write the typed linkage back onto the findings-store record so
      // the Bugs surface and exports see evidence without graph queries.
      // Idempotent (appendEvidenceIdsToFinding dedupes); graph edges stay the
      // source of truth — the record field is a derived mirror. IDs are read
      // back through the graph so the mirror only ever contains IDs the graph
      // actually resolves (guards against foreign/stale IDs).
      const linkedEvidence = getFindingEvidence(finding.id);
      if (appendEvidenceIdsToFinding(finding.id, linkedEvidence.map(e => e.id))) {
        evidenceIdsPersisted++;
      }
    }

    // Create observation for each finding
    const obs = createObservation({
      missionId,
      ownerUserId,
      iterationId: iterId,
      sessionId,
      action: finding.steps?.length > 0 ? finding.steps.join(' → ') : null,
      description: finding.observed || finding.actual || finding.title,
      target: finding.url || null,
      result: finding.evidence || null,
      evidenceIds: finding.evidence ? [ /* will be linked below */ ] : [],
      timestamp: finding.ts || Date.now()
    });
    observationsCreated++;

    // Link finding to observation
    linkFindingToObservation(finding.id, obs.id);

    // Link observation to finding evidence if it exists
    if (finding.evidence) {
      const findingEv = getFindingEvidence(finding.id);
      for (const fe of findingEv) {
        linkObservationToEvidence(obs.id, fe.id);
      }
    }
  }

  // 3. Cross-source correlation — link evidence from the same finding
  for (const finding of findings) {
    const findingEv = getFindingEvidence(finding.id);
    if (findingEv.length >= 2) {
      // Correlate all evidence for this finding
      for (let i = 0; i < findingEv.length; i++) {
        for (let j = i + 1; j < findingEv.length; j++) {
          linkEvidenceCorrelation(findingEv[i].id, findingEv[j].id);
          linksCreated++;
        }
      }
    }
  }

  // R6-T1 — attempted-vs-persisted counters for this collection run, kept at
  // module level so a later save failure is attributable to the last known
  // collection. Persisted means: created in the graph AND the linkage mirror
  // written onto the findings-store record.
  lastCollectionStats = {
    at: Date.now(),
    missionId: missionId ?? null,
    sessionId: sessionId ?? null,
    evidenceAttempted: (steps.filter(s => s.outcome).length) + findings.filter(f => f.evidence).length,
    evidencePersisted: evidenceCreated,
    observationsCreated,
    linksCreated,
    evidenceIdsPersisted,
    screenshotsAttempted,
    screenshotsPersisted
  };

  return { evidenceCreated, observationsCreated, linksCreated, evidenceIdsPersisted, stats: lastCollectionStats };
}

/* ── Iteration Evidence Preservation (Step 8) ────────────────────── */

/**
 * Gets evidence for a specific iteration, preserving historical evidence.
 *
 * Historical evidence is immutable — calling this function on iteration 1
 * after iteration 2 has completed still returns iteration 1's evidence.
 *
 * @param {string} missionId
 * @param {number} iterationNumber
 */
export function getHistoricalEvidence(missionId, iterationNumber) {
  // Accept both numeric (1) and prefixed ('iter_1') iteration IDs
  const iterId = typeof iterationNumber === 'number' ? `iter_${iterationNumber}` : iterationNumber;
  return getIterationEvidence(missionId, iterId);
}

/**
 * Compares evidence across two iterations.
 *
 * @param {string} missionId
 * @param {number} iter1Number
 * @param {number} iter2Number
 * @returns {object} { iter1EvidenceCount, iter2EvidenceCount, sharedEvidenceTypes, newTypes, removedTypes }
 */
export function compareIterationEvidence(missionId, iter1Number, iter2Number) {
  const iter1 = getHistoricalEvidence(missionId, iter1Number);
  const iter2 = getHistoricalEvidence(missionId, iter2Number);

  const types1 = new Set(iter1.map(e => e.type));
  const types2 = new Set(iter2.map(e => e.type));

  const shared = [...types1].filter(t => types2.has(t));
  const newTypes = [...types2].filter(t => !types1.has(t));
  const removedTypes = [...types1].filter(t => !types2.has(t));

  return {
    iter1EvidenceCount: iter1.length,
    iter2EvidenceCount: iter2.length,
    sharedEvidenceTypes: shared,
    newTypes,
    removedTypes
  };
}

/* ── Utility ─────────────────────────────────────────────────────── */

/**
 * Gets total evidence count (for stats).
 */
export function getEvidenceCount() {
  return evidenceStore.size;
}

/**
 * R6-T4 — single-pass set of every missionId that owns at least one
 * evidence node. Used by missionShells.js to detect "execution began"
 * across the whole graph in ONE scan instead of one scan per mission.
 */
export function getMissionIdsWithEvidence() {
  const ids = new Set();
  for (const ev of evidenceStore.values()) {
    if (ev.missionId) ids.add(ev.missionId);
  }
  return ids;
}

/**
 * Gets total observation count (for stats).
 */
export function getObservationCount() {
  return observationStore.size;
}

/**
 * Gets total edge count (for stats).
 */
export function getEdgeCount() {
  return edges.length;
}

/**
 * Clears all evidence graph data (for testing only).
 */
export function _clearForTesting() {
  evidenceStore.clear();
  observationStore.clear();
  edges = [];
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveFailures = 0;
  lastSaveError = null;
  lastSaveErrorAt = null;
  lastCollectionStats = null;
}

/**
 * Gets graph statistics.
 */
export function getGraphStats() {
  const typeBreakdown = {};
  for (const ev of evidenceStore.values()) {
    typeBreakdown[ev.type] = (typeBreakdown[ev.type] || 0) + 1;
  }
  return {
    totalEvidence: evidenceStore.size,
    totalObservations: observationStore.size,
    totalEdges: edges.length,
    evidenceByType: typeBreakdown,
    graphFile: existsSync(GRAPH_FILE) ? GRAPH_FILE : null
  };
}
