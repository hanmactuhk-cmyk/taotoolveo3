const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { regularArguments, openRegularProfile } = require('../electron/regular-profile');
test('regular profiles use separate folders and normal launch arguments', () => {
  const one = regularArguments('C:/data/Profiles/one');
  const two = regularArguments('C:/data/Profiles/two');
  assert.notEqual(one[0], two[0]);
  assert.deepEqual(one.slice(1), ['--new-window', 'https://flow.google.com/']);
  assert(!one.some(value => /debugging|sandbox|Automation|keychain|password-store/.test(value)));
});
test('regular launch saves account only after successful spawn and preserves stored identity', async () => {
  const account = { Id: 'one', Email: 'fixture@example.invalid', Plan: 'Plus', Port: 12345, BrowserId: 'old' };
  const browser = { constructor: { findBrowser: () => 'browser.exe' }, isOpen: async () => false };
  let saves = 0;
  const store = { profileDir: a => 'profiles/' + a.Id, save() { saves++; } };
  const launch = (exe, args) => { assert.equal(exe, 'browser.exe'); assert.equal(args[0], '--user-data-dir=profiles/one'); const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child; };
  await openRegularProfile(browser, store, account, launch);
  assert.equal(saves, 1); assert.equal(account.LoginMode, true); assert.equal(account.Port, 0);
  assert.equal(account.Email, 'fixture@example.invalid'); assert.equal(account.Plan, 'Plus');
});
test('active controlled profile cannot be closed implicitly by regular launch', async () => {
  await assert.rejects(openRegularProfile({isOpen:async()=>true},{},{Id:'one'}), /Đóng phiên/);
});
test('failed spawn does not mark account logged in', async () => {
  const account = { Id: 'one', LoginStarted: false };
  await assert.rejects(openRegularProfile({constructor:{findBrowser:()=> 'browser.exe'},isOpen:async()=>false},
    {profileDir:()=> 'profiles/one',save(){throw Error('should not save');}}, account, () => {
      const child = new EventEmitter(); queueMicrotask(()=>child.emit('error',Error('spawn failed'))); return child;
    }), /spawn failed/);
  assert.equal(account.LoginStarted,false);
});
