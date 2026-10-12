const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

test('native image paths reach persistent jobs; renderer cannot overwrite submission state', async () => {
  const root = fs.mkdtempSync(path.join(__dirname, '.ipc-')); const image = path.join(root, 'picked.png'); fs.writeFileSync(image, 'fixture');
  const handlers = new Map(); const previousDirectory = process.cwd(); const originalLoad = Module._load;
  class Window {
    constructor(config) { this.config = config; Window.last = this; this.webContents = { send() {}, on() {} }; }
    isDestroyed() { return false; } loadFile() {} loadURL() {} setMenuBarVisibility() {} on() {}
    static getAllWindows() { return [Window.last]; }
  }
  const fakeElectron = {
    app: { isPackaged: false, getAppPath: () => root, getPath: () => root, whenReady: () => ({ then(callback) { callback(); } }), on() {}, quit() {} },
    BrowserWindow: Window, session: { fromPartition: () => ({}) },
    ipcMain: { handle(name, handler) { handlers.set(name, handler); } }, shell: { async openPath() {} },
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: [image] }; } }
  };
  Module._load = function(request, ...args) { return request === 'electron' ? fakeElectron : originalLoad.call(this, request, ...args); };
  process.chdir(root);
  try {
    require('../electron/main');
    assert.equal(Window.last.config.webPreferences.contextIsolation, true);
    assert.equal(Window.last.config.webPreferences.webSecurity, true);
    const call = (name, value) => handlers.get(name)({}, value);
    const selected = await call('images:select', { multiple: false });
    assert.equal(selected[0].path, image); assert.match(selected[0].preview, /^data:image\/png;base64,/);
    const payload = { kind: 'video', prompts: ['a'], model: 'Veo 3.1 Fast', ratio: '16:9', count: 'x1', mode: 'Văn bản / Khung hình → Video', references: [], accountId: 'auto' };
    const [job] = await call('queue:sync-prompts', payload);
    await call('queue:update-job', { Id: job.Id, StartImage: image, Submitted: true, State: 'Hoàn tất' });
    const state = await call('store:get');
    assert.equal(state.Queue[0].StartImage, image); assert.equal(state.Queue[0].Submitted, false); assert.equal(state.Queue[0].State, 'Hàng đợi');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'Data', 'accounts.json'))).Queue[0].StartImage, image);
    await call('queue:sync-prompts', { ...payload, prompts: ['edited'] });
    assert.equal(state.Queue[0].StartImage, image); assert.equal(state.Queue[0].Prompt, 'edited');
    await assert.rejects(call('queue:update-job', { Id: job.Id, References: ['fake-name.png'] }), /Chọn ảnh/);
    const a = await call('account:create'); await call('account:delete', a.Id); const b = await call('account:create'); assert.notEqual(a.Id, b.Id);
  } finally { process.chdir(previousDirectory); Module._load = originalLoad; }
});
