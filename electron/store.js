const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class Store {
  constructor() {
    this.root = this.getStoreDir();
    this.fileName = path.join(this.root, 'accounts.json');
    this.data = this.load();
  }

  getStoreDir() {
    const appRoot = app && app.isPackaged ? path.dirname(process.execPath) : process.cwd();
    const dataDir = path.join(appRoot, 'Data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (e) {
        if (app) {
          const userDir = path.join(app.getPath('userData'), 'Data');
          if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
          return userDir;
        }
      }
    }
    return dataDir;
  }

  load() {
    if (fs.existsSync(this.fileName)) {
      try {
        const raw = fs.readFileSync(this.fileName, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.Accounts) parsed.Accounts = [];
        if (!parsed.Jobs) parsed.Jobs = [];
        if (!parsed.Queue) parsed.Queue = [];
        if (!parsed.OutputFolder) parsed.OutputFolder = path.join(this.root, 'Results');

        // Khôi phục trạng thái gián đoạn từ phiên trước
        for (const j of parsed.Jobs) {
          if (j.State === 'Đang gửi') {
            j.State = 'Chưa rõ kết quả';
            j.Note = 'Ứng dụng đã đóng giữa lúc gửi. Kiểm tra Flow trước khi chạy lại.';
          }
        }
        for (const q of parsed.Queue) {
          if (q.State === 'Đang chạy' || q.State === 'Đang gửi') {
            q.State = 'Cần kiểm tra';
            q.Note = 'Phiên trước gián đoạn. Kiểm tra Flow trước khi chạy lại.';
          }
        }
        return parsed;
      } catch (err) {
        console.error('[Store] Lỗi đọc accounts.json:', err);
      }
    }
    return {
      Accounts: [],
      Jobs: [],
      Queue: [],
      OutputFolder: path.join(this.root, 'Results')
    };
  }

  save() {
    const tempFile = this.fileName + '.tmp';
    const jsonStr = JSON.stringify(this.data, null, 2);
    try {
      fs.writeFileSync(tempFile, jsonStr, 'utf8');
      if (fs.existsSync(this.fileName)) {
        try {
          fs.copyFileSync(this.fileName, this.fileName + '.bak');
        } catch (e) {}
      }
      fs.renameSync(tempFile, this.fileName);
    } catch (err) {
      console.error('[Store] Lỗi lưu accounts.json:', err);
    }
  }

  profileDir(account) {
    if (!account.Id) throw new Error('Mã hồ sơ không hợp lệ.');
    const dir = path.join(this.root, 'Profiles', account.Id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

module.exports = Store;
