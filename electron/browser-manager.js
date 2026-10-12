const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, exec } = require('child_process');
const { isFlowUrl } = require('./job-utils');

class BrowserManager {
  constructor(store) {
    this.store = store;
    this.controlLocks = new Map();
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
    if (await this.isOpen(account)) await this.close(account);
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
    const previous = this.controlLocks.get(account.Id) || Promise.resolve();
    const operation = previous.catch(() => {}).then(() => this.ensureControl(account));
    this.controlLocks.set(account.Id, operation);
    try { await operation; }
    finally { if (this.controlLocks.get(account.Id) === operation) this.controlLocks.delete(account.Id); }
  }

  async ensureControl(account) {
    if (await this.isOpen(account)) return;
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
          if (v && lines[1] && v.webSocketDebuggerUrl === `ws://127.0.0.1:${existingPort}${lines[1]}`) {
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

  async waitForFlowPage(client) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const history = await client.call('Page.getNavigationHistory', {});
      const entry = (history.entries || [])[history.currentIndex];
      if (entry && isFlowUrl(entry.url)) {
        const result = await client.call('Runtime.evaluate', {
          expression: "document.readyState !== 'loading' && !!document.querySelector('.header-user-button,flow-header-user-icon,.ProseMirror')",
          returnByValue: true
        });
        if (result.result && result.result.value) return;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Tab của job chưa tải xong Flow sau 25 giây; lệnh chưa được gửi.');
  }

  async connectFlowTab(account, { projectUrl = '', newTab = false } = {}) {
    if (projectUrl && !isFlowUrl(projectUrl)) throw new Error('URL dự án Flow không hợp lệ.');
    await this.enableControl(account);
    const CdpClient = require('./cdp-client');
    let pages = await this.readHttpJson(account.Port, '/json/list');
    let target = (Array.isArray(pages) ? pages : []).find(page => page.type === 'page' &&
      (projectUrl ? page.url === projectUrl : !newTab && isFlowUrl(page.url)));
    if (!target) {
      const control = new CdpClient();
      let targetId;
      try {
        await control.connect(account.BrowserId);
        const created = await control.call('Target.createTarget', { url: projectUrl || 'https://flow.google.com/' });
        targetId = created.targetId;
      } finally { control.dispose(); }
      for (let attempt = 0; attempt < 40; attempt++) {
        pages = await this.readHttpJson(account.Port, '/json/list');
        target = (Array.isArray(pages) ? pages : []).find(page => page.type === 'page' && page.id === targetId);
        if (target && target.webSocketDebuggerUrl) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    if (!target || !target.webSocketDebuggerUrl) throw new Error('Không kết nối được đúng tab Flow; không sử dụng tab khác thay thế.');
    const client = new CdpClient();
    try {
      await client.connect(target.webSocketDebuggerUrl);
      await this.waitForFlowPage(client);
      return client;
    } catch (error) { client.dispose(); throw error; }
  }

  async closeJobTab(account, projectUrl) {
    if (!projectUrl || !await this.isOpen(account)) return;
    const pages = await this.readHttpJson(account.Port, '/json/list');
    const targets = (Array.isArray(pages) ? pages : []).filter(page => page.type === 'page' && page.url === projectUrl);
    if (targets.length !== 1) return;
    const CdpClient = require('./cdp-client');
    const control = new CdpClient();
    try {
      await control.connect(account.BrowserId);
      await control.call('Target.closeTarget', { targetId: targets[0].id });
    } finally { control.dispose(); }
  }
}

module.exports = BrowserManager;

