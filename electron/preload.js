const { contextBridge, ipcRenderer } = require('electron');

// Ẩn navigator.webdriver ngay từ tầng Preload để tránh bị Google BotGuard và reCAPTCHA phát hiện
try {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
  });
} catch (e) {}

// Expose các API an toàn cho giao diện React
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron
});
