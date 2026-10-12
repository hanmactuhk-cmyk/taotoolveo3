const { app, BrowserWindow, session, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const http = require('http');

let mainWindow;

// Đường dẫn thư mục dữ liệu Data/ giống 100% bản gốc FlowDesk
function getStoreDir() {
  const appRoot = app.isPackaged ? path.dirname(process.execPath) : process.cwd();
  const dataDir = path.join(appRoot, 'Data');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {
      return path.join(app.getPath('userData'), 'Data');
    }
  }
  return dataDir;
}

function getAccountsFilePath() {
  return path.join(getStoreDir(), 'accounts.json');
}

function getProfilePath(accountId) {
  const profilesDir = path.join(getStoreDir(), 'Profiles', accountId);
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }
  return profilesDir;
}

// Tìm đường dẫn Google Chrome hoặc Microsoft Edge trên Windows
function findBrowserPath() {
  const env = process.env;
  const programFiles = env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = env['LOCALAPPDATA'] || (env['USERPROFILE'] ? path.join(env['USERPROFILE'], 'AppData\\Local') : 'C:\\Users\\AppData\\Local');

  const possiblePaths = [
    // 64-bit Google Chrome
    path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    // 32-bit Google Chrome
    path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    // User LocalAppData Chrome
    path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
    // 64-bit Microsoft Edge
    path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
    // 32-bit Microsoft Edge
    path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    // User LocalAppData Edge
    path.join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function createWindow() {
  // Session cố định chống reCAPTCHA và lưu cookies Google Flow
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
      webSecurity: false,               // Khắc phục lỗi màn hình đen khi nạp module qua file://
      allowRunningInsecureContent: true,
      session: ses
    }
  });

  // Tìm tệp giao diện index.html của Vite
  const candidateIndexPaths = [
    path.join(__dirname, '../dist/index.html'),
    path.join(app.getAppPath(), 'dist/index.html'),
    path.join(__dirname, 'dist/index.html'),
    path.join(process.cwd(), 'dist/index.html')
  ];

  let loaded = false;
  for (const p of candidateIndexPaths) {
    if (fs.existsSync(p)) {
      console.log('[Electron] Tải giao diện từ:', p);
      mainWindow.loadFile(p);
      loaded = true;
      break;
    }
  }

  if (!loaded) {
    console.log('[Electron] Không tìm thấy file dist/index.html, thử kết nối http://localhost:3000');
    mainWindow.loadURL('http://localhost:3000');
  }

  // Xử lý khi tải trang thất bại -> Hiển thị thông báo thay vì để màn hình đen thui
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Electron] Tải thất bại:', errorCode, errorDescription, validatedURL);
    if (validatedURL && validatedURL.includes('localhost:3000')) {
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
        <!DOCTYPE html>
        <html lang="vi">
          <head>
            <meta charset="utf-8" />
            <title>FlowDesk Studio</title>
            <style>
              body { background: #131924; color: #E2E8F0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1C2534; padding: 36px; border-radius: 12px; border: 1px solid #2B374B; max-width: 520px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
              h2 { color: #38BDF8; margin-top: 0; font-size: 20px; }
              p { color: #94A3B8; font-size: 14px; line-height: 1.6; }
              .btn { background: #0284C7; color: white; border: none; padding: 10px 22px; border-radius: 8px; cursor: pointer; font-weight: bold; margin-top: 16px; font-size: 14px; }
              .btn:hover { background: #0369A1; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>FlowDesk Studio • Đang khởi chạy</h2>
              <p>Ứng dụng chưa tìm thấy thư mục <code>dist/index.html</code> hoặc máy chủ dev chưa bật.</p>
              <p>Vui lòng chạy lệnh <code>npm run build</code> trước khi mở ứng dụng.</p>
              <button class="btn" onclick="location.reload()">Thử tải lại</button>
            </div>
          </body>
        </html>
      `));
    }
  });

  mainWindow.setMenuBarVisibility(false);
}

// Khởi chạy Chrome thực tế trên Windows giữ 100% cơ chế cũ của FlowDesk
ipcMain.handle('open-chrome-profile', async (event, { accountId, mode, port }) => {
  const profileDir = getProfilePath(accountId);
  const targetUrl = 'https://labs.google/fx/tools/flow';

  let args = [];
  if (mode === 'control') {
    // Chế độ điều khiển tự động qua CDP WebSocket
    args = [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${port || 0}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--exclude-switches=enable-automation',
      '--disable-infobars',
      '--new-window',
      targetUrl
    ];
  } else {
    // Chế độ đăng nhập Chrome thường (cơ chế cũ: mở Chrome với hồ sơ riêng để đăng nhập)
    args = [
      `--user-data-dir=${profileDir}`,
      '--disable-blink-features=AutomationControlled',
      '--exclude-switches=enable-automation',
      '--disable-infobars',
      '--new-window',
      targetUrl
    ];
  }

  const browserExe = findBrowserPath();

  if (browserExe) {
    try {
      console.log(`[Chrome] Khởi chạy: "${browserExe}" ${args.join(' ')}`);
      const proc = spawn(browserExe, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      proc.unref();
      return { success: true, profileDir, exe: browserExe, method: 'spawn' };
    } catch (err) {
      console.error('[Chrome] Lỗi spawn:', err);
    }
  }

  // Fallback 1: Dùng lệnh start của cmd để Windows tự định vị Chrome
  try {
    const cmd = `start "" chrome ${args.map(a => `"${a}"`).join(' ')}`;
    console.log('[Chrome] Fallback cmd:', cmd);
    exec(cmd, { windowsHide: false });
    return { success: true, profileDir, method: 'cmd-chrome' };
  } catch (cmdErr) {
    // Fallback 2: Thử mở bằng msedge
    try {
      const edgeCmd = `start "" msedge ${args.map(a => `"${a}"`).join(' ')}`;
      exec(edgeCmd, { windowsHide: false });
      return { success: true, profileDir, method: 'cmd-edge' };
    } catch (edgeErr) {
      return {
        success: false,
        error: 'Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy: ' + edgeErr.message
      };
    }
  }
});

// Mở cửa sổ đăng nhập bên trong Electron (phương án dự phòng khi máy không có Chrome)
ipcMain.handle('open-login-window', async (event, accountId) => {
  const ses = session.fromPartition(`persist:account_${accountId}`, { cache: true });

  const loginWin = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `Đăng nhập Google Flow - Hồ sơ ${accountId}`,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  loginWin.loadURL('https://labs.google/fx/tools/flow');
  return { success: true };
});

// Đọc danh sách tài khoản từ file accounts.json
ipcMain.handle('get-accounts', async () => {
  const filePath = getAccountsFilePath();
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      return data.Accounts || [];
    } catch (e) {
      return [];
    }
  }
  return [];
});

// Lưu danh sách tài khoản vào file accounts.json
ipcMain.handle('save-accounts', async (event, accounts) => {
  const filePath = getAccountsFilePath();
  try {
    let data = { Accounts: accounts, Jobs: [], Queue: [] };
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const old = JSON.parse(raw);
        data = { ...old, Accounts: accounts };
      } catch (e) {}
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Mở thư mục kết quả
ipcMain.handle('open-folder', async (event, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
    return { success: true };
  }
  return { success: false, error: 'Thư mục không tồn tại' };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
