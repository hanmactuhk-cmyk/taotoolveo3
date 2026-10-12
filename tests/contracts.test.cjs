const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('all preload IPC channels have a main handler and existing API methods remain available', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
  const registered = new Set([...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(match => match[1]));
  for (const match of preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)) assert(registered.has(match[1]), match[1]);
  for (const method of ['openChromeLogin', 'checkAccount', 'closeAccount', 'createAccount', 'deleteAccount',
    'updateAccountPermissions', 'getStore', 'selectFolder', 'openFolder', 'syncPrompts', 'updateJob',
    'deleteJob', 'retryJob', 'clearCompletedJobs', 'startQueue', 'pauseQueue', 'stopQueue', 'onEvent']) {
    assert(preload.includes(method + ':'), method);
  }
});

test('existing studio/accounts/mapping/log tabs and preview mode are retained', () => {
  const renderer = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  for (const tab of ['studio', 'accounts', 'mapping', 'logs']) assert(renderer.includes(`activeTab === '${tab}'`), tab);
  assert(renderer.includes('Bản xem thử giao diện'));
  assert(renderer.includes('Đăng nhập Chrome thường'));
  assert(renderer.includes('Thành phần → Video'));
});

test('Windows package contains the bridge and all Electron modules', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert(pkg.devDependencies.electron); assert(pkg.devDependencies['electron-builder']);
  assert(pkg.build.files.includes('flow-bridge.js')); assert(pkg.build.files.includes('electron/**/*'));
});
