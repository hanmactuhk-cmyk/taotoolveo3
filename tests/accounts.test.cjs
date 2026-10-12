const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { checkAccount } = require('../electron/account-service');
const BrowserManager = require('../electron/browser-manager');

test('account check uses a page client, never BrowserId for DOM commands', async () => {
  const events = []; const account = { Id: 'a', Name: 'A', BrowserId: 'ws://127.0.0.1/browser/root' };
  const client = { async call(method) { events.push(method); }, async bridge(request) {
    assert.equal(request.action, 'account'); return { email: 'fixture@example.invalid', plan: 'Free', credits: 40 };
  }, dispose() { events.push('dispose'); } };
  const browser = { async connectFlowTab(selected) { assert.equal(selected, account); return client; } };
  let saved = 0; const result = await checkAccount(browser, { save() { saved++; } }, account);
  assert.equal(result.success, true); assert.equal(account.Credits, 40); assert.equal(saved, 1);
  assert.deepEqual(events, ['Page.enable', 'Network.enable', 'dispose']);
});

test('account failure invalidates stale verification and disposes the page', async () => {
  const account = { Id: 'a', CheckedUtc: 'old' }; let disposed = false;
  await assert.rejects(checkAccount({ async connectFlowTab() { return {
    async call() {}, async bridge() { throw new Error('missing panel'); }, dispose() { disposed = true; }
  }; } }, { save() {} }, account), /missing panel/);
  assert.equal(account.CheckedUtc, null); assert.equal(disposed, true);
});

test('already controlled Chrome is reused without requiring its profile to be closed', async () => {
  const manager = new BrowserManager({}); manager.isOpen = async () => true;
  manager.store.profileDir = () => { throw new Error('Should not check running controlled profile'); };
  await Promise.all([manager.enableControl({ Id: 'a' }), manager.enableControl({ Id: 'a' })]);
});

test('two jobs connect to distinct page targets; never fall back to an existing job tab', async () => {
  const modulePath = require.resolve('../electron/cdp-client'); const existing = require.cache[modulePath];
  let created = 0; const pages = [{ type: 'page', id: 'existing', url: 'https://flow.google.com/project/old', webSocketDebuggerUrl: 'ws://127.0.0.1/existing' }];
  class FakeCdp {
    async connect(value) { this.address = value; }
    async call(method, params) {
      if (method === 'Target.createTarget') {
        const id = 'new-' + ++created; pages.push({ type: 'page', id, url: params.url, webSocketDebuggerUrl: 'ws://127.0.0.1/' + id }); return { targetId: id };
      }
      if (this.address.includes('/browser/')) throw new Error('Page command on browser endpoint');
      if (method === 'Page.getNavigationHistory') return { currentIndex: 0, entries: [{ url: 'https://flow.google.com/' }] };
      if (method === 'Runtime.evaluate') return { result: { value: true } };
      throw new Error(method);
    }
    dispose() {}
  }
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: FakeCdp };
  try {
    const manager = new BrowserManager({}); manager.enableControl = async () => {};
    manager.readHttpJson = async () => pages;
    const account = { Id: 'a', BrowserId: 'ws://127.0.0.1/browser/root', Port: 12345 };
    const [one, two] = await Promise.all([manager.connectFlowTab(account, { newTab: true }), manager.connectFlowTab(account, { newTab: true })]);
    assert.notEqual(one.address, two.address); assert.notEqual(one.address, pages[0].webSocketDebuggerUrl);
    assert.equal(created, 2);
  } finally { if (existing) require.cache[modulePath] = existing; else delete require.cache[modulePath]; }
});
