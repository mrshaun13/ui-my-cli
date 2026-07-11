const assert = require('node:assert/strict');
const test = require('node:test');

test('browser collision keeps pending transport while binding canonical metadata', async () => {
  const { tabReducer, tabSessionId, tabTransportId } = await import('../../client/src/lib/tabState.js');
  let state = tabReducer({ tabs: [], activeTabId: null }, {
    type: 'open', id: 'pending-1', mode: 'terminal',
  });
  state = tabReducer(state, {
    type: 'rekey', oldId: 'pending-1', newId: 'real-1', collision: true,
  });

  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].id, 'pending-1');
  assert.equal(tabSessionId(state.tabs[0]), 'real-1');
  assert.equal(tabTransportId(state.tabs[0]), 'pending-1');
  assert.equal(state.activeTabId, 'pending-1');

  state = tabReducer(state, { type: 'close', id: 'pending-1' });
  assert.deepEqual(state, { tabs: [], activeTabId: null });
});

test('browser collision preserves both tabs when canonical tab is already open', async () => {
  const { tabReducer } = await import('../../client/src/lib/tabState.js');
  let state = { tabs: [], activeTabId: null };
  state = tabReducer(state, { type: 'open', id: 'pending-1', mode: 'terminal' });
  state = tabReducer(state, { type: 'open', id: 'real-1', mode: 'terminal' });
  state = tabReducer(state, {
    type: 'rekey', oldId: 'pending-1', newId: 'real-1', collision: true,
  });

  assert.deepEqual(state.tabs.map(tab => tab.id), ['pending-1', 'real-1']);
  assert.equal(state.tabs[0].canonicalId, 'real-1');
});

test('normal browser rekey updates identity and transport without remounting', async () => {
  const { tabReducer } = await import('../../client/src/lib/tabState.js');
  let state = tabReducer({ tabs: [], activeTabId: null }, {
    type: 'open', id: 'pending-1', mode: 'terminal',
  });
  state = tabReducer(state, {
    type: 'rekey', oldId: 'pending-1', newId: 'real-1', collision: false,
  });

  assert.equal(state.tabs[0].id, 'real-1');
  assert.equal(state.tabs[0].transportId, 'real-1');
  assert.equal(state.tabs[0].mountKey, 'pending-1');
  assert.equal(state.activeTabId, 'real-1');
});
