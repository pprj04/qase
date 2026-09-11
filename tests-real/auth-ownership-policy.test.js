import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAccessResource, ownerOfRequest, scopeList } from '../server/ownership.js';
import { accessContext, configureAccessResolvers, resolvedOwner, visibleList } from '../server/requestAccess.js';

const a = { auth: { kind: 'user', userId: 'a', role: 'operator' } };
const b = { auth: { kind: 'user', userId: 'b', role: 'operator' } };
const admin = { auth: { kind: 'user', userId: 'admin', role: 'admin' } };
const records = new Map([
  ['a', { ownerUserId: 'a' }], ['b', { ownerUserId: 'b' }],
  ['cycle', { sessionId: 'cycle' }]
]);
configureAccessResolvers({ sessionId: id => records.get(id), missionId: id => records.get(id) });

test('missing principal fails closed for records and lists', () => {
  assert.equal(canAccessResource({}, records.get('a')), false);
  assert.deepEqual(scopeList({}, [...records.values()]), []);
});
test('new admin resources are stamped too', () => assert.equal(ownerOfRequest(admin), 'admin'));
test('unowned records stay administrator-only', () => {
  assert.equal(canAccessResource(a, {}), false);
  assert.equal(canAccessResource(admin, {}), true);
});
test('trusted parent inherits owner without writing the record', () => {
  const record = { sessionId: 'a' };
  assert.equal(resolvedOwner(record), 'a');
  assert.deepEqual(record, { sessionId: 'a' });
});
test('conflicting legacy parents remain unclaimed', () => assert.equal(resolvedOwner({ sessionId: 'a', missionId: 'b' }), null));
test('cyclic legacy parents fail closed', () => assert.equal(resolvedOwner(records.get('cycle')), null));
test('explicit owner takes precedence over parent', () => assert.equal(resolvedOwner({ ownerUserId: 'b', sessionId: 'a' }), 'b'));
test('concurrent request identities cannot bleed into each other', async () => {
  const rows = [records.get('a'), records.get('b')];
  const results = await Promise.all([a, b].map(request => accessContext.run(request, async () => {
    await Promise.resolve();
    return visibleList(rows).map(row => row.ownerUserId);
  })));
  assert.deepEqual(results, [['a'], ['b']]);
});
