const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, exec } = require('child_process');

class BrowserManager {
  constructor(store) {
    this.store = store;
  }

  static findBrowser() {
    const env = process.env;
    const programFiles = env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = env['LOCALAPPDATA'] || (env['USERPROFILE'] ? path.join(env['USERPROFILE'], 'AppData\\Local') : 'C:\\Users\\AppData\\Local');

    const paths = [
      path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe')
    ];

    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  static profileInUse(profileDir) {
    const lockFiles = [
      path.join(profileDir, 'Default', 'LOCK'),
      path.join(profileDir, 'Default', 'History'),
      path.join(profileDir, 'Default', 'Network', 'Cookies')
    ];
    for (const f of lockFiles) {
      if (!fs.existsSync(f)) continue;
      try {
        const fd = fs.openSync(f, 'r+');
        fs.closeSync(fd);
      } catch (err) {
        if (err.code === 'EBUSY' || err.code === 'EPERM') return true;
      }
    }
    return false;
  }

  static loginArguments(profileDir) {
    return [
      `--user-data-dir=${profileDir}`,
      '--disable-blink-features=AutomationControlled',
      '--exclude-switches=enable-automation',
      '--disable-infobars',
      '--new-window',
      'https://labs.google/fx/tools/flow'
    ];
  }

  async openLogin(account) {
    const profile = this.store.profileDir(account);
    const exe = BrowserManager.findBrowser();
    account.LoginStarted = true;
    account.LoginMode = true;
    account.Port = 0;
    account.BrowserId = '';
    account.Status = 'Đăng nhập xong: đóng Chrome hồ sơ để kết nối';
    this.store.save();

    const args = BrowserManager.loginArguments(profile);

    if (exe) {
      try {
        const proc = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
        proc.unref();
        return { success: true, method: 'spawn', profile };
      } catch (e) {
        console.error('[BrowserManager] Lỗi spawn:', e);
      }
    }

    // Fallback qua cmd start
    return new Promise((resolve, reject) => {
      const cmd = `start "" chrome ${args.map(a => `"${a}"`).join(' ')}`;
      exec(cmd, { windowsHide: false }, (err) => {
        if (err) {
          const edgeCmd = `start "" msedge ${args.map(a => `"${a}"`).join(' ')}`;
          exec(edgeCmd, { windowsHide: false }, (edgeErr) => {
            if (edgeErr) reject(new Error('Không tìm thấy Chrome hoặc Edge trên máy.'));
            else resolve({ success: true, method: 'cmd-edge', profile });
          });
        } else {
          resolve({ success: true, method: 'cmd-chrome', profile });
        }
      });
    });
  }

  async enableControl(account) {
    const profile = this.store.profileDir(account);
    if (BrowserManager.profileInUse(profile)) {
      throw new Error('Đóng cửa sổ Chrome của hồ sơ đã đăng nhập, rồi bấm Kết nối và đọc tài khoản.');
    }
    account.LoginMode = false;
    this.store.save();
    await this.open(account);
  }

  async readHttpJson(port, route) {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}${route}`, { timeout: 3500 }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Phản hồi không phải JSON hợp lệ.'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Chrome không phản hồi trong 3.5 giây.'));
      });
    });
  }

  async isOpen(account) {
    if (!account.Port || account.Port < 1024 || !account.BrowserId) return false;
    try {
      const v = await this.readHttpJson(account.Port, '/json/version');
      return v && v.webSocketDebuggerUrl === account.BrowserId;
    } catch {
      return false;
    }
  }

  async open(account) {
    if (account.LoginMode) {
      throw new Error('Đăng nhập xong hãy đóng cửa sổ hồ sơ rồi bấm Kết nối và đọc tài khoản.');
    }
    if (await this.isOpen(account)) return;

    const profile = this.store.profileDir(account);
    const activePortFile = path.join(profile, 'DevToolsActivePort');

    // Kiểm tra port đang mở sẵn
    if (fs.existsSync(activePortFile)) {
      try {
        const lines = fs.readFileSync(activePortFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
        const existingPort = parseInt(lines[0], 10);
        if (existingPort >= 1024 && existingPort <= 65535) {
          const v = await this.readHttpJson(existingPort, '/json/version');
          if (v && v.webSocketDebuggerUrl) {
            account.Port = existingPort;
            account.BrowserId = v.webSocketDebuggerUrl;
            this.store.save();
            return;
          }
        }
      } catch (e) {}
    }

    const exe = BrowserManager.findBrowser();
    if (!exe) throw new Error('Cần Chrome hoặc Edge được cài trên máy.');

    const port = 0; // Tự động cấp phát cổng động
    const args = [
      `--user-data-dir=${profile}`,
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--exclude-switches=enable-automation',
      '--disable-infobars',
      '--new-window',
      'https://labs.google/fx/tools/flow'
    ];

    try {
      if (fs.existsSync(activePortFile)) fs.unlinkSync(activePortFile);
    } catch (e) {}

    const proc = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
    proc.unref();

    let lastFailure = '';
    const startDeadline = Date.now() + 20000;

    while (Date.now() < startDeadline) {
      try {
        if (fs.existsSync(activePortFile)) {
          const lines = fs.readFileSync(activePortFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
          if (lines.length > 0) {
            const detectedPort = parseInt(lines[0], 10);
            if (detectedPort >= 1024 && detectedPort <= 65535) {
              const v = await this.readHttpJson(detectedPort, '/json/version');
              if (v && v.webSocketDebuggerUrl) {
                account.Port = detectedPort;
                account.BrowserId = v.webSocketDebuggerUrl;
                account.Status = 'Đã mở; sẵn sàng điều khiển qua CDP';
                this.store.save();
                return;
              }
            }
          }
        }
      } catch (err) {
        lastFailure = err.message;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('Không kết nối được hồ sơ Chrome sau 20s. ' + lastFailure);
  }

  async close(account) {
    if (account.LoginMode) return;
    if (!await this.isOpen(account)) return;
    try {
      const CdpClient = require('./cdp-client');
      const client = new CdpClient();
      await client.connect(account.BrowserId);
      await client.call('Browser.close', {});
      client.dispose();
    } catch (e) {}
    account.Port = 0;
    account.BrowserId = '';
    this.store.save();
  }
}

module.exports = BrowserManager;
