const { contextBridge, ipcRenderer } = require('electron');

// Ẩn navigator.webdriver ngay từ tầng Preload để tránh bị Google BotGuard và reCAPTCHA phát hiện
try {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
  });
  Object.defineProperty(navigator, 'languages', {
    get: () => ['vi-VN', 'vi', 'en-US', 'en']
  });
} catch (e) {}

// Expose API cho giao diện React
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  version: process.versions.electron,

  // Khởi chạy Chrome thực tế trên Windows giữ 100% cơ chế cũ của FlowDesk
  openChromeProfile: (params) => ipcRenderer.invoke('open-chrome-profile', params),

  // Cửa sổ đăng nhập bên trong Electron (phương án phụ trợ)
  openLoginWindow: (accountId) => ipcRenderer.invoke('open-login-window', accountId),

  // Đọc danh sách tài khoản từ accounts.json
  getAccounts: () => ipcRenderer.invoke('get-accounts'),

  // Lưu danh sách tài khoản vào accounts.json
  saveAccounts: (accounts) => ipcRenderer.invoke('save-accounts', accounts),

  // Mở thư mục kết quả
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath)
});
