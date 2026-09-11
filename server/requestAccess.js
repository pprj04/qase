import { AsyncLocalStorage } from 'node:async_hooks';
import { canAccessResource, isUserScoped, configureOwnershipResolver } from './ownership.js';

// Request identity is local to an async request, never a process-global user.
export const accessContext = new AsyncLocalStorage();
let resolvers = {};
export function configureAccessResolvers(value) { resolvers = value; configureOwnershipResolver(resolvedOwner); }
export function resolvedOwner(record, seen = new Set()) {
  if (!record || seen.has(record)) return null;
  if (record.ownerUserId) return record.ownerUserId;
  seen.add(record);
  const owners = new Set();
  for (const key of ['sessionId', 'missionId', 'workflowId', 'testCaseId', 'scheduleId', 'findingId']) {
    if (record[key] && resolvers[key]) {
      const owner = resolvedOwner(resolvers[key](record[key]), seen);
      if (owner) owners.add(owner);
    }
  }
  return owners.size === 1 ? [...owners][0] : null;
}
export function visibleRecord(record) {
  const request = accessContext.getStore();
  if (!request || !isUserScoped(request)) return record;
  return record && canAccessResource(request, { ownerUserId: resolvedOwner(record) }) ? record : undefined;
}
export function visibleList(records) { return records.filter(record => visibleRecord(record)); }
export function ownedRead(fn) { return (...args) => visibleRecord(fn(...args)); }
export function ownedList(fn) { return (...args) => visibleList(fn(...args)); }
