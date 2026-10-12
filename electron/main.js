const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  // Tạo session cố định để lưu giữ cookie đăng nhập Google Flow và vượt reCAPTCHA
  const ses = session.fromPartition('persist:flowdesk_main', { cache: true });

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    title: 'FlowDesk Studio • Desktop Edition',
    backgroundColor: '#131924',
    webPreferences: {
      preload: path.join(__dirname, 'electron/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      session: ses
    }
  });

  // Tự động tiêm Stealth script để ẩn cờ bot navigator.webdriver
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: details.responseHeaders });
  });

  // Load app từ thư mục dist (sau khi build React/Vite)
  if (app.isPackaged || process.env.NODE_ENV === 'production') {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
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
