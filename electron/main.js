const { app, BrowserWindow, session, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const Store = require('./store');
const BrowserManager = require('./browser-manager');
const JobRunner = require('./job-runner');
const CdpClient = require('./cdp-client');

let mainWindow;
let store;
let browserManager;
let jobRunner;

function sendToRenderer(channel, data) {
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
      webSecurity: false,               // Khắc phục lỗi nạp file:// module CORS gây màn hình đen
      allowRunningInsecureContent: true,
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

function registerIpc() {
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
    const nextNum = store.data.Accounts.length + 1;
    const newAcc = {
      Id: `acc_${nextNum.toString().padStart(2, '0')}`,
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
    return await browserManager.openLogin(acc);
  });

  ipcMain.handle('account:check', async (event, accountId) => {
    const acc = store.data.Accounts.find(a => a.Id === accountId);
    if (!acc) throw new Error('Không tìm thấy tài khoản.');

    sendToRenderer('log', `[Account] Bắt đầu kết nối CDP kiểm tra tài khoản ${acc.Name}...`);
    await browserManager.enableControl(acc);

    const cdp = new CdpClient();
    try {
      await cdp.connect(acc.BrowserId);
      await cdp.enableDiagnostics();

      const data = await cdp.bridge({ action: 'account' });
      if (!data || !data.email) throw new Error('Flow chưa trả email.');

      acc.Email = data.email;
      acc.Plan = data.plan;
      acc.Credits = data.credits;
      acc.Evidence = data.evidence || '';
      acc.CheckedUtc = new Date().toISOString();
      acc.Status = acc.Plan === 'Unknown' || acc.Credits === null ?
        'Đã đọc email; gói/credit chưa rõ' :
        'Hoạt động — đã xác minh từ Flow';

      store.save();
      sendToRenderer('account-updated', acc);
      sendToRenderer('log', `[Account] Đã xác minh: ${acc.Email} | Gói: ${acc.Plan} | Credits: ${acc.Credits}`);
      return { success: true, account: acc };
    } finally {
      cdp.dispose();
    }
  });

  ipcMain.handle('account:close', async (event, accountId) => {
    const acc = store.data.Accounts.find(a => a.Id === accountId);
    if (acc) await browserManager.close(acc);
    return { success: true };
  });

  ipcMain.handle('account:delete', async (event, accountId) => {
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
  ipcMain.handle('queue:sync-prompts', async (event, { kind, prompts, model, ratio, count, mode, references, accountId }) => {
    const drafts = store.data.Queue.filter(q => q.Kind === kind && q.AutoDraft && !q.Submitted && q.State === 'Hàng đợi');

    for (let i = 0; i < prompts.length; i++) {
      const text = prompts[i];
      if (i < drafts.length) {
        drafts[i].Prompt = text;
        drafts[i].Model = model;
        drafts[i].Ratio = ratio;
        drafts[i].Count = count;
        drafts[i].Mode = mode;
        drafts[i].References = references || [];
        if (accountId && accountId !== 'auto') drafts[i].AccountId = accountId;
      } else {
        const newJob = {
          Id: 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          Kind: kind,
          Mode: mode,
          Model: model,
          Ratio: ratio,
          Count: count,
          Prompt: text,
          References: references || [],
          StartImage: null,
          EndImage: null,
          State: 'Hàng đợi',
          Note: 'Bản nháp tự động',
          AccountId: accountId === 'auto' ? '' : (accountId || ''),
          Folder: '',
          Progress: null,
          Results: [],
          Submitted: false,
          AutoDraft: true,
          Attempts: []
        };
        store.data.Queue.push(newJob);
      }
    }

    // Xóa các hàng thừa nếu người dùng xóa bớt prompt
    for (let i = prompts.length; i < drafts.length; i++) {
      const idx = store.data.Queue.indexOf(drafts[i]);
      if (idx !== -1) store.data.Queue.splice(idx, 1);
    }

    store.save();
    return store.data.Queue;
  });

  ipcMain.handle('queue:update-job', async (event, updatedJob) => {
    const job = store.data.Queue.find(q => q.Id === updatedJob.Id);
    if (job) {
      if (job.State === 'Đang chạy') {
        // Nếu đang chạy, prompt sửa sẽ chỉ áp dụng cho lần chạy tiếp theo
        job.Prompt = updatedJob.Prompt;
      } else {
        Object.assign(job, updatedJob);
      }
      store.save();
    }
    return { success: true };
  });

  ipcMain.handle('queue:delete-job', async (event, jobId) => {
    store.data.Queue = store.data.Queue.filter(q => q.Id !== jobId);
    store.save();
    return { success: true };
  });

  ipcMain.handle('queue:retry-job', async (event, jobId) => {
    jobRunner.retryJob(jobId);
    return { success: true };
  });

  ipcMain.handle('queue:clear-completed', async (event, kind) => {
    store.data.Queue = store.data.Queue.filter(q => !(q.Kind === kind && q.State === 'Hoàn tất'));
    store.save();
    return store.data.Queue;
  });

  // Runner controls
  ipcMain.handle('runner:start', async (event, options) => {
    jobRunner.runQueue(options);
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
