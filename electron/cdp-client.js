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

    // STEALTH MODE: Ẩn cờ bot navigator.webdriver và cấu hình ngôn ngữ chuẩn
    await this.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        window.chrome = { runtime: {}, app: {}, loadTimes: function() {}, csi: function() {} };
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: 'denied' }) :
            originalQuery(parameters)
        );
      `
    });

    const version = await this.call('Browser.getVersion', {});
    if (this.trace) this.trace(`[Browser] ${version.product} (Stealth Mode Active)`);
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
    const point = await this.bridge({ action: 'prepareSubmit', jobId, prompt });
    await this.call('Page.bringToFront', {});
    const x = Number(point.x);
    const y = Number(point.y);

    await this.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });

    return await this.bridge({ action: 'confirmSubmit', jobId });
  }

  async fillPrompt(prompt) {
    const point = await this.bridge({ action: 'prepareFill' });
    const x = Number(point.x);
    const y = Number(point.y);

    await this.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });

    // Ctrl + A để xóa prompt cũ
    await this.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await this.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });

    // Gõ nội dung mới
    await this.call('Input.insertText', { text: prompt });

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

