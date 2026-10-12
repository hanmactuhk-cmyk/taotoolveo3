const { app, BrowserWindow, session, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { checkAccount } = require('./account-service');
const { syncDrafts } = require('./drafts');
const { activeStates } = require('./job-utils');
const selectedImages = new Set();

const Store = require('./store');
const BrowserManager = require('./browser-manager');
const JobRunner = require('./job-runner');
const CdpClient = require('./cdp-client');

let mainWindow;
let store;
let browserManager;
let jobRunner;

function sendToRenderer(channel, data) {
  if (channel === 'log' && store) {
    try { fs.appendFileSync(path.join(store.root, 'studio.log'), new Date().toISOString() + ' ' + data + '\n'); }
    catch (error) { console.error('Không lưu được log:', error.message); }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function createWindow() {
  const ses = session.fromPartition('persist:flowdesk_main', { cache: true });
  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    title: 'FlowDesk Studio • Desktop Edition',
    backgroundColor: '#131924',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      session: ses
    }
  });

  const candidateIndexPaths = [
    path.join(__dirname, '../dist/index.html'),
    path.join(app.getAppPath(), 'dist/index.html'),
    path.join(__dirname, 'dist/index.html'),
    path.join(process.cwd(), 'dist/index.html')
  ];

  let loaded = false;
  for (const p of candidateIndexPaths) {
    if (fs.existsSync(p)) {
      console.log('[Electron] Nạp giao diện từ:', p);
      mainWindow.loadFile(p);
      loaded = true;
      break;
    }
  }

  if (!loaded) {
    console.log('[Electron] Tải từ http://localhost:3000');
    mainWindow.loadURL('http://localhost:3000');
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL && validatedURL.includes('localhost:3000')) {
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
        <!DOCTYPE html>
        <html lang="vi">
          <head>
            <meta charset="utf-8" />
            <title>FlowDesk Studio</title>
            <style>
              body { background: #131924; color: #E2E8F0; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1C2534; padding: 36px; border-radius: 12px; border: 1px solid #2B374B; max-width: 500px; text-align: center; }
              h2 { color: #38BDF8; margin-top: 0; }
              p { color: #94A3B8; font-size: 14px; line-height: 1.6; }
              button { background: #0284C7; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 16px; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>FlowDesk Studio</h2>
              <p>Chưa tìm thấy <code>dist/index.html</code>. Hãy chạy <code>npm run build</code> trước khi khởi chạy ứng dụng.</p>
              <button onclick="location.reload()">Thử tải lại</button>
            </div>
          </body>
        </html>
      `));
    }
  });

  mainWindow.setMenuBarVisibility(false);
}

function requireSelectedImage(value) {
  if (!path.isAbsolute(value || '') || !/\.(png|jpe?g|webp)$/i.test(value)) throw new Error('Chọn ảnh bằng hộp thoại của Electron.');
  const remembered = selectedImages.has(value) || store.data.Queue.some(job =>
    [job.StartImage, job.EndImage, ...(job.References || [])].includes(value));
  if (!remembered || !fs.existsSync(value)) throw new Error('Ảnh không còn tồn tại hoặc chưa được chọn.');
}

function imagePreview(value) {
  requireSelectedImage(value);
  if (fs.statSync(value).size > 20 * 1024 * 1024) return null;
  const ext = path.extname(value).toLowerCase();
  const type = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : ext.slice(1);
  return 'data:image/' + type + ';base64,' + fs.readFileSync(value).toString('base64');
}

function registerIpc() {
  ipcMain.handle('images:select', async (event, { multiple = false } = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn ảnh cho job', properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Ảnh', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (result.canceled) return [];
    result.filePaths.forEach(value => selectedImages.add(value));
    return result.filePaths.map(value => ({ path: value, name: path.basename(value), preview: imagePreview(value) }));
  });
  ipcMain.handle('images:preview', async (event, value) => imagePreview(value));
  ipcMain.handle('flow:catalog', async (event, { accountId, kind }) => {
    if (!['image', 'video'].includes(kind)) throw new Error('Chế độ không hợp lệ.');
    const account = store.data.Accounts.find(item => item.Id === accountId) || store.data.Accounts.find(item => item.Enabled && item.LoginStarted);
    if (!account) throw new Error('Thêm và đăng nhập tài khoản trước khi đồng bộ model.');
    if (jobRunner.accountBusy(account.Id)) throw new Error('Đợi job của hồ sơ kết thúc trước khi đồng bộ model.');
    const client = await browserManager.connectFlowTab(account);
    try { return await client.bridge({ action: 'catalog', kind }); }
    finally { client.dispose(); }
  });
  // Store
  ipcMain.handle('store:get', async () => {
    return store.data;
  });

  ipcMain.handle('store:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục lưu kết quả',
      defaultPath: store.data.OutputFolder,
      properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      store.data.OutputFolder = result.filePaths[0];
      store.save();
      return store.data.OutputFolder;
    }
    return null;
  });

  ipcMain.handle('store:open-folder', async (event, folderPath) => {
    const target = folderPath || store.data.OutputFolder;
    if (fs.existsSync(target)) {
      shell.openPath(target);
      return { success: true };
    }
    return { success: false, error: 'Thư mục không tồn tại.' };
  });

  // Accounts
  ipcMain.handle('account:create', async () => {
    const nextNum = Math.max(0, ...store.data.Accounts.map(a => Number((a.Name || '').match(/\d+$/)?.[0]) || 0)) + 1;
    if (store.data.Accounts.length >= 30) throw new Error('Đã có 30 hồ sơ.');
    const newAcc = {
      Id: 'acc_' + crypto.randomUUID(),
      Name: `Tài khoản ${nextNum.toString().padStart(2, '0')}`,
      Email: '',
      Plan: 'Unknown',
      Credits: null,
      Status: 'Chờ đăng nhập',
      Enabled: true,
      Images: true,
      Videos: true,
      LoginStarted: false,
      LoginMode: true,
      Port: 0,
      BrowserId: '',
      CheckedUtc: null
    };
    store.data.Accounts.push(newAcc);
    store.profileDir(newAcc);
    store.save();
    return newAcc;
  });

  ipcMain.handle('account:open-login', async (event, accountId) => {
    const acc = store.data.Accounts.find(a => a.Id === accountId);
    if (!acc) throw new Error('Không tìm thấy tài khoản.');
    if (jobRunner.accountBusy(accountId)) throw new Error('Đợi job đang chạy trước khi mở lại hồ sơ.');
    return await browserManager.openLogin(acc);
  });

  ipcMain.handle('account:check', async (event, accountId) => {
    const acc = store.data.Accounts.find(a => a.Id === accountId);
    if (!acc) throw new Error('Không tìm thấy tài khoản.');

    if (jobRunner.accountBusy(accountId)) throw new Error('Đợi job của hồ sơ này kết thúc trước khi kiểm tra.');
    return checkAccount(browserManager, store, acc, message => sendToRenderer('log', message),
      account => sendToRenderer('account-updated', account));
  });

  ipcMain.handle('account:close', async (event, accountId) => {
    if (jobRunner.accountBusy(accountId)) throw new Error('Đợi job của hồ sơ kết thúc trước khi đóng Chrome.');
    const acc = store.data.Accounts.find(a => a.Id === accountId);
    if (acc) await browserManager.close(acc);
    return { success: true };
  });

  ipcMain.handle('account:delete', async (event, accountId) => {
    if (jobRunner.accountBusy(accountId)) throw new Error('Không xóa tài khoản đang chạy job.');
    store.data.Accounts = store.data.Accounts.filter(a => a.Id !== accountId);
    store.save();
    return { success: true };
  });

  ipcMain.handle('account:update-perms', async (event, { accountId, perms }) => {
    const acc = store.data.Accounts.find(a => a.Id === accountId);
    if (acc) {
      if (perms.Enabled !== undefined) acc.Enabled = perms.Enabled;
      if (perms.Images !== undefined) acc.Images = perms.Images;
      if (perms.Videos !== undefined) acc.Videos = perms.Videos;
      store.save();
    }
    return { success: true };
  });

  // Queue & Jobs
  ipcMain.handle('queue:sync-prompts', async (event, payload) => {
    for (const image of payload.references || []) requireSelectedImage(image);
    return syncDrafts(store, payload);
  });

  ipcMain.handle('queue:update-job', async (event, patch) => {
    const job = store.data.Queue.find(item => item.Id === patch.Id);
    if (!job) throw new Error('Không tìm thấy job.');
    const keys = activeStates.has(job.State) ? ['Prompt'] :
      ['Prompt', 'Model', 'Ratio', 'Count', 'Mode', 'StartImage', 'EndImage', 'References', 'AccountId'];
    if (activeStates.has(job.State) && ['StartImage', 'EndImage', 'References'].some(key => Object.prototype.hasOwnProperty.call(patch, key))) {
      throw new Error('Không đổi ảnh của job đang chạy; chờ lần hiện tại kết thúc.');
    }
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(patch, key)) {
      if ((key === 'StartImage' || key === 'EndImage') && patch[key]) requireSelectedImage(patch[key]);
      if (key === 'References') {
        if (!Array.isArray(patch[key])) throw new Error('Danh sách ảnh không hợp lệ.');
        patch[key].forEach(requireSelectedImage); job.UseGlobalReferences = false;
      }
      job[key] = patch[key];
    }
    if (job.Kind === 'video' && (job.StartImage || job.EndImage)) job.Mode = 'Văn bản / Khung hình → Video';
    store.save(); sendToRenderer('queue-updated', store.data.Queue);
    return { success: true, job };
  });

  ipcMain.handle('queue:delete-job', async (event, jobId) => {
    const job = store.data.Queue.find(q => q.Id === jobId);
    if (job && activeStates.has(job.State)) throw new Error('Không xóa job đang chạy.');
    store.data.Queue = store.data.Queue.filter(q => q.Id !== jobId);
    store.save();
    return { success: true };
  });

  ipcMain.handle('queue:retry-job', async (event, jobId) => {
    const job = jobRunner.retryJob(jobId);
    if (!jobRunner.running) jobRunner.runQueue({ ...jobRunner.lastOptions, kind: job.Kind, only: [job.Id] }).catch(error => sendToRenderer('log', error.message));
    return { success: true };
  });

  ipcMain.handle('queue:clear-completed', async (event, kind) => {
    store.data.Queue = store.data.Queue.filter(q => !(q.Kind === kind && q.State === 'Hoàn tất'));
    store.save();
    return store.data.Queue;
  });

  // Runner controls
  ipcMain.handle('runner:start', async (event, options) => {
    for (const job of store.data.Queue) if ((!options.kind || job.Kind === options.kind) && job.AutoDraft) job.AutoDraft = false;
    store.save();
    jobRunner.runQueue(options).catch(error => sendToRenderer('log', '[Runner] ' + error.message));
    return { success: true };
  });

  ipcMain.handle('runner:pause', async () => {
    jobRunner.pause();
    return { success: true, paused: jobRunner.paused };
  });

  ipcMain.handle('runner:stop', async () => {
    jobRunner.stop();
    return { success: true };
  });
}

app.whenReady().then(() => {
  store = new Store();
  browserManager = new BrowserManager(store);
  jobRunner = new JobRunner(store, browserManager, (event, data) => {
    sendToRenderer(event, data);
  });

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

