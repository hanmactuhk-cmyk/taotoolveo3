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
    const legacy = path.join(appRoot, 'Data');
    const portable = process.env.PORTABLE_EXECUTABLE_DIR && path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Data');
    for (const candidate of [portable, legacy].filter(Boolean)) {
      if (fs.existsSync(path.join(candidate, 'accounts.json'))) {
        fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
        return candidate;
      }
    }
    const dataDir = app && app.isPackaged ? path.join(app.getPath('userData'), 'Data') : legacy;
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
        if (!Array.isArray(parsed.Accounts) || !Array.isArray(parsed.Queue)) throw new Error('Dữ liệu tài khoản/hàng chờ không hợp lệ.');
        if (!Array.isArray(parsed.Jobs)) parsed.Jobs = [];
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
        const backup = this.fileName + '.bak';
        if (fs.existsSync(backup)) {
          const parsed = JSON.parse(fs.readFileSync(backup, 'utf8'));
          if (Array.isArray(parsed.Accounts) && Array.isArray(parsed.Queue)) {
            this.recoveredFromBackup = true;
            for (const job of parsed.Queue) if (['Đang chạy', 'Đang gửi'].includes(job.State)) {
              job.State = 'Cần kiểm tra'; job.Note = 'Khôi phục từ bản sao dự phòng; không tự gửi lại.';
            }
            parsed.Jobs = parsed.Jobs || [];
            parsed.OutputFolder = parsed.OutputFolder || path.join(this.root, 'Results');
            return parsed;
          }
        }
        throw new Error(`Không đọc được dữ liệu; giữ nguyên tệp để phục hồi. ${err.message}`);
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
      if (fs.existsSync(this.fileName) && !this.recoveredFromBackup) {
        try {
          fs.copyFileSync(this.fileName, this.fileName + '.bak');
        } catch (e) {}
      }
      fs.renameSync(tempFile, this.fileName);
      this.recoveredFromBackup = false;
    } catch (err) {
      throw new Error('Không lưu được dữ liệu: ' + err.message);
    }
  }

  profileDir(account) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(account.Id || '')) throw new Error('Mã hồ sơ không hợp lệ.');
    const dir = path.join(this.root, 'Profiles', account.Id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

module.exports = Store;

