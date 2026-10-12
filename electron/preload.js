const { contextBridge, ipcRenderer } = require('electron');

// Ẩn navigator.webdriver ngay từ tầng Preload
try {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
  });
  Object.defineProperty(navigator, 'languages', {
    get: () => ['vi-VN', 'vi', 'en-US', 'en']
  });
} catch (e) {}

// Preload chỉ cung cấp IPC điều khiển cần thiết qua contextBridge;
// KHÔNG đưa cookie hay thông tin xác thực nhạy cảm vào Renderer
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  // Quản lý tài khoản
  openChromeLogin: (accountId) => ipcRenderer.invoke('account:open-login', accountId),
  checkAccount: (accountId) => ipcRenderer.invoke('account:check', accountId),
  closeAccount: (accountId) => ipcRenderer.invoke('account:close', accountId),
  createAccount: () => ipcRenderer.invoke('account:create'),
  deleteAccount: (accountId) => ipcRenderer.invoke('account:delete', accountId),
  updateAccountPermissions: (accountId, perms) => ipcRenderer.invoke('account:update-perms', { accountId, perms }),

  // Dữ liệu Store & Thư mục
  getStore: () => ipcRenderer.invoke('store:get'),
  selectFolder: () => ipcRenderer.invoke('store:select-folder'),
  selectImages: (multiple = false) => ipcRenderer.invoke('images:select', { multiple }),
  imagePreview: (filePath) => ipcRenderer.invoke('images:preview', filePath),
  syncModels: (accountId, kind) => ipcRenderer.invoke('flow:catalog', { accountId, kind }),
  openFolder: (folderPath) => ipcRenderer.invoke('store:open-folder', folderPath),

  // Quản lý Hàng đợi & Jobs
  syncPrompts: (payload) => ipcRenderer.invoke('queue:sync-prompts', payload),
  updateJob: (job) => ipcRenderer.invoke('queue:update-job', job),
  deleteJob: (jobId) => ipcRenderer.invoke('queue:delete-job', jobId),
  retryJob: (jobId) => ipcRenderer.invoke('queue:retry-job', jobId),
  clearCompletedJobs: (kind) => ipcRenderer.invoke('queue:clear-completed', kind),

  // Điều phối chạy hàng chờ
  startQueue: (options) => ipcRenderer.invoke('runner:start', options),
  pauseQueue: () => ipcRenderer.invoke('runner:pause'),
  stopQueue: () => ipcRenderer.invoke('runner:stop'),

  // Lắng nghe sự kiện từ Main Process
  onEvent: (channel, callback) => {
    const validChannels = ['log', 'queue-updated', 'account-updated', 'runner-status'];
    if (validChannels.includes(channel)) {
      const subscription = (event, data) => callback(data);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    return () => {};
  }
});

