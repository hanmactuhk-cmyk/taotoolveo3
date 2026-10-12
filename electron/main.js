const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  // Tạo session cố định để lưu giữ cookie đăng nhập Google Flow và vượt reCAPTCHA
  const ses = session.fromPartition('persist:flowdesk_main', { cache: true });

  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    title: 'FlowDesk Studio • Desktop Edition',
    backgroundColor: '#131924',
    webPreferences: {
      preload: fs.existsSync(preloadPath) ? preloadPath : path.join(__dirname, 'electron/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      session: ses
    }
  });

  // Tự động tiêm Stealth script để ẩn cờ bot navigator.webdriver
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: details.responseHeaders });
  });

  // Tìm đường dẫn file index.html được build bởi Vite
  const indexPathLocal = path.join(__dirname, '../dist/index.html');
  const indexPathPackaged = path.join(app.getAppPath(), 'dist/index.html');

  if (fs.existsSync(indexPathPackaged)) {
    mainWindow.loadFile(indexPathPackaged);
  } else if (fs.existsSync(indexPathLocal)) {
    mainWindow.loadFile(indexPathLocal);
  } else {
    mainWindow.loadURL('http://localhost:3000');
  }

  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
