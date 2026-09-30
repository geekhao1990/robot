const test = require('node:test');
const assert = require('node:assert/strict');
const { _testing } = require('../src/db');

test('dark orders, entitlements and reactions are split out of the legacy app_state snapshot', () => {
  const source = {
    users: [{
      id: 'u1', name: '用户', goldExpire: 123, serviceExpire: 456, servicePlan: 'service_month',
      darkFundEnabled: true, darkFundRemaining: 3, darkFundManualRemaining: 1,
      darkFundServiceRemaining: 2, darkFundServicePeriodStart: 100, darkFundServicePeriodExpire: 200,
    }],
    userState: { u1: { likes: { n1: 10 }, collects: { n2: 20 }, follows: { u2: 30 } } },
    darkFundOrders: [{ id: 'DF1', userId: 'u1', clientRequestId: 'request_123456', status: 'QUEUED' }],
    notes: [{ id: 'n1' }],
  };
  const appState = _testing.appStateSnapshot(source);
  const normalized = _testing.normalizedStateSnapshot(source);

  assert.equal('darkFundOrders' in appState, false);
  assert.equal('goldExpire' in appState.users[0], false);
  assert.deepEqual(appState.userState.u1, { follows: { u2: 30 } });
  assert.equal(normalized.orders[0].clientRequestId, 'request_123456');
  assert.equal(normalized.entitlements[0].goldExpire, 123);
  assert.deepEqual(normalized.reactions.map((item) => [item.noteId, item.liked, item.collected]), [
    ['n1', true, false], ['n2', false, true],
  ]);
});
