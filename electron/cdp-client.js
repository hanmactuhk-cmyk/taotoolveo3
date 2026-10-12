const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { isFlowUrl } = require('./job-utils');

class CdpClient {
  constructor() {
    this.socket = null;
    this.sequence = 0;
    this.callbacks = new Map();
    this.events = [];
    this.trace = null;
  }

  async connect(address) {
    const url = new URL(address);
    if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new Error('Chỉ cho phép kết nối trình duyệt cục bộ trên máy này.');
    }

    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(address, { maxPayload: 16 * 1024 * 1024 });

      const timeout = setTimeout(() => {
        this.socket.terminate();
        reject(new Error('Hết thời gian chờ kết nối WebSocket tới Chrome (8s).'));
      }, 8000);

      this.socket.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id !== undefined && this.callbacks.has(msg.id)) {
            const { resolve, reject } = this.callbacks.get(msg.id);
            this.callbacks.delete(msg.id);
            if (msg.error) {
              reject(new Error('Chrome error: ' + msg.error.message));
            } else {
              resolve(msg.result);
            }
          } else if (msg.method) {
            this.events.push(msg);
            if (this.events.length > 150) this.events.shift();
            if (this.trace && msg.method === 'Network.responseReceived') {
              const res = msg.params && msg.params.response;
              if (res && res.status >= 400) {
                let host = 'unknown';
                try { host = new URL(res.url).hostname; } catch {}
                this.trace(`[HTTP] ${res.status} | ${host}`);
              }
            }
          }
        } catch (e) {
          console.error('[CDP] Lỗi parse message:', e);
        }
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.socket.on('close', () => {
        for (const { reject } of this.callbacks.values()) {
          reject(new Error('Kết nối WebSocket tới Chrome đã đóng.'));
        }
        this.callbacks.clear();
      });
    });
  }

  async call(method, params = {}, timeoutMs = 35000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket chưa mở hoặc đã đóng.');
    }

    const id = ++this.sequence;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          reject(new Error(`Hết thời gian chờ phản hồi CDP lệnh ${method} (${Math.round(timeoutMs / 1000)}s).`));
        }
      }, timeoutMs);

      this.callbacks.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });

      try { this.socket.send(payload); }
      catch (error) { clearTimeout(timer); this.callbacks.delete(id); reject(error); }
    });
  }

  async enableDiagnostics() {
    await this.call('Network.enable', {});
    await this.call('Page.enable', {});

    // STEALTH & ANTI-BOT: Advanced anti-detection patches for Google reCAPTCHA Enterprise
    await this.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        try {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true
          });
        } catch(e) {}

        try {
          if (!window.chrome) {
            window.chrome = {
              app: { isInstalled: false },
              webstore: { onInstallStageChanged: {}, onDownloadProgress: {} },
              runtime: {
                OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', UPDATE: 'update' },
                OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
                connect: function() {},
                sendMessage: function() {}
              }
            };
          }
        } catch(e) {}

        try {
          Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'], configurable: true });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
          Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, configurable: true });
        } catch(e) {}

        try {
          const getParameterOriginal = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return 'Google Inc. (NVIDIA)';
            if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            return getParameterOriginal.apply(this, arguments);
          };
          if (typeof WebGL2RenderingContext !== 'undefined') {
            const getParameterOriginal2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(parameter) {
              if (parameter === 37445) return 'Google Inc. (NVIDIA)';
              if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
              return getParameterOriginal2.apply(this, arguments);
            };
          }
        } catch(e) {}

        try {
          if (window.localStorage && window.localStorage.getItem('_grecaptcha')) {
            window.localStorage.removeItem('_grecaptcha');
          }
        } catch(e) {}
      `
    });

    const version = await this.call('Browser.getVersion', {});
    if (this.trace) this.trace(`[Browser] ${version.product} (Advanced Stealth & Anti-Bot Active)`);
  }

  async clearCaptchaSession() {
    try {
      await this.call('Runtime.evaluate', {
        expression: `
          (function() {
            try { localStorage.removeItem('_grecaptcha'); } catch(e) {}
            try {
              for (const k of Object.keys(sessionStorage)) {
                if (k.startsWith('flowdesk:')) sessionStorage.removeItem(k);
              }
            } catch(e) {}
            return true;
          })()
        `,
        returnByValue: true
      });
      if (this.trace) this.trace('[Anti-Bot] Đã xóa cache reCAPTCHA (_grecaptcha) và làm sạch session.');
    } catch (err) {
      if (this.trace) this.trace('[Anti-Bot] Lỗi xóa cache reCAPTCHA: ' + err.message);
    }
  }

  async bridge(request) {
    const action = request.action;
    const startTime = Date.now();

    if (action === 'fill') return await this.fillPrompt(request.prompt);
    if (action === 'submit') return await this.submit(request.jobId, request.prompt);

    const history = await this.call('Page.getNavigationHistory', {});
    const entry = (history.entries || [])[history.currentIndex];
    if (!entry || !isFlowUrl(entry.url)) throw new Error('Hoàn tất đăng nhập và mở đúng tab Flow trước khi thao tác.');

    const bridgePath = path.resolve(__dirname, '../flow-bridge.js');
    if (!fs.existsSync(bridgePath)) throw new Error('Không tìm thấy tệp flow-bridge.js');
    const sourceCode = fs.readFileSync(bridgePath, 'utf8');

    const expression = sourceCode.replace('__FLOWDESK_REQUEST__', JSON.stringify(request));

    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    }, action === 'finishUpload' ? 100000 : 35000);

    if (result.exceptionDetails) {
      throw new Error('Flow thay đổi trang trong lúc thao tác: ' + (result.exceptionDetails.text || 'Lỗi trang'));
    }

    let value = result.result && result.result.value;

    // Xử lý khi Flow đặt thông tin tài khoản trong iframe của Google (ACCOUNT_FRAME_REQUIRED)
    if (value && !value.ok && value.code === 'ACCOUNT_FRAME_REQUIRED') {
      const tree = await this.call('Page.getFrameTree', {});
      const frames = [];
      const collect = (node) => {
        if (node.frame) frames.push(node.frame);
        if (node.childFrames) node.childFrames.forEach(collect);
      };
      collect(tree.frameTree);

      for (const frame of frames) {
        if (!frame.url) continue;
        try {
          const u = new URL(frame.url);
          if ((u.hostname === 'ogs.google.com' && u.pathname.includes('account')) ||
              (u.hostname === 'accounts.google.com' && u.pathname.includes('SignOutOptions'))) {
            const world = await this.call('Page.createIsolatedWorld', {
              frameId: frame.id,
              worldName: 'FlowDeskAccountReader'
            });
            const innerExpr = sourceCode.replace('__FLOWDESK_REQUEST__', JSON.stringify({
              action: 'account',
              headerPlan: value.headerPlan,
              accountFrame: true
            }));
            const inner = await this.call('Runtime.evaluate', {
              expression: innerExpr,
              contextId: world.executionContextId,
              returnByValue: true,
              awaitPromise: true
            });
            if (inner.result && inner.result.value && inner.result.value.ok) {
              value = inner.result.value;
              break;
            }
          }
        } catch (e) {}
      }
    }

    if (!value || !value.ok) {
      const errMsg = value ? value.error : 'Không có phản hồi từ flow-bridge';
      if (this.trace && action !== 'jobStatus') this.trace(`[Flow] Lỗi ${action}: ${errMsg}`);
      throw new Error(errMsg);
    }

    if (this.trace && action !== 'jobStatus') {
      this.trace(`[Flow] Xong ${action} | ${Date.now() - startTime}ms`);
    }

    return value.data;
  }

  async submit(jobId, prompt) {
    await this.clearCaptchaSession();
    const point = await this.bridge({ action: 'prepareSubmit', jobId, prompt });
    await this.call('Page.bringToFront', {});
    const x = Number(point.x);
    const y = Number(point.y);

    await this.humanClick(x, y);

    return await this.bridge({ action: 'confirmSubmit', jobId });
  }

  async humanClick(x, y) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const offsetX = (Math.random() * 8) - 4;
    const offsetY = (Math.random() * 6) - 3;
    const targetX = Math.round(x + offsetX);
    const targetY = Math.round(y + offsetY);

    const steps = 4 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const curX = Math.round(targetX - (1 - t) * 12 * (1 - t));
      const curY = Math.round(targetY - (1 - t) * 8 * (1 - t));
      await this.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: curX, y: curY });
      await sleep(10 + Math.floor(Math.random() * 8));
    }

    await sleep(50 + Math.floor(Math.random() * 40));

    await this.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: targetX,
      y: targetY,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });

    await sleep(70 + Math.floor(Math.random() * 40));

    await this.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: targetX,
      y: targetY,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
  }

  async fillPrompt(prompt) {
    const point = await this.bridge({ action: 'prepareFill' });
    const x = Number(point.x);
    const y = Number(point.y);

    await this.humanClick(x, y);
    await new Promise(r => setTimeout(r, 120 + Math.floor(Math.random() * 150)));

    // Ctrl + A để xóa prompt cũ
    await this.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await this.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await new Promise(r => setTimeout(r, 60 + Math.floor(Math.random() * 60)));

    // Gõ nội dung mới mô phỏng người thật gõ theo cụm ký tự với độ trễ ngẫu nhiên
    const textToType = String(prompt || '');
    for (let i = 0; i < textToType.length; i += 3) {
      const chunk = textToType.slice(i, i + 3);
      await this.call('Input.insertText', { text: chunk });
      const delay = 25 + Math.floor(Math.random() * 55);
      await new Promise(r => setTimeout(r, delay));
    }

    await new Promise(r => setTimeout(r, 200 + Math.floor(Math.random() * 200)));
    return await this.bridge({ action: 'confirmFill', prompt });
  }

  async uploadImage(imagePath, slot = 'reference') {
    const attachments = await this.bridge({ action: 'attachmentCount', slot });
    this.events = this.events.filter(e => e.method !== 'Page.fileChooserOpened');

    await this.call('Page.enable', {});
    await this.call('Page.setInterceptFileChooserDialog', { enabled: true });

    let uploadFailure = null;
    try {
      await this.bridge({ action: 'upload', slot });

      const chooser = await this.waitForProtocolEvent('Page.fileChooserOpened');
      const backendNodeId = chooser.params && chooser.params.backendNodeId;
      if (!backendNodeId) throw new Error('Chrome chưa cung cấp ô tải tệp.');

      await this.call('DOM.setFileInputFiles', {
        files: [path.resolve(imagePath)],
        backendNodeId
      });

      await this.bridge({
        action: 'finishUpload',
        slot,
        initialCount: (attachments && attachments.count) || 0
      });
    } catch (err) {
      uploadFailure = err;
    } finally {
      await this.call('Page.setInterceptFileChooserDialog', { enabled: false });
    }

    if (uploadFailure) throw uploadFailure;
  }

  async waitForProtocolEvent(method, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    do {
      const event = this.events.slice().reverse().find(item => item.method === method);
      if (event) return event;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(`Chrome chưa trả sự kiện ${method}; không tải tệp vào tab khác.`);
  }

  dispose() {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
  }
}

module.exports = CdpClient;

