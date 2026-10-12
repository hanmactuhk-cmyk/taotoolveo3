const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const CdpClient = require('./cdp-client');

class JobRunner {
  constructor(store, browserManager, onEvent) {
    this.store = store;
    this.browser = browserManager;
    this.onEvent = onEvent || (() => {});
    this.running = false;
    this.paused = false;
    this.stopped = false;
    this.cooldowns = new Map();
    this.activeWorkers = 0;
  }

  log(msg) {
    const timestamp = new Date().toLocaleTimeString();
    this.onEvent('log', `${timestamp} ${msg}`);
  }

  updateQueue() {
    this.onEvent('queue-updated', this.store.data.Queue);
  }

  async runQueue({ concurrent = 1, delay = '10–20 giây' } = {}) {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.stopped = false;

    const limit = Math.max(1, parseInt(concurrent, 10) || 1);
    this.log(`[JobRunner] Bắt đầu xử lý hàng chờ với giới hạn song song: ${limit}`);

    const workers = new Set();
    const queue = this.store.data.Queue;

    try {
      while (!this.stopped) {
        if (this.paused) {
          await new Promise(r => setTimeout(r, 400));
          continue;
        }

        // Tìm job đang chờ
        const pendingJob = queue.find(q => q.State === 'Hàng đợi' && !workers.has(q.Id));

        if (!pendingJob) {
          if (workers.size === 0) {
            this.log('[JobRunner] Đã hoàn tất toàn bộ hàng chờ.');
            break;
          }
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        if (workers.size >= limit) {
          await new Promise(r => setTimeout(r, 400));
          continue;
        }

        // Chọn tài khoản đủ điều kiện
        const eligibleAccounts = this.store.data.Accounts.filter(a => {
          if (!a.LoginStarted || !a.Enabled) return false;
          if (pendingJob.Kind === 'image' && !a.Images) return false;
          if (pendingJob.Kind === 'video' && !a.Videos) return false;
          if (pendingJob.AccountId && pendingJob.AccountId !== 'auto' && a.Id !== pendingJob.AccountId) return false;
          return true;
        });

        if (eligibleAccounts.length === 0) {
          pendingJob.State = 'Lỗi';
          pendingJob.Note = 'Không có tài khoản đủ quyền cho tác vụ này.';
          this.store.save();
          this.updateQueue();
          continue;
        }

        // Ưu tiên tài khoản có email và không đang trong cooldown
        const selectedAccount = eligibleAccounts.find(a => !this.isCoolingDown(a.Id)) || eligibleAccounts[0];

        workers.add(pendingJob.Id);
        this.processJob(pendingJob, selectedAccount)
          .finally(() => {
            workers.delete(pendingJob.Id);
            this.updateQueue();
          });
      }
    } finally {
      this.running = false;
      this.updateQueue();
      this.log('[JobRunner] Trình điều phối hàng chờ đã dừng.');
    }
  }

  pause() {
    this.paused = !this.paused;
    this.log(`[JobRunner] Đã ${this.paused ? 'tạm dừng' : 'tiếp tục'} xử lý hàng chờ.`);
  }

  stop() {
    this.stopped = true;
    this.log('[JobRunner] Nhận lệnh dừng toàn bộ hàng chờ.');
  }

  isCoolingDown(accountId) {
    const until = this.cooldowns.get(accountId);
    return until && until > Date.now();
  }

  setCooldown(accountId, seconds = 10) {
    this.cooldowns.set(accountId, Date.now() + seconds * 1000);
  }

  async processJob(job, account) {
    this.activeWorkers++;
    job.AutoDraft = false;
    job.SentPrompt = job.Prompt; // Khóa prompt đang chạy
    job.State = 'Đang chạy';
    job.AccountId = account.Id;
    job.Note = 'Đang kết nối Chrome...';
    this.store.save();
    this.updateQueue();

    this.log(`[Job ${job.Id.slice(0, 6)}] Bắt đầu xử lý trên tài khoản ${account.Name}`);

    let cdp = null;
    try {
      if (this.isCoolingDown(account.Id)) {
        const waitMs = this.cooldowns.get(account.Id) - Date.now();
        if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
      }

      // Đảm bảo Chrome đang mở ở control mode
      await this.browser.enableControl(account);

      // Mở một tab riêng biệt cho job để tránh xung đột cấu hình
      cdp = await this.connectJobTab(account, job.Url);
      cdp.trace = (msg) => {
        this.log(`[CDP ${job.Id.slice(0, 6)}] ${msg}`);
      };

      await cdp.enableDiagnostics();

      // Đọc thông tin tài khoản để xác minh credit thực tế
      this.log(`[Job ${job.Id.slice(0, 6)}] Đọc thông tin tài khoản từ Flow...`);
      try {
        const accData = await cdp.bridge({ action: 'account' });
        if (accData && accData.email) {
          account.Email = accData.email;
          account.Plan = accData.plan;
          account.Credits = accData.credits;
          account.CheckedUtc = new Date().toISOString();
          this.store.save();
        }
      } catch (e) {
        this.log(`[Cảnh báo] Không thể đọc nhanh tài khoản: ${e.message}`);
      }

      // Xác nhận catalog và chọn model
      const catalog = await cdp.bridge({ action: 'catalog', kind: job.Kind });
      const availableModels = (catalog && catalog.models ? catalog.models : [])
        .filter(m => !m.disabled)
        .map(m => m.name);

      if (availableModels.length > 0 && !availableModels.includes(job.Model)) {
        job.Model = availableModels[0]; // Chọn model khả dụng đầu tiên
      }

      // Cấu hình model & options
      this.log(`[Job ${job.Id.slice(0, 6)}] Cấu hình Model: ${job.Model}, Tỷ lệ: ${job.Ratio}`);
      const cfg = await cdp.bridge({ action: 'configure', kind: job.Kind, model: job.Model });

      const fieldsToSet = [];
      if (cfg && cfg.fields) {
        for (const f of cfg.fields) {
          const optNames = (f.options || []).filter(o => !o.disabled).map(o => o.name);
          if (optNames.includes(job.Ratio)) fieldsToSet.push({ name: f.name, value: job.Ratio });
          if (optNames.includes(job.Count)) fieldsToSet.push({ name: f.name, value: job.Count });
        }
      }
      if (fieldsToSet.length > 0) {
        await cdp.bridge({ action: 'configure', kind: job.Kind, fields: fieldsToSet });
      }

      // Điền prompt
      this.log(`[Job ${job.Id.slice(0, 6)}] Điền Prompt qua CDP: "${job.SentPrompt.slice(0, 40)}..."`);
      await cdp.bridge({ action: 'fill', prompt: job.SentPrompt });

      // Tải ảnh (ảnh đầu, ảnh cuối, ảnh tham chiếu)
      if (job.StartImage && fs.existsSync(job.StartImage)) {
        this.log(`[Job ${job.Id.slice(0, 6)}] Tải ảnh bắt đầu: ${path.basename(job.StartImage)}`);
        await cdp.uploadImage(job.StartImage, 'start');
      }
      if (job.EndImage && fs.existsSync(job.EndImage)) {
        this.log(`[Job ${job.Id.slice(0, 6)}] Tải ảnh kết thúc: ${path.basename(job.EndImage)}`);
        await cdp.uploadImage(job.EndImage, 'end');
      }
      if (Array.isArray(job.References)) {
        for (const refPath of job.References) {
          if (refPath && fs.existsSync(refPath)) {
            this.log(`[Job ${job.Id.slice(0, 6)}] Tải ảnh tham chiếu: ${path.basename(refPath)}`);
            await cdp.uploadImage(refPath, 'reference');
          }
        }
      }

      // Chụp media baseline trước khi gửi lệnh
      const baseline = await cdp.bridge({ action: 'mediaBaseline' });
      job.Baseline = baseline.urls || [];
      job.BaselineCards = baseline.cards || [];

      // Chuẩn bị thư mục kết quả
      const resultDir = path.join(this.store.data.OutputFolder, job.Kind, job.Id.slice(0, 8));
      if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });
      job.Folder = resultDir;

      // Bấm nút Tạo (Single click via CDP mouse event)
      job.State = 'Đang gửi';
      job.Submitted = true;
      this.store.save();
      this.updateQueue();

      this.log(`[Job ${job.Id.slice(0, 6)}] Bấm nút Tạo trên Flow và đợi xác nhận...`);
      await cdp.bridge({
        action: 'submit',
        jobId: job.ExecutionId || job.Id,
        prompt: job.SentPrompt
      });

      job.State = 'Đang chạy';
      job.Note = 'Đã xác nhận nhận lệnh. Đang theo dõi tiến độ sinh media...';
      this.store.save();
      this.updateQueue();

      // Vòng lặp theo dõi kết quả thực tế
      await this.monitorJob(cdp, job);

    } catch (err) {
      job.State = 'Lỗi';
      job.Note = err.message;
      this.log(`[Job ${job.Id.slice(0, 6)}] Lỗi: ${err.message}`);
    } finally {
      if (cdp) cdp.dispose();
      this.setCooldown(account.Id, 10);
      this.activeWorkers--;
      this.store.save();
      this.updateQueue();
    }
  }

  async connectJobTab(account, projectUrl) {
    const listRes = await this.browser.readHttpJson(account.Port, '/json/list');
    const pages = Array.isArray(listRes) ? listRes.filter(p => p.type === 'page') : [];

    let targetPage = null;
    if (projectUrl) {
      targetPage = pages.find(p => p.url === projectUrl);
    }

    if (!targetPage) {
      // Mở tab mới riêng biệt bằng Target.createTarget
      const controlClient = new CdpClient();
      await controlClient.connect(account.BrowserId);
      const newTarget = await controlClient.call('Target.createTarget', {
        url: projectUrl || 'https://labs.google/fx/tools/flow'
      });
      controlClient.dispose();

      // Đợi tab mới xuất hiện trong danh sách
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 300));
        const updatedList = await this.browser.readHttpJson(account.Port, '/json/list');
        targetPage = (updatedList || []).find(p => p.id === newTarget.targetId);
        if (targetPage && targetPage.webSocketDebuggerUrl) break;
      }
    }

    if (!targetPage || !targetPage.webSocketDebuggerUrl) {
      // Fallback về tab đầu tiên có chứa Flow
      targetPage = pages.find(p => p.url && (p.url.includes('flow') || p.url.includes('labs.google')));
    }

    if (!targetPage || !targetPage.webSocketDebuggerUrl) {
      throw new Error('Không thể kết nối vào tab Flow của job.');
    }

    const cdp = new CdpClient();
    await cdp.connect(targetPage.webSocketDebuggerUrl);
    return cdp;
  }

  async monitorJob(cdp, job) {
    const deadline = Date.now() + 15 * 60 * 1000; // 15 phút
    let lastProgress = 0;

    while (Date.now() < deadline) {
      if (this.stopped) throw new Error('Người dùng đã hủy.');

      const status = await cdp.bridge({
        action: 'jobStatus',
        prompt: job.SentPrompt,
        baseline: job.Baseline || [],
        baselineCards: job.BaselineCards || [],
        kind: job.Kind
      });

      if (status.error) throw new Error(status.error);

      if (status.progress !== null && status.progress !== undefined) {
        job.Progress = status.progress;
        lastProgress = status.progress;
      }
      if (status.message) job.Note = status.message;

      // Đã phát hiện URL media mới
      const urls = (status.urls || []).filter(u => u && u.startsWith('https://'));
      if (urls.length > 0) {
        this.log(`[Job ${job.Id.slice(0, 6)}] Đã phát hiện ${urls.length} media mới! Đang tải về...`);
        job.Note = 'Đang tải tệp kết quả về máy...';
        this.store.save();
        this.updateQueue();

        const downloadedPaths = [];
        for (let idx = 0; idx < urls.length; idx++) {
          const ext = job.Kind === 'video' ? '.mp4' : '.png';
          const fileName = `result_${idx + 1}${ext}`;
          const destPath = path.join(job.Folder, fileName);
          try {
            await this.downloadFile(urls[idx], destPath);
            downloadedPaths.push(destPath);
          } catch (dlErr) {
            this.log(`[Lỗi tải file] ${dlErr.message}`);
          }
        }

        job.Results = downloadedPaths;
        job.State = 'Hoàn tất';
        job.Progress = 100;
        job.Note = `Hoàn tất • Đã lưu ${downloadedPaths.length} tệp tại ${path.basename(job.Folder)}`;
        this.log(`[Job ${job.Id.slice(0, 6)}] Hoàn tất thành công!`);
        return;
      }

      this.store.save();
      this.updateQueue();
      await new Promise(r => setTimeout(r, 2000));
    }

    throw new Error('Quá thời gian chờ kết quả sau 15 phút.');
  }

  downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(dest);
      proto.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this.downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }

  retryJob(jobId) {
    const job = this.store.data.Queue.find(q => q.Id === jobId);
    if (!job) return;

    if (!job.Attempts) job.Attempts = [];
    job.Attempts.push({
      ExecutionId: job.ExecutionId || job.Id,
      AccountId: job.AccountId,
      Prompt: job.SentPrompt || job.Prompt,
      State: job.State,
      Note: job.Note,
      Url: job.Url,
      Results: job.Results || []
    });

    job.ExecutionId = 'exec_' + Date.now().toString(36);
    job.Submitted = false;
    job.SentPrompt = null;
    job.State = 'Hàng đợi';
    job.Note = 'Tạo lại từ bản ghi lịch sử';
    job.Progress = null;
    job.Results = [];
    job.Baseline = [];
    job.BaselineCards = [];

    this.store.save();
    this.updateQueue();
    this.log(`[Job ${job.Id.slice(0, 6)}] Đã đưa lại vào hàng đợi (Mã lần chạy mới: ${job.ExecutionId})`);
  }
}

module.exports = JobRunner;
